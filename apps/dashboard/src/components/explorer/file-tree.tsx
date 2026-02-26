import { useEffect, useRef, useCallback, useState } from 'react';
import {
  asyncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Image,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useFileTreeStore, type FileEntry } from '../../stores/file-tree-store';
import { useEditorStore } from '../../stores/editor-store';
import { FileContextMenu, buildFileActions } from './file-context-menu';
import { InlineInput } from './inline-input';

export interface FileTreeActions {
  requestListing: (path: string) => void;
  createFile: (path: string, isDirectory: boolean) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  deleteFile: (path: string) => void;
  moveFile: (sourcePath: string, destPath: string) => void;
  readFile: (path: string) => void;
  writeFile: (path: string, content: string) => void;
}

interface FileTreeProps {
  projectId: string;
  actions: FileTreeActions;
}

const LOADING_ENTRY: FileEntry = {
  name: 'Loading\u2026',
  path: '__loading__',
  isDirectory: false,
};

type PendingResolver = (ids: string[]) => void;

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'py': case 'rs':
    case 'go': case 'rb': case 'java': case 'c': case 'cpp': case 'h':
    case 'css': case 'scss': case 'html': case 'vue': case 'svelte':
      return FileCode;
    case 'json': case 'yaml': case 'yml': case 'toml':
      return FileJson;
    case 'md': case 'txt': case 'rst':
      return FileText;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'ico':
      return Image;
    default:
      return File;
  }
}

interface ContextMenu {
  x: number;
  y: number;
  path: string;
  isDirectory: boolean;
}

interface InlineEdit {
  parentDir: string;
  type: 'new-file' | 'new-folder' | 'rename';
  existingName?: string;
  existingPath?: string;
}

