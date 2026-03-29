import { Elysia } from 'elysia';
import { projectsService, type Project } from '../projects/projects.service';
import { projectsWsBroadcast } from '../projects/projects.ws';
import { threadsService } from '../tasks/tasks.service';
import { BridgeMessage, LayoutData, FileEntry, SearchResult } from '@apex/orchestrator';
import { execFile } from 'child_process';
import { forwardPort, unforwardPort, listForwards } from '../preview/port-forwarder';

const SANDBOX_HOME = '/home/daytona';

function resolveProjectDir(projectName: string | null | undefined, localDir?: string | null): string {
  if (localDir) return localDir;
  if (!projectName) return SANDBOX_HOME;
  const slug = projectName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    || 'project';
  return `${SANDBOX_HOME}/${slug}`;
}

type WsClient = {
  id: string;
  wsSend: (data: string) => void;
};

const sandboxSubscribers = new Map<string, Set<string>>();
const clientMap = new Map<string, WsClient>();
const activeHandlers = new Map<string, (sandboxId: string, msg: BridgeMessage) => void>();
const terminalListenersBySandbox = new Set<string>();
const lastPortsBySandbox = new Map<string, { ports: unknown[] }>();
const activeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const activeHealthChecks = new Map<string, ReturnType<typeof setInterval>>();

let lastAttachedManager: WeakRef<any> | null = null;

const AGENT_INITIAL_TIMEOUT_MS = process.env.APEX_TEST_AGENT_TIMEOUT_MS
  ? parseInt(process.env.APEX_TEST_AGENT_TIMEOUT_MS, 10) : 90_000;
const AGENT_ACTIVITY_TIMEOUT_MS = 300_000;
const HEALTH_CHECK_INTERVAL_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;

function subscribeTo(sandboxId: string, clientId: string) {
  if (!sandboxSubscribers.has(sandboxId)) sandboxSubscribers.set(sandboxId, new Set());
  sandboxSubscribers.get(sandboxId)!.add(clientId);
}

function emitToSubscribers(sandboxId: string, type: string, payload: unknown) {
  const subs = sandboxSubscribers.get(sandboxId);
  if (!subs) return;
  const msg = JSON.stringify({ type, payload });
  for (const clientId of subs) {
    const client = clientMap.get(clientId);
    if (client) {
      try { client.wsSend(msg); } catch { /* ignore */ }
    }
  }
}

function emitTo(client: WsClient, type: string, payload: unknown) {
  try { client.wsSend(JSON.stringify({ type, payload })); } catch { /* ignore */ }
}

async function updateThreadStatusAndNotify(threadId: string, status: string) {
  const thread = await threadsService.updateStatus(threadId, status);
  try {
    const project = await projectsService.findById(thread.projectId);
    projectsWsBroadcast('project_updated', project);
  } catch { /* ignore */ }
}

async function resolveDirName(project: { name: string; forkedFromId: string | null }): Promise<string> {
  if (!project.forkedFromId) return project.name;
  try {
    const root = await projectsService.findById(project.forkedFromId);
    return root.name;
  } catch {
    return project.name;
  }
}

async function tryResolveProject(projectId: string) {
  try {
    const project = await projectsService.findById(projectId);
    if (!project.sandboxId) return null;
    let manager = projectsService.getSandboxManager(project.provider);
    if (!manager) {
      await projectsService.reinitSandboxManager();
      manager = projectsService.getSandboxManager(project.provider);
    }
    if (!manager) return null;
    return { sandboxId: project.sandboxId, manager, project };
  } catch {
    return null;
  }
}

function resolveDefaultBranch(repoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['ls-remote', '--symref', repoUrl, 'HEAD'], { timeout: 10_000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const match = stdout.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
      resolve(match ? match[1] : null);
    });
  });
}

function attachTerminalListeners(sandboxId: string, provider?: string) {
  const manager = projectsService.getSandboxManager(provider);
  if (!manager) return;

  if (lastAttachedManager && lastAttachedManager.deref() !== manager) {
    terminalListenersBySandbox.clear();
    lastAttachedManager = new WeakRef(manager);
  } else if (!lastAttachedManager) {
    lastAttachedManager = new WeakRef(manager);
  }

  if (terminalListenersBySandbox.has(sandboxId)) return;
  terminalListenersBySandbox.add(sandboxId);

  manager.on('terminal_created', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'terminal_created', { terminalId: msg.terminalId, name: msg.name });
  });
  manager.on('terminal_output', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'terminal_output', { terminalId: msg.terminalId, data: msg.data });
  });
  manager.on('terminal_exit', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'terminal_exit', { terminalId: msg.terminalId, exitCode: msg.exitCode });
  });
  manager.on('terminal_error', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'terminal_error', { terminalId: msg.terminalId, error: msg.error });
  });
  manager.on('terminal_list', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'terminal_list', { terminals: msg.terminals });
  });
  manager.on('file_changed', (sid: string, dirs: string[]) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'file_changed', { dirs });
  });
  manager.on('ports_update', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    lastPortsBySandbox.set(sandboxId, { ports: msg.ports });
    emitToSubscribers(sandboxId, 'ports_update', { ports: msg.ports });
  });
  manager.on('lsp_response', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'lsp_response', { language: msg.language, jsonrpc: msg.jsonrpc });
  });
  manager.on('lsp_status', (sid: string, msg: any) => {
    if (sid !== sandboxId) return;
    emitToSubscribers(sandboxId, 'lsp_status', { language: msg.language, status: msg.status, error: msg.error });
  });
}

const CONTEXT_DIR = '/tmp/.apex-thread-context';
const CONTEXT_INLINE_MAX_CHARS = 40_000;
const CONTEXT_FILE_RESULT_MAX = 2_000;

function extractToolResultText(block: any): string {
  if (!block.content) return '';
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
      .join('\n');
  }
  return '';
}

