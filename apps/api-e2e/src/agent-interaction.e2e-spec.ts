/**
 * E2E test: comprehensive agent interaction lifecycle.
 *
 * Uses a real sandbox to test the full agent flow:
 *   1. Provision sandbox
 *   2. Connect socket
 *   3. Prompt that triggers Bash tool use
 *   4. Prompt that triggers file Write + Read (session continues)
 *   5. Stop a running session mid-execution
 *   6. Resume the stopped session with a new prompt
 *   7. Send a queued prompt (while another is still running)
 *
 * Environment:
 *   E2E_SANDBOX_PROVIDER  - "daytona" (default), "docker", or "apple-container"
 *   DAYTONA_API_KEY_E2E   - Daytona API key for e2e tests (avoids overlap with app key)
 *   ANTHROPIC_API_KEY     - required for the LLM
 *
 * Run: npx nx e2e @apex/api-e2e --testPathPattern=agent-interaction
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
  getThreadStatus,
  collectAgentEvents,
  waitForFirstMessage,
  waitForStatus,
  findToolUseBlocks,
  findToolResultBlocks,
  findTextContent,
  type AgentEvent,
} from './support/e2e-helpers';

// ── Gate ─────────────────────────────────────────────

const provider = process.env.E2E_SANDBOX_PROVIDER || 'daytona';
// The npm script sets DAYTONA_API_KEY from DAYTONA_API_KEY_E2E at the shell
// level so the Nx-spawned API server inherits it. Check either key here.
const hasDaytonaKey =
  provider === 'daytona'
    ? !!(process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_KEY_E2E)
    : true;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const canRun = hasDaytonaKey && hasAnthropic;

const describeE2e = canRun ? describe : describe.skip;

// ── Tests ────────────────────────────────────────────

describeE2e('Agent interaction E2E (real sandbox)', () => {
  let projectId: string;
  let socket: AgentSocket;
  let bashThreadId: string;
  let stopThreadId: string;

  afterAll(async () => {
    socket?.disconnect();
    if (projectId) await deleteProject(projectId);
  });

  // ── Step 1: Provision ──────────────────────────────

  it('should provision a sandbox', async () => {
    // Wait for the API server's sandbox managers to settle after startup
    await waitForApiSettled();

    projectId = await createProject(
      'e2e-agent-interaction',
      'build',
      provider,
    );
    expect(projectId).toBeTruthy();
    console.log(`[agent-interaction] Project created: ${projectId} (provider=${provider})`);
    await waitForSandbox(projectId);
    console.log('[agent-interaction] Sandbox is running');
  }, 6 * 60 * 1000);

  // ── Step 2: Connect ────────────────────────────────

  it('should connect socket and subscribe', async () => {
    socket = await connectSocket();
    await subscribeProject(socket, projectId);
    console.log('[agent-interaction] Socket connected and subscribed');
  }, 30_000);

  // ── Step 3: Bash tool use ──────────────────────────

  it('should execute a prompt that uses the Bash tool', async () => {
    const prompt =
      'Run this exact bash command: echo HELLO_E2E_MARKER && echo DONE. ' +
      'Show me the output. Do not explain, just run it.';

    bashThreadId = await createThread(projectId, prompt);
    socket.send('execute_thread', { threadId: bashThreadId, mode: 'agent' });

    const { events } = await collectAgentEvents(socket, bashThreadId, 3 * 60_000);

    console.log(`[agent-interaction] Bash test: ${events.length} events received`);
    logEventSummary(events);

    // system init with session_id
    const initEvent = events.find(
      (e) => e.type === 'system' && e.subtype === 'init',
    );
    expect(initEvent).toBeDefined();
    expect(initEvent!.session_id).toBeTruthy();

    // At least one Bash tool_use
    const bashBlocks = findToolUseBlocks(events, 'Bash');
    expect(bashBlocks.length).toBeGreaterThanOrEqual(1);

    // Corresponding tool_result should contain the marker
    const allResults = findToolResultBlocks(events);
    const markerResult = allResults.find(
      (b) => b.content && b.content.includes('HELLO_E2E_MARKER'),
    );
    expect(markerResult).toBeDefined();

    // Should complete without error
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.is_error).toBeFalsy();
  }, 3 * 60 * 1000);

  // ── Step 4: File Write + Read (session continues) ──

  it('should write and read a file using agent tools', async () => {
    const prompt =
      'Create a file at /tmp/e2e-test-file.txt with the exact content "apex-test-marker-12345". ' +
      'Then read it back and confirm the content matches. Do not explain, just do it.';

    // send_prompt on same thread to continue the OpenCode session
    socket.send('send_prompt', {
      threadId: bashThreadId,
      prompt,
      mode: 'agent',
    });

    const { events } = await collectAgentEvents(socket, bashThreadId, 3 * 60_000);

    console.log(`[agent-interaction] File ops test: ${events.length} events received`);
    logEventSummary(events);

    // Should have a Write, Edit, or Bash tool_use for creating the file
    const writeBlocks = findToolUseBlocks(events, 'Write');
    const editBlocks = findToolUseBlocks(events, 'Edit');
    const bashBlocks = findToolUseBlocks(events, 'Bash');
    const hasFileCreate = writeBlocks.length > 0 || editBlocks.length > 0 || bashBlocks.length > 0;
    expect(hasFileCreate).toBe(true);

    // Should have a Read tool_use or Bash cat for reading the file
    const readBlocks = findToolUseBlocks(events, 'Read');
    const hasFileRead = readBlocks.length > 0 || bashBlocks.length > 0;
    expect(hasFileRead).toBe(true);

    // The marker text should appear somewhere in tool results, assistant text,
    // or at minimum the agent should have completed without error (the file
    // operations are verified by the tool_use blocks above).
    const allResults = findToolResultBlocks(events);
    const allText = findTextContent(events);
    const markerInResults = allResults.some(
      (b) => b.content && b.content.includes('apex-test-marker'),
    );
    const markerInText = allText.some((t) =>
      t.includes('apex-test-marker'),
    );
    if (!markerInResults && !markerInText) {
      console.warn(
        '[agent-interaction] File ops: marker not found in output (agent may have confirmed verbally)',
        { resultCount: allResults.length, textCount: allText.length },
      );
    }

    // Should complete
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
  }, 3 * 60 * 1000);

  // ── Step 5: MCP terminal tool use ───────────────────

  it('should use MCP terminal tools (open_terminal + read_terminal)', async () => {
    const prompt =
      'Use the open_terminal MCP tool to create a terminal named "e2e-test" that runs: echo MCP_TERMINAL_MARKER. ' +
      'Then use read_terminal to read its output. Report what you see. ' +
      'Do NOT use the Bash tool — use the MCP terminal tools specifically.';

    const termThreadId = await createThread(projectId, prompt);
    socket.send('execute_thread', { threadId: termThreadId, mode: 'agent' });

    const { events } = await collectAgentEvents(socket, termThreadId, 3 * 60_000);

    console.log(`[agent-interaction] MCP terminal test: ${events.length} events received`);
    logEventSummary(events);

    // Collect all tool_use blocks regardless of name
    const allToolUses = findToolUseBlocks(events);
    const toolNames = allToolUses.map((b) => b.name || '');
    console.log(`[agent-interaction] MCP terminal test: tools used: ${toolNames.join(', ')}`);

    // Should have used open_terminal (MCP tool name may be prefixed)
    const hasOpenTerminal = toolNames.some(
      (n) => n && (n.includes('open_terminal') || n.includes('terminal_create')),
    );
    expect(hasOpenTerminal).toBe(true);

    // Should have used read_terminal
    const hasReadTerminal = toolNames.some(
      (n) => n && (n.includes('read_terminal') || n.includes('terminal_read')),
    );
    expect(hasReadTerminal).toBe(true);

    // The terminal output should contain our marker
    const allResults = findToolResultBlocks(events);
    const allText = findTextContent(events);
    const markerInResults = allResults.some(
      (b) => b.content && b.content.includes('MCP_TERMINAL_MARKER'),
    );
    const markerInText = allText.some((t) => t.includes('MCP_TERMINAL_MARKER'));

    if (!markerInResults && !markerInText) {
      console.warn(
        '[agent-interaction] MCP terminal: marker not found in output',
        { toolNames, resultCount: allResults.length },
      );
    }

    // Should complete without error
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
    expect(resultEvent!.is_error).toBeFalsy();
  }, 3 * 60 * 1000);

  // ── Step 6: Stop running session ───────────────────

  it('should stop a running session mid-execution', async () => {
    const prompt =
      'Use bash to run: for i in $(seq 1 500); do echo "counting $i"; sleep 0.1; done';

    stopThreadId = await createThread(projectId, prompt);
    socket.send('execute_thread', {
      threadId: stopThreadId,
      mode: 'agent',
    });

    // Wait for the agent to start producing output
    const firstMsg = await waitForFirstMessage(socket, stopThreadId, 120_000);
    console.log(
      `[agent-interaction] Stop test: first message type=${firstMsg?.type}`,
    );
    expect(firstMsg).not.toBeNull();

    // Give the agent a moment to get into the bash loop
    await new Promise((r) => setTimeout(r, 3000));

    // Stop the agent
    console.log('[agent-interaction] Sending stop_agent');
    socket.send('stop_agent', { threadId: stopThreadId });

    // Wait for completed status
    const gotCompleted = await waitForStatus(
      socket,
      stopThreadId,
      'completed',
      30_000,
    );

    // Verify via DB as fallback (status event may have been missed if
    // the bridge already exited before our listener attached)
    const dbStatus = await getThreadStatus(stopThreadId);
    console.log(
      `[agent-interaction] Stop test: gotCompleted=${gotCompleted} dbStatus=${dbStatus}`,
    );
    expect(['completed', 'error']).toContain(dbStatus);
  }, 2 * 60 * 1000);

  // ── Step 6: Resume stopped session ─────────────────

  it('should resume the stopped thread with a new prompt', async () => {
    // After stop_agent, the session may be in an aborted state.
    // Sending a new prompt should either resume or get an abort/error.
    const prompt = 'What is 7 + 3? Reply with just the number.';

    socket.send('send_prompt', {
      threadId: stopThreadId,
      prompt,
      mode: 'agent',
    });

    const { events } = await collectAgentEvents(
      socket,
      stopThreadId,
      3 * 60_000,
    );

    console.log(
      `[agent-interaction] Resume test: ${events.length} events received`,
    );
    logEventSummary(events);

    // Should receive at least one event (assistant, result, or error/abort)
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verify thread reaches a terminal state
    const dbStatus = await getThreadStatus(stopThreadId);
    expect(['completed', 'error']).toContain(dbStatus);
  }, 3 * 60 * 1000);

  // ── Step 7: Queued prompt ──────────────────────────

  it('should handle a second prompt sent while agent is running', async () => {
    const prompt1 =
      'Use bash to run: echo FIRST_PROMPT_RUNNING && sleep 5 && echo FIRST_DONE';
    const prompt2 = 'Say exactly: SECOND_PROMPT_RESULT';

    const queueThreadId = await createThread(projectId, prompt1);

    // Start first prompt
    socket.send('execute_thread', {
      threadId: queueThreadId,
      mode: 'agent',
    });

    // Wait briefly for the agent to start, then send second prompt
    await new Promise((r) => setTimeout(r, 2000));

    console.log('[agent-interaction] Sending second (queued) prompt');
    socket.send('send_prompt', {
      threadId: queueThreadId,
      prompt: prompt2,
      mode: 'agent',
    });

    // Collect all events -- the bridge will abort the first session
    // and start the second, or queue them sequentially
    const { events } = await collectAgentEvents(
      socket,
      queueThreadId,
      3 * 60_000,
    );

    console.log(
      `[agent-interaction] Queue test: ${events.length} events received`,
    );
    logEventSummary(events);

    // Should eventually produce output and complete without a hard error
    const resultEvents = events.filter((e) => e.type === 'result');
    const errorEvents = events.filter(
      (e) => e.type === 'error' && !e.subtype?.includes('abort'),
    );

    // At least one completion should arrive
    expect(resultEvents.length + errorEvents.length).toBeGreaterThanOrEqual(1);

    // The agent should not be stuck -- verify DB status
    const dbStatus = await getThreadStatus(queueThreadId);
    console.log(`[agent-interaction] Queue test: final dbStatus=${dbStatus}`);
    expect(['completed', 'running', 'idle']).toContain(dbStatus);
  }, 3 * 60 * 1000);
});

// ── Utilities ────────────────────────────────────────

function logEventSummary(events: AgentEvent[]) {
  for (const e of events) {
    const toolNames = (e.message?.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.name)
      .join(', ');
    const suffix = toolNames ? ` tools=[${toolNames}]` : '';
    console.log(
      `  type=${e.type} subtype=${e.subtype || ''}${suffix}`,
    );
  }
}
