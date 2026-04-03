import { useState, useEffect, FormEvent } from 'react';
import { X } from 'lucide-react';
import { type Thread } from '../../api/client';
import { cn } from '../../lib/cn';

interface Props {
  isOpen: boolean;
  thread: Thread | null;
  onClose: () => void;
  onRename: (newTitle: string) => void;
}

export function RenameThreadDialog({ isOpen, thread, onClose, onRename }: Props) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset title when dialog opens/closes or thread changes
  useEffect(() => {
    if (isOpen && thread) {
      setTitle(thread.title);
    } else {
      setTitle('');
    }
  }, [isOpen, thread]);

  if (!isOpen || !thread) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle === thread.title) return;

    setSubmitting(true);
    try {
      onRename(trimmedTitle);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isUnchanged = title.trim() === thread.title;
  const isInvalid = !title.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Rename Thread</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter thread title"
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
              disabled={submitting || isInvalid || isUnchanged}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}