function summarizeToolUse(block: any): string {
  const name = block.name || 'unknown';
  const input = block.input;
  if (!input || typeof input !== 'object') return name;
  const key = input.path || input.command || input.file_path || input.query || input.pattern || input.url;
  if (key) return `${name}(${String(key).slice(0, 120)})`;
  return name;
}

function buildConversationContext(threadMessages: { role: string; content: any; metadata?: any }[]): string {
  const parts: string[] = [];
  let totalLen = 0;
  for (let i = threadMessages.length - 1; i >= 0; i--) {
    const msg = threadMessages[i];
    if (msg.role === 'system') continue;
    if (!Array.isArray(msg.content)) continue;
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textBlocks: string[] = [];
    const toolSummaries: string[] = [];
    const toolResults: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolSummaries.push(summarizeToolUse(block));
      } else if (block.type === 'tool_result') {
        const text = extractToolResultText(block);
        if (text) toolResults.push(text.length > 500 ? text.slice(0, 500) + '…' : text);
      }
    }
    if (textBlocks.length === 0 && toolSummaries.length === 0 && toolResults.length === 0) continue;
    let line = `[${role}]: `;
    if (textBlocks.length > 0) line += textBlocks.join('\n');
    if (toolSummaries.length > 0) line += `\n(Tools: ${toolSummaries.join(', ')})`;
    if (toolResults.length > 0) line += `\n(Results: ${toolResults.join(' | ')})`;
    if (totalLen + line.length > CONTEXT_INLINE_MAX_CHARS) {
      parts.push('[... earlier messages truncated ...]');
      break;
    }
    parts.push(line);
    totalLen += line.length;
  }
  return parts.reverse().join('\n\n');
}

function buildContextFileContent(messages: { role: string; content: any; metadata?: any }[]): string {
  const lines: string[] = ['# Thread Conversation History\n'];
  let turnNum = 0;

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (msg.metadata?.numTurns || msg.metadata?.costUsd) {
        lines.push(`---\n*Agent session: ${msg.metadata.numTurns ?? '?'} turns, $${msg.metadata.costUsd?.toFixed(4) ?? '?'}*\n`);
      }
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    turnNum++;
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## Turn ${turnNum} [${role}]\n`);

    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        lines.push(block.text + '\n');
      } else if (block.type === 'tool_use') {
        const name = block.name || 'unknown';
        lines.push(`**Tool: ${name}**`);
        if (block.input && typeof block.input === 'object') {
          const inp = block.input;
          const target = inp.path || inp.command || inp.file_path || inp.query || inp.pattern || inp.url;
          if (target) {
            lines.push(`Target: \`${String(target).slice(0, 300)}\``);
          }
          const inputStr = JSON.stringify(inp, null, 2);
          if (inputStr.length <= 1200) {
            lines.push('```json\n' + inputStr + '\n```');
          } else if (!target) {
            lines.push('```json\n' + inputStr.slice(0, 1000) + '\n... [truncated]\n```');
          }
        }
        lines.push('');
      } else if (block.type === 'tool_result') {
        const text = extractToolResultText(block);
        if (text) {
          const truncated = text.length > CONTEXT_FILE_RESULT_MAX
            ? text.slice(0, CONTEXT_FILE_RESULT_MAX) + '\n... [truncated]'
            : text;
          lines.push('**Result:**\n```\n' + truncated + '\n```\n');
        }
      } else if (block.type === 'image') {
        lines.push('*[image attachment]*\n');
      }
    }
  }

  return lines.join('\n');
}

async function writeThreadContext(
  manager: { createFolder: (sid: string, dir: string) => Promise<void>; writeFile: (sid: string, path: string, content: string) => Promise<void> },
  sandboxId: string,
  threadId: string,
  messages: any[],
): Promise<string> {
  const filePath = `${CONTEXT_DIR}/${threadId}.md`;
  const content = buildContextFileContent(messages);
  try {
    await manager.createFolder(sandboxId, CONTEXT_DIR);
    await manager.writeFile(sandboxId, filePath, content);
  } catch (err) {
    console.warn(`[agent-ws] Failed to write context file for ${threadId.slice(0, 8)}:`, err);
  }
  return filePath;
}

function contextFileHint(filePath: string): string {
  return `\n\nIMPORTANT: Full conversation history from this thread is saved at ${filePath} — read it to restore complete context of prior work.`;
}

