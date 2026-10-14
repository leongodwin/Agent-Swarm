import fs from 'node:fs';
import path from 'node:path';
import type { AgentCli, AgentRole, EffortLevel, LogKind } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import type { UsageWarning } from './pacing.ts';
import type { AgentTerminal } from './terminal.ts';
import { type SessionAuthorization } from './toolGovernance.ts';

// One Claude Code instance (via the Claude Agent SDK) working one issue in its own git worktree.
// The CEO runs through here too, with the office tools instead of a shell.

export interface SessionOptions {
  /** Explicit identity for a new SDK session; used to correlate planning runtime recovery. */
  sessionId?:string;
  /** Structured planning jobs: no built-in tools, inherited MCP servers or project hooks. */
  noTools?: boolean;
  cwd: string;
  prompt: string;
  systemAppend: string;
  model: string; // e.g. 'claude-opus-5-5'
  effort: EffortLevel;
  browserTesting: boolean;
  additionalDirectories: string[]; // read-only reference clones of linked repos
  role: AgentRole;
  /** JSON schema for a structured final answer (QA reports). */
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  /** The CEO's in-process MCP server (mcp__office__*). */
  office?: OfficeTools;
  /** Task-owned authorization, checked for every supported pre-tool request. */
  authorizeTool?: SessionAuthorization;
  /** The terminal runtime: the agent's terminal and the CLI to run in it. Without one: an Agent SDK session. */
  terminal?: AgentTerminal;
  cli?: AgentCli;
  /** Who and on what, for the CLI's session name and status line, e.g. "Ada · #12 Add dark mode". */
  label?: string;
  /** Leave the CLI waiting at its prompt when the task is done, for the manager and for follow-ups. */
  keepAlive?: boolean;
  /** The prompt was typed at the CLI's prompt by the manager: it's already running, so it isn't sent again. */
  typed?: boolean;
  /** Whose terminal it is (the terminal keeper holds this, for the office that picks the CLI up after a restart). */
  agentId?: string;
  /** Follow the session of the CLI still running in the terminal after the office restarted; start nothing. */
  reattach?: boolean;
}

export interface LogEntry {
  kind: LogKind;
  text: string;
  tool?: string;
}

export interface SessionResult {
  /** False means process-family termination is unverified even if the launcher closed. */
  cleanupVerified?:boolean;
  ok: boolean;
  text: string;
  costUsd: number;
  turns: number;
  errors: string[];
  structured?: unknown;
  /** The manager interrupted the turn in the agent's terminal (Esc). */
  interrupted?: boolean;
  /** OpenCode hit its free usage limit and needs fallback to Copilot. */
  opencodeLimit?: boolean;
  /** Explicit native model rejection; changing task text does not repair it. */
  configurationError?:{kind:'unsupported-model';cli:AgentCli;model:string};
}

export interface SessionCallbacks {
  log(entries: LogEntry[]): void;
  tool(name: string | null): void;
  /** The session to resume next time; null: there's none to resume (the next session starts a new one). */
  sessionId(id: string | null): void;
  browserUrl(url: string): void;
  screenshot(data: Buffer, mime: string): void;
  /** The final text of each turn: the reply to the prompt and to every message sent while it ran. */
  turn?(text: string): void;
  /** Claude turned the session away for the subscription's usage limit (epoch ms when it resets, if known). */
  limited?(resetsAt: number | null): void;
  /** Claude warned that the subscription's usage is getting high (not while on overage). */
  usageWarning?(info: UsageWarning): void;
  finished(result: SessionResult): void;
}

export interface SessionHandle {
  send(text: string): void;
  stop(): void;
}

// ---------- permissions and screenshots ----------

/**
 * A Playwright screenshot saved to a file (browser_take_screenshot with a filename) comes back as a link, not an
 * image: the file, read from the agent's worktree, so it still counts as QA evidence.
 */
export function screenshotFile(cwd: string, text: string): { data: Buffer; mime: string } | null {
  const file = text.match(/\]\(([^)\s]+\.(png|jpe?g))\)/i);
  if (!file) return null;
  try {
    return { data: fs.readFileSync(path.resolve(cwd, file[1])), mime: /png$/i.test(file[2]) ? 'image/png' : 'image/jpeg' };
  } catch {
    return null;
  }
}

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * Screenshots in a browser's output folder that aren't in `seen` yet, oldest first (Playwright names them
 * page-<timestamp>). Files changed in the last second may still be being written, so they wait for the next look.
 */
export function newScreenshots(dir: string, seen: Set<string>, now = Date.now()): { name: string; file: string; mime: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: { name: string; file: string; mime: string }[] = [];
  for (const name of names.sort()) {
    const mime = IMAGE_MIME[path.extname(name).toLowerCase()];
    const file = path.join(dir, name);
    if (!mime || seen.has(name)) continue;
    try {
      if (now - fs.statSync(file).mtimeMs < 1000) continue;
    } catch {
      continue;
    }
    found.push({ name, file, mime });
  }
  return found;
}

