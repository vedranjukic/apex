import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, AlertCircle, RefreshCw, Play } from 'lucide-react';
import { projectsApi, type Project } from '../api/client';
import { AppShell } from '../components/layout/app-shell';
import { LeftSidebar } from '../components/layout/left-sidebar';
import { Sidebar } from '../components/layout/sidebar';
import { AgentThread } from '../components/agent/agent-thread';
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
import { useLspSocket } from '../hooks/use-lsp-socket';
import { useThreadsStore } from '../stores/tasks-store';
import { useProjectCommands } from '../hooks/use-project-commands';
import { useEditorStore, type CodeSelection } from '../stores/editor-store';
import type { ImageAttachment } from '../components/agent/prompt-input';
import { useAgentSettingsStore, type AgentTypeId } from '../stores/agent-settings-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useGitStore } from '../stores/git-store';
import { CodeViewer } from '../components/editor/code-viewer';
import { DiffViewer } from '../components/editor/diff-viewer';
import { LspProvider } from '../components/editor/lsp-context';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const { sendPrompt, executeThread, sendUserAnswer, stopAgent, socket } = useAgentSocket(projectId);
  const terminal = useTerminalSocket(projectId, socket);
  const { layoutReady } = useLayoutSocket(projectId, socket);
  const projectInfo = useProjectInfoSocket(projectId, socket);
  const fileActions = useFileTreeSocket(projectId, socket);
  const { search: searchFiles } = useSearchSocket(projectId, socket);
  const gitActions = useGitSocket(projectId, socket);
  const { requestPreviewUrl, forwardPort } = usePortsSocket(projectId, socket);
  useLspSocket(projectId, socket);
  const addMessage = useThreadsStore((s) => s.addMessage);
  const createThread = useThreadsStore((s) => s.createThread);
  const fetchThreads = useThreadsStore((s) => s.fetchThreads);
  const resetEditor = useEditorStore((s) => s.reset);
  const resetTerminals = useTerminalStore((s) => s.reset);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  const gitBranch = useGitStore((s) => s.branch);
  const gitStaged = useGitStore((s) => s.staged);
  const gitUnstaged = useGitStore((s) => s.unstaged);
  const gitUntracked = useGitStore((s) => s.untracked);
  const gitAhead = useGitStore((s) => s.ahead);

  const canCreatePr = (() => {
    if (!gitBranch) return false;
    const branchLower = gitBranch.toLowerCase();
    if (branchLower === 'main' || branchLower === 'master') return false;
    return gitStaged.length + gitUnstaged.length + gitUntracked.length > 0 || gitAhead > 0;
  })();

  useEffect(() => {
    resetEditor();
  }, [resetEditor]);

  useEffect(() => {
    if (projectId) {
      fetchThreads(projectId);
    }
  }, [projectId, fetchThreads]);

  // Re-fetch threads & project info when the window regains attention
  // (handles sleep/wake, window focus via focusOrOpenWindow, etc.)
  useEffect(() => {
    if (!projectId) return;
    let lastRefresh = Date.now();
    const STALE_MS = 15_000;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh < STALE_MS) return;
      lastRefresh = now;
      fetchThreads(projectId);
      projectsApi.get(projectId).then((p) => setProject(p)).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [projectId, fetchThreads]);

  const handleSendPrompt = useCallback(
    (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => {
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
      .then((p) => {
        setProject(p);
        if (p.agentType) {
          useAgentSettingsStore.getState().setAgentType(p.agentType as AgentTypeId);
        }
      })
      .finally(() => setLoading(false));

    // Reset terminal state when switching projects
    return () => {
      resetTerminals();
    };
  }, [projectId, resetTerminals]);



  const shouldPoll = project?.status === 'creating' || project?.status === 'pulling_image' || project?.status === 'stopped' || project?.status === 'starting' || project?.status === 'stopping';

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

  // Re-subscribe to the agent socket when the sandbox becomes available
  // (handles the case where the page loaded while the sandbox was still provisioning)
  const prevSandboxIdRef = useRef<string | null>(null);
  useEffect(() => {
    const sandboxId = project?.sandboxId ?? null;
    const prev = prevSandboxIdRef.current;
    prevSandboxIdRef.current = sandboxId;
    if (sandboxId && !prev && projectId && socket.current) {
      socket.current.send('subscribe_project', { projectId });
    }
  }, [project?.sandboxId, projectId, socket]);

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

  useEffect(() => {
    const s = socket.current;
    if (!s || !projectId) return;
    const handler = (data: { payload?: Project }) => {
      if (data.payload?.id === projectId) {
        setProject(data.payload);
      }
    };
    s.on('project_updated', handler);
    return () => { s.off('project_updated', handler); };
  }, [socket, projectId]);

  const handleExecuteThread = useCallback(
    (threadId: string, mode?: string, model?: string, agentType?: string) => {
      executeThread(threadId, mode, model, agentType);
    },
    [executeThread],
  );

  const handleStopSandbox = useCallback(async () => {
    if (!projectId) return;
    try {
      const updated = await projectsApi.stop(projectId);
      setProject(updated);
    } catch (err) { console.error('Failed to stop sandbox:', err); }
  }, [projectId]);

  const handleStartSandbox = useCallback(async () => {
    if (!projectId) return;
    try {
      const updated = await projectsApi.start(projectId);
      setProject(updated);
    } catch (err) { console.error('Failed to start sandbox:', err); }
  }, [projectId]);

  const handleRestartSandbox = useCallback(async () => {
    if (!projectId) return;
    try {
      const updated = await projectsApi.restart(projectId);
      setProject(updated);
    } catch (err) { console.error('Failed to restart sandbox:', err); }
  }, [projectId]);

  const handleAnalyzeGitignore = useCallback(
    async (prompt: string) => {
      if (!projectId) return;
      const thread = await createThread(projectId, { prompt });
      executeThread(thread.id, 'agent');
    },
    [projectId, createThread, executeThread],
  );

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <Loader2 style={{ width: 32, height: 32, color: '#60a5fa', animation: 'spin 1s linear infinite' }} />
      </div>
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
      leftSidebar={<LeftSidebar projectId={projectId} fileActions={fileActions} gitActions={gitActions} searchFiles={searchFiles} readFile={fileActions.readFile} socket={socket} sendPrompt={sendPrompt} onAnalyzeGitignore={handleAnalyzeGitignore} />}
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
          forwardPort={forwardPort}
          provider={project.provider}
        />
      }
      statusBar={
        <ProjectStatusBar
          project={project}
          info={projectInfo}
          gitActions={gitActions}
          onStop={handleStopSandbox}
          onStart={handleStartSandbox}
          onRestart={handleRestartSandbox}
        />
      }
    >
      {/* Loading overlay while sandbox provisions, starts, or layout restores */}
      {(project.status === 'creating' || project.status === 'pulling_image' || project.status === 'starting' || project.status === 'stopping' || project.status === 'stopped' || project.status === 'error' || !layoutReady) && (
        <SandboxOverlay project={project} provisionMsg={provisionMsg} onStart={handleStartSandbox} onRestart={handleRestartSandbox} />
      )}
      <LspProvider socket={socket} projectId={projectId}>
        <CentralPanel
          projectId={projectId}
          projectAgentType={project.agentType}
          githubContext={project.githubContext}
          onSendPrompt={handleSendPrompt}
          onSendSilentPrompt={sendPrompt}
          onExecuteThread={handleExecuteThread}
          onSendUserAnswer={sendUserAnswer}
          onStopAgent={stopAgent}
          readFile={fileActions.readFile}
          writeFile={fileActions.writeFile}
          requestListing={fileActions.requestListing}
          canCreatePr={canCreatePr}
          projectDir={projectInfo.projectDir}
        />
      </LspProvider>
    </AppShell>
  );
}