async function executeAgainstSandbox(
  client: WsClient, threadId: string, prompt: string, mode?: string, model?: string,
  images?: { type: 'base64'; media_type: string; data: string }[],
) {
  const thread = await threadsService.findById(threadId);
  const project = await projectsService.findById(thread.projectId);
  const effectiveAgentType = thread.agentType ?? project.agentType;
  mode = mode ?? thread.mode ?? undefined;
  model = model ?? thread.model ?? undefined;

  if (!process.env.ANTHROPIC_API_KEY) {
    emitTo(client, 'agent_error', {
      threadId,
      error: 'ANTHROPIC_API_KEY is not configured. Go to Settings to add your API key.',
    });
    await updateThreadStatusAndNotify(threadId, 'error');
    return;
  }

  if (!project.sandboxId) {
    emitTo(client, 'agent_error', { threadId, error: 'Project sandbox not ready' });
    return;
  }
  const manager = projectsService.getSandboxManager(project.provider);
  if (!manager) {
    emitTo(client, 'agent_error', { threadId, error: 'Sandbox manager not available' });
    return;
  }

  manager.registerProjectName(project.sandboxId, project.name);
  manager.registerProjectId(project.sandboxId, project.id);
  subscribeTo(project.sandboxId, client.id);

  await updateThreadStatusAndNotify(threadId, 'running');
  emitToSubscribers(project.sandboxId, 'agent_status', { threadId, status: 'running' });

  const prevHandler = activeHandlers.get(threadId);
  if (prevHandler) { manager.removeListener('message', prevHandler); activeHandlers.delete(threadId); }
  const prevTimeout = activeTimeouts.get(threadId);
  if (prevTimeout) clearTimeout(prevTimeout);

  const stderrChunks: string[] = [];
  let receivedFirstMessage = false;
  let retryCount = 0;

  const buildRetryPrompt = async (reason: string): Promise<string> => {
    const freshThread = await threadsService.findById(threadId);
    const allMessages = freshThread.messages || [];
    let resumeText = receivedFirstMessage
      ? `Continue from where you left off. ${reason}`
      : prompt;
    if (allMessages.length > 0) {
      try {
        const ctxPath = await writeThreadContext(manager, project.sandboxId!, threadId, allMessages);
        resumeText += contextFileHint(ctxPath);
      } catch { /* best-effort */ }
    }
    return resumeText;
  };

  const cleanupHandler = () => {
    manager.removeListener('message', messageHandler);
    activeHandlers.delete(threadId);
    const t = activeTimeouts.get(threadId);
    if (t) { clearTimeout(t); activeTimeouts.delete(threadId); }
    const hc = activeHealthChecks.get(threadId);
    if (hc) { clearInterval(hc); activeHealthChecks.delete(threadId); }
  };

  const resetTimeout = (timeoutMs: number) => {
    const prev = activeTimeouts.get(threadId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(async () => {
      if (retryCount < 1) {
        retryCount++;
        emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: 'retrying' });
        emitToSubscribers(project.sandboxId!, 'agent_message', {
          threadId, message: { type: 'system', subtype: 'retry', text: 'Agent stopped responding. Restarting with fresh session…' },
        });
        try {
          await threadsService.updateClaudeSessionId(threadId, null);
          const resumePrompt = await buildRetryPrompt('You had stopped responding after a long pause.');
          await manager.sendPrompt(project.sandboxId!, resumePrompt, threadId,
            null, mode, model, effectiveAgentType, true);
          receivedFirstMessage = false;
          resetTimeout(AGENT_INITIAL_TIMEOUT_MS);
          return;
        } catch { /* retry failed */ }
      }
      cleanupHandler();
      const stderrHint = stderrChunks.length ? `\n\nCLI stderr output:\n${stderrChunks.join('').slice(0, 500)}` : '';
      const errorMsg = receivedFirstMessage
        ? `Agent stopped responding (no activity for ${Math.round(timeoutMs / 1000)}s)${stderrHint}`
        : `Agent did not respond within ${Math.round(timeoutMs / 1000)}s${stderrHint}`;
      await updateThreadStatusAndNotify(threadId, 'error');
      emitToSubscribers(project.sandboxId!, 'agent_error', { threadId, error: errorMsg });
    }, timeoutMs);
    activeTimeouts.set(threadId, timer);
  };

  resetTimeout(AGENT_INITIAL_TIMEOUT_MS);

  const prevHealthCheck = activeHealthChecks.get(threadId);
  if (prevHealthCheck) clearInterval(prevHealthCheck);

  const startHealthCheck = () => {
    const hc = activeHealthChecks.get(threadId);
    if (hc) clearInterval(hc);
    const interval = setInterval(async () => {
      if (!project.sandboxId || !manager.isBridgeConnected(project.sandboxId)) {
        console.log(`[agent-ws] Bridge disconnected for thread ${threadId.slice(0, 8)}, triggering reconnect + retry`);
        clearInterval(interval);
        activeHealthChecks.delete(threadId);
        const prev = activeTimeouts.get(threadId);
        if (prev) { clearTimeout(prev); activeTimeouts.delete(threadId); }

        if (retryCount < 1) {
          retryCount++;
          emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: 'retrying' });
          emitToSubscribers(project.sandboxId!, 'agent_message', {
            threadId, message: { type: 'system', subtype: 'retry', text: 'Lost connection to sandbox. Reconnecting with fresh session…' },
          });
          try {
            await threadsService.updateClaudeSessionId(threadId, null);
            const resumePrompt = await buildRetryPrompt('The sandbox connection was lost and restored.');
            await manager.sendPrompt(project.sandboxId!, resumePrompt, threadId,
              null, mode, model, effectiveAgentType, true);
            receivedFirstMessage = false;
            resetTimeout(AGENT_INITIAL_TIMEOUT_MS);
            startHealthCheck();
            return;
          } catch (err) {
            console.error(`[agent-ws] Reconnect retry failed for ${threadId.slice(0, 8)}:`, err);
          }
        }
        cleanupHandler();
        await updateThreadStatusAndNotify(threadId, 'error');
        emitToSubscribers(project.sandboxId!, 'agent_error', {
          threadId, error: 'Lost connection to sandbox and could not recover.',
        });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    activeHealthChecks.set(threadId, interval);
  };
  startHealthCheck();

  const messageHandler = async (sandboxId: string, msg: BridgeMessage) => {
    if (sandboxId !== project.sandboxId) return;
    const msgThreadId = (msg as any).threadId;
    if (msgThreadId && msgThreadId !== threadId) return;

    if (msg.type === 'claude_stderr') {
      stderrChunks.push((msg as any).data || '');
      resetTimeout(AGENT_ACTIVITY_TIMEOUT_MS);
      return;
    }

    if (msg.type === 'claude_message') {
      receivedFirstMessage = true;
      resetTimeout(AGENT_ACTIVITY_TIMEOUT_MS);
      const data = msg.data as any;

      if (data.type === 'system' && data.subtype === 'init' && data.session_id && !thread.claudeSessionId) {
        await threadsService.updateClaudeSessionId(threadId, data.session_id);
      }

      if (data.type === 'assistant' && data.message?.content) {
        const content = data.message.content as Array<{ type?: string; name?: string }>;
        const isSyntheticAskUser = content.length === 1 && content[0]?.type === 'tool_use' && content[0]?.name === 'AskUserQuestion';
        if (!isSyntheticAskUser) {
          await threadsService.addMessage(threadId, {
            role: 'assistant',
            content: data.message.content,
            metadata: { model: data.message.model, stopReason: data.message.stop_reason, usage: data.message.usage },
          });
        }
      }

      if (data.type === 'user' && data.message?.content?.length) {
        const hasToolResult = data.message.content.some((b: { type?: string }) => b?.type === 'tool_result');
        if (hasToolResult) {
          await threadsService.addMessage(threadId, { role: 'user', content: data.message.content, metadata: null });
        }
      }

      if (data.type === 'result') {
        if (data.session_id && !thread.claudeSessionId) {
          await threadsService.updateClaudeSessionId(threadId, data.session_id);
        }
        await threadsService.addMessage(threadId, {
          role: 'system', content: [],
          metadata: {
            costUsd: data.total_cost_usd, durationMs: data.duration_ms,
            numTurns: data.num_turns, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens,
          },
        });
        const currentThread = await threadsService.findById(threadId);
        if (currentThread.status !== 'waiting_for_input' && currentThread.status !== 'waiting_for_user_action') {
          const finalStatus = data.is_error ? 'error' : 'completed';
          await updateThreadStatusAndNotify(threadId, finalStatus);
          emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: finalStatus });
          cleanupHandler();
        }
      }
      emitToSubscribers(project.sandboxId!, 'agent_message', { threadId, message: msg.data });
    } else if (msg.type === 'claude_exit') {
      const status = msg.code === 0 ? 'completed' : 'error';
      if (status === 'error' && retryCount < 1) {
        retryCount++;
        emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: 'retrying' });
        emitToSubscribers(project.sandboxId!, 'agent_message', {
          threadId, message: { type: 'system', subtype: 'retry', text: 'Agent crashed. Restarting with fresh session…' },
        });
        try {
          await threadsService.updateClaudeSessionId(threadId, null);
          const resumePrompt = await buildRetryPrompt('You had crashed and were restarted.');
          await manager.sendPrompt(project.sandboxId!, resumePrompt, threadId,
            null, mode, model, effectiveAgentType, true);
          receivedFirstMessage = false;
          resetTimeout(AGENT_INITIAL_TIMEOUT_MS);
          return;
        } catch { /* retry failed */ }
      }
      if (status === 'error' && stderrChunks.length) {
        emitToSubscribers(project.sandboxId!, 'agent_error', {
          threadId, error: `Agent exited with code ${msg.code}\n\n${stderrChunks.join('').slice(0, 500)}`,
        });
      }
      const exitThread = await threadsService.findById(threadId);
      if (exitThread.status !== 'waiting_for_input' && exitThread.status !== 'waiting_for_user_action') {
        await updateThreadStatusAndNotify(threadId, status);
        emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status });
        cleanupHandler();
      }
    } else if (msg.type === 'ask_user_pending') {
      await updateThreadStatusAndNotify(threadId, 'waiting_for_input');
      emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: 'waiting_for_input' });
    } else if (msg.type === 'ask_user_resolved') {
      await updateThreadStatusAndNotify(threadId, 'running');
      emitToSubscribers(project.sandboxId!, 'agent_status', { threadId, status: 'running' });
    } else if (msg.type === 'claude_catchup') {
      const blocks = (msg as any).blocks;
      if (Array.isArray(blocks) && blocks.length > 0) {
        try {
          const currentMessages = await threadsService.getMessages(threadId);
          const lastMsg = currentMessages[currentMessages.length - 1];
          const hasGap = lastMsg && (lastMsg.role === 'user' || (lastMsg.role === 'system' && currentMessages.length > 1 && currentMessages[currentMessages.length - 2]?.role === 'user'));
          if (hasGap) {
            await threadsService.addMessage(threadId, { role: 'assistant', content: blocks, metadata: { catchup: true } });
            console.log(`[agent-ws] Saved ${blocks.length} catch-up blocks for thread ${threadId.slice(0, 8)}`);
          }
          emitToSubscribers(project.sandboxId!, 'agent_message', {
            threadId, message: { type: 'assistant', message: { role: 'assistant', model: '', content: blocks, stop_reason: 'end_turn' }, _catchup: true },
          });
        } catch (err) {
          console.warn(`[agent-ws] Catch-up failed for ${threadId.slice(0, 8)}:`, err);
        }
      }
    } else if (msg.type === 'claude_error') {
      await updateThreadStatusAndNotify(threadId, 'error');
      emitToSubscribers(project.sandboxId!, 'agent_error', { threadId, error: msg.error });
      cleanupHandler();
    }
  };

  activeHandlers.set(threadId, messageHandler);
  manager.on('message', messageHandler);

  let effectivePrompt = prompt;
  const priorMessages = (thread.messages || []).slice(0, -1);
  let contextFilePath: string | undefined;
  if (priorMessages.length > 0) {
    const context = buildConversationContext(priorMessages as any);
    if (context) {
      effectivePrompt = `<conversation_history>\n${context}\n</conversation_history>\n\n${prompt}`;
    }
    try {
      contextFilePath = await writeThreadContext(manager, project.sandboxId, threadId, priorMessages);
      effectivePrompt += contextFileHint(contextFilePath);
    } catch { /* best-effort */ }
  }

  try {
    if (!manager.isBridgeConnected(project.sandboxId)) {
      emitToSubscribers(project.sandboxId, 'agent_message', {
        threadId, message: { type: 'system', subtype: 'info', text: 'Reconnecting to sandbox…' },
      });
    }
    await Promise.race([
      manager.sendPrompt(project.sandboxId, effectivePrompt, threadId, thread.claudeSessionId, mode, model, effectiveAgentType as string, undefined, images),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out connecting to sandbox')), SEND_TIMEOUT_MS)),
    ]);
    emitTo(client, 'prompt_accepted', { threadId });
  } catch (err) {
    cleanupHandler();
    await updateThreadStatusAndNotify(threadId, 'error');
    emitTo(client, 'agent_error', { threadId, error: `Failed to send to sandbox: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleMessage(client: WsClient, message: unknown) {
  let parsed: { type: string; payload: any };
  if (typeof message === 'string') {
    try { parsed = JSON.parse(message); } catch { return; }
  } else if (message && typeof message === 'object' && 'type' in message) {
    parsed = message as { type: string; payload: any };
  } else {
    return;
  }

  const { type, payload } = parsed;

  try {
    switch (type) {
      case 'subscribe_project': {
        let project: Awaited<ReturnType<typeof projectsService.findById>>;
        try { project = await projectsService.findById(payload.projectId); } catch {
          emitTo(client, 'subscribe_error', { projectId: payload.projectId, error: 'Project not found' });
          break;
        }
        if (project.sandboxId) {
          subscribeTo(project.sandboxId, client.id);
          attachTerminalListeners(project.sandboxId, project.provider);
          reconcileAndReconnect(payload.projectId, project, client).catch((err) => {
            console.warn(`[agent-ws] reconcileAndReconnect failed for ${payload.projectId}:`, err);
          });
        } else if (project.status === 'stopped' || project.status === 'error') {
          emitTo(client, 'agent_status', {
            projectId: payload.projectId, status: 'provisioning',
            message: 'Sandbox was not provisioned. Provisioning now...',
          });
          projectsService.startOrProvisionSandbox(payload.projectId).catch((err) => {
            emitTo(client, 'agent_status', {
              projectId: payload.projectId, status: 'error',
              message: `Failed to provision sandbox: ${err instanceof Error ? err.message : String(err)}`,
            });
          });
        }
        try {
          const staleIds = await threadsService.reconcileStaleThreads(payload.projectId, new Set(activeHandlers.keys()));
          for (const id of staleIds) {
            emitTo(client, 'agent_status', { threadId: id, status: 'completed' });
          }
        } catch { /* ignore reconciliation errors */ }
        emitTo(client, 'subscribed', { projectId: payload.projectId, sandboxId: project.sandboxId });
        break;
      }
      case 'send_prompt': {
        const { threadId, prompt, mode, model, agentType, images } = payload;
        if (mode) await threadsService.updateMode(threadId, mode);
        if (agentType) await threadsService.updateAgentType(threadId, agentType);
        if (model !== undefined) await threadsService.updateModel(threadId, model);

        const contentBlocks: any[] = [];
        if (Array.isArray(images) && images.length > 0) {
          for (const img of images) {
            contentBlocks.push({ type: 'image', source: img });
          }
        }
        contentBlocks.push({ type: 'text', text: prompt });
        await threadsService.addMessage(threadId, { role: 'user', content: contentBlocks });

        await executeAgainstSandbox(client, threadId, prompt, mode, model, images);
        break;
      }
      case 'execute_thread': {
        const { threadId, mode, model, agentType } = payload;
        if (mode) await threadsService.updateMode(threadId, mode);
        if (agentType) await threadsService.updateAgentType(threadId, agentType);
        if (model !== undefined) await threadsService.updateModel(threadId, model);
        const thread = await threadsService.findById(threadId);
        const firstUserMsg = thread.messages?.find((m) => m.role === 'user');
        if (!firstUserMsg) { emitTo(client, 'agent_error', { threadId, error: 'No user message found' }); break; }
        const prompt = firstUserMsg.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') || '';
        if (!prompt) { emitTo(client, 'agent_error', { threadId, error: 'Empty prompt' }); break; }
        await executeAgainstSandbox(client, threadId, prompt, mode, model);
        break;
      }
      case 'save_plan': {
        const { threadId, plan } = payload;
        await threadsService.updatePlanData(threadId, plan);
        await updateThreadStatusAndNotify(threadId, 'waiting_for_user_action');
        const thread = await threadsService.findById(threadId);
        const project = await projectsService.findById(thread.projectId);
        if (project?.sandboxId) {
          emitToSubscribers(project.sandboxId, 'agent_status', { threadId, status: 'waiting_for_user_action' });
        }
        emitTo(client, 'plan_saved', { threadId, planId: plan.id });
        break;
      }
      case 'user_answer': {
        const { threadId, toolUseId, answer } = payload;
        const thread = await threadsService.findById(threadId);
        const project = await projectsService.findById(thread.projectId);
        if (!project.sandboxId) { emitTo(client, 'agent_error', { threadId, error: 'No sandbox' }); break; }
        const manager = projectsService.getSandboxManager(project.provider);
        if (!manager) { emitTo(client, 'agent_error', { threadId, error: 'Sandbox manager not available' }); break; }
        await manager.sendUserAnswer(project.sandboxId, threadId, toolUseId, answer);
        await threadsService.addMessage(threadId, {
          role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }], metadata: null,
        });
        break;
      }
      case 'stop_agent': {
        const { threadId } = payload;
        const thread = await threadsService.findById(threadId);
        const project = await projectsService.findById(thread.projectId);
        if (!project.sandboxId) { emitTo(client, 'agent_error', { threadId, error: 'No sandbox' }); break; }
        const manager = projectsService.getSandboxManager(project.provider);
        if (!manager) { emitTo(client, 'agent_error', { threadId, error: 'Sandbox manager not available' }); break; }
        const handler = activeHandlers.get(threadId);
        if (handler) { manager.removeListener('message', handler); activeHandlers.delete(threadId); }
        const timeout = activeTimeouts.get(threadId);
        if (timeout) { clearTimeout(timeout); activeTimeouts.delete(threadId); }
        const hc = activeHealthChecks.get(threadId);
        if (hc) { clearInterval(hc); activeHealthChecks.delete(threadId); }
        await manager.stopClaude(project.sandboxId, threadId);
        await updateThreadStatusAndNotify(threadId, 'completed');
        emitToSubscribers(project.sandboxId, 'agent_status', { threadId, status: 'completed' });
        break;
      }
      case 'update_thread_status': {
        const { threadId, status } = payload;
        if (threadId && status) {
          await updateThreadStatusAndNotify(threadId, status);
        }
        break;
      }
      case 'crash_agent': {
        if (process.env.APEX_E2E_TEST !== '1') break;
        const { threadId } = payload;
        const thread = await threadsService.findById(threadId);
        const project = await projectsService.findById(thread.projectId);
        if (!project.sandboxId) break;
        const manager = projectsService.getSandboxManager(project.provider);
        if (!manager) break;
        await manager.stopClaude(project.sandboxId, threadId);
        break;
      }
      case 'terminal_create': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'terminal_error', { terminalId: payload.terminalId, error: 'Sandbox not ready' }); break; }
        subscribeTo(resolved.sandboxId, client.id);
        attachTerminalListeners(resolved.sandboxId, resolved.project.provider);
        const dirName = await resolveDirName(resolved.project);
        const cwd = resolveProjectDir(dirName, resolved.project.localDir);
        await Promise.race([
          resolved.manager.createTerminal(resolved.sandboxId, payload.terminalId, payload.cols, payload.rows, cwd, payload.name),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Terminal creation timed out')), 15_000)),
        ]);
        break;
      }
      case 'terminal_input': {
        const resolved = await tryResolveProject(payload.projectId);
        if (resolved) await resolved.manager.sendTerminalInput(resolved.sandboxId, payload.terminalId, payload.data);
        break;
      }
      case 'terminal_resize': {
        const resolved = await tryResolveProject(payload.projectId);
        if (resolved) await resolved.manager.resizeTerminal(resolved.sandboxId, payload.terminalId, payload.cols, payload.rows);
        break;
      }
      case 'terminal_close': {
        const resolved = await tryResolveProject(payload.projectId);
        if (resolved) await resolved.manager.closeTerminal(resolved.sandboxId, payload.terminalId);
        break;
      }
      case 'terminal_list': {
        const resolved = await tryResolveProject(payload.projectId);
        if (resolved) {
          subscribeTo(resolved.sandboxId, client.id);
          attachTerminalListeners(resolved.sandboxId, resolved.project.provider);
          const timedOut = await Promise.race([
            resolved.manager.listTerminals(resolved.sandboxId).then(() => false),
            new Promise<boolean>((r) => setTimeout(() => r(true), 10_000)),
          ]);
          if (timedOut) emitTo(client, 'terminal_list', { terminals: [] });
        }
        // When sandbox isn't ready, don't respond — the client's timeout
        // will set terminalsLoaded without bridgeResponded, preventing
        // premature auto-create that would hit "Sandbox not ready".
        break;
      }
      case 'port_preview_url': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'port_preview_url_result', { port: payload.port, error: 'Sandbox not ready' }); break; }
        let { url, token } = await resolved.manager.getPortPreviewUrl(resolved.sandboxId, payload.port);
        if (resolved.project.provider === 'docker' || resolved.project.provider === 'apple-container') {
          url = `/preview/${resolved.project.id}/${payload.port}`;
        }
        emitTo(client, 'port_preview_url_result', { port: payload.port, url, token });
        break;
      }
      case 'get_ports': {
        const project = await projectsService.findById(payload.projectId);
        if (!project.sandboxId) break;
        const manager = projectsService.getSandboxManager(project.provider);
        if (!manager) break;
        let cached = manager.getLastPorts(project.sandboxId) ?? lastPortsBySandbox.get(project.sandboxId);
        if (!cached) { try { cached = await manager.scanPorts(project.sandboxId); } catch { /* ignore */ } }
        if (cached) emitTo(client, 'ports_update', { ports: cached.ports });
        break;
      }
      case 'forward_port': {
        const project = await projectsService.findById(payload.projectId);
        if (!project.sandboxId) { emitTo(client, 'forward_port_result', { port: payload.port, error: 'Sandbox not ready' }); break; }
        if (project.provider !== 'docker' && project.provider !== 'apple-container') { emitTo(client, 'forward_port_result', { port: payload.port, error: 'Port forwarding is only for local sandboxes' }); break; }
        const mgr = projectsService.getSandboxManager(project.provider);
        if (!mgr) { emitTo(client, 'forward_port_result', { port: payload.port, error: 'Manager not available' }); break; }
        try {
          const { url } = await mgr.getPortPreviewUrl(project.sandboxId, payload.port);
          const parsed = new URL(url);
          const localPort = await forwardPort(project.sandboxId, parsed.hostname, payload.port);
          emitTo(client, 'forward_port_result', { port: payload.port, localPort, url: `http://localhost:${localPort}` });
        } catch (err) {
          emitTo(client, 'forward_port_result', { port: payload.port, error: String(err) });
        }
        break;
      }
      case 'unforward_port': {
        const project = await projectsService.findById(payload.projectId);
        if (!project.sandboxId) break;
        unforwardPort(project.sandboxId, payload.port);
        emitTo(client, 'unforward_port_result', { port: payload.port, ok: true });
        break;
      }
      case 'list_forwards': {
        const project = await projectsService.findById(payload.projectId);
        if (!project.sandboxId) { emitTo(client, 'list_forwards_result', { forwards: [] }); break; }
        emitTo(client, 'list_forwards_result', { forwards: listForwards(project.sandboxId) });
        break;
      }
      case 'project_info': {
        const resolved = await tryResolveProject(payload.projectId);
        let project: Awaited<ReturnType<typeof projectsService.findById>>;
        try { project = await projectsService.findById(payload.projectId); } catch {
          emitTo(client, 'project_info', { gitBranch: null, projectDir: null, error: 'Project not found' });
          break;
        }
        const dirName = await resolveDirName(project);
        const projectDir = project.sandboxId ? resolveProjectDir(dirName, project.localDir) : null;
        if (projectDir) emitTo(client, 'project_info', { gitBranch: null, projectDir });
        let gitBranch: string | null = null;
        if (resolved) { try { gitBranch = await resolved.manager.getGitBranch(resolved.sandboxId); } catch { /* ignore */ } }
        if (!gitBranch && project.gitRepo) gitBranch = await resolveDefaultBranch(project.gitRepo);
        emitTo(client, 'project_info', { gitBranch, projectDir });
        break;
      }
      case 'file_list': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_list_result', { path: payload.path, entries: [], error: 'Sandbox not ready' }); break; }
        try {
          const entries = await Promise.race([
            resolved.manager.listFiles(resolved.sandboxId, payload.path),
            new Promise<FileEntry[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30_000)),
          ]);
          emitTo(client, 'file_list_result', { path: payload.path, entries });
        } catch (err) {
          emitTo(client, 'file_list_result', { path: payload.path, entries: [], error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'file_create': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        if (payload.isDirectory) await resolved.manager.createFolder(resolved.sandboxId, payload.path);
        else await resolved.manager.createFile(resolved.sandboxId, payload.path);
        emitTo(client, 'file_op_result', { ok: true, op: 'create', path: payload.path });
        break;
      }
      case 'file_rename': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.renameFile(resolved.sandboxId, payload.oldPath, payload.newPath);
        emitTo(client, 'file_op_result', { ok: true, op: 'rename', oldPath: payload.oldPath, newPath: payload.newPath });
        break;
      }
      case 'file_delete': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.deleteFile(resolved.sandboxId, payload.path);
        emitTo(client, 'file_op_result', { ok: true, op: 'delete', path: payload.path });
        break;
      }
      case 'file_read': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_read_result', { path: payload.path, content: '', error: 'Sandbox not ready' }); break; }
        try {
          const content = await Promise.race([
            resolved.manager.readFile(resolved.sandboxId, payload.path),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30_000)),
          ]);
          emitTo(client, 'file_read_result', { path: payload.path, content });
        } catch (err) {
          emitTo(client, 'file_read_result', { path: payload.path, content: '', error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'file_write': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_write_result', { ok: false, path: payload.path, error: 'Sandbox not ready' }); break; }
        await resolved.manager.writeFile(resolved.sandboxId, payload.path, payload.content);
        emitTo(client, 'file_write_result', { ok: true, path: payload.path });
        break;
      }
      case 'file_search': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_search_result', { query: payload.query, results: [], error: 'Sandbox not ready' }); break; }
        try {
          const project = await projectsService.findById(payload.projectId);
          const searchDirName = await resolveDirName(project);
          const searchDir = resolved.manager.getProjectDir(resolved.sandboxId, searchDirName);
          const results = await Promise.race([
            resolved.manager.searchFiles(resolved.sandboxId, payload.query, searchDir, {
              matchCase: payload.matchCase, wholeWord: payload.wholeWord, useRegex: payload.useRegex,
              includePattern: payload.includePattern, excludePattern: payload.excludePattern,
            }),
            new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(new Error('Search timeout')), 30_000)),
          ]);
          emitTo(client, 'file_search_result', { query: payload.query, results });
        } catch (err) {
          emitTo(client, 'file_search_result', { query: payload.query, results: [], error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'file_move': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'file_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.renameFile(resolved.sandboxId, payload.sourcePath, payload.destPath);
        emitTo(client, 'file_op_result', { ok: true, op: 'move', sourcePath: payload.sourcePath, destPath: payload.destPath });
        break;
      }
      case 'git_status': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_status_result', { branch: null, staged: [], unstaged: [], untracked: [], conflicted: [], ahead: 0, behind: 0, error: 'Sandbox not ready' }); break; }
        const status = await resolved.manager.getGitStatus(resolved.sandboxId);
        emitTo(client, 'git_status_result', status);
        break;
      }
      case 'git_stage': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.gitStage(resolved.sandboxId, payload.paths);
        emitTo(client, 'git_op_result', { ok: true, op: 'stage' });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_unstage': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.gitUnstage(resolved.sandboxId, payload.paths);
        emitTo(client, 'git_op_result', { ok: true, op: 'unstage' });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_discard': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        await resolved.manager.gitDiscard(resolved.sandboxId, payload.paths);
        emitTo(client, 'git_op_result', { ok: true, op: 'discard' });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_commit': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        if (payload.stageAll) await resolved.manager.gitStage(resolved.sandboxId, ['.']);
        const output = await resolved.manager.gitCommit(resolved.sandboxId, payload.message);
        emitTo(client, 'git_op_result', { ok: true, op: 'commit', output });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_push': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        const output = await resolved.manager.gitPush(resolved.sandboxId);
        emitTo(client, 'git_op_result', { ok: true, op: 'push', output });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_pull': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        const output = await resolved.manager.gitPull(resolved.sandboxId);
        emitTo(client, 'git_op_result', { ok: true, op: 'pull', output });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        break;
      }
      case 'git_branches': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_branches_result', { branches: [], error: 'Sandbox not ready' }); break; }
        const branches = await resolved.manager.listBranches(resolved.sandboxId);
        emitTo(client, 'git_branches_result', { branches });
        break;
      }
      case 'git_create_branch': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        const output = await resolved.manager.gitCreateBranch(resolved.sandboxId, payload.name, payload.startPoint);
        emitTo(client, 'git_op_result', { ok: true, op: 'create_branch', output });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        emitTo(client, 'git_branches_result', { branches: await resolved.manager.listBranches(resolved.sandboxId) });
        break;
      }
      case 'git_checkout': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_op_result', { ok: false, error: 'Sandbox not ready' }); break; }
        const output = await resolved.manager.gitCheckout(resolved.sandboxId, payload.ref);
        emitTo(client, 'git_op_result', { ok: true, op: 'checkout', output });
        emitTo(client, 'git_status_result', await resolved.manager.getGitStatus(resolved.sandboxId));
        emitTo(client, 'git_branches_result', { branches: await resolved.manager.listBranches(resolved.sandboxId) });
        break;
      }
      case 'git_diff': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'git_diff_result', { path: payload.path, original: '', modified: '', error: 'Sandbox not ready' }); break; }
        try {
          const diff = await resolved.manager.getGitDiff(resolved.sandboxId, payload.path, !!payload.staged);
          emitTo(client, 'git_diff_result', { path: payload.path, ...diff });
        } catch (e: any) {
          emitTo(client, 'git_diff_result', { path: payload.path, original: '', modified: '', error: e.message });
        }
        break;
      }
      case 'layout_save': {
        const resolved = await tryResolveProject(payload.projectId);
        if (resolved) await resolved.manager.saveLayout(resolved.sandboxId, payload.layout);
        break;
      }
      case 'layout_load': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'layout_data', { data: null }); break; }
        const data = await Promise.race([
          resolved.manager.loadLayout(resolved.sandboxId),
          new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
        ]);
        emitTo(client, 'layout_data', { data });
        break;
      }
      case 'lsp_data': {
        const resolved = await tryResolveProject(payload.projectId);
        if (!resolved) { emitTo(client, 'lsp_status', { language: payload.language, status: 'error', error: 'Sandbox not ready' }); break; }
        await resolved.manager.sendLspData(resolved.sandboxId, payload.language, payload.jsonrpc);
        break;
      }
    }
  } catch (err) {
    console.error(`[agent-ws] Error handling ${type}:`, err);
    if (type === 'send_prompt' || type === 'execute_thread') {
      const threadId = payload?.threadId;
      if (threadId) {
        try { await updateThreadStatusAndNotify(threadId, 'error'); } catch { /* ignore */ }
        emitTo(client, 'agent_error', { threadId, error: `Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    } else if (type === 'stop_agent') {
      const threadId = payload?.threadId;
      if (threadId) emitTo(client, 'agent_error', { threadId, error: `Failed to stop: ${err instanceof Error ? err.message : String(err)}` });
    } else if (type.startsWith('git_')) emitTo(client, 'git_op_result', { ok: false, error: String(err) });
    else if (type.startsWith('file_')) emitTo(client, 'file_op_result', { ok: false, error: String(err) });
    else if (type.startsWith('terminal_')) emitTo(client, 'terminal_error', { error: String(err) });
  }
}

async function reconcileAndStart(projectId: string) {
  const project = await projectsService.reconcileSandboxStatus(projectId);
  if (project.status === 'stopped' || project.status === 'error') {
    await projectsService.startOrProvisionSandbox(projectId);
  }
}

async function reconcileAndReconnect(
  projectId: string,
  _project: Awaited<ReturnType<typeof projectsService.findById>>,
  client: WsClient,
) {
  try {
    const reconciled = await projectsService.reconcileSandboxStatus(projectId);
    if (reconciled.status === 'stopped' || reconciled.status === 'error') {
      await projectsService.startOrProvisionSandbox(projectId);
    } else {
      const manager = projectsService.getSandboxManager(reconciled.provider);
      if (manager) {
        const dirName = await resolveDirName(reconciled);
        try {
          await manager.reconnectSandbox(reconciled.sandboxId!, dirName, reconciled.localDir || undefined);
        } catch (reconnectErr) {
          console.warn(`[agent-ws] reconnect failed for ${projectId}, marking as error:`, reconnectErr);
          const message = reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr);
          await projectsService.update(projectId, { status: 'error', statusError: message.slice(0, 500) });
          emitTo(client, 'project_updated', await projectsService.findById(projectId));
          emitTo(client, 'agent_status', {
            projectId, status: 'error',
            message: `Sandbox unreachable: ${message.slice(0, 300)}`,
          });
          return;
        }
      }
    }
  } catch (err) {
    console.warn(`[agent-ws] subscribe reconcile/reconnect error for ${projectId}:`, err);
  }
  try {
    const latest = await projectsService.findById(projectId);
    emitTo(client, 'project_updated', latest);
  } catch { /* ignore */ }
}

export async function autoExecuteThread(threadId: string, prompt: string): Promise<void> {
  const noopClient: WsClient = { id: `__auto_${threadId}__`, wsSend: () => {} };
  await executeAgainstSandbox(noopClient, threadId, prompt);
}

export const agentWs = new Elysia()
  .ws('/ws/agent', {
    open(ws) {
      const id = ws.id;
      clientMap.set(id, { id, wsSend: (data: string) => ws.send(data) });
      console.log(`[agent-ws] Client connected: ${id}`);
    },
    message(ws, message) {
      const id = ws.id;
      let client = clientMap.get(id);
      if (!client) return;
      client.wsSend = (data: string) => ws.send(data);
      handleMessage(client, message);
    },
    close(ws) {
      const id = ws.id;
      console.log(`[agent-ws] Client disconnected: ${id}`);
      clientMap.delete(id);
      for (const [sandboxId, subs] of sandboxSubscribers) {
        subs.delete(id);
        if (subs.size === 0) sandboxSubscribers.delete(sandboxId);
      }
    },
  });
