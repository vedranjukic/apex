import { useState } from 'react';
import { X, Settings } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PortForwardingSettings } from './port-forwarding-settings';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'port-forwarding' | 'general'>('port-forwarding');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40" 
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-background-primary border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" />
              <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary hover:bg-background-hover rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('port-forwarding')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2",
                activeTab === 'port-forwarding'
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text-secondary"
              )}
            >
              Port Forwarding
            </button>
            <button
              onClick={() => setActiveTab('general')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2",
                activeTab === 'general'
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text-secondary"
              )}
            >
              General
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'port-forwarding' && (
              <PortForwardingSettings />
            )}
            {activeTab === 'general' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-text-primary">General Settings</h2>
                <p className="text-sm text-text-muted">
                  General settings will be available in a future update.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border rounded-md hover:bg-background-hover transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}