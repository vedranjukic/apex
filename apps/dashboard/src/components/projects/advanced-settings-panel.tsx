import { useState, useEffect } from 'react';
import { cn } from '../../lib/cn';

export interface AdvancedSettings {
  customImage: string;
  environmentVariables: string; // KEY=VALUE format, one per line
  memoryMB: string;
  cpus: string;
}

interface Props {
  open: boolean;
  provider: string;
  settings: AdvancedSettings;
  onChange: (settings: AdvancedSettings) => void;
}

const DEFAULT_SETTINGS: AdvancedSettings = {
  customImage: '',
  environmentVariables: '',
  memoryMB: '',
  cpus: '',
};

export function AdvancedSettingsPanel({ open, provider, settings, onChange }: Props) {
  if (!open) return null;

  const handleChange = (field: keyof AdvancedSettings, value: string) => {
    onChange({ ...settings, [field]: value });
  };

  // Get the appropriate label for image/snapshot based on provider
  const getImageLabel = () => {
    switch (provider) {
      case 'daytona':
        return 'Snapshot Override';
      case 'docker':
      case 'apple-container':
        return 'Container Image Override';
      default:
        return 'Image/Snapshot Override';
    }
  };

  const getImagePlaceholder = () => {
    switch (provider) {
      case 'daytona':
        return 'e.g., apex-custom-snapshot-v1.0';
      case 'docker':
      case 'apple-container':
        return 'e.g., docker.io/username/custom-image:latest';
      default:
        return 'Custom image or snapshot name';
    }
  };

  const getImageHelp = () => {
    switch (provider) {
      case 'daytona':
        return 'Override the default Daytona snapshot. Leave empty to use the default.';
      case 'docker':
      case 'apple-container':
        return 'Override the default container image. Leave empty to use the default.';
      default:
        return 'Override the default image or snapshot for the selected provider.';
    }
  };

  return (
    <div className="border-l border-border pl-6 ml-6 space-y-4">
      <h3 className="text-lg font-medium text-text-primary mb-4">Advanced Settings</h3>

      {/* Environment Variables */}
      <div>
        <label htmlFor="env-vars" className="block text-sm font-medium text-text-primary mb-1">
          Environment Variables
        </label>
        <textarea
          id="env-vars"
          value={settings.environmentVariables}
          onChange={(e) => handleChange('environmentVariables', e.target.value)}
          placeholder={`NODE_ENV=development
API_URL=https://api.example.com
DEBUG=true`}
          rows={4}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
        <p className="text-xs text-text-muted mt-1">
          Enter environment variables in KEY=VALUE format, one per line.
        </p>
      </div>

      {/* Image/Snapshot Override */}
      <div>
        <label htmlFor="custom-image" className="block text-sm font-medium text-text-primary mb-1">
          {getImageLabel()}
        </label>
        <input
          id="custom-image"
          type="text"
          value={settings.customImage}
          onChange={(e) => handleChange('customImage', e.target.value)}
          placeholder={getImagePlaceholder()}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="text-xs text-text-muted mt-1">{getImageHelp()}</p>
      </div>

      {/* Resource Limits - only show for container providers */}
      {(provider === 'docker' || provider === 'apple-container') && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="memory" className="block text-sm font-medium text-text-primary mb-1">
                Memory (MB)
              </label>
              <input
                id="memory"
                type="number"
                min="512"
                max="32768"
                step="512"
                value={settings.memoryMB}
                onChange={(e) => handleChange('memoryMB', e.target.value)}
                placeholder="4096"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-text-muted mt-1">Default: 4096 MB</p>
            </div>

            <div>
              <label htmlFor="cpus" className="block text-sm font-medium text-text-primary mb-1">
                CPU Cores
              </label>
              <input
                id="cpus"
                type="number"
                min="1"
                max="16"
                step="1"
                value={settings.cpus}
                onChange={(e) => handleChange('cpus', e.target.value)}
                placeholder="2"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-text-muted mt-1">Default: 2 cores</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { DEFAULT_SETTINGS };