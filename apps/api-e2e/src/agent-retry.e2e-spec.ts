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
import {
  AgentSocket,
  createProject,
  waitForApiSettled,
  waitForSandbox,
  deleteProject,
  connectSocket,
  subscribeProject,
  createThread,
  waitForFirstMessage,
  collectAgentEvents,
  type AgentEvent,
} from './support/e2e-helpers';

const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY;

const describeE2e = hasSandboxKeys ? describe : describe.skip;

describeE2e('Agent auto-restart E2E (real sandbox)', () => {
  let projectId: string;
  let threadId: string;
  let socket: AgentSocket;

  beforeAll(async () => {
    process.env.APEX_E2E_TEST = '1';
    await waitForApiSettled();
  }, 30_000);

  afterAll(async () => {
    process.env.APEX_E2E_TEST = '';
    if (projectId) await deleteProject(projectId);
    socket?.disconnect();
  });

  it('should create project and wait for sandbox', async () => {
    projectId = await createProject('e2e-agent-retry-test');
    expect(projectId).toBeDefined();
    await waitForSandbox(projectId);
  }, 6 * 60 * 1000);

  it('should create thread and connect to agent socket', async () => {
    threadId = await createThread(projectId, 'Reply with exactly: OK');
    expect(threadId).toBeDefined();

    socket = await connectSocket();
    await subscribeProject(socket, projectId);
  }, 30_000);

  it('should send prompt, receive response, crash agent, then see restart', async () => {
    const prompt = 'Say exactly: hello';

    // Listen for first assistant message
    const firstMsgPromise = waitForFirstMessage(socket, threadId, 120_000);

    socket.send('send_prompt', { threadId, prompt, mode: 'agent' });
    const first = await firstMsgPromise;
    expect(first).not.toBeNull();
    expect(first!.type).toBe('assistant');

    // Deliberately crash the agent
    socket.send('crash_agent', { threadId });

    // Wait for retry system message
    const retryMessage = await new Promise<AgentEvent | null>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 30_000);

      const onMessage = (payload: any) => {
        if (payload.threadId !== threadId) return;
        const msg = payload.message;
        if (msg?.type === 'system' && msg?.subtype === 'retry') {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('agent_message', onMessage);
      };

      socket.on('agent_message', onMessage);
    });

    expect(retryMessage).not.toBeNull();
    expect(retryMessage!.subtype).toBe('retry');

    // Wait for agent to respond again after restart
    const secondMsg = await waitForFirstMessage(socket, threadId, 120_000);
    expect(secondMsg).not.toBeNull();
    expect(secondMsg!.type).toBe('assistant');
  }, 5 * 60 * 1000);
});
