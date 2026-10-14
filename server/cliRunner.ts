import {prepareCodexHooks} from './codexHookTrust.ts';
import {CodexModelNotAdvertisedError} from './codexModelMetadata.ts';
import {geminiSettings,GEMINI_HOOK_SOURCE,verifyGeminiProfile} from './geminiBridge.ts';
import {runtimeModelError} from '../shared/runtimePolicy.ts';
import { playwrightMcp } from './browserTools.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HOME_DIR } from './config.ts';
import { CODEX_HOOK_EVENTS,codexHookInvocation,codexHookCommand,cliLabel, CODEX_HOOK_SOURCE, codexThread, commandFor, hookReviewKey, interruptions, isCli, launchArgs, NOTIFY_SOURCE, OPENCODE_PLUGIN_SOURCE, STATUSLINE_SOURCE, trustKey } from './clis.ts';
import { adoptPty, discardPty, hooksReady, keeperHookUrl, keeperPid,keeperInstance, leaveKeeper, spawnPty, startKeeper, terminalsAvailable, type Pty } from './ptyClient.ts';
import {RuntimeCleanupStore} from './runtimeCleanup.ts';
import {terminalCallback} from './terminalCallbacks.ts';
import {
  clip,
  describeTool,
  newScreenshots,
  resultText,
  screenshotFile,
  readScreenshot,
  summariseResult,
  tidyPaths,
  todoLines,
  type LogEntry,
  type SessionCallbacks,
  type SessionHandle,
  type SessionOptions,
  type SessionResult,
} from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import type { AgentTerminal } from './terminal.ts';
import type { AgentCli } from '../shared/types.ts';
import { governSessionTool, sessionAuthority,hookDecision, hookFailure } from './toolGovernance.ts';
import {copilotUnavailableModel,openCodeRateLimited} from './runtimeFailure.ts';

// One agent session as the real CLI in a pseudo-terminal: the same contract as the Agent SDK runner (log lines, the
// current tool, the final text, finished), so the rest of the office doesn't care which runtime an agent uses.
//
// Claude Code reports through hooks passed with --settings: pre-tool requests receive a persisted safeguard decision,
// finished turns report Stop, failures report StopFailure, and its
// status line, cost and usage limits. Codex says when a turn ends (notify) and, once the manager trusts the office's
// hooks in its /hooks, reports its steps through them too. OpenCode's plugin only says when a turn ends. GitHub
// Copilot CLI runs one-shot (-p): its terminal output is the result, and the process exiting ends the session.
//
// The CLIs run in the office's terminal keeper (ptyClient.ts) and call their hooks there, so an office restart doesn't
// stop them: the office picks them up again when it's back (reconnectClis).

export { terminalsAvailable };

const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
const BIN_DIR = path.join(HOME_DIR, 'bin');
/** After a turn ends the CLI may still pick up a queued message: only an idle prompt this long means it's done. */
const FINISH_GRACE_MS = 3000;
/** Starting up: how long before the office says the CLI seems to be waiting on something. */
const BOOT_MS = 60_000;
/** Claude's usage warning, the way the SDK's allowed_warning is used: pace new work from here. */
const USAGE_WARN_PCT = 90;
/** Prompts longer than this go in a file: Windows caps a command line at 32K characters. */
const INLINE_PROMPT_MAX = 8000;
const COPILOT_OUTPUT_LIMIT = 1_000_000;
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

/** Plain text returned by `copilot --prompt`, without terminal styling. */
export function copilotResponse(output: string): string {
  return output.replace(ANSI, '').replace(/\r/g, '').trim();
}

// ---------- routing the CLIs' calls back to their sessions ----------

let officeUrl = '';

/** The office's own address, for the hook and MCP endpoints the CLIs call back on. Set once the server listens. */
export function setOfficeUrl(url: string) {
  officeUrl = url;
}

interface Route {
  hook(body: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>;
  office?: OfficeTools;
}
const routes = new Map<string, Route>();

/** A hook, status line or notify call from a CLI (POST /api/hooks/:token). The answer is the hook's output. */
export async function handleHook(token: string, body: unknown): Promise<Record<string, unknown>> {
  const route = routes.get(token);
  if (!route || !body || typeof body !== 'object' || Array.isArray(body)) return hookFailure(body);
  try {
    return await route.hook(body as Record<string, unknown>);
  } catch (err) {
    console.warn('hook failed', err);
    return hookFailure(body);
  }
}

/** The CEO's office tools over MCP (Streamable HTTP, stateless: a fresh server per request). */
export async function handleMcp(token: string, req: Request, res: Response) {
  const office = routes.get(token)?.office;
  if (!office) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This session has ended.' }, id: null });
    return;
  }
  const server = office.serve();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// ---------- helper scripts ----------

let helpersWritten = false;

/** The status line, notify and plugin scripts the CLIs run. Rewritten once per office start, so updates reach them. */
function writeHelpers() {
  if (helpersWritten) return;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(BIN_DIR, 'statusline.cjs'), STATUSLINE_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'notify.cjs'), NOTIFY_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'codex-hook.cjs'), CODEX_HOOK_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'opencode-plugin.mjs'), OPENCODE_PLUGIN_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR,'gemini-hook.cjs'),GEMINI_HOOK_SOURCE);
  helpersWritten = true;
}

/** A command line for Claude Code's shell (Git Bash on Windows): forward slashes, quoted. */
const shellArg = (p: string) => `"${p.replaceAll('\\', '/')}"`;

// ---------- plumbing ----------

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification'];

/** The browser for a session. Its snapshots and unnamed screenshots go to the session's folder, not the worktree. */
const playwrightServer = playwrightMcp;

/** What a tool call returned, as text, and any images in it (Playwright screenshots). */
function toolOutput(response: unknown): { text: string; images: { data: string; mime: string }[] } {
  const images: { data: string; mime: string }[] = [];
  const blocks = Array.isArray(response) ? response : Array.isArray((response as { content?: unknown })?.content) ? (response as { content: unknown[] }).content : null;
  if (blocks) {
    for (const b of blocks as Record<string, unknown>[]) {
      const source = b?.source as { type?: string; data?: string; media_type?: string } | undefined;
      if (b?.type === 'image' && source?.type === 'base64' && source.data) images.push({ data: source.data, mime: source.media_type ?? 'image/png' });
      else if (b?.type === 'image' && typeof b.data === 'string') images.push({ data: b.data, mime: String(b.mimeType ?? 'image/png') });
    }
    return { text: resultText(blocks), images };
  }
  if (typeof response === 'string') return { text: response, images };
  const r = response as { stdout?: unknown; stderr?: unknown; file?: { content?: unknown }; filenames?: unknown } | null;
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') return { text: [r.stdout, r.stderr].filter((s) => typeof s === 'string' && s).join('\n'), images };
    if (typeof r.file?.content === 'string') return { text: r.file.content, images };
    if (Array.isArray(r.filenames)) return { text: r.filenames.join('\n'), images };
  }
  return { text: '', images };
}

