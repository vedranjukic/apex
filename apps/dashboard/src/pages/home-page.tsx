import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/layout/app-shell';
import { ProjectList } from '../components/projects/project-list';
import { ThreadPreviewPanel } from '../components/projects/thread-preview-panel';
import { openProject } from '../lib/open-project';
import { resetProjectStores } from '../lib/reset-project-stores';
import { useAgentSocket } from '../hooks/use-agent-socket';
import { useThreadsStore } from '../stores/tasks-store';
import { useProjectsStore } from '../stores/projects-store';
import type { CodeSelection } from '../stores/editor-store';

export function HomePage() {
  const [previewProjectId, setPreviewProjectId] = useState<string | null>(null);
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);
  const [previewProjectName, setPreviewProjectName] = useState<string>('');

  const projects = useProjectsStore((s) => s.projects);

  useEffect(() => {
    resetProjectStores();
  }, []);

  useEffect(() => {
    if (previewProjectId && !projects.some((p) => p.id === previewProjectId)) {
      setPreviewProjectId(null);
      setPreviewThreadId(null);
    }
  }, [projects, previewProjectId]);

  const { sendPrompt, executeThread, sendUserAnswer, stopAgent } = useAgentSocket(
    previewProjectId ?? undefined,
  );

  const addMessage = useThreadsStore((s) => s.addMessage);

  const handleOpenProject = useCallback((id: string) => {
    openProject(id);
  }, []);

  const handleSelectThread = useCallback(
    (projectId: string, threadId: string, projectName: string) => {
      if (previewProjectId === projectId && previewThreadId === threadId) {
        setPreviewProjectId(null);
        setPreviewThreadId(null);
        return;
      }
      setPreviewProjectId(projectId);
      setPreviewThreadId(threadId);
      setPreviewProjectName(projectName);
    },
    [previewProjectId, previewThreadId],
  );

  const startNewThread = useThreadsStore((s) => s.startNewThread);
  const fetchThreads = useThreadsStore((s) => s.fetchThreads);

  const handleNewThread = useCallback(
    (projectId: string, projectName: string) => {
      const isNewProject = previewProjectId !== projectId;
      setPreviewProjectId(projectId);
      setPreviewThreadId(null);
      setPreviewProjectName(projectName);
      if (!isNewProject) {
        startNewThread();
      } else {
        fetchThreads(projectId).then(() => startNewThread());
      }
    },
    [previewProjectId, startNewThread, fetchThreads],
  );

  const handleClosePreview = useCallback(() => {
    setPreviewProjectId(null);
    setPreviewThreadId(null);
  }, []);

  const handleSendPrompt = useCallback(
    (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: { id: string; dataUrl: string; source: { type: 'base64'; media_type: string; data: string } }[]) => {
      let fullPrompt = prompt;
      if (files && files.length > 0) {
        fullPrompt = `Referenced files:\n${files.map((f) => `- ${f}`).join('\n')}\n\n${fullPrompt}`;
      }
      if (snippets && snippets.length > 0) {
        const snippetRefs = snippets.map(
          (s) => `- ${s.filePath} lines ${s.startLine}:${s.startChar}-${s.endLine}:${s.endChar}`,
        );
        fullPrompt = `Referenced code selections:\n${snippetRefs.join('\n')}\n\n${fullPrompt}`;
      }
      const metadata: Record<string, unknown> = {};
      if (files && files.length > 0) metadata.referencedFiles = files;
      if (snippets && snippets.length > 0) metadata.codeSnippets = snippets;

      const contentBlocks: { type: string; text?: string; source?: { type: 'base64'; media_type: string; data: string } }[] = [];
      if (images && images.length > 0) {
        for (const img of images) {
          contentBlocks.push({ type: 'image', source: img.source });
        }
      }
      contentBlocks.push({ type: 'text', text: prompt });

      addMessage({
        id: crypto.randomUUID(),
        taskId: threadId,
        role: 'user',
        content: contentBlocks,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        createdAt: new Date().toISOString(),
      });

      const imagePayloads = images?.map((img) => img.source);
      sendPrompt(threadId, fullPrompt, mode, model, agentType, imagePayloads);
    },
    [sendPrompt, addMessage],
  );

  const handleExecuteThread = useCallback(
    (threadId: string, mode?: string, model?: string, agentType?: string) => {
      executeThread(threadId, mode, model, agentType);
    },
    [executeThread],
  );

  return (
    <AppShell topBarTitle="Apex" showLayoutToggles={false}>
      <div className="flex flex-1 overflow-hidden relative">
        <ProjectList
          onOpenProject={handleOpenProject}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          activeProjectId={previewProjectId}
        />
        {previewProjectId && (
          <ThreadPreviewPanel
            projectId={previewProjectId}
            threadId={previewThreadId}
            projectName={previewProjectName}
            onClose={handleClosePreview}
            onSendPrompt={handleSendPrompt}
            onSendSilentPrompt={sendPrompt}
            onExecuteThread={handleExecuteThread}
            onSendUserAnswer={sendUserAnswer}
            onStopAgent={stopAgent}
          />
        )}
        <span className="absolute bottom-2 right-3 text-[10px] text-panel-text-muted/50 select-none pointer-events-none">
          v{__APP_VERSION__}
        </span>
      </div>
    </AppShell>
  );
}
