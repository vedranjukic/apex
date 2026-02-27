/**
 * E2E test: agent auto-restart when deliberately crashed.
 *
 * Uses a real Daytona sandbox. Requires:
 *   - DAYTONA_API_KEY
 *   - ANTHROPIC_API_KEY
 *   - APEX_E2E_TEST=1 (enables crash_agent WebSocket handler)
 *
 * Skips when keys are not set (e.g. CI without sandbox).
 */
import axios from 'axios';
import { io, Socket } from 'socket.io-client';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const baseUrl = `http://${host}:${port}`;

const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY;

const describeE2e = hasSandboxKeys ? describe : describe.skip;

describeE2e('Agent auto-restart E2E (real sandbox)', () => {
  let projectId: string;
  let chatId: string;
  let socket: Socket;

  beforeAll(async () => {
    process.env.APEX_E2E_TEST = '1';
  });

  afterAll(async () => {
    process.env.APEX_E2E_TEST = '';
    if (projectId) {
      try {
        await axios.delete(`/api/projects/${projectId}`);
      } catch {
        // ignore cleanup errors
      }
    }
    socket?.disconnect();
  });

  it('should create project and wait for sandbox', async () => {
    const res = await axios.post('/api/projects', {
      name: 'e2e-agent-retry-test',
    });
    expect([200, 201]).toContain(res.status);
    projectId = res.data.id;
    expect(projectId).toBeDefined();

    // Poll until sandbox is ready (up to 5 min)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const proj = await axios.get(`/api/projects/${projectId}`);
      if (proj.data.status === 'running' && proj.data.sandboxId) {
        return;
      }
      if (proj.data.status === 'error') {
        throw new Error(`Project provision failed: ${proj.data.statusError}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('Sandbox did not become ready in time');
  }, 6 * 60 * 1000);

  it('should create chat and connect to agent socket', async () => {
    const res = await axios.post(`/api/projects/${projectId}/chats`, {
      prompt: 'Reply with exactly: OK',
    });
    expect([200, 201]).toContain(res.status);
    chatId = res.data.id;
    expect(chatId).toBeDefined();

    socket = io(`${baseUrl}/ws/agent`, {
      path: '/ws/socket.io',
      transports: ['polling', 'websocket'],
      autoConnect: true,
    });

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (err) => reject(err));
    });

    await new Promise<void>((resolve) => {
      socket.emit('subscribe_project', { projectId });
      socket.once('subscribed', () => resolve());
    });
  }, 30_000);

  it('should send prompt, receive response, crash agent, then see restart', async () => {
    const prompt = 'Say exactly: hello';
    const firstResponse = new Promise<{ type: string; subtype?: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('First response timeout')), 120_000);
        socket.on('agent_message', (data: { message?: { type?: string; subtype?: string } }) => {
          const msg = data?.message;
          if (msg?.type === 'assistant') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
        socket.on('agent_error', (data: { error: string }) => {
          clearTimeout(timeout);
          reject(new Error(data.error));
        });
      },
    );

    socket.emit('send_prompt', { chatId, prompt, mode: 'agent' });

    await new Promise<void>((resolve) => {
      socket.once('prompt_accepted', () => resolve());
    });

    const first = await firstResponse;
    expect(first.type).toBe('assistant');

    // Deliberately crash the agent
    socket.emit('crash_agent', { chatId });

    // Wait for retry message
    const retryMessage = await new Promise<{ type: string; subtype?: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Retry message timeout')),
          30_000,
        );
        socket.on('agent_message', (data: { message?: { type?: string; subtype?: string } }) => {
          const msg = data?.message;
          if (msg?.type === 'system' && msg?.subtype === 'retry') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
      },
    );
    expect(retryMessage.subtype).toBe('retry');

    // Wait for agent to respond again after restart
    const secondResponse = await new Promise<{ type: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Second response timeout')),
          120_000,
        );
        socket.on('agent_message', (data: { message?: { type?: string } }) => {
          const msg = data?.message;
          if (msg?.type === 'assistant') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
        socket.on('agent_error', (data: { error: string }) => {
          clearTimeout(timeout);
          reject(new Error(data.error));
        });
      },
    );
    expect(secondResponse.type).toBe('assistant');
  }, 5 * 60 * 1000);
});