export function FileTree({ projectId, actions }: FileTreeProps) {
  const rootPath = useFileTreeStore((s) => s.rootPath);
  const cache = useFileTreeStore((s) => s.cache);
  const changedDirs = useFileTreeStore((s) => s.changedDirs);
  const clearChangedDirs = useFileTreeStore((s) => s.clearChangedDirs);

  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const pendingResolvers = useRef<Map<string, PendingResolver>>(new Map());

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);

  useEffect(() => {
    if (rootPath && !cache[rootPath]) {
      actions.requestListing(rootPath);
    }
  }, [rootPath, actions, cache]);


  useEffect(() => {
    for (const [dirPath, resolve] of pendingResolvers.current) {
      const entries = cache[dirPath];
      if (entries) {
        resolve(entries.map((e) => e.path));
        pendingResolvers.current.delete(dirPath);
      }
    }
  }, [cache]);

  const getChildren = useCallback((itemId: string): Promise<string[]> => {
    const cached = cacheRef.current[itemId];
    if (cached) {
      return Promise.resolve(cached.map((e) => e.path));
    }
    actionsRef.current.requestListing(itemId);
    return new Promise<string[]>((resolve) => {
      pendingResolvers.current.set(itemId, resolve);
    });
  }, []);

  const getItem = useCallback((itemId: string): Promise<FileEntry> => {
    if (itemId === rootPath) {
      return Promise.resolve({
        name: rootPath?.split('/').pop() || 'project',
        path: rootPath || '',
        isDirectory: true,
      });
    }
    const allEntries = cacheRef.current;
    for (const entries of Object.values(allEntries)) {
      const found = entries.find((e) => e.path === itemId);
      if (found) return Promise.resolve(found);
    }
    return Promise.resolve({
      name: itemId.split('/').pop() || itemId,
      path: itemId,
      isDirectory: false,
    });
  }, [rootPath]);

  const handleDrop = useCallback((items: { getId: () => string; getItemData: () => FileEntry }[], target: { item: { getId: () => string; getItemData: () => FileEntry } }) => {
    const destDir = target.item.getItemData().isDirectory
      ? target.item.getId()
      : target.item.getId().substring(0, target.item.getId().lastIndexOf('/'));

    for (const item of items) {
      const sourcePath = item.getId();
      const fileName = sourcePath.split('/').pop() || '';
      const destPath = `${destDir}/${fileName}`;
      if (sourcePath !== destPath) {
        actionsRef.current.moveFile(sourcePath, destPath);
      }
    }
  }, []);

  const tree = useTree<FileEntry>({
    rootItemId: rootPath || '__root__',
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isDirectory,
    createLoadingItemData: () => LOADING_ENTRY,
    indent: 12,
    canDropInbetween: false,
    onDrop: handleDrop as any,
    dataLoader: {
      getItem,
      getChildren,
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, dragAndDropFeature],
  });

  useEffect(() => {
    if (changedDirs.length === 0) return;
    for (const dir of changedDirs) {
      const item = tree.getItemInstance(dir);
      if (item) {
        item.invalidateChildrenIds();
      }
    }
    clearChangedDirs();
  }, [changedDirs, tree, clearChangedDirs]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDirectory: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDirectory });
  }, []);

  const handleNewFile = useCallback((parentDir: string) => {
    setInlineEdit({ parentDir, type: 'new-file' });
  }, []);

  const handleNewFolder = useCallback((parentDir: string) => {
    setInlineEdit({ parentDir, type: 'new-folder' });
  }, []);

  const handleRename = useCallback((path: string) => {
    const name = path.split('/').pop() || '';
    const parentDir = path.substring(0, path.lastIndexOf('/'));
    setInlineEdit({ parentDir, type: 'rename', existingName: name, existingPath: path });
  }, []);

  const handleDelete = useCallback((path: string) => {
    const name = path.split('/').pop() || path;
    if (window.confirm(`Delete "${name}"?`)) {
      actions.deleteFile(path);
    }
  }, [actions]);

  const handleInlineSubmit = useCallback((value: string) => {
    if (!inlineEdit) return;
    const { parentDir, type, existingPath } = inlineEdit;
    const newPath = `${parentDir}/${value}`;

    if (type === 'new-file') {
      actions.createFile(newPath, false);
    } else if (type === 'new-folder') {
      actions.createFile(newPath, true);
    } else if (type === 'rename' && existingPath) {
      actions.renameFile(existingPath, newPath);
    }
    setInlineEdit(null);
  }, [inlineEdit, actions]);

  const handleContainerContext = useCallback((e: React.MouseEvent) => {
    if (!rootPath) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path: rootPath, isDirectory: true });
  }, [rootPath]);

  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-center">
        <Folder className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-xs">File explorer will be available when the sandbox is connected.</p>
      </div>
    );
  }

  return (
    <>
      <div
        {...tree.getContainerProps()}
        className="text-[13px] select-none outline-none min-h-[200px]"
        onContextMenu={handleContainerContext}
      >
        {tree.getItems().map((item) => {
          const data = item.getItemData();
          const isLoading = item.isLoading();
          const isFolder = item.isFolder();
          const isExpanded = item.isExpanded();
          const isFocused = item.isFocused();
          const isSelected = item.isSelected();
          const isDragTarget = item.isDragTarget?.() ?? false;
          const level = item.getItemMeta().level;
          const itemId = item.getId();

          if (isLoading) {
            return (
              <div
                {...item.getProps()}
                key={itemId}
                className="flex items-center gap-1 px-1 py-[1px] text-gray-500"
                style={{ paddingLeft: `${level * 12 + 4}px` }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="text-xs">Loading&hellip;</span>
              </div>
            );
          }

          const isRenaming = inlineEdit?.type === 'rename' && inlineEdit.existingPath === itemId;
          const FolderIcon = isExpanded ? FolderOpen : Folder;
          const FileIcon = isFolder ? FolderIcon : getFileIcon(data.name);

          const treeProps = item.getProps();

          return (
            <div
              {...treeProps}
              key={itemId}
              className={[
                'flex items-center gap-1 px-1 py-[1px] cursor-pointer rounded-sm',
                'hover:bg-sidebar-hover',
                isFocused ? 'bg-sidebar-hover outline outline-1 outline-primary/40' : '',
                isSelected ? 'bg-primary/15 text-panel-text' : 'text-panel-text-muted',
                isDragTarget ? 'bg-primary/25 outline outline-1 outline-primary' : '',
              ].join(' ')}
              style={{ paddingLeft: `${level * 12 + 4}px` }}
              onClick={(e) => {
                treeProps.onClick?.(e);
                if (!isFolder) {
                  useEditorStore.getState().openFile(itemId, data.name);
                  actionsRef.current.readFile(itemId);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, itemId, isFolder)}
            >
              {isFolder ? (
                isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-panel-icon" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-panel-icon" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <FileIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
              {isRenaming ? (
                <InlineInput
                  defaultValue={data.name}
                  onSubmit={handleInlineSubmit}
                  onCancel={() => setInlineEdit(null)}
                />
              ) : (
                <span className="truncate text-[13px] leading-5">{data.name}</span>
              )}
            </div>
          );
        })}

        {inlineEdit && (inlineEdit.type === 'new-file' || inlineEdit.type === 'new-folder') && (
          <div
            className="flex items-center gap-1 px-1 py-[1px] text-gray-300"
            style={{ paddingLeft: '16px' }}
          >
            {inlineEdit.type === 'new-folder' ? (
              <Folder className="w-3.5 h-3.5 shrink-0 opacity-70" />
            ) : (
              <File className="w-3.5 h-3.5 shrink-0 opacity-70" />
            )}
            <InlineInput
              defaultValue=""
              onSubmit={handleInlineSubmit}
              onCancel={() => setInlineEdit(null)}
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={buildFileActions({
            path: contextMenu.path,
            isDirectory: contextMenu.isDirectory,
            isRoot: contextMenu.path === rootPath,
            onNewFile: handleNewFile,
            onNewFolder: handleNewFolder,
            onRename: handleRename,
            onDelete: handleDelete,
          })}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
