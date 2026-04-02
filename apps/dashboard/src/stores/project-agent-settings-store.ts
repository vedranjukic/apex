import { create } from 'zustand';

export interface AgentSettings {
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxSteps?: number;
}

const SETTINGS_PATH = '.apex/agent-settings.json';
const EMPTY: AgentSettings = Object.freeze({});

function isNonEmpty(s: AgentSettings): boolean {
  return !!(s.maxTokens || s.reasoningEffort || s.maxSteps);
}

interface ProjectAgentSettingsState {
  settings: Record<string, AgentSettings>;
  loadedProjects: Record<string, boolean>;
  setSettings: (projectId: string, s: AgentSettings) => void;
  hydrateFromJson: (projectId: string, json: string) => void;
}

export const useProjectAgentSettingsStore = create<ProjectAgentSettingsState>((set) => ({
  settings: {},
  loadedProjects: {},

  setSettings: (projectId, s) => {
    set((state) => ({
      settings: { ...state.settings, [projectId]: s },
      loadedProjects: { ...state.loadedProjects, [projectId]: true },
    }));
  },

  hydrateFromJson: (projectId, json) => {
    try {
      const parsed = JSON.parse(json);
      const s: AgentSettings = {};
      if (typeof parsed.maxTokens === 'number' && parsed.maxTokens > 0) s.maxTokens = parsed.maxTokens;
      if (['low', 'medium', 'high'].includes(parsed.reasoningEffort)) s.reasoningEffort = parsed.reasoningEffort;
      if (typeof parsed.maxSteps === 'number' && parsed.maxSteps > 0) s.maxSteps = parsed.maxSteps;
      set((state) => ({
        settings: { ...state.settings, [projectId]: s },
        loadedProjects: { ...state.loadedProjects, [projectId]: true },
      }));
    } catch {
      set((state) => ({
        settings: { ...state.settings, [projectId]: EMPTY },
        loadedProjects: { ...state.loadedProjects, [projectId]: true },
      }));
    }
  },
}));

/** Stable selector: returns the settings object for a project (frozen empty object if not loaded). */
export function selectSettings(projectId: string) {
  return (s: ProjectAgentSettingsState) => s.settings[projectId] ?? EMPTY;
}

/** Stable selector: returns whether settings have been loaded for a project. */
export function selectLoaded(projectId: string) {
  return (s: ProjectAgentSettingsState) => !!s.loadedProjects[projectId];
}

/** Send file_read to load settings from sandbox FS. Caller must wire file_read_result listener.
 *  Uses send() which queues when not yet connected — only gates on null ref. */
export function loadAgentSettings(
  projectId: string,
  socket: { current: { send: (event: string, data: unknown) => void; connected: boolean } | null },
) {
  if (!socket.current) return;
  socket.current.send('file_read', { projectId, path: SETTINGS_PATH });
}

/** Write current settings to sandbox FS.
 *  Uses send() which queues when not yet connected — only gates on null ref. */
export function saveAgentSettings(
  projectId: string,
  settings: AgentSettings,
  socket: { current: { send: (event: string, data: unknown) => void; connected: boolean } | null },
) {
  if (!socket.current) return;
  const content = isNonEmpty(settings) ? JSON.stringify(settings, null, 2) : '{}';
  socket.current.send('file_write', { projectId, path: SETTINGS_PATH, content });
}

export const AGENT_SETTINGS_PATH = SETTINGS_PATH;
