import type { AgentCli } from './types.ts';

// Which model an agent's session asks for. The office's default model belongs to its default coding agent, and each
// worker can name their own; a model only goes to an agent that understands it (no Claude model for Codex).

/** Claude Code's model names and aliases. */
export const isClaudeModel = (model: string) => /^(claude|opus|sonnet|haiku|fable|default|best|opusplan)\b/i.test(model.trim());

/**
 * The model for a worker on `cli`: their own if it suits that agent, else the office default when `cli` is the
 * default agent, else `claudeDefault` for Claude Code, or '' to let any other agent use its own default.
 */
export function normalizeModelName(m: string): string {
  const t = m.trim();
  if (/^gpt-?6\.1[-\s]*sol(\s*\(low\))?$/i.test(t)) return 'gpt-6.1-sol';
  return t;
}

export function effectiveModel(own: string, cli: AgentCli, office: { defaultCli: AgentCli; defaultModel: string }, claudeDefault: string): string {
  const normalizedOwn = normalizeModelName(own);
  const normalizedOffice = normalizeModelName(office.defaultModel);
  const suits = (m: string) => {
    const trimmed = m.trim();
    if (!trimmed) return false;
    if (cli === 'copilot') return !trimmed.toLowerCase().includes('opencode') && !trimmed.toLowerCase().includes('space bunny');
    if (cli === 'codex') return !trimmed.toLowerCase().includes('opencode') && !trimmed.toLowerCase().includes('space bunny') && !isClaudeModel(trimmed);
    return (cli === 'claude') === isClaudeModel(trimmed);
  };
  if (suits(normalizedOwn)) return normalizedOwn;
  if (cli === office.defaultCli) {
    if (suits(normalizedOffice)) return normalizedOffice;
    if (!normalizedOffice && cli === 'codex') return 'gpt-6.1-sol';
    return '';
  }
  if (cli === 'claude') return claudeDefault;
  if (cli === 'copilot') return 'claude-sonnet-5.5';
  return '';
}
