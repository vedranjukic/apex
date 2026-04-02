import { create } from 'zustand';

const STORAGE_KEY_PREFIX = 'apex-settings';

export interface PortRange {
  start: number;
  end: number;
}

export interface PortForwardingSettings {
  /** Port range configuration for conflict resolution (default 8000-9000) */
  portRange: PortRange;
  /** Enable/disable automatic port forwarding */
  autoForwardEnabled: boolean;
  /** Maximum number of concurrent port forwards */
  maxConcurrentForwards: number;
  /** Ports to exclude from automatic forwarding */
  excludedPorts: number[];
  /** Preferred port offset for conflict resolution */
  preferredPortOffset: number;
}

export interface GeneralSettings {
  /** Enable desktop notifications for port events */
  notificationsEnabled: boolean;
  /** Auto-close inactive port forwards after timeout (minutes) */
  autoCloseInactiveTimeout: number;
  /** Show advanced port forwarding options */
  showAdvancedOptions: boolean;
}

export interface SettingsState extends PortForwardingSettings, GeneralSettings {
  // Port forwarding actions
  setPortRange: (range: PortRange) => void;
  setAutoForwardEnabled: (enabled: boolean) => void;
  setMaxConcurrentForwards: (max: number) => void;
  setExcludedPorts: (ports: number[]) => void;
  addExcludedPort: (port: number) => void;
  removeExcludedPort: (port: number) => void;
  setPreferredPortOffset: (offset: number) => void;
  
  // General actions
  setNotificationsEnabled: (enabled: boolean) => void;
  setAutoCloseInactiveTimeout: (timeout: number) => void;
  setShowAdvancedOptions: (show: boolean) => void;
  
  // Bulk actions
  updatePortForwardingSettings: (settings: Partial<PortForwardingSettings>) => void;
  updateGeneralSettings: (settings: Partial<GeneralSettings>) => void;
  resetToDefaults: () => void;
  
  // Utility actions
  isPortInRange: (port: number) => boolean;
  getNextAvailablePortInRange: (excludeList?: number[]) => number | null;
}

// Default settings
const DEFAULT_PORT_FORWARDING_SETTINGS: PortForwardingSettings = {
  portRange: { start: 3000, end: 9000 },
  autoForwardEnabled: true,
  maxConcurrentForwards: 20,
  excludedPorts: [],
  preferredPortOffset: 0,
};

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  notificationsEnabled: true,
  autoCloseInactiveTimeout: 60, // 1 hour
  showAdvancedOptions: false,
};