/** A pseudo-terminal whose CLI just died throws on writes and resizes before it reports the exit: ignore that. */
function quietly(fn: () => void) {
  try {
    fn();
  } catch {
    // the CLI is gone; its exit is on the way
  }
}

// ---------- CLIs that outlive their session ----------

/**
 * A CLI running in an agent's terminal. It can outlive the office session that started it: when a developer's task
 * is done their CLI waits at its prompt, so the manager can keep using it, and a follow-up picks it up again. It also
 * outlives an office restart, held by the terminal keeper.
 */
interface LiveCli {
  governanceReady?:boolean;
  agentId: string;
  cli: AgentCli;
  term: AgentTerminal;
  proc: Pty | null;
  token: string;
  dir: string;
  resumeId: string | null; // the session a follow-up resumes
  statusLine: string;
  output: string;
  /** Browser screenshots already passed on (Codex and OpenCode: collected from the browser's output folder). */
  shots: Set<string>;
  /** The office session driving it; null while it waits at its prompt. */
  session: { hook(b: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>>; exited(code: number): void } | null;
  idleTimer?: NodeJS.Timeout;
}
const lives = new Map<AgentTerminal, LiveCli>();
const preparing=new Map<AgentTerminal,symbol>();
let cleanupChanged=()=>{};
const cleanup=new RuntimeCleanupStore(path.join(HOME_DIR,'runtime-cleanup.json'),()=>cleanupChanged());
const closing=new Map<string,Pty>();
const closeWaiters=new Map<string,{promise:Promise<void>;resolve:()=>void}>();
export const runtimeCleanupView=()=>{const view=cleanup.view();return {...view,records:view.records.map(record=>({...record,id:crypto.createHash('sha256').update(record.id).digest('hex')}))};};
export const onRuntimeCleanupChanged=(callback:()=>void)=>{cleanupChanged=callback;};
const cleanupBlocker=()=>{const view=cleanup.view();return view.unavailableReason??(view.records.length?'Native runtime cleanup is pending or unverified; new work is quarantined':null);};
function observeCleanup(id:string,p:Pty){
  closing.set(id,p);
  if(!closeWaiters.has(id)){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});closeWaiters.set(id,{promise,resolve});}
  const waiter=closeWaiters.get(id)!;
  p.onExit(()=>{
    if(p.verifiedExit!==true){cleanup.unverified(id);return;}
    cleanup.confirmed(id);closing.delete(id);closeWaiters.get(id)?.resolve();closeWaiters.delete(id);
  });
  return waiter.promise;
}
function registerCleanup(l:LiveCli,p:Pty){
  cleanup.begin({id:l.token,agentId:l.agentId,cli:l.cli,pid:p.pid,keeperInstance:keeperInstance(),requestedAt:Date.now(),state:'stopping'});
  return observeCleanup(l.token,p);
}
/** How to trust Codex's hooks was said once this run (Codex asks at the start of every session until they are). */
let hooksHinted = false;
/** A CLI left at its prompt this long is closed; its session can still be resumed. */
const IDLE_MS = 30 * 60_000;

const toolInput = (b: Record<string, unknown>) => (b.tool_input && typeof b.tool_input === 'object' ? b.tool_input : {}) as Record<string, unknown>;

/** Close a CLI for good. A Codex thread is archived once its CLI is gone (see codexThread). */
function endLive(live: LiveCli): Promise<void> {
  if (lives.get(live.term) !== live) return Promise.resolve();
  lives.delete(live.term);
  clearTimeout(live.idleTimer);
  routes.delete(live.token);
  live.term.releaseIdle = null;
  live.term.bind(null);
  const gone = live.proc ? registerCleanup(live,live.proc) : Promise.resolve();
  live.proc?.setMeta({...metaOf(live),busy:false,stopping:true});
  try{live.proc?.kill();}catch{cleanup.unverified(live.token);}
  live.proc = null;
  live.term.note(`── ${cliLabel(live.cli)} session ended ──`);
  return gone.then(async()=>{fs.rm(live.dir,{recursive:true,force:true,maxRetries:5},()=>undefined);if(live.cli==='codex'&&live.resumeId)await codexThread('archive',live.resumeId);});
}

/** What the keeper holds with a CLI's terminal, so the office can pick it up again after a restart. */
interface CliMeta {
  stopping?:boolean;
  governanceSha256?:string;
  governanceReady?:boolean;
  agentId: string;
  cli: AgentCli;
  token: string;
  dir: string;
  resumeId: string | null;
  /** An office session was driving it (not waiting at its prompt). */
  busy: boolean;
}

const codexGovernanceSha=crypto.createHash('sha256').update(CODEX_HOOK_SOURCE).digest('hex');
const openCodeGovernanceSha=crypto.createHash('sha256').update(OPENCODE_PLUGIN_SOURCE).digest('hex');
const geminiGovernanceSha=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
const metaOf = (l: LiveCli): CliMeta => ({ agentId: l.agentId, cli: l.cli, token: l.token, dir: l.dir, resumeId: l.resumeId, busy: !!l.session,...(l.cli==='opencode'?{governanceSha256:openCodeGovernanceSha}:l.cli==='gemini'?{governanceSha256:geminiGovernanceSha,governanceReady:l.governanceReady===true}:l.cli==='codex'?{governanceSha256:codexGovernanceSha,governanceReady:l.governanceReady===true}:{}) });
const remember = (l: LiveCli) => l.proc?.setMeta(metaOf(l));