function CentralPanel({
  projectId,
  projectAgentType,
  githubContext,
  onSendPrompt,
  onSendSilentPrompt,
  onExecuteThread,
  onSendUserAnswer,
  onStopAgent,
  readFile,
  writeFile,
  requestListing,
  canCreatePr,
  projectDir,
}: {
  projectId: string;
  projectAgentType?: string;
  githubContext?: import('../api/client').GitHubContextData | null;
  onSendPrompt: (threadId: string, prompt: string, files?: string[], mode?: string, model?: string, snippets?: CodeSelection[], agentType?: string, images?: ImageAttachment[]) => void;
  onSendSilentPrompt: (threadId: string, prompt: string, mode?: string, model?: string, agentType?: string) => void;
  onExecuteThread: (threadId: string, mode?: string, model?: string, agentType?: string) => void;
  onSendUserAnswer: (threadId: string, toolUseId: string, answer: string) => void;
  onStopAgent: (threadId: string) => void;
  readFile: (path: string) => void;
  writeFile: (path: string, content: string) => void;
  requestListing: (path: string) => void;
  canCreatePr?: boolean;
  projectDir?: string | null;
}) {
  const activeView = useEditorStore((s) => s.activeView);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const fileContents = useEditorStore((s) => s.fileContents);

  useEffect(() => {
    if (activeView === 'editor' && activeFilePath && !(activeFilePath in fileContents)) {
      readFile(activeFilePath);
    }
  }, [activeView, activeFilePath, fileContents, readFile]);

  if (activeView === 'diff') {
    return <DiffViewer />;
  }

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
    <AgentThread
      projectId={projectId}
      projectAgentType={projectAgentType}
      githubContext={githubContext}
      onSendPrompt={onSendPrompt}
      onSendSilentPrompt={onSendSilentPrompt}
      onExecuteThread={onExecuteThread}
      onSendUserAnswer={onSendUserAnswer}
      onStopAgent={onStopAgent}
      requestListing={requestListing}
      canCreatePr={canCreatePr}
      projectDir={projectDir}
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

function SandboxOverlay({ project, provisionMsg, onStart, onRestart }: { project: Project; provisionMsg: string | null; onStart?: () => void; onRestart?: () => void }) {
  const isError = project.status === 'error';
  const isStopped = project.status === 'stopped';
  const sandboxMissing = !project.sandboxId && (isStopped || isError);

  const isStopping = project.status === 'stopping';
  const statusMessage = provisionMsg
    ? provisionMsg
    : project.status === 'pulling_image'
      ? 'Pulling container image… This may take a few minutes.'
      : project.status === 'creating'
        ? 'Provisioning sandbox environment…'
        : project.status === 'starting'
          ? 'Starting sandbox…'
          : isStopping
            ? 'Stopping sandbox…'
            : isStopped && !project.sandboxId
              ? 'No sandbox provisioned.'
              : isStopped
                ? 'Sandbox is stopped.'
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
          {isStopped && onStart && (
            <button
              onClick={onStart}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors"
            >
              <Play className="w-3 h-3" />
              Start
            </button>
          )}
          {isError && onRestart && (
            <button
              onClick={onRestart}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Restart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
