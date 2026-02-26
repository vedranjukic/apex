import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useChatsStore } from '../stores/tasks-store';
import { usePlanStore } from '../stores/plan-store';

export function useAgentSocket(projectId: string | undefined) {
  const socketRef = useRef<Socket | null>(null);
  const addMessage = useChatsStore((s) => s.addMessage);
  const updateChatStatus = useChatsStore((s) => s.updateChatStatus);
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
      console.log('[ws] agent_message:', data.message?.type);
      if (!data.message) return;
      const msg = data.message;

      if (msg.type === 'assistant' && msg.message?.content) {
        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: data.chatId,
          role: 'assistant',
          content: msg.message.content,
          metadata: {
            model: msg.message.model,
            stopReason: msg.message.stop_reason,
          },
          createdAt: new Date().toISOString(),
          _receivedAt: Date.now(),
        } as any);

        const planStore = usePlanStore.getState();
        const activePlan = planStore.getPlanByChatId(data.chatId);
        if (planStore.isChatPlan(data.chatId) && !activePlan?.isComplete) {
          const textParts: string[] = [];
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }
          if (textParts.length > 0) {
            const existing = planTextRef.current.get(data.chatId) || [];
            existing.push(...textParts);
            planTextRef.current.set(data.chatId, existing);

            const fullContent = existing.join('\n\n');
            if (activePlan) {
              planStore.updatePlanContent(activePlan.id, fullContent);
            } else {
              planStore.createPlan(data.chatId, fullContent);
            }
          }
        }
      } else if (msg.type === 'result') {
        addMessage({
          id: msg.uuid || crypto.randomUUID(),
          taskId: data.chatId,
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
        if (planStore.isChatPlan(data.chatId)) {
          const plan = planStore.getPlanByChatId(data.chatId);
          if (plan) {
            planStore.completePlan(plan.id);
          }
        }
      }
    });

    socket.on('agent_status', (data: any) => {
      console.log('[ws] agent_status:', data);
      updateChatStatus(data.chatId, data.status);
    });

    socket.on('agent_error', (data: any) => {
      console.error('[ws] agent_error:', data);
      if (data.chatId) {
        updateChatStatus(data.chatId, 'error');
        addMessage({
          id: crypto.randomUUID(),
          taskId: data.chatId,
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
  }, [projectId, addMessage, updateChatStatus]);

  const sendPrompt = useCallback(
    (chatId: string, prompt: string, mode?: string, model?: string) => {
      console.log('[ws] emit send_prompt', chatId);
      if (mode === 'plan') {
        usePlanStore.getState().markChatAsPlan(chatId);
        planTextRef.current.delete(chatId);
      }
      socketRef.current?.emit('send_prompt', { chatId, prompt, mode, model });
    },
    [],
  );

  const executeChat = useCallback(
    (chatId: string, mode?: string, model?: string) => {
      console.log('[ws] emit execute_chat', chatId);
      if (mode === 'plan') {
        usePlanStore.getState().markChatAsPlan(chatId);
        planTextRef.current.delete(chatId);
      }
      socketRef.current?.emit('execute_chat', { chatId, mode, model });
    },
    [],
  );

  const sendUserAnswer = useCallback(
    (chatId: string, toolUseId: string, answer: string) => {
      console.log('[ws] emit user_answer', chatId, toolUseId);
      addMessage({
        id: crypto.randomUUID(),
        taskId: chatId,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      socketRef.current?.emit('user_answer', { chatId, toolUseId, answer });
    },
    [addMessage],
  );

  return { sendPrompt, executeChat, sendUserAnswer, socket: socketRef };
}