// Persistence helpers
function getStorageKey(key: string): string {
  return `${STORAGE_KEY_PREFIX}:${key}`;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(getStorageKey(key));
    if (!stored) return defaultValue;
    const parsed = JSON.parse(stored);
    return { ...defaultValue, ...parsed };
  } catch (error) {
    console.warn(`Failed to load settings for key ${key}:`, error);
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save settings for key ${key}:`, error);
  }
}

// Validation helpers
function validatePortRange(range: PortRange): PortRange {
  const start = Math.max(1024, Math.min(range.start, 65535));
  const end = Math.max(start + 1, Math.min(range.end, 65535));
  return { start, end };
}

function validateMaxConcurrentForwards(max: number): number {
  return Math.max(1, Math.min(max, 100));
}

function validateAutoCloseTimeout(timeout: number): number {
  return Math.max(1, Math.min(timeout, 1440)); // Max 24 hours
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Load initial settings from localStorage
  const initialPortSettings = loadFromStorage('portForwarding', DEFAULT_PORT_FORWARDING_SETTINGS);
  const initialGeneralSettings = loadFromStorage('general', DEFAULT_GENERAL_SETTINGS);
  
  // Validate loaded settings
  const validatedPortSettings: PortForwardingSettings = {
    ...initialPortSettings,
    portRange: validatePortRange(initialPortSettings.portRange),
    maxConcurrentForwards: validateMaxConcurrentForwards(initialPortSettings.maxConcurrentForwards),
  };
  
  const validatedGeneralSettings: GeneralSettings = {
    ...initialGeneralSettings,
    autoCloseInactiveTimeout: validateAutoCloseTimeout(initialGeneralSettings.autoCloseInactiveTimeout),
  };

  return {
    // Initial state
    ...validatedPortSettings,
    ...validatedGeneralSettings,

    // Port forwarding actions
    setPortRange: (range) => {
      const validatedRange = validatePortRange(range);
      set({ portRange: validatedRange });
      const currentPortSettings = {
        portRange: validatedRange,
        autoForwardEnabled: get().autoForwardEnabled,
        maxConcurrentForwards: get().maxConcurrentForwards,
        excludedPorts: get().excludedPorts,
        preferredPortOffset: get().preferredPortOffset,
      };
      saveToStorage('portForwarding', currentPortSettings);
    },

    setAutoForwardEnabled: (enabled) => {
      set({ autoForwardEnabled: enabled });
      const currentPortSettings = {
        portRange: get().portRange,
        autoForwardEnabled: enabled,
        maxConcurrentForwards: get().maxConcurrentForwards,
        excludedPorts: get().excludedPorts,
        preferredPortOffset: get().preferredPortOffset,
      };
      saveToStorage('portForwarding', currentPortSettings);
    },

    setMaxConcurrentForwards: (max) => {
      const validatedMax = validateMaxConcurrentForwards(max);
      set({ maxConcurrentForwards: validatedMax });
      const currentPortSettings = {
        portRange: get().portRange,
        autoForwardEnabled: get().autoForwardEnabled,
        maxConcurrentForwards: validatedMax,
        excludedPorts: get().excludedPorts,
        preferredPortOffset: get().preferredPortOffset,
      };
      saveToStorage('portForwarding', currentPortSettings);
    },

    setExcludedPorts: (ports) => {
      const validatedPorts = ports.filter(port => port > 0 && port <= 65535);
      set({ excludedPorts: validatedPorts });
      const currentPortSettings = {
        portRange: get().portRange,
        autoForwardEnabled: get().autoForwardEnabled,
        maxConcurrentForwards: get().maxConcurrentForwards,
        excludedPorts: validatedPorts,
        preferredPortOffset: get().preferredPortOffset,
      };
      saveToStorage('portForwarding', currentPortSettings);
    },

    addExcludedPort: (port) => {
      if (port <= 0 || port > 65535) return;
      const excludedPorts = get().excludedPorts;
      if (!excludedPorts.includes(port)) {
        const updatedPorts = [...excludedPorts, port].sort((a, b) => a - b);
        get().setExcludedPorts(updatedPorts);
      }
    },

    removeExcludedPort: (port) => {
      const excludedPorts = get().excludedPorts;
      const updatedPorts = excludedPorts.filter(p => p !== port);
      get().setExcludedPorts(updatedPorts);
    },

    setPreferredPortOffset: (offset) => {
      const validatedOffset = Math.max(0, Math.min(offset, 1000));
      set({ preferredPortOffset: validatedOffset });
      const currentPortSettings = {
        portRange: get().portRange,
        autoForwardEnabled: get().autoForwardEnabled,
        maxConcurrentForwards: get().maxConcurrentForwards,
        excludedPorts: get().excludedPorts,
        preferredPortOffset: validatedOffset,
      };
      saveToStorage('portForwarding', currentPortSettings);
    },

    // General actions
    setNotificationsEnabled: (enabled) => {
      set({ notificationsEnabled: enabled });
      const currentGeneralSettings = {
        notificationsEnabled: enabled,
        autoCloseInactiveTimeout: get().autoCloseInactiveTimeout,
        showAdvancedOptions: get().showAdvancedOptions,
      };
      saveToStorage('general', currentGeneralSettings);
    },

    setAutoCloseInactiveTimeout: (timeout) => {
      const validatedTimeout = validateAutoCloseTimeout(timeout);
      set({ autoCloseInactiveTimeout: validatedTimeout });
      const currentGeneralSettings = {
        notificationsEnabled: get().notificationsEnabled,
        autoCloseInactiveTimeout: validatedTimeout,
        showAdvancedOptions: get().showAdvancedOptions,
      };
      saveToStorage('general', currentGeneralSettings);
    },

    setShowAdvancedOptions: (show) => {
      set({ showAdvancedOptions: show });
      const currentGeneralSettings = {
        notificationsEnabled: get().notificationsEnabled,
        autoCloseInactiveTimeout: get().autoCloseInactiveTimeout,
        showAdvancedOptions: show,
      };
      saveToStorage('general', currentGeneralSettings);
    },

    // Bulk actions
    updatePortForwardingSettings: (settings) => {
      const current = get();
      const updated: PortForwardingSettings = {
        portRange: settings.portRange ? validatePortRange(settings.portRange) : current.portRange,
        autoForwardEnabled: settings.autoForwardEnabled ?? current.autoForwardEnabled,
        maxConcurrentForwards: settings.maxConcurrentForwards 
          ? validateMaxConcurrentForwards(settings.maxConcurrentForwards)
          : current.maxConcurrentForwards,
        excludedPorts: settings.excludedPorts 
          ? settings.excludedPorts.filter(port => port > 0 && port <= 65535)
          : current.excludedPorts,
        preferredPortOffset: settings.preferredPortOffset !== undefined
          ? Math.max(0, Math.min(settings.preferredPortOffset, 1000))
          : current.preferredPortOffset,
      };
      set(updated);
      saveToStorage('portForwarding', updated);
    },

    updateGeneralSettings: (settings) => {
      const current = get();
      const updated: GeneralSettings = {
        notificationsEnabled: settings.notificationsEnabled ?? current.notificationsEnabled,
        autoCloseInactiveTimeout: settings.autoCloseInactiveTimeout
          ? validateAutoCloseTimeout(settings.autoCloseInactiveTimeout)
          : current.autoCloseInactiveTimeout,
        showAdvancedOptions: settings.showAdvancedOptions ?? current.showAdvancedOptions,
      };
      set(updated);
      saveToStorage('general', updated);
    },

    resetToDefaults: () => {
      set({ ...DEFAULT_PORT_FORWARDING_SETTINGS, ...DEFAULT_GENERAL_SETTINGS });
      saveToStorage('portForwarding', DEFAULT_PORT_FORWARDING_SETTINGS);
      saveToStorage('general', DEFAULT_GENERAL_SETTINGS);
    },

    // Utility actions
    isPortInRange: (port) => {
      const { portRange } = get();
      return port >= portRange.start && port <= portRange.end;
    },

    getNextAvailablePortInRange: (excludeList = []) => {
      const { portRange, excludedPorts } = get();
      const allExcluded = new Set([...excludedPorts, ...excludeList]);
      
      for (let port = portRange.start; port <= portRange.end; port++) {
        if (!allExcluded.has(port)) {
          return port;
        }
      }
      return null;
    },
  };
});

export function usePortForwardingSettings() {
  const portRange = useSettingsStore((s) => s.portRange);
  const autoForwardEnabled = useSettingsStore((s) => s.autoForwardEnabled);
  const maxConcurrentForwards = useSettingsStore((s) => s.maxConcurrentForwards);
  const excludedPorts = useSettingsStore((s) => s.excludedPorts);
  const preferredPortOffset = useSettingsStore((s) => s.preferredPortOffset);
  return { portRange, autoForwardEnabled, maxConcurrentForwards, excludedPorts, preferredPortOffset };
}

export function useGeneralSettings() {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const autoCloseInactiveTimeout = useSettingsStore((s) => s.autoCloseInactiveTimeout);
  const showAdvancedOptions = useSettingsStore((s) => s.showAdvancedOptions);
  return { notificationsEnabled, autoCloseInactiveTimeout, showAdvancedOptions };
}