import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useThreadsStore } from '../stores/tasks-store';
import { usePlanStore } from '../stores/plan-store';

export function useAgentSocket(projectId: string | undefined) {
  const socketRef = useRef<Socket | null>(null);
  const addMessage = useThreadsStore((s) => s.addMessage);
  const updateThreadStatus = useThreadsStore((s) => s.updateThreadStatus);
  const planTextRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!projectId) return;

    const socket = io('/ws/agent', {
      path: '/ws/socket.io',
      transports: ['polling', 'websocket'],
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[ws] connected, subscribing to project', projectId);
      socket.emit('subscribe_project', { projectId });
    });

    socket.on('subscribed', (data: any) => {
      console.log('[ws] subscribed:', data);
    });

    socket.on('prompt_accepted', (data: any) => {
      console.log('[ws] prompt accepted:', data);
    });

    socket.on('agent_message', (data: any) => {
      if (import.meta.env.DEV) {
        const msg = data.message;
        console.log('[ws] agent_message:', msg?.type, { threadId: data.threadId, ...msg });
        const content = msg?.message?.content ?? msg?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && block.text) {
              console.log('[ws]   text:', block.text.slice(0, 300) + (block.text.length > 300 ? '...' : ''));
            }
            if (block?.type === 'tool_use') {
              console.log('[ws]   tool_use:', block.name, block.input);
            }
            if (block?.type === 'tool_result') {
              console.log('[ws]   tool_result:', block.tool_use_id, String(block.content ?? '').slice(0, 150));
            }
          }
        }
      }
      if (!data.message) return;
      const msg = data.message;

      if (msg.type === 'system' && msg.subtype === 'retry') {
        addMessage({
          id: crypto.randomUUID(),
          taskId: data.threadId,
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
            taskId: data.threadId,
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
        const activePlan = planStore.getPlanByThreadId(data.threadId);
        if (planStore.isThreadPlan(data.threadId) && !activePlan?.isComplete) {
          const textParts: string[] = [];
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }
          if (textParts.length > 0) {
            const existing = planTextRef.current.get(data.threadId) || [];
            existing.push(...textParts);
            planTextRef.current.set(data.threadId, existing);

            const fullContent = existing.join('\n\n');
            if (activePlan) {
              planStore.updatePlanContent(activePlan.id, fullContent);
            } else {
              planStore.createPlan(data.threadId, fullContent);
            }
          }
        }

        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: data.threadId,
          role: 'assistant',
          content: msg.message.content,
          metadata: {
            model: msg.message.model,
            stopReason: msg.message.stop_reason,
          },
          createdAt: new Date().toISOString(),
          _receivedAt: Date.now(),
        } as any);
      } else if (msg.type === 'result') {
        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: data.threadId,
          role: 'system',
          content: [],
          metadata: {
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            numTurns: msg.num_turns,
            isError: msg.is_error,
          },
          createdAt: new Date().toISOString(),
        });

        const planStore = usePlanStore.getState();
        if (planStore.isThreadPlan(data.threadId)) {
          const plan = planStore.getPlanByThreadId(data.threadId);
          if (plan && !plan.isComplete) {
            planStore.completePlan(plan.id);
            const planData = { id: plan.id, title: plan.title, filename: plan.filename, content: plan.content };
            useThreadsStore.getState().updateThread(data.threadId, { planData });
            socket.emit('save_plan', { threadId: data.threadId, plan: planData });
          }
        }
      }
    });

    socket.on('agent_status', (data: any) => {
      console.log('[ws] agent_status:', data);
      updateThreadStatus(data.threadId, data.status === 'retrying' ? 'running' : data.status);
    });

    socket.on('agent_error', (data: any) => {
      console.error('[ws] agent_error:', data);
      if (data.threadId) {
        updateThreadStatus(data.threadId, 'error');
        addMessage({
          id: crypto.randomUUID(),
          taskId: data.threadId,
          role: 'system',
          content: [{ type: 'text', text: `Error: ${data.error}` }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[ws] disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[ws] connect_error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId, addMessage, updateThreadStatus]);

  const sendPrompt = useCallback(
    (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string) => {
      console.log('[ws] emit send_prompt', threadId);
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      socketRef.current?.emit('send_prompt', { threadId, prompt, mode, model, agentType });
    },
    [],
  );

  const executeThread = useCallback(
    (threadId: string, mode?: string, model?: string, agentType?: string) => {
      console.log('[ws] emit execute_thread', threadId, { mode, model, agentType });
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      socketRef.current?.emit('execute_thread', { threadId, mode, model, agentType });
    },
    [],
  );

  const sendUserAnswer = useCallback(
    (threadId: string, toolUseId: string, answer: string) => {
      console.log('[ws] emit user_answer', threadId, toolUseId);
      addMessage({
        id: crypto.randomUUID(),
        taskId: threadId,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      socketRef.current?.emit('user_answer', { threadId, toolUseId, answer });
    },
    [addMessage],
  );

  return { sendPrompt, executeThread, sendUserAnswer, socket: socketRef };
}
