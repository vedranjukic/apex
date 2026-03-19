import { useMemo } from 'react';
import { Coins, ArrowUpDown, Clock, Repeat, PlugZap, Gauge, ArrowDown, ArrowUp } from 'lucide-react';
import type { Message } from '../../api/client';
import { useThreadsStore, type McpServerInfo } from '../../stores/tasks-store';
import { getContextWindow, formatTokenCount } from '../../lib/model-context';
import { cn } from '../../lib/cn';

interface ThreadStatsBarProps {
  threadId: string;
  messages: Message[];
}

interface AggregatedStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalDurationMs: number;
  totalTurns: number;
  runCount: number;
}

function aggregateResults(messages: Message[]): AggregatedStats {
  const stats: AggregatedStats = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreation: 0,
    totalCacheRead: 0,
    totalDurationMs: 0,
    totalTurns: 0,
    runCount: 0,
  };

  for (const msg of messages) {
    if (msg.role !== 'system' || msg.content.length > 0 || !msg.metadata) continue;
    const meta = msg.metadata;
    if (meta.costUsd == null && meta.numTurns == null) continue;

    stats.runCount++;
    if (meta.costUsd != null) stats.totalCost += Number(meta.costUsd);
    if (meta.inputTokens != null) stats.totalInputTokens += Number(meta.inputTokens);
    if (meta.outputTokens != null) stats.totalOutputTokens += Number(meta.outputTokens);
    if (meta.cacheCreationInputTokens != null) stats.totalCacheCreation += Number(meta.cacheCreationInputTokens);
    if (meta.cacheReadInputTokens != null) stats.totalCacheRead += Number(meta.cacheReadInputTokens);
    if (meta.durationMs != null) stats.totalDurationMs += Number(meta.durationMs);
    if (meta.numTurns != null) stats.totalTurns += Number(meta.numTurns);
  }

  return stats;
}

function StatItem({ icon: Icon, label, value, detail, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={detail}>
      <div className="flex items-center gap-1">
        <Icon className={cn('w-3 h-3', accent ?? 'text-text-muted')} />
        <span className="text-text-secondary font-medium">{value}</span>
      </div>
      <span className="text-[10px] text-text-muted leading-none">{label}</span>
    </div>
  );
}

function ContextMeter({ pct }: { pct: number }) {
  const barColor = pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-yellow-400' : 'bg-accent';
  const textColor = pct > 80 ? 'text-red-400' : pct > 50 ? 'text-yellow-400' : 'text-accent';
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${pct.toFixed(1)}% of context window used`}>
      <div className="flex items-center gap-1.5">
        <Gauge className={cn('w-3 h-3', textColor)} />
        <span className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <span
            className={cn('block h-full rounded-full transition-all', barColor)}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </span>
        <span className={cn('font-medium', textColor)}>{pct.toFixed(1)}%</span>
      </div>
      <span className="text-[10px] text-text-muted leading-none">Context</span>
    </div>
  );
}

function McpList({ servers }: { servers: McpServerInfo[] }) {
  const connected = servers.filter((s) => s.status === 'connected');
  const disconnected = servers.filter((s) => s.status !== 'connected');
  if (servers.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-0.5" title={servers.map((s) => `${s.name} (${s.status})`).join('\n')}>
      <div className="flex items-center gap-1">
        <PlugZap className="w-3 h-3 text-accent" />
        <span className="text-text-secondary font-medium">{connected.length}</span>
        {disconnected.length > 0 && (
          <span className="text-text-muted">/ {servers.length}</span>
        )}
      </div>
      <span className="text-[10px] text-text-muted leading-none">MCPs</span>
    </div>
  );
}

export function ThreadStatsBar({ threadId, messages }: ThreadStatsBarProps) {
  const sessionInfo = useThreadsStore((s) => s.threadSessionInfo[threadId]);
  const thread = useThreadsStore((s) => s.threads.find((t) => t.id === threadId));

  const stats = useMemo(() => aggregateResults(messages), [messages]);

  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
  const contextWindow = getContextWindow(sessionInfo?.model ?? thread?.model);
  const contextPct = contextWindow && stats.totalInputTokens > 0
    ? (stats.totalInputTokens / contextWindow) * 100
    : null;
  const mcpServers = sessionInfo?.mcpServers ?? [];

  const hasData = stats.runCount > 0 || mcpServers.length > 0;
  if (!hasData) return null;

  return (
    <div className="border-t border-border bg-surface-secondary/60 px-4 py-2">
      <div className="flex items-center justify-center gap-5 text-[11px]">
        {/* Cost */}
        {stats.totalCost > 0 && (
          <StatItem
            icon={Coins}
            label="Cost"
            value={`$${stats.totalCost.toFixed(4)}`}
            accent="text-emerald-400"
          />
        )}

        {/* Tokens with input/output breakdown */}
        {totalTokens > 0 && (
          <div
            className="flex flex-col items-center gap-0.5"
            title={[
              `Input: ${formatTokenCount(stats.totalInputTokens)}`,
              `Output: ${formatTokenCount(stats.totalOutputTokens)}`,
              stats.totalCacheCreation > 0 ? `Cache write: ${formatTokenCount(stats.totalCacheCreation)}` : null,
              stats.totalCacheRead > 0 ? `Cache read: ${formatTokenCount(stats.totalCacheRead)}` : null,
            ].filter(Boolean).join(' · ')}
          >
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5 text-text-secondary">
                <ArrowUp className="w-2.5 h-2.5 text-blue-400" />
                <span className="font-medium">{formatTokenCount(stats.totalInputTokens)}</span>
              </span>
              <span className="flex items-center gap-0.5 text-text-secondary">
                <ArrowDown className="w-2.5 h-2.5 text-violet-400" />
                <span className="font-medium">{formatTokenCount(stats.totalOutputTokens)}</span>
              </span>
            </div>
            <span className="text-[10px] text-text-muted leading-none">Tokens</span>
          </div>
        )}

        {/* Context % */}
        {contextPct != null && <ContextMeter pct={contextPct} />}

        {/* Duration */}
        {stats.totalDurationMs > 0 && (
          <StatItem
            icon={Clock}
            label="Duration"
            value={stats.totalDurationMs >= 60_000
              ? `${(stats.totalDurationMs / 60_000).toFixed(1)}m`
              : `${(stats.totalDurationMs / 1000).toFixed(1)}s`}
            accent="text-blue-400"
          />
        )}

        {/* Turns */}
        {stats.totalTurns > 0 && (
          <StatItem
            icon={Repeat}
            label={`Turn${stats.totalTurns !== 1 ? 's' : ''}`}
            value={String(stats.totalTurns)}
          />
        )}

        {/* MCP Servers */}
        {mcpServers.length > 0 && <McpList servers={mcpServers} />}
      </div>
    </div>
  );
}
