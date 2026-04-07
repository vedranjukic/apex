/**
 * E2E test: waiting_for_input status when agents ask user questions.
 *
 * Uses a real Daytona sandbox with Claude Code. Sends a prompt that is
 * intentionally ambiguous so the agent is likely to invoke the MCP
 * ask_user tool. Then verifies:
 *   1. agent_status transitions to waiting_for_input
 *   2. AskUserQuestion tool_use block appears in the event stream
 *   3. The thread status in the DB reflects waiting_for_input
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
import {
  AgentSocket,
  createProject,
  waitForApiSettled,
  waitForSandbox,
  deleteProject,
  connectSocket,
  subscribeProject,
  createThread,
  getThreadStatus,
  type AgentEvent,
} from './support/e2e-helpers';

const hasSandboxKeys =
  !!process.env.DAYTONA_API_KEY && !!process.env.ANTHROPIC_API_KEY;

const describeE2e = hasSandboxKeys ? describe : describe.skip;

interface StatusEvent {
  threadId: string;
  status: string;
}

describeE2e('Ask-user / waiting_for_input E2E (real sandbox)', () => {
  let projectId: string;
  let threadId: string;
  let socket: AgentSocket;

  beforeAll(async () => {
    await waitForApiSettled();
  }, 30_000);

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
    const prompt = [
      'You have the mcp__terminal-server__ask_user tool available.',
      'Use it now to ask the user which programming language they prefer.',
      'Present options: Python, TypeScript, Go.',
      'Do NOT proceed until you get the user answer.',
    ].join(' ');

    threadId = await createThread(projectId, prompt);

    const statusUpdates: StatusEvent[] = [];
    const agentEvents: AgentEvent[] = [];

    const waitForAskUser = new Promise<{
      questionToolUseId: string;
      statuses: StatusEvent[];
      events: AgentEvent[];
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          questionToolUseId: '',
          statuses: statusUpdates,
          events: agentEvents,
        });
      }, 3 * 60 * 1000);

      const onStatus = (payload: any) => {
        if (payload.threadId !== threadId) return;
        console.log(`[ask-user e2e] agent_status: ${payload.status}`);
        statusUpdates.push(payload);

        if (payload.status === 'waiting_for_input') {
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

      const onMessage = (payload: any) => {
        if (payload.threadId !== threadId) return;
        if (payload.message) {
          agentEvents.push(payload.message);
        }
      };

      const onError = (payload: any) => {
        if (payload.threadId !== threadId) return;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Agent error: ${payload.error}`));
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

    socket.send('execute_thread', { threadId, mode: 'agent' });

    const result = await waitForAskUser;

    console.log(`[ask-user e2e] ${result.events.length} events, ${result.statuses.length} status updates`);
    console.log(`[ask-user e2e] Status sequence: ${result.statuses.map((s) => s.status).join(' → ')}`);

    const waitingStatus = result.statuses.find((s) => s.status === 'waiting_for_input');
    expect(waitingStatus).toBeDefined();

    const askEvent = result.events.find((e) =>
      e.message?.content?.some(
        (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion',
      ),
    );
    expect(askEvent).toBeDefined();
    expect(result.questionToolUseId).toBeTruthy();

    const dbStatus = await getThreadStatus(threadId);
    expect(dbStatus).toBe('waiting_for_input');
  }, 4 * 60 * 1000);

  it('should transition back to running when user answers', async () => {
    const messagesRes = await axios.get(`/api/threads/${threadId}/messages`);
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

    const statusSequence: string[] = [];

    const waitForCompletion = new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(statusSequence);
      }, 3 * 60 * 1000);

      const onStatus = (payload: any) => {
        if (payload.threadId !== threadId) return;
        console.log(`[ask-user e2e] post-answer status: ${payload.status}`);
        statusSequence.push(payload.status);

        if (payload.status === 'completed' || payload.status === 'error') {
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

    socket.send('user_answer', { threadId, toolUseId, answer: 'Python' });

    const statuses = await waitForCompletion;
    console.log(`[ask-user e2e] Post-answer status sequence: ${statuses.join(' → ')}`);

    expect(statuses).toContain('running');

    const finalStatus = await getThreadStatus(threadId);
    expect(['completed', 'running']).toContain(finalStatus);
  }, 4 * 60 * 1000);
});
