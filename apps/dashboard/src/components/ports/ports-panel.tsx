import { useState } from 'react';
import { ExternalLink, Loader2, Radio } from 'lucide-react';
import { usePortsStore } from '../../stores/ports-store';

interface PortsPanelProps {
  requestPreviewUrl: (port: number) => Promise<{ url: string; token?: string }>;
}

export function PortsPanel({ requestPreviewUrl }: PortsPanelProps) {
  const ports = usePortsStore((s) => s.ports);
  const [loadingPort, setLoadingPort] = useState<number | null>(null);

  const handleOpenPreview = async (port: number) => {
    setLoadingPort(port);
    try {
      const { url } = await requestPreviewUrl(port);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      console.error('Failed to get preview URL:', err);
    } finally {
      setLoadingPort(null);
    }
  };

  if (ports.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[#6b7280] text-sm gap-2">
        <Radio className="w-4 h-4" />
        <span>No forwarded ports</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs text-[#a9b1d6]">
        <thead>
          <tr className="text-left text-[#6b7280] border-b border-[#2a2e3a]">
            <th className="px-4 py-2 font-medium">Port</th>
            <th className="px-4 py-2 font-medium">Process</th>
            <th className="px-4 py-2 font-medium w-32">Action</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p) => (
            <tr
              key={p.port}
              className="border-b border-border/50 hover:bg-terminal-bg/50 transition-colors"
            >
              <td className="px-4 py-2 font-mono">{p.port}</td>
              <td className="px-4 py-2 text-[#6b7280]">
                {p.process || 'unknown'}
              </td>
              <td className="px-4 py-2">
                <button
                  onClick={() => handleOpenPreview(p.port)}
                  disabled={loadingPort === p.port}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs
                    bg-primary/10 border border-primary/30 text-primary
                    hover:bg-primary/20 hover:border-primary/50
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors"
                >
                  {loadingPort === p.port ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3 h-3" />
                  )}
                  <span>Open Preview</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