// ---------- formatting the stream into terminal lines ----------

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rel(cwd: string, p: unknown) {
  const s = String(p ?? '');
  if (!s) return '';
  const r = path.relative(cwd, path.resolve(cwd, s)); // a relative path (Codex's patches) is the agent's, not ours
  return r && !r.startsWith('..') ? r.replaceAll('\\', '/') : s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Agents often prefix commands with `cd "<worktree>" &&` and print absolute paths; show them relative instead. */
export function tidyPaths(cwd: string, text: string): string {
  let out = text;
  for (const v of new Set([cwd, cwd.replaceAll('\\', '/')])) {
    out = out.replace(new RegExp(`^cd\\s+"?${escapeRe(v)}"?\\s*(&&|;)\\s*`, 'i'), '');
    out = out.replace(new RegExp(`${escapeRe(v)}[\\\\/]?`, 'gi'), './');
  }
  return out;
}

export function describeTool(cwd: string, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `$ ${clip(tidyPaths(cwd, String(input.command ?? '')).split('\n')[0], 220)}`;
    case 'Read':
      return `Read ${rel(cwd, input.file_path)}`;
    case 'Write':
      return `Write ${rel(cwd, input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${rel(cwd, input.file_path)}`;
    case 'Glob':
      return `Glob ${input.pattern}`;
    case 'Grep':
      return `Grep "${clip(String(input.pattern ?? ''), 80)}"`;
    case 'WebFetch':
      return `Fetch ${input.url}`;
    case 'WebSearch':
      return `Search "${input.query}"`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${input.description ?? ''}`;
    case 'TodoWrite':
      return 'Update todo list';
    case 'ToolSearch':
      return `Load tools ${String(input.query ?? '').replace(/^select:/, '')}`;
    case 'apply_patch': {
      // Codex's file edits: "*** Add File: a.ts", "*** Update File: b.ts", "*** Delete File: c.ts"
      const files = [...String(input.command ?? '').matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map((m) => `${m[1] === 'Update' ? '' : `${m[1].toLowerCase()} `}${rel(cwd, m[2].trim())}`);
      return `Edit ${clip(files.join(', ') || 'files', 200)}`;
    }
  }
  if (name.startsWith('mcp__playwright__')) {
    const action = name.replace('mcp__playwright__browser_', '').replace('mcp__playwright__', '');
    const detail = input.url ?? input.element ?? input.text ?? '';
    return `🌐 ${action}${detail ? ` ${clip(String(detail), 120)}` : ''}`;
  }
  if (name.startsWith('mcp__office__')) return describeOfficeTool(name.slice('mcp__office__'.length), input);
  return `${name}(${clip(JSON.stringify(input), 140)})`;
}

export function describeOfficeTool(action: string, input: Record<string, unknown>): string {
  const floor = input.floor != null ? ` → floor ${input.floor}` : '';
  switch (action) {
    case 'company_status':
      return '🏢 company_status';
    case 'agent_detail':
      return `🔎 agent_detail ${String(input.agent_id ?? '')}`;
    case 'set_floor_profile':
      return `🗂️ set_floor_profile${floor}${input.summary ? `: ${clip(String(input.summary), 90)}` : ''}`;
    case 'update_job':
      return `🪪 update_job ${input.title ? `"${clip(String(input.title), 60)}"` : String(input.agent_id ?? '')}`;
    case 'propose_hire':
      return `🤝 propose_hire ${input.role === 'qa' ? 'QA ' : ''}"${clip(String(input.title ?? ''), 60)}"${floor}`;
    case 'propose_let_go':
      return `👋 propose_let_go ${String(input.agent_id ?? '')}`;
    case 'file_issue':
      return `📝 file_issue "${clip(String(input.title ?? ''), 70)}"${floor}${input.specialty ? ` · ${input.specialty}` : ''}`;
    case 'route_issue':
      return `🔀 route_issue #${String(input.number ?? '?')}${floor}${input.specialty !== undefined ? ` · ${input.specialty || 'no specialty'}` : ''}${Array.isArray(input.depends_on) ? ` · depends on ${input.depends_on.map((n) => `#${n}`).join(', ') || 'nothing'}` : ''}`;
  }
  return `🏢 ${action}(${clip(JSON.stringify(input), 120)})`;
}

export function todoLines(input: Record<string, unknown>): LogEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
  return todos.slice(0, 12).map((t) => ({
    kind: 'result' as const,
    text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${clip(t.content ?? '', 150)}`,
  }));
}

export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

const lineCount = (text: string) => text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '').length;

export function summariseResult(cwd: string, tool: string, text: string): LogEntry[] {
  // Claude Code-style one-liners for the chatty file tools
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return [{ kind: 'result', text: '  ⎿ Updated' }];
  if (tool === 'apply_patch' && /Success\. Updated the following files/.test(text)) return [{ kind: 'result', text: '  ⎿ Updated' }];
  if (tool === 'Write') return [{ kind: 'result', text: '  ⎿ Saved' }];
  if (tool === 'Read') return [{ kind: 'result', text: `  ⎿ Read ${lineCount(text)} lines` }];
  if (tool === 'Glob') return [{ kind: 'result', text: `  ⎿ Found ${lineCount(text)} files` }];
  const lines = tidyPaths(cwd, text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [{ kind: 'result', text: '  ⎿ (no output)' }];
  const shown = lines.slice(0, 3).map((l, i) => ({ kind: 'result' as const, text: `${i === 0 ? '  ⎿ ' : '    '}${clip(l, 170)}` }));
  if (lines.length > 3) shown.push({ kind: 'result', text: `    … +${lines.length - 3} lines` });
  return shown;
}

// ---------- the session ----------

export function startSession(_opts: SessionOptions, _callbacks: SessionCallbacks): SessionHandle {
  throw new Error('Claude SDK execution is disabled; use Codex, Gemini or OpenCode');
}
