import {allowedRuntime,runtimeModelError} from '../shared/runtimePolicy.ts';
import fs from 'node:fs';
import path from 'node:path';
import { run } from './exec.ts';
import type { AgentCli, CliView, EffortLevel } from '../shared/types.ts';

// The coding-agent CLIs an agent can run in its terminal, how to find them on this machine, and how to start one on
// a task. Claude Code is fully wired in: its hooks report every tool call to the office.
// Other CLIs run the same prompt and report when a turn ends; the office shows their task instead of each tool call.

export interface CliDef {
  id: AgentCli;
  label: string;
  command: string;
  integrated: boolean;
}

export const CLIS: CliDef[] = [
  { id: 'codex', label: 'Codex', command: 'codex', integrated: false },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', integrated: false },
  { id: 'gemini', label: 'Gemini', command: 'gemini', integrated: false },
];

export const isCli = (v: unknown): v is AgentCli => CLIS.some((c) => c.id === v);
export const cliLabel = (id: AgentCli) => CLIS.find((c) => c.id === id)?.label ?? id;

// ---------- finding a CLI ----------

const WIN = process.platform === 'win32';

/** The executable for a command name on PATH: on Windows only .exe/.cmd/.bat/.com, never an extensionless sh shim. */
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = (env[key] ?? '').split(path.delimiter).filter(Boolean);
  const exts = WIN ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => /^\.(exe|cmd|bat|com)$/i.test(e)) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try {
        const st = fs.statSync(file);
        if (st.isFile() && (WIN || (st.mode & 0o111) !== 0)) return file;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * npm installs Windows CLIs as .cmd shims. Running one puts every argument through cmd.exe, which expands %VARS% and
 * trips over quotes in a prompt, so run what the shim runs instead: the package's .exe, or node on its script.
 */
export function unwrapCmdShim(shimPath: string, text: string): { file: string; args: string[] } | null {
  const line = text.split(/\r?\n/).find((l) => /%\*\s*$/.test(l));
  if (!line) return null;
  const dir = path.dirname(shimPath);
  const targets = [...line.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => path.join(dir, m[1]));
  const target = targets[targets.length - 1];
  if (!target) return null;
  if (/\.exe$/i.test(target)) return { file: target, args: [] };
  if (!/\.[cm]?js$/i.test(target)) return null;
  const between = line.slice(line.indexOf('"%_prog%"') + '"%_prog%"'.length, line.lastIndexOf(`"%dp0%\\`));
  const nodeFlags = line.includes('"%_prog%"') ? between.trim().split(/\s+/).filter((f) => f.startsWith('--')) : [];
  const localNode = path.join(dir, 'node.exe');
  return { file: fs.existsSync(localNode) ? localNode : process.execPath, args: [...nodeFlags, target] };
}

/**
 * The Claude Code the Agent SDK ships as a per-platform package (the one `cubefarm login` signs in with), so the
 * terminal runtime works without Claude Code installed, on the version the office was tested with. Same lookup as
 * the SDK's own and bin/cubefarm.js.
 */
/** How to start a CLI: the program and the arguments that come before the office's own. */
export function commandFor(id: AgentCli): { file: string; args: string[] } | null {
  if (!allowedRuntime(id)) return null;
  const def = CLIS.find((c) => c.id === id);
  const found = def && resolveCommand(def.command);
  if (!found) return null;
  if (WIN && /\.(cmd|bat)$/i.test(found)) {
    try {
      return unwrapCmdShim(found, fs.readFileSync(found, 'utf8')) ?? { file: found, args: [] };
    } catch {
      return { file: found, args: [] };
    }
  }
  return { file: found, args: [] };
}

/** Which CLIs this machine has, with their versions. */
export async function detectClis(): Promise<CliView[]> {
  return Promise.all(
    CLIS.map(async (c) => {
      const cmd = commandFor(c.id);
      const version = cmd ? await run(cmd.file, [...cmd.args, '--version'], { timeoutMs: 20_000 }).catch(() => null) : null;
      return { id: c.id, label: c.label, installed: !!cmd, version: version?.split(/\r?\n/)[0].trim().slice(0, 60) || null, integrated: c.integrated };
    }),
  );
}

// ---------- starting one on a task ----------

export interface LaunchContext {
  prompt: string;
  systemAppend: string;
  model: string; // '' = the CLI's own default
  effort: EffortLevel | '';
  resumeId?: string;
  sessionId: string; // the id the office gives a new Claude Code session
  name: string; // shown in Claude Code's prompt box and the terminal title
  role: 'dev' | 'qa' | 'ceo';
  additionalDirectories: string[];
  /** Files the office wrote for this session (settings, MCP config, instructions). */
  files: { settings: string; mcp: string | null; system: string };
  /** Where the CLI's turn-complete signal goes (Codex notify, the OpenCode plugin). */
  notify: { script: string; url: string };
  /** Codex's hook program: forwards each hook to the office (notify.url). */
  codexHook: string;
  plugin: string; // file URL of the OpenCode plugin
  /** The Playwright MCP server, when the floor tests in a browser. Claude Code gets it through its MCP config file. */
  browser: { command: string; args: string[] } | null;
  /** Session-scoped CEO office tools, using Streamable HTTP. */
  officeUrl?: string;
}

export interface Launch {
  args: string[];
  env: Record<string, string>;
}

const EFFORT_CODEX: Record<EffortLevel, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

/** Codex hooks the office listens to: its steps, and Esc interrupting a turn. Turn endings come from notify. */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Interrupt'];

/**
 * The command Codex runs for each hook. It never changes (the office's address travels in CUBEFARM_HOOK_URL), so the
 * manager trusts the hooks once in Codex's /hooks and that holds for every session. On Windows, Codex runs it through
 * PowerShell or cmd depending on its version, and a command starting with a quote fails in both: plain `node` (on the
 * PATH the office gave it) and the script in double quotes work in either. Elsewhere it goes through the shell.
 */
export function codexHookCommand(node: string, script: string, win = WIN): string {
  return win ? `node "${script}"` : [node, script].map((s) => `'${s.replaceAll("'", `'"'"'`)}'`).join(' ');
}

export function launchArgs(id: AgentCli, ctx: LaunchContext): Launch {
  const error=runtimeModelError(id,ctx.model);if(error)throw new Error(error);
  switch (id) {
    case 'gemini': return {args:[...(ctx.model?['--model',ctx.model]:[]),...(ctx.resumeId?['--resume',ctx.resumeId]:[]),'--prompt-interactive',`${ctx.systemAppend}\n\n${ctx.prompt}`],env:{}};
    case 'codex': {
      const toml = (s: string) => JSON.stringify(s); // a JSON string is a valid TOML basic string
      const args = [
        '--no-alt-screen',
        '-c',
        `notify=[${[process.execPath, ctx.notify.script, ctx.notify.url].map(toml).join(',')}]`,
        '-c',
        `developer_instructions=${toml(ctx.systemAppend)}`,
        ...(ctx.model ? ['-m', ctx.model] : []),
        ...(ctx.effort ? ['-c', `model_reasoning_effort=${toml(EFFORT_CODEX[ctx.effort])}`] : []),
        ...(ctx.browser ? ['-c', `mcp_servers.playwright={command=${toml(ctx.browser.command)},args=[${ctx.browser.args.map(toml).join(',')}],startup_timeout_sec=60}`] : []),
        ...(ctx.officeUrl ? ['-c', `mcp_servers.office={url=${toml(ctx.officeUrl)}}`] : []),
        ...CODEX_HOOK_EVENTS.flatMap((e) => ['-c', `hooks.${e}=[{hooks=[{type="command",command=${toml(codexHookCommand(process.execPath, ctx.codexHook))},timeout=${e === 'Interrupt' ? 3 : 10}}]}]`]),
        // Like the manager's own Codex, but it can't stop to ask: no approvals and no sandbox (its sandbox can't reach
        // the credential store, so git and gh fail in it).
        '--dangerously-bypass-approvals-and-sandbox',
      ];
      return { args: ctx.resumeId ? ['resume', ...args, ctx.resumeId, ctx.prompt] : [...args, '--', ctx.prompt], env: { CUBEFARM_HOOK_URL: ctx.notify.url } };
    }
    case 'opencode': {
      const config = {
        enabled_providers: ['openai','google'],
        model: ctx.model,
        small_model: ctx.model,
        plugin: [ctx.plugin],
        instructions: [ctx.files.system],
        autoupdate: false, // several agents starting at once must not each reinstall it
        permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' }, // it can't stop to ask either
        ...((ctx.browser || ctx.officeUrl) ? { mcp: {
          ...(ctx.browser ? { playwright: { type: 'local', command: [ctx.browser.command, ...ctx.browser.args], enabled: true } } : {}),
          ...(ctx.officeUrl ? { office: { type: 'remote', url: ctx.officeUrl, enabled: true } } : {}),
        } } : {}),
      };
      // No project argument: it starts in its terminal's folder, and a desk path in its command line would make the
      // desk clean-up take it for a leftover.
      const args = [
        '--auto',
        ...(ctx.model ? ['--model', ctx.model] : []),
        ...(ctx.resumeId ? ['--session', ctx.resumeId] : []),
        '--prompt',
        ctx.prompt,
      ];
      return { args, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), CUBEFARM_NOTIFY_URL: ctx.notify.url } };
    }
    default: throw new Error('Unsupported coding runtime');
  }
}

// ---------- Codex's saved threads ----------

/** Runs each key's steps one after another; one that fails doesn't hold up the next. */
export function oneAtATime() {
  const tails = new Map<string, Promise<void>>();
  return (key: string, step: () => Promise<unknown>): Promise<void> => {
    const next = (tails.get(key) ?? Promise.resolve()).then(step).then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, next);
    void next.then(() => tails.get(key) === next && tails.delete(key));
    return next;
  };
}

const threadSteps = oneAtATime();

/**
 * Codex saves every terminal session where the manager's own Codex and ChatGPT apps list it with their chats. The
 * office archives its threads there once their CLI is gone (`after`), and unarchives one before resuming it: Codex
 * won't resume an archived thread. A thread's steps run in order; one with nothing to do (already archived) fails.
 */
export function codexThread(action: 'archive' | 'unarchive', id: string, after?: Promise<unknown>): Promise<void> {
  return threadSteps(id, async () => {
    await after;
    const cmd = commandFor('codex');
    if (cmd) await run(cmd.file, [...cmd.args, action, id], { timeoutMs: 30_000 });
  });
}

// ---------- prompts the office answers ----------

const TRUST_PROMPT = /Quick safety check|Do you trust the (files|contents) (in|of) this|trust this folder|allow Codex to work in this folder/i;

/**
 * The key that moves a CLI's folder-trust question toward trusting the office's own worktree: Enter when the
 * selected option says yes, Down when it says no (Claude Code selects "No, exit" first), null when there's no such
 * question on screen.
 */
export function trustKey(screen: string): 'enter' | 'down' | null {
  if (!TRUST_PROMPT.test(screen)) return null;
  const selected = screen.match(/^\s*[❯›]\s*(?:\d+\.\s*)?(.+)$/m)?.[1] ?? '';
  if (/^(yes|trust|continue|proceed)\b/i.test(selected.trim())) return 'enter';
  if (/^(no|exit|quit|cancel)\b/i.test(selected.trim())) return 'down';
  return null;
}

/**
 * Codex asks to review new hooks before it starts. They only show the office Codex's steps, so trusting them is the
 * manager's call (once, in /hooks): the office moves to "Continue without trusting" (Down) and takes it (Enter).
 */
export function hookReviewKey(screen: string): 'enter' | 'down' | null {
  if (!/Hooks need review/i.test(screen)) return null;
  const selected = screen.match(/^\s*[❯›]\s*(?:\d+\.\s*)?(.+)$/m)?.[1] ?? '';
  return /^continue without trusting/i.test(selected.trim()) ? 'enter' : 'down';
}

/**
 * Lines on screen where a CLI says it interrupted a turn (Claude Code: "Interrupted · What should Claude do
 * instead?", Codex: "Conversation interrupted"). Esc fires no hook in Claude Code, so a new one is how the office
 * knows the manager stopped the turn from the terminal.
 */
export function interruptions(screen: string): number {
  return screen.split('\n').filter((l) => /\binterrupted\b/i.test(l)).length;
}

// ---------- helper scripts the CLIs run ----------

/** Claude Code's status line: posts its data (cost, usage limits) to the office and shows the office's line. */
export const STATUSLINE_SOURCE = String.raw`// cubefarm: Claude Code's status line. Forwards the session's status to the office and prints the office's line.
const url = process.argv[2];
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', async () => {
  try {
    const status = JSON.parse(body);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'StatusLine', session_id: status.session_id, cost: status.cost, rate_limits: status.rate_limits }),
      signal: AbortSignal.timeout(2000),
    });
    const out = await res.json();
    process.stdout.write(String(out.statusLine ?? ''));
  } catch {
    process.stdout.write('cubefarm');
  }
});
`;

/** Codex's notify program: Codex runs it with a JSON argument when a turn completes. */
export const NOTIFY_SOURCE = String.raw`// cubefarm: Codex's notify program. Tells the office a turn is complete.
const [url, payload] = process.argv.slice(2);
let event = {};
try {
  event = JSON.parse(payload ?? '{}');
} catch {}
if (event.type === 'agent-turn-complete') {
  const input = String((event['input-messages'] ?? [])[0] ?? '').slice(0, 300);
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'TurnComplete', session_id: event['thread-id'] ?? null, last_assistant_message: event['last-assistant-message'] ?? '', input }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
`;

/** Trusted pre-tool hooks relay the office decision. Transport failures deny
 * pre-tool execution, while observational hooks remain nonblocking. */
