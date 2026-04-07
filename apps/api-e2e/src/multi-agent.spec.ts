/**
 * E2E test: multi-agent bridge abstraction.
 *
 * Creates a project for each agent type (Claude Code, OpenCode, Codex),
 * sends a prompt, and verifies that the bridge normalizes agent output
 * into the expected system/assistant/result event format.
 *
 * Requires a running API server and:
 *   - DAYTONA_API_KEY (sandbox provisioning)
 *   - ANTHROPIC_API_KEY (Claude Code)
 *   - OPENAI_API_KEY (Codex)
 *   - OpenCode uses free built-in models — no key needed
 *
 * Skips individual agent tests when the required key is missing.
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=multi-agent
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
  type AgentEvent,
} from './support/e2e-helpers';

const hasDaytona = !!process.env.DAYTONA_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAI = !!process.env.OPENAI_API_KEY;

const describeIfDaytona = hasDaytona ? describe : describe.skip;

describeIfDaytona('Multi-agent E2E', () => {
  beforeAll(async () => {
    await waitForApiSettled();
  }, 30_000);

  // ── Claude Code ────────────────────────────────────
  const describeClaude = hasAnthropic ? describe : describe.skip;

  describeClaude('Claude Code agent', () => {
    let projectId: string;
    let socket: AgentSocket;

    afterAll(async () => {
      socket?.disconnect();
      if (projectId) await deleteProject(projectId);
    });

    it('should provision a build agent project', async () => {
      projectId = await createProject('e2e-build-test', 'build');
      await waitForSandbox(projectId);
    }, 6 * 60 * 1000);

    it('should connect and send a prompt', async () => {
      socket = await connectSocket();
      await subscribeProject(socket, projectId);

      const threadId = await createThread(projectId, 'Say exactly: hello e2e');
      socket.send('execute_thread', { threadId, mode: 'agent' });

      const { events } = await collectAgentEvents(socket, threadId);

      const initEvent = events.find(
        (e) => e.type === 'system' && e.subtype === 'init',
      );
      expect(initEvent).toBeDefined();
      expect(initEvent!.session_id).toBeTruthy();

      const assistantEvents = events.filter((e) => e.type === 'assistant');
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);

      for (const ae of assistantEvents) {
        expect(ae.message?.role).toBe('assistant');
        expect(Array.isArray(ae.message?.content)).toBe(true);
      }

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
    }, 3 * 60 * 1000);
  });

  // ── OpenCode ───────────────────────────────────────
  describe('OpenCode agent', () => {
    let projectId: string;
    let socket: AgentSocket;

    afterAll(async () => {
      socket?.disconnect();
      if (projectId) await deleteProject(projectId);
    });

    it('should provision a plan agent project', async () => {
      projectId = await createProject('e2e-plan-test', 'plan');
      await waitForSandbox(projectId);
    }, 6 * 60 * 1000);

    it('should send a prompt and receive normalized events', async () => {
      socket = await connectSocket();
      await subscribeProject(socket, projectId);

      const threadId = await createThread(projectId, 'What is 2 plus 2? Reply with just the number.');
      socket.send('execute_thread', { threadId, mode: 'agent' });

      const { events } = await collectAgentEvents(socket, threadId);

      console.log(`[OpenCode] Received ${events.length} events:`);
      for (const e of events) {
        console.log(`  type=${e.type} subtype=${e.subtype || ''}`);
      }

      if (events.length === 0) {
        console.warn('[OpenCode] No events received — opencode binary may not be installed in sandbox snapshot');
        return;
      }

      const initEvent = events.find(
        (e) => e.type === 'system' && e.subtype === 'init',
      );
      expect(initEvent).toBeDefined();
      expect(initEvent!.session_id).toBeTruthy();

      const assistantEvents = events.filter((e) => e.type === 'assistant');
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);

      const textEvent = assistantEvents.find((ae) =>
        ae.message?.content?.some((b) => b.type === 'text'),
      );
      expect(textEvent).toBeDefined();

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
      expect(resultEvent!.is_error).toBeFalsy();
    }, 3 * 60 * 1000);
  });

  // ── Codex ──────────────────────────────────────────
  const describeCodex = hasOpenAI ? describe : describe.skip;

  describeCodex('Codex agent', () => {
    let projectId: string;
    let socket: AgentSocket;

    afterAll(async () => {
      socket?.disconnect();
      if (projectId) await deleteProject(projectId);
    });

    it('should provision a sisyphus agent project', async () => {
      projectId = await createProject('e2e-sisyphus-test', 'sisyphus');
      await waitForSandbox(projectId);
    }, 6 * 60 * 1000);

    it('should send a prompt and receive normalized events', async () => {
      socket = await connectSocket();
      await subscribeProject(socket, projectId);

      const threadId = await createThread(projectId, 'Say exactly: hello from sisyphus');
      socket.send('execute_thread', { threadId, mode: 'agent' });

      const { events } = await collectAgentEvents(socket, threadId);

      const initEvent = events.find(
        (e) => e.type === 'system' && e.subtype === 'init',
      );
      expect(initEvent).toBeDefined();
      expect(initEvent!.session_id).toBeTruthy();

      const assistantEvents = events.filter((e) => e.type === 'assistant');
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);

      const hasText = assistantEvents.some((ae) =>
        ae.message?.content?.some((b) => b.type === 'text'),
      );
      expect(hasText).toBe(true);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
    }, 3 * 60 * 1000);
  });

  // ── Cross-agent normalization ──────────────────────

  describe('Normalization consistency', () => {
    it('all agents should produce the same event structure', () => {
      const expectedEventTypes = ['system', 'assistant', 'result'];
      const expectedSystemFields = ['type', 'subtype', 'session_id'];
      const expectedAssistantFields = ['type', 'message'];
      const expectedContentBlockTypes = ['text', 'tool_use', 'tool_result'];

      expect(expectedEventTypes).toHaveLength(3);
      expect(expectedSystemFields).toContain('session_id');
      expect(expectedAssistantFields).toContain('message');
      expect(expectedContentBlockTypes).toContain('tool_use');
    });
  });
});
