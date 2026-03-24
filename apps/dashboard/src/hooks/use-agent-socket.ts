import { useEffect, useRef, useCallback } from 'react';
import { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useThreadsStore } from '../stores/tasks-store';
import { usePlanStore, isPlanContent } from '../stores/plan-store';

export function useAgentSocket(projectId: string | undefined) {
  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const addMessage = useThreadsStore((s) => s.addMessage);
  const updateThreadStatus = useThreadsStore((s) => s.updateThreadStatus);
  const setThreadSessionInfo = useThreadsStore((s) => s.setThreadSessionInfo);
  const planTextRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!projectId) return;

    const ws = new ReconnectingWebSocket('/ws/agent');
    wsRef.current = ws;

    ws.onStatus((status) => {
      if (status === 'connected') {
        console.log('[ws] connected, subscribing to project', projectId);
        ws.send('subscribe_project', { projectId });
      } else if (status === 'disconnected') {
        console.log('[ws] disconnected');
      }
    });

    ws.on('subscribed', (data) => {
      console.log('[ws] subscribed:', data.payload);
    });

    ws.on('prompt_accepted', (data) => {
      console.log('[ws] prompt accepted:', data.payload);
    });

    ws.on('agent_message', (data) => {
      const msg = data.payload?.message;
      const threadId = data.payload?.threadId;
      if (!msg) return;

      if (msg.type === 'system' && msg.subtype === 'init') {
        setThreadSessionInfo(threadId, {
          model: msg.model,
          tools: msg.tools,
          mcpServers: msg.mcp_servers,
          permissionMode: msg.permissionMode,
          agentVersion: msg.claude_code_version,
        });
        return;
      }

      if (msg.type === 'system' && (msg.subtype === 'retry' || msg.subtype === 'info')) {
        addMessage({
          id: crypto.randomUUID(),
          taskId: threadId,
          role: 'system',
          content: [{ type: 'text', text: msg.text || 'Agent stopped responding. Restarting…' }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (msg.type === 'user' && msg.message?.content?.length) {
        const hasToolResult = msg.message.content.some(
          (b: { type?: string }) => b?.type === 'tool_result',
        );
        if (hasToolResult) {
          addMessage({
            id: msg.uuid || crypto.randomUUID(),
            taskId: threadId,
            role: 'user',
            content: msg.message.content,
            metadata: null,
            createdAt: new Date().toISOString(),
            _receivedAt: Date.now(),
          } as any);
        }
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        const planStore = usePlanStore.getState();
        const activePlan = planStore.getPlanByThreadId(threadId);
        if (planStore.isThreadPlan(threadId) && !activePlan?.isComplete) {
          const textParts: string[] = [];
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) textParts.push(block.text);
          }
          if (textParts.length > 0) {
            const existing = planTextRef.current.get(threadId) || [];
            existing.push(...textParts);
            planTextRef.current.set(threadId, existing);
            const fullContent = existing.join('\n\n');
            if (activePlan) planStore.updatePlanContent(activePlan.id, fullContent);
            else planStore.createPlan(threadId, fullContent);
          }
        }

        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: threadId,
          role: 'assistant',
          content: msg.message.content,
          metadata: { model: msg.message.model, stopReason: msg.message.stop_reason },
          createdAt: new Date().toISOString(),
          _receivedAt: Date.now(),
        } as any);
      } else if (msg.type === 'result') {
        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: threadId,
          role: 'system',
          content: [],
          metadata: {
            costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, durationApiMs: msg.duration_api_ms,
            numTurns: msg.num_turns, isError: msg.is_error,
            inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens,
            cacheCreationInputTokens: msg.usage?.cache_creation_input_tokens,
            cacheReadInputTokens: msg.usage?.cache_read_input_tokens,
          },
          createdAt: new Date().toISOString(),
        });

        const planStore = usePlanStore.getState();
        if (planStore.isThreadPlan(threadId)) {
          const plan = planStore.getPlanByThreadId(threadId);
          if (plan && !plan.isComplete) {
            const rawText = planTextRef.current.get(threadId)?.join('\n\n') || '';
            if (isPlanContent(rawText) || isPlanContent(plan.content)) {
              planStore.completePlan(plan.id);
              const planData = { id: plan.id, title: plan.title, filename: plan.filename, content: plan.content };
              useThreadsStore.getState().updateThread(threadId, { planData });
              ws.send('save_plan', { threadId, plan: planData });
            } else {
              planStore.removePlanByThreadId(threadId);
            }
          }
        }
      }
    });

    ws.on('agent_status', (data) => {
      console.log('[ws] agent_status:', data.payload);
      updateThreadStatus(data.payload.threadId, data.payload.status === 'retrying' ? 'running' : data.payload.status);
    });

    ws.on('agent_error', (data) => {
      console.error('[ws] agent_error:', data.payload);
      if (data.payload.threadId) {
        updateThreadStatus(data.payload.threadId, 'error');
        addMessage({
          id: crypto.randomUUID(),
          taskId: data.payload.threadId,
          role: 'system',
          content: [{ type: 'text', text: `Error: ${data.payload.error}` }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [projectId, addMessage, updateThreadStatus, setThreadSessionInfo]);

  const sendPrompt = useCallback(
    (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string, images?: { type: 'base64'; media_type: string; data: string }[]) => {
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      wsRef.current?.send('send_prompt', { threadId, prompt, mode, model, agentType, images });
    },
    [],
  );

  const executeThread = useCallback(
    (threadId: string, mode?: string, model?: string, agentType?: string) => {
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      wsRef.current?.send('execute_thread', { threadId, mode, model, agentType });
    },
    [],
  );

  const sendUserAnswer = useCallback(
    (threadId: string, toolUseId: string, answer: string) => {
      addMessage({
        id: crypto.randomUUID(),
        taskId: threadId,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      wsRef.current?.send('user_answer', { threadId, toolUseId, answer });
    },
    [addMessage],
  );

  const stopAgent = useCallback(
    (threadId: string) => {
      wsRef.current?.send('stop_agent', { threadId });
    },
    [],
  );

  return { sendPrompt, executeThread, sendUserAnswer, stopAgent, socket: wsRef };
}
