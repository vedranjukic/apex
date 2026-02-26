import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react';
import { projectsApi, type Project } from '../api/client';
import { AppShell } from '../components/layout/app-shell';
import { LeftSidebar } from '../components/layout/left-sidebar';
import { Sidebar } from '../components/layout/sidebar';
import { AgentChat } from '../components/agent/agent-chat';
import { TerminalPanel } from '../components/terminal/terminal-panel';
import { ProjectStatusBar } from '../components/layout/project-status-bar';
import { useAgentSocket } from '../hooks/use-agent-socket';
import { useTerminalSocket } from '../hooks/use-terminal-socket';
import { useLayoutSocket } from '../hooks/use-layout-socket';
import { useProjectInfoSocket } from '../hooks/use-project-info-socket';
import { useFileTreeSocket } from '../hooks/use-file-tree-socket';
import { useSearchSocket } from '../hooks/use-search-socket';
import { useGitSocket } from '../hooks/use-git-socket';
import { usePortsSocket } from '../hooks/use-ports-socket';
import { useChatsStore } from '../stores/tasks-store';
import { useProjectCommands } from '../hooks/use-project-commands';
import { useEditorStore, type CodeSelection } from '../stores/editor-store';
import { CodeViewer } from '../components/editor/code-viewer';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const { sendPrompt, executeChat, sendUserAnswer, socket } = useAgentSocket(projectId);
  const terminal = useTerminalSocket(projectId, socket);
  const { layoutReady } = useLayoutSocket(projectId, socket);
  const projectInfo = useProjectInfoSocket(projectId, socket);
  const fileActions = useFileTreeSocket(projectId, socket);
  const { search: searchFiles } = useSearchSocket(projectId, socket);
  const gitActions = useGitSocket(projectId, socket);
  const { requestPreviewUrl } = usePortsSocket(projectId, socket);
  const addMessage = useChatsStore((s) => s.addMessage);
  const resetEditor = useEditorStore((s) => s.reset);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  useEffect(() => {
    resetEditor();
  }, [resetEditor]);

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

  useProjectCommands({
    createTerminal: terminal.createTerminal,
    sendPrompt: handleSendPrompt,
    writeFile: fileActions.writeFile,
  });

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    projectsApi
      .get(projectId)
      .then(setProject)
      .finally(() => setLoading(false));
  }, [projectId]);



  const shouldPoll = project?.status === 'creating' || project?.status === 'stopped' || project?.status === 'starting';

  useEffect(() => {
    if (!projectId || !project || !shouldPoll) {
      clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const updated = await projectsApi.get(projectId);
        setProject(updated);
        if (updated.status === 'running' || updated.status === 'error') {
          clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [projectId, shouldPoll]);

  useEffect(() => {
    const s = socket.current;
    if (!s || !projectId) return;
    const handler = (data: { projectId?: string; message?: string; status?: string }) => {
      if (data.projectId === projectId && data.message) {
        setProvisionMsg(data.message);
      }
    };
    s.on('agent_status', handler);
    return () => { s.off('agent_status', handler); };
  }, [socket, projectId]);

  const handleExecuteChat = useCallback(
    (chatId: string, mode?: string, model?: string) => {
      executeChat(chatId, mode, model);
    },
    [executeChat],
  );

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-white/60" />
        </div>
      </AppShell>
    );
  }

  if (!project || !projectId) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-sm text-white/70">Project not found</p>
          <BackToProjectsButton />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      projectName={project.name}
      leftSidebar={<LeftSidebar projectId={projectId} fileActions={fileActions} gitActions={gitActions} searchFiles={searchFiles} readFile={fileActions.readFile} socket={socket} sendPrompt={sendPrompt} />}
      sidebar={<Sidebar projectId={projectId} />}
      terminalPanel={
        <TerminalPanel
          projectId={projectId}
          sandboxReady={project.status === 'running' && !!project.sandboxId}
          createTerminal={terminal.createTerminal}
          sendInput={terminal.sendInput}
          resize={terminal.resize}
          closeTerminal={terminal.closeTerminal}
          registerXterm={terminal.registerXterm}
          unregisterXterm={terminal.unregisterXterm}
          requestPreviewUrl={requestPreviewUrl}
        />
      }
      statusBar={
        <ProjectStatusBar
          project={project}
          info={projectInfo}
          gitActions={gitActions}
        />
      }
    >
      {/* Loading overlay while sandbox provisions, starts, or layout restores */}
      {(project.status === 'creating' || project.status === 'starting' || project.status === 'stopped' || project.status === 'error' || !layoutReady) && (
        <SandboxOverlay project={project} provisionMsg={provisionMsg} />
      )}
      <CentralPanel
        projectId={projectId}
        onSendPrompt={handleSendPrompt}
        onSendSilentPrompt={sendPrompt}
        onExecuteChat={handleExecuteChat}
        onSendUserAnswer={sendUserAnswer}
        readFile={fileActions.readFile}
        writeFile={fileActions.writeFile}
        requestListing={fileActions.requestListing}
      />
    </AppShell>
  );
}