/** A CLI is running in its terminal: its output, its keys and its hooks are connected. */
function wire(l: LiveCli, office?: OfficeTools) {
  const p = l.proc!;
  lives.set(l.term, l);
  routes.set(l.token, { hook: (b) => (l.session ? l.session.hook(b) : idleHook(l, b)), office });
  l.term.bind({ write: (d) => {if(!['gemini','codex'].includes(l.cli)||l.governanceReady)quietly(() => p.write(d));}, resize: (c, r) => quietly(() => p.resize(c, r)) });
  p.onData((data) => {
    if (lives.get(l.term) === l) {
      l.term.write(data);
      if (l.cli === 'copilot') {
        l.output += data;
        if (l.output.length > COPILOT_OUTPUT_LIMIT) l.output = l.output.slice(-COPILOT_OUTPUT_LIMIT);
      }
    }
  });
  p.onExit((code) => {
    if(p.verifiedExit!==true&&!closing.has(l.token))registerCleanup(l,p);
    l.proc = null;
    if (lives.get(l.term) !== l) return; // already replaced or closed
    if (l.session) l.session.exited(code);
    else endLive(l); // quit while waiting at its prompt
  });
}

/** The task is done but the CLI stays at its prompt for the manager (or a follow-up), for a while. */
function waitAtPrompt(l: LiveCli) {
  clearTimeout(l.idleTimer);
  l.idleTimer = setTimeout(() => endLive(l), IDLE_MS);
  l.term.releaseIdle = () => endLive(l);
  remember(l);
}

export interface ReconnectedCli {
  agentId: string;
  cli: AgentCli;
  resumeId: string | null;
  /** It was working on a task: the office should follow its session again. */
  busy: boolean;
}

/**
 * The office started: connect to the terminal keeper and take back the CLIs it kept running through the restart, each
 * into its agent's terminal. They wait at their prompt until the office follows their session again (busy ones) or
 * the manager uses them. Ones whose agent is gone, or that exited while the office was away, are stopped: the office
 * resumes those sessions itself. Call hooksReady() once the busy ones are followed again.
 */
export async function reconnectClis(terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]> {
  // Retained terminals invoke the shared helper path too; upgrade it before
  // reopening hooks so a surviving Codex process cannot discard denials.
  writeHelpers();
  const held = await startKeeper(HOME_DIR, handleHook);
  const quarantined=new Set<string>();
  for(const record of cleanup.view().records){
    if(!record.keeperInstance||record.keeperInstance!==keeperInstance()){cleanup.unverified(record.id);continue;}
    const matches=held.filter(item=>((item.meta as Partial<CliMeta>|null)?.token??item.id)===record.id);
    if(!matches.length){cleanup.confirmed(record.id);continue;}
    if(matches.length!==1){cleanup.unverified(record.id);continue;}
    const match=matches[0];quarantined.add(match.id);
    if(match.exit!==null){cleanup.confirmed(record.id);discardPty(match);continue;}
    const proc=adoptPty(match);observeCleanup(record.id,proc);proc.kill();
  }
  const back: ReconnectedCli[] = [];
  for (const h of held) {
    if(quarantined.has(h.id))continue;
    const meta = (h.meta ?? {}) as Partial<CliMeta>;
    const term = meta.agentId ? terminalFor(meta.agentId) : null;
    // Copilot runs one-shot with its result in the terminal output, which a restart loses: resume its session instead.
    if (h.exit !== null || meta.stopping===true || !term || lives.has(term) || !isCli(meta.cli) || meta.cli === 'copilot' || meta.cli==='codex'&&(meta.governanceSha256!==codexGovernanceSha||meta.governanceReady!==true) || meta.cli==='opencode'&&meta.governanceSha256!==openCodeGovernanceSha || meta.cli==='gemini'&&(meta.governanceSha256!==geminiGovernanceSha||meta.governanceReady!==true) || !meta.token || !meta.dir || !meta.agentId) {
      if(h.exit===null){
        const id=typeof meta.token==='string'&&meta.token?meta.token:h.id,proc=adoptPty(h);
        cleanup.begin({id,agentId:typeof meta.agentId==='string'?meta.agentId:'',cli:typeof meta.cli==='string'?meta.cli:'unknown',pid:h.pid,keeperInstance:keeperInstance(),requestedAt:Date.now(),state:'stopping'});
        const gone=observeCleanup(id,proc);proc.kill();
        if(meta.cli==='codex'&&meta.resumeId)void gone.then(()=>codexThread('archive',meta.resumeId!));
      }else{discardPty(h);if(meta.cli==='codex'&&meta.resumeId)void codexThread('archive',meta.resumeId);}
      continue;
    }
    const l: LiveCli = { governanceReady:meta.governanceReady,agentId: meta.agentId, cli: meta.cli, term, proc: adoptPty(h), token: meta.token, dir: meta.dir, resumeId: meta.resumeId ?? null, statusLine: '🏢 cubefarm', output: '', shots: new Set(), session: null };
    wire(l);
    waitAtPrompt(l);
    // Resizing makes the CLI draw its whole screen again, over whatever the saved copy of the terminal missed.
    setTimeout(() => quietly(() => (l.proc?.resize(term.cols - 1, term.rows), l.proc?.resize(term.cols, term.rows))), 500);
    back.push({ agentId: l.agentId, cli: l.cli, resumeId: l.resumeId, busy: !!meta.busy });
  }
  return back;
}

export { hooksReady };

/**
 * What a desk clean-up (releaseDesk) must leave alone: the keeper, every CLI in a terminal, and the office's session
 * files, which only the CLIs' own command lines carry (Codex's instructions name the worktree, for one).
 */
export function officeProcesses(): { pids: number[]; markers: string[] } {
  const pids = [keeperPid(), ...[...lives.values()].map((l) => l.proc?.pid ?? 0),...[...closing.values()].map(proc=>proc.pid)].filter((p) => p > 0);
  return { pids, markers: [SESSIONS_DIR, BIN_DIR] };
}

/**
 * The office is stopping. On a restart its CLIs carry on in the terminal keeper, which holds their output and hooks
 * until it's back; when it quits for good they stop with it (once they're gone, their Codex threads are archived).
 */
