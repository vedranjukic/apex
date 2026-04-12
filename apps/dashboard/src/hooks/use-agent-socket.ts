import { useEffect, useRef, useCallback } from 'react';
import { ReconnectingWebSocket } from '../lib/reconnecting-ws';
import { useThreadsStore } from '../stores/tasks-store';
import { useProjectsStore } from '../stores/projects-store';
import { usePlanStore, isPlanContent } from '../stores/plan-store';
import { useNetworkStore } from '../stores/network-store';

export function useAgentSocket(projectId: string | undefined) {
  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const addMessage = useThreadsStore((s) => s.addMessage);
  const updateThreadStatus = useThreadsStore((s) => s.updateThreadStatus);
  const setThreadSessionInfo = useThreadsStore((s) => s.setThreadSessionInfo);
  const pauseThreadsForOffline = useThreadsStore((s) => s.pauseThreadsForOffline);
  const resumeThreadsFromOffline = useThreadsStore((s) => s.resumeThreadsFromOffline);
  const planTextRef = useRef<Map<string, string[]>>(new Map());
  const isOnline = useNetworkStore((s) => s.isOnline);
  const connectionType = useNetworkStore((s) => s.connectionType);
  const setSocketConnected = useNetworkStore((s) => s.setSocketConnected);
  const setReconnecting = useNetworkStore((s) => s.setReconnecting);
  
  // Queue for operations during offline periods
  const offlineQueue = useRef<Array<{ type: string; data: any; timestamp: number }>>([]);

  useEffect(() => {
    if (!projectId) return;

    const ws = new ReconnectingWebSocket('/ws/agent');
    wsRef.current = ws;

    let hasConnectedOnce = false;
    ws.onStatus((status) => {
      if (status === 'connected') {
        console.log('[ws] connected, subscribing to project', projectId);
        setSocketConnected(true);
        setReconnecting(false);
        ws.send('subscribe_project', { projectId });
        
        if (hasConnectedOnce) {
          useThreadsStore.getState().fetchThreads(projectId);
          // Resume threads that were paused due to offline mode
          resumeThreadsFromOffline();
          // Process queued operations
          processOfflineQueue();
        }
        hasConnectedOnce = true;
      } else if (status === 'disconnected') {
        console.log('[ws] disconnected');
        setSocketConnected(false);
      } else if (status === 'connecting') {
        setReconnecting(true);
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

      // Skip processing if we're offline and this is for an in-progress thread
      if (!isOnline) {
        const threadState = useThreadsStore.getState();
        const thread = threadState.threads.find(t => t.id === threadId);
        if (thread && (thread.status === 'running' || thread.status === 'waiting_for_user_action')) {
          console.log('[ws] Queueing message for offline processing:', threadId);
          offlineQueue.current.push({
            type: 'agent_message',
            data,
            timestamp: Date.now()
          });
          return;
        }
      }

      if (msg.type === 'system' && msg.subtype === 'init') {
        setThreadSessionInfo(threadId, {
          model: msg.model,
          tools: msg.tools,
          mcpServers: msg.mcp_servers,
          permissionMode: msg.permissionMode,
          agentVersion: msg.agentVersion,
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

        if (!msg.is_error) {
          const allMessages = useThreadsStore.getState().messages;
          let assistantCount = 0;
          outer: for (let i = allMessages.length - 1; i >= 0; i--) {
            const m = allMessages[i];
            if (m.role !== 'assistant') continue;
            assistantCount++;
            if (assistantCount > 3) break;
            for (let j = (m.content?.length ?? 0) - 1; j >= 0; j--) {
              const block = m.content[j] as any;
              const bName = (block.name ?? '').toLowerCase();
              if (block.type === 'tool_use' && (bName === 'todowrite' || bName === 'todo_write') && block.input) {
                const todos = block.input.todos;
                if (Array.isArray(todos) && todos.some((t: any) => t.status === 'pending' || t.status === 'in_progress') && !todos.every((t: any) => t.status === 'completed')) {
                  updateThreadStatus(threadId, 'waiting_for_user_action');
                  useProjectsStore.getState().setThreadStatus(threadId, 'waiting_for_user_action');
                  ws.send('update_thread_status', { threadId, status: 'waiting_for_user_action' });
                }
                break outer;
              }
            }
          }
        }
      }
    });

    ws.on('agent_status', (data) => {
      console.log('[ws] agent_status:', data.payload);
      
      // Skip processing if we're offline and this affects a running thread
      if (!isOnline) {
        const threadState = useThreadsStore.getState();
        const thread = threadState.threads.find(t => t.id === data.payload.threadId);
        if (thread && (thread.status === 'running' || thread.status === 'waiting_for_user_action')) {
          console.log('[ws] Queueing status update for offline processing:', data.payload.threadId);
          offlineQueue.current.push({
            type: 'agent_status',
            data,
            timestamp: Date.now()
          });
          return;
        }
      }
      
      const resolvedStatus = data.payload.status === 'retrying' ? 'running' : data.payload.status;
      updateThreadStatus(data.payload.threadId, resolvedStatus, isOnline);
      useProjectsStore.getState().setThreadStatus(data.payload.threadId, resolvedStatus, isOnline);
    });

    ws.on('proxy_sync', (data) => {
      const { threadId, messages: syncMessages } = data.payload || {};
      if (!threadId || !Array.isArray(syncMessages)) return;
      const { messages: currentMessages, activeThreadId } = useThreadsStore.getState();
      if (threadId !== activeThreadId) return;
      const existingIds = new Set(currentMessages.map((m: { id: string }) => m.id));
      for (const msg of syncMessages) {
        if (existingIds.has(msg.id)) continue;
        addMessage(msg);
      }
    });

    ws.on('agent_error', (data) => {
      console.error('[ws] agent_error:', data.payload);
      
      if (data.payload.threadId) {
        updateThreadStatus(data.payload.threadId, 'error', isOnline);
        useProjectsStore.getState().setThreadStatus(data.payload.threadId, 'error', isOnline);
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

  // Process queued operations when coming back online
  const processOfflineQueue = useCallback(() => {
    const queue = offlineQueue.current;
    if (queue.length === 0) return;

    console.log(`[ws] Processing ${queue.length} queued operations from offline mode`);
    
    // Sort by timestamp to maintain order
    queue.sort((a, b) => a.timestamp - b.timestamp);
    
    queue.forEach(({ type, data }) => {
      try {
        if (type === 'agent_message') {
          // Re-process the agent message
          const msg = data.payload?.message;
          const threadId = data.payload?.threadId;
          if (msg && threadId) {
            // Process the message normally now that we're online
            processAgentMessage(msg, threadId);
          }
        } else if (type === 'agent_status') {
          // Re-process the status update
          const resolvedStatus = data.payload.status === 'retrying' ? 'running' : data.payload.status;
          updateThreadStatus(data.payload.threadId, resolvedStatus, isOnline);
          useProjectsStore.getState().setThreadStatus(data.payload.threadId, resolvedStatus, isOnline);
        } else if (type === 'user_answer') {
          // Re-send the user answer
          wsRef.current?.send('user_answer', data);
        }
      } catch (error) {
        console.error('[ws] Error processing queued operation:', error);
      }
    });
    
    // Clear the queue
    offlineQueue.current = [];
  }, [updateThreadStatus]);

  // Helper function to process agent messages (extracted for reuse)
  const processAgentMessage = useCallback((msg: any, threadId: string) => {
    if (msg.type === 'system' && msg.subtype === 'init') {
      setThreadSessionInfo(threadId, {
        model: msg.model,
        tools: msg.tools,
        mcpServers: msg.mcp_servers,
        permissionMode: msg.permissionMode,
        agentVersion: msg.agentVersion,
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
            wsRef.current?.send('save_plan', { threadId, plan: planData });
          } else {
            planStore.removePlanByThreadId(threadId);
          }
        }
      }

      if (!msg.is_error) {
        const allMessages = useThreadsStore.getState().messages;
        let assistantCount = 0;
        outer: for (let i = allMessages.length - 1; i >= 0; i--) {
          const m = allMessages[i];
          if (m.role !== 'assistant') continue;
          assistantCount++;
          if (assistantCount > 3) break;
          for (let j = (m.content?.length ?? 0) - 1; j >= 0; j--) {
            const block = m.content[j] as any;
            const bName = (block.name ?? '').toLowerCase();
            if (block.type === 'tool_use' && (bName === 'todowrite' || bName === 'todo_write') && block.input) {
              const todos = block.input.todos;
              if (Array.isArray(todos) && todos.some((t: any) => t.status === 'pending' || t.status === 'in_progress') && !todos.every((t: any) => t.status === 'completed')) {
                updateThreadStatus(threadId, 'waiting_for_user_action', isOnline);
                useProjectsStore.getState().setThreadStatus(threadId, 'waiting_for_user_action', isOnline);
                wsRef.current?.send('update_thread_status', { threadId, status: 'waiting_for_user_action' });
              }
              break outer;
            }
          }
        }
      }
    }
  }, [addMessage, setThreadSessionInfo, updateThreadStatus]);

  // Monitor network state changes to pause/resume threads
  useEffect(() => {
    if (!isOnline && connectionType === 'offline') {
      console.log('[ws] Network went offline, pausing active threads');
      pauseThreadsForOffline();
    } else if (isOnline && connectionType === 'online') {
      console.log('[ws] Network came back online, resuming paused threads');
      // Resume will be handled when socket reconnects
    }
  }, [isOnline, connectionType, pauseThreadsForOffline]);

  const sendPrompt = useCallback(
    (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string, images?: { type: 'base64'; media_type: string; data: string }[], agentSettings?: Record<string, unknown>) => {
      // Prevent new execution attempts while offline
      if (!isOnline) {
        console.warn('[ws] Cannot send prompt while offline');
        addMessage({
          id: crypto.randomUUID(),
          taskId: threadId,
          role: 'system',
          content: [{ type: 'text', text: 'Cannot send prompt while offline. Please check your connection and try again.' }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      wsRef.current?.send('send_prompt', { threadId, prompt, mode, model, agentType, images, agentSettings });
    },
    [isOnline, addMessage],
  );

  const executeThread = useCallback(
    (threadId: string, mode?: string, model?: string, agentType?: string) => {
      // Prevent new execution attempts while offline
      if (!isOnline) {
        console.warn('[ws] Cannot execute thread while offline');
        updateThreadStatus(threadId, 'offline_paused', isOnline);
        useProjectsStore.getState().setThreadStatus(threadId, 'offline_paused', isOnline);
        addMessage({
          id: crypto.randomUUID(),
          taskId: threadId,
          role: 'system',
          content: [{ type: 'text', text: 'Cannot execute thread while offline. Thread will resume when connection is restored.' }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      if (mode === 'plan') {
        usePlanStore.getState().markThreadAsPlan(threadId);
        planTextRef.current.delete(threadId);
      }
      wsRef.current?.send('execute_thread', { threadId, mode, model, agentType });
    },
    [isOnline, updateThreadStatus, addMessage],
  );

  const sendUserAnswer = useCallback(
    (threadId: string, toolUseId: string, answer: string) => {
      // Allow user answers even when offline - queue them for later
      addMessage({
        id: crypto.randomUUID(),
        taskId: threadId,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: answer }],
        metadata: null,
        createdAt: new Date().toISOString(),
      });
      
      if (!isOnline) {
        console.log('[ws] Queueing user answer for offline processing');
        offlineQueue.current.push({
          type: 'user_answer',
          data: { threadId, toolUseId, answer },
          timestamp: Date.now()
        });
        return;
      }
      
      wsRef.current?.send('user_answer', { threadId, toolUseId, answer });
    },
    [addMessage, isOnline],
  );

  const stopAgent = useCallback(
    (threadId: string) => {
      // Allow stopping even when offline
      if (!isOnline) {
        console.log('[ws] Stopping agent locally while offline');
        updateThreadStatus(threadId, 'stopped', isOnline);
        useProjectsStore.getState().setThreadStatus(threadId, 'stopped', isOnline);
        addMessage({
          id: crypto.randomUUID(),
          taskId: threadId,
          role: 'system',
          content: [{ type: 'text', text: 'Agent stopped (offline mode)' }],
          metadata: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      
      wsRef.current?.send('stop_agent', { threadId });
    },
    [isOnline, updateThreadStatus, addMessage],
  );

  return { sendPrompt, executeThread, sendUserAnswer, stopAgent, socket: wsRef };
}
