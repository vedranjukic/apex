import {
  registerFileSystemOverlay,
  FileType,
  FileSystemProviderCapabilities,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat,
  type IWatchOptions,
  type IFileWriteOptions,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileChange,
} from '@codingame/monaco-vscode-files-service-override';
import { Emitter, type Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import type { ReconnectingWebSocket } from '../../lib/reconnecting-ws';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type FileReadCallback = (data: { payload: { path: string; content?: string; error?: string } }) => void;

function readFileViaSocket(
  socket: ReconnectingWebSocket,
  projectId: string,
  filePath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('file_read_result', handler);
      reject(new Error(`File read timeout: ${filePath}`));
    }, 10000);

    const handler: FileReadCallback = (data) => {
      const d = data.payload;
      if (d.path !== filePath) return;
      socket.off('file_read_result', handler);
      clearTimeout(timeout);
      if (d.error) {
        reject(new Error(d.error));
      } else {
        resolve(d.content ?? '');
      }
    };

    socket.on('file_read_result', handler);
    socket.send('file_read', { projectId, path: filePath });
  });
}

class SandboxFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite;

  private readonly _onDidChangeFile = new Emitter<readonly IFileChange[]>();
  readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

  private cache = new Map<string, Uint8Array>();

  constructor(
    private socketRef: { current: ReconnectingWebSocket | null },
    private projectId: string,
  ) {}

  watch(_resource: URI, _opts: IWatchOptions): IDisposable {
    return { dispose() {} };
  }

  async stat(resource: URI): Promise<IStat> {
    return {
      type: FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
  }

  readDirectory(): never {
    throw new Error('Not supported');
  }

  createDirectory(): never {
    throw new Error('Not supported');
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const filePath = resource.path;

    const cached = this.cache.get(filePath);
    if (cached) return cached;

    const socket = this.socketRef.current;
    if (!socket?.connected) {
      throw new Error('Socket not connected');
    }

    const content = await readFileViaSocket(socket, this.projectId, filePath);
    const bytes = textEncoder.encode(content);
    this.cache.set(filePath, bytes);
    return bytes;
  }

  async writeFile(resource: URI, content: Uint8Array): Promise<void> {
    this.cache.set(resource.path, content);
  }

  async delete(): Promise<void> {
    throw new Error('Read-only');
  }

  async rename(): Promise<void> {
    throw new Error('Read-only');
  }

  dispose() {
    this._onDidChangeFile.dispose();
    this.cache.clear();
  }
}

let currentOverlay: IDisposable | null = null;
let currentProvider: SandboxFileSystemProvider | null = null;

export function registerSandboxFs(
  socketRef: { current: ReconnectingWebSocket | null },
  projectId: string,
): IDisposable {
  if (currentOverlay) {
    currentOverlay.dispose();
    currentProvider?.dispose();
  }

  currentProvider = new SandboxFileSystemProvider(socketRef, projectId);
  currentOverlay = registerFileSystemOverlay(1, currentProvider);

  return {
    dispose() {
      currentOverlay?.dispose();
      currentProvider?.dispose();
      currentOverlay = null;
      currentProvider = null;
    },
  };
}