function CentralPanel({
  projectId,
  onSendPrompt,
  onSendSilentPrompt,
  onExecuteChat,
  onSendUserAnswer,
  readFile,
  writeFile,
  requestListing,
}: {
  projectId: string;
  onSendPrompt: (chatId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[]) => void;
  onSendSilentPrompt: (chatId: string, prompt: string, mode?: string, model?: string) => void;
  onExecuteChat: (chatId: string, mode?: string, model?: string) => void;
  onSendUserAnswer: (chatId: string, toolUseId: string, answer: string) => void;
  readFile: (path: string) => void;
  writeFile: (path: string, content: string) => void;
  requestListing: (path: string) => void;
}) {
  const activeView = useEditorStore((s) => s.activeView);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const fileContents = useEditorStore((s) => s.fileContents);

  useEffect(() => {
    if (activeView === 'editor' && activeFilePath && !(activeFilePath in fileContents)) {
      readFile(activeFilePath);
    }
  }, [activeView, activeFilePath, fileContents, readFile]);

  if (activeView === 'editor' && activeFilePath) {
    return (
      <CodeViewer
        filePath={activeFilePath}
        content={fileContents[activeFilePath]}
        onSave={writeFile}
      />
    );
  }

  return (
    <AgentChat
      projectId={projectId}
      onSendPrompt={onSendPrompt}
      onSendSilentPrompt={onSendSilentPrompt}
      onExecuteChat={onExecuteChat}
      onSendUserAnswer={onSendUserAnswer}
      requestListing={requestListing}
    />
  );
}

function BackToProjectsButton() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/')}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/20 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
    >
      <ArrowLeft className="w-3 h-3" />
      Back to projects
    </button>
  );
}

function SandboxOverlay({ project, provisionMsg }: { project: Project; provisionMsg: string | null }) {
  const isError = project.status === 'error';
  const isStopped = project.status === 'stopped';
  const sandboxMissing = !project.sandboxId && (isStopped || isError);

  const statusMessage = provisionMsg
    ? provisionMsg
    : project.status === 'creating'
      ? 'Provisioning sandbox environment…'
      : project.status === 'starting'
        ? 'Starting sandbox…'
        : isStopped && !project.sandboxId
          ? 'No sandbox provisioned. Attempting to create one…'
          : isStopped
            ? 'Sandbox is stopped. Starting…'
            : isError
              ? project.statusError || 'Unknown sandbox error'
              : 'Restoring workspace…';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', maxWidth: '400px', textAlign: 'center', padding: '0 24px' }}>
        {isError ? (
          <AlertCircle style={{ width: 32, height: 32, color: '#f87171' }} />
        ) : (
          <Loader2 style={{ width: 32, height: 32, color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
        )}

        <div>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', marginBottom: 4 }}>
            {isError ? 'Sandbox Error' : sandboxMissing ? 'Setting up sandbox' : 'Loading project'}
          </p>
          <p style={{ fontSize: 12, color: '#9ca3af' }}>
            {statusMessage}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <BackToProjectsButton />
          {isError && (
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
