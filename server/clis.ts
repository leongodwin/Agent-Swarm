import crypto from 'node:crypto';
import {geminiProfilePath} from './geminiBridge.ts';
import {allowedRuntime,runtimeModelError,CODEX_REASONING_EFFORT} from '../shared/runtimePolicy.ts';
import fs from 'node:fs';
import path from 'node:path';
import { run } from './exec.ts';
import type {WorkerMcpServer} from './workerMcp.ts';
import type { AgentCli, CliView, EffortLevel } from '../shared/types.ts';

// The coding-agent CLIs an agent can run in its terminal, how to find them on this machine, and how to start one on
// a task. Only Codex, Gemini and OpenCode may execute; their bridges report tool checkpoints to the office.

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
  coordinatorBrowser?:boolean;
  platformServers?:Record<string,WorkerMcpServer>;
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
  files: { settings: string; mcp: string | null; system: string; codexProfile?:string };
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


/** Codex hooks the office listens to: its steps, and Esc interrupting a turn. Turn endings come from notify. */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Interrupt'];
// Native timeout must outlast the bridge's bounded 30-second request so a
// structured denial reaches Codex before it abandons a slow hook.
export const codexHookTimeout = (event:string) => event === 'Interrupt' ? 3 : 60;

/**
 * The command Codex runs for each hook. It never changes (the office's address travels in CUBEFARM_HOOK_URL), so the
 * manager trusts the hooks once in Codex's /hooks and that holds for every session. On Windows, Codex runs it through
 * PowerShell or cmd depending on its version, and a command starting with a quote fails in both: plain `node` (on the
 * PATH the office gave it) and the script in double quotes work in either. Elsewhere it goes through the shell.
 */
