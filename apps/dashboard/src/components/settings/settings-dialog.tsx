import { PortForwardingSettings } from './port-forwarding-settings';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-40" 
        onClick={onClose}
      />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div className="flex-1 overflow-auto p-4">
            <PortForwardingSettings />
          </div>

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
