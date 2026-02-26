import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, GitBranch, Check, Hash } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGitStore } from '../../stores/git-store';
import type { GitActions } from '../../hooks/use-git-socket';

type InputMode = 'create' | 'create-from' | 'detached' | null;

interface Props {
  gitActions: GitActions;
  onClose: () => void;
}

export function BranchPicker({ gitActions, onClose }: Props) {
  const branches = useGitStore((s) => s.branches);
  const [inputMode, setInputMode] = useState<InputMode>(null);
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    gitActions.listBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitActions.listBranches]);

  useEffect(() => {
    if (inputMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [inputMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inputMode) {
          setInputMode(null);
          setBranchName('');
          setStartPoint('');
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [inputMode, onClose]);

  const handleCreate = useCallback(() => {
    const name = branchName.trim();
    if (!name) return;
    gitActions.createBranch(name);
    onClose();
  }, [branchName, gitActions, onClose]);

  const handleCreateFrom = useCallback(() => {
    const name = branchName.trim();
    const ref = startPoint.trim();
    if (!name || !ref) return;
    gitActions.createBranch(name, ref);
    onClose();
  }, [branchName, startPoint, gitActions, onClose]);

  const handleDetached = useCallback(() => {
    const ref = startPoint.trim();
    if (!ref) return;
    gitActions.checkout(ref);
    onClose();
  }, [startPoint, gitActions, onClose]);

  const handleCheckout = useCallback(
    (ref: string) => {
      gitActions.checkout(ref);
      onClose();
    },
    [gitActions, onClose],
  );

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover text-text-secondary hover:text-text-primary';

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-border bg-sidebar shadow-xl z-50 py-1"
    >
      {/* Command items */}
      {inputMode === 'create' ? (
        <div className="px-3 py-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder="Branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-primary"
          />
        </div>
      ) : inputMode === 'create-from' ? (
        <div className="px-3 py-1.5 flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder="Branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-primary"
          />
          <input
            type="text"
            placeholder="Start point (branch, tag, or commit)"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFrom();
            }}
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-primary"
          />
        </div>
      ) : inputMode === 'detached' ? (
        <div className="px-3 py-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder="Commit hash, tag, or ref"
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleDetached();
            }}
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-primary"
          />
        </div>
      ) : (
        <>
          <button type="button" className={itemClass} onClick={() => setInputMode('create')}>
            <Plus className="w-3.5 h-3.5" />
            Create new branch...
          </button>
          <button type="button" className={itemClass} onClick={() => setInputMode('create-from')}>
            <Plus className="w-3.5 h-3.5" />
            Create new branch from...
          </button>
          <button type="button" className={itemClass} onClick={() => setInputMode('detached')}>
            <Hash className="w-3.5 h-3.5" />
            Checkout detached...
          </button>
        </>
      )}

      {/* Separator */}
      <div className="border-t border-border my-1" />

      {/* Branch list */}
      <div className="max-h-[320px] overflow-y-auto">
        {branches.length === 0 ? (
          <div className="px-3 py-2 text-xs text-text-muted">No branches found</div>
        ) : (
          branches.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => handleCheckout(b.name)}
              className={cn(
                itemClass,
                b.isCurrent && 'bg-sidebar-active text-text-primary',
              )}
            >
              {b.isCurrent ? (
                <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
              ) : (
                <GitBranch className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className={cn('truncate', b.isRemote && 'text-text-muted')}>
                {b.name}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
