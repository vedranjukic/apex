import { useState, useEffect, FormEvent } from 'react';
import { X, GitBranch } from 'lucide-react';
import { type Thread } from '../../api/client';
import { cn } from '../../lib/cn';

interface Props {
  isOpen: boolean;
  thread: Thread | null;
  onClose: () => void;
  onFork: (newTitle: string) => void;
}

export function ForkThreadDialog({ isOpen, thread, onClose, onFork }: Props) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset title when dialog opens/closes or thread changes
  useEffect(() => {
    if (isOpen && thread) {
      setTitle(`Fork of ${thread.title}`);
    } else {
      setTitle('');
    }
  }, [isOpen, thread]);

  if (!isOpen || !thread) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    try {
      onFork(trimmedTitle);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isInvalid = !title.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Fork Thread</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 p-3 bg-surface-secondary rounded-lg border border-border">
          <p className="text-sm text-text-muted">
            Forking creates a new thread with a copy of all messages from the original thread. 
            This allows you to branch off in a different direction while keeping the original 
            conversation intact.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">New Thread Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter title for the forked thread"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isInvalid}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <GitBranch className="w-4 h-4" />
              {submitting ? 'Forking…' : 'Fork'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}