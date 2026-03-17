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
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
  ],
};

export const DEFAULT_MODEL_BY_TYPE: Record<AgentTypeId, string> = {
  claude_code: 'sonnet',
  open_code: 'opencode/big-pickle',
  codex: 'gpt-5.4',
};

export const AGENT_TYPES: { value: AgentTypeId; label: string }[] = [
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'open_code', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

export function getModelsForAgentType(agentType?: string): AgentModelOption[] {
  return AGENT_MODELS_BY_TYPE[(agentType as AgentTypeId) || 'claude_code'] || AGENT_MODELS_BY_TYPE.claude_code;
}

// Backward-compatible export
export const AGENT_MODELS = AGENT_MODELS_BY_TYPE.claude_code;

interface AgentSettingsState {
  agentType: AgentTypeId;
  mode: AgentMode;
  model: AgentModel;
  setAgentType: (agentType: AgentTypeId) => void;
  setMode: (mode: AgentMode) => void;
  setModel: (model: AgentModel) => void;
}

export const useAgentSettingsStore = create<AgentSettingsState>((set) => ({
  agentType: 'claude_code',
  mode: 'agent',
  model: 'sonnet',
  setAgentType: (agentType) =>
    set({ agentType, model: DEFAULT_MODEL_BY_TYPE[agentType] }),
  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),
}));
