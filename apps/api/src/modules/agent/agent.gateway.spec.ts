/**
 * Test that the agent auto-restarts when it stops responding (timeout).
 *
 * Simulates a crash/hang by using a mock SandboxManager that never emits
 * any messages. After the initial timeout, the gateway should auto-retry
 * by calling sendPrompt again.
 *
 * Run with: APEX_TEST_AGENT_TIMEOUT_MS=100 npx vitest run apps/api
 */
import { EventEmitter } from 'events';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentGateway } from './agent.gateway';
import type { ProjectsService } from '../projects/projects.service';
import type { ProjectsGateway } from '../projects/projects.gateway';
import type { ChatsService } from '../tasks/tasks.service';

describe('Agent auto-restart on timeout', () => {
  const TEST_TIMEOUT_MS = 100;
  const CHAT_ID = 'chat-123';
  const PROJECT_ID = 'proj-456';
  const SANDBOX_ID = 'sandbox-789';

  let mockManager: EventEmitter & { sendPrompt: ReturnType<typeof vi.fn> };
  let projectsService: { getSandboxManager: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let chatsService: {
    findById: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    updateClaudeSessionId: ReturnType<typeof vi.fn>;
  };
  let gateway: AgentGateway;
  let mockClient: { id: string; emit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.APEX_TEST_AGENT_TIMEOUT_MS = String(TEST_TIMEOUT_MS);

    mockManager = Object.assign(new EventEmitter(), {
      sendPrompt: vi.fn().mockResolvedValue(undefined),
      registerProjectName: vi.fn(),
      removeListener: vi.fn(function (this: EventEmitter, event: string, handler: () => void) {
        return EventEmitter.prototype.removeListener.call(this, event, handler);
      }),
      on: vi.fn(function (this: EventEmitter, event: string, handler: () => void) {
        return EventEmitter.prototype.on.call(this, event, handler);
      }),
    });

    projectsService = {
      getSandboxManager: vi.fn().mockReturnValue(mockManager),
      findById: vi.fn().mockResolvedValue({
        id: PROJECT_ID,
        sandboxId: SANDBOX_ID,
        name: 'test-project',
      }),
    };

    chatsService = {
      findById: vi.fn().mockResolvedValue({
        id: CHAT_ID,
        projectId: PROJECT_ID,
        claudeSessionId: null,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      }),
      updateStatus: vi.fn().mockResolvedValue({}),
      addMessage: vi.fn().mockResolvedValue({}),
      updateClaudeSessionId: vi.fn().mockResolvedValue(undefined),
    };

    const projectsGateway = {
      notifyUpdated: vi.fn(),
    };

    gateway = new AgentGateway(
      projectsService as unknown as ProjectsService,
      projectsGateway as unknown as ProjectsGateway,
      chatsService as unknown as ChatsService,
    );

    // Simulate sandbox subscribers so emitToSubscribers works
    (gateway as any).sandboxSubscribers.set(SANDBOX_ID, new Set(['client-1']));
    const emitMock = vi.fn();
    (gateway as any).server = { to: vi.fn().mockReturnValue({ emit: emitMock }) };

    mockClient = {
      id: 'client-1',
      emit: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.APEX_TEST_AGENT_TIMEOUT_MS;
  });

  it('should auto-retry when agent times out (no activity)', async () => {
    await gateway.handleSendPrompt(
      mockClient as any,
      { chatId: CHAT_ID, prompt: 'Hello', mode: 'agent' },
    );

    expect(mockManager.sendPrompt).toHaveBeenCalledTimes(1);
    expect(mockManager.sendPrompt).toHaveBeenCalledWith(
      SANDBOX_ID,
      'Hello',
      CHAT_ID,
      null,
      'agent',
      undefined,
    );

    // Advance past the initial timeout - gateway should retry
    await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS + 50);

    // Should have called sendPrompt again (retry)
    expect(mockManager.sendPrompt).toHaveBeenCalledTimes(2);
    expect(mockManager.sendPrompt).toHaveBeenLastCalledWith(
      SANDBOX_ID,
      'Hello', // No session yet, so same prompt
      CHAT_ID,
      null,
      'agent',
      undefined,
    );
  });

  it('should emit agent_error after retry also fails', async () => {
    await gateway.handleSendPrompt(
      mockClient as any,
      { chatId: CHAT_ID, prompt: 'Hello', mode: 'agent' },
    );

    // First timeout - triggers retry
    await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS + 50);
    expect(mockManager.sendPrompt).toHaveBeenCalledTimes(2);

    // Second timeout - should emit agent_error (no more retries)
    await vi.advanceTimersByTimeAsync(300_000 + 50); // AGENT_ACTIVITY_TIMEOUT_MS

    expect(chatsService.updateStatus).toHaveBeenCalledWith(CHAT_ID, 'error');
    const emitMock = (gateway as any).server.to().emit;
    const agentErrorCall = emitMock.mock.calls.find((c: unknown[]) => c[0] === 'agent_error');
    expect(agentErrorCall).toBeDefined();
    expect(agentErrorCall[1]).toMatchObject({ chatId: CHAT_ID });
    // Error text varies: "Agent stopped responding" (after first msg) or "Agent did not respond within" (no response)
    expect(agentErrorCall[1].error).toMatch(/Agent (stopped responding|did not respond)/);
  });

  it('should auto-retry when agent crashes (claude_exit code !== 0)', async () => {
    await gateway.handleSendPrompt(
      mockClient as any,
      { chatId: CHAT_ID, prompt: 'Hello', mode: 'agent' },
    );

    expect(mockManager.sendPrompt).toHaveBeenCalledTimes(1);

    // Simulate first message so receivedFirstMessage is true (manager emits 'message')
    mockManager.emit('message', SANDBOX_ID, {
      type: 'claude_message',
      chatId: CHAT_ID,
      data: { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
    });

    // Simulate crash (claude_exit with non-zero code)
    mockManager.emit('message', SANDBOX_ID, {
      type: 'claude_exit',
      chatId: CHAT_ID,
      code: 1,
    });

    // Allow async retry to complete
    await vi.advanceTimersByTimeAsync(0);

    // Should have retried
    expect(mockManager.sendPrompt).toHaveBeenCalledTimes(2);
    expect(mockManager.sendPrompt).toHaveBeenLastCalledWith(
      SANDBOX_ID,
      'Continue from where you left off. You had crashed and were restarted.',
      CHAT_ID,
      null,
      'agent',
      undefined,
    );
  });
});
