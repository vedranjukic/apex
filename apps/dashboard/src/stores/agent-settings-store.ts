import { create } from 'zustand';

/** @deprecated Mode is now derived from agent selection */
export type AgentMode = 'agent' | 'plan' | 'ask';
export type AgentModel = string;
export type AgentTypeId = string;

/** @deprecated Kept for backward compat — mode is derived from agent */
export const AGENT_MODES: { value: AgentMode; label: string; description: string }[] = [
  { value: 'agent', label: 'Agent', description: 'Full autonomous coding agent' },
  { value: 'plan', label: 'Plan', description: 'Plan only, no edits' },
  { value: 'ask', label: 'Ask', description: 'Answer questions, no edits' },
];

export interface AgentModelOption {
  value: string;
  label: string;
  provider?: string;
}

/**
 * All available models — shown as quick-picks in the combobox.
 * Users can also type any provider/model ID directly.
 * IDs follow the OpenCode format: provider_id/model_id (from models.dev).
 */
export const AGENT_MODELS: AgentModelOption[] = [
  { value: '', label: 'Auto (provider default)' },
  // Anthropic
  { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'anthropic' },
  { value: 'anthropic/claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { value: 'anthropic/claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'anthropic' },
  { value: 'anthropic/claude-haiku-4-20250514', label: 'Claude Haiku 4', provider: 'anthropic' },
  // OpenAI
  { value: 'openai/gpt-5', label: 'GPT-5', provider: 'openai' },
  { value: 'openai/gpt-5.1', label: 'GPT-5.1', provider: 'openai' },
  { value: 'openai/gpt-5.2', label: 'GPT-5.2', provider: 'openai' },
  { value: 'openai/gpt-5.1-codex', label: 'GPT-5.1 Codex', provider: 'openai' },
  // Google
  { value: 'google/gemini-3-pro', label: 'Gemini 3 Pro', provider: 'google' },
  // OpenCode Zen (free)
  { value: 'opencode/gpt-5.1-codex', label: 'GPT-5.1 Codex (Zen)', provider: 'opencode' },
];

/** Empty string means "let OpenCode pick the best model from configured providers" */
export const DEFAULT_MODEL = '';

export interface AgentOption {
  value: string;
  label: string;
  description: string;
  /** Provider allowlist — if set, only models from these providers are shown. Empty = all. */
  providers?: string[];
}

export const AGENTS: AgentOption[] = [
  { value: 'build', label: 'Build', description: 'Full autonomous coding agent' },
  { value: 'plan', label: 'Plan', description: 'Read-only analysis and planning' },
  {
    value: 'sisyphus',
    label: 'Sisyphus',
    description: 'Orchestration agent',
    providers: ['anthropic'],
  },
];

export const AGENT_TYPES: { value: AgentTypeId; label: string }[] = AGENTS;

/**
 * Returns the models available for a given agent, filtered by provider allowlist.
 * "Auto" (empty value) is always included.
 */
export function getModelsForAgent(agentType?: string): AgentModelOption[] {
  const agent = AGENTS.find((a) => a.value === agentType);
  if (!agent?.providers?.length) return AGENT_MODELS;
  const allowed = new Set(agent.providers);
  return AGENT_MODELS.filter((m) => !m.provider || allowed.has(m.provider));
}

/** @deprecated Use AGENT_MODELS instead */
export const AGENT_MODELS_BY_TYPE: Record<string, AgentModelOption[]> = {
  build: AGENT_MODELS,
  plan: AGENT_MODELS,
  sisyphus: getModelsForAgent('sisyphus'),
};

/** @deprecated Use DEFAULT_MODEL instead */
export const DEFAULT_MODEL_BY_TYPE: Record<string, string> = {
  build: DEFAULT_MODEL,
  plan: DEFAULT_MODEL,
  sisyphus: DEFAULT_MODEL,
};

/** @deprecated Use getModelsForAgent instead */
export function getModelsForAgentType(agentType?: string): AgentModelOption[] {
  return getModelsForAgent(agentType);
}

function agentToMode(agent: string): AgentMode {
  if (agent === 'plan') return 'plan';
  return 'agent';
}

/** Check if the current model is compatible with the new agent */
function modelCompatibleWith(model: string, agentType: string): boolean {
  if (!model) return true;
  const agent = AGENTS.find((a) => a.value === agentType);
  if (!agent?.providers?.length) return true;
  const provider = model.split('/')[0];
  return agent.providers.includes(provider);
}

interface AgentSettingsState {
  agentType: AgentTypeId;
  /** Derived from agentType for backward compat */
  mode: AgentMode;
  model: AgentModel;
  setAgentType: (agentType: AgentTypeId) => void;
  /** @deprecated Use setAgentType instead */
  setMode: (mode: AgentMode) => void;
  setModel: (model: AgentModel) => void;
}

export const useAgentSettingsStore = create<AgentSettingsState>((set, get) => ({
  agentType: 'build',
  mode: 'agent',
  model: DEFAULT_MODEL,
  setAgentType: (agentType) => {
    const currentModel = get().model;
    const model = modelCompatibleWith(currentModel, agentType)
      ? currentModel
      : DEFAULT_MODEL;
    set({ agentType, mode: agentToMode(agentType), model });
  },
  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),
}));