export async function releaseClis(restart: boolean): Promise<void> {
  if(!restart){
    const stops=[...lives.values()].map(endLive);
    const stopped=Promise.all([...stops,...[...closeWaiters.values()].map(waiter=>waiter.promise)]).then(()=>{const blocker=cleanupBlocker();if(blocker)throw new Error(blocker);});
    let timer:NodeJS.Timeout|undefined;
    try{await Promise.race([stopped,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native runtime exit remains unverified; cleanup quarantine is retained')),5000);})]);}
    finally{clearTimeout(timer);}
  }
  leaveKeeper();
}

/** A CLI waiting at its prompt: what the manager types there becomes a follow-up. */
async function idleHook(live: LiveCli, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (String(b.hook_event_name ?? '')) {
    case 'PreToolUse':
      return hookDecision({status: 'blocked', reason: 'No active admitted task owns this CLI; submit a checked follow-up first'});
    case 'UserPromptSubmit': {
      const text = String(b.prompt ?? '').trim();
      if (!text || live.term.onIdlePrompt?.(text)) return {};
      return { decision: 'block', reason: "The office couldn't take that on as a follow-up right now (see the agent's panel). Nothing was sent." };
    }
    case 'StatusLine':
      return { statusLine: live.statusLine };
  }
  return {};
}

// ---------- the session ----------

/**
 * The Claude Code session a hook reports, once its conversation is on disk: only then can --resume pick it up. Claude
 * writes the file during the first turn, after SessionStart and UserPromptSubmit, so a session the office keeps any
 * earlier could be one that never existed.
 */
export function resumableSession(b: Record<string, unknown>, exists: (file: string) => boolean): string | null {
  const id = typeof b.session_id === 'string' ? b.session_id : '';
  const file = typeof b.transcript_path === 'string' ? b.transcript_path : '';
  return id && file && exists(file) ? id : null;
}

/** Claude Code was told to resume a conversation that isn't on disk (it says so and exits 1). */
export const lostConversation = (screen: string) => /No conversation found with session ID/i.test(screen);

/** Native Codex failure plus its idle prompt, not a capacity phrase in task text.
 * Visible active-turn indicators veto classification of an old failure. */
export function codexCapacityIdle(screen:string):boolean {
  const plain=screen.replace(ANSI,'').replace(/\r/g,'');
  return /^\s*■\s*Selected model is at capacity\./im.test(plain)
    && /^\s*›\s*Ask Codex to do anything\s*$/m.test(plain)
    && !/esc to interrupt|\bWorking\s*\(|\bThinking\s*\(/i.test(plain);
}

/** Recovery observation only: an idle retained CLI does not prove task success. */
export function codexRecoveredIdle(screen:string):boolean {
  const plain=screen.replace(ANSI,'').replace(/\r/g,'');
  return /^\s*Worked for \d[^\n]*$/m.test(plain)
    && /^\s*›\s*Ask Codex to do anything\s*$/m.test(plain)
    && !/esc to interrupt|\bWorking\s*\(|\bThinking\s*\(/i.test(plain);
}

export function startCliSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  const pendingCleanup=cleanupBlocker();if(pendingCleanup)throw new Error(pendingCleanup);
  const requestedCli=opts.cli??'codex';
  const requestedPolicyError=runtimeModelError(requestedCli,opts.model);if(requestedPolicyError)throw new Error(requestedPolicyError);
  const term = opts.terminal!;
  if(preparing.has(term))throw new Error('Terminal runtime admission is already being checked; current work was preserved');
  // A follow-up to the session a CLI is still waiting in picks that CLI up again, and so does an office that restarted
  // while it worked (reattach); anything else replaces it.
  const prev = lives.get(term);
  if(opts.reattach&&prev&&prev.cli!==requestedCli)throw new Error('Retained terminal provider differs from the requested runtime; current work was preserved');
  const waiting = !!prev?.proc && !prev.session;
  if(opts.reattach&&prev&&!waiting)throw new Error('Retained terminal already has an active task owner; current work was preserved');
  const adopt = waiting && (!!opts.reattach || (prev!.cli === (opts.cli ?? 'codex') && !!opts.resumeSessionId && prev!.resumeId === opts.resumeSessionId));
  let live: LiveCli | null = null;
  const cli = adopt?prev!.cli:requestedCli;
  const policyError=runtimeModelError(cli,opts.model);if(policyError)throw new Error(policyError);
  const admission=Symbol('terminal-admission');
  const releaseAdmission=()=>{if(preparing.get(term)===admission)preparing.delete(term);};
  const validateAdmission=async()=>{
    const denied=await sessionAuthority(opts.authorizeTool);
    if(denied)throw new Error(denied.reason);
    if(done||preparing.get(term)!==admission||lives.get(term)!==prev||(adopt&&prev?.session))throw new Error('Terminal ownership changed during runtime admission; replacement denied');
  };
  const label = cliLabel(cli);

  const token = crypto.randomUUID();
  const sessionId = opts.resumeSessionId ?? crypto.randomUUID();
  const dir = path.join(SESSIONS_DIR, token);
  const started = Date.now();
  const statusLine = `🏢 cubefarm${opts.label ? ` · ${opts.label}` : ''}`;
  const toolNames = new Map<string, string>();
  const officePrompts: string[] = []; // prompts the office typed, so the ones the manager typed are told apart
  const launched: string[] = []; // every prompt the CLI was given, as given (Codex: finds its main thread)
  let mainThread: string | null = opts.resumeSessionId ?? null;
  let kept: string | null = opts.resumeSessionId ?? null; // the Claude session the agent has saved to resume
  const usageResets = new Map<string, number | null>();
  const warned = new Set<string>();
  let done = false;
  let costUsd = 0;
  let turns = 0;
  let lastText = '';
  let turnError: string | null = null; // the turn failed (OpenCode reports errors separately from going idle)
  let begun = false; // the CLI took its first prompt
  let recoveryPending = false;
  let finishTimer: NodeJS.Timeout | undefined;
  let bootTimer: NodeJS.Timeout | undefined;
  let screenTimer: NodeJS.Timeout | undefined;
  let shotTimer: NodeJS.Timeout | undefined;
  let capacityTimer: NodeJS.Timeout | undefined;
  let geminiStartupTimer:NodeJS.Timeout|undefined;
  let geminiPromptSent=false;
  let codexTrustReady=false;
  const nudged = new Set<string>();
  let trustKeys = 0; // keys pressed on a folder-trust question (a few at most)
  let trustedAt = 0;

  const cb: SessionCallbacks = { ...callbacks };
  const log = (entries: LogEntry[]) => entries.length && cb.log(entries);

  /** Codex and OpenCode don't report tool results: pass on the screenshots their browser saved instead. all: the last look. */
  const collectShots = (all = false) => {
    const l = live;
    if (!l || cli === 'claude' || !opts.browserTesting) return;
    for (const shot of newScreenshots(path.join(l.dir, 'browser'), l.shots, all ? Infinity : Date.now())) {
      l.shots.add(shot.name);
      try {
        const captured=readScreenshot(path.join(l.dir,'browser'),shot.file);
        if(captured)cb.screenshot(captured.data,captured.mime);
      } catch {
        // removed before we got to it
      }
    }
  };

  /** The session is over. A developer's CLI that ended its turn normally stays at its prompt (keep); others close. */
  const finish = (r: Omit<SessionResult, 'costUsd' | 'turns'>, keep = false, preserveRecovery = false) => {
    if (done) return;
    done = true;
    releaseAdmission();
    for (const t of [finishTimer, bootTimer,geminiStartupTimer]) clearTimeout(t);
    clearInterval(screenTimer);
    clearInterval(shotTimer);
    clearInterval(capacityTimer);
    collectShots(true);
    if (term.onInput === watchKeys) term.onInput = null;
    const l = live;
    if (l && lives.get(term) === l) {
      l.session = null;
      if (keep && (opts.keepAlive || preserveRecovery) && l.proc) waitAtPrompt(l);
      else endLive(l);
    }
    terminalCallback(cb.tool,null);
    terminalCallback(cb.finished,{ ...r, costUsd, turns });
  };

  /** A turn ended: finished, unless the CLI picks up another prompt within the grace period. */
  const turnEnded = (text: string) => {
    recoveryPending = false;
    lastText = text;
    cb.tool(null);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => finish({ ok: !turnError, text: lastText, errors: turnError ? [turnError] : [] }, true), FINISH_GRACE_MS);
  };
  const busy = () => {
    recoveryPending = false;
    begun = true;
    clearTimeout(finishTimer);
  };
  const monitorCapacity=()=>{
    if(cli!=='codex')return;
    let previous='';
    let idleSince=0;
    capacityTimer=setInterval(()=>{
      if(done){clearInterval(capacityTimer);return;}
      const screen=term.screen();
      if(!codexCapacityIdle(screen)){
        if(recoveryPending && codexRecoveredIdle(screen)){
          if(screen!==previous){previous=screen;idleSince=Date.now();return;}
          if(Date.now()-idleSince>=FINISH_GRACE_MS){
            const error='Retained Codex terminal is idle after restart without a completion signal. Task outcome is unverified; review its artifacts before retrying.';
            log([{kind:'error',text:error}]);
            finish({ok:false,text:'',errors:[error]},true,true);
          }
        }else{previous='';idleSince=0;}
        return;
      }
      if(screen!==previous){previous=screen;return;}
      const error='Codex selected model is at capacity; the task did not complete. Retry when capacity is available or choose a model in the agent settings.';
      log([{kind:'error',text:error}]);
      finish({ok:false,text:'',errors:[error]},true);
    },1000);
  };

  /** The turn was interrupted from the terminal: the office treats it like Stop, and the CLI waits for the manager. */
  const interrupted = () => finish({ ok: false, text: lastText, errors: ['Interrupted in the terminal'], interrupted: true }, true);

  /** Esc typed in the terminal while the agent works: if the CLI then says it interrupted the turn, it's over. */
  const watchKeys = (data: string) => {
    if (data !== '\x1b' || done || !begun) return;
    const before = interruptions(term.screen());
    let looks = 0;
    const look = () => {
      if (done) return;
      if (interruptions(term.screen()) > before) interrupted();
      else if (++looks < 4) setTimeout(look, 1000);
    };
    setTimeout(look, 800);
  };

  const assistantLines = (text: string): LogEntry[] => {
    const lines = text.split('\n');
    const out: LogEntry[] = lines.slice(0, 30).map((l, i) => ({ kind: 'text', text: `${i === 0 ? '● ' : '  '}${l}` }));
    if (lines.length > 30) out.push({ kind: 'text', text: `  … (${lines.length - 30} more lines)` });
    return out;
  };

  const onStatus = (b: Record<string, unknown>) => {
    const cost = Number((b.cost as { total_cost_usd?: unknown } | undefined)?.total_cost_usd);
    if (Number.isFinite(cost)) costUsd = cost;
    const limits = (b.rate_limits ?? {}) as Record<string, { used_percentage?: unknown; resets_at?: unknown } | null>;
    for (const [type, l] of Object.entries(limits)) {
      const used = Number(l?.used_percentage);
      if (!Number.isFinite(used)) continue;
      const resetsAt = Number(l?.resets_at) > 0 ? Number(l?.resets_at) * 1000 : null;
      usageResets.set(type, used >= 100 ? resetsAt : null);
      if (used >= USAGE_WARN_PCT && used < 100 && !warned.has(type)) {
        warned.add(type);
        cb.usageWarning?.({ resetsAt, rateLimitType: type, utilization: used / 100 });
      }
    }
    return { statusLine };
  };

  const hook = async (b: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const event = String(b.hook_event_name ?? '');
    const sub = typeof b.agent_id === 'string' && b.agent_id !== ''; // a subagent's call: kept off the log
    if(cli==='opencode'&&event==='OpenCodeSessionStart') {
      if(typeof b.session_id==='string'&&b.session_id.length>0&&b.session_id.length<=256&&(!mainThread||mainThread===b.session_id)) {
        mainThread=b.session_id;cb.sessionId(mainThread);
        if(live){live.resumeId=mainThread;remember(live);}
      }
      return {};
    }
    if(cli==='opencode'&&['TurnError','TurnComplete'].includes(event)&&(!mainThread||b.session_id!==mainThread))return {};
    if(cli==='gemini'&&b.bridgeSha256!==geminiGovernanceSha)return hookDecision({status:'unavailable',reason:'Gemini governance bridge is unverified'});
    if (cli==='gemini'&&!sub&&typeof b.session_id==='string'&&b.session_id!==kept){kept=b.session_id;cb.sessionId(kept);}
    if (cli === 'claude' && !sub && b.session_id !== kept) {
      const id = resumableSession(b, fs.existsSync);
      if (id) {
        kept = id;
        cb.sessionId(id);
      }
    }
    if(cli==='gemini'&&event==='SessionStart'){if(b.bridgeSha256!==geminiGovernanceSha)return hookDecision({status:'unavailable',reason:'Gemini bridge version is unverified'});if(live){live.governanceReady=true;remember(live);}return {};}
    if(['gemini','codex'].includes(cli)&&!live?.governanceReady&&event==='PreToolUse')return hookDecision({status:'unavailable',reason:'Coding runtime governance startup is unverified'});
    switch (event) {
      case 'PreToolUse': {
        const name = String(b.tool_name ?? '');
        const input = toolInput(b);
        if (!sub) {
          busy();
          turns += 1;
          toolNames.set(String(b.tool_use_id ?? ''), name);
          log([{ kind: 'tool', tool: name, text: `⏺ ${describeTool(opts.cwd, name, input)}` }, ...(name === 'TodoWrite' ? todoLines(input) : [])]);
          cb.tool(name);
          if (name === 'mcp__playwright__browser_navigate' && typeof input.url === 'string') cb.browserUrl(input.url);
        }
        const decision = await governSessionTool(name, input, { actor: opts.agentId ?? opts.role, runtime: cli, source: 'cli-hook' }, opts.authorizeTool);
        if (decision.status !== 'allowed') log([{ kind: 'error', text: decision.reason }]);
        return hookDecision(decision);
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (sub) return {};
        const name = toolNames.get(String(b.tool_use_id ?? '')) ?? String(b.tool_name ?? '');
        const out = toolOutput(b.tool_response);
        // Codex's unnamed screenshots are collected from the browser's folder (its hooks may not be trusted yet).
        if (cli === 'claude') for (const img of out.images) cb.screenshot(Buffer.from(img.data, 'base64'), img.mime);
        const saved = name === 'mcp__playwright__browser_take_screenshot' && !out.images.length ? screenshotFile(opts.cwd, out.text) : null;
        if (saved) cb.screenshot(saved.data, saved.mime);
        if (name.startsWith('mcp__playwright__')) {
          const url = out.text.match(/Page URL:\s*(\S+)/);
          if (url) cb.browserUrl(url[1]);
        }
        if (event === 'PostToolUseFailure') log([{ kind: 'error', text: `  ⎿ ${clip(tidyPaths(opts.cwd, String(b.error ?? out.text ?? 'Error')).split('\n')[0] || 'Error', 200)}` }]);
        else if (name !== 'TodoWrite') log(summariseResult(opts.cwd, name, out.text));
        cb.tool(null);
        return {};
      }
      case 'UserPromptSubmit': {
        if (sub) return {};
        busy();
        const prompt = String(b.prompt ?? '').trim();
        const i = officePrompts.findIndex((p) => p.slice(0, 60) === prompt.slice(0, 60));
        if (i >= 0) officePrompts.splice(i, 1);
        else if (prompt) log([{ kind: 'manager', text: `▶ Typed in the terminal: ${clip(prompt.split('\n')[0], 200)}` }]);
        return {};
      }
      case 'Stop': {
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'StopFailure': {
        const error = String(b.error ?? 'unknown');
        const details = String(b.error_details ?? '').trim();
        if (error === 'rate_limit') cb.limited?.([...usageResets.values()].find((t) => t !== null) ?? null);
        finish({ ok: false, text: lastText, errors: [`${label} stopped: ${error.replace(/_/g, ' ')}${details ? ` (${clip(details, 160)})` : ''}`] }, true);
        return {};
      }
      case 'Notification': {
        if (b.notification_type === 'permission_prompt') log([{ kind: 'error', text: `⚠ ${label} is waiting for a permission answer: open the terminal to answer it.` }]);
        return {};
      }
      case 'StatusLine':
        return onStatus(b);
      case 'Interrupt': // Codex: Esc in its terminal
        if (!sub) interrupted();
        return {};
      // Codex's notify program and the OpenCode plugin
      case 'TurnComplete': {
        if(cli==='opencode'&&(b.failed!==false||typeof b.last_assistant_message!=='string'||!b.last_assistant_message.trim()||Buffer.byteLength(b.last_assistant_message)>256*1024)){
          finish({ok:false,text:'',errors:[b.failed===true?`OpenCode: ${clip(String(b.error??'Provider failure'),200)}`:'OpenCode completion did not include a verified outcome'],...(b.failed===true&&openCodeRateLimited(b.native_error)?{opencodeLimit:true}:{})});
          return {};
        }
        const thread = typeof b.session_id === 'string' ? b.session_id : '';
        if (cli === 'codex' && thread !== mainThread) {
          // Codex also runs side threads (it titles each task in one): the main thread is the one given our prompt.
          const input = String(b.input ?? '').trim();
          if (mainThread || !launched.some((p) => input.startsWith(p.slice(0, 40)))) return {};
          mainThread = thread;
        }
        if (thread) {
          cb.sessionId(thread);
          if (live && live.resumeId !== thread) {
            live.resumeId = thread;
            remember(live);
          }
        }
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'TurnError': {
        const rawErr = String(b.error ?? 'error');
        turnError = `${label}: ${clip(rawErr, 200)}`;
        log([{ kind: 'error', text: `✗ ${turnError}` }]);
        if (cli === 'opencode' && openCodeRateLimited(b.native_error)) {
          finish({
            ok: false,
            text: '',
            errors: ['OpenCode provider returned HTTP 429 for the owning session; checking fallback readiness.'],
            opencodeLimit: true,
          });
        }
        return {};
      }
    }
    return {};
  };

  /** The CLI quit on its own: /exit typed in the terminal, a crash, or it couldn't start (not signed in, bad flag…). */
  const exited = (exitCode: number) => {
    if (cli === 'copilot') {
      const text = copilotResponse(live?.output ?? '');
      if (text) {
        lastText = text;
        if(exitCode===0){
          turns += 1;
          log(assistantLines(text));
          cb.turn?.(text);
        }else log([{kind:'error',text:clip(text,1000)}]);
      }
      finish({
        ok: exitCode === 0 && !!text,
        text,
        errors: exitCode === 0 && text ? [] : [`${label} ${exitCode ? `exited with code ${exitCode}` : 'finished without a response'}.${text ? ` ${clip(text, 240)}` : ''}`],
        ...(exitCode!==0&&copilotUnavailableModel(text,opts.model)?{configurationError:{kind:'unsupported-model' as const,cli:'copilot' as const,model:opts.model}}:{}),
      });
      return;
    }
    if (cli === 'claude' && opts.resumeSessionId && !begun && lostConversation(term.screen())) {
      cb.sessionId(null);
      finish({ ok: false, text: '', errors: [`${label} couldn't find the conversation it was resuming, so the next session starts a new one.`] });
      return;
    }
    const ok = exitCode === 0 && lastText !== '' && !turnError;
    finish({
      ok,
      text: lastText,
      errors: ok ? [] : [turnError ?? `${label} exited${exitCode ? ` with code ${exitCode}` : ''} before finishing.`],
    });
  };

  const handle: SessionHandle = {
    send(text) {
      const proc = live?.proc;
      if (done || !proc || ['gemini','codex'].includes(cli)&&!live?.governanceReady) return;
      busy();
      turnError = null;
      officePrompts.push(text.trim());
      // Pasted, so newlines stay in the message instead of sending it early; then Enter.
      const clean = text.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
      launched.push(clean.trim());
      quietly(() => proc.write(`\x1b[200~${clean}\x1b[201~`));
      setTimeout(() => quietly(() => live?.proc?.write('\r')), 150);
    },
    stop() {
      finish({ ok: false, text: '', errors: ['Stopped by manager'] });
    },
  };

  const verifyCodex = async()=>{
    const command=commandFor('codex');if(!command)throw new Error('Codex CLI is unavailable');
    writeHelpers();const hookPath=path.join(BIN_DIR,'codex-hook.cjs');
    return prepareCodexHooks(command,opts.cwd,hookPath,CODEX_HOOK_SOURCE,CODEX_HOOK_EVENTS.map(event=>({event,command:codexHookInvocation(hookPath,event),timeout:event==='Interrupt'?3:10})),opts.model);
  };
  if (adopt && prev) {
    preparing.set(term,admission);
    const commitAdoption=async()=>{
    await validateAdmission();if(done)return;
    live=prev;
    // Back in the CLI that was waiting at its prompt: same conversation, same terminal.
    clearTimeout(live.idleTimer);
    term.releaseIdle = null;
    live.session = { hook, exited };
    // Reattach session-scoped MCP handlers after a server restart, including release QA.
    wire(live, opts.office);
    Object.assign(live, { statusLine });
    remember(live);
    term.onInput=watchKeys;releaseAdmission();
    if (live.resumeId) cb.sessionId(live.resumeId);
    const resumeTurn=()=>{if(done)return;if(live){live.governanceReady=true;remember(live);}if(opts.typed||opts.reattach)busy();else handle.send(opts.prompt);recoveryPending=!!opts.reattach;};
    resumeTurn();
    recoveryPending = !!opts.reattach;
    shotTimer = setInterval(collectShots, 2000);
    monitorCapacity();
    };
    void (cli==='codex'?verifyCodex().then(()=>commitAdoption()):commitAdoption()).catch(error=>finish({ok:false,text:'',errors:[error instanceof CodexModelNotAdvertisedError?error.message:'Retained runtime readiness or ownership could not be verified; follow-up denied'],...(error instanceof CodexModelNotAdvertisedError?{configurationError:{kind:'unverified-model' as const,cli:'codex' as const,model:error.model}}:{})}));
    return handle;
  }
  if (opts.reattach) {
    // Its CLI didn't make it through the restart after all.
    setTimeout(() => finish({ ok: false, text: '', errors: [`${label} stopped while the office restarted.`] }), 0);
    return handle;
  }

  // ---------- a new CLI: files for this session, and the command line ----------

  const cmd = commandFor(cli);
  if (!terminalsAvailable || !cmd) {
    const why = !terminalsAvailable ? 'the terminal module could not be loaded on this machine' : `${label} isn't installed (no "${cli}" on PATH)`;
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${why}.`] }), 0);
    return handle;
  }

  // Through the keeper, a hook waits while the office restarts instead of failing: the CLIs allow it longer.
  const keeper = keeperHookUrl();
  const hookUrl = `${keeper ?? officeUrl}/api/hooks/${token}`;
  const browser = opts.browserTesting ? playwrightServer(path.join(dir, 'browser')) : null;
  let prompt = cli === 'copilot' ? `${opts.systemAppend}\n\n${opts.prompt}` : opts.prompt;
  if (opts.outputSchema) {
    prompt += `\n\nWhen you are done, end your final message with your report as one JSON object in a \`\`\`json block, matching this JSON schema:\n${JSON.stringify(opts.outputSchema)}`;
  }
  let files: { settings: string; mcp: string | null; system: string };
  try {
    writeHelpers();
    fs.mkdirSync(dir, { recursive: true });
    const settings = {
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [e === 'PreToolUse'
        ? { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'codex-hook.cjs'))} ${shellArg(hookUrl)} --approve-governed`, timeout: 10 }
        : { type: 'http', url: hookUrl, timeout: keeper ? 120 : 30 }] }]])),
      statusLine: { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'statusline.cjs'))} ${shellArg(hookUrl)}`, padding: 0 },
    };
    const servers: Record<string, unknown> = {};
    if (browser) servers.playwright = browser;
    if (opts.office) servers.office = { type: 'http', url: `${officeUrl}/api/mcp/${token}` };
    files = { settings: path.join(dir, 'settings.json'), mcp: Object.keys(servers).length ? path.join(dir, 'mcp.json') : null, system: path.join(dir, 'instructions.md') };
    const geminiServers:Record<string,unknown>={};
    if(browser)geminiServers.playwright={command:browser.command,args:browser.args};
    if(opts.office)geminiServers.office={httpUrl:`${officeUrl}/api/mcp/${token}`};
    fs.writeFileSync(files.settings, JSON.stringify(cli==='gemini'?geminiSettings(`${codexHookCommand(process.execPath,path.join(BIN_DIR,'gemini-hook.cjs'))}`,geminiServers):settings, null, 2));
    if (files.mcp) fs.writeFileSync(files.mcp, JSON.stringify({ mcpServers: servers }, null, 2));
    fs.writeFileSync(files.system, opts.systemAppend);
    if (prompt.length > INLINE_PROMPT_MAX) {
      const file = path.join(dir, 'task.md');
      fs.writeFileSync(file, prompt);
      prompt = `Your task is in ${file}. Read all of it first, then do what it says.`;
    }
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not prepare ${label}: ${(err as Error).message}`] }), 0);
    return handle;
  }
  officePrompts.push(prompt.trim()); // as given: a long one is a pointer to its file
  launched.push(prompt.trim());

  const launch = launchArgs(cli, {
    prompt,
    systemAppend: opts.systemAppend,
    model: opts.model,
    effort: opts.effort,
    resumeId: opts.resumeSessionId,
    sessionId,
    name: opts.label ?? 'cubefarm',
    role: opts.role,
    additionalDirectories: opts.additionalDirectories,
    files,
    notify: { script: path.join(BIN_DIR, 'notify.cjs'), url: hookUrl },
    codexHook: path.join(BIN_DIR, 'codex-hook.cjs'),
    plugin: pathToFileURL(path.join(BIN_DIR, 'opencode-plugin.mjs')).href,
    browser,
    officeUrl: opts.office ? `${officeUrl}/api/mcp/${token}` : undefined,
  });

  // Each agent must be a clean instance on the account its CLI is logged into: no API keys (they would switch Claude
  // Code's billing to the API) and nothing inherited from a Claude Code session the office itself was started from.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|CODEX_THREAD_ID|OPENCODE_CONFIG_CONTENT)$/i.test(k)) continue;
    env[k] = v;
  }
  // Optional office-local SDK for installed plugins that use file-based C# hooks.
  // Keep the machine's SDK and the manager's own shell environment unchanged.
  const dotnetDir = path.join(HOME_DIR, 'tools', 'dotnet');
  if (fs.existsSync(path.join(dotnetDir, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'))) {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${dotnetDir}${path.delimiter}${env[pathKey] ?? ''}`;
    env.DOTNET_ROOT = dotnetDir;
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, launch.env);

  if (cli === 'claude' || cli === 'copilot') cb.sessionId(sessionId);
  const resumeId = cli === 'claude' || cli === 'copilot' ? sessionId : (opts.resumeSessionId ?? null);
  const l: LiveCli = { governanceReady:cli==='codex'?codexTrustReady:undefined,agentId: opts.agentId ?? '', cli, term, proc: null, token, dir, resumeId, statusLine, output: '', shots: new Set(), session: { hook, exited } };
  const beginAfterCleanup = () => {
    if(cli==='codex')l.governanceReady=codexTrustReady;
    if (done) return; // stopped while its thread was being unarchived
    let p: Pty;
    try {
      p = spawnPty(cmd.file, [...cmd.args, ...launch.args], { cols: term.cols, rows: term.rows, cwd: opts.cwd, env }, metaOf(l));
    } catch (err) {
      setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${(err as Error).message}`] }), 0);
      return;
    }
    l.proc = p;
    live = l;
    wire(l, opts.office);
    term.onInput=watchKeys;releaseAdmission();
    term.note(`── ${label}${opts.label ? ` · ${opts.label}` : ''} ──`);
    shotTimer = setInterval(collectShots, 2000);
    monitorCapacity();
    if(cli==='gemini'){log([{kind:'system',text:'Gemini task withheld while verifying the governance bridge and terminal readiness.'}]);cb.tool('Runtime readiness');}
    if(cli==='gemini')geminiStartupTimer=setTimeout(()=>{if(!geminiPromptSent)finish({ok:false,text:'',errors:['Gemini governance startup was not verified; no task was sent. Provision trusted system hook settings and check CLI authentication.']});},90000);

    // Starting up: answer the folder-trust question for the office's own worktrees (the answer that trusts it), and
    // say so when a CLI is waiting on something only the manager can do (signing in),
    // and observe terminal readiness. Provider failures come from session-owned plugin events.
    screenTimer = setInterval(() => {
      if (done || (cli !== 'opencode' && cli !== 'gemini' && Date.now() - started > BOOT_MS * 2)) return clearInterval(screenTimer);
      const screen = term.screen();
      if(cli==='gemini'&&live?.governanceReady&&!geminiPromptSent&&/Type your message|Type a message|Send a message/i.test(screen)){geminiPromptSent=true;clearTimeout(geminiStartupTimer);handle.send(`${opts.systemAppend}\n\n${prompt}`);}
      const review = hookReviewKey(screen);
      const key = trustKeys < 12 && Date.now() - trustedAt > 3000 ? (trustKey(screen) ?? (cli==='codex'?null:review)) : null;
      if (key === 'down') {
        trustKeys += 1;
        quietly(() => p.write(term.appCursor ? '\x1bOB' : '\x1b[B'));
      } else if (key === 'enter') {
        trustKeys += 1;
        trustedAt = Date.now(); // the question takes a moment to go: don't answer it twice
        if (!review) log([{ kind: 'system', text: `✓ Trusted the worktree for ${label}.` }]);
        else if (!hooksHinted) {
          hooksHinted = true;
          log([{ kind: 'system', text: `ℹ To see ${label}'s steps here, trust the office's hooks once: in this terminal, type /hooks and press t. Until then the office shows its task.` }]);
        }
        quietly(() => p.write('\r'));
      }
      if (!nudged.has('login') && /Not logged in|run \/login|Select login method|Sign in with ChatGPT|Please login|Invalid API key/i.test(screen)) {
        nudged.add('login');
        log([{ kind: 'error', text: `⚠ ${label} needs you to sign in: open the terminal and sign in there, or run "${cli}" in a terminal of your own.` }]);
      } else if (!nudged.has('setup') && !trustKey(screen) && Date.now() - trustedAt > 5000 && /Choose the text style|Press Enter to continue|Bypass Permissions mode|Settings Error/i.test(screen)) {
        // First-run screens only the manager should answer: the CLI waits for them in the terminal.
        nudged.add('setup');
        log([{ kind: 'error', text: `⚠ ${label} is waiting on a setup screen: open the terminal to answer it.` }]);
      }
    }, 1000);
    bootTimer = setTimeout(() => {
      if (!done && !begun && cli === 'claude') log([{ kind: 'error', text: `⚠ ${label} hasn't started on the task yet. Open the terminal to see what it's waiting for.` }]);
    }, BOOT_MS);
  };
  const begin=()=>{void (async()=>{
    await validateAdmission();if(done)return;
    if(prev)await endLive(prev);
    if(done)return;
    if(preparing.get(term)!==admission||lives.has(term))throw new Error('Terminal ownership changed during replacement cleanup; execution denied');
    const blocker=cleanupBlocker();if(blocker)throw new Error(blocker);
    beginAfterCleanup();
  })().catch(error=>{if(!done)finish({ok:false,text:'',errors:[error instanceof Error?error.message:'Runtime replacement admission failed']});});};
  preparing.set(term,admission);
  // Codex won't resume a thread the office archived (see codexThread): it's unarchived first.
  if(cli==='codex'){
    void verifyCodex().then(async verified=>{if(done)return;codexTrustReady=true;log([{kind:'system',text:`Verified native trust for ${verified.verified} generated office hooks.`}]);if(opts.resumeSessionId)await codexThread('unarchive',opts.resumeSessionId);if(!done)begin();}).catch(error=>{if(!done)finish({ok:false,text:'',errors:[error instanceof CodexModelNotAdvertisedError?error.message:'Codex office hook trust or resume readiness could not be verified; no task was sent. Inspect native hook policy and source integrity.'],...(error instanceof CodexModelNotAdvertisedError?{configurationError:{kind:'unverified-model' as const,cli:'codex' as const,model:error.model}}:{})});});
  }
  else if(cli==='gemini')void verifyGeminiProfile(cmd,opts.browserTesting).then(blocker=>{if(done)return;if(blocker){finish({ok:false,text:'',errors:[blocker]});return;}begin();},()=>finish({ok:false,text:'',errors:['Gemini protected-profile validation failed; execution denied']}));
  else begin();

  return handle;
}
