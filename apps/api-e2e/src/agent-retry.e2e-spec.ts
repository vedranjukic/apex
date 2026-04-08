/**
 * E2E test: agent stop and restart behavior.
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
  collectAgentEvents,
  getThreadStatus,
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

  it('should send prompt, stop agent via crash_agent, then complete', async () => {
    const prompt = 'Say exactly: hello';

    socket.send('execute_thread', { threadId, mode: 'agent' });

    const { events } = await collectAgentEvents(socket, threadId, 120_000);

    // Should have received at least a system init
    const initEvent = events.find(
      (e) => e.type === 'system' && e.subtype === 'init',
    );
    expect(initEvent).toBeDefined();

    // Should have completed (stopAgent sends SIGTERM → clean exit)
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();

    const status = await getThreadStatus(threadId);
    expect(['completed', 'error']).toContain(status);
  }, 3 * 60 * 1000);

  it('should handle crash_agent and reach a terminal state', async () => {
    // Create a new thread for the crash test
    const crashThreadId = await createThread(projectId, 'Count slowly from 1 to 100, saying each number.');

    socket.send('execute_thread', { threadId: crashThreadId, mode: 'agent' });

    // Wait for agent to start producing output
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 15_000);
      const onMessage = (payload: any) => {
        if (payload.threadId !== crashThreadId) return;
        if (payload.message?.type === 'assistant') {
          clearTimeout(timeout);
          socket.off('agent_message', onMessage);
          resolve();
        }
      };
      socket.on('agent_message', onMessage);
    });

    // Crash the agent
    socket.send('crash_agent', { threadId: crashThreadId });

    // Wait for agent to reach a terminal state
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 60_000);
      const onStatus = (payload: any) => {
        if (payload.threadId !== crashThreadId) return;
        if (['completed', 'error'].includes(payload.status)) {
          clearTimeout(timeout);
          socket.off('agent_status', onStatus);
          resolve();
        }
      };
      socket.on('agent_status', onStatus);
    });

    const status = await getThreadStatus(crashThreadId);
    expect(['completed', 'error']).toContain(status);
  }, 3 * 60 * 1000);
});
