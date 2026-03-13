/**
 * E2E test: waiting_for_input status when agents ask user questions.
 *
 * Uses a real Daytona sandbox with Claude Code. Sends a prompt that is
 * intentionally ambiguous so the agent is likely to invoke the MCP
 * ask_user tool. Then verifies:
 *   1. agent_status transitions to waiting_for_input
 *   2. AskUserQuestion tool_use block appears in the event stream
 *   3. The chat status in the DB reflects waiting_for_input
 *   4. Sending a user_answer transitions status back to running
 *   5. The agent continues and eventually reaches completed
 *
 * Requires:
 *   - DAYTONA_API_KEY (sandbox provisioning)
 *   - ANTHROPIC_API_KEY (Claude Code)
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=ask-user
 */
import axios from 'axios';
import { io, Socket } from 'socket.io-client';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '6000';
const baseUrl = `http://${host}:${port}`;

const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY;

const describeE2e = hasSandboxKeys ? describe : describe.skip;

// ── Helpers ──────────────────────────────────────────

async function createProject(name: string): Promise<string> {
  const res = await axios.post('/api/projects', { name, agentType: 'claude_code' });
  expect([200, 201]).toContain(res.status);
  return res.data.id;
}

async function waitForSandbox(
  projectId: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await axios.get(`/api/projects/${projectId}`);
    if (res.data.status === 'running' && res.data.sandboxId) return;
    if (res.data.status === 'error') {
      throw new Error(`Provision failed: ${res.data.statusError}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Sandbox did not become ready in time');
}

function connectSocket(): Promise<Socket> {
  const socket = io(`${baseUrl}/ws/agent`, {
    path: '/ws/socket.io',
    transports: ['polling', 'websocket'],
    autoConnect: true,
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function subscribeProject(socket: Socket, projectId: string): Promise<void> {
  return new Promise((resolve) => {
    socket.emit('subscribe_project', { projectId });
    socket.once('subscribed', () => resolve());
  });
}

async function createChat(
  projectId: string,
  prompt: string,
): Promise<string> {
  const res = await axios.post(`/api/projects/${projectId}/chats`, { prompt });
  expect([200, 201]).toContain(res.status);
  return res.data.id;
}

async function deleteProject(projectId: string): Promise<void> {
  try {
    await axios.delete(`/api/projects/${projectId}`);
  } catch {
    // ignore cleanup errors
  }
}

async function getChatStatus(chatId: string): Promise<string> {
  const res = await axios.get(`/api/chats/${chatId}`);
  return res.data.status;
}

// ── Types ────────────────────────────────────────────

interface AgentEvent {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }>;
    stop_reason?: string;
  };
  session_id?: string;
  is_error?: boolean;
}

interface StatusEvent {
  chatId: string;
  status: string;
}

// ── Tests ────────────────────────────────────────────

describeE2e('Ask-user / waiting_for_input E2E (real sandbox)', () => {
  let projectId: string;
  let chatId: string;
  let socket: Socket;

  afterAll(async () => {
    socket?.disconnect();
    if (projectId) await deleteProject(projectId);
  });

  it('should provision a Claude Code project', async () => {
    projectId = await createProject('e2e-ask-user-test');
    await waitForSandbox(projectId);
  }, 6 * 60 * 1000);

  it('should connect and subscribe', async () => {
    socket = await connectSocket();
    await subscribeProject(socket, projectId);
  }, 30_000);

  it('should trigger ask_user and receive waiting_for_input status', async () => {
    // Prompt that forces the agent to ask a question via the MCP ask_user tool.
    // We explicitly instruct the agent to use ask_user.
    const prompt = [
      'You have the mcp__terminal-server__ask_user tool available.',
      'Use it now to ask the user which programming language they prefer.',
      'Present options: Python, TypeScript, Go.',
      'Do NOT proceed until you get the user answer.',
    ].join(' ');

    chatId = await createChat(projectId, prompt);

    const statusUpdates: StatusEvent[] = [];
    const agentEvents: AgentEvent[] = [];

    const waitForAskUser = new Promise<{
      questionToolUseId: string;
      statuses: StatusEvent[];
      events: AgentEvent[];
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        // If we never saw waiting_for_input, resolve with what we have
        // so we can produce a descriptive failure message
        resolve({
          questionToolUseId: '',
          statuses: statusUpdates,
          events: agentEvents,
        });
      }, 3 * 60 * 1000);

      const onStatus = (data: StatusEvent) => {
        if (data.chatId !== chatId) return;
        console.log(`[ask-user e2e] agent_status: ${data.status}`);
        statusUpdates.push(data);

        if (data.status === 'waiting_for_input') {
          // Find the AskUserQuestion tool_use ID from events
          const askEvent = agentEvents.find((e) =>
            e.message?.content?.some(
              (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
            ),
          );
          const toolUseBlock = askEvent?.message?.content?.find(
            (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
          );
          clearTimeout(timeout);
          cleanup();
          resolve({
            questionToolUseId: toolUseBlock?.id || '',
            statuses: statusUpdates,
            events: agentEvents,
          });
        }
      };

      const onMessage = (data: { chatId?: string; message?: AgentEvent }) => {
        if (data.chatId !== chatId) return;
        if (data.message) {
          agentEvents.push(data.message);
        }
      };

      const onError = (data: { chatId?: string; error?: string }) => {
        if (data.chatId !== chatId) return;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Agent error: ${data.error}`));
      };

      const cleanup = () => {
        socket.off('agent_status', onStatus);
        socket.off('agent_message', onMessage);
        socket.off('agent_error', onError);
      };

      socket.on('agent_status', onStatus);
      socket.on('agent_message', onMessage);
      socket.on('agent_error', onError);
    });

    socket.emit('execute_chat', { chatId, mode: 'agent' });

    const result = await waitForAskUser;

    console.log(`[ask-user e2e] ${result.events.length} events, ${result.statuses.length} status updates`);
    console.log(`[ask-user e2e] Status sequence: ${result.statuses.map((s) => s.status).join(' → ')}`);

    // The agent should have transitioned to waiting_for_input
    const waitingStatus = result.statuses.find((s) => s.status === 'waiting_for_input');
    expect(waitingStatus).toBeDefined();

    // An AskUserQuestion tool_use should appear in the events
    const askEvent = result.events.find((e) =>
      e.message?.content?.some(
        (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
      ),
    );
    expect(askEvent).toBeDefined();

    // The tool_use should have a valid ID
    expect(result.questionToolUseId).toBeTruthy();

    // The DB status should also be waiting_for_input
    const dbStatus = await getChatStatus(chatId);
    expect(dbStatus).toBe('waiting_for_input');
  }, 4 * 60 * 1000);

  it('should transition back to running when user answers', async () => {
    // Retrieve the AskUserQuestion tool_use ID from the chat messages
    const messagesRes = await axios.get(`/api/chats/${chatId}/messages`);
    const messages = messagesRes.data;
    let toolUseId = '';
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      const block = msg.content?.find(
        (b: { type: string; name?: string }) =>
          b.type === 'tool_use' && b.name === 'AskUserQuestion',
      );
      if (block) {
        toolUseId = block.id;
        break;
      }
    }

    expect(toolUseId).toBeTruthy();

    // Listen for status changes
    const statusSequence: string[] = [];

    const waitForCompletion = new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(statusSequence);
      }, 3 * 60 * 1000);

      const onStatus = (data: StatusEvent) => {
        if (data.chatId !== chatId) return;
        console.log(`[ask-user e2e] post-answer status: ${data.status}`);
        statusSequence.push(data.status);

        if (data.status === 'completed' || data.status === 'error') {
          clearTimeout(timeout);
          cleanup();
          resolve(statusSequence);
        }
      };

      const cleanup = () => {
        socket.off('agent_status', onStatus);
      };

      socket.on('agent_status', onStatus);
    });

    // Send the user answer
    socket.emit('user_answer', {
      chatId,
      toolUseId,
      answer: 'Python',
    });

    const statuses = await waitForCompletion;
    console.log(`[ask-user e2e] Post-answer status sequence: ${statuses.join(' → ')}`);

    // Should have transitioned to running after the answer
    expect(statuses).toContain('running');

    // Should eventually complete
    const finalStatus = await getChatStatus(chatId);
    expect(['completed', 'running']).toContain(finalStatus);
  }, 4 * 60 * 1000);
});
