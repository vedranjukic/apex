import { useState, useCallback } from 'react';
import { Settings, Plus, X, RotateCcw, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useSettingsStore, usePortForwardingSettings, useGeneralSettings } from '../../stores/settings-store';
import { cn } from '../../lib/cn';

interface PortForwardingSettingsProps {
  className?: string;
}

export function PortForwardingSettings({ className }: PortForwardingSettingsProps) {
  const {
    portRange,
    maxConcurrentForwards,
    excludedPorts,
    preferredPortOffset,
  } = usePortForwardingSettings();
  
  const {
    notificationsEnabled,
    autoCloseInactiveTimeout,
    showAdvancedOptions,
  } = useGeneralSettings();

  const {
    setPortRange,
    setMaxConcurrentForwards,
    addExcludedPort,
    removeExcludedPort,
    setPreferredPortOffset,
    setNotificationsEnabled,
    setAutoCloseInactiveTimeout,
    setShowAdvancedOptions,
    resetToDefaults,
  } = useSettingsStore();

  const [portRangeStart, setPortRangeStart] = useState(portRange.start.toString());
  const [portRangeEnd, setPortRangeEnd] = useState(portRange.end.toString());
  const [newExcludedPort, setNewExcludedPort] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handlePortRangeStartChange = useCallback((value: string) => {
    setPortRangeStart(value);
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1024 && num <= 65535) {
      setPortRange({ start: num, end: portRange.end });
    }
  }, [portRange.end, setPortRange]);

  const handlePortRangeEndChange = useCallback((value: string) => {
    setPortRangeEnd(value);
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1024 && num <= 65535) {
      setPortRange({ start: portRange.start, end: num });
    }
  }, [portRange.start, setPortRange]);

  const handleAddExcludedPort = useCallback(() => {
    const port = parseInt(newExcludedPort, 10);
    if (!isNaN(port) && port > 0 && port <= 65535 && !excludedPorts.includes(port)) {
      addExcludedPort(port);
      setNewExcludedPort('');
    }
  }, [newExcludedPort, excludedPorts, addExcludedPort]);


  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-medium text-text-primary">Port Forwarding Settings</h2>
        </div>
        <button
          onClick={resetToDefaults}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary border border-border/50 rounded-md hover:bg-background-hover transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset to Defaults
        </button>
      </div>

      {/* Port Range Configuration */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">Port Range Configuration</h3>
        <div className="space-y-4 p-3 border border-border/50 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Info className="w-4 h-4" />
            <span>Fallback range when the original port is taken (default: 3000-9000)</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">Start Port</label>
              <input
                type="number"
                value={portRangeStart}
                onChange={(e) => handlePortRangeStartChange(e.target.value)}
                min={1024}
                max={65535}
                className="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-surface-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">End Port</label>
              <input
                type="number"
                value={portRangeEnd}
                onChange={(e) => handlePortRangeEndChange(e.target.value)}
                min={1024}
                max={65535}
                className="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-surface-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Excluded Ports */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">Excluded Ports</h3>
        <div className="space-y-3 p-3 border border-border/50 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Info className="w-4 h-4" />
            <span>Ports that should never be auto-forwarded</span>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={newExcludedPort}
              onChange={(e) => setNewExcludedPort(e.target.value)}
              placeholder="Add port to exclude..."
              min={1}
              max={65535}
              className="flex-1 px-2 py-1.5 text-xs border border-border rounded-md bg-background-primary text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={(e) => e.key === 'Enter' && handleAddExcludedPort()}
            />
            <button
              onClick={handleAddExcludedPort}
              className="p-1.5 border border-border rounded-md hover:bg-background-hover transition-colors"
            >
              <Plus className="w-4 h-4 text-text-secondary" />
            </button>
          </div>
          
          {excludedPorts.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-text-secondary">Excluded:</div>
              <div className="flex flex-wrap gap-1">
                {excludedPorts.map((port) => (
                  <div
                    key={port}
                    className="flex items-center gap-1 px-2 py-1 bg-background-muted text-xs rounded-md"
                  >
                    <span>{port}</span>
                    <button
                      onClick={() => removeExcludedPort(port)}
                      className="text-text-muted hover:text-red-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Options Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        {showAdvanced ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Advanced Options
      </button>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-4 pl-6 border-l-2 border-border/30">
          {/* Max Concurrent Forwards */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Maximum Concurrent Forwards
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={maxConcurrentForwards}
                onChange={(e) => setMaxConcurrentForwards(parseInt(e.target.value, 10) || 1)}
                min={1}
                max={100}
                className="w-20 px-2 py-1.5 text-xs border border-border rounded-md bg-surface-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-text-muted">
                Maximum number of simultaneous port forwards
              </span>
            </div>
          </div>

          {/* Preferred Port Offset */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Preferred Port Offset
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={preferredPortOffset}
                onChange={(e) => setPreferredPortOffset(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={1000}
                className="w-20 px-2 py-1.5 text-xs border border-border rounded-md bg-surface-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-text-muted">
                Offset added to port numbers for conflict resolution
              </span>
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-text-secondary">Desktop Notifications</div>
              <div className="text-xs text-text-muted">Show notifications for port events</div>
            </div>
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                notificationsEnabled ? "bg-accent" : "bg-background-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  notificationsEnabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Auto Close Timeout */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Auto-close Inactive Timeout (minutes)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={autoCloseInactiveTimeout}
                onChange={(e) => setAutoCloseInactiveTimeout(parseInt(e.target.value, 10) || 60)}
                min={1}
                max={1440}
                className="w-20 px-2 py-1.5 text-xs border border-border rounded-md bg-surface-secondary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-text-muted">
                Automatically close port forwards after inactivity
              </span>
            </div>
          </div>

          {/* Show Advanced Options in Main UI */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-text-secondary">Show Advanced Options</div>
              <div className="text-xs text-text-muted">Display advanced controls in port panel</div>
            </div>
            <button
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                showAdvancedOptions ? "bg-accent" : "bg-background-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  showAdvancedOptions ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}