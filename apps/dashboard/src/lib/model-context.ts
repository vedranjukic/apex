/**
 * Context window sizes (total tokens) for known models.
 * Used to calculate "% of context used" from token counts.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-sonnet-4-20250514': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-haiku-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,

  // OpenAI
  'gpt-5': 256_000,
  'gpt-5.1': 256_000,
  'gpt-5.2': 256_000,
  'gpt-5.4': 256_000,
  'gpt-5.1-codex': 256_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o1': 200_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,

  // Google
  'gemini-3-pro': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
};

/**
 * Look up the context window for a model string.
 * Handles both "provider/model" format and bare model names,
 * and does substring matching for versioned model IDs.
 */
export function getContextWindow(model: string | undefined | null): number | null {
  if (!model) return null;

  const bare = model.includes('/') ? model.split('/').slice(1).join('/') : model;

  if (MODEL_CONTEXT_WINDOWS[bare]) return MODEL_CONTEXT_WINDOWS[bare];

  for (const [key, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (bare.startsWith(key) || bare.includes(key)) return size;
  }
  return null;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