export const CODEX_HOOK_SOURCE = String.raw`// cubefarm: relays governance decisions for trusted pre-tool hooks.
const url = process.argv[2] || process.env.CUBEFARM_HOOK_URL;
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!url) throw new Error('Office hook URL unavailable');
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error('Office hook must use loopback');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Office hook unavailable');
    const answer = await response.json();
    if (body.hook_event_name === 'PreToolUse' && !['allow', 'deny'].includes(answer?.hookSpecificOutput?.permissionDecision)) throw new Error('No verified pre-tool decision');
    // Codex retains its native permission rules. Claude's existing unattended
    // mode explicitly opts into approval after the office safeguard succeeds.
    const preservePermissions = !process.argv.includes('--approve-governed');
    process.stdout.write(JSON.stringify(preservePermissions && body.hook_event_name === 'PreToolUse' && answer?.hookSpecificOutput?.permissionDecision === 'allow' ? {} : answer));
  } catch {
    if (body.hook_event_name === 'PreToolUse') {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Office governance unavailable; execution denied' } }));
      process.stderr.write('Office governance unavailable; execution denied.');
      process.exitCode = 2;
    } else process.stdout.write('{}');
  }
});
`;

/** OpenCode plugin: reports its session and when it goes idle (a turn is complete). No imports: loaded from a file. */
export const OPENCODE_PLUGIN_SOURCE = String.raw`// cubefarm: checks authority before tools and reports outcomes.
export default async function CubefarmPlugin({ client } = {}) {
  const url = process.env.CUBEFARM_NOTIFY_URL;
  let endpoint;
  try {
    endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error();
  } catch { throw new Error('Office governance endpoint is unavailable; OpenCode execution denied'); }
  let root;
  const names = {read:'Read',glob:'Glob',grep:'Grep',write:'Write',edit:'Edit',multiedit:'MultiEdit',bash:'Bash',apply_patch:'apply_patch'};
  const normalize = (name,args) => {
    const fields = {...args};
    if ('filePath' in fields) fields.file_path = fields.filePath;
    if ('newString' in fields) fields.new_string = fields.newString;
    if ('patchText' in fields) {fields.patch = fields.patchText;fields.command = fields.patchText;}
    if (Array.isArray(fields.edits)) fields.edits = fields.edits.map(edit=>({...edit,new_string:edit.new_string??edit.newString}));
    return {name:names[name]??(name.startsWith('office_')?'mcp__office__'+name.slice(7):name.startsWith('playwright_')?'mcp__playwright__'+name.slice(11):name),fields};
  };
  const authorize = async (input,output) => {
    const {name,fields} = normalize(input.tool,output.args);
    const body = JSON.stringify({hook_event_name:'PreToolUse',tool_name:name,tool_input:fields,tool_use_id:input.callID,session_id:input.sessionID});
    if (Buffer.byteLength(body)>1024*1024) throw new Error('Tool request exceeds the governance inspection limit');
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error();
      const answer=await response.json();
      if(answer?.hookSpecificOutput?.permissionDecision!=='allow')throw new Error();
    } catch { throw new Error('Office tool authority or governance was denied or unavailable; execution denied'); }
  };
  const post = (body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) }).catch(() => {});
  const lastReply = async (id) => {
    try {
      const res = await client.session.messages({ path: { id } });
      const reply = (res?.data ?? []).filter((m) => m?.info?.role === 'assistant').pop();
      return (reply?.parts ?? []).filter((p) => p?.type === 'text').map((p) => p.text).join('\n').trim();
    } catch {
      return '';
    }
  };
  return {
    'tool.execute.before': authorize,
    'tool.execute.after': async (input,output) => {
      const {name}=normalize(input.tool,input.args??{});
      await post({hook_event_name:'PostToolUse',tool_name:name,tool_use_id:input.callID,session_id:input.sessionID,tool_response:{content:[{type:'text',text:String(output.output??'').slice(0,16000)}]}});
    },
    event: async ({ event }) => {
      const props = event?.properties ?? {};
      if (event?.type === 'session.created' && !props.info?.parentID && !root) root = props.info?.id;
      const sessionID = props.sessionID ?? props.info?.id;
      if (event?.type === 'session.idle' && (!root || sessionID === root)) {
        post({ hook_event_name: 'TurnComplete', session_id: sessionID ?? null, last_assistant_message: sessionID ? await lastReply(sessionID) : '' });
      }
      if (event?.type === 'session.error') post({ hook_event_name: 'TurnError', session_id: sessionID ?? null, error: String(props.error?.data?.message ?? props.error?.message ?? props.error?.name ?? 'error') });
    },
  };
}
`;
