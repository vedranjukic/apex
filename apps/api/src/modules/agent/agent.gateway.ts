import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ProjectsService } from '../projects/projects.service';
import { ProjectsGateway } from '../projects/projects.gateway';
import { ChatsService } from '../tasks/tasks.service';
import { BridgeMessage, LayoutData, FileEntry, SearchResult } from '@apex/orchestrator';
import { execFile } from 'child_process';

const SANDBOX_HOME = '/home/daytona';

function resolveProjectDir(projectName: string | null | undefined): string {
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

@WebSocketGateway({
  namespace: '/ws/agent',
  path: '/ws/socket.io',
  cors: { origin: '*' },
})
export class AgentGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AgentGateway.name);

  private sandboxSubscribers = new Map<string, Set<string>>();
  private activeHandlers = new Map<
    string,
    (sandboxId: string, msg: BridgeMessage) => void
  >();

  /** Track which sandboxes already have terminal event listeners attached */
  private terminalListenersBySandbox = new Set<string>();

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectsGateway: ProjectsGateway,
    private readonly chatsService: ChatsService,
  ) {}

  /**
   * Update chat status and broadcast the parent project so the
   * project list reflects chat activity changes in real time.
   */
  private async updateChatStatusAndNotify(
    chatId: string,
    status: string,
  ): Promise<void> {
    const chat = await this.chatsService.updateStatus(chatId, status);
    try {
      const project = await this.projectsService.findById(chat.projectId);
      this.projectsGateway.notifyUpdated(project);
    } catch (err) {
      this.logger.debug(`Failed to notify project for chat ${chatId}: ${err}`);
    }
  }

  afterInit() {
    this.logger.log('AgentGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    for (const [sandboxId, subs] of this.sandboxSubscribers) {
      subs.delete(client.id);
      if (subs.size === 0) this.sandboxSubscribers.delete(sandboxId);
    }
  }

  // ── Chat / Agent Events ────────────────────────────────

  @SubscribeMessage('send_prompt')
  async handleSendPrompt(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string; prompt: string; mode?: string; model?: string },
  ) {
    const { chatId, prompt, mode, model } = payload;
    this.logger.log(`send_prompt: chatId=${chatId} mode=${mode ?? 'agent'} model=${model ?? 'default'} prompt="${prompt.slice(0, 60)}..."`);

    try {
      if (mode === 'plan') {
        await this.chatsService.updateMode(chatId, mode);
      }

      await this.chatsService.addMessage(chatId, {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      });

      await this.executeAgainstSandbox(client, chatId, prompt, mode, model);
    } catch (err) {
      this.logger.error(`send_prompt error: ${err}`);
      client.emit('agent_error', { chatId, error: String(err) });
    }
  }

  @SubscribeMessage('execute_chat')
  async handleExecuteChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatId: string; mode?: string; model?: string },
  ) {
    const { chatId, mode, model } = payload;
    this.logger.log(`execute_chat: chatId=${chatId}`);

    try {
      if (mode === 'plan') {
        await this.chatsService.updateMode(chatId, mode);
      }

      const chat = await this.chatsService.findById(chatId);

      const firstUserMsg = chat.messages?.find((m) => m.role === 'user');
      if (!firstUserMsg) {
        this.logger.warn(`execute_chat: no user message for chat ${chatId}`);
        client.emit('agent_error', { chatId, error: 'No user message found' });
        return;
      }

      const prompt =
        firstUserMsg.content
          ?.filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n') || '';

      if (!prompt) {
        this.logger.warn(`execute_chat: empty prompt for chat ${chatId}`);
        client.emit('agent_error', { chatId, error: 'Empty prompt' });
        return;
      }

      this.logger.log(`execute_chat: extracted prompt "${prompt.slice(0, 60)}..."`);
      await this.executeAgainstSandbox(client, chatId, prompt, mode, model);
    } catch (err) {
      this.logger.error(`execute_chat error: ${err}`);
      client.emit('agent_error', { chatId, error: String(err) });
    }
  }

  @SubscribeMessage('user_answer')
  async handleUserAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      chatId: string;
      toolUseId: string;
      answer: string;
    },
  ) {
    const { chatId, toolUseId, answer } = payload;
    this.logger.log(`user_answer: chatId=${chatId} toolUseId=${toolUseId}`);

    try {
      const chat = await this.chatsService.findById(chatId);
      const project = await this.projectsService.findById(chat.projectId);

      if (!project.sandboxId) {
        client.emit('agent_error', { chatId, error: 'No sandbox for this project' });
        return;
      }

      const manager = this.projectsService.getSandboxManager();
      if (!manager) {
        client.emit('agent_error', { chatId, error: 'Sandbox manager not available' });
        return;
      }

      await manager.sendUserAnswer(project.sandboxId, chatId, toolUseId, answer);

      // Persist the user's answer so it survives refresh
      await this.chatsService.addMessage(chatId, {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: answer,
          },
        ],
        metadata: null,
      });
    } catch (err) {
      this.logger.error(`user_answer error: ${err}`);
      client.emit('agent_error', { chatId, error: String(err) });
    }
  }

  @SubscribeMessage('subscribe_project')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    this.logger.log(`subscribe_project: projectId=${payload.projectId}`);
    try {
      let project = await this.projectsService.findById(payload.projectId);
      this.logger.log(`subscribe_project: status=${project.status} sandboxId=${project.sandboxId}`);

      if (project.sandboxId) {
        this.subscribeTo(project.sandboxId, client.id);
        this.attachTerminalListeners(project.sandboxId);

        if (project.status === 'stopped' || project.status === 'error') {
          this.logger.log(`subscribe_project: sandbox is ${project.status}, attempting reconcile + start`);
          this.reconcileAndStart(payload.projectId).catch((err) => {
            this.logger.error(`Background sandbox reconcile/start failed: ${err}`);
          });
        } else {
          // Pre-warm the bridge WS connection so terminal_list and other
          // WS-dependent operations don't have to wait for the full reconnect.
          const manager = this.projectsService.getSandboxManager();
          if (manager) {
            this.resolveDirName(project).then((dirName) => {
              manager.reconnectSandbox(project.sandboxId!, dirName).catch((err) => {
                this.logger.debug(`Background bridge pre-warm failed: ${err}`);
              });
            });
          }
          this.projectsService.reconcileSandboxStatus(payload.projectId).catch(() => {});
        }
      } else if (project.status === 'stopped' || project.status === 'error') {
        this.logger.log(`subscribe_project: no sandbox, attempting provision`);
        client.emit('agent_status', {
          projectId: payload.projectId,
          status: 'provisioning',
          message: 'Sandbox was not provisioned. Provisioning now...',
        });
        this.projectsService.startOrProvisionSandbox(payload.projectId).catch((err) => {
          this.logger.error(`Background sandbox provision failed: ${err}`);
          client.emit('agent_status', {
            projectId: payload.projectId,
            status: 'error',
            message: `Failed to provision sandbox: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
      } else {
        this.logger.log(`subscribe_project: project has no sandbox yet (status: ${project.status})`);
      }

      client.emit('subscribed', {
        projectId: payload.projectId,
        sandboxId: project.sandboxId,
      });
    } catch (err) {
      this.logger.error(`subscribe_project error: ${err}`);
      client.emit('error', { message: String(err) });
    }
  }

  // ── Terminal Events ────────────────────────────────────

  @SubscribeMessage('terminal_create')
  async handleTerminalCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      projectId: string;
      terminalId: string;
      cols: number;
      rows: number;
      name?: string;
    },
  ) {
    this.logger.log(`terminal_create: terminalId=${payload.terminalId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);

      if (!resolved) {
        client.emit('terminal_error', {
          terminalId: payload.terminalId,
          error: 'Sandbox is not ready yet. Please wait for the project to finish provisioning.',
        });
        return;
      }

      const { sandboxId, manager, project } = resolved;
      this.subscribeTo(sandboxId, client.id);
      this.attachTerminalListeners(sandboxId);

      const dirName = await this.resolveDirName(project);
      const cwd = resolveProjectDir(dirName);

      await Promise.race([
        manager.createTerminal(
          sandboxId,
          payload.terminalId,
          payload.cols,
          payload.rows,
          cwd,
          payload.name,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Terminal creation timed out — sandbox bridge may be unavailable')), 15_000),
        ),
      ]);
    } catch (err) {
      this.logger.error(`terminal_create error: ${err}`);
      client.emit('terminal_error', {
        terminalId: payload.terminalId,
        error: String(err),
      });
    }
  }

  @SubscribeMessage('terminal_input')
  async handleTerminalInput(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { projectId: string; terminalId: string; data: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) return;

      await resolved.manager.sendTerminalInput(
        resolved.sandboxId,
        payload.terminalId,
        payload.data,
      );
    } catch (err) {
      this.logger.error(`terminal_input error: ${err}`);
    }
  }

  @SubscribeMessage('terminal_resize')
  async handleTerminalResize(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      projectId: string;
      terminalId: string;
      cols: number;
      rows: number;
    },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) return;

      await resolved.manager.resizeTerminal(
        resolved.sandboxId,
        payload.terminalId,
        payload.cols,
        payload.rows,
      );
    } catch (err) {
      this.logger.error(`terminal_resize error: ${err}`);
    }
  }

  @SubscribeMessage('terminal_close')
  async handleTerminalClose(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; terminalId: string },
  ) {
    this.logger.log(`terminal_close: terminalId=${payload.terminalId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) return;

      await resolved.manager.closeTerminal(resolved.sandboxId, payload.terminalId);
    } catch (err) {
      this.logger.error(`terminal_close error: ${err}`);
    }
  }

  @SubscribeMessage('terminal_list')
  async handleTerminalList(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    this.logger.log(`terminal_list: projectId=${payload.projectId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);

      if (resolved) {
        const { sandboxId, manager } = resolved;
        this.subscribeTo(sandboxId, client.id);
        this.attachTerminalListeners(sandboxId);
        const timedOut = await Promise.race([
          manager.listTerminals(sandboxId).then(() => false),
          new Promise<boolean>((r) => setTimeout(() => r(true), 10_000)),
        ]);
        if (timedOut) {
          client.emit('terminal_list', { terminals: [] });
        }
      } else {
        client.emit('terminal_list', { terminals: [] });
      }
    } catch (err) {
      this.logger.error(`terminal_list error: ${err}`);
      client.emit('terminal_list', { terminals: [] });
    }
  }

  // ── Port Events ─────────────────────────────────────────

  @SubscribeMessage('port_preview_url')
  async handlePortPreviewUrl(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; port: number },
  ) {
    this.logger.log(`port_preview_url: port=${payload.port}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        client.emit('port_preview_url_result', {
          port: payload.port,
          error: 'Sandbox is not ready',
        });
        return;
      }

      const { url, token } = await resolved.manager.getPortPreviewUrl(
        resolved.sandboxId,
        payload.port,
      );
      client.emit('port_preview_url_result', { port: payload.port, url, token });
    } catch (err) {
      this.logger.error(`port_preview_url error: ${err}`);
      client.emit('port_preview_url_result', {
        port: payload.port,
        error: String(err),
      });
    }
  }

  // ── Project Info Events ────────────────────────────────

  @SubscribeMessage('project_info')
  async handleProjectInfo(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    this.logger.debug(`project_info: projectId=${payload.projectId}`);
    try {
      // Try sandbox first (live branch from cloned repo)
      const resolved = await this.tryResolveProject(payload.projectId);
      const project = await this.projectsService.findById(payload.projectId);

      const dirName = await this.resolveDirName(project);
      const projectDir = project.sandboxId
        ? resolveProjectDir(dirName)
        : null;

      // Emit an early response so the file tree can start loading
      // while we resolve the (potentially slow) git branch
      if (projectDir) {
        client.emit('project_info', { gitBranch: null, projectDir });
      }

      // Now try to resolve git branch (may reconnect to sandbox)
      let gitBranch: string | null = null;
      if (resolved) {
        try {
          gitBranch = await resolved.manager.getGitBranch(resolved.sandboxId);
        } catch (err) {
          this.logger.debug(`project_info: getGitBranch failed: ${err}`);
        }
      }
      if (!gitBranch && project.gitRepo) {
        gitBranch = await this.resolveDefaultBranch(project.gitRepo);
      }

      client.emit('project_info', { gitBranch, projectDir });
    } catch (err) {
      this.logger.error(`project_info error: ${err}`);
      client.emit('project_info', { gitBranch: null, projectDir: null });
    }
  }

  /** Resolve the default branch of a remote git repo without cloning */
  private resolveDefaultBranch(repoUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        'git',
        ['ls-remote', '--symref', repoUrl, 'HEAD'],
        { timeout: 10_000 },
        (err, stdout) => {
          if (err) {
            this.logger.debug(`git ls-remote failed for ${repoUrl}: ${err.message}`);
            resolve(null);
            return;
          }
          // Output: "ref: refs/heads/main\tHEAD\n..."
          const match = stdout.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
          resolve(match ? match[1] : null);
        },
      );
    });
  }

  // ── File System Events ─────────────────────────────────

  @SubscribeMessage('file_list')
  async handleFileList(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; path: string },
  ) {
    this.logger.debug(`file_list: projectId=${payload.projectId} path=${payload.path}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        client.emit('file_list_result', { path: payload.path, entries: [], error: 'Sandbox not ready' });
        return;
      }

      const timeoutMs = 30_000;
      const entries: FileEntry[] = await Promise.race([
        resolved.manager.listFiles(resolved.sandboxId, payload.path),
        new Promise<FileEntry[]>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for sandbox')), timeoutMs),
        ),
      ]);
      this.logger.log(`file_list: ${payload.path} returned ${entries.length} entries`);
      client.emit('file_list_result', { path: payload.path, entries });
    } catch (err) {
      this.logger.error(`file_list error: ${err}`);
      client.emit('file_list_result', { path: payload.path, entries: [], error: String(err) });
    }
  }

  @SubscribeMessage('file_create')
  async handleFileCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; path: string; isDirectory: boolean },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('file_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      if (payload.isDirectory) {
        await resolved.manager.createFolder(resolved.sandboxId, payload.path);
      } else {
        await resolved.manager.createFile(resolved.sandboxId, payload.path);
      }
      client.emit('file_op_result', { ok: true, op: 'create', path: payload.path });
    } catch (err) {
      client.emit('file_op_result', { ok: false, error: String(err) });
    }
  }

  @SubscribeMessage('file_rename')
  async handleFileRename(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; oldPath: string; newPath: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('file_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.renameFile(resolved.sandboxId, payload.oldPath, payload.newPath);
      client.emit('file_op_result', { ok: true, op: 'rename', oldPath: payload.oldPath, newPath: payload.newPath });
    } catch (err) {
      client.emit('file_op_result', { ok: false, error: String(err) });
    }
  }

  @SubscribeMessage('file_delete')
  async handleFileDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; path: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('file_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.deleteFile(resolved.sandboxId, payload.path);
      client.emit('file_op_result', { ok: true, op: 'delete', path: payload.path });
    } catch (err) {
      client.emit('file_op_result', { ok: false, error: String(err) });
    }
  }

  @SubscribeMessage('file_read')
  async handleFileRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; path: string },
  ) {
    this.logger.debug(`file_read: projectId=${payload.projectId} path=${payload.path}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        client.emit('file_read_result', { path: payload.path, content: '', error: 'Sandbox not ready' });
        return;
      }

      const timeoutMs = 30_000;
      const content: string = await Promise.race([
        resolved.manager.readFile(resolved.sandboxId, payload.path),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for sandbox')), timeoutMs),
        ),
      ]);
      this.logger.log(`file_read: ${payload.path} returned ${content.length} chars`);
      client.emit('file_read_result', { path: payload.path, content });
    } catch (err) {
      this.logger.error(`file_read error: ${err}`);
      client.emit('file_read_result', { path: payload.path, content: '', error: String(err) });
    }
  }

  @SubscribeMessage('file_write')
  async handleFileWrite(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; path: string; content: string },
  ) {
    this.logger.debug(`file_write: projectId=${payload.projectId} path=${payload.path}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        client.emit('file_write_result', { ok: false, path: payload.path, error: 'Sandbox not ready' });
        return;
      }
      await resolved.manager.writeFile(resolved.sandboxId, payload.path, payload.content);
      this.logger.log(`file_write: ${payload.path} written (${payload.content.length} chars)`);
      client.emit('file_write_result', { ok: true, path: payload.path });
    } catch (err) {
      this.logger.error(`file_write error: ${err}`);
      client.emit('file_write_result', { ok: false, path: payload.path, error: String(err) });
    }
  }

  @SubscribeMessage('file_search')
  async handleFileSearch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      projectId: string;
      query: string;
      matchCase?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      includePattern?: string;
      excludePattern?: string;
    },
  ) {
    this.logger.log(`file_search: projectId=${payload.projectId} query="${payload.query.slice(0, 40)}"`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        client.emit('file_search_result', { query: payload.query, results: [], error: 'Sandbox not ready' });
        return;
      }

      const project = await this.projectsService.findById(payload.projectId);
      const searchDirName = await this.resolveDirName(project);
      const searchDir = resolved.manager.getProjectDir(resolved.sandboxId, searchDirName);
      this.logger.log(`file_search: searching in ${searchDir}`);

      const timeoutMs = 30_000;
      const results: SearchResult[] = await Promise.race([
        resolved.manager.searchFiles(resolved.sandboxId, payload.query, searchDir, {
          matchCase: payload.matchCase,
          wholeWord: payload.wholeWord,
          useRegex: payload.useRegex,
          includePattern: payload.includePattern,
          excludePattern: payload.excludePattern,
        }),
        new Promise<SearchResult[]>((_, reject) =>
          setTimeout(() => reject(new Error('Search timeout')), timeoutMs),
        ),
      ]);
      this.logger.log(`file_search: "${payload.query}" returned ${results.length} files`);
      client.emit('file_search_result', { query: payload.query, results });
    } catch (err) {
      this.logger.error(`file_search error: ${err}`);
      client.emit('file_search_result', { query: payload.query, results: [], error: String(err) });
    }
  }

  @SubscribeMessage('file_move')
  async handleFileMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; sourcePath: string; destPath: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('file_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.renameFile(resolved.sandboxId, payload.sourcePath, payload.destPath);
      client.emit('file_op_result', { ok: true, op: 'move', sourcePath: payload.sourcePath, destPath: payload.destPath });
    } catch (err) {
      client.emit('file_op_result', { ok: false, error: String(err) });
    }
  }

  // ── Git Events ─────────────────────────────────────────

  @SubscribeMessage('git_status')
  async handleGitStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    this.logger.log(`git_status: projectId=${payload.projectId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        this.logger.warn('git_status: sandbox not resolved');
        client.emit('git_status_result', { branch: null, staged: [], unstaged: [], untracked: [], conflicted: [], ahead: 0, behind: 0, error: 'Sandbox not ready' });
        return;
      }
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      this.logger.log(`git_status: branch=${status.branch} staged=${status.staged.length} unstaged=${status.unstaged.length} untracked=${status.untracked.length}`);
      client.emit('git_status_result', status);
    } catch (err) {
      this.logger.error(`git_status error: ${err}`);
      client.emit('git_status_result', { branch: null, staged: [], unstaged: [], untracked: [], conflicted: [], ahead: 0, behind: 0, error: String(err) });
    }
  }

  @SubscribeMessage('git_stage')
  async handleGitStage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; paths: string[] },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.gitStage(resolved.sandboxId, payload.paths);
      client.emit('git_op_result', { ok: true, op: 'stage' });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'stage', error: String(err) });
    }
  }

  @SubscribeMessage('git_unstage')
  async handleGitUnstage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; paths: string[] },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.gitUnstage(resolved.sandboxId, payload.paths);
      client.emit('git_op_result', { ok: true, op: 'unstage' });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'unstage', error: String(err) });
    }
  }

  @SubscribeMessage('git_discard')
  async handleGitDiscard(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; paths: string[] },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      await resolved.manager.gitDiscard(resolved.sandboxId, payload.paths);
      client.emit('git_op_result', { ok: true, op: 'discard' });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'discard', error: String(err) });
    }
  }

  @SubscribeMessage('git_commit')
  async handleGitCommit(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; message: string; stageAll?: boolean },
  ) {
    this.logger.log(`git_commit: projectId=${payload.projectId} stageAll=${!!payload.stageAll} msg="${payload.message.slice(0, 40)}"`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      if (payload.stageAll) {
        await resolved.manager.gitStage(resolved.sandboxId, ['.']);
      }
      const output = await resolved.manager.gitCommit(resolved.sandboxId, payload.message);
      client.emit('git_op_result', { ok: true, op: 'commit', output });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      this.logger.error(`git_commit error: ${err}`);
      client.emit('git_op_result', { ok: false, op: 'commit', error: String(err) });
    }
  }

  @SubscribeMessage('git_push')
  async handleGitPush(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      const output = await resolved.manager.gitPush(resolved.sandboxId);
      client.emit('git_op_result', { ok: true, op: 'push', output });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'push', error: String(err) });
    }
  }

  @SubscribeMessage('git_pull')
  async handleGitPull(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      const output = await resolved.manager.gitPull(resolved.sandboxId);
      client.emit('git_op_result', { ok: true, op: 'pull', output });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'pull', error: String(err) });
    }
  }

  @SubscribeMessage('git_branches')
  async handleGitBranches(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_branches_result', { branches: [], error: 'Sandbox not ready' }); return; }
      const branches = await resolved.manager.listBranches(resolved.sandboxId);
      client.emit('git_branches_result', { branches });
    } catch (err) {
      client.emit('git_branches_result', { branches: [], error: String(err) });
    }
  }

  @SubscribeMessage('git_create_branch')
  async handleGitCreateBranch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; name: string; startPoint?: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      const output = await resolved.manager.gitCreateBranch(resolved.sandboxId, payload.name, payload.startPoint);
      client.emit('git_op_result', { ok: true, op: 'create_branch', output });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
      const branches = await resolved.manager.listBranches(resolved.sandboxId);
      client.emit('git_branches_result', { branches });
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'create_branch', error: String(err) });
    }
  }

  @SubscribeMessage('git_checkout')
  async handleGitCheckout(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; ref: string },
  ) {
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) { client.emit('git_op_result', { ok: false, error: 'Sandbox not ready' }); return; }
      const output = await resolved.manager.gitCheckout(resolved.sandboxId, payload.ref);
      client.emit('git_op_result', { ok: true, op: 'checkout', output });
      const status = await resolved.manager.getGitStatus(resolved.sandboxId);
      client.emit('git_status_result', status);
      const branches = await resolved.manager.listBranches(resolved.sandboxId);
      client.emit('git_branches_result', { branches });
    } catch (err) {
      client.emit('git_op_result', { ok: false, op: 'checkout', error: String(err) });
    }
  }

  // ── Layout Persistence Events ──────────────────────────

  @SubscribeMessage('layout_save')
  async handleLayoutSave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string; layout: LayoutData },
  ) {
    this.logger.debug(`layout_save: projectId=${payload.projectId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        this.logger.warn('layout_save: no sandbox available');
        return;
      }
      await resolved.manager.saveLayout(resolved.sandboxId, payload.layout);
    } catch (err) {
      this.logger.error(`layout_save error: ${err}`);
    }
  }

  @SubscribeMessage('layout_load')
  async handleLayoutLoad(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { projectId: string },
  ) {
    this.logger.debug(`layout_load: projectId=${payload.projectId}`);
    try {
      const resolved = await this.tryResolveProject(payload.projectId);
      if (!resolved) {
        this.logger.debug('layout_load: no sandbox available');
        client.emit('layout_data', { data: null });
        return;
      }

      const data = await Promise.race([
        resolved.manager.loadLayout(resolved.sandboxId),
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ]);
      client.emit('layout_data', { data });
    } catch (err) {
      this.logger.error(`layout_load error: ${err}`);
      client.emit('layout_data', { data: null });
    }
  }

  // ── Core execution logic ──────────────────────────────

  /** Active timeout handles so we can clear them on response / cleanup */
  private activeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly AGENT_INITIAL_TIMEOUT_MS = 90_000; // 90s for first response
  private static readonly AGENT_ACTIVITY_TIMEOUT_MS = 300_000; // 5 min between messages

  private async executeAgainstSandbox(
    client: Socket,
    chatId: string,
    prompt: string,
    mode?: string,
    model?: string,
  ): Promise<void> {
    const chat = await this.chatsService.findById(chatId);
    const project = await this.projectsService.findById(chat.projectId);

    if (!project.sandboxId) {
      this.logger.warn(`No sandbox for project ${project.id}`);
      client.emit('agent_error', {
        chatId,
        error: 'Project sandbox not ready – is it still provisioning?',
      });
      return;
    }

    const manager = this.projectsService.getSandboxManager();
    if (!manager) {
      this.logger.warn('SandboxManager not available');
      client.emit('agent_error', {
        chatId,
        error: 'Sandbox manager not available – check Daytona configuration',
      });
      return;
    }

    manager.registerProjectName(project.sandboxId, project.name);
    this.subscribeTo(project.sandboxId, client.id);

    await this.updateChatStatusAndNotify(chatId, 'running');
    this.emitToSubscribers(project.sandboxId, 'agent_status', {
      chatId,
      status: 'running',
    });

    const prevHandler = this.activeHandlers.get(chatId);
    if (prevHandler) {
      manager.removeListener('message', prevHandler);
      this.activeHandlers.delete(chatId);
    }

    // Clear any previous timeout
    const prevTimeout = this.activeTimeouts.get(chatId);
    if (prevTimeout) clearTimeout(prevTimeout);

    const stderrChunks: string[] = [];
    let receivedFirstMessage = false;

    const cleanupHandler = () => {
      manager.removeListener('message', messageHandler);
      this.activeHandlers.delete(chatId);
      const t = this.activeTimeouts.get(chatId);
      if (t) { clearTimeout(t); this.activeTimeouts.delete(chatId); }
    };

    const resetTimeout = (timeoutMs: number) => {
      const prev = this.activeTimeouts.get(chatId);
      if (prev) clearTimeout(prev);

      const timer = setTimeout(async () => {
        this.logger.error(`Agent timeout for chat ${chatId} (${timeoutMs}ms with no activity)`);
        cleanupHandler();

        const stderrHint = stderrChunks.length
          ? `\n\nCLI stderr output:\n${stderrChunks.join('').slice(0, 500)}`
          : '';
        const errorMsg = receivedFirstMessage
          ? `Agent stopped responding (no activity for ${Math.round(timeoutMs / 1000)}s)${stderrHint}`
          : `Agent did not respond within ${Math.round(timeoutMs / 1000)}s — the CLI process may have failed to start${stderrHint}`;

        await this.updateChatStatusAndNotify(chatId, 'error');
        this.emitToSubscribers(project.sandboxId!, 'agent_error', {
          chatId,
          error: errorMsg,
        });
      }, timeoutMs);
      this.activeTimeouts.set(chatId, timer);
    };

    // Start with the initial (shorter) timeout
    resetTimeout(AgentGateway.AGENT_INITIAL_TIMEOUT_MS);

    const messageHandler = async (
      sandboxId: string,
      msg: BridgeMessage,
    ) => {
      if (sandboxId !== project.sandboxId) return;

      // Filter by chatId so messages from other chats don't leak
      const msgChatId = (msg as any).chatId;
      if (msgChatId && msgChatId !== chatId) return;

      this.logger.debug(`Bridge msg for chat ${chatId}: ${msg.type}`);

      // Capture stderr output for diagnostics
      if (msg.type === 'claude_stderr') {
        const text = (msg as any).data || '';
        stderrChunks.push(text);
        this.logger.warn(`Claude stderr for chat ${chatId}: ${text.slice(0, 200)}`);
        resetTimeout(AgentGateway.AGENT_ACTIVITY_TIMEOUT_MS);
        return;
      }

      if (msg.type === 'claude_message') {
        receivedFirstMessage = true;
        resetTimeout(AgentGateway.AGENT_ACTIVITY_TIMEOUT_MS);

        const data = msg.data as any;

        // Capture Claude session_id from the init message (first prompt only).
        // On --resume, Claude reports a new forked UUID — don't overwrite the
        // original because it's the one that accumulates full conversation history.
        if (data.type === 'system' && data.subtype === 'init' && data.session_id && !chat.claudeSessionId) {
          this.logger.log(`Captured Claude session_id for chat ${chatId}: ${data.session_id}`);
          await this.chatsService.updateClaudeSessionId(chatId, data.session_id);
        }

        if (data.type === 'assistant' && data.message?.content) {
          this.logger.log(
            `Agent response for chat ${chatId}: ${data.message.content.length} blocks`,
          );
          await this.chatsService.addMessage(chatId, {
            role: 'assistant',
            content: data.message.content,
            metadata: {
              model: data.message.model,
              stopReason: data.message.stop_reason,
              usage: data.message.usage,
            },
          });
        }

        if (data.type === 'result') {
          this.logger.log(
            `Agent completed chat ${chatId}: ${data.is_error ? 'error' : 'success'}`,
          );

          // Capture session_id from result as fallback (first prompt only)
          if (data.session_id && !chat.claudeSessionId) {
            await this.chatsService.updateClaudeSessionId(chatId, data.session_id);
          }

          await this.chatsService.addMessage(chatId, {
            role: 'system',
            content: [],
            metadata: {
              costUsd: data.total_cost_usd,
              durationMs: data.duration_ms,
              numTurns: data.num_turns,
              inputTokens: data.usage?.input_tokens,
              outputTokens: data.usage?.output_tokens,
            },
          });
          const finalStatus = data.is_error ? 'error' : 'completed';
          await this.updateChatStatusAndNotify(chatId, finalStatus);
          this.emitToSubscribers(project.sandboxId!, 'agent_status', {
            chatId,
            status: finalStatus,
          });
          cleanupHandler();
        }

        this.emitToSubscribers(project.sandboxId!, 'agent_message', {
          chatId,
          message: msg.data,
        });
      } else if (msg.type === 'claude_exit') {
        const status = msg.code === 0 ? 'completed' : 'error';
        this.logger.log(`Claude exited for chat ${chatId}: code=${msg.code}`);

        if (status === 'error' && stderrChunks.length) {
          const stderrHint = stderrChunks.join('').slice(0, 500);
          this.emitToSubscribers(project.sandboxId!, 'agent_error', {
            chatId,
            error: `Agent exited with code ${msg.code}\n\n${stderrHint}`,
          });
        }

        await this.updateChatStatusAndNotify(chatId, status);
        this.emitToSubscribers(project.sandboxId!, 'agent_status', {
          chatId,
          status,
        });
        cleanupHandler();
      } else if (msg.type === 'claude_error') {
        this.logger.error(`Claude error for chat ${chatId}: ${msg.error}`);
        await this.updateChatStatusAndNotify(chatId, 'error');
        this.emitToSubscribers(project.sandboxId!, 'agent_error', {
          chatId,
          error: msg.error,
        });
        cleanupHandler();
      }
    };

    this.activeHandlers.set(chatId, messageHandler);
    manager.on('message', messageHandler);

    this.logger.log(
      `Sending prompt to sandbox ${project.sandboxId} for chat ${chatId}` +
        (chat.claudeSessionId ? ` (resuming session ${chat.claudeSessionId})` : ' (new session)'),
    );
    try {
      await manager.sendPrompt(project.sandboxId, prompt, chatId, chat.claudeSessionId, mode, model);
      this.logger.log(`Prompt sent successfully for chat ${chatId}`);
      client.emit('prompt_accepted', { chatId });
    } catch (err) {
      this.logger.error(`Failed to send prompt to sandbox: ${err}`);
      cleanupHandler();
      await this.updateChatStatusAndNotify(chatId, 'error');
      client.emit('agent_error', {
        chatId,
        error: `Failed to send to sandbox: ${err}`,
      });
    }
  }

  // ── Helpers ──────────────────────────────────────

  /**
   * Try to resolve a project to its sandbox.
   * Returns null (without emitting errors) if no sandbox is available.
   */
  private async reconcileAndStart(projectId: string): Promise<void> {
    const project = await this.projectsService.reconcileSandboxStatus(projectId);
    this.logger.log(`reconcileAndStart: after reconcile status=${project.status}`);
    if (project.status === 'stopped' || project.status === 'error') {
      this.logger.log(`reconcileAndStart: starting/provisioning sandbox for ${projectId}`);
      await this.projectsService.startOrProvisionSandbox(projectId);
    }
  }

  /**
   * Resolve the directory-relevant project name. For forks, returns the root
   * project's name since the sandbox filesystem was created with the root's
   * directory layout.
   */
  private async resolveDirName(project: { name: string; forkedFromId: string | null }): Promise<string> {
    if (!project.forkedFromId) return project.name;
    try {
      const root = await this.projectsService.findById(project.forkedFromId);
      return root.name;
    } catch {
      return project.name;
    }
  }

  private async tryResolveProject(
    projectId: string,
  ): Promise<{
    sandboxId: string;
    manager: NonNullable<ReturnType<ProjectsService['getSandboxManager']>>;
    project: Awaited<ReturnType<ProjectsService['findById']>>;
  } | null> {
    try {
      const project = await this.projectsService.findById(projectId);
      if (!project.sandboxId) return null;
      let manager = this.projectsService.getSandboxManager();
      if (!manager) {
        await this.projectsService.reinitSandboxManager();
        manager = this.projectsService.getSandboxManager();
      }
      if (!manager) return null;
      return { sandboxId: project.sandboxId, manager, project };
    } catch {
      return null;
    }
  }

  /** Track which manager instance we last attached listeners to */
  private lastAttachedManager: WeakRef<any> | null = null;

  /**
   * Attach SandboxManager terminal event listeners for a sandbox,
   * forwarding terminal events to all Socket.io subscribers.
   * Re-attaches if the manager was re-initialized.
   */
  private attachTerminalListeners(sandboxId: string) {
    const manager = this.projectsService.getSandboxManager();
    if (!manager) return;

    // If the manager changed (re-initialized), clear old tracking
    if (this.lastAttachedManager && this.lastAttachedManager.deref() !== manager) {
      this.terminalListenersBySandbox.clear();
      this.lastAttachedManager = new WeakRef(manager);
    } else if (!this.lastAttachedManager) {
      this.lastAttachedManager = new WeakRef(manager);
    }

    if (this.terminalListenersBySandbox.has(sandboxId)) return;
    this.terminalListenersBySandbox.add(sandboxId);

    manager.on('terminal_created', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'terminal_created', {
        terminalId: msg.terminalId,
        name: msg.name,
      });
    });

    manager.on('terminal_output', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'terminal_output', {
        terminalId: msg.terminalId,
        data: msg.data,
      });
    });

    manager.on('terminal_exit', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'terminal_exit', {
        terminalId: msg.terminalId,
        exitCode: msg.exitCode,
      });
    });

    manager.on('terminal_error', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'terminal_error', {
        terminalId: msg.terminalId,
        error: msg.error,
      });
    });

    manager.on('terminal_list', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'terminal_list', {
        terminals: msg.terminals,
      });
    });

    manager.on('file_changed', (sid, dirs) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'file_changed', { dirs });
    });

    manager.on('ports_update', (sid, msg) => {
      if (sid !== sandboxId) return;
      this.emitToSubscribers(sandboxId, 'ports_update', { ports: msg.ports });
    });
  }

  private subscribeTo(sandboxId: string, socketId: string) {
    if (!this.sandboxSubscribers.has(sandboxId)) {
      this.sandboxSubscribers.set(sandboxId, new Set());
    }
    this.sandboxSubscribers.get(sandboxId)!.add(socketId);
  }

  private emitToSubscribers(
    sandboxId: string,
    event: string,
    data: unknown,
  ) {
    const subs = this.sandboxSubscribers.get(sandboxId);
    if (!subs) return;
    for (const socketId of subs) {
      this.server.to(socketId).emit(event, data);
    }
  }
}
