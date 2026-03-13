import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/layout/app-shell';
import { ProjectList } from '../components/projects/project-list';
import { ChatPreviewPanel } from '../components/projects/chat-preview-panel';
import { openProject } from '../lib/open-project';
import { resetProjectStores } from '../lib/reset-project-stores';
import { useAgentSocket } from '../hooks/use-agent-socket';
import { useChatsStore } from '../stores/tasks-store';
import type { CodeSelection } from '../stores/editor-store';

export function HomePage() {
  const [previewProjectId, setPreviewProjectId] = useState<string | null>(null);
  const [previewChatId, setPreviewChatId] = useState<string | null>(null);
  const [previewProjectName, setPreviewProjectName] = useState<string>('');

  useEffect(() => {
    resetProjectStores();
  }, []);

  const { sendPrompt, executeChat, sendUserAnswer } = useAgentSocket(
    previewProjectId ?? undefined,
  );

  const addMessage = useChatsStore((s) => s.addMessage);

  const handleOpenProject = useCallback((id: string) => {
    openProject(id);
  }, []);

  const handleSelectChat = useCallback(
    (projectId: string, chatId: string, projectName: string) => {
      if (previewProjectId === projectId && previewChatId === chatId) {
        setPreviewProjectId(null);
        setPreviewChatId(null);
        return;
      }
      setPreviewProjectId(projectId);
      setPreviewChatId(chatId);
      setPreviewProjectName(projectName);
    },
    [previewProjectId, previewChatId],
  );

  const handleClosePreview = useCallback(() => {
    setPreviewProjectId(null);
    setPreviewChatId(null);
  }, []);

  const handleSendPrompt = useCallback(
    (chatId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => {
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
      addMessage({
        id: crypto.randomUUID(),
        taskId: chatId,
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        createdAt: new Date().toISOString(),
      });
      sendPrompt(chatId, fullPrompt, mode, model);
    },
    [sendPrompt, addMessage],
  );

  const handleExecuteChat = useCallback(
    (chatId: string, mode?: string, model?: string) => {
      executeChat(chatId, mode, model);
    },
    [executeChat],
  );

  return (
    <AppShell topBarTitle="Apex" showLayoutToggles={false}>
      <div className="flex flex-1 overflow-hidden relative">
        <ProjectList
          onOpenProject={handleOpenProject}
          onSelectChat={handleSelectChat}
        />
        {previewProjectId && previewChatId && (
          <ChatPreviewPanel
            projectId={previewProjectId}
            chatId={previewChatId}
            projectName={previewProjectName}
            onClose={handleClosePreview}
            onSendPrompt={handleSendPrompt}
            onSendSilentPrompt={sendPrompt}
            onExecuteChat={handleExecuteChat}
            onSendUserAnswer={sendUserAnswer}
          />
        )}
      </div>
    </AppShell>
  );
}
