import { create } from 'zustand';

export type AgentMode = 'agent' | 'plan' | 'ask';
export type AgentModel = 'sonnet' | 'opus' | 'haiku';

export const AGENT_MODES: { value: AgentMode; label: string; description: string }[] = [
  { value: 'agent', label: 'Agent', description: 'Full autonomous coding agent' },
  { value: 'plan', label: 'Plan', description: 'Plan only, no edits' },
  { value: 'ask', label: 'Ask', description: 'Answer questions, no edits' },
];

export const AGENT_MODELS: { value: AgentModel; label: string }[] = [
  { value: 'sonnet', label: 'Claude Sonnet' },
  { value: 'opus', label: 'Claude Opus' },
  { value: 'haiku', label: 'Claude Haiku' },
];

interface AgentSettingsState {
  mode: AgentMode;
  model: AgentModel;
  setMode: (mode: AgentMode) => void;
  setModel: (model: AgentModel) => void;
}

export const useAgentSettingsStore = create<AgentSettingsState>((set) => ({
  mode: 'agent',
  model: 'sonnet',
  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),
}));