export function codexHookCommand(node: string, script: string, win = WIN): string {
  return win ? `node "${script}"` : [node, script].map((s) => `'${s.replaceAll("'", `'"'"'`)}'`).join(' ');
}

export function codexHookInvocation(script:string,event:string){
  return `${codexHookCommand(process.execPath,script)} --event ${event} --bridge-sha256 ${crypto.createHash('sha256').update(CODEX_HOOK_SOURCE).digest('hex')}`;
}

export function launchArgs(id: AgentCli, ctx: LaunchContext): Launch {
  const error=runtimeModelError(id,ctx.model);if(error)throw new Error(error);
  if(id==='gemini'&&Object.keys(ctx.platformServers??{}).length)throw new Error('Gemini native platform MCP servers require a reviewed protected profile; no tools were silently omitted');
  switch (id) {
    case 'gemini': {
      const profile=geminiProfilePath(!!ctx.browser);
      return {args:[...(ctx.model?['--model',ctx.model]:[]),...(ctx.resumeId?['--resume',ctx.resumeId]:[])],env:{GEMINI_CLI_SYSTEM_SETTINGS_PATH:profile,CUBEFARM_HOOK_URL:ctx.notify.url,...(ctx.officeUrl?{CUBEFARM_OFFICE_URL:ctx.officeUrl}:{}),CUBEFARM_BROWSER_OUTPUT:path.join(path.dirname(ctx.files.settings),'browser')}};
    }
    case 'codex': {
      const toml = (s: string) => JSON.stringify(s); // a JSON string is a valid TOML basic string
      const args = [
        '--no-alt-screen','--enable','hooks',
        '-c',
        `notify=[${[process.execPath, ctx.notify.script, ctx.notify.url].map(toml).join(',')}]`,
        ...(ctx.files.codexProfile?['--profile',ctx.files.codexProfile]:['-c',`developer_instructions=${toml(ctx.systemAppend)}`]),
        ...(ctx.model ? ['-m', ctx.model] : []),
        ...(ctx.effort ? ['-c', `model_reasoning_effort=${toml(CODEX_REASONING_EFFORT[ctx.effort])}`] : []),
        // Browsing remains optional here: presence is not a reviewed task
        // dependency. Browser operations still fail if its bridge is unavailable.
        ...(ctx.browser ? ['-c', `mcp_servers.playwright={command=${toml(ctx.browser.command)},args=[${ctx.browser.args.map(toml).join(',')}],enabled=true,startup_timeout_sec=60}`] : ctx.coordinatorBrowser?['-c',`mcp_servers.playwright={command=${toml(process.execPath)},args=[],enabled=false}`]:[]),
        ...(ctx.officeUrl ? ['-c', `mcp_servers.office={url=${toml(ctx.officeUrl)},enabled=true,required=true,startup_timeout_sec=30,tool_timeout_sec=120}`] : []),
        // Disable only known duplicate aliases in this child session. Keep the
        // user's global configuration intact and give hooks one stable name.
        // Even a disabled MCP entry needs a valid transport in native Codex.
        // Include the transport so an alias absent from global config still parses.
        ...Object.entries(ctx.platformServers??{}).flatMap(([name,server])=>(name==='canvas_authoring'?['canvas-authoring']:name==='flowagent'?['swarm-flowagent','swarm_flowagent']:[]).flatMap(alias=>['-c',`mcp_servers.${alias}={command=${toml(server.command)},args=[${server.args.map(toml).join(',')}],enabled=false}`])),
        ...Object.entries(ctx.platformServers??{}).flatMap(([name,server])=>['-c',`mcp_servers.${name}={command=${toml(server.command)},args=[${server.args.map(toml).join(',')}],${server.cwd?`cwd=${toml(server.cwd)},`:''}${server.env?`env={${Object.entries(server.env).map(([key,value])=>`${toml(key)}=${toml(value)}`).join(',')}},`:''}enabled=true,required=true,startup_timeout_sec=90}`]),
        ...CODEX_HOOK_EVENTS.flatMap((e) => ['-c', `hooks.${e}=[{hooks=[{type="command",command=${toml(codexHookInvocation(ctx.codexHook,e))},timeout=${codexHookTimeout(e)}}]}]`]),
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
        ...((ctx.browser || ctx.officeUrl || Object.keys(ctx.platformServers??{}).length) ? { mcp: {
          ...(ctx.browser ? { playwright: { type: 'local', command: [ctx.browser.command, ...ctx.browser.args], enabled: true } } : {}),
          ...(ctx.officeUrl ? { office: { type: 'remote', url: ctx.officeUrl, enabled: true } } : {}),
          ...Object.fromEntries(Object.entries(ctx.platformServers??{}).map(([name,server])=>[name,{type:'local',command:[server.command,...server.args],enabled:true,...(server.env?{environment:server.env}:{})}])),
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
      return { args, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), CUBEFARM_NOTIFY_URL: ctx.notify.url, CUBEFARM_OPENCODE_SESSION_ID:ctx.resumeId??'' } };
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
export function interruptions(screen: string,cli?:AgentCli): number {
  if(cli==='gemini')return screen.split('\n').filter(line=>/^\s*(?:ℹ\s*)?(?:User cancelled the request|Request cancelled)\.\s*$/.test(line)).length;
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
    process.stdout.write('Agent Swarm');
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
    body: JSON.stringify({ hook_event_name: 'TurnComplete', session_id: event['thread-id'] ?? null, turn_id:event['turn-id']??null, last_assistant_message: event['last-assistant-message'] ?? '', input }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
`;

/** Trusted pre-tool hooks relay the office decision. Transport failures deny
 * pre-tool execution, while observational hooks remain nonblocking. */
export const CODEX_HOOK_SOURCE = String.raw`// cubefarm: relays governance decisions for trusted pre-tool hooks.
const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.CUBEFARM_HOOK_URL;
const eventIndex=process.argv.indexOf('--event');
const expectedEvent=eventIndex>=0?process.argv[eventIndex+1]:undefined;
const hashIndex=process.argv.indexOf('--bridge-sha256');
const expectedHash=hashIndex>=0?process.argv[hashIndex+1]:undefined;
const chunks = [];let inputBytes=0;
process.stdin.on('data', (c) => {inputBytes+=c.length;if(inputBytes<=1024*1024)chunks.push(c);});
process.stdin.on('end', async () => {
  let body = {};
  let stage = 'input';
  try {
    if(inputBytes>1024*1024)throw new Error('Hook input exceeds its bound');
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    stage = 'identity';
    const actualHash=require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(__filename)).digest('hex');
    if(expectedEvent&&body.hook_event_name!==expectedEvent)throw new Error('Hook event identity changed');
    if(expectedHash&&expectedHash!==actualHash)throw new Error('Hook source identity changed');
    body.bridgeSha256=actualHash;
    stage = 'endpoint';
    if (!url) throw new Error('Office hook URL unavailable');
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error('Office hook must use loopback');
    // Persisted governance decisions can outlast five seconds under native
    // startup/disk load. Stay bounded within the configured 60-second native hook budget.
    stage = 'transport';
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    stage = 'response';
    if (!response.ok) throw new Error('Office hook unavailable');
    const answer = await response.json();
    stage = 'decision';
    if (body.hook_event_name === 'PreToolUse' && !['allow', 'deny'].includes(answer?.hookSpecificOutput?.permissionDecision)) throw new Error('No verified pre-tool decision');
    // Codex retains its native permission rules. Claude's existing unattended
    // mode explicitly opts into approval after the office safeguard succeeds.
    const preservePermissions = !process.argv.includes('--approve-governed');
    process.stdout.write(JSON.stringify(preservePermissions && body.hook_event_name === 'PreToolUse' && answer?.hookSpecificOutput?.permissionDecision === 'allow' ? {} : answer));
  } catch (error) {
    if ((expectedEvent??body.hook_event_name) === 'PreToolUse') {
      const reason = 'Office governance unavailable at ' + stage + (error?.name === 'TimeoutError' ? ' (timeout)' : '') + '; execution denied';
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
      process.stderr.write(reason + '.');
      // Native Codex reliably honors a successful structured denial; an error exit can be treated as a failed hook.
      process.exitCode = 0;
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
  let root = process.env.CUBEFARM_OPENCODE_SESSION_ID || undefined;
  let announcement;
  let failure;
  let userMessage;
  let turnEpoch=0;
  const nativeFailure = (error) => ({error:String(error?.data?.message??error?.message??error?.name??'Provider failure').slice(0,1000),native_error:{name:error?.name,data:{statusCode:error?.data?.statusCode,isRetryable:error?.data?.isRetryable}}});
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
  const lastReply = async (id,currentUser) => {
    let timer;
    try {
      if(!currentUser)throw new Error('Current prompt identity is unverified');
      const controller=new AbortController();
      const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Message observation expired'));},3000);});
      const res = await Promise.race([client.session.messages({ path: { id },signal:controller.signal }),expired]);
      const messages=res?.data;
      if(!Array.isArray(messages)||!messages.length||messages.length>128)throw new Error();
      const ids=new Set();let created=-1;
      for(const message of messages){const info=message?.info;if(!info||!['user','assistant'].includes(info.role)||info.sessionID!==id||typeof info.id!=='string'||!info.id||ids.has(info.id)||!Number.isFinite(info.time?.created)||info.time.created<created)throw new Error();ids.add(info.id);created=info.time.created;}
      const user=messages.filter(m=>m?.info?.role==='user').pop();
      const reply=messages.filter(m=>m?.info?.role==='assistant').pop();
      if(!user||!reply||user.info.sessionID!==id||reply.info.sessionID!==id||typeof user.info.id!=='string'||!user.info.id||typeof reply.info.id!=='string'||!reply.info.id||reply.info.id===user.info.id||currentUser&&currentUser!==user.info.id||reply.info.parentID!==user.info.id)throw new Error();
      if(!Number.isFinite(user.info.time?.created)||user.info.time.created<0||!Number.isFinite(reply.info.time?.created)||!Number.isFinite(reply.info.time?.completed)||reply.info.time.created<user.info.time.created||reply.info.time.completed<reply.info.time.created)throw new Error();
      // OpenCode AssistantMessage native per-message work counters; unknown shapes stay unknown.
      const usage=(()=>{try{
        const current=messages.slice(messages.indexOf(user)+1);if(!current.length||current.some(m=>m.info.role!=='assistant'||m.info.parentID!==user.info.id||!Number.isFinite(m.info.time?.completed)||m.info.time.completed<m.info.time.created))return undefined;
        const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
        let inputTokens=0,outputTokens=0,costUsd=0,costKnown=true;
        for(const m of current){const t=m.info.tokens;if(!t||![t.input,t.output,t.reasoning,t.cache?.read,t.cache?.write].every(count))return undefined;inputTokens+=t.input+t.cache.read+t.cache.write;outputTokens+=t.output+t.reasoning;if(typeof m.info.cost==='number'&&Number.isFinite(m.info.cost)&&m.info.cost>=0)costUsd+=m.info.cost;else costKnown=false;}
        if(!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||!Number.isFinite(costUsd))return undefined;
        return {schemaVersion:1,source:'opencode-message-v1',sampleId:user.info.id,inputTokens,outputTokens,costUsd:costKnown?costUsd:null};
      }catch{return undefined;}})();
      if(Object.prototype.hasOwnProperty.call(reply.info,'error'))return {failed:true,...nativeFailure(reply.info.error),...(usage?{usage}:{})};
      if(!Array.isArray(reply.parts)||reply.parts.length>200||reply.parts.some(p=>p?.sessionID!==id||p?.messageID!==reply.info.id))throw new Error();
      const textParts=reply.parts.filter(p=>p?.type==='text');
      if(textParts.some(p=>typeof p.text!=='string'))throw new Error();
      const text=textParts.map(p=>p.text).join('\n').trim();
      if(!text||Buffer.byteLength(text)>256*1024)throw new Error();
      return {failed:false,last_assistant_message:text,...(usage?{usage}:{})};
    } catch {
      return {failed:true,error:'Current OpenCode message completion could not be verified'};
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    'tool.execute.before': authorize,
    'tool.execute.after': async (input,output) => {
      const {name}=normalize(input.tool,input.args??{});
      const text=typeof output.output==='string'?output.output:JSON.stringify(output.output??'');
      const body={hook_event_name:'PostToolUse',tool_name:name,tool_use_id:input.callID,session_id:input.sessionID,tool_response:{content:[{type:'text',text}]}};
      const complete=Buffer.byteLength(text,'utf8')<=768*1024&&Buffer.byteLength(JSON.stringify(body),'utf8')<=900*1024;
      await post(complete?body:{hook_event_name:'PostToolUseFailure',tool_name:name,tool_use_id:input.callID,session_id:input.sessionID,tool_response:{isError:true,error:'Tool evidence exceeds the complete-output bound'}});
    },
    event: async ({ event }) => {
      const props = event?.properties ?? {};
      if (event?.type === 'session.created' && !props.info?.parentID && !root && typeof props.info?.id==='string') root = props.info.id;
      const sessionID = props.sessionID ?? (event?.type==='message.updated'?props.info?.sessionID:props.info?.id);
      if(!root||sessionID!==root)return;
      if(event?.type==='message.updated'&&props.info?.role==='user'&&typeof props.info.id==='string'&&props.info.id&&props.info.id!==userMessage){userMessage=props.info.id;failure=undefined;turnEpoch++;}
      if(event?.type==='session.error')failure=nativeFailure(props.error);
      const epoch=turnEpoch;
      await (announcement ??= post({hook_event_name:'OpenCodeSessionStart',session_id:root}));
      if (event?.type === 'session.idle') {
        const outcome=await lastReply(root,userMessage);
        if(epoch!==turnEpoch)return;
        await post({ hook_event_name: 'TurnComplete', session_id: root, ...(failure?{failed:true,...failure,...(outcome.usage?{usage:outcome.usage}:{})}:outcome) });
      }
      if (event?.type === 'session.error'&&epoch===turnEpoch) await post({ hook_event_name: 'TurnError', session_id: root, ...failure });
    },
  };
}
`;
