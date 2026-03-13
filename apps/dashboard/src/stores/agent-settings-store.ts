import { create } from 'zustand';

export type AgentMode = 'agent' | 'plan' | 'ask';
export type AgentModel = string;

export const AGENT_MODES: { value: AgentMode; label: string; description: string }[] = [
  { value: 'agent', label: 'Agent', description: 'Full autonomous coding agent' },
  { value: 'plan', label: 'Plan', description: 'Plan only, no edits' },
  { value: 'ask', label: 'Ask', description: 'Answer questions, no edits' },
];

export type AgentTypeId = 'claude_code' | 'open_code' | 'codex';

export interface AgentModelOption {
  value: string;
  label: string;
}

export const AGENT_MODELS_BY_TYPE: Record<AgentTypeId, AgentModelOption[]> = {
  claude_code: [
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'opus', label: 'Claude Opus' },
    { value: 'haiku', label: 'Claude Haiku' },
  ],
  open_code: [
    { value: 'opencode/big-pickle', label: 'Big Pickle (free)' },
    { value: 'opencode/gpt-5-nano', label: 'GPT-5 Nano (free)' },
    { value: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 (free)' },
  ],
  codex: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'o4-mini', label: 'o4-mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
  ],
};

export const DEFAULT_MODEL_BY_TYPE: Record<AgentTypeId, string> = {
  claude_code: 'sonnet',
  open_code: 'opencode/big-pickle',
  codex: 'gpt-4o',
};

export function getModelsForAgentType(agentType?: string): AgentModelOption[] {
  return AGENT_MODELS_BY_TYPE[(agentType as AgentTypeId) || 'claude_code'] || AGENT_MODELS_BY_TYPE.claude_code;
}

// Backward-compatible export
export const AGENT_MODELS = AGENT_MODELS_BY_TYPE.claude_code;

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
