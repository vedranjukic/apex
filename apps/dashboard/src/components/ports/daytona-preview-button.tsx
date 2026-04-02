import { useState, useCallback, useEffect } from 'react';
import { ExternalLink, Loader2, Clock, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

interface DaytonaPreviewButtonProps {
  port: number;
  onRequestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
  disabled?: boolean;
}

interface PreviewUrlState {
  url: string;
  token?: string;
  expiresAt: number; // timestamp
}

export function DaytonaPreviewButton({ port, onRequestPreviewUrl, disabled }: DaytonaPreviewButtonProps) {
  const [loading, setLoading] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewUrlState | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Calculate time remaining until expiration
  useEffect(() => {
    if (!previewState) return;

    const updateTimeLeft = () => {
      const now = Date.now();
      const remaining = previewState.expiresAt - now;
      
      if (remaining <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const minutes = Math.floor(remaining / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      
      if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [previewState]);

  const handleGenerateUrl = useCallback(async () => {
    if (loading || disabled) return;
    
    setLoading(true);
    try {
      const result = await onRequestPreviewUrl(port);
      
      // Daytona preview URLs typically expire in 60 minutes
      const expiresAt = Date.now() + (60 * 60 * 1000);
      
      setPreviewState({
        url: result.url,
        token: result.token,
        expiresAt,
      });
      
      // Open the URL immediately
      window.open(result.url, '_blank', 'noopener');
    } catch (error) {
      console.error('Failed to generate preview URL:', error);
    } finally {
      setLoading(false);
    }
  }, [port, onRequestPreviewUrl, loading, disabled]);

  const handleOpenExisting = useCallback(() => {
    if (previewState?.url) {
      window.open(previewState.url, '_blank', 'noopener');
    }
  }, [previewState]);

  const handleCopyUrl = useCallback(() => {
    if (previewState?.url) {
      navigator.clipboard.writeText(previewState.url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [previewState]);

  const isExpired = previewState && Date.now() > previewState.expiresAt;

  if (!previewState || isExpired) {
    return (
      <button
        onClick={handleGenerateUrl}
        disabled={loading || disabled}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors",
          "border-primary/20 text-primary hover:border-primary/40 hover:bg-primary/5",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          loading && "cursor-wait"
        )}
        title="Generate Daytona preview URL (60min TTL)"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ExternalLink className="w-3 h-3" />
        )}
        <span>{loading ? 'Generating...' : 'Generate Preview'}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleOpenExisting}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors",
          "border-green-500/20 text-green-400 hover:border-green-500/40 hover:bg-green-500/5"
        )}
        title={`Open preview URL (expires ${timeLeft})`}
      >
        <ExternalLink className="w-3 h-3" />
        <span>Open Preview</span>
      </button>
      
      <button
        onClick={handleCopyUrl}
        className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
        title="Copy preview URL"
      >
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
      
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <Clock className="w-3 h-3" />
        <span>{timeLeft}</span>
      </div>
      
      <button
        onClick={handleGenerateUrl}
        disabled={loading}
        className={cn(
          "text-xs text-text-muted hover:text-text-secondary transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        title="Generate new preview URL"
      >
        {loading ? 'Generating...' : 'Refresh'}
      </button>
    </div>
  );
}