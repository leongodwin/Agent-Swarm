import {taskReconciliationReviewPrompt,type TaskReconciliationReviewRequest} from './taskReconciliationReview.ts';
import type {ExecutionLedger,AttemptContext} from './executionLedger.ts';
import {evidenceHash} from './sessionEvidence.ts';
import {runtimeModelError} from '../shared/runtimePolicy.ts';
import {nextPreflightRetry,preflightDeferred,preflightRetrySchema} from './deliveryRetry.ts';
import type {DeliveryPreflightRetry} from '../shared/delivery.ts';
import {z} from 'zod';
import { deliveryCapabilitiesPrompt } from './deliveryCapabilities.ts';
import type { SessionAuthorization } from './toolGovernance.ts';
import { DELIVERY_ENGINEERING } from '../shared/delivery.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Backend } from './backend.ts';
import type { LogEntry, SessionHandle, SessionResult } from './agentRunner.ts';
import type { PrDetails } from './github.ts';
import { defaultProjectsDir, HOME_DIR, LOG_BUFFER, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, WORKSPACE_ROOT } from './config.ts';
import { ceoJobPrompt, ceoSystemPrompt, createOfficeTools, IssueCap, jobLabel, planRoute, specialtyLabel, specialtySlug, type CeoJob, type OfficeTools } from './ceo.ts';
import { HttpError } from './httpError.ts';
import { CHECKS_ALERT_MS, MAX_MERGE_FIXES, MERGE_RETRY_MS, mergeStep } from './mergeGate.ts';
import { auditDlpCompliance, type DlpPolicyViolation } from '../shared/dlp.ts';
import { DEFAULT_PREVIEW, Previews, parsePreviewPatch } from './previews.ts';
import { drainDecision, lastUpdateMessage, POSTPONE_MS, type DrainInput, type LastUpdate } from './officeUpdate.ts';
import { clampPacingSessions, DEFAULT_PACING_SESSIONS, mayStart, PACING_MS, pacingMessage, usageLabel, usageView, type UsageWarning, type WorkKind } from './pacing.ts';
import { isCli } from './clis.ts';
import type {ReconnectedCli} from './cliRunner.ts';
import { AgentTerminal } from './terminal.ts';
import { blockers, holdUps, issueSpecialty } from '../shared/issues.ts';
import { effectiveModel } from '../shared/models.ts';
import {copilotUnavailableModel} from './runtimeFailure.ts';
import { CEO_ID } from '../shared/types.ts';
import type {
  AgentCli,
  AgentLook,
  AgentRole,
  AgentStatus,
  AgentTask,
  AgentView,
  CeoInfo,
  CliView,
  EffortLevel,
  HireRequestView,
  IssueInfo,
  LogLine,
  OfficeUpdateView,
  PhoneMessage,
  PreviewConfig,
  PreviewView,
  ProjectFolderView,
  PullInfo,
  QaView,
  RepoView,
  ServerEvent,
  SwarmSettings,
  WorldSnapshot,
} from '../shared/types.ts';

import { activeEnvironment } from './tenancy.ts';
import { fixDeskBranch } from './workspace.ts';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { readOfficeState } from './officeState.ts';
import { QA_SCHEMA, parseQaReport, type QaReport } from './qaReport.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {assertOriginalTaskQa} from './taskReconciliation.ts';
import {mergedTaskEvidence} from './taskExecution.ts';

// ---------- persisted shape ----------

interface PersistedRepo {
  id: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number;
  color: string;
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  browserTesting: boolean;
  links: string[]; // other connected repos this floor's agents may read
  localPath: string | null; // the manager's own project folder (null: a clone under WORKSPACE_ROOT)
  mission: string;
  summary: string;
  qaBrief: string;
  preview: PreviewConfig; // how the floor's app runs for the preview monitor
  targetTenancy?: {
    tenantName: string;
    tenantDomain: string;
    tenantId: string;
    user: string;
    environmentName: string;
    environmentUrl: string;
  };
  addedAt: number;
}

interface PersistedAgent {
  id: string;
  name: string;
  repoId: string; // '' for the CEO, who works in the lobby
  role: AgentRole;
  title: string;
  specialty: string;
  brief: string;
  hiredBy: 'manager' | 'ceo';
  look: AgentLook;
  task: AgentTask | null;
  desk: number;
  color: string;
  hair: string;
  skin: string;
  model: string;
  effort: EffortLevel | '';
  cli: AgentCli | ''; // '' = the office's default CLI
  status: AgentStatus;
  issueNumber: number | null;
  issueTitle: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  sessionCli: AgentCli | null; // the CLI whose session sessionId is: only it can resume it
  lastError: string | null;
  modelBlock?:{fingerprint:string;reason:string};
  preflightRetry?:DeliveryPreflightRetry;
  launchedTaskScope?:{issue:number;hash:string};
  logTail: LogLine[];
}

/** A pull request's trip through QA. */
interface QaRecord extends QaView {
  taskAuthorityHash?:string;
  issueNumber: number | null;
  devSessionId: string | null; // the dev's Claude Code session, resumed to fix QA findings
  devSessionCli: AgentCli | null; // belongs to this checkpoint, not the agent's later sessions
  fixInstructions: string | null;
  sessionFailures: number;
  testedSha: string | null; // the head commit QA is testing
  passedSha: string | null; // the head commit QA signed off on: auto-merge merges exactly that
  fixReason: 'qa' | 'checks' | 'conflict' | 'dlp' | null; // why it was last sent back to a developer
  mergeFixes: number; // times it went back for failing checks or conflicts
  retests: number; // QA rounds caused by merge fixes or new commits rather than by QA failing it
  pendingSince: number | null; // when auto-merge started waiting on its checks
  mergeRetryAt: number | null; // GitHub refused the merge: try again after this
  alerted: boolean; // the manager has been told it's stuck
}

/** Choices made when a project moves into the office. */
interface FloorOptions {
  mission?: string; // brief for the CEO to plan from
  autoAssign?: boolean; // free developers pick up backlog issues as soon as they're filed
}

function developerCheckpoint(dev: Pick<PersistedAgent, 'id' | 'sessionId' | 'sessionCli'> | null, previous?: Pick<QaRecord, 'devAgentId' | 'devSessionId' | 'devSessionCli'>): Pick<QaRecord, 'devSessionId' | 'devSessionCli'> {
  if (dev?.sessionId) return {devSessionId: dev.sessionId, devSessionCli: isCli(dev.sessionCli) ? dev.sessionCli : null};
  if (previous && (!dev || dev.id === previous.devAgentId)) return {devSessionId: previous.devSessionId, devSessionCli: previous.devSessionCli};
  return {devSessionId: null, devSessionCli: null};
}

interface CeoState {
  recoveryHold?:boolean;
  queue: CeoJob[];
  job: CeoJob | null; // the job the CEO is on right now
  lastReviewAt: number | null;
  lastFingerprint: string | null; // company state at the last review; unchanged means the next review is skipped
  blockedReason: string | null;
  retryAt: number | null;
  modelBlock:{fingerprint:string;reason:string}|null;
}

interface Persisted {
  version: number;
  settings: SwarmSettings;
  repos: PersistedRepo[];
  agents: PersistedAgent[];
  qa: QaRecord[];
  requests: HireRequestView[];
  ceo: CeoState;
  messages: PhoneMessage[];
  phoneReadAt: number;
}

interface Shot {
  data: Buffer;
  mime: string;
  url: string | null;
  at: number;
}

interface AgentRuntime {
  log: LogLine[];
  pending: LogLine[];
  session: SessionHandle | null;
  currentTool: string | null;
  browserUrl: string | null;
  screenshot: { data: Buffer; mime: string; at: number } | null;
  shots: Shot[]; // every screenshot of the current session (QA evidence)
  terminal: AgentTerminal | null; // their terminal, once they've run in the terminal runtime
}

interface RepoRuntime {
  issues: IssueInfo[];
  pulls: PullInfo[];
  lastSync: number | null;
  syncError?: string;
  syncing: boolean;
  cloneStatus: RepoView['cloneStatus'];
  cloneError?: string;
  fetchedAt?: number; // when the latest issues/PRs fetch started
  lastMergedAt: string | null; // newest merge seen: a newer one means the folder needs a sync
  folderSync: string | null;
  merging: boolean;
}


// ---------- flavour ----------

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
const HAIR = ['#2b2118', '#6b4226', '#c68642', '#f2d16b', '#d94f30', '#1c1c1c', '#8e8e8e', '#5b3cc4', '#e76f51'];
const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
const DEV_NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Hedy', 'Tim', 'Katherine',
  'Bjarne', 'Frances', 'Edsger', 'Anita', 'Donald', 'Sophie', 'Yukihiro', 'Jean', 'Niklaus', 'Karen', 'Brendan',
];
const QA_NAMES = ['Sherlock', 'Marple', 'Poirot', 'Nancy', 'Columbo', 'Fletcher', 'Watson', 'Morse', 'Holmes', 'Maigret'];

// Names that get the feminine character look: everyone in the name pools above, plus common first names
// for agents the manager names themselves. The manager can always change an agent's look in the console.
const FEMININE_NAMES = new Set(
  (
    'ada grace margaret barbara radia hedy katherine frances anita sophie jean karen marple nancy fletcher ' +
    'alice amanda amelia amy ana anna anne aisha astrid ava bella beth carla caroline charlotte chloe claire clara ' +
    'diana elena elizabeth ella ellie emily emma eva fatima fiona freya georgia hannah harper helen holly ingrid iris ' +
    'isabella ivy jane jasmine jessica julia kate laura leah leila lena lily linda lisa lucy maria marie mary maya mei ' +
    'mia mila monica naomi natalie nina nora olivia paula priya rachel rose ruby sandra sara sarah scarlett sofia ' +
    'stella susan tess tessa tina vera victoria yuki zara zoe'
  ).split(' '),
);
const lookFor = (name: string): AgentLook => (FEMININE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase()) ? 'feminine' : 'masculine');
const LOOKS: AgentLook[] = ['feminine', 'masculine'];
const MAX_DESKS: Record<AgentRole, number> = { dev: 12, qa: 3, ceo: 1 };
const MAX_QA_ROUNDS = 3;
// Claude Code keeps its own default model when the office runs in SDK mode.
const DEFAULT_MODEL = '';
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// The CEO uses the selected CLI's default model unless the manager overrides it.
const CEO_MODEL = '';
const CEO_EFFORT: EffortLevel = 'xhigh';
const CEO_NAME = 'Satya';
// The CEO's own folder: its notes about the company live here. Repos are read through their clones.
const CEO_DIR = path.join(HOME_DIR, 'ceo');
const DEFAULT_PROJECTS_DIR = defaultProjectsDir(path.resolve(import.meta.dirname, '..'));
const MAX_PENDING_REQUESTS = 8;
const MAX_ISSUES_PER_JOB = 12;
const KEEP_MESSAGES = 200;
const KEEP_DECIDED_REQUESTS = 40;

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent';

const BUSY: AgentStatus[] = ['preparing', 'working'];
const FREE: AgentStatus[] = ['idle', 'done'];
// An agent whose session failed sits out this long before taking new work, so a broken setup can't burn through the queue.
const ERROR_COOLDOWN_MS = 2 * 60_000;
// Auto-assign stops retrying an issue after this many failed sessions; the manager can still assign it by hand.
const MAX_ISSUE_FAILURES = 2;
// How long the office waits after Coding runtime usage limit is hit when Claude doesn't say when it resets.
const LIMIT_PAUSE_MS = 15 * 60_000;
const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 200);

// The latest browser screenshot per agent is kept on disk so monitors survive a server restart.
const SCREENS_DIR = path.join(HOME_DIR, 'screens');
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const screenFile = (agentId: string, mime: string) => path.join(SCREENS_DIR, `${agentId}.${MIME_EXT[mime] ?? 'img'}`);

async function loadScreen(agentId: string): Promise<{ data: Buffer; mime: string; at: number } | null> {
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const file = path.join(SCREENS_DIR, `${agentId}.${ext}`);
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      return { data, mime, at: stat.mtimeMs };
    } catch {
      // try the next extension
    }
  }
  return null;
}

async function removeScreens(agentId: string) {
  await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(SCREENS_DIR, `${agentId}.${ext}`), { force: true })));
}

// Each agent's terminal (screen and scrollback) is saved too, so the office shows what they did after a restart.
const TERMINALS_DIR = path.join(HOME_DIR, 'terminals');
const terminalFile = (agentId: string) => path.join(TERMINALS_DIR, `${agentId}.ansi`);
const TERMINAL_SAVE_MS = 20_000;

// ---------- QA report ----------

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

export { HttpError };

export class Swarm {
  browserTaskHold:(repoId:string,actor:string,issue:number,since:number)=>Promise<boolean>=async()=>false;
  runtimeCleanup:()=>import('./runtimeCleanup.ts').CleanupView=()=>({records:[]});
  runtimeCleanupChanged(){if(this.closed)return;this.emitSessionUsage();this.later(()=>this.schedule(),0);}
  private sessionCapacityBlocker:string|undefined;
  restoreArchitectureCleanup(records:{jobId:string;repoId:string;reservedAt:number}[],unavailableReason?:string){
    for(const record of records)this.auxiliarySessions.set(record.jobId,{...record,kind:'architecture',state:'stopping'});
    // A corrupt store cannot prove how many model turns are still outstanding.
    this.sessionCapacityBlocker=records.length?undefined:unavailableReason;
  }
  private lastSessionUsage='';
  private emitSessionUsage(){const usage=this.sessionUsage(),key=JSON.stringify(usage);if(key===this.lastSessionUsage)return;this.lastSessionUsage=key;this.broadcast({type:'session_usage',usage});}
  private auxiliarySessions=new Map<string,import('../shared/sessionUsage.ts').SessionUsage['auxiliary'][number]>();
  sessionUsage():import('../shared/sessionUsage.ts').SessionUsage {
    const agentSessions=this.state.agents.filter(a=>BUSY.includes(a.status)).length,limit=this.state.settings.sessionLimit;
    const cleanup=this.runtimeCleanup(),busyIds=new Set(this.state.agents.filter(a=>BUSY.includes(a.status)).map(a=>a.id));
    const readiness=cleanup.readiness??[];
    const blockedReason=this.sessionCapacityBlocker??cleanup.unavailableReason??(cleanup.records.length?'Native runtime cleanup is pending or unverified; new work is quarantined':readiness.some(entry=>entry.state==='cancelled')?'Cancelled runtime readiness work is still pending; execution is held':undefined);
    const auxiliary=[...this.auxiliarySessions.values()].map(item=>({...item})),used=agentSessions+auxiliary.length+cleanup.records.filter(record=>!busyIds.has(record.agentId)).length+readiness.filter(entry=>!busyIds.has(entry.agentId)&&!cleanup.records.some(record=>record.agentId===entry.agentId)).length;
    return {limit,used,agentSessions,freeSlots:blockedReason?null:limit>0?Math.max(0,limit-used):null,auxiliary,...(readiness.length?{readiness}:{}),...(cleanup.records.length?{cleanup:cleanup.records}:{}),...(blockedReason?{blockedReason}:{}),...(cleanup.failureCode?{cleanupFailureCode:cleanup.failureCode}:{})};
  }
  reserveArchitectureSession(repoId:string,jobId:string):import('../shared/sessionUsage.ts').AuxiliarySessionLease {
    this.requireOpen();this.repo(repoId);
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(jobId))throw new HttpError(400,'Invalid architecture session identity');
    if(this.auxiliarySessions.has(jobId))throw new HttpError(409,'Architecture session already owns a slot');
    this.ensureSlot();
    const reservation:import('../shared/sessionUsage.ts').SessionUsage['auxiliary'][number]={jobId,repoId,kind:'architecture',state:'reserved',reservedAt:Date.now()};
    this.auxiliarySessions.set(jobId,reservation);
    const publish=()=>{this.emitSessionUsage();this.emitUsage();};
    const change=(state:'running'|'stopping')=>{if(this.auxiliarySessions.get(jobId)!==reservation)throw new HttpError(409,'Architecture session no longer owns its slot');if(state==='running'){this.requireOpen();if(reservation.state==='stopping')throw new HttpError(409,'Architecture runtime is stopping');}reservation.state=state;publish();};
    publish();return {running:()=>change('running'),stopping:()=>change('stopping'),release:()=>{if(this.auxiliarySessions.get(jobId)!==reservation)return;this.auxiliarySessions.delete(jobId);publish();this.later(()=>this.schedule(),0);}};
  }
  capabilityFingerprint = () => '';
  coordinatorEvidenceRead?: (input:unknown,guard:()=>void,repoIds:string[])=>Promise<unknown>;
  workerAdmissionContext: (repoIds: string[]) => string = () => '';
  capabilityStatus = () => '{}';
  capabilityPreflight: (repoId: string, cli: string) => Promise<string | null> = async () => { throw new Error('Capability service is not configured'); };
  ceoPreflight: (repoIds: string[],cli:AgentCli) => Promise<string | null> = async () => { throw new Error('CEO readiness is not configured'); };
  taskPaused: (title: string) => boolean = () => false;
  deliveryRevision = () => 0;
  requestDeliveryReview: (id: string) => Promise<string> = async () => { throw new Error('Delivery unavailable'); };
  createDeliveryRelease: (repoId: string, plan: unknown) => Promise<string> = async () => { throw new Error("Delivery unavailable"); };
  deliveryRecordTool?: import('./ceo.ts').RecordToolHandler;
  requestRecordReview: (repoId:string) => Promise<string> = async () => {throw new Error('Delivery records unavailable');};
  deliveryWorkGate: (repoId:string,issue:number) => void = () => {};
  executionEvidenceCheck:(repoId:string,issue:number,actor:string,attemptId:string,guard:()=>void)=>Promise<void>=async()=>{};
  deliveryTaskStage: (repoId:string,issue:number) => string|undefined = () => undefined;
  deliveryTaskFingerprint: (repoId:string,issue:number) => string = () => '';
  deliveryTaskContract:(repoId:string,issue:number)=>{owner:string;qaOwner:string;components:string[];resources:string[]}|null=()=>null;
  deliveryTaskComplete:(repoId:string,issue:number,evidence:{prNumber:number;headSha:string;reviewer:string;taskAuthorityHash:string;evidenceHash:string})=>Promise<void>=async()=>{};
  deliveryTaskContext:(repoId:string,issue:number)=>string=()=>'';
  deliveryTaskInputs:(repoId:string,issue:number)=>string[]=()=>[];
  verifyTaskInputs:(cwd:string,commits:string[])=>Promise<void>=async()=>{};
  executionLedger?:ExecutionLedger;
  private executionAttempts=new Map<string,{id:string;generation:number}>();
  private automaticAgents=new Set<string>();
  private automaticTasks=new Map<string,number>();
  private executionDenials=new Map<string,number>();
  private executionContext(a:PersistedAgent,repo:PersistedRepo,issue=a.issueNumber):AttemptContext{
    return {repoId:repo.id,agentId:a.id,role:a.task==='qa'?'qa':'dev',runtime:(a.sessionId&&a.sessionCli||a.cli||this.state.settings.defaultCli) as 'codex'|'gemini'|'opencode',task:a.task==='qa'?a.prNumber===null?'review':'qa':a.task==='fix'?'fix':'issue',issue:issue&&issue>0?issue:null,scopeHash:evidenceHash(this.deliveryTaskFingerprint(repo.id,issue??0)),admissionHash:evidenceHash([this.workerAdmissionContext([repo.id,...repo.links]),a.cli,this.modelFor(a,a.cli||this.state.settings.defaultCli),a.effort||this.state.settings.defaultEffort,a.role,this.state.settings.runtime,a.cli||this.state.settings.defaultCli])};
  }
  private trackExecution(a:PersistedAgent,repo:PersistedRepo){
    if(!this.executionLedger||this.backend.demo||a.role==='ceo')return;
    const prior=this.executionAttempts.get(a.id),generation=this.taskGeneration(a);if(prior?.generation===generation)return;
    if(this.executionDenials.get(a.id)===generation)throw new HttpError(409,'Execution reservation was denied');
    let id:string;try{id=this.executionLedger.reserve(this.executionContext(a,repo),this.automaticTasks.get(a.id)===generation);}catch(error){this.executionDenials.set(a.id,generation);throw error;}this.executionAttempts.set(a.id,{id,generation});
  }
  private endExecution(a:PersistedAgent,outcome:'reported-success'|'failure'|'blocked'|'interrupted',sessionEvidenceId?:string){
    const current=this.executionAttempts.get(a.id);if(!current)return;try{this.executionLedger?.finish(current.id,outcome,sessionEvidenceId);}catch{/* Evidence failure is exposed by availability; it never creates acceptance. */}
  }
  private executionHeld(a:PersistedAgent,repo:PersistedRepo,issue:number){try{return !!this.executionLedger?.blocked({...this.executionContext(a,repo,issue),role:'dev'});}catch{return true;}}
  private qaExecutionHeld(a:PersistedAgent,repo:PersistedRepo,issue:number){try{return !!this.executionLedger?.blocked({...this.executionContext(a,repo,issue),role:'qa'});}catch{return true;}}
  private taskClaims=new Map<string,{generation:number;repoId:string;issue:number;components:string[];resources:string[]}>();
  private taskAcceptancePending=new Set<QaRecord>();
  private manualQaRetries=new WeakSet<QaRecord>();
  deliveryRecordContext: (repoId:string) => string = () => '';
  engineeringTools: (authorize?: SessionAuthorization, agentId?:string, repoId?:string) => OfficeTools | undefined = () => undefined;
  deliveryQaTools: (agentId: string, repoId: string, authorize?: SessionAuthorization) => OfficeTools | undefined = () => undefined;
  deliveryStatus = () => JSON.stringify({ message: 'Delivery service is unavailable' });
  private state: Persisted = {
    version: 2,
    settings: {
      sessionLimit: 0,
      defaultModel: '',
      defaultEffort: 'medium',
      runtime: 'terminal',
      defaultCli: 'codex',
      hiring: 'approve',
      teamCap: 6,
      ceoHeartbeatMin: 60,
      managerName: '',
      companyName: '',
      projectsDir: DEFAULT_PROJECTS_DIR,
      setupDone: false,
      tutorialStep: 0,
      autoUpdate: true,
      pacingSessions: DEFAULT_PACING_SESSIONS,
    },
    repos: [],
    agents: [],
    qa: [],
    requests: [],
    ceo: { queue: [], job: null, lastReviewAt: null, lastFingerprint: null, blockedReason: null, retryAt: null,modelBlock:null },
    messages: [],
    phoneReadAt: 0,
  };
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  private officeTools(authorize?: SessionAuthorization): OfficeTools {
    return createOfficeTools({
      readDiscoveryEvidence:this.coordinatorEvidenceRead?input=>this.coordinatorEvidenceRead!(input,this.planningSessionGuard('ceo'),this.state.ceo.job?.repoId?[this.state.ceo.job.repoId]:this.state.repos.map(repo=>repo.id)):undefined,
      deliveryRecord: this.deliveryRecordTool,
      reviewDeliveryRecord: this.requestRecordReview,
      companyStatus: () => this.companyStatus(),
      deliveryStatus: () => this.deliveryStatus(),
      capabilityStatus: () => this.capabilityStatus(),
      reviewRelease: (id) => this.requestDeliveryReview(id),
      createRelease: (repoId, plan) => this.createDeliveryRelease(repoId, plan),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: (a) => this.setFloorProfile(a),
      updateJob: (a) => this.updateJob(a),
      proposeHire: (a) => this.proposeHire(a),
      proposeLetGo: (a) => this.proposeLetGo(a),
      fileIssue: (a) => this.fileIssue(a),
      routeIssue: (a) => this.routeIssue(a),
    }, authorize);
  }
  private ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB); // issues filed during the current CEO job
  private messageSeq = 1;
  private agentRt = new Map<string, AgentRuntime>();
  private taskGenerations = new Map<string, number>();
  private taskStops = new Map<string, AbortController>();
  private workerAdmissions = new Map<string, { generation: number; context: string; resume?: string; retainedCli?: AgentCli }>();
  private deskWriters = new Map<string, SerialWriter>();
  private deskOperation<T>(a: PersistedAgent, action: () => Promise<T>): Promise<T> {
    let writer = this.deskWriters.get(a.id);
    if (!writer) {writer = new SerialWriter(); this.deskWriters.set(a.id, writer);}
    return writer.write(action);
  }

  private taskGeneration(a: PersistedAgent) { return this.taskGenerations.get(a.id) ?? 0; }
  planningSessionGuard(agentId:string) {
    const agent=this.agent(agentId),generation=this.taskGeneration(agent);
    return ()=>{this.requireOpen();if(agent.status!=='working'||!this.ownsTask(agent,generation))throw new HttpError(403,'Planning session changed or stopped; stale record updates are denied');};
  }
  private reserveTask(a: PersistedAgent) {
    this.endExecution(a,'interrupted');
    this.taskStops.get(a.id)?.abort();
    this.taskStops.set(a.id, new AbortController());
    this.workerAdmissions.delete(a.id);
    const generation = this.taskGeneration(a) + 1; this.taskGenerations.set(a.id, generation); if(this.automaticAgents.has(a.id))this.automaticTasks.set(a.id,generation); return generation;
  }
  private ownsTask(a: PersistedAgent, generation: number) {
    return !this.closed && this.state.agents.includes(a) && this.taskGeneration(a) === generation;
  }
  private repoRt = new Map<string, RepoRuntime>();
  private clients = new Set<WebSocket>();
  private user: string | null = null;
  private ghError: string | undefined;
  private saveTimer: NodeJS.Timeout | null = null;
  private stateLoaded = false;
  private closed = false;
  private draining = false;
  get isDraining(){return this.draining;}
  setDraining(value:boolean){this.requireOpen();this.draining=value;this.broadcast({type:'draining',draining:value});if(!value)this.later(()=>this.schedule(),200);}
  private requireOpen() {
    if (this.closed) throw new HttpError(409, 'Office is shutting down');
  }
  private lifecycleStop = new AbortController();
  private shutdownWork: Promise<void> | null = null;
  private lifecycleTimers = new Set<NodeJS.Timeout>();
  private stateWriter = new SerialWriter();
  private flushTimer: NodeJS.Timeout | null = null;
  private logSeq = 1;
  private previews: Previews;
  private officeHead: string | null = null; // the commit the office runs (null: not a git checkout, so no self-update)
  private officeUpdate = {
    behind: 0,
    requested: false,
    postponedUntil: null as number | null,
    postponedBehind: 0,
    failed: null as string | null,
    failedBehind: null as number | null,
    drainingSince: null as number | null,
    sent: false,
    handedOver: false, // sessions cut off by the hand-over are the restarted office's to recover
  };
  private lastOfficeView = '';
  private clis: CliView[] = []; // coding-agent CLIs found on this machine (detected at startup)

  constructor(private backend: Backend) {
    this.previews = new Previews(backend, {
      emit: (id) => {
        const r = this.state.repos.find((x) => x.id === id);
        if (r && this.repoRt.has(id)) this.emitRepo(r);
      },
      pulls: (id) => this.repoRt.get(id)?.pulls ?? [],
    });
  }

  // ---------- lifecycle ----------

  async init() {
    if (this.closed || this.stateLoaded) throw new Error('Office lifecycle has already started or stopped');
    const loaded = await readOfficeState(STATE_FILE) as Partial<Persisted> | null;
    if (this.closed) return;
    if (loaded) {
      this.state = {
        version: loaded.version ?? 0,
        settings: { ...this.state.settings, ...loaded.settings },
        repos: (loaded.repos ?? []).map((r) => ({
          ...r,
          autoMerge: r.autoMerge ?? true,
          links: r.links ?? [],
          mission: r.mission ?? '',
          summary: r.summary ?? '',
          qaBrief: r.qaBrief ?? '',
          localPath: r.localPath ?? null,
          preview: { command: r.preview?.command ?? null, env: { ...r.preview?.env } },
        })),
        agents: (loaded.agents ?? []).map((a) => ({
          ...a,
          effort: a.effort ?? '',
          role: a.role ?? 'dev',
          title: a.title ?? '',
          specialty: a.specialty ?? '',
          brief: a.brief ?? '',
          hiredBy: a.hiredBy ?? 'manager',
          look: a.look ?? lookFor(a.name),
          task: a.task ?? (a.issueNumber ? 'issue' : null),
          cli: isCli(a.cli) ? a.cli : '',
          sessionCli: isCli(a.sessionCli) ? a.sessionCli : null,
          modelBlock:a.modelBlock===undefined?undefined:z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().min(1).max(1000)}).strict().parse(a.modelBlock),
          launchedTaskScope:a.launchedTaskScope===undefined?undefined:z.strictObject({issue:z.number().int().positive(),hash:z.string().min(1).max(128)}).parse(a.launchedTaskScope),
          preflightRetry:a.preflightRetry===undefined?undefined:preflightRetrySchema.parse(a.preflightRetry),
        })),
        qa: (loaded.qa ?? []).map((q) => ({
          ...q,
          devSessionCli: isCli(q.devSessionCli) ? q.devSessionCli : null,
          testedSha: q.testedSha ?? null,
          passedSha: q.passedSha ?? null,
          fixReason: q.fixReason ?? null,
          mergeFixes: q.mergeFixes ?? 0,
          retests: q.retests ?? 0,
          pendingSince: q.pendingSince ?? null,
          mergeRetryAt: q.mergeRetryAt ?? null,
          alerted: q.alerted ?? false,
          mergeNote: null,
        })),
        requests: loaded.requests ?? [],
        ceo: { ...this.state.ceo, ...loaded.ceo },
        messages: loaded.messages ?? [],
        phoneReadAt: loaded.phoneReadAt ?? 0,
      };
      for (const m of this.state.messages) this.messageSeq = Math.max(this.messageSeq, m.id + 1);
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
      this.state.settings.runtime = 'terminal';
      if(/claude|anthropic/i.test(this.state.settings.defaultModel))this.state.settings.defaultModel='';
      for(const agent of this.state.agents)if(/claude|anthropic/i.test(agent.model))agent.model='';
      if (!isCli(this.state.settings.defaultCli)) this.state.settings.defaultCli = 'codex';
      if (this.state.version < 2) {
        if (this.state.settings.defaultCli === 'claude') {
          this.state.settings.defaultCli = 'codex';
          this.state.settings.defaultModel = '';
        }
        const ceo = this.state.agents.find((a) => a.id === CEO_ID);
        if (ceo?.model === 'claude-opus-5-5') ceo.model = CEO_MODEL;
        this.state.version = 2;
      }
      if (!this.state.settings.defaultModel && this.state.settings.defaultCli === 'claude') this.state.settings.defaultModel = DEFAULT_MODEL;
      // "Max concurrent sessions" (default 4) became an optional session limit. The old default goes; a limit the manager chose stays.
      const old = this.state.settings as SwarmSettings & { maxConcurrent?: number; permissionMode?: string };
      if (old.maxConcurrent !== undefined) {
        if (loaded.settings?.sessionLimit === undefined) old.sessionLimit = old.maxConcurrent === 4 ? 0 : old.maxConcurrent;
        delete old.maxConcurrent;
      }
      delete old.permissionMode; // the office's rules are instructions now, not a permission mode
      // Offices that were set up before the setup wizard existed skip it.
      if (loaded.settings && loaded.settings.setupDone === undefined && this.state.repos.length > 0) {
        Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
      }
    }
    const savedCeo=this.state.agents.find(a=>a.id===CEO_ID);
    if(savedCeo?.status==='error'&&this.ceoCli(savedCeo)==='copilot'&&copilotUnavailableModel(savedCeo.lastError??'',savedCeo.model||CEO_MODEL))this.holdCeoModel(savedCeo.model||CEO_MODEL);
    this.stateLoaded = true;
    for (const r of this.state.repos) if (r.localPath) this.backend.setLocalPath(r.fullName, r.localPath);
    const interrupted: PersistedAgent[] = [];
    for (const a of this.state.agents) {
      const tail = a.logTail ?? [];
      for (const l of tail) this.logSeq = Math.max(this.logSeq, l.id + 1);
      this.agentRt.set(a.id, { log: tail, pending: [], session: null, currentTool: null, browserUrl: null, screenshot: await loadScreen(a.id), shots: [], terminal: await this.loadTerminal(a.id) });
    }
    // CLIs the terminal keeper kept running through the restart go back into their terminals, and busy ones carry on.
    // One-shot Copilot sessions resume cold; retained native CEO sessions rebind office tools after fresh admission.
    const back = await this.backend
      .reconnectClis((id) => {
        const a = this.state.agents.find((x) => x.id === id);
        return a ? this.terminalFor(a) : null;
      })
      .catch((err) => {
        console.warn('could not reconnect to the terminal keeper', err);
        return [];
      });
    const carryOn: PersistedAgent[] = [];
    if (this.closed) return;
    for (const a of this.state.agents) {
      if (!BUSY.includes(a.status)) continue;
      if (back.some((c) => c.agentId === a.id && c.busy)) {
        carryOn.push(a);
        continue;
      }
      if(!this.backend.demo&&a.role==='ceo'&&this.state.ceo.job){this.holdRetainedCeo(a,this.state.ceo.job,'Retained native runtime is missing; reconcile its submitted outcome before retrying');continue;}
      a.status = 'stopped';
      a.lastError = 'The swarm server restarted while this agent was working.';
      interrupted.push(a);
    }
    for (const c of back) if (c.busy && !carryOn.some((a) => a.id === c.agentId)) this.agentRt.get(c.agentId)?.terminal?.releaseIdle?.();
    for (const r of this.state.repos) this.repoRt.set(r.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false });
    await Promise.all(carryOn.map(a => this.reattachSession(a, back.find(held => held.agentId === a.id)!)));
    if (this.closed) return;
    this.backend.hooksReady();

    try {
      this.user = await this.backend.user();
    } catch (err) {
      this.ghError = `GitHub CLI is not ready: ${(err as Error).message}. Run "gh auth login".`;
      console.warn(this.ghError);
    }

    if (this.backend.demo && this.state.repos.length === 0) {
      // The demo opens on a busy office; the tutorial still runs so it can be tried.
      Object.assign(this.state.settings, { setupDone: true, managerName: 'Demo Manager', companyName: 'Grasp AI' });
      for (const r of await this.backend.listMyRepos()) {
        const repo = await this.connectRepo(r.nameWithOwner);
        for (let i = 0; i < (repo.floor === 1 ? 5 : 3); i++) this.hireAgent(repo.id, {});
        this.updateRepo(repo.id, { autoAssign: true });
      }
    }
    for (const r of this.state.repos) this.ensureQaTester(r);
    if (this.closed) return;
    this.ensureCeo(interrupted);

    for (const r of this.state.repos) void this.cloneRepo(r.id);
    await Promise.all(this.state.repos.map((r) => this.syncRepo(r.id)));
    if (this.closed) return;
    // Anything still alive in a desk (or a preview) is left over from before the restart, except around the CLIs that
    // kept running through it: their dev servers and commands are theirs.
    await Promise.all([
      ...this.state.agents.map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo || back.some((c) => c.agentId === a.id)) return undefined;
        return this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).catch(() => undefined);
      }),
      this.previews.clearOrphans(this.state.repos),
    ]);
    for (const r of this.state.repos) void this.previews.refreshDefault(r);
    this.recover(interrupted);
    this.officeHead = await this.backend.office.head();
    const updated = await this.backend.office.takeLastUpdate().catch(() => null);
    if (updated) await this.reportUpdate(updated);
    this.every(() => this.state.repos.forEach((r, i) => this.later(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    this.every(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    this.every(() => void this.saveTerminals(), TERMINAL_SAVE_MS);
    void this.backend
      .detectClis()
      .then((clis) => {
        this.clis = clis;
        this.broadcast({ type: 'clis', clis });
      })
      .catch((err) => console.warn('could not look for agent CLIs', err));
    this.save();
    this.later(() => this.schedule(), 1000);
  }

  /** Agents cut off by a server restart pick their coding-agent session back up (QA and demo agents start over). */
  private recover(agents: PersistedAgent[]) {
    for (const a of agents) {
      if (a.task === 'qa' || this.backend.demo || !a.sessionId || !a.branch) {
        this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Starting over from the queue.' }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        continue;
      }
      if (this.slotsFull()) continue; // stays 'stopped'; the manager can resume it later
      const repo=this.state.repos.find(r=>r.id===a.repoId);if(repo&&this.executionHeld(a,repo,a.issueNumber??0))continue;
      this.automaticAgents.add(a.id);try{void this.message(a.id, 'The office server restarted while you were working. Check the state of your worktree and continue where you left off.').catch((err) =>
        console.warn(`could not resume ${a.name}`, err),
      );}finally{this.automaticAgents.delete(a.id);}
    }
  }

  // ---------- views ----------

  private repoView(r: PersistedRepo): RepoView {
    const rt = this.repoRt.get(r.id)!;
    return {
      id: r.id,
      fullName: r.fullName,
      description: r.description,
      url: r.url,
      defaultBranch: r.defaultBranch,
      floor: r.floor,
      color: r.color,
      autoAssign: r.autoAssign,
      autoMerge: r.autoMerge,
      folderSync: rt.folderSync,
      browserTesting: r.browserTesting,
      links: r.links,
      mission: r.mission,
      summary: r.summary,
      qaBrief: r.qaBrief,
      localPath: r.localPath,
      checkoutPath: this.backend.mainDir(r.fullName),
      cloneStatus: rt.cloneStatus,
      cloneError: rt.cloneError,
      issues: rt.issues,
      pulls: rt.pulls,
      lastSync: rt.lastSync,
      syncError: rt.syncError,
      previewConfig: r.preview,
      preview: this.previews.view(r),
      targetTenancy: r.targetTenancy,
    };
  }

  private agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const rt = this.agentRt.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      title: a.title,
      specialty: a.specialty,
      brief: a.brief,
      hiredBy: a.hiredBy,
      look: a.look,
      task: a.task,
      desk: a.desk,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      model: a.model,
      effort: a.effort,
      cli: a.cli,
      terminal: !!rt.terminal,
      status: a.status,
      issueNumber: a.issueNumber,
      issueTitle: a.issueTitle,
      branch: a.branch,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      currentTool: rt.currentTool,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      costUsd: a.costUsd,
      turns: a.turns,
      browserUrl: rt.browserUrl,
      hasScreenshot: !!rt.screenshot,
      screenshotAt: rt.screenshot?.at ?? null,
      lastError: a.lastError,
      recovery: this.workerRecovery(a),
      log: withLog ? rt.log : [],
    };
  }

  private qaView(q: QaRecord): QaView {
    return {
      repoId: q.repoId,
      prNumber: q.prNumber,
      status: q.status,
      testedSha: q.testedSha,
      passedSha: q.passedSha,
      round: q.round,
      devAgentId: q.devAgentId,
      qaAgentId: q.qaAgentId,
      summary: q.summary,
      checks: q.checks,
      commentUrl: q.commentUrl,
      mergeNote: q.mergeNote,
      updatedAt: q.updatedAt,
    };
  }

  snapshot(): WorldSnapshot {
    return {
      sessionUsage:this.sessionUsage(),
      draining:this.draining,
      user: this.user,
      ghReady: !this.ghError,
      ghError: this.ghError,
      demo: this.backend.demo,
      workspaceRoot: WORKSPACE_ROOT,
      settings: this.state.settings,
      repos: this.state.repos.map((r) => this.repoView(r)),
      agents: this.state.agents.map((a) => this.agentView(a, true)),
      qa: this.state.qa.map((q) => this.qaView(q)),
      requests: this.state.requests,
      ceo: this.ceoInfo(),
      messages: this.state.messages.slice(-100),
      phoneReadAt: this.state.phoneReadAt,
      usage: this.usageNow(),
      clis: this.clis,
      officeCommit: this.officeHead?.slice(0, 7) ?? null,
      officeUpdate: this.officeHead ? this.officeUpdateView() : undefined,
    };
  }

  screenshot(agentId: string) {
    return this.agentRt.get(agentId)?.screenshot ?? null;
  }

  // ---------- clients ----------

  addClient(ws: WebSocket) {
    if (this.closed) { ws.close(1001, 'Office is shutting down'); return; }
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error',()=>this.disconnectClient(ws));
    this.send(ws, { type: 'snapshot', data: this.snapshot() });
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) this.sendSerialized(ws,JSON.stringify(ev));
  }

  private disconnectClient(ws:WebSocket){this.clients.delete(ws);try{ws.terminate();}catch{/* A broken browser cannot interrupt delivery or other observers. */}}
  private sendSerialized(ws:WebSocket,message:string){try{ws.send(message,error=>{if(error)this.disconnectClient(ws);});}catch{this.disconnectClient(ws);}}

  private broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) this.sendSerialized(ws,msg);
  }

  private toast(level: 'info' | 'success' | 'error', text: string) {
    this.broadcast({ type: 'toast', level, text });
  }

  private emitRepo(r: PersistedRepo) {
    this.broadcast({ type: 'repo', repo: this.repoView(r) });
  }

  private emitAgent(a: PersistedAgent) {
    if(!BUSY.includes(a.status))this.endExecution(a,a.status==='done'?'reported-success':a.status==='stopped'?'interrupted':a.status==='error'?'blocked':'interrupted');
    // A session can finish after its agent was let go (their floor disconnected mid-task); they're gone, so say nothing.
    if (!this.agentRt.has(a.id)) return;
    const { log: _log, ...rest } = this.agentView(a, false);
    this.broadcast({ type: 'agent', agent: rest });
    this.emitSessionUsage();
  }

  private setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    Object.assign(rec, patch, { updatedAt: Date.now() });
    this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    this.save();
  }

  private appendLog(a: PersistedAgent, entries: LogEntry[]) {
    if (this.closed) return;
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const t = Date.now();
    for (const e of entries) {
      const line: LogLine = { id: this.logSeq++, t, kind: e.kind, text: e.text, tool: e.tool };
      rt.log.push(line);
      rt.pending.push(line);
    }
    if (rt.log.length > LOG_BUFFER) rt.log.splice(0, rt.log.length - LOG_BUFFER);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushLogs(), 120);
  }

  private flushLogs() {
    this.flushTimer = null;
    for (const [agentId, rt] of this.agentRt) {
      if (rt.pending.length === 0) continue;
      this.broadcast({ type: 'log', agentId, lines: rt.pending });
      rt.pending = [];
    }
    this.save();
  }

  // ---------- persistence ----------

  private later(callback: () => void, delay: number) {
    if (this.closed) return;
    const timer = setTimeout(() => { this.lifecycleTimers.delete(timer); if (!this.closed) callback(); }, delay);
    this.lifecycleTimers.add(timer);
  }

  private every(callback: () => void, delay: number) {
    if (this.closed) return;
    this.lifecycleTimers.add(setInterval(() => { if (!this.closed) callback(); }, delay));
  }

  private save() {
    if (this.closed || !this.stateLoaded || this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.writeState().catch((err) => console.warn('could not save the state', err)), 1500);
  }

  /** Write the state file now, e.g. before the office stops or hands itself to the launcher. */
  private async writeState() {
    if (!this.stateLoaded) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.stateWriter.write(async () => {
      for (const a of this.state.agents) a.logTail = (this.agentRt.get(a.id)?.log ?? []).slice(-200);
      await atomicWrite(STATE_FILE, JSON.stringify(this.state, null, 2));
    });
  }

  // ---------- lookups ----------

  private repo(id: string) {
    const r = this.state.repos.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `Repo ${id} is not connected`);
    return r;
  }

  private agent(id: string) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No agent ${id}`);
    return a;
  }

  private running() {
    return this.sessionUsage().used;
  }

  /** True when the manager has set a session limit and every slot is taken. */
  private slotsFull() {
    const limit = this.state.settings.sessionLimit;
    return this.draining || !!this.sessionUsage().blockedReason || limit > 0 && this.running() >= limit;
  }

  private agentSlug(a: PersistedAgent) {
    return `${slugify(a.name)}-${a.id.slice(0, 4)}`;
  }

  private clearTask(a: PersistedAgent) {
    Object.assign(a, { status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, lastError: null });
    this.emitAgent(a);
  }

  // ---------- GitHub / repos ----------

  async listGithubRepos(owner?: string) {
    this.requireOpen();
    const repos = await this.backend.listMyRepos(owner);
    this.requireOpen();
    return repos;
  }

  /**
   * Give a GitHub repo a floor. Its main checkout is one of your own folders: the one you picked, else the folder in
   * your projects folder that already has it as origin, else a fresh clone into your projects folder.
   */
  async connectRepo(fullName: string, opts: FloorOptions & { localPath?: string } = {}): Promise<RepoView> {
    this.requireOpen();
    const existing = this.state.repos.find((r) => r.id.toLowerCase() === fullName.toLowerCase());
    if (existing) throw new HttpError(409, `${fullName} is already floor ${existing.floor}`);
    const meta = await this.backend.repoMeta(fullName);
    this.requireOpen();
    const folder = opts.localPath ?? (await this.projectFolderFor(meta.nameWithOwner));
    this.requireOpen();
    const floor = this.state.repos.reduce((m, r) => Math.max(m, r.floor), 0) + 1;
    const repo: PersistedRepo = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor,
      color: FLOOR_COLORS[(floor - 1) % FLOOR_COLORS.length],
      autoAssign: !!opts.autoAssign,
      autoMerge: true,
      browserTesting: true,
      links: [],
      localPath: folder,
      mission: (opts.mission ?? '').trim().slice(0, 4000),
      summary: '',
      qaBrief: '',
      preview: { ...DEFAULT_PREVIEW, env: {} },
      targetTenancy: activeEnvironment(await this.backend.tenancy.info()),
      addedAt: Date.now(),
    };
    this.requireOpen();
    this.backend.setLocalPath(repo.fullName, folder);
    this.state.repos.push(repo);
    this.repoRt.set(repo.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false });
    this.save();
    this.emitRepo(repo);
    this.toast('success', `${repo.fullName} moved into floor ${floor}`);
    this.ensureQaTester(repo);
    void this.cloneRepo(repo.id);
    void this.syncRepo(repo.id);
    // The CEO studies every new floor and proposes the team it needs.
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
    return this.repoView(repo);
  }

  /** Where a GitHub repo's checkout goes when you connect it without picking a folder. */
  private async projectFolderFor(fullName: string): Promise<string> {
    const root = this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch(() => []);
    this.requireOpen();
    const match = folders.find((f) => f.github?.toLowerCase() === fullName.toLowerCase());
    if (match) return match.path;
    const name = fullName.split('/')[1];
    const taken = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new HttpError(409, `${taken.path} already exists and isn't a clone of ${fullName}. Connect that folder instead, or rename it first.`);
    return path.join(root, name); // cloned there when the floor opens
  }

  /** A brand-new project: a folder in your projects folder, pushed to a new GitHub repo. */
  async createRepo(name: string, opts: FloorOptions & { description?: string; visibility: 'private' | 'public'; owner?: string }) {
    this.requireOpen();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Project names may only contain letters, numbers, ".", "-" and "_"');
    const created = await this.backend.createProject(this.state.settings.projectsDir, name, opts).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(created.fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: created.path });
  }

  /** The folders in your projects folder (or another folder you point at), and which are floors already. */
  async listProjectFolders(dir?: string): Promise<{ root: string; folders: ProjectFolderView[] }> {
    this.requireOpen();
    const root = dir?.trim() ? path.resolve(dir.trim()) : this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    this.requireOpen();
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const floorOf = (f: { path: string; github: string | null }) =>
      this.state.repos.find((r) => (r.localPath && same(r.localPath, f.path)) || (f.github && r.id.toLowerCase() === f.github.toLowerCase()))?.floor ?? null;
    return { root, folders: folders.map((f) => ({ name: f.name, path: f.path, git: f.git, github: f.github, floor: floorOf(f) })) };
  }

  /** Give one of your folders a floor. It must already be on GitHub; otherwise publish it first. */
  async connectFolder(dir: string, opts: FloorOptions = {}) {
    this.requireOpen();
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    this.requireOpen();
    if (!f.github) throw new HttpError(400, `${f.name} ${f.git ? "isn't on GitHub yet" : "isn't a git repository yet"}. Publish it to GitHub first.`);
    return this.connectRepo(f.github, { ...opts, localPath: f.path });
  }

  /** Put one of your folders on GitHub (only what's committed goes up), then give it a floor. */
  async publishFolder(dir: string, opts: FloorOptions & { name?: string; visibility: 'private' | 'public'; description?: string }) {
    this.requireOpen();
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    this.requireOpen();
    const name = (opts.name?.trim() || f.name).replace(/[^A-Za-z0-9._-]+/g, '-');
    const fullName = await this.backend.publishFolder(f.path, { name, visibility: opts.visibility, description: opts.description }).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: f.path });
  }

  disconnectRepo(id: string) {
    this.requireOpen();
    const repo = this.repo(id);
    this.state.ceo.queue = this.state.ceo.queue.filter((j) => j.repoId !== id);
    for (const r of this.state.requests.filter((x) => x.repoId === id && x.status === 'pending')) {
      this.decide(r, { status: 'rejected', note: 'The floor was disconnected.', decidedBy: null });
    }
    for (const a of this.state.agents.filter((x) => x.repoId === id)) this.fireAgent(a.id, true);
    void this.previews.remove({ ...repo });
    this.state.repos = this.state.repos.filter((r) => r.id !== id);
    for (const q of this.state.qa.filter((x) => x.repoId === id)) this.broadcast({ type: 'qaRemoved', repoId: id, prNumber: q.prNumber });
    this.state.qa = this.state.qa.filter((q) => q.repoId !== id);
    for (const r of this.state.repos) r.links = r.links.filter((l) => l !== id);
    this.repoRt.delete(id);
    // Keep floors contiguous.
    this.state.repos.sort((a, b) => a.floor - b.floor).forEach((r, i) => (r.floor = i + 1));
    this.backend.setLocalPath(repo.fullName, null);
    this.save();
    this.broadcast({ type: 'repoRemoved', repoId: id });
    for (const r of this.state.repos) this.emitRepo(r);
    this.toast('info', repo.localPath ? `${repo.fullName} left the building. Your folder ${repo.localPath} is untouched.` : `${repo.fullName} disconnected (its clone stays on disk)`);
  }

  /** Adopt the already authenticated target only while idle. Existing record/release hashes remain unchanged. */
  async refreshRepoTarget(id:string,expectedEnvironmentUrl:string|null,environmentUrl:string,username:string,externalGuard:()=>void=()=>{}){
    const canonical=(url:string)=>{const value=new URL(url);if(value.protocol!=='https:'||value.username||value.password||value.port||value.pathname!=='/'||value.search||value.hash||!/^[a-z0-9-]+\.crm\d*\.dynamics\.com$/.test(value.hostname))throw new HttpError(400,'Expected an organization root URL');return value.origin;};
    const target=canonical(environmentUrl),previous=expectedEnvironmentUrl===null?null:canonical(expectedEnvironmentUrl);
    const guard=()=>{this.requireOpen();externalGuard();const repo=this.repo(id),usage=this.sessionUsage();if(usage.used||usage.blockedReason||this.state.ceo.job||this.backend.tenancy.activity().busy)throw new HttpError(409,'Wait for native work and authentication reconciliation before changing the project target');if((repo.targetTenancy?canonical(repo.targetTenancy.environmentUrl):null)!==previous)throw new HttpError(409,'Project target changed; refresh before retrying');return repo;};
    guard();const info=await this.backend.tenancy.info();const selected=activeEnvironment(info);const repo=guard();
    if(info.status!=='connected'||!info.isReal||!selected||canonical(selected.environmentUrl)!==target||selected.user.toLowerCase()!==username.toLowerCase()||(repo.targetTenancy&&repo.targetTenancy.user.toLowerCase()!==username.toLowerCase()))throw new HttpError(409,'The intended existing account and selected target are not confirmed');
    repo.targetTenancy=selected;repo.autoAssign=false;repo.autoMerge=false;
    this.save();this.emitRepo(repo);return this.repoView(repo);
  }

  updateRepo(
    id: string,
    patch: Partial<Pick<PersistedRepo, 'autoAssign' | 'autoMerge' | 'browserTesting' | 'color' | 'links' | 'mission' | 'summary' | 'qaBrief'>> & { previewCommand?: unknown; previewEnv?: unknown },
  ) {
    this.requireOpen();
    const repo = this.repo(id);
    const preview = parsePreviewPatch(patch.previewCommand, patch.previewEnv);
    repo.preview = { ...repo.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(repo);
    if (patch.autoAssign !== undefined) repo.autoAssign = !!patch.autoAssign;
    if (patch.autoMerge !== undefined) {
      repo.autoMerge = !!patch.autoMerge;
      if (repo.autoMerge) void this.syncRepo(repo.id);
    }
    if (patch.browserTesting !== undefined) repo.browserTesting = !!patch.browserTesting;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) repo.color = patch.color;
    if (Array.isArray(patch.links)) repo.links = patch.links.filter((l) => l !== id && this.state.repos.some((r) => r.id === l));
    if (typeof patch.mission === 'string') repo.mission = patch.mission.trim().slice(0, 4000);
    if (typeof patch.summary === 'string') repo.summary = patch.summary.trim().slice(0, 140);
    if (typeof patch.qaBrief === 'string') repo.qaBrief = patch.qaBrief.trim().slice(0, 2500);
    this.save();
    this.emitRepo(repo);
    this.later(() => this.schedule(), 200);
    return this.repoView(repo);
  }

  // ---------- auto-merge ----------

  /**
   * Auto-merge (floors with it on): a swarm PR merges itself once QA has signed off on its latest commit and GitHub's
   * checks are green. Failing checks and merge conflicts go back to a developer; new commits after QA's sign-off send
   * it back to QA. Merging deletes the remote branch, and the floor's folder then fast-forwards (syncRepo sees the merge).
   */
  private async advanceMerges(repo: PersistedRepo) {
    if (this.closed) return;
    const rt = this.repoRt.get(repo.id);
    if (!rt || !repo.autoMerge || rt.merging) return;
    rt.merging = true;
    let merged = false;
    try {
      for (const rec of this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'passed')) {
        if (this.closed) return;
        const pr = rt.pulls.find((p) => p.number === rec.prNumber && p.state === 'OPEN');
        if (!pr || !pr.headRefName.startsWith('swarm/')) continue; // people's own PRs are theirs to merge
        // Only act on PR data fetched after the record last changed (a fix may have just pushed).
        if ((rt.fetchedAt ?? 0) < rec.updatedAt) continue;
        try {
          if (await this.advanceMerge(repo, rec, pr)) merged = true;
        } catch (err) {
          console.warn(`auto-merge of ${repo.fullName}#${pr.number} failed`, err);
          this.mergeNote(rec, `auto-merge hit a problem: ${oneLine(err)}`);
        }
      }
    } finally {
      rt.merging = false;
    }
    if (merged) {
      await this.syncRepo(repo.id);
      this.later(() => this.schedule(), 200);
    }
  }

  /** One step toward merging a QA-passed PR. Returns true when it merged. */
  private async advanceMerge(repo: PersistedRepo, rec: QaRecord, pr: PullInfo, preferredMethod?: 'squash' | 'merge' | 'rebase'): Promise<boolean> {
    if (this.closed) return false;
    if(!this.taskQaCurrent(repo,rec))return false;
    let dlpViolations: DlpPolicyViolation[] = [];
    try {
      const files = await this.backend.prFiles(repo.fullName, pr.number, pr.headSha);
      if (this.closed) return false;
      if (!this.state.qa.includes(rec) || rec.status !== 'passed') return false;
      dlpViolations = files.flatMap((file) => auditDlpCompliance(file.content, file.file));
    } catch (err) {
      if (this.closed) return false;
      console.warn(`DLP scan failed for ${repo.fullName}#${pr.number}`, err);
      return this.mergeNote(rec, 'DLP scan unavailable; waiting to retry before merging');
    }
    let step = mergeStep({ ...pr, dlpViolations }, rec, Date.now(), { base: repo.defaultBranch });
    if (step.do === 'details') {
      // GitHub works mergeability out lazily and lists often say UNKNOWN; asking about the PR itself gets an answer.
      const d = await this.backend.prDetails(repo.fullName, pr.number);
      if (this.closed) return false;
      if (!this.state.qa.includes(rec) || rec.status !== 'passed') return false;
      if (d.state !== 'OPEN') return this.mergeNote(rec, 'Pull request is no longer open; refresh its state before merging');
      if (d.headSha !== pr.headSha) {
        // Cached checks and scanned files belong to the earlier head, even if
        // another QA record already names the new head. Never mix observations.
        this.setQa(rec, {status: 'queued', passedSha: null, testedSha: null, round: rec.round + 1, retests: rec.retests + 1,
          mergeNote: 'PR head changed during merge verification; QA and checks must refresh'});
        this.later(() => this.schedule(), 200);
        return false;
      }
      pr = { ...pr, headSha: d.headSha, mergeable: d.mergeable, mergeState: d.mergeState };
      step = mergeStep({ ...pr, dlpViolations }, rec, Date.now(), { base: repo.defaultBranch, detailed: true });
    }
    Object.assign(rec, step.set);
    if (step.do === 'requeue') {
      // Commits arrived after QA's sign-off: they get tested too.
      this.setQa(rec, { status: 'queued', passedSha: null, testedSha: null, round: rec.round + 1, retests: rec.retests + 1, mergeNote: null, pendingSince: null });
      this.later(() => this.schedule(), 200);
      return false;
    }
    if (step.do === 'send-back') {
      if (preferredMethod) return this.mergeNote(rec, `Merge blocked (${step.reason}): ${step.instructions}`);
      return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
    }
    if (step.do === 'wait') {
      if (step.alert) {
        this.postMessage('office', `⏳ PR #${pr.number} on ${repo.fullName} passed QA, but its checks (${pr.pendingChecks.join(', ')}) have been running for over ${CHECKS_ALERT_MS / 60_000} minutes. It merges as soon as they finish.`);
      }
      return step.note === undefined ? false : this.mergeNote(rec, step.note);
    }
    if(!this.taskQaCurrent(repo,rec))return false;
    if (step.do === 'update-branch') {
      if (preferredMethod) return this.mergeNote(rec, 'Branch is behind the base; update it and obtain fresh QA approval before merging');
      // The repo only merges up-to-date branches. GitHub merges the base in cleanly (or refuses); CI checks the result.
      this.mergeNote(rec, `updating the branch with ${repo.defaultBranch}`);
      await this.backend.updateBranch(repo.fullName, pr.number);
      this.setQa(rec, { status: 'queued', passedSha: null, testedSha: null, round: rec.round + 1, retests: rec.retests + 1,
        mergeNote: 'Branch updated; QA must test the new head', pendingSince: null });
      this.later(() => this.schedule(), 200);
      return false;
    }
    if (step.do !== 'merge') return false;
    this.mergeNote(rec, 'merging…');
    let error = '';
    for (const method of preferredMethod ? [preferredMethod] : ['squash', 'merge', 'rebase'] as const) {
      if (this.closed) return false;
      if(!this.taskQaCurrent(repo,rec))return false;
      try {
        await this.backend.mergePull(repo.fullName, pr.number, method, rec.passedSha!);
        error = '';
        break;
      } catch (err) {
        error = oneLine(err).replace(/^gh .*? failed: /, '');
        if (!/not allowed/i.test(error)) break; // only a merge method the repo turned off is worth another try
      }
    }
    if (error && /head (branch|commit)/i.test(error)) return this.mergeNote(rec, 'new commits arrived; QA checks them first'); // the next sync re-queues it
    if (error) {
      rec.mergeRetryAt = Date.now() + MERGE_RETRY_MS;
      if (!rec.alerted) {
        rec.alerted = true;
        this.postMessage('office', `⚠️ PR #${pr.number} on ${repo.fullName} passed QA and its checks, but GitHub won't merge it: ${error}. The office retries every ${MERGE_RETRY_MS / 60_000} minutes; merge it yourself, or change the repo's merge rules, if it keeps failing.`);
      }
      return this.mergeNote(rec, `merge blocked: ${error}`);
    }
    this.toast('success', `🔀 Merged PR #${pr.number} into ${repo.defaultBranch}: ${pr.title}`);
    await this.acceptMergedTask(repo,rec,pr);
    return true;
  }
  private taskQaCurrent(repo:PersistedRepo,rec:QaRecord){
    if(this.backend.demo)return true;
    try{
      const issue=rec.issueNumber??0,contract=this.deliveryTaskContract(repo.id,issue);if(!contract)return true;
      this.deliveryWorkGate(repo.id,issue);
      if(rec.qaAgentId===contract.qaOwner&&rec.taskAuthorityHash===this.deliveryTaskFingerprint(repo.id,issue))return true;
    }catch{/* Missing current scope cannot authorize an old QA pass. */}
    this.setQa(rec,{status:'queued',passedSha:null,testedSha:null,mergeNote:'Task scope or authority changed; fresh independent QA required'});return false;
  }
  private async acceptMergedTask(repo:PersistedRepo,rec:QaRecord,pr:Pick<PullInfo,'number'|'headSha'>){
    const issue=rec.issueNumber??0;if(this.backend.demo||!this.deliveryTaskContract(repo.id,issue))return true;
    try{
      if(!rec.passedSha||rec.passedSha!==pr.headSha||!rec.qaAgentId||!rec.taskAuthorityHash)throw new Error('Exact scoped QA evidence is missing');
      await this.deliveryTaskComplete(repo.id,issue,{prNumber:pr.number,headSha:pr.headSha,reviewer:rec.qaAgentId,taskAuthorityHash:rec.taskAuthorityHash,evidenceHash:crypto.createHash('sha256').update(JSON.stringify({pr:pr.number,head:rec.passedSha,reviewer:rec.qaAgentId,summary:rec.summary,checks:rec.checks,commentUrl:rec.commentUrl})).digest('hex')});
      return true;
    }catch{this.mergeNote(rec,'Merged task acceptance is blocked; reconcile scoped QA evidence before dependent work');return false;}
  }

  /** Show where auto-merge stands on a PR's card. Doesn't count as a change to the record. */
  private mergeNote(rec: QaRecord, text: string | null) {
    if (rec.mergeNote !== text) {
      rec.mergeNote = text;
      this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    }
    return false;
  }

  /** QA passed, but the PR can't merge as it is: a developer fixes it, and QA re-tests if the code changed. */
  private sendBack(repo: PersistedRepo, rec: QaRecord, reason: 'checks' | 'conflict' | 'dlp', fixInstructions: string, needsHuman: boolean) {
    if (needsHuman) {
      this.setQa(rec, { status: 'needs-human', mergeNote: null });
      const desc = reason === 'conflict' ? `conflicts with ${repo.defaultBranch}` : reason === 'dlp' ? 'violates enterprise DLP policy' : 'fails its checks';
      this.postMessage('office', `⚠️ PR #${rec.prNumber} on ${repo.fullName} still ${desc} after ${MAX_MERGE_FIXES} fixes, so it needs you.`);
      return false;
    }
    this.setQa(rec, { status: 'failed', fixReason: reason, fixInstructions, mergeFixes: rec.mergeFixes + 1, mergeNote: null, pendingSince: null });
    this.later(() => this.schedule(), 200);
    return false;
  }

  /** Fast-forward the floor's main checkout (usually your own project folder) and report how it stands. */
  private async syncFolder(repo: PersistedRepo) {
    if (this.closed) return null;
    const rt = this.repoRt.get(repo.id);
    if (!rt || rt.cloneStatus !== 'ready') return rt?.folderSync ?? null;
    const own = this.backend.office.isOwnFolder(this.backend.mainDir(repo.fullName)); // updating the running office restarts it mid-work
    const sync = await this.backend.syncMain(repo.fullName, repo.defaultBranch, { touch: !own }).catch((err) => ({ status: `sync failed: ${oneLine(err)}`, behind: 0, updatable: false }));
    if (this.closed) return null;
    const status = sync?.status ?? null;
    if (own && sync) this.setOfficeBehind(sync.updatable ? sync.behind : 0);
    if (!this.repoRt.has(repo.id)) return null;
    const before = rt.folderSync;
    rt.folderSync = status;
    this.emitRepo(repo);
    if (status && status !== before) {
      const name = repo.localPath ? path.basename(repo.localPath) : repo.fullName;
      if (status.startsWith('updated')) this.toast('success', `📁 ${name}: ${status}`);
      else if (/behind|diverged|failed/.test(status)) this.toast('info', `📁 ${name} wasn't updated: ${status}`);
    }
    return status;
  }

  /** The manager's "Sync now". */
  async syncFolderNow(repoId: string) {
    this.requireOpen();
    const folderSync = await this.syncFolder(this.repo(repoId));
    this.requireOpen();
    return { folderSync };
  }

  // ---------- the floor's app (preview monitor) ----------

  /** Run the floor's app from its preview worktree: the default branch, or an open PR. Replaces what it is running now. */
  async startPreview(id: string, pr?: number | null): Promise<PreviewView> {
    this.requireOpen();
    const repo = this.repo(id);
    return this.previews.start(repo, `${repo.fullName.split('/')[1]} app`, pr);
  }

  stopPreview(id: string): Promise<PreviewView> {
    this.requireOpen();
    return this.previews.stop(this.repo(id));
  }

  /**
   * Server shutdown: stop every floor's app so nothing is left holding a preview port. Agents' CLIs keep working
   * through a restart (the terminal keeper holds them for the next start) and stop when the office quits.
   */
  shutdown(restart = false): Promise<void> {
    if (this.shutdownWork) return this.shutdownWork;
    for(const agent of this.state.agents)this.endExecution(agent,'interrupted');
    this.closed = true;
    this.lifecycleStop.abort();
    for (const timer of this.lifecycleTimers) clearTimeout(timer);
    this.lifecycleTimers.clear();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.saveTimer = this.flushTimer = null;
    const errors: unknown[] = [];
    // Close the preview admission gate synchronously, before any save/release awaits.
    const previewStop = this.stateLoaded ? this.previews.close(this.state.repos).catch(error => { errors.push(error); }) : Promise.resolve();
    this.shutdownWork = (async () => {
      if (!this.stateLoaded) return;
      // SDK work cannot survive this process. Keep its recovery checkpoint and
      // ignore completion callbacks; retained terminal CLIs belong to the keeper.
      for (const rt of this.agentRt.values()) if (!restart || !rt.terminal) {
        try { rt.session?.stop(); } catch (error) { errors.push(error); }
      }
      try { await this.writeState(); } catch (error) { errors.push(error); }
      try { await this.backend.releaseClis(restart); } catch (error) { errors.push(error); }
      try { await this.saveTerminals(true); } catch (error) { errors.push(error); }
      await previewStop;
      if (errors.length) throw new AggregateError(errors, 'Office shutdown did not complete cleanly');
    })();
    return this.shutdownWork;
  }

  private async cloneRepo(id: string) {
    if (this.closed) return;
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.cloneStatus === 'cloning') return;
    rt.cloneStatus = 'cloning';
    rt.cloneError = undefined;
    this.emitRepo(repo);
    try {
      await this.backend.ensureClone(repo.fullName);
      if (this.closed) return;
      rt.cloneStatus = 'ready';
      void this.previews.refreshDefault(repo);
    } catch (err) {
      rt.cloneStatus = 'error';
      rt.cloneError = (err as Error).message;
      this.toast('error', `Could not clone ${repo.fullName}: ${rt.cloneError}`);
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  async syncRepo(id: string) {
    if (this.closed) return;
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.syncing) return;
    rt.syncing = true;
    try {
      const started = Date.now();
      const [issues, pulls] = await Promise.all([this.backend.listIssues(repo.fullName), this.backend.listPulls(repo.fullName)]);
      if (this.closed) return;
      rt.issues = issues;
      rt.pulls = pulls;
      rt.lastSync = Date.now();
      rt.fetchedAt = started;
      rt.syncError = undefined;
      this.reconcilePulls(repo, pulls);
      // Something was merged since the last look (by the office or anyone else): bring the folder up to date.
      const newest = pulls.reduce<string | null>((m, p) => (p.mergedAt && (!m || p.mergedAt > m) ? p.mergedAt : m), null);
      if (newest !== rt.lastMergedAt) {
        rt.lastMergedAt = newest;
        void this.syncFolder(repo);
      }
      void this.advanceMerges(repo);
    } catch (err) {
      rt.syncError = (err as Error).message;
    } finally {
      rt.syncing = false;
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  /** Keep agents and QA records in step with what happened to PRs on GitHub. */
  private reconcilePulls(repo: PersistedRepo, pulls: PullInfo[]) {
    for (const a of this.state.agents) {
      if (a.repoId !== repo.id || a.role !== 'dev' || a.prNumber == null || BUSY.includes(a.status) || a.status === 'idle') continue;
      const pr = pulls.find((p) => p.number === a.prNumber);
      if (!pr || pr.state === 'OPEN') continue;
      if (a.task === 'qa') {
        this.clearTask(a); // they only tested it
        continue;
      }
      this.appendLog(a, [{ kind: 'done', text: pr.state === 'MERGED' ? `🎉 PR #${pr.number} was merged. Ready for the next issue.` : `PR #${pr.number} was closed without merging.` }]);
      this.clearTask(a);
    }

    // Finished PRs leave QA.
    for (const q of this.state.qa.filter((x) => x.repoId === repo.id)) {
      const pr = pulls.find((p) => p.number === q.prNumber);
      if (pr && pr.state !== 'OPEN' && q.status !== 'testing' && q.status !== 'fixing') {
        if(pr.state==='MERGED'&&this.deliveryTaskContract(repo.id,q.issueNumber??0)){
          if(!this.taskAcceptancePending.has(q)){
            this.taskAcceptancePending.add(q);
            void this.acceptMergedTask(repo,q,pr).then(accepted=>{
              if(!accepted||this.closed||!this.state.qa.includes(q))return;
              this.state.qa=this.state.qa.filter(row=>row!==q);this.broadcast({type:'qaRemoved',repoId:repo.id,prNumber:q.prNumber});this.save();
            }).finally(()=>this.taskAcceptancePending.delete(q));
          }
          continue;
        }
        this.state.qa = this.state.qa.filter((x) => x !== q);
        this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber: q.prNumber });
      }
    }

    // Every swarm PR goes through QA, including ones opened before QA existed or while the server was down.
    for (const pr of pulls) {
      if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith('swarm/')) continue;
      if (this.state.qa.some((q) => q.repoId === repo.id && q.prNumber === pr.number)) continue;
      const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
      this.queueQa(repo, pr.number, dev ?? null, pr.closesIssues[0] ?? null);
    }
    this.save();
  }

  async createIssue(repoId: string, title: string, body: string, assignTo?: string, specialty?: string) {
    this.requireOpen();
    const repo = this.repo(repoId);
    if (!title.trim()) throw new HttpError(400, 'An issue needs a title');
    const slug = specialtySlug(specialty);
    const number = await this.backend.createIssue(repo.fullName, title.trim(), body, slug ? [specialtyLabel(slug)] : []);
    this.requireOpen();
    await this.syncRepo(repo.id);
    this.requireOpen();
    this.toast('success', `Issue #${number} filed on ${repo.fullName}`);
    if (assignTo) await this.assign(assignTo, number);
    else this.later(() => this.schedule(), 200);
    return number;
  }

  async mergePull(repoId: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    this.requireOpen();
    if (!['squash', 'merge', 'rebase'].includes(method)) throw new HttpError(400, 'Invalid merge method');
    const repo = this.repo(repoId);
    const rt = this.repoRt.get(repo.id)!;
    if (rt.merging || rt.syncing) throw new HttpError(409, 'PR verification is already running; retry after it finishes');
    rt.merging = true; // the refresh cannot dispatch a competing automatic merge
    try {
      await this.syncRepo(repo.id);
      if (this.closed || rt.syncError) throw new HttpError(409, 'Fresh PR verification is unavailable');
      const pr = rt.pulls.find(pull => pull.number === number && pull.state === 'OPEN');
      if (!pr) throw new HttpError(404, `PR #${number} is not open on ${repo.fullName}`);
      const rec = this.state.qa.find(record => record.repoId === repo.id && record.prNumber === number);
      if (!rec || rec.status !== 'passed' || !rec.passedSha) throw new HttpError(409, 'A commit-bound QA approval is required before merging');
      if (!await this.advanceMerge(repo, rec, pr, method)) throw new HttpError(409, rec.mergeNote || 'QA, checks or scan evidence does not permit merging');
    } finally { rt.merging = false; }
    await this.syncRepo(repo.id);
    this.later(() => this.schedule(), 200);
  }

  /** Recheck the original office QA record and live GitHub merge before an
   * independent reviewer can reconcile that acceptance to refreshed evidence. */
  async verifyAcceptedTask(repoId:string,issue:number,source:DeliveryRecord,receipt:NonNullable<DeliveryRecord['taskAcceptances']>[number],originalQa?:import('./taskReconciliation.ts').OriginalTaskQa) {
    this.requireOpen();if(this.backend.demo)throw new HttpError(409,'Demo cannot reconcile accepted live work');
    const repo=this.repo(repoId),qa=this.state.qa.find(q=>q.repoId===repoId&&q.prNumber===receipt.prNumber);
    const proof=qa??originalQa;
    assertOriginalTaskQa(source,receipt,issue,proof);
    const fingerprint=JSON.stringify(qa);
    const pr=await this.backend.prDetails(repo.fullName,receipt.prNumber);this.requireOpen();
    if(this.state.qa.find(q=>q.repoId===repoId&&q.prNumber===receipt.prNumber)!==qa||JSON.stringify(qa)!==fingerprint)throw new HttpError(409,'Original QA evidence changed during verification');
    if(mergedTaskEvidence(pr,issue,receipt.headSha,repo.defaultBranch).mergeCommitSha!==receipt.mergeCommitSha)throw new HttpError(409,'Original merged source no longer matches');
    const {prNumber,status,issueNumber,passedSha,qaAgentId,commentUrl,summary,checks,taskAuthorityHash}=proof!;
    return structuredClone({prNumber,status,issueNumber,passedSha,qaAgentId,commentUrl,summary,checks,taskAuthorityHash});
  }

  async closePull(repoId: string, number: number) {
    this.requireOpen();
    const repo = this.repo(repoId);
    await this.backend.closePull(repo.fullName, number);
    this.requireOpen();
    await this.syncRepo(repo.id);
    this.requireOpen();
  }

  // ---------- agents ----------

  hireAgent(
    repoId: string,
    opts: {
      name?: string;
      model?: string;
      effort?: string;
      role?: string;
      look?: string;
      title?: string;
      specialty?: string;
      brief?: string;
      cli?: string;
      hiredBy?: 'manager' | 'ceo';
      appearance?: { color: string; hair: string; skin: string };
    },
  ) {
    this.requireOpen();
    if(opts.cli!==undefined&&opts.cli!==''&&!isCli(opts.cli))throw new HttpError(400,'Only Codex, Gemini and OpenCode are permitted');
    const modelError=this.configuredModelError((opts.cli||this.state.settings.defaultCli) as AgentCli,opts.model===undefined?'':opts.model);if(modelError)throw new HttpError(400,modelError);
    const repo = this.repo(repoId);
    const role: AgentRole = opts.role === 'qa' ? 'qa' : 'dev';
    const used = new Set(this.state.agents.filter((a) => a.repoId === repo.id && a.role === role).map((a) => a.desk));
    let desk = 0;
    while (used.has(desk)) desk++;
    if (desk >= MAX_DESKS[role]) {
      throw new HttpError(400, role === 'qa' ? `The QA lab on floor ${repo.floor} is full (${MAX_DESKS.qa} stations)` : `Floor ${repo.floor} is full (${MAX_DESKS.dev} desks)`);
    }
    const name = opts.name?.trim() || this.freeName(role);
    const agent: PersistedAgent = {
      id: crypto.randomUUID(),
      name,
      repoId: repo.id,
      role,
      title: String(opts.title ?? '').trim().slice(0, 60),
      specialty: specialtySlug(opts.specialty),
      brief: String(opts.brief ?? '').trim().slice(0, 2500),
      hiredBy: opts.hiredBy ?? 'manager',
      look: LOOKS.includes(opts.look as AgentLook) ? (opts.look as AgentLook) : lookFor(name),
      task: null,
      desk,
      color: opts.appearance?.color ?? pick(SHIRTS),
      hair: opts.appearance?.hair ?? pick(HAIR),
      skin: opts.appearance?.skin ?? pick(SKIN),
      model: opts.model ?? '',
      effort: EFFORTS.includes(opts.effort as EffortLevel) ? (opts.effort as EffortLevel) : '',
      cli: isCli(opts.cli) ? opts.cli : '',
      status: 'idle',
      issueNumber: null,
      issueTitle: null,
      branch: null,
      prNumber: null,
      prUrl: null,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      sessionId: null,
      sessionCli: null,
      lastError: null,
      logTail: [],
    };
    this.state.agents.push(agent);
    this.agentRt.set(agent.id, { log: [], pending: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    this.appendLog(agent, [
      { kind: 'system', text: role === 'qa' ? `🔍 ${name} joined the QA lab on floor ${repo.floor} (${repo.fullName}).` : `👋 ${name} joined floor ${repo.floor} (${repo.fullName}).` },
      ...(agent.title ? [{ kind: 'system' as const, text: `🪪 ${agent.title}${agent.specialty ? ` · takes swarm:${agent.specialty} issues first` : ''}` }] : []),
    ]);
    this.save();
    this.broadcast({ type: 'agent', agent: this.agentView(agent, false) });
    this.later(() => this.schedule(), 200);
    return this.agentView(agent, true);
  }

  /** Every floor has at least one QA tester. */
  private ensureQaTester(repo: PersistedRepo) {
    if (this.state.agents.some((a) => a.repoId === repo.id && a.role === 'qa')) return;
    const configurationError=this.configuredModelError(this.state.settings.defaultCli,'');
    if(configurationError){this.postMessage('office',`QA setup for ${repo.fullName} is waiting for coding-agent configuration: ${configurationError}`);return;}
    this.hireAgent(repo.id, { role: 'qa' });
  }

  /** A name from the role's pool that no agent or pending candidate has. */
  private freeName(role: 'dev' | 'qa') {
    const taken = new Set([...this.state.agents.map((a) => a.name), ...this.state.requests.filter((r) => r.status === 'pending').map((r) => r.name)]);
    const pool = role === 'qa' ? QA_NAMES : DEV_NAMES;
    return pool.find((n) => !taken.has(n)) || `${role === 'qa' ? 'Tester' : 'Agent'} ${this.state.agents.length + 1}`;
  }

  updateAgent(
    id: string,
    patch: { name?: string; model?: string; effort?: string; cli?: string; look?: string; title?: string; specialty?: string; brief?: string; color?: string; hair?: string },
  ) {
    this.requireOpen();
    const a = this.agent(id);
    if(patch.cli!==undefined&&patch.cli!==''&&!isCli(patch.cli))throw new HttpError(400,'Unsupported coding runtime');
    const selectedCli=patch.cli===undefined?a.cli:patch.cli;
    const cli=a.role==='ceo'?(isCli(selectedCli)?selectedCli:'codex'):((selectedCli||this.state.settings.defaultCli) as AgentCli);
    const modelError=this.configuredModelError(cli,patch.model===undefined?a.model:patch.model,a.role==='ceo');if(modelError)throw new HttpError(400,modelError);
    if (patch.cli !== undefined) a.cli = isCli(patch.cli) ? patch.cli : '';
    if (patch.name?.trim() && patch.name.trim() !== a.name) {
      a.name = patch.name.trim().slice(0, 24);
      a.look = lookFor(a.name);
    }
    if (LOOKS.includes(patch.look as AgentLook)) a.look = patch.look as AgentLook;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color;
    if (patch.hair && /^#[0-9a-f]{6}$/i.test(patch.hair)) a.hair = patch.hair;
    if (patch.model !== undefined) a.model = String(patch.model).trim();
    if (patch.effort !== undefined) a.effort = EFFORTS.includes(patch.effort as EffortLevel) ? (patch.effort as EffortLevel) : '';
    if(a.role==='ceo'){
      const c=this.state.ceo;
      if(c.modelBlock&&c.modelBlock.fingerprint!==this.ceoModelFingerprint(a.model||CEO_MODEL,this.ceoCli(a))){
        if(c.blockedReason===c.modelBlock.reason)c.blockedReason=null;
        c.modelBlock=null;c.retryAt=null;
        this.later(()=>this.schedule(),200);
      }
      if(a.status==='error'&&!c.modelBlock){a.status='idle';a.lastError=null;}
      this.emitCeo();
    }
    if (a.role !== 'ceo') {
      this.workerModelHold(a,(a.cli||this.state.settings.defaultCli) as AgentCli);
      if (patch.title !== undefined) a.title = String(patch.title).trim().slice(0, 60);
      if (patch.specialty !== undefined) a.specialty = specialtySlug(patch.specialty);
      if (patch.brief !== undefined) a.brief = String(patch.brief).trim().slice(0, 2500);
    }
    this.save();
    this.emitAgent(a);
  }

  fireAgent(id: string, force = false) {
    this.requireOpen();
    const a = this.agent(id);
    if (a.role === 'ceo') throw new HttpError(409, `${a.name} runs the company and can't be let go.`);
    if (!force && a.role === 'qa' && this.state.agents.filter((x) => x.repoId === a.repoId && x.role === 'qa').length <= 1) {
      throw new HttpError(409, `${a.name} is the only QA tester on this floor, and every floor needs at least one.`);
    }
    this.reserveTask(a);
    for (const r of this.state.requests.filter((x) => x.kind === 'let-go' && x.agentId === id && x.status === 'pending')) {
      this.decide(r, { status: 'approved', note: 'They were let go directly.', decidedBy: 'manager' });
    }

    this.agentRt.get(id)?.session?.stop();
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.agentRt.get(id)?.terminal?.dispose();
    void removeScreens(id);
    void fs.rm(terminalFile(id), { force: true }).catch(() => undefined);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id) q.devAgentId = null;
      if (q.devAgentId === null && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (repo) {
      const slug = this.agentSlug(a);
      void this.backend
        .releaseDesk(repo.fullName, slug, this.port(a))
        .then(() => this.backend.removeDesk(repo.fullName, slug))
        .catch(() => undefined);
    }
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    this.agentRt.delete(id);
    this.save();
    this.broadcast({ type: 'agentRemoved', agentId: id });
  }

  stopAgent(id: string) {
    this.requireOpen();
    const a = this.agent(id);
    if (!BUSY.includes(a.status)&&!(a.role==='ceo'&&this.state.ceo.recoveryHold)) return;
    const stoppedSession = this.agentRt.get(id)?.session;
    if(a.role==='ceo'&&this.state.ceo.recoveryHold){
      this.agentRt.get(id)?.terminal?.releaseIdle?.();
      a.sessionId=null;a.sessionCli=null;
    }
    if (a.role !== 'ceo') {
      const repo = this.state.repos.find(r => r.id === a.repoId);
      const slug = this.agentSlug(a);
      if (repo) void this.deskOperation(a, () => this.backend.releaseDesk(repo.fullName, slug, this.port(a))).catch(err => console.warn('could not release stopped task workspace', err));
    }
    this.reserveTask(a);
    const runtime = this.agentRt.get(id);
    if (runtime) {runtime.session = null; runtime.currentTool = null;}
    if (a.role !== 'ceo') for (const record of this.state.qa) {
      if (record.qaAgentId === id && record.status === 'testing') this.setQa(record, {status: 'queued', qaAgentId: null, testedSha: null, passedSha: null});
      if (record.devAgentId === id && record.status === 'fixing') this.setQa(record, {status: 'failed'});
    }
    a.status = 'stopped';
    a.endedAt = Date.now();
    a.lastError = 'Stopped by manager';
    if (a.role === 'ceo') {
      Object.assign(this.state.ceo, {job: null, blockedReason: null, retryAt: null,recoveryHold:false});
      this.emitCeo();
    }
    this.appendLog(a, [{ kind: 'manager', text: '■ Manager stopped this session.' }]);
    stoppedSession?.stop();
    this.emitAgent(a);
    this.save();
  }

  /** An agent whose CLI kept working through the office's restart: the office follows its session again. */
  private async reattachSession(a: PersistedAgent, held: ReconnectedCli) {
    if(a.role==='ceo'){
      const job=this.state.ceo.job;
      if(!job||!held.resumeId||held.agentId!==a.id||held.cli!==this.ceoCli(a)||held.cli!==a.sessionCli||held.resumeId!==a.sessionId){
        this.agentRt.get(a.id)?.terminal?.releaseIdle?.();
        if(job)this.holdRetainedCeo(a,job,'Retained CEO runtime ownership differs; reconcile the submitted outcome before retrying');
        else {a.status='error';a.endedAt=Date.now();a.lastError='Retained CEO lacks its owned job; execution denied';this.emitAgent(a);this.save();}
        return;
      }
      await this.runCeoJob(a,job,held);return;
    }
    const generation = this.reserveTask(a);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    const rt = this.agentRt.get(a.id);
    let blocker: string | null = null;
    let paused = this.taskPaused(a.issueTitle ?? '');
    if (!repo || !rt?.terminal || !this.backend.terminals || held?.agentId !== a.id || !isCli(held?.cli) || !(held.resumeId === null || typeof held.resumeId === 'string' && held.resumeId.length > 0)) blocker = 'Retained CLI identity or terminal context is unavailable';
    else {
      a.sessionId = held.resumeId; a.sessionCli = held.cli;
      a.status = 'preparing';
      if (paused) blocker = 'This platform is paused by the manager';
      else {blocker = await this.sessionReadiness(a, repo, held.resumeId ?? undefined, held.cli);
        if(!blocker)try{await this.verifyTaskInputs(this.backend.deskDir(repo.fullName,this.agentSlug(a)),this.deliveryTaskInputs(repo.id,a.issueNumber??0));}catch(error){blocker=error instanceof Error?error.message:'Prerequisite checkout could not be verified';}
      }
    }
    if (this.closed) return;
    if (!this.ownsTask(a, generation)) {rt?.terminal?.releaseIdle?.(); return;}
    paused = this.taskPaused(a.issueTitle ?? '');
    if (paused) blocker = 'This platform is paused by the manager';
    if (!blocker && (a.status !== 'preparing' || !this.state.agents.includes(a))) blocker = 'Retained task was cancelled during readiness verification';
    if (blocker) {
      rt?.terminal?.releaseIdle?.();
      Object.assign(a, {status: paused || a.status === 'stopped' ? 'stopped' : 'error', endedAt: Date.now(), lastError: blocker});
      const record = this.state.qa.find(q => q.repoId === a.repoId && q.prNumber === a.prNumber);
      if (a.task === 'qa' && record?.status === 'testing') this.setQa(record, {status: 'queued', qaAgentId: null, testedSha: null, passedSha: null});
      if (a.task === 'fix' && record?.status === 'fixing') this.setQa(record, {status: 'failed'});
      this.appendLog(a, [{kind: 'error', text: `Retained CLI quarantined: ${blocker}`}]);
      this.emitAgent(a); this.save(); return;
    }
    this.appendLog(a, [{ kind: 'system', text: '↻ The office restarted; their CLI kept working and the office is following it again.' }]);
    this.startAgentSession(a, repo!, a.task === 'qa' && a.prNumber === null ? this.backend.mainDir(repo!.fullName) : this.backend.deskDir(repo!.fullName, this.agentSlug(a)), '', '', a.sessionId ?? undefined, undefined, 'reattach');
  }

  /** The manager pressed Esc in the agent's terminal and the CLI stopped its turn: a Stop that leaves the CLI to them. */
  private interrupted(a: PersistedAgent) {
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Interrupted in the terminal';
    this.appendLog(a, [{ kind: 'manager', text: '■ Interrupted in the terminal. Type there to carry on.' }]);
  }

  resetAgent(id: string) {
    this.requireOpen();
    const a = this.agent(id);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is busy; stop them first`);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    this.appendLog(a, [{ kind: 'system', text: '↺ Cleared desk. Ready for new work.' }]);
    this.save();
  }

  private issueTaken(repo: PersistedRepo, n: number) {
    if (this.state.agents.some((a) => a.repoId === repo.id && a.role === 'dev' && a.task !== 'qa' && a.issueNumber === n && a.status !== 'idle' && a.status !== 'error')) return true;
    const pulls = this.repoRt.get(repo.id)?.pulls ?? [];
    return pulls.some((p) => p.state === 'OPEN' && (p.closesIssues.includes(n) || p.headRefName.startsWith(`swarm/issue-${n}-`)));
  }

  private ensureSlot() {
    const blocker=this.sessionUsage().blockedReason;if(blocker)throw new HttpError(409,`Session capacity is unverified: ${blocker}`);
    if(this.draining)throw new HttpError(409,'Office is draining; new agent work is paused');
    if (this.slotsFull()) {
      throw new HttpError(429, `All ${this.state.settings.sessionLimit} session slots are busy. Raise or clear the session limit in the manager's console, or wait.`);
    }
  }

  async assign(agentId: string, issueNumber: number, note?: string) {
    this.requireOpen();
    const a = this.agent(agentId);
    const repo = this.repo(a.repoId);
    if (a.role === 'qa') throw new HttpError(400, `${a.name} is a QA tester; they test pull requests rather than issues.`);
    if (a.role === 'ceo') throw new HttpError(400, `${a.name} runs the company; give issues to the developers.`);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is already working on #${a.issueNumber}`);
    this.ensureSlot();
    const issue = this.repoRt.get(repo.id)?.issues.find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `Issue #${issueNumber} is not open on ${repo.fullName}`);
    if(!this.backend.demo)this.deliveryWorkGate(repo.id,issueNumber);
    this.assertTaskAccess(a,repo,issueNumber,false);
    if (this.taskPaused?.(issue.title)) throw new HttpError(409, 'This platform is paused by the manager');
    const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.issueNumber === issueNumber && BUSY.includes(x.status));
    if (holder) throw new HttpError(409, `${holder.name} is already working on #${issueNumber}`);
    void this.runTask(a, repo, issue, note);
    return this.agentView(a, false);
  }

  private port(a: PersistedAgent) {
    return 5200 + (parseInt(a.id.slice(0, 4), 16) % 700);
  }
  private assertTaskAccess(a:PersistedAgent,repo:PersistedRepo,issue:number,qa:boolean){
    if(this.backend.demo)return;
    const contract=this.deliveryTaskContract(repo.id,issue);if(!contract)return;
    if(a.id!==(qa?contract.qaOwner:contract.owner))throw new HttpError(409,`Issue #${issue} is owned by ${qa?contract.qaOwner:contract.owner}; preserve task ownership`);
    if(qa)return;
    for(const other of this.state.agents.filter(other=>other.id!==a.id&&BUSY.includes(other.status)&&other.task!=='qa'&&other.issueNumber)){
      const claim=this.taskClaims.get(other.id),held=claim?.generation===this.taskGeneration(other)?claim:this.deliveryTaskContract(other.repoId,other.issueNumber!);
      if(held&&(other.repoId===repo.id&&held.components.some(key=>contract.components.includes(key))||held.resources.some(key=>contract.resources.includes(key))))throw new HttpError(409,`Issue #${issue} conflicts with ${other.name}'s active component/resource claim; wait for its task to stop or complete`);
    }
  }
  private canAccessTask(a:PersistedAgent,repo:PersistedRepo,issue:number,qa=false){try{this.assertTaskAccess(a,repo,issue,qa);return true;}catch{return false;}}

  private linkedRepos(repo: PersistedRepo) {
    return repo.links.map((id) => this.state.repos.find((r) => r.id === id)).filter((r): r is PersistedRepo => !!r);
  }

  /**
   * The CEO uses their selected terminal CLI (Codex by default); workers use their selected approved runtime. A session can
   * only be resumed by the CLI that made it, so a follow-up stays with that CLI.
   */
  private sessionRuntime(a: PersistedAgent, resume?: string, retainedCli?: AgentCli): { terminal?: AgentTerminal; cli?: AgentCli; label?: string; resumeSessionId?: string } {
    if (resume && !isCli(a.sessionCli)) resume = undefined; // legacy IDs do not establish a runtime owner
    const inTerminal = !!retainedCli || a.role === 'ceo' || (this.state.settings.runtime === 'terminal' && this.backend.terminals);
    let cli: AgentCli = a.role === 'ceo' ? this.ceoCli(a) : retainedCli ?? (a.cli || this.state.settings.defaultCli);
    if (resume && a.sessionCli && a.sessionCli !== cli) {
      if (a.role === 'ceo') resume = undefined;
      else if (inTerminal) cli = a.sessionCli;
      else if (a.sessionCli !== 'claude') resume = undefined;
    }
    if (!inTerminal) return { cli, resumeSessionId: resume };
    const policyError=runtimeModelError(cli,this.modelFor(a,cli));if(policyError)throw new HttpError(409,policyError);
    const what = a.role === 'ceo' ? a.issueTitle : a.task === 'qa' ? `QA · PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : a.issueNumber ? `#${a.issueNumber} ${a.issueTitle ?? ''}` : null;
    return { terminal: this.terminalFor(a), cli, label: `${a.name}${what ? ` · ${what}` : ''}`.slice(0, 80).trim(), resumeSessionId: resume };
  }

  /** Effective worker model, including a compatible office default. */
  private modelFor(a: PersistedAgent, cli: AgentCli | undefined) {
    return effectiveModel(a.model, cli ?? 'codex', this.state.settings, DEFAULT_MODEL);
  }
  private workerModelFingerprint(cli:AgentCli,model:string){return crypto.createHash('sha256').update(JSON.stringify([cli,model])).digest('hex');}
  private workerModelHold(a:PersistedAgent,cli:AgentCli){
    if(!a.modelBlock)return null;
    if(a.modelBlock.fingerprint===this.workerModelFingerprint(cli,this.modelFor(a,cli)))return a.modelBlock.reason;
    delete a.modelBlock;this.save();return null;
  }
  private workerModelBlockedForScheduling(a:PersistedAgent){
    return !!a.modelBlock&&[(a.cli||this.state.settings.defaultCli) as AgentCli,a.sessionCli].some(cli=>!!cli&&a.modelBlock!.fingerprint===this.workerModelFingerprint(cli,this.modelFor(a,cli)));
  }
  private workerPreflightContext(a:PersistedAgent,repo:PersistedRepo,cli:AgentCli){
    try{
    const project=(value:PersistedRepo)=>[value.id,value.fullName,value.localPath,value.defaultBranch,value.targetTenancy];
    return crypto.createHash('sha256').update(JSON.stringify([cli,this.modelFor(a,cli),a.role,project(repo),repo.links.map(id=>{const linked=this.state.repos.find(value=>value.id===id);return linked?project(linked):[id,null];}),this.backend.terminals,this.state.settings.runtime,this.workerAdmissionContext([repo.id,...repo.links])])).digest('hex');
    }catch{return crypto.createHash('sha256').update(JSON.stringify(['unavailable-worker-context',a.id,cli])).digest('hex');}
  }
  private workerPreflightDeferred(a:PersistedAgent,repo:PersistedRepo){
    return [(a.cli||this.state.settings.defaultCli) as AgentCli,a.sessionCli].some(cli=>!!cli&&preflightDeferred(a.preflightRetry,this.workerPreflightContext(a,repo,cli)));
  }
  /** Expose current recovery advice without persisting changes or leaking context fingerprints. */
  private workerRecovery(a:PersistedAgent): AgentView['recovery'] {
    if(a.role==='ceo'||BUSY.includes(a.status))return null;
    if(this.workerModelBlockedForScheduling(a))return {kind:'model',reason:a.modelBlock!.reason,nextAttemptAt:null};
    const repo=this.state.repos.find(row=>row.id===a.repoId),retry=a.preflightRetry;
    if(!repo||!retry)return null;
    const current=[(a.cli||this.state.settings.defaultCli) as AgentCli,a.sessionCli].some(cli=>!!cli&&retry.context===this.workerPreflightContext(a,repo,cli));
    return current?{kind:'preflight',reason:a.lastError||'Readiness checks failed',nextAttemptAt:retry.nextAttemptAt,failures:retry.failures}:null;
  }
  /** Admit the model that dispatch will use; explicit prohibited values cannot hide behind fallback. */
  private configuredModelError(cli:AgentCli,model:string,ceo=false):string|null{
    if(typeof model!=='string')return 'Model must be a string';
    if(!ceo&&typeof this.state.settings.defaultModel!=='string')return 'Default model must be a string';
    const explicit=runtimeModelError(cli,model);if(model.trim()&&explicit)return explicit;
    return runtimeModelError(cli,ceo?model:effectiveModel(model,cli,this.state.settings,DEFAULT_MODEL));
  }

  // ---------- terminals ----------

  private async loadTerminal(agentId: string): Promise<AgentTerminal | null> {
    if (!(await fs.stat(terminalFile(agentId)).catch(() => null))) return null;
    const t = this.newTerminal(agentId);
    await t.load(terminalFile(agentId));
    return t;
  }

  /** The agent's terminal, made the first time they run in the terminal runtime. */
  private terminalFor(a: PersistedAgent): AgentTerminal {
    const rt = this.agentRt.get(a.id)!;
    rt.terminal ??= this.newTerminal(a.id);
    return rt.terminal;
  }

  private newTerminal(agentId: string) {
    const t = new AgentTerminal();
    // Typed at an idle CLI prompt: reserve and check the follow-up before attaching its session.
    t.onIdlePrompt = (text) => {
      void this.message(agentId, text, true).catch(() => undefined);
      return !!this.agentRt.get(agentId)?.session;
    };
    return t;
  }

  private async saveTerminals(all = false) {
    for (const [id, rt] of this.agentRt) {
      if (rt.terminal && (all || rt.terminal.dirty)) await rt.terminal.save(terminalFile(id)).catch((err) => console.warn('could not save a terminal', err));
    }
  }

  /** A browser opened an agent's terminal (/ws/term?agent=<id>). */
  attachTerminal(agentId: string, ws: WebSocket) {
    if (this.closed) { ws.close(1001, 'Office is shutting down'); return; }
    const t = this.agentRt.get(agentId)?.terminal;
    if (!t) return ws.close(4404, 'That agent has no terminal');
    t.attach(ws);
  }

  private buildSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, fixing?: { pr: number; headRef: string }) {
    const linked = this.linkedRepos(repo).map((r) => `- ${r.fullName}: read-only reference clone at ${this.backend.mainDir(r.fullName)}`);
    const push = fixing ? `git push origin HEAD:${fixing.headRef}` : `git push -u origin ${branch}`;
    const stage=a.issueNumber?this.deliveryTaskStage(repo.id,a.issueNumber):undefined;
    const readOnly=stage==='discovery'||stage==='design';
    return [
      `You are ${a.name}, ${a.title ? `the team's ${a.title},` : 'a software engineer'} on an autonomous agent team ("Agent Swarm"). Several teammates work in parallel on other issues of the same repository, each in their own git worktree. Nobody is watching live to answer questions, so make sensible decisions yourself and record assumptions in the PR description. The manager may occasionally send you messages; follow their instructions.`,
      `Every pull request is reviewed and tested by a QA teammate. ${repo.autoMerge ? "Once they sign off and GitHub's checks pass, the office merges it by itself" : 'Once they sign off, the manager merges it'}. If they find problems, or checks fail, or it conflicts with the default branch, you will get the details; fix them on the same branch.`,
      readOnly?'Read the shared delivery_record and applicable installed guidance. Collect only read-only observations; record sources, hashes, freshness, unresolved facts and owners. Installation does not prove tool or tenant readiness. Independent review is required before any implementation. Do not resume paused platforms.':DELIVERY_ENGINEERING,
      this.deliveryRecordContext(repo.id),
      this.deliveryTaskContext(repo.id,a.issueNumber??0),
      deliveryCapabilitiesPrompt([a.brief, repo.summary, repo.mission].filter(Boolean).join('\n')),
      a.brief ? `\nYour job description:\n${a.brief}` : '',
      '',
      `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
      repo.summary ? `Project: ${repo.summary}` : '',
      repo.mission ? `What the team is building (the manager's brief): ${repo.mission}` : '',
      repo.targetTenancy
        ? [
            'Target Tenancy & Microsoft Power Platform Environment:',
            `- Tenant Name: ${repo.targetTenancy.tenantName} (${repo.targetTenancy.tenantDomain})`,
            `- Tenant ID: ${repo.targetTenancy.tenantId}`,
            `- Target Environment URL: ${repo.targetTenancy.environmentUrl}`,
            `- Authenticated User / Owner: ${repo.targetTenancy.user}`,
            'CRITICAL TENANCY RULE: All solution components, connection references, XML/YAML schemas, seed data, and documentation must align directly to this real tenancy (@' +
              repo.targetTenancy.tenantDomain +
              '). Never use generic contoso.com placeholders.',
          ].join('\n')
        : '',
      `Your worktree: ${cwd}`,
      readOnly&&fixing
        ? `You are reviewing findings for legacy PR #${fixing.pr} in read-only context. Record remaining evidence/design issues through delivery_record; do not push fixes or modify the branch.`
        : fixing
        ? `You are fixing pull request #${fixing.pr}. Its code is checked out on local branch ${branch}; push fixes with: ${push}. Do not open a new pull request.`
        : `Your branch: ${branch} (already checked out, created from origin/${repo.defaultBranch})`,
      linked.length ? `Related repositories you may read for context (do not modify them):\n${linked.join('\n')}` : '',
      '',
      'Workflow:',
      '1. Read the issue and explore the relevant code before changing anything.',
      readOnly ? `2. This is a ${stage} task. Gather read-only evidence and document findings/design through delivery_record and its office-owned evidence/design operations; do not implement application code, run shell commands, author platform components or deploy. Report remaining decisions and blockers for independent review. No PR is required for record-only discovery. Never include credentials or sign-in state. Do not describe assumptions as observed facts.` : '2. Implement the change with focused commits and clear messages.',
      readOnly?'3. Use scoped office discovery and approved read tools. If a required read is unavailable, record the blocker and owner rather than attempting a shell workaround.':"3. Run the project's existing tests, linters and build (if any) and fix what you broke. Install dependencies first if needed.",
      readOnly?'4. Finish with the recorded findings, unanswered questions and evidence references. Discovery completion grants no implementation or release approval.':repo.browserTesting
        ? `4. If the project has a web UI, start its dev server in the background on port ${this.port(a)} (reserved for you, so you don't collide with teammates), then check your change with the Playwright browser tools (mcp__playwright__browser_navigate, browser_snapshot, browser_click, browser_take_screenshot). Stop the dev server when you're done.`
        : '4. Verify the behaviour you changed as directly as you can.',
      readOnly?'':`5. Push: ${push}`,
      readOnly?'':fixing
        ? '6. Reply with a short summary of what you fixed.'
        : `6. Open a pull request with the GitHub CLI: gh pr create --base ${repo.defaultBranch} --head ${branch} --title "<concise title>" --body "<what changed, how you verified it, assumptions>". The body must contain "Closes #<issue number>".`,
      readOnly||fixing ? '' : '7. End your final message with the pull request URL on its own line.',
      '',
      readOnly?'Rules: preserve source, credentials and tenant state. Use office-owned evidence/design operations only; do not commit, push, create PRs or run project commands. Independent review and issue disposition remain required.':'Rules: never push to the default branch, never force-push, never merge pull requests yourself (the office merges them once QA and the checks pass), and never edit files outside your worktree. If you cannot finish, open a draft PR (gh pr create --draft) explaining what is left and why.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  private beginTask(a: PersistedAgent, patch: Partial<PersistedAgent>, banner: string, preparing: string) {
    const generation = this.reserveTask(a);
    const rt = this.agentRt.get(a.id)!;
    Object.assign(a, {
      status: 'preparing' as AgentStatus,
      startedAt: Date.now(),
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      ...patch,
    });
    try{const repo=this.state.repos.find(r=>r.id===a.repoId);if(repo)this.trackExecution(a,repo);}catch(error){a.status='error';a.lastError=error instanceof Error?error.message:'Execution telemetry unavailable';}
    if(!this.backend.demo&&a.task!=='qa'&&a.issueNumber){
      try{const contract=this.deliveryTaskContract(a.repoId,a.issueNumber);if(contract)this.taskClaims.set(a.id,{generation,repoId:a.repoId,issue:a.issueNumber,components:[...contract.components],resources:[...contract.resources]});}catch{/* Readiness denies unavailable contracts before launch. */}
    }
    rt.screenshot = null;
    rt.browserUrl = null;
    rt.shots = [];
    void removeScreens(a.id);
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${banner} ━━━` },
      { kind: 'system', text: preparing },
    ]);
    this.emitAgent(a);
    this.save();
    return generation;
  }

  private async prepare(a: PersistedAgent, repo: PersistedRepo, base: { pr?: number }, branch: string, generation = this.taskGeneration(a)): Promise<string | null> {
    const active = () => this.ownsTask(a, generation) && a.status === 'preparing' && this.validWorkerAdmission(a, repo);
    const slug = this.agentSlug(a);
    return this.deskOperation(a, async () => {
    try {
      if (!active()) return null;
      if (this.repoRt.get(repo.id)?.cloneStatus !== 'ready') await this.cloneRepo(repo.id);
      if (!active()) return null;
      await this.backend.releaseDesk(repo.fullName, slug, this.port(a));
      if (!active()) return null;
      const cwd = await this.backend.prepareDesk(repo.fullName, { defaultBranch: repo.defaultBranch, pr: base.pr }, slug, branch);
      if(!active())return null;
      await this.verifyTaskInputs(cwd,this.deliveryTaskInputs(repo.id,a.issueNumber??0));
      return active() ? cwd : null;
    } catch (err) {
      if (!active()) return null;
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.emitAgent(a);
      this.save();
      return null;
    }
    });
  }

  private workerContext(a: PersistedAgent, repo: PersistedRepo, resume?: string, retainedCli?: AgentCli, checkpointCli = a.sessionCli) {
    const project = (r: PersistedRepo) => [r.id, r.fullName, r.localPath, r.defaultBranch, r.targetTenancy, r.browserTesting, r.mission, r.summary, r.qaBrief];
    try {
    return JSON.stringify([
      this.state.repos.includes(repo), this.state.agents.includes(a), project(repo),
      repo.links.map(id => { const linked = this.state.repos.find(r => r.id === id); return linked ? project(linked) : [id, null]; }),
      a.repoId, a.name, a.role, a.cli, checkpointCli, a.model, a.effort, a.brief,
      this.state.settings.runtime, this.state.settings.defaultCli, this.state.settings.defaultModel, this.state.settings.defaultEffort,
      this.backend.terminals, resume, retainedCli, this.taskPaused(a.issueTitle ?? ''),
      this.workerAdmissionContext([repo.id, ...repo.links]),
      a.issueNumber ? this.deliveryTaskFingerprint(repo.id,a.issueNumber) : null,
    ]);
    } catch { return null; }
  }

  private validWorkerAdmission(a: PersistedAgent, repo: PersistedRepo, continuation?: {resume?: string; retainedCli?: AgentCli}) {
    const admission = this.workerAdmissions.get(a.id);
    // Workspace checks use the exact continuation selected at admission.
    const {resume, retainedCli} = continuation ?? admission ?? {};
    const drainBlocked=this.draining&&a.status==='preparing'&&!retainedCli;
    if (!drainBlocked&&admission?.generation === this.taskGeneration(a) && admission.context === this.workerContext(a, repo, resume, retainedCli)) return true;
    a.status = drainBlocked||this.taskPaused(a.issueTitle ?? '') ? 'stopped' : 'error'; a.endedAt = Date.now();
    if(drainBlocked)this.workerAdmissions.delete(a.id);
    a.lastError = drainBlocked?'Office is draining; new agent work is paused. Retry after maintenance ends with fresh readiness.':'Execution context changed or readiness is missing; retry with fresh capability checks';
    const record = this.state.qa.find(q => q.repoId === a.repoId && q.prNumber === a.prNumber);
    if (a.task === 'qa' && record?.status === 'testing') this.setQa(record, {status: 'queued', qaAgentId: null, testedSha: null, passedSha: null});
    if (a.task === 'fix' && record?.status === 'fixing') this.setQa(record, {status: 'failed'});
    this.appendLog(a, [{kind: 'error', text: a.lastError}]); this.emitAgent(a); this.save();
    return false;
  }

  private async sessionReadiness(a: PersistedAgent, repo: PersistedRepo, resume?: string, retainedCli?: AgentCli): Promise<string | null> {
    try{this.trackExecution(a,repo);}catch(error){return error instanceof Error?error.message:'Execution telemetry unavailable';}
    try{if(a.issueNumber){this.deliveryWorkGate(repo.id,a.issueNumber);this.assertTaskAccess(a,repo,a.issueNumber,a.task==='qa');}}catch(error){return error instanceof Error?error.message:'Task authority is unavailable';}
    if((resume||retainedCli)&&a.issueNumber&&this.deliveryTaskContract(repo.id,a.issueNumber)&&
      (a.launchedTaskScope?.issue!==a.issueNumber||a.launchedTaskScope.hash!==this.deliveryTaskFingerprint(repo.id,a.issueNumber)))return 'Retained task instructions differ from current approved scope; reset and assign a fresh task session';
    const generation = this.taskGeneration(a);
    const context = this.workerContext(a, repo, resume, retainedCli);
    if (context === null) return 'Execution context is unavailable; restore configuration before retrying';
    const cli = retainedCli ?? (resume && a.sessionCli && a.role !== 'ceo' ? a.sessionCli : a.cli || this.state.settings.defaultCli);
    const held=this.workerModelHold(a,cli);if(held)return held;
    const projects = [repo, ...this.linkedRepos(repo)];
    if (projects.length !== repo.links.length + 1) return 'A linked project is no longer connected';
    const blocker = await this.projectReadiness(projects, cli, this.taskStops.get(a.id)?.signal);
    if (context !== this.workerContext(a, repo, resume, retainedCli)) return 'Execution context changed during readiness verification; retry with fresh capability checks';
    if (blocker === null && this.ownsTask(a, generation)) this.workerAdmissions.set(a.id, {generation, context, resume, retainedCli});
    return blocker;
  }

  private projectReadiness(projects: PersistedRepo[], cli: string, signal?: AbortSignal) {
    return this.backend.demo ? Promise.resolve(null) : this.boundedReadiness(async () => {
      const checks = await Promise.all(projects.map(async project => {
        const result = await this.capabilityPreflight(project.id, cli);
        return result === null ? null : `${projects.length > 1 ? `${project.id}: ` : ''}${result || 'Capability decision is unavailable'}`;
      }));
      return checks.find(result => result !== null) ?? null;
    }, 'Capability', signal);
  }

  private async checkTaskCapabilities(a: PersistedAgent, repo: PersistedRepo, resume?: string, generation = this.taskGeneration(a)) {
    if (this.closed) return false;
    try{this.trackExecution(a,repo);}catch(error){a.status='error';a.lastError=error instanceof Error?error.message:'Execution telemetry unavailable';this.emitAgent(a);this.save();return false;}
    if (this.taskPaused?.(a.issueTitle ?? '')) {
      a.status = 'stopped'; a.lastError = 'This platform is paused by the manager';
      this.emitAgent(a); this.save(); return false;
    }
    const cli=(resume&&a.sessionCli?a.sessionCli:a.cli||this.state.settings.defaultCli) as AgentCli;
    const context=this.workerPreflightContext(a,repo,cli);
    let blocker:string|null;
    try{this.assertTaskAccess(a,repo,a.issueNumber??0,a.task==='qa');blocker=await this.sessionReadiness(a, repo, resume);if(!blocker)this.assertTaskAccess(a,repo,a.issueNumber??0,a.task==='qa');}
    catch(error){blocker=error instanceof Error?error.message:'Task ownership could not be verified';}
    if (!this.ownsTask(a, generation) || a.status !== 'preparing') return false;
    if (blocker === null){delete a.preflightRetry;return true;}
    if(!a.modelBlock){a.preflightRetry=nextPreflightRetry(a.preflightRetry,context);}
    a.lastError = blocker+(a.preflightRetry?.context===context?` Automatic checks ${a.preflightRetry.nextAttemptAt?`resume after ${a.preflightRetry.nextAttemptAt}`:'are held until configuration changes or a manual retry succeeds'}.`:'');
    a.status = 'error'; a.endedAt = Date.now();
    this.appendLog(a, [{ kind: 'error', text: a.lastError! }]); this.emitAgent(a); this.save(); return false;
  }

  private async runTask(a: PersistedAgent, repo: PersistedRepo, issue: IssueInfo, note?: string) {
    const branch = `swarm/issue-${issue.number}-${slugify(a.name)}`;
    const generation = this.beginTask(
      a,
      { task: 'issue', issueNumber: issue.number, issueTitle: issue.title, branch, prNumber: null, prUrl: null, sessionId: null },
      `Issue #${issue.number}: ${issue.title}`,
      `Preparing worktree on ${branch}…`,
    );
    if (!await this.checkTaskCapabilities(a, repo, undefined, generation)) return;
    const cwd = await this.prepare(a, repo, {}, branch, generation);
    if (!cwd || !this.ownsTask(a, generation)) return;

    const prompt = [
      `Please resolve GitHub issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
      '',
      issue.body?.trim() || '(The issue has no description.)',
      note ? `\nNote from the manager: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildSystemAppend(a, repo, cwd, branch));
  }

  private startAgentSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId?: string,
    outputSchema?: Record<string, unknown>,
    /** typed: the manager typed the prompt at the CLI; reattach: follow the CLI that kept working through a restart. */
    mode: 'typed' | 'reattach' | null = null,
  ) {
    if (this.closed) return false;
    if (!this.validWorkerAdmission(a, repo, {resume: resumeSessionId, retainedCli: mode === 'reattach' ? a.sessionCli ?? undefined : undefined})) return false;
    const rt = this.agentRt.get(a.id)!;
    const generation = this.taskGeneration(a);
    let completed = false;
    const live = () => !completed && this.ownsTask(a, generation);
    const admission = this.workerAdmissions.get(a.id)!;
    const checkpointCli = a.sessionCli;
    const deliveryIssue=a.task==='issue'||a.task==='fix'||a.task==='qa'&&a.prNumber!==null?a.issueNumber??0:null;
    const deliveryFingerprint=deliveryIssue!==null?this.deliveryTaskFingerprint(repo.id,deliveryIssue):'';
    const authority = () => {
      if (!live() || a.status !== 'working') return 'This task no longer owns the session; execution denied';
      try{if(!this.backend.demo&&deliveryIssue!==null)this.deliveryWorkGate(repo.id,deliveryIssue);}catch(error){return error instanceof Error?error.message:'Delivery stage could not be verified';}
      try{if(deliveryIssue!==null)this.assertTaskAccess(a,repo,deliveryIssue,a.task==='qa');}catch(error){return error instanceof Error?error.message:'Task ownership changed';}
      if(deliveryIssue!==null&&deliveryFingerprint!==this.deliveryTaskFingerprint(repo.id,deliveryIssue))return 'Delivery scope or reviewed record changed; stop and retry with current task context';
      return admission.context === this.workerContext(a, repo, admission.resume, admission.retainedCli, checkpointCli)
        ? null : 'Execution configuration changed; stop and retry with fresh readiness';
    };
    if(deliveryIssue&&this.deliveryTaskContract(repo.id,deliveryIssue)){
      if((resumeSessionId||mode)&& (a.launchedTaskScope?.issue!==deliveryIssue||a.launchedTaskScope.hash!==deliveryFingerprint)){a.status='error';a.lastError='Retained task instructions differ from current approved scope; reset and assign a fresh task session';this.emitAgent(a);this.save();return false;}
      a.launchedTaskScope={issue:deliveryIssue,hash:deliveryFingerprint};
    }
    a.status = 'working';
    const how = this.sessionRuntime(a, resumeSessionId, mode === 'reattach' ? a.sessionCli ?? undefined : undefined);
    const projects = [repo, ...this.linkedRepos(repo)];
    let refreshing: Promise<string | null> | undefined;
    const signal = this.taskStops.get(a.id)?.signal;
    const executionAttemptId=this.executionAttempts.get(a.id)?.id??crypto.randomUUID();
    const authorizeTool: SessionAuthorization = async () => {
      const denied = authority(); if (denied) return denied;
      refreshing ??= this.projectReadiness(projects, how.cli ?? 'node', signal).finally(() => {refreshing = undefined;});
      const blocker = await refreshing;
      if(!blocker&&deliveryIssue!==null&&!['discovery','design'].includes(this.deliveryTaskStage(repo.id,deliveryIssue)??'')){
        try{await this.executionEvidenceCheck(repo.id,deliveryIssue,a.id,executionAttemptId,()=>{const denied=authority();if(denied)throw new Error(denied);});}
        catch{return 'Fresh phase execution evidence is unavailable; authoring remains blocked';}
      }
      return authority() ?? blocker;
    };
    this.emitAgent(a);
    const launchedModel=this.modelFor(a,how.cli);
    const measured=this.executionAttempts.get(a.id);
    try{if(measured)this.executionLedger?.launch(measured.id);}catch(error){a.status='error';a.lastError=error instanceof Error?error.message:'Execution telemetry unavailable';this.emitAgent(a);this.save();return false;}
    const handle = this.backend.startSession(
      {
        cwd,
        prompt,
        systemAppend,
        workerPreflight: !this.backend.demo,
        repoId: repo.id,
        workerPreflightMode: a.task==='qa'?'authoring':['discovery','design'].includes(this.deliveryTaskStage(repo.id,a.issueNumber??0)??'')?this.deliveryTaskStage(repo.id,a.issueNumber??0) as 'discovery'|'design':'authoring',
        coordinatorAttemptId:measured?.id,
        taskEvidenceKey: `${repo.id}:${a.task}:${a.task==='qa'?a.prNumber??'release':a.issueNumber??'unassigned'}`,
        model: launchedModel,
        effort: a.effort || this.state.settings.defaultEffort,
        browserTesting: repo.browserTesting,
        additionalDirectories: this.linkedRepos(repo).map((r) => this.backend.mainDir(r.fullName)),
        office: a.role === 'qa' || a.task === 'qa' ? this.deliveryQaTools(a.id, repo.id, authorizeTool) : this.engineeringTools(authorizeTool,a.id,repo.id),
        authorizeTool,
        role: a.task === 'qa' ? 'qa' : a.role, // a developer covering QA works under QA's rules
        outputSchema,
        // A developer's CLI stays at its prompt afterwards, for the manager and for follow-ups; QA's closes.
        keepAlive: a.task !== 'qa',
        typed: mode === 'typed',
        reattach: mode === 'reattach',
        agentId: a.id,
        ...how,
      },
      {
        log: (entries) => {if (live()) this.appendLog(a, entries);},
        tool: (name) => {
          if (!live()) return;
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          if (!live()) return;
          const cli=id ? (how.cli ?? 'codex') : null;
          if(a.sessionId===id&&a.sessionCli===cli)return;
          a.sessionId = id; a.sessionCli = cli;
          this.emitAgent(a);
          return this.writeState();
        },
        browserUrl: (url) => {
          if (!live()) return;
          rt.browserUrl = url;
          this.emitAgent(a);
        },
        screenshot: (data, mime) => {
          if (!live()) return;
          const at = Date.now();
          rt.screenshot = { data, mime, at };
          rt.shots.push({ data, mime, url: rt.browserUrl, at });
          if (rt.shots.length > 12) rt.shots.shift();
          this.broadcast({ type: 'screen', agentId: a.id, url: rt.browserUrl, at });
          void removeScreens(a.id)
            .then(() => fs.mkdir(SCREENS_DIR, { recursive: true }))
            .then(() => fs.writeFile(screenFile(a.id, mime), data))
            .catch((err) => console.warn('could not save screenshot', err));
        },
        limited: (at) => {if (live()) this.pauseForLimit(at);},
        usageWarning: (info) => {if (live()) this.paceForWarning(info);},
        finished: (result) => {if (!live()) return; const fallbackAuthorized=authority()===null;completed = true; return this.onFinished(a, repo, result, generation,how.cli,fallbackAuthorized,launchedModel).catch(()=>{
          if(!this.ownsTask(a,generation))return;
          rt.session=null;rt.currentTool=null;a.status='error';a.endedAt=Date.now();
          a.lastError='Completion processing failed; reconcile artifacts and external actions before retrying';
          this.appendLog(a,[{kind:'error',text:a.lastError}]);this.emitAgent(a);this.save();
        });},
      },
    );
    if (this.ownsTask(a, generation)) rt.session = completed ? null : handle;
    else if (!completed) handle.stop();
    return true;
  }

  private async onFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult, generation = this.taskGeneration(a),sessionCli?:AgentCli,fallbackAuthorized=false,launchedModel?:string) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.ownsTask(a, generation)) return;
    this.endExecution(a,result.interrupted?'interrupted':result.ok?'reported-success':'failure',result.sessionEvidenceId);
    if (this.officeUpdate.handedOver) return; // stopped for the office's update: recovered like after a restart
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    const modelError=result.configurationError;
    if(!result.ok&&sessionCli&&modelError?.cli===sessionCli&&modelError.model===launchedModel){
      const reason=modelError.kind==='unverified-model'?'The worker model is not advertised in verified native metadata. Select a listed model, clear its override or change the runtime; retries remain held for this runtime/model.':'The native runtime rejected the worker model. Select an available model, clear its override or change the runtime; retries remain held for this runtime/model.';
      a.modelBlock={fingerprint:this.workerModelFingerprint(sessionCli,launchedModel!),reason};
    }
    // Dev servers the agent forgot to stop would otherwise keep its port and lock its desk folder.
    const slug = this.agentSlug(a);
    void this.deskOperation(a, async () => {if (this.ownsTask(a, generation)) await this.backend.releaseDesk(repo.fullName, slug, this.port(a));}).catch(() => undefined);
    if (result.interrupted) this.interrupted(a);

    if (!this.draining && fallbackAuthorized && !result.ok && sessionCli==='opencode' && result.opencodeLimit===true) {
      const recovered = await this.fallbackFromOpenCodeToCodex(a, repo);
      if (recovered) {
        this.emitAgent(a);
        this.save();
        void this.syncRepo(repo.id);
        this.later(() => this.schedule(), 500);
        return;
      }
    }

    if (a.task === 'qa' && a.prNumber === null) {
      a.status = result.ok ? 'done' : 'error'; a.lastError = result.ok ? null : result.errors.join('; ');
      this.appendLog(a, [{ kind: result.ok ? 'system' : 'error', text: result.text || a.lastError || 'Release review ended' }]);
    } else if (a.task === 'qa') await this.onQaFinished(a, repo, result, generation);
    else if (a.task === 'fix') this.onFixFinished(a, repo, result);
    else await this.onIssueFinished(a, repo, result, generation);

    if (!this.ownsTask(a, generation)) return;

    this.emitAgent(a);
    this.save();
    void this.syncRepo(repo.id);
    this.later(() => this.schedule(), 500);
  }

  private minutes(a: PersistedAgent) {
    return a.startedAt && a.endedAt ? Math.max(1, Math.round((a.endedAt - a.startedAt) / 60000)) : 0;
  }

  private fail(a: PersistedAgent, result: SessionResult, what: string) {
    a.status = 'error';
    a.lastError = result.errors.join('; ') || 'Session failed';
    this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
    this.toast('error', `${a.name} hit a problem on ${what}: ${a.lastError.slice(0, 120)}`);
  }

  private async fallbackFromOpenCodeToCodex(a: PersistedAgent, repo: PersistedRepo): Promise<boolean> {
    const fallbackModel = '';
    a.cli = 'codex';
    a.model = fallbackModel;
    a.sessionId = null;
    a.sessionCli = null;
    a.lastError = null;

    if (this.state.settings.defaultCli === 'opencode') {
      this.state.settings.defaultCli = 'codex';
      this.state.settings.defaultModel = fallbackModel;
    }

    this.appendLog(a, [
      { kind: 'system', text: 'OpenCode quota reached. Checking fresh Codex readiness before replacement dispatch.' },
    ]);
    this.postMessage(
      'office',
      `OpenCode quota reached for ${a.name}. Codex fallback requires fresh readiness before work can continue.`,
    );
    this.toast('info', `${a.name} hit OpenCode quota: checking Codex readiness.`);

    if (a.task === 'issue' && a.issueNumber) {
      const issue = this.repoRt.get(repo.id)?.issues.find((i) => i.number === a.issueNumber);
      if (issue) {
        await this.runTask(a, repo, issue);
        return true;
      }
    } else if (a.task === 'fix' && a.prNumber) {
      const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
      if (rec) {
        await this.runFix(a, repo, rec);
        return true;
      }
    } else if (a.task === 'qa' && a.prNumber) {
      const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
      if (rec) {
        await this.runQa(a, repo, rec);
        return true;
      }
    }

    a.status = 'idle';
    return true;
  }

  private async onIssueFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult, generation = this.taskGeneration(a)) {
    const escaped = repo.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = result.text.match(new RegExp(`https://github\\.com/${escaped}/pull/(\\d+)`, 'i'));
    if (m) {
      a.prNumber = Number(m[1]);
      a.prUrl = m[0];
    } else if (a.branch) {
      const pr = await this.backend.prForBranch(repo.fullName, a.branch).catch(() => null);
      if (!this.ownsTask(a, generation)) return;
      if (pr) {
        a.prNumber = pr.number;
        a.prUrl = pr.url;
      }
    }

    if (a.status === 'stopped') return; // the manager already logged the stop
    if (!result.ok) {
      this.issueFailed(repo, a.issueNumber);
      return this.fail(a, result, `#${a.issueNumber}`);
    }
    this.issueFailures.delete(`${repo.id}#${a.issueNumber}`);
    if(!a.prNumber&&a.issueNumber&&await this.browserTaskHold(repo.id,a.id,a.issueNumber,a.startedAt??Date.now())){
      if(!this.ownsTask(a,generation))return;
      a.status='stopped';a.lastError=null;
      this.appendLog(a,[{kind:'system',text:'Waiting for coordinator browser work. Task, branch and CLI session retained; resume explicitly after inspecting the result.'}]);
      return;
    }
    if(!this.ownsTask(a,generation))return;
    a.status = 'done';
    this.appendLog(a, [{ kind: 'done', text: `✔ Finished in ${this.minutes(a)}m · ${a.turns} turns${a.prNumber ? ` · PR #${a.prNumber}` : ' · no PR found'}` }]);
    if (a.prNumber) {
      this.queueQa(repo, a.prNumber, a, a.issueNumber);
      this.appendLog(a, [{ kind: 'system', text: `📨 Handed PR #${a.prNumber} to QA.` }]);
      this.toast('success', `${a.name} opened PR #${a.prNumber} for #${a.issueNumber}; it's off to QA`);
    } else {
      const stage=this.deliveryTaskStage(repo.id,a.issueNumber??0);
      if(stage==='discovery'||stage==='design'){
        this.appendLog(a,[{kind:'system',text:`Read-only ${stage} reported through the shared record; independent review and issue disposition remain required. No implementation readiness was granted.`}]);
        this.postMessage('office',`${a.name} reported ${stage} for #${a.issueNumber}. Review the shared record and decide whether further evidence or issue closure is appropriate.`);
        return;
      }
      this.noPullRequest(a, repo);
    }
  }

  /**
   * An issue session ended without a PR, which would leave the issue "taken" with nobody on it. The same developer,
   * who has the context and the worktree, is asked once to finish; after that the issue goes back on the board.
   */
  private noPullRequest(a: PersistedAgent, repo: PersistedRepo) {
    const key = `${repo.id}#${a.issueNumber}`;
    if (this.nudged.has(key)) return this.releaseIssue(a, repo);
    this.nudged.add(key);
    // message() reserves the developer before its first await, so the scheduler cannot assign them during readiness checks.
    if(this.executionHeld(a,repo,a.issueNumber??0))return this.releaseIssue(a,repo);
    this.automaticAgents.add(a.id);try{void this.message(
      a.id,
      `You finished without opening a pull request for #${a.issueNumber}. Finish the remaining steps now: commit, push your branch and open the PR with "Closes #${a.issueNumber}". If the issue can't be done, open a draft PR that explains why.`,
    ).catch(() => this.releaseIssue(a, repo));}finally{this.automaticAgents.delete(a.id);}
  }

  private releaseIssue(a: PersistedAgent, repo: PersistedRepo) {
    const n = a.issueNumber;
    this.clearTask(a);
    this.postMessage('office', `⚠️ ${a.name} finished #${n} on ${repo.fullName} without opening a pull request, so it's back on the board for anyone.`);
  }

  // ---------- QA ----------

  private queueQa(repo: PersistedRepo, prNumber: number, dev: PersistedAgent | null, issueNumber: number | null) {
    let rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec) {
      if (rec.status === 'testing') return;
      this.setQa(rec, { status: 'queued', passedSha: null, testedSha: null, ...developerCheckpoint(dev, rec), devAgentId: dev?.id ?? rec.devAgentId });
    } else {
      rec = {
        repoId: repo.id,
        prNumber,
        status: 'queued',
        round: 1,
        devAgentId: dev?.id ?? null,
        qaAgentId: null,
        summary: null,
        checks: [],
        commentUrl: null,
        updatedAt: Date.now(),
        issueNumber,
        ...developerCheckpoint(dev && dev.prNumber === prNumber ? dev : null),
        fixInstructions: null,
        sessionFailures: 0,
        mergeNote: null,
        testedSha: null,
        passedSha: null,
        fixReason: null,
        mergeFixes: 0,
        retests: 0,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
      };
      this.state.qa.push(rec);
      this.setQa(rec, {});
    }
    this.later(() => this.schedule(), 200);
  }

  /** Manager's "send to QA" for any open PR (including ones opened by people). */
  async sendToQa(repoId: string, prNumber: number) {
    this.requireOpen();
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber && p.state === 'OPEN');
    if (!pr) throw new HttpError(404, `PR #${prNumber} is not open on ${repo.fullName}`);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `PR #${prNumber} is already ${rec.status}`);
    if (rec && (rec.status === 'needs-human' || rec.status === 'passed' || rec.status === 'failed')) {
      // a fresh start: the manager decided it deserves another round
      rec.round += 1;
      rec.sessionFailures = 0;
    }
    const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && a.task !== 'qa' && (a.prNumber === prNumber || a.branch === pr.headRefName));
    this.queueQa(repo, prNumber, dev ?? null, pr.closesIssues[0] ?? null);
    const queued=this.state.qa.find(q=>q.repoId===repo.id&&q.prNumber===prNumber);if(queued)this.manualQaRetries.add(queued);
    this.toast('info', `PR #${prNumber} is queued for QA`);
  }

  /** Explicit manager recovery after repairing a failed PR's local prerequisites. */
  async retryPrFix(repoId: string, prNumber: number) {
    this.requireOpen();
    const repo = this.repo(repoId);
    const rec = this.state.qa.find(q => q.repoId === repo.id && q.prNumber === prNumber);
    const pull = this.repoRt.get(repo.id)?.pulls.find(p => p.number === prNumber && p.state === 'OPEN');
    if (!rec || rec.status !== 'failed' || !pull) throw new HttpError(409, 'Only an open PR with a failed QA repair can be retried');
    const dev = this.state.agents.find(a => a.id === rec.devAgentId && a.repoId === repo.id && a.role === 'dev');
    if (!dev || !FREE.includes(dev.status) && dev.status !== 'error') throw new HttpError(409, 'The original PR author is unavailable');
    // A repair must retain the same issue identity that runFix will launch.
    // Do not infer one from a later PR body: that would admit one task and
    // reserve/verify another when the retained QA record has no issue.
    const issue = rec.issueNumber;
    if (!issue || issue < 1) throw new HttpError(409, 'PR repair requires its retained issue binding');
    if (this.taskPaused(pull.title)) throw new HttpError(409, 'This platform is paused by the manager');
    if (!this.backend.demo) this.deliveryWorkGate(repo.id, issue);
    this.assertTaskAccess(dev, repo, issue, false);
    this.ensureSlot();
    // runFix owns checkout, current capability admission, task-input verification,
    // durable attempt reservation and the ordinary post-fix QA transition.
    // A manual retry does not clear automatic retry history or acceptance gates.
    await this.runFix(dev, repo, rec);
  }

  private buildQaSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, pr: PrDetails) {
    return [
      DELIVERY_ENGINEERING,
      deliveryCapabilitiesPrompt([a.brief, repo.summary, repo.mission, repo.qaBrief, pr.title].filter(Boolean).join('\n')),
      this.deliveryTaskContext(repo.id,a.issueNumber??0),
      `You are ${a.name}, ${a.title ? `the team's ${a.title},` : 'a QA engineer'} on an autonomous agent team ("Agent Swarm"). Developers open pull requests; you review and independently verify each one before it is merged. Your sign-off is the review: ${repo.autoMerge ? "on this floor a PR you pass merges by itself as soon as GitHub's checks are green, so nobody else reads the code after you. " : ''}Be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, the issue's requirements not met, obvious regressions), not for style preferences.`,
      ...(a.brief ? ['', `Your job description:\n${a.brief}`] : []),
      ...(a.role === 'dev' ? ['', "You're a developer covering for the QA lab while its testers are busy. You didn't write this pull request: test it as an independent QA engineer would."] : []),
      '',
      `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
      ...(repo.summary ? [`Project: ${repo.summary}`] : []),
      ...(repo.mission ? [`What the team is building (the manager's brief): ${repo.mission}`] : []),
      ...(repo.targetTenancy
        ? [
            'Target Tenancy & Verification Boundary:',
            `- Tenant: ${repo.targetTenancy.tenantName} (${repo.targetTenancy.tenantDomain})`,
            `- Environment URL: ${repo.targetTenancy.environmentUrl}`,
            `- Owner: ${repo.targetTenancy.user}`,
            'Verify that solution artifacts and seed data align strictly with this tenancy, rejecting mock placeholders.',
          ]
        : []),
      ...(repo.qaBrief ? [`What to check on this project (from the CEO):\n${repo.qaBrief}`] : []),
      `Pull request #${pr.number} "${pr.title}" from branch ${pr.headRefName}: ${pr.url}`,
      `Your worktree: ${cwd}. It has the pull request's code checked out on local branch ${branch}.`,
      '',
      'How to test:',
      '1. Read the PR description and the linked issue, and work out the acceptance criteria.',
      `2. Review the code as a careful reviewer would: git diff origin/${repo.defaultBranch}...HEAD. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, and new logic without tests.`,
      "3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).",
      repo.browserTesting
        ? `4. If the project has a UI, start it in the background on port ${this.port(a)} (reserved for you) and exercise the change in a real browser with the Playwright tools: navigate, click, type, resize to a phone size, try edge cases, and check the console for errors. Take a screenshot with browser_take_screenshot (no filename) of every important state: the screenshots are attached to the PR as evidence. Stop the server afterwards.`
        : '4. Exercise the changed behaviour directly (run the program, call the API, write a quick script).',
      '5. You may write throwaway scripts to probe behaviour, but do not commit them.',
      'Report pass only when every reported acceptance check passed. An unverified or skipped required criterion must be reported as a failure with actionable remediation. Never invent a screenshot caption: include one per captured image (at most the last 12 retained images).',
      'A pass report cannot contain any skip or fail check. Keep unrelated future tasks and unavailable out-of-scope browser checks in the summary as explicit limits, not in checks. Never omit or relabel an unverified criterion required by this PR to obtain a pass.',
      '',
      'Rules: do not modify the code under test, do not commit, push, comment on, review or merge anything on GitHub. The office posts your report on the pull request. Finish with the structured QA report: verdict, summary, the checks you performed, the commands you ran and one caption per screenshot.',
    ].join('\n');
  }

  private async runQa(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const branch = `qa/pr-${rec.prNumber}-${slugify(a.name)}`;
    this.setQa(rec, { status: 'testing', passedSha: null, testedSha: null, qaAgentId: a.id });
    const generation = this.beginTask(
      a,
      { task: 'qa', issueNumber: rec.issueNumber, issueTitle: `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: null, sessionId: null },
      `QA · PR #${rec.prNumber} · round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );

    if(a.status!=='preparing'){if(this.ownsTask(a,generation))this.setQa(rec,{status:'queued',qaAgentId:null,testedSha:null,passedSha:null});return;}
    let pr: PrDetails;
    let issue: { title: string; body: string } | null = null;
    try {
      pr = await this.backend.prDetails(repo.fullName, rec.prNumber);
      const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
      if (issueNumber) issue = await this.backend.issueDetails(repo.fullName, issueNumber).catch(() => null);
      if (!this.ownsTask(a, generation) || a.status !== 'preparing') return;
      Object.assign(a, { issueTitle: pr.title, prUrl: pr.url });
      rec.testedSha = pr.headSha;
      rec.taskAuthorityHash=this.deliveryTaskContract(repo.id,rec.issueNumber??0)?this.deliveryTaskFingerprint(repo.id,rec.issueNumber??0):undefined;
      this.emitAgent(a);
    } catch (err) {
      if (!this.ownsTask(a, generation)) return;
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      this.emitAgent(a);
      return;
    }
    if (pr.state !== 'OPEN') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} is ${pr.state.toLowerCase()}; nothing to test.` }]);
      this.state.qa = this.state.qa.filter((q) => q !== rec);
      this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber: rec.prNumber });
      this.clearTask(a);
      return;
    }

    if (!await this.checkTaskCapabilities(a, repo, undefined, generation)) { if (this.ownsTask(a, generation)) this.setQa(rec, { status: 'queued' }); return; }
    const cwd = await this.prepare(a, repo, { pr: rec.prNumber }, branch, generation);
    if (!this.ownsTask(a, generation)) return;
    if (!cwd) {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return;
    }

    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const prompt = [
      `Please QA pull request #${pr.number}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Author: ${dev ? `${dev.name} (developer agent)` : 'a teammate'} · QA round ${rec.round}`,
      rec.fixReason === 'conflict'
        ? `\nQA passed it before, but since then the branch was updated with ${repo.defaultBranch} to resolve merge conflicts. Re-check everything, especially where this change meets the newly merged work.`
        : rec.fixReason === 'checks'
          ? '\nQA passed it before, but since then the developer changed the code to fix failing GitHub checks. Re-check everything.'
          : rec.fixReason === 'dlp'
            ? '\nQA passed it before, but Enterprise DLP policy violations were detected before merge. Re-check connector configurations and endpoints.'
            : rec.round > 1 && rec.summary
              ? `\nThis is a re-test after fixes. Last round's findings:\n${rec.summary}\n${rec.fixInstructions ?? ''}\nCheck those first, then re-check everything else.`
              : '',
      '',
      'PR description:',
      pr.body.trim() || '(empty)',
      issue ? `\nLinked issue: ${issue.title}\n${issue.body.trim() || '(no description)'}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildQaSystemAppend(a, repo, cwd, branch, pr), undefined, QA_SCHEMA);
  }

  private async onQaFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult, generation = this.taskGeneration(a)) {
    if (this.closed) return;
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    if (!rec) return this.fail(a, {...result, errors: ['QA record unavailable; report was not accepted']}, `QA of PR #${a.prNumber}`);
    if(this.deliveryTaskContract(repo.id,rec.issueNumber??0)&&!this.taskQaCurrent(repo,rec)){a.status='done';return;}
    const rt = this.agentRt.get(a.id)!;
    const parsed = parseQaReport(result);
    const report = parsed && parsed.screenshots.length === rt.shots.length && (parsed.verdict !== 'pass' || !!rec?.testedSha) ? parsed : null;

    if (a.status === 'stopped' || !report) {
      if (a.status !== 'stopped') this.fail(a, { ...result, errors: result.errors.length ? result.errors : ['QA finished without a usable report'] }, `QA of PR #${a.prNumber}`);
      if (rec) {
        const failures = rec.sessionFailures + (this.limited() ? 0 : 1); // the usage limit isn't the PR's fault
        this.setQa(rec, {
          status: a.status === 'stopped' || failures >= 2 ? 'needs-human' : 'queued',
          qaAgentId: null,
          sessionFailures: failures,
          passedSha: null,
          summary: a.status === 'stopped' ? 'QA was stopped by the manager.' : rec.summary,
        });
      }
      return;
    }

    const pass = report.verdict === 'pass';
    this.appendLog(a, [{ kind: pass ? 'done' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${a.prNumber} · ${report.checks.length} checks · ${rt.shots.length} screenshots` }]);

    // Evidence + comment on the PR
    let commentUrl: string | null = null;
    if (rec) {
      try {
        this.appendLog(a, [{ kind: 'system', text: '📎 Uploading evidence and posting the QA report on the PR…' }]);
        const body = await this.renderQaComment(a, repo, rec, report, rt.shots, generation);
        if (!this.ownsTask(a, generation)) return;
        commentUrl = (await this.backend.commentPull(repo.fullName, rec.prNumber, body))?.trim() || null;
        if(!commentUrl)throw new HttpError(503,'QA report publication returned no receipt');
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ ${commentUrl ?? 'comment posted'}` }]);
      } catch (err) {
        if (!this.ownsTask(a, generation)) return;
        if(!this.state.qa.includes(rec)||rec.status!=='testing'||rec.qaAgentId!==a.id)return;
        if(!this.taskQaCurrent(repo,rec)){a.status='done';return;}
        const reason='QA evidence publication is unavailable; restore artifact/comment access and independently reconcile the retained report before approval';
        a.status='error';a.lastError=reason;
        this.appendLog(a,[{kind:'error',text:`  ⎿ ${reason}`}]);
        this.setQa(rec,{status:'needs-human',summary:report.summary,checks:report.checks,fixInstructions:report.fixInstructions??null,passedSha:null,commentUrl:null,mergeNote:reason});
        return;
      }
      if (!this.ownsTask(a, generation) || !this.state.qa.includes(rec) || rec.status !== 'testing' || rec.qaAgentId !== a.id) return;
      if(!this.taskQaCurrent(repo,rec)){a.status='done';this.emitAgent(a);return;}
      a.status = 'done';
      const qaRounds = rec.round - rec.retests; // rounds QA itself asked for
      const nextStatus = pass ? 'passed' : qaRounds >= MAX_QA_ROUNDS ? 'needs-human' : 'failed';
      this.setQa(rec, {
        status: nextStatus,
        summary: report.summary,
        checks: report.checks,
        commentUrl: commentUrl ?? rec.commentUrl,
        fixInstructions: report.fixInstructions ?? report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n'),
        sessionFailures: 0,
        fixReason: pass ? null : 'qa',
        passedSha: pass ? rec.testedSha : null,
        mergeNote: null,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
      });
      this.toast(
        pass ? 'success' : 'error',
        pass
          ? `✅ ${a.name} passed PR #${rec.prNumber}${repo.autoMerge ? "; it merges once GitHub's checks are green" : ': ready to merge'}`
          : nextStatus === 'needs-human'
            ? `❌ PR #${rec.prNumber} failed QA ${qaRounds} times and needs a human`
            : `❌ ${a.name} failed PR #${rec.prNumber}; sending it back to the developer`,
      );
    }
  }

  private async renderQaComment(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, report: QaReport, shots: Shot[], generation = this.taskGeneration(a)) {
    const pass = report.verdict === 'pass';
    const images: string[] = [];
    const evidence = shots.slice(-8);
    const offset = shots.length - evidence.length;
    const folder = `pr-${rec.prNumber}/round-${rec.round}-${Date.now().toString(36)}`;
    for (const [i, shot] of evidence.entries()) {
      if (!this.ownsTask(a, generation)) throw new HttpError(409, 'QA evidence upload cancelled');
      const n = offset + i + 1;
      const ext = MIME_EXT[shot.mime] ?? 'png';
      const file = `${folder}/${String(n).padStart(2, '0')}.${ext}`;
      try {
        const url = (await this.backend.uploadEvidence(repo.fullName, file, shot.data))?.trim();
        if(!url)throw new HttpError(503,'QA screenshot publication returned no receipt');
        const caption = report.screenshots[n - 1] ?? `Screenshot ${n}`;
        images.push(`**${n}. ${caption}**${shot.url ? ` · \`${shot.url}\`` : ''}\n\n<img src="${url}" alt="${caption.replace(/"/g, "'")}" width="760">`);
      } catch (err) {
        if (!this.ownsTask(a, generation)) throw new HttpError(409, 'QA evidence upload cancelled');
        throw new HttpError(503,`Required QA screenshot ${n} could not be published; preserve local evidence before recovery`);
      }
    }
    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const lines = [
      `## 🔍 QA report: ${pass ? '✅ Passed' : '❌ Failed'}`,
      `**Tester:** ${a.name} (Agent Swarm QA agent) · **Round:** ${rec.round}${dev ? ` · **Author:** ${dev.name}` : ''}`,
      '',
      report.summary,
      '',
      '| | Check | Details |',
      '|---|---|---|',
      ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`),
    ];
    if (report.commands.length) {
      lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
    }
    if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
    if (images.length) lines.push('', '### 📸 Evidence', '', ...images.flatMap((img) => [img, '']));
    else lines.push('', '_No browser screenshots were taken in this round._');
    const merge = repo.autoMerge ? "merges automatically once GitHub's checks pass" : 'ready for the manager to merge';
    lines.push('', `<sub>Posted by Agent Swarm · ${pass ? merge : rec.round - rec.retests >= MAX_QA_ROUNDS ? 'needs a human decision' : 'sent back to the developer for fixes'}</sub>`);
    return lines.join('\n');
  }

  /** Send a failed PR back to the developer who wrote it (or any free developer on the floor). */
  private async runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const original = rec.devAgentId === dev.id;
    const pull = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const branch = fixDeskBranch(rec.prNumber, this.agentSlug(dev));
    const terminal = this.state.settings.runtime === 'terminal' && this.backend.terminals;
    const resume = original && rec.devSessionId && isCli(rec.devSessionCli) && (terminal || rec.devSessionCli === 'claude') ? rec.devSessionId : undefined;
    if (original && rec.devSessionId && !resume) this.appendLog(dev, [{kind: 'system', text: 'Repair checkpoint runtime is unknown or incompatible; starting a fresh session with the current PR and QA context.'}]);
    const qaAgent = rec.qaAgentId ? this.state.agents.find((x) => x.id === rec.qaAgentId) : null;
    this.setQa(rec, { status: 'fixing', devAgentId: dev.id, devSessionId: resume ?? null, devSessionCli: resume ? rec.devSessionCli : null });
    const generation = this.beginTask(
      dev,
      { task: 'fix', issueNumber: rec.issueNumber, issueTitle: pull?.title ?? `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: pull?.url ?? null, sessionId: resume ?? null, sessionCli: resume ? rec.devSessionCli : null },
      rec.fixReason === 'conflict'
        ? `Resolving conflicts on PR #${rec.prNumber}`
        : rec.fixReason === 'checks'
          ? `Fixing checks on PR #${rec.prNumber}`
          : rec.fixReason === 'dlp'
            ? `Remediating DLP policy violations on PR #${rec.prNumber}`
            : `Fixing PR #${rec.prNumber} after QA round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );
    if (!await this.checkTaskCapabilities(dev, repo, resume, generation)) { if (this.ownsTask(dev, generation)) this.setQa(rec, { status: 'failed' }); return; }
    let headRef: string;
    try {headRef = pull?.headRefName ?? (await this.backend.prDetails(repo.fullName, rec.prNumber)).headRefName;}
    catch {if (this.ownsTask(dev, generation)) {dev.status = 'error'; dev.lastError = 'Repair PR metadata is unavailable'; this.setQa(rec, {status: 'failed'}); this.emitAgent(dev);} return;}
    if (!this.ownsTask(dev, generation)) return;
    const cwd = await this.prepare(dev, repo, { pr: rec.prNumber }, branch, generation);
    if (!this.ownsTask(dev, generation)) return;
    if (!cwd) {
      if (rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    const failed = rec.checks.filter((c) => c.result === 'fail');
    const takeover = original ? '' : ' A teammate wrote it, so read the PR and the linked issue first.';
    const push = `push to the same branch: git push origin HEAD:${headRef}`;
    const mergeFix =
      rec.fixReason === 'conflict'
        ? [
            `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but it now conflicts with ${repo.defaultBranch} because other work was merged first.${takeover}`,
            '',
            `Bring it up to date: git fetch origin && git merge origin/${repo.defaultBranch}. Resolve the conflicts so both this change and the newly merged work keep working, run the project's checks, and ${push}`,
          ]
        : rec.fixReason === 'checks'
          ? [
              `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but GitHub checks failed on it.${takeover}`,
              '',
              `Failed checks:\n${rec.fixInstructions ?? ''}`,
              '',
              `Read the logs with gh pr checks ${rec.prNumber} -R ${repo.fullName} (for GitHub Actions: gh run view <run id> -R ${repo.fullName} --log-failed). Fix the cause, run the same checks locally where you can, and ${push}`,
              `If a failure clearly has nothing to do with this change (a flaky test or a service outage), re-run it instead with gh run rerun <run id> -R ${repo.fullName} --failed, and say so.`,
            ]
          : rec.fixReason === 'dlp'
            ? [
                `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but Enterprise Data Loss Prevention (DLP) policy violations were detected before merge.${takeover}`,
                '',
                `${rec.fixInstructions ?? ''}`,
                '',
                `Remediate these violations by removing or replacing blocked/unauthenticated connectors with approved enterprise connectors (Microsoft Dataverse, Azure OpenAI, Teams, SharePoint), and ${push}`,
              ]
            : null;
    const qaFix = [
      original
        ? `QA tester ${qaAgent?.name ?? 'QA'} tested your pull request #${rec.prNumber} and it FAILED (round ${rec.round}).`
        : `You are taking over pull request #${rec.prNumber} (${pull?.url ?? ''}), written by a teammate, because QA failed it (round ${rec.round}). Read the PR and the linked issue first.`,
      '',
      `QA summary: ${rec.summary ?? ''}`,
      failed.length ? `Failed checks:\n${failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')}` : '',
      rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `\nFull report with screenshots: ${rec.commentUrl}` : '',
      '',
      `Fix these problems, re-run the relevant checks, and push to the same branch: git push origin HEAD:${headRef}`,
      'Then reply with a short summary of what you changed. Do not open a new pull request; QA will re-test automatically.',
    ];
    const mergeEnd = 'Then reply with a short summary of what you did. Do not open a new pull request; the office merges it once the checks pass, after another QA round if the code changed.';
    const prompt = (mergeFix ? [...mergeFix, '', mergeEnd] : qaFix).filter((l) => l !== '').join('\n');
    this.startAgentSession(dev, repo, cwd, prompt, this.buildSystemAppend(dev, repo, cwd, branch, { pr: rec.prNumber, headRef }), resume);
  }

  private onFixFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    if (a.status === 'stopped') {
      if (rec?.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    if (!result.ok) {
      this.fail(a, result, `the fix for PR #${a.prNumber}`);
      // Someone else gets a go before it lands on the manager.
      const failures = rec ? rec.sessionFailures + (this.limited() ? 0 : 1) : 0;
      if (rec) this.setQa(rec, { status: failures >= 2 ? 'needs-human' : 'failed', sessionFailures: failures });
      return;
    }
    a.status = 'done';
    if (rec && (rec.fixReason === 'checks' || rec.fixReason === 'conflict')) {
      // Back in line to merge: new commits go through QA again first, a re-run of flaky checks doesn't.
      this.appendLog(a, [{ kind: 'done', text: `✔ PR #${a.prNumber} fixed in ${this.minutes(a)}m. Back in line to merge.` }]);
      this.setQa(rec, { status: 'passed', ...developerCheckpoint(a, rec), mergeNote: 'waiting for fresh checks' });
      this.toast('info', `${a.name} fixed PR #${rec.prNumber}; it merges once it passes again`);
      return;
    }
    this.appendLog(a, [{ kind: 'done', text: `✔ Fix pushed for PR #${a.prNumber} in ${this.minutes(a)}m. Back to QA.` }]);
    if (rec) {
      this.setQa(rec, { status: 'queued', round: rec.round + 1, ...developerCheckpoint(a, rec) });
      this.toast('info', `${a.name} pushed fixes for PR #${rec.prNumber}; QA round ${rec.round} is queued`);
    }
  }

  /** A message for an agent: sent into their running session, or a follow-up that resumes it. typed: the manager typed it at their CLI's prompt, where it's already running. */
  async message(id: string, text: string, typed = false) {
    this.requireOpen();
    const a = this.agent(id);
    if (a.role === 'ceo') return this.messageCeo(text);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Empty message');
    if (this.taskPaused(text) || this.taskPaused(a.issueTitle ?? '')) throw new HttpError(409, 'This platform is paused by the manager');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      const session = rt.session;
      if (!typed && a.sessionCli === 'copilot') {
        throw new HttpError(409, `${a.name} is running a non-interactive Copilot task; send a follow-up after it finishes.`);
      }
      const blocker = await this.sessionReadiness(a, repo, a.sessionId ?? undefined);
      if (this.closed || rt.session !== session) throw new HttpError(409, 'Session changed during readiness verification; retry the follow-up');
      if (blocker) throw new HttpError(409, blocker);
      await this.verifyTaskInputs(this.backend.deskDir(repo.fullName,this.agentSlug(a)),this.deliveryTaskInputs(repo.id,a.issueNumber??0));
      if(this.closed||rt.session!==session||!this.validWorkerAdmission(a,repo))throw new HttpError(409,'Session readiness changed during input verification');
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
      if (!typed) rt.session.send(text);
      return;
    }
    if (a.role === 'qa') throw new HttpError(409, `${a.name} isn't testing anything right now. Send a PR to QA from the Kanban board.`);
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} is still setting up; try again in a moment`);
    if (!a.sessionId || !a.branch || a.task === 'qa') throw new HttpError(409, `${a.name} has no session to continue. Assign an issue instead.`);
    this.ensureSlot();
    const generation = this.reserveTask(a);
    a.status = 'preparing'; this.emitAgent(a); this.save();
    const ready = await this.checkTaskCapabilities(a, repo, a.sessionId, generation);
    if (!this.ownsTask(a, generation)) throw new HttpError(409, 'Session stopped during readiness verification');
    if (!ready) throw new HttpError(409, a.lastError || 'Session readiness is unavailable');
    if (a.status !== 'preparing') throw new HttpError(409, 'Session stopped during readiness verification');
    await this.deskWriters.get(a.id)?.drain().catch(() => undefined);
    if (!this.ownsTask(a, generation) || a.status !== 'preparing') throw new HttpError(409, 'Session stopped while waiting for its worktree');
    this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
    const cwd = this.backend.deskDir(repo.fullName, this.agentSlug(a));
    try{await this.verifyTaskInputs(cwd,this.deliveryTaskInputs(repo.id,a.issueNumber??0));}
    catch(error){if(this.ownsTask(a,generation)){a.status='error';a.lastError=error instanceof Error?error.message:'Prerequisite checkout unavailable';this.emitAgent(a);this.save();}throw error;}
    if(!this.ownsTask(a,generation)||!this.validWorkerAdmission(a,repo))throw new HttpError(409,'Session readiness changed during input verification');
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    if (!this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId, undefined, typed ? 'typed' : null)) throw new HttpError(409, a.lastError || 'Session admission was cancelled');
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    this.requireOpen();
    const s = this.state.settings;
    if(patch.defaultCli!==undefined&&!isCli(patch.defaultCli))throw new HttpError(400,'Only Codex, Gemini and OpenCode are permitted');
    if(patch.runtime==='sdk')throw new HttpError(400,'Claude SDK runtime is disabled');
    const nextCli=patch.defaultCli??s.defaultCli,nextModel=patch.defaultModel===undefined?(nextCli!==s.defaultCli?'':s.defaultModel):patch.defaultModel;
    if(typeof nextModel!=='string')throw new HttpError(400,'Model must be a string');
    const modelError=runtimeModelError(nextCli,nextModel);if(modelError)throw new HttpError(400,modelError);
    if (patch.sessionLimit !== undefined) s.sessionLimit = Math.max(0, Math.round(Number(patch.sessionLimit)) || 0);
    // The default model belongs to the default coding agent: a new agent starts on its own default.
    if (isCli(patch.defaultCli) && patch.defaultCli !== s.defaultCli) {
      s.defaultCli = patch.defaultCli;
      if (patch.defaultModel === undefined) s.defaultModel = '';
    }
    if (patch.defaultModel !== undefined) s.defaultModel = patch.defaultModel.trim();
    if (patch.defaultEffort !== undefined && EFFORTS.includes(patch.defaultEffort)) s.defaultEffort = patch.defaultEffort;
    if (patch.runtime === 'terminal' || patch.runtime === 'sdk') s.runtime = patch.runtime;
    if (patch.hiring === 'approve' || patch.hiring === 'auto') s.hiring = patch.hiring;
    if (patch.teamCap !== undefined) s.teamCap = Math.max(1, Math.min(15, Math.round(Number(patch.teamCap)) || 1));
    if (patch.ceoHeartbeatMin !== undefined) s.ceoHeartbeatMin = Math.max(0, Math.min(1440, Math.round(Number(patch.ceoHeartbeatMin)) || 0));
    if (typeof patch.managerName === 'string') s.managerName = patch.managerName.trim().slice(0, 40);
    if (typeof patch.companyName === 'string') s.companyName = patch.companyName.trim().slice(0, 60);
    if (typeof patch.projectsDir === 'string' && patch.projectsDir.trim()) s.projectsDir = path.resolve(patch.projectsDir.trim());
    if (typeof patch.setupDone === 'boolean') s.setupDone = patch.setupDone;
    if (patch.tutorialStep !== undefined) s.tutorialStep = Math.max(-1, Math.round(Number(patch.tutorialStep)) || 0);
    if (typeof patch.autoUpdate === 'boolean') s.autoUpdate = patch.autoUpdate;
    if (patch.pacingSessions !== undefined) s.pacingSessions = clampPacingSessions(patch.pacingSessions);
    for(const repo of this.state.repos)this.ensureQaTester(repo);
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    this.emitSessionUsage();
    this.emitCeo();
    this.later(() => this.schedule(), 200);
    return s;
  }

  /** The setup wizard: who you are, the company, and your CEO. */
  setup(x: { managerName?: string; companyName?: string; hiring?: string; ceoName?: string; ceoLook?: string; ceoColor?: string }) {
    this.requireOpen();
    this.updateSettings({
      managerName: x.managerName,
      companyName: x.companyName,
      ...(x.hiring === 'auto' || x.hiring === 'approve' ? { hiring: x.hiring } : {}),
    });
    const ceo = this.ceo();
    this.updateAgent(ceo.id, { name: x.ceoName, color: x.ceoColor });
    if (LOOKS.includes(x.ceoLook as AgentLook)) this.updateAgent(ceo.id, { look: x.ceoLook });
    return this.state.settings;
  }

  // ---------- scheduling ----------

  /**
   * Agents on a floor who can take work now. One whose last session failed sits out a short cooldown, then gets work
   * like everyone else instead of waiting for the manager to reset them.
   */
  private available(repo: PersistedRepo, role: AgentRole) {
    const now = Date.now();
    return this.state.agents
      .filter((a) => a.repoId === repo.id && a.role === role && !this.workerModelBlockedForScheduling(a) && !this.workerPreflightDeferred(a,repo) && (FREE.includes(a.status) || (a.status === 'error' && (!!a.preflightRetry || now - (a.endedAt ?? 0) >= ERROR_COOLDOWN_MS))))
      .sort((x, y) => x.desk - y.desk);
  }

  private scheduleOffset = 0;
  private issueFailures = new Map<string, number>(); // `${repoId}#${issue}` → failed sessions on it
  private nudged = new Set<string>(); // `${repoId}#${issue}`: its developer was asked once to finish the missing PR
  private pausedUntil = 0; // Coding runtime usage limit was hit: nothing new starts before this
  private pacingUntil = 0; // Claude warned about usage: new issues are paced until this
  private lastUsage = '';

  /** Backlog issues that can start now, most urgent first: the ones holding up the longest chain of other issues, then the oldest. */
  private readyIssues(repo: PersistedRepo) {
    const issues = this.repoRt.get(repo.id)!.issues;
    const open = new Set(issues.map((i) => i.number));
    const weight = holdUps(issues);
    return issues
      .filter(
        (i) =>
          !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) &&
          !this.issueTaken(repo, i.number) &&
          blockers(i.body, open).length === 0 &&
          (this.issueFailures.get(`${repo.id}#${i.number}`) ?? 0) < MAX_ISSUE_FAILURES,
      )
      .map((issue) => ({ issue, want: issueSpecialty(issue.labels), ...weight.get(issue.number)! }))
      .sort((x, y) => y.chain - x.chain || y.waiting - x.waiting || x.issue.number - y.issue.number);
  }

  /**
   * The free developer to put on a job: one it `suits` first, then whoever is least needed elsewhere (fewest ready
   * issues in their specialty, then the least open work in it), so specialists stay free for their own lane.
   */
  private pickDev(repo: PersistedRepo, devs: PersistedAgent[], suits: (a: PersistedAgent) => boolean) {
    if (devs.length <= 1) return devs[0];
    const ready = this.readyIssues(repo).map((r) => r.want);
    const open = this.repoRt.get(repo.id)!.issues.map((i) => issueSpecialty(i.labels));
    const rank = (a: PersistedAgent) => {
      const s = a.specialty.toLowerCase();
      return [suits(a) ? 0 : 1, ready.filter((w) => w === s).length, open.filter((w) => w === s).length, a.desk];
    };
    return devs
      .map((a) => ({ a, r: rank(a) }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.r[2] - y.r[2] || x.r[3] - y.r[3])[0].a;
  }

  /**
   * Finish work in flight: test queued PRs (oldest first) and get failed ones fixed. Returns true if work started.
   * QA testers test; when they're all busy, a free developer who didn't write the PR covers for them, so QA never
   * holds up the floor. A failed PR goes back to its author when they're free, and otherwise to any free developer.
   */
  private startPipelineWork(repo: PersistedRepo): boolean {
    const devs = this.available(repo, 'dev');
    const testers = this.available(repo, 'qa');
    const waiting = (status: QaRecord['status']) => this.state.qa.filter((q) => {
      if(q.repoId!==repo.id||q.status!==status)return false;
      const pull=this.repoRt.get(repo.id)?.pulls.find(pull=>pull.number===q.prNumber);
      if(this.taskPaused?.(pull?.title??this.repoRt.get(repo.id)?.issues.find(issue=>issue.number===q.issueNumber)?.title??''))return false;
      try{if(!this.backend.demo)this.deliveryWorkGate(repo.id,q.issueNumber??pull?.closesIssues[0]??0);return true;}catch{return false;}
    }).sort((x,y)=>x.updatedAt-y.updatedAt);
    for (const rec of waiting('queued')) {
      const tester =
        testers.find(a=>this.canAccessTask(a,repo,rec.issueNumber??0,true)&&(this.manualQaRetries.has(rec)||!this.qaExecutionHeld(a,repo,rec.issueNumber??0))) ??
        this.pickDev(
          repo,
          devs.filter((a) => a.id !== rec.devAgentId&&this.canAccessTask(a,repo,rec.issueNumber??0,true)&&(this.manualQaRetries.has(rec)||!this.qaExecutionHeld(a,repo,rec.issueNumber??0))),
          (a) => /test|qa/i.test(a.specialty),
        );
      if (!tester) continue;
      const manual=this.manualQaRetries.delete(rec);
      if(!manual)this.automaticAgents.add(tester.id);try{void this.runQa(tester, repo, rec);}finally{this.automaticAgents.delete(tester.id);}
      return true;
    }
    for (const rec of waiting('failed')) {
      const issue = this.repoRt.get(repo.id)!.issues.find((i) => i.number === rec.issueNumber);
      const want = issue ? issueSpecialty(issue.labels) : null;
      const eligible=devs.filter(a=>this.canAccessTask(a,repo,rec.issueNumber??0)&&!this.executionHeld(a,repo,rec.issueNumber??0));
      const dev = eligible.find((a) => a.id === rec.devAgentId) ?? this.pickDev(repo, eligible, (a) => a.specialty.toLowerCase() === want);
      if (!dev) break;
      this.automaticAgents.add(dev.id);try{void this.runFix(dev,repo,rec);}finally{this.automaticAgents.delete(dev.id);}
      return true;
    }
    return false;
  }

  /**
   * Give a free developer the next backlog issue (auto-assign floors only). Returns true if work started.
   * Issues that say "Depends on #N" wait until #N is closed; the rest go in readyIssues() order. A swarm:<specialty>
   * label is a preference, not a lock: a free specialist gets first pick, and otherwise the issue goes to whichever
   * free developer is least needed elsewhere, so nobody sits idle while there is work that can start.
   */
  private startIssueWork(repo: PersistedRepo): boolean {
    // Planning publishes scope/task revisions. Admit workers only after that
    // transaction finishes; later scope drift still revokes their authority.
    const planning=this.state.ceo.job;
    if(planning&&['onboard','plan'].includes(planning.kind)&&'repoId' in planning&&planning.repoId===repo.id)return false;
    if (!repo.autoAssign || !this.mayStart('issue')) return false;
    const free = this.available(repo, 'dev');
    const ready = free.length ? this.readyIssues(repo).filter((item) => {
      if(this.taskPaused?.(item.issue.title))return false;
      if(!free.some(a=>this.canAccessTask(a,repo,item.issue.number)&&!this.executionHeld(a,repo,item.issue.number)))return false;
      try{if(!this.backend.demo)this.deliveryWorkGate(repo.id,item.issue.number);return true;}catch{return false;}
    }) : [];
    if (ready.length === 0) return false;
    const fits = (a: PersistedAgent, want: string) => a.specialty.toLowerCase() === want;
    // Of the issues holding up the most, take one a free specialist fits.
    const pick = ready.find((r) => r.chain === ready[0].chain && free.some((a) => this.canAccessTask(a,repo,r.issue.number)&&fits(a, r.want))) ?? ready[0];
    const agent = this.pickDev(repo, free.filter(a=>this.canAccessTask(a,repo,pick.issue.number)&&!this.executionHeld(a,repo,pick.issue.number)), (a) => fits(a, pick.want))!;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    this.automaticAgents.add(agent.id);try{void this.assign(agent.id,pick.issue.number).catch(err=>console.warn('auto-assign failed',err));}finally{this.automaticAgents.delete(agent.id);}
    return agent.status === 'preparing';
  }

  private limited() {
    return Date.now() < this.pausedUntil;
  }

  /** Claude turned a session away for the usage limit: start nothing new until it resets, rather than failing agent after agent. */
  private pauseForLimit(resetsAt: number | null) {
    const until = (resetsAt ?? Date.now() + LIMIT_PAUSE_MS) + 30_000;
    if (until <= this.pausedUntil) return;
    const fresh = Date.now() >= this.pausedUntil;
    this.pausedUntil = until;
    if (fresh) this.postMessage('office', `⏸ Coding runtime usage limit was reached. The office starts no new work until ${new Date(until).toLocaleTimeString()}; sessions already running carry on.`);
    this.emitUsage();
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets, rather than run into the limit. */
  private paceForWarning(info: UsageWarning) {
    const now = Date.now();
    const until = info.resetsAt && info.resetsAt > now ? info.resetsAt : now + PACING_MS;
    if (until <= this.pacingUntil) return;
    const fresh = now >= this.pacingUntil;
    this.pacingUntil = until;
    if (fresh) this.postMessage('office', pacingMessage(info, until, this.state.settings.pacingSessions, now));
    this.emitUsage();
  }

  /** May work of this kind start now, as far as Coding runtime usage goes? */
  private mayStart(kind: WorkKind) {
    return mayStart(kind, { now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running: this.running(), pacingSessions: this.state.settings.pacingSessions });
  }

  private usageNow() {
    return usageView({ now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil });
  }

  private emitUsage() {
    const usage = this.usageNow();
    const key = JSON.stringify(usage);
    if (key === this.lastUsage) return;
    this.lastUsage = key;
    this.broadcast({ type: 'usage', usage });
  }

  /** Pacing and pauses run out on their own: say so when pacing ends. */
  private tickUsage() {
    if (this.pacingUntil && Date.now() >= this.pacingUntil) {
      this.pacingUntil = 0;
      this.postMessage('office', "✅ Coding runtime usage is back to normal. The office starts new work at full speed again.");
    }
    this.emitUsage();
  }

  /** A failed session releases its issue for someone else; an issue that keeps failing waits for the manager. */
  private issueFailed(repo: PersistedRepo, n: number | null) {
    if (n == null || this.limited()) return; // the usage limit isn't the issue's fault
    const key = `${repo.id}#${n}`;
    const failures = (this.issueFailures.get(key) ?? 0) + 1;
    this.issueFailures.set(key, failures);
    if (failures === MAX_ISSUE_FAILURES) {
      this.postMessage('office', `⚠️ Issue #${n} on ${repo.fullName} failed ${failures} sessions in a row, so auto-assign skips it now. Assign it to someone by hand once it's sorted.`);
    }
  }

  /**
   * Hand out work for free session slots. Finishing beats starting: QA and QA fixes on every floor go before any new issue.
   * Within each phase floors take turns (one job per floor per pass), and the starting floor rotates between calls,
   * so no repo can hog the slots.
   */
  private schedule() {
    if (this.closed || this.draining) return;
    this.tickUsage();
    if (this.officeUpdateTick()) return; // draining for the office's own update
    if (this.limited()) return;

    // Management first: the CEO's jobs are short and shape everyone else's work.
    this.maybeHeartbeat();
    this.startCeoWork();
    const repos = this.state.repos.filter((r) => {
      const rt = this.repoRt.get(r.id);
      return rt && rt.lastSync != null && rt.cloneStatus !== 'error';
    });
    if (repos.length === 0) return;
    this.scheduleOffset = (this.scheduleOffset + 1) % repos.length;
    const order = [...repos.slice(this.scheduleOffset), ...repos.slice(0, this.scheduleOffset)];
    for (const start of [(r: PersistedRepo) => this.startPipelineWork(r), (r: PersistedRepo) => this.startIssueWork(r)]) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const repo of order) {
          if (this.slotsFull()) return;
          if (start(repo)) progress = true;
        }
      }
    }
  }

  // ---------- the office's own update ----------

  private drainInput(): DrainInput {
    const u = this.officeUpdate;
    return {
      now: Date.now(),
      behind: this.officeHead ? u.behind : 0,
      launcher: this.backend.office.launcher,
      autoUpdate: this.state.settings.autoUpdate !== false,
      requested: u.requested,
      postponedUntil: u.postponedUntil,
      postponedBehind: u.postponedBehind,
      failed: u.failed,
      failedBehind: u.failedBehind,
      drainingSince: u.drainingSince,
      sent: u.sent,
      running: this.running(),
    };
  }

  private officeUpdateView(): OfficeUpdateView {
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    const until = u.postponedUntil ? new Date(u.postponedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const detail = d.state === 'failed' ? u.failed : d.state === 'waiting' ? `Postponed until ${until}, or until a newer commit lands.` : null;
    return { state: d.state, behind: input.behind, launcher: input.launcher, drainingSince: u.drainingSince ?? d.drainingSince, running: input.running, detail };
  }

  private emitOfficeUpdate() {
    if (!this.officeHead) return;
    const view = this.officeUpdateView();
    const key = JSON.stringify(view);
    if (key === this.lastOfficeView) return;
    this.lastOfficeView = key;
    this.broadcast({ type: 'officeUpdate', officeUpdate: view });
  }

  /** The own-folder check found the office this many commits behind GitHub. */
  private setOfficeBehind(behind: number) {
    const u = this.officeUpdate;
    if (u.failed && u.failedBehind === null) u.failedBehind = behind; // only a newer commit retries a failed update by itself
    u.behind = behind;
    if (behind === 0) Object.assign(u, { requested: false, failed: null, failedBehind: null });
    this.officeUpdateTick();
  }

  /**
   * Take the office's own update one step (see drainDecision): drain, and once nothing is running, or the drain timed
   * out, hand it to the launcher. True while nothing new may start.
   */
  private officeUpdateTick(): boolean {
    if (!this.officeHead) return false;
    const u = this.officeUpdate;
    const d = drainDecision(this.drainInput());
    if (d.state === 'draining' && u.drainingSince === null) {
      const running = this.running();
      this.postMessage(
        'office',
        `⬆️ Updating the office (${u.behind} new commit${u.behind === 1 ? '' : 's'}). Nothing new starts${running ? ` while ${running} running session${running === 1 ? '' : 's'} finish` : ''}; then it installs and restarts.`,
      );
    }
    u.drainingSince = d.drainingSince;
    if (d.send) void this.handOver(d.timedOut);
    this.emitOfficeUpdate();
    return d.state === 'draining' || d.state === 'updating';
  }

  /** Drained: hand the update to the launcher. Sessions still running after the timeout stop the way a restart stops them. */
  private async handOver(timedOut: boolean) {
    const u = this.officeUpdate;
    const from = this.officeHead!;
    u.sent = true;
    const busy = this.state.agents.filter((a) => BUSY.includes(a.status));
    if (timedOut) this.postMessage('office', `⏱ ${busy.length} session${busy.length === 1 ? ' was' : 's were'} still running after 20 minutes. Stopped; the work goes back to the queue after the update.`);
    this.emitOfficeUpdate();
    u.handedOver = true;
    await this.writeState().catch((err) => console.warn('could not save the state', err)); // still "working": the restarted office recovers them
    for (const a of busy) this.agentRt.get(a.id)?.session?.stop();
    try {
      const result = await this.backend.office.update(from);
      if (result) await this.afterUpdate(result); // the demo: nothing restarts
    } catch (err) {
      await this.afterUpdate({ from, to: from, ok: false, error: `the launcher didn't take the update: ${oneLine(err)}`, installed: false, built: false, at: Date.now() });
    }
  }

  /** An update that didn't restart the office (the demo, or a failed hand-over): recover like a restart would, then report it. */
  private async afterUpdate(result: LastUpdate) {
    const u = this.officeUpdate;
    Object.assign(u, { sent: false, handedOver: false, requested: false, drainingSince: null });
    const interrupted = this.state.agents.filter((a) => BUSY.includes(a.status));
    for (const a of interrupted) {
      Object.assign(a, { status: 'stopped', lastError: 'The office updated itself while this agent was working.' });
      const rt = this.agentRt.get(a.id);
      if (rt) Object.assign(rt, { session: null, currentTool: null });
    }
    this.ensureCeo(interrupted);
    this.recover(interrupted);
    interrupted.forEach((a) => this.emitAgent(a));
    await this.reportUpdate(result);
    if (!result.ok) u.failedBehind = u.behind;
    const own = this.state.repos.find((r) => this.backend.office.isOwnFolder(this.backend.mainDir(r.fullName)));
    if (own) await this.syncFolder(own);
    this.emitCeo();
    this.save();
    this.later(() => this.schedule(), 300);
  }

  /** One phone message about the last update (the launcher's last-update.json, or the demo's fake). */
  private async reportUpdate(result: LastUpdate) {
    const commits = result.ok && result.to ? await this.backend.office.commitsBetween(result.from, result.to) : null;
    this.postMessage('office', lastUpdateMessage(result, commits));
    Object.assign(this.officeUpdate, { failed: result.ok ? null : result.error || 'unknown error', failedBehind: null });
  }

  /** The manager's Update now (drain now, even with automatic updates off) or Later (not for 2 hours, or until a newer commit). */
  updateOffice(action: unknown): OfficeUpdateView {
    this.requireOpen();
    if (action !== 'now' && action !== 'later') throw new HttpError(400, 'action must be "now" or "later"');
    const u = this.officeUpdate;
    if (!this.officeHead || !this.backend.office.launcher) throw new HttpError(409, 'The office can only update itself when its launcher started it (npm run dev or npm start).');
    if (u.sent) throw new HttpError(409, 'The update is already under way.');
    if (u.behind <= 0) throw new HttpError(409, 'The office is up to date: there is nothing to update.');
    if (action === 'now') Object.assign(u, { requested: true, postponedUntil: null });
    else Object.assign(u, { requested: false, postponedUntil: Date.now() + POSTPONE_MS, postponedBehind: u.behind });
    this.officeUpdateTick();
    this.later(() => this.schedule(), 200);
    return this.officeUpdateView();
  }

  // ---------- the CEO ----------

  private ceo() {
    return this.state.agents.find((a) => a.id === CEO_ID)!;
  }

  /** The company always has a CEO. One cut off by a server restart picks its job back up. */
  private ensureCeo(interrupted: PersistedAgent[]) {
    let a = this.state.agents.find((x) => x.id === CEO_ID);
    if (!a) {
      a = {
        id: CEO_ID,
        name: CEO_NAME,
        repoId: '',
        role: 'ceo',
        title: 'Chief Executive Officer',
        specialty: '',
        brief: '',
        hiredBy: 'manager',
        look: lookFor(CEO_NAME),
        task: null,
        desk: 0,
        color: '#e63946',
        hair: '#2b2118',
        skin: pick(SKIN),
        model: CEO_MODEL,
        effort: CEO_EFFORT,
        cli: 'codex',
        status: 'idle',
        issueNumber: null,
        issueTitle: null,
        branch: null,
        prNumber: null,
        prUrl: null,
        startedAt: null,
        endedAt: null,
        costUsd: 0,
        turns: 0,
        sessionId: null,
        sessionCli: null,
        lastError: null,
        logTail: [],
      };
      this.state.agents.push(a);
      this.agentRt.set(a.id, { log: [], pending: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
      this.appendLog(a, [{ kind: 'system', text: `🏛️ ${a.name} moved into the corner office. The CEO studies every floor, shapes its team and plans its work.` }]);
    }
    const i = interrupted.indexOf(a);
    if (i >= 0) {
      interrupted.splice(i, 1);
      a.status = 'idle';
      a.lastError = null;
      this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Picking the job back up.' }]);
    }
    if (this.state.ceo.job && !this.state.ceo.recoveryHold && !BUSY.includes(a.status)) {
      this.state.ceo.queue.unshift(this.state.ceo.job);
      this.state.ceo.job = null;
    }
    this.state.ceo.lastReviewAt ??= Date.now(); // the first review comes one heartbeat after the office opens
  }

  private ceoFloor(repoId?: string) {
    const repo = repoId ? this.state.repos.find((r) => r.id === repoId) : undefined;
    if (!repo) return null;
    return {
      floor: repo.floor,
      fullName: repo.fullName,
      clone: this.backend.mainDir(repo.fullName),
      mission: repo.mission,
      backlog: this.repoRt.get(repo.id)?.issues.length ?? 0,
      targetTenancy: repo.targetTenancy,
    };
  }

  private ceoInfo(): CeoInfo {
    const c = this.state.ceo;
    const view = (j: CeoJob) => ({ kind: j.kind, label: jobLabel(j, this.ceoFloor(j.repoId)) });
    const min = this.state.settings.ceoHeartbeatMin;
    return {
      queue: c.queue.map(view),
      job: c.job ? view(c.job) : null,
      lastReviewAt: c.lastReviewAt,
      nextReviewAt: min > 0 && c.lastReviewAt ? c.lastReviewAt + min * 60_000 : null,
      blockedReason: c.blockedReason,
      retryAt: c.retryAt,
    };
  }

  private emitCeo() {
    this.broadcast({ type: 'ceo', ceo: this.ceoInfo() });
  }

  /** Queue a job for the CEO: one onboarding or plan per floor, one review, and chat messages merge into one reply. */
  private enqueueCeo(job: CeoJob) {
    this.state.ceo.retryAt = null; // new operator/capability information permits an immediate retry
    const q = this.state.ceo.queue;
    if (job.kind === 'plan' && q.some((j) => j.kind === 'onboard' && j.repoId === job.repoId)) return; // onboarding plans from the brief too
    const same = q.findIndex((j) => j.kind === job.kind && (job.kind === 'review' || job.kind === 'chat' || j.repoId === job.repoId));
    if (same >= 0) q[same] = job.kind === 'chat' ? { ...q[same], text: `${q[same].text}\n${job.text}` } : job;
    else q.push(job);
    this.emitCeo();
    this.save();
    this.later(() => this.schedule(), 150);
  }

  private ceoCli(a:PersistedAgent):AgentCli{return isCli(a.cli)?a.cli:'codex';}
  private ceoModelFingerprint(model:string,cli:AgentCli='codex'){return crypto.createHash('sha256').update(JSON.stringify([cli,'unsupported-model',model])).digest('hex');}
  private holdCeoModel(model:string,unverified=false){
    const selected=this.state.agents.find(agent=>agent.id===CEO_ID);
    const reason=(unverified?'The configured CEO model is not advertised in verified native metadata.':'The coding runtime rejected the configured CEO model.')+' Select an available model, clear the override, or select a compatible coding agent; queued work is held until the model changes or its coding agent changes.';
    this.state.ceo.modelBlock={fingerprint:this.ceoModelFingerprint(model,selected?this.ceoCli(selected):'codex'),reason};
    this.state.ceo.blockedReason=reason;this.state.ceo.retryAt=null;
  }
  /** Start the CEO's next job when they're free and a session slot is open. Replies to the manager go first. */
  private startCeoWork(): void {
    if (this.closed) return;
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    if(c.modelBlock&&a){
      if(c.modelBlock.fingerprint===this.ceoModelFingerprint(a.model||CEO_MODEL,this.ceoCli(a)))return;
      if(c.blockedReason===c.modelBlock.reason)c.blockedReason=null;
      c.modelBlock=null;c.retryAt=null;
    }
    if (c.retryAt && Date.now() < c.retryAt) return;
    if (!a || BUSY.includes(a.status) || c.job || c.queue.length === 0) return;
    if (this.slotsFull()) return;
    const rank: Record<CeoJob['kind'], number> = { chat: 0, onboard: 1, plan: 1, review: 2 };
    // A floor's jobs wait for its clone and first sync, so the CEO has something to read.
    const ready = (j: CeoJob) => {
      const rt = j.repoId ? this.repoRt.get(j.repoId) : undefined;
      return !rt || rt.cloneStatus === 'error' || (rt.cloneStatus === 'ready' && rt.lastSync != null);
    };
    const job = [...c.queue].sort((x, y) => rank[x.kind] - rank[y.kind]).find(ready);
    if (!job) return;
    c.queue.splice(c.queue.indexOf(job), 1);
    const rt = job.repoId ? this.repoRt.get(job.repoId) : undefined;
    if (job.repoId && (!rt || rt.cloneStatus === 'error')) {
      const repo = this.state.repos.find((r) => r.id === job.repoId);
      if (repo) this.postMessage('office', `⚠️ ${a.name} couldn't study floor ${repo.floor}: the repository clone failed (${rt?.cloneError ?? 'unknown error'}).`);
      this.emitCeo();
      this.save();
      return this.startCeoWork();
    }
    void this.runCeoJob(a, job);
  }

  private async runCeoJob(a: PersistedAgent, job: CeoJob,held?:ReconnectedCli) {
    if (this.closed) return;
    const generation = this.reserveTask(a);
    const ownsJob = () => this.ownsTask(a, generation) && this.state.ceo.job === job;
    const rt = this.agentRt.get(a.id)!;
    const defer=(reason:string)=>{if(held){this.holdRetainedCeo(a,job,reason);rt.terminal?.releaseIdle?.();}else this.deferCeoJob(a,job,reason);};
    const floor = this.ceoFloor(job.repoId);
    const label = jobLabel(job, floor);
    this.state.ceo.job = job;
    Object.assign(a, { status: 'preparing' as AgentStatus, task: null, issueNumber: null, issueTitle: label, startedAt:held?a.startedAt??Date.now():Date.now(), endedAt: null, costUsd:held?a.costUsd:0, turns:held?a.turns:0, lastError: null });
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${label} ━━━` },
    ]);
    if (job.kind === 'chat') this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${job.text}` }]);
    this.ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    const scopeIds = job.repoId ? [job.repoId, ...this.repo(job.repoId).links] : this.state.repos.map(repo => repo.id);
    const scope = () => JSON.stringify(this.state.repos.map(repo => [repo.id, repo.fullName, repo.localPath, repo.targetTenancy, repo.defaultBranch, repo.links, repo.mission, repo.summary, repo.qaBrief]));
    const checkedScope = scope();
    const selectedCli=this.ceoCli(a),runtimeScope=()=>JSON.stringify([this.ceoCli(a),a.model||CEO_MODEL,a.effort||CEO_EFFORT]),checkedRuntime=runtimeScope();
    let blocker: string | null = null;
    if (!this.backend.demo) {
      if (!this.backend.terminals) blocker = 'CEO terminal runtime is unavailable; install the supported terminal runtime and refresh readiness';
      else {
        blocker = await this.boundedReadiness(() => this.ceoPreflight([...scopeIds],selectedCli), 'CEO', this.taskStops.get(a.id)?.signal);
      }
    }
    if (this.closed) return;
    if (!ownsJob()) {if(held)rt.terminal?.releaseIdle?.();return;}
    if (a.status !== 'preparing') {
      // stopped before the session started
      if (held) rt.terminal?.releaseIdle?.();
      this.state.ceo.job = null;
      this.emitCeo();
      this.save();
      return;
    }
    if (checkedScope !== scope()) blocker = 'CEO project scope changed during readiness verification; retry with the current projects';
    if(checkedRuntime!==runtimeScope())blocker='CEO runtime configuration changed during readiness; recheck the selected CLI before execution';
    if (blocker) return defer(blocker);
    try { await fs.mkdir(CEO_DIR, {recursive: true}); }
    catch { if (ownsJob()) defer('CEO workspace is unavailable; repair its folder access before retrying'); return; }
    if (this.closed) return;
    if (!ownsJob()) {if(held)rt.terminal?.releaseIdle?.();return;}
    if (a.status !== 'preparing') { if (held) rt.terminal?.releaseIdle?.(); this.state.ceo.job = null; this.emitCeo(); this.save(); return; }
    if (checkedScope !== scope()) return defer('CEO project scope changed while preparing its workspace; retry with the current projects');
    if(checkedRuntime!==runtimeScope())return defer('CEO runtime configuration changed while preparing its workspace; retry with current readiness');
    a.status = 'working'; this.emitAgent(a); this.emitCeo();
    const s = this.state.settings;
    // A chat carries on from the CEO's last session, so "why did you propose that?" has an answer.
    try {
    const how = this.sessionRuntime(a, held?a.sessionId??undefined:job.kind === 'chat' ? (a.sessionId ?? undefined) : undefined);
    let completed = false;
    const live = () => !completed && ownsJob() && a.status === 'working';
    const authority = () => live()
      ? null : 'This CEO job no longer owns the session; execution denied';
    const signal = this.taskStops.get(a.id)?.signal;
    let refreshing: Promise<string | null> | undefined;
    const authorizeTool: SessionAuthorization = async () => {
      const denied = authority(); if (denied) return denied;
      refreshing ??= (this.backend.demo ? Promise.resolve(null) : this.boundedReadiness(() => this.ceoPreflight(scopeIds,selectedCli), 'CEO tool', signal)).finally(() => {refreshing = undefined;});
      const blocker = await refreshing;
      return authority() ?? blocker;
    };
    const handle = this.backend.startSession(
      {
        cwd: CEO_DIR,
        prompt: ceoJobPrompt(job, floor),
        systemAppend: ceoSystemPrompt({
          name: a.name,
          company: s.companyName,
          manager: s.managerName,
          notesFile: path.join(CEO_DIR, 'NOTES.md'),
          sessionLimit: s.sessionLimit,
          teamCap: s.teamCap,
          hiring: s.hiring,
        }),
        model: a.model || CEO_MODEL,
        effort: a.effort || CEO_EFFORT,
        browserTesting: false,
        additionalDirectories: this.state.repos.filter((r) => scopeIds.includes(r.id) && this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)),
        agentId:a.id,
        role: 'ceo',
        ...(held?{reattach:true}:{}),
        office: this.officeTools(authorizeTool),
        authorizeTool,
        ...how,
      },
      {
        log: (entries) => {if (live()) this.appendLog(a, entries);},
        tool: (name) => {
          if (!live()) return;
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          if (!live()) return;
          const cli=id ? (how.cli ?? 'codex') : null;
          if(a.sessionId===id&&a.sessionCli===cli)return;
          a.sessionId = id; a.sessionCli = cli;
          this.emitAgent(a);
          return this.writeState();
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        turn: (text) => { if (live()) this.postMessage('ceo', text); },
        limited: (at) => {if (live()) this.pauseForLimit(at);},
        usageWarning: (info) => {if (live()) this.paceForWarning(info);},
        finished: (result) => {if (!live()) return; completed = true; this.onCeoFinished(a, result, job, generation,selectedCli);},
      },
    );
    if (ownsJob()) rt.session = completed ? null : handle;
    else if (!completed) handle.stop();
    if (!this.ownsTask(a, generation) || (!ownsJob() && !completed)) return;
    Object.assign(this.state.ceo, {blockedReason: null, retryAt: null});
    if (job.kind === 'review') {
      this.state.ceo.lastReviewAt = Date.now();
      this.state.ceo.lastFingerprint = this.fingerprint();
    }
    this.emitCeo(); this.save();
    } catch { if (ownsJob()) defer('CEO session could not start; check CLI authentication and runtime configuration'); }
  }

  private holdRetainedCeo(a:PersistedAgent,job:CeoJob,reason:string){
    if(this.closed)return;
    Object.assign(this.state.ceo,{job,recoveryHold:true,blockedReason:`Native outcome reconciliation required: ${reason}`.slice(0,2000),retryAt:null});
    Object.assign(a,{status:'error',endedAt:Date.now(),lastError:this.state.ceo.blockedReason});
    this.appendLog(a,[{kind:'error',text:this.state.ceo.blockedReason!}]);this.emitAgent(a);this.emitCeo();this.save();
  }

  private deferCeoJob(a: PersistedAgent, job: CeoJob, reason: string) {
    if (this.closed || this.state.ceo.job !== job) return;
    reason = reason.slice(0, 2000);
    const c = this.state.ceo;
    const changed = c.blockedReason !== reason;
    Object.assign(c, {job: null, blockedReason: reason.slice(0, 2000), retryAt: Date.now() + 60_000});
    c.queue.unshift(job);
    Object.assign(a, {status: 'error', endedAt: Date.now(), lastError: c.blockedReason});
    this.appendLog(a, [{kind: 'error', text: `CEO dispatch blocked: ${c.blockedReason}. Job retained for retry.`}]);
    if (changed) this.postMessage('office', `CEO dispatch blocked: ${c.blockedReason}. The queued job is retained.`);
    this.emitAgent(a); this.emitCeo(); this.save();
  }

  private boundedReadiness(check: () => Promise<string | null>, label: string, taskSignal?: AbortSignal): Promise<string | null> {
    return new Promise(resolve => {
      let settled = false;
      const signal = taskSignal ? AbortSignal.any([this.lifecycleStop.signal, taskSignal]) : this.lifecycleStop.signal;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', aborted); resolve(result);
      };
      const aborted = () => finish(`${label} readiness cancelled by ${this.lifecycleStop.signal.aborted ? 'office shutdown' : 'task cancellation'}`);
      const timer = setTimeout(() => finish(`${label} readiness expired after 90 seconds; refresh capabilities before retrying`), 90_000);
      timer.unref(); signal.addEventListener('abort', aborted, {once: true});
      if (signal.aborted) {aborted(); return;}
      Promise.resolve().then(() => settled ? null : check()).then(decision => {
        finish(decision === null ? null : typeof decision === 'string' && decision.trim() ? decision : `${label} readiness returned no usable decision`);
      }, () => finish(`${label} readiness is unavailable; refresh authentication and project capabilities`));
    });
  }

  private onCeoFinished(a: PersistedAgent, result: SessionResult, job: CeoJob, generation: number,sessionCli:AgentCli) {
    const rt = this.agentRt.get(a.id);
    if (!this.ownsTask(a, generation) || this.state.ceo.job !== job || !rt || this.officeUpdate.handedOver) return;
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    this.state.ceo.job = null;
    if (result.interrupted) this.interrupted(a);
    if (a.status === 'stopped') {
      // the manager already logged the stop
    } else if (!result.ok) {
      a.status = 'error';
      a.lastError = result.errors.join('; ') || 'Session failed';
      if(result.configurationError?.cli===sessionCli){
        if(sessionCli===this.ceoCli(a))this.holdCeoModel(result.configurationError.model,result.configurationError.kind==='unverified-model');
        this.enqueueCeo(job);
      }
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      const what = job ? jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase() : 'working';
      this.postMessage('office', `⚠️ ${a.name} hit a problem while ${what}: ${a.lastError.slice(0, 240)}`);
    } else {
      a.status = 'done';
      const filed = this.ceoIssues.total ? ` · ${this.ceoIssues.total} issue${this.ceoIssues.total === 1 ? '' : 's'} filed` : '';
      this.appendLog(a, [{ kind: 'done', text: `✔ Done in ${this.minutes(a)}m · ${a.turns} turns${filed}` }]);
    }
    for (const id of this.ceoIssues.repos) void this.syncRepo(id);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    this.later(() => this.schedule(), 300);
  }

  /** The manager's phone → the CEO. Injected into a running session, otherwise the CEO picks it up next. */
  async messageCeo(text: string) {
    this.requireOpen();
    const t = text.trim().slice(0, 4000);
    if (!t) throw new HttpError(400, 'Empty message');
    const a = this.ceo();
    this.postMessage('manager', t);
    const rt = this.agentRt.get(a.id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${t}` }]);
      if (a.sessionCli === 'copilot') {
        this.enqueueCeo({ kind: 'chat', text: t, at: Date.now() });
        return;
      }
      this.ceoIssues.managerMessage(); // a new request: the issue cap counts from here
      rt.session.send(`Message from the manager (they read your reply on their phone, so keep it short):\n${t}`);
      return;
    }
    this.enqueueCeo({ kind: 'chat', text: t, at: Date.now() });
  }

  async reviewDeliveryRelease(agentId: string, repoId: string, releaseId: string, recordReview = false, closeSlice = false, schemaBootstrap = false, canvasPackaging = false, reconciliation?:TaskReconciliationReviewRequest) {
    this.requireOpen();
    const a = this.state.agents.find((a) => a.id === agentId && a.repoId === repoId && a.role === 'qa');
    if (!a || BUSY.includes(a.status) || this.agentRt.get(a.id)?.session || this.slotsFull()) throw new HttpError(409, 'Assigned QA reviewer or session slot is busy; request the release review when available');
    const repo = this.repo(repoId);
    const generation = this.reserveTask(a);
    a.task = 'qa'; a.prNumber = null; a.issueNumber = null; a.issueTitle = `Release review ${releaseId}`; a.startedAt = Date.now(); a.lastError = null;
    a.status = 'preparing'; this.emitAgent(a); this.save();
    const ready = await this.checkTaskCapabilities(a, repo, undefined, generation);
    if (!this.ownsTask(a, generation)) throw new HttpError(409, 'Reviewer stopped during readiness verification');
    if (!ready) throw new HttpError(409, a.lastError || 'Release-review readiness is unavailable');
    if (a.status !== 'preparing') throw new HttpError(409, 'Reviewer stopped during readiness verification');
    await this.deskWriters.get(a.id)?.drain().catch(() => undefined);
    if (!this.ownsTask(a, generation) || a.status !== 'preparing') throw new HttpError(409, 'Reviewer stopped while waiting for workspace cleanup');
    const started = this.startAgentSession(a, repo, this.backend.mainDir(repo.fullName),
      reconciliation ? taskReconciliationReviewPrompt(repoId,reconciliation) :
      closeSlice ? `Independently close the already accepted delivery execution for release ${releaseId} in ${repoId}. Read docs/DELIVERY.md, call delivery_record action read and delivery_status. Inspect the completed run, exact release/head/target, saved independent backend or visual decision and current evidence hash. Recompute the hash over retained filenames and bytes. Assess the hash-bound recovery summary and transport receipts; distinguish any additional raw files outside the signed set and report their limits. Do not silently claim unsigned files are hash-bound. Verify the declared phase criteria against actual run evidence. For real slice application specifications inspect first-slice-verification.json: component mappings and transitive dependencies, happy/denied/failure cases, actual independent results, record/head/plan/target/package binding, and receipt hash. Verify quality-evidence.json and the independently approved per-check decisions, including actual handover document content. The office rehashes retained evidence before acceptance; missing mappings or unsupported platform adapters are blockers. If purpose is preparation, verify synthetic standard-only, no private report capture or dispatch, the distinct preparation contract, exact package/definition/identity and all quality checks; it grants no real first-slice credit. If adequate, call delivery_record action accept_preparation for preparation, or delivery_record action accept_slice only for a real slice, with payload {reference:{id,revision,sha256},runId} using the current exact reference, then read back the saved receipt. If insufficient, withhold acceptance and report the specific owner/remedy. Do not repeat unchanged design, release or backend approvals. Do not change source, discovery findings, tenant data or deployments. Historical execution uses its captured implementation version; this closing task grants no new mutation authority.` :
      canvasPackaging ? `Independently review ONLY same-app solution packaging for ${repoId}. First call delivery_record action canvas_packaging payload_json {"action":"inspect"}. If a blocked original journal exists, call {"action":"inspect-recovery"} and review the exact retained-same-app-packaging-recovery proposal and all hash-bound implementation sources. This is a NEW prospective approval for ONE non-forcing conversion against the SAME original marked solution and saved app, or verify/export only when conversion is already exactly mapped. Never create another solution. Original outcome/conflict cause remain unknown; current state is not historical no-effect or idempotence proof. Check original journal/review/lease attribution, dead original local process, exact app/env/publisher/solution, current mapping, durable linked handoff and new intent, no forced lock/clone, membership/export validation and stop after any second failure. No global architecture/task/release approval or app authoring is granted. Save exactly one {"action":"review-recovery","proposalSha256":"<exact hash>","decision":"approved or rejected","notes":"at least80characters concrete evidence and limits"}; read back inspect-recovery and stop. If there is no retained history, review prospective original proposal/three sources, exact app/environment/publisher/absent-solution checks, SDK single-attempt create, makeSolutionAware, same-ID membership and real export; save action review instead. No tenant changes, source edits, DLP, broad historical rereads or global approvals. ` :
      schemaBootstrap ? `Independently review ONLY the fixed create-schema bootstrap architecture and task for ${repoId}. This is not global application design or release approval. First read pinned skills and run exact read-only session preflight probes. Then call delivery_record action schema_bootstrap with payload_json {"action":"inspect"}. That compact response supplies exact record/task/commit/plan/config/code hashes, the complete committed schema design, target/writer permission evidence, dedicated data boundary and durable recovery contract. Inspect those exact inputs and preserved existing resources. New list/column IDs are outputs of creation/readback, not prerequisites. Verify single same-plan lookup parent readback, schema-only Graph route, conflict/unknown-outcome retention with no retry/delete/adoption, owner/QA separation and expiring full-plan operator resource approval. If the exact proposal includes reconciliation, independently inspect its original pinned plan, byte-bound dispatched journal and lease, original ownership marker and payload, actual resource ID, revised text-facet-only plan, fresh metadata and old-process quiescence. Verify that the handoff preserves the old marker, requires two fresh exact readbacks and dead original owner, archives original bytes in fsynced pending lineage, transfers the lease under its reaping guard with no gap, and blocks every interrupted handoff. Approve only its explicit reconcile-owned-schema plus create-schema operations; no general adoption or remote updates/deletion. If the proposal includes continuation, approve only the explicit continue-applied-schema plus create-schema scope after reviewing the exact applied original receipt, current journal/lease bytes and hashes, unchanged plan and parent ID/marker, absence of child dispatch, stopped prior owner, two fresh readbacks and durable continuation WAL under the retained guard. Its fresh review authorizes the explicitly bound retained execution identity; the original lineage is immutable. All post-WAL interruption stays blocked; no generic replay or guard clearing. Do not demand future Canvas/flow runtime completion before this schema-only risk decision. Do not clear future blockers or implement DLP. Static tests prove code behavior, not live schema success or denied identity. If any scoped precondition is missing, reject with the concrete evidence and owner/remedy. Persist exactly one decision through delivery_record action schema_bootstrap payload_json {"action":"review","proposalSha256":"<exact inspected hash>","decision":"approved or rejected","notes":"at least80characters specific evidence and limitations"}. Read back the saved review using inspect and finish. No tenant changes, source changes, generic task approval, global architecture approval, or deployment. Do not exhaustively read unrelated historical receipts. ` :
      recordReview ? `Independently review the discovery and proposed design for ${repoId}. Read docs/DELIVERY.md and call delivery_record action read. Inspect the exact architecture version, discovery evidence, source commit, requirements, alternatives including reuse, contracts, permissions, risks, experience and first vertical slice. Use delivery_record action evidence_index for bounded receipt hashes and the current record reference; later pages require that reference. Read cited discovery receipts with read_delivery_source kind discovery-evidence, current record reference, findingId and expectedSha256; follow nextCharacter until null. Expired receipts are historical and cannot prove current readiness. Challenge reported observations; hashes prove identity, not correctness. Do not mutate findings or call inspect_repository during review: that invalidates the design snapshot. Read the architectureDraft.result returned by action read; local uncommitted drafts are not available from GitHub. If architectureDraft is null or this application record lacks taskPlan, use delivery_record action reject_inputs with current expected_revision and payload {reference:{id,revision,sha256},missingInputs:["architecture","task-contracts"],notes}, including only inputs actually missing. This negative-only decision needs no invented artifact IDs and grants no approval. If an artifact exists but its evidence cannot be accessed, reject its exact version with that limitation. Do not implement or deploy. Submit delivery_record action review with the current record revision and payload {reference:{id,revision,sha256},docId,artifactSha256,decision,notes}. Reject missing or unsubstantiated critical decisions. If taskPlan is present, require version 2 with independent integrationQa contracts and reject circular downstream checks on prerequisite author tasks. Verify recorded QA ownership, scoped merge prerequisites, exact executable scenario/criterion bindings, budgets and stop conditions; a planned contract does not prove a live adapter or successful test. Inspect each taskScopes entry and its owner, components, prerequisites, inputs, outputs, checks, resources and stop conditions. After design approval call review_task separately for each adequate contract with payload {reference:{id,revision,sha256},issue,taskHash,decision,notes}; withhold task approval where dependencies or checks are inadequate. ${this.deliveryRecordContext(repoId)}` :
      `Independently review release ${releaseId}. First call manual_governance. For a pending manual assessment on this release, inspect all referenced evidence bytes, exact package shape, policy applicability, schema/permissions, existing licence baseline and owned-data/recovery contracts. Approve or reject using review_governance with all five control IDs; this is development-only manual assurance and cannot override known conflicts. Never infer E5 features or require optional premium automation. When a pending assessment exists, this is a phase review: compare with prior decisions, rehash every referenced file, inspect changed facts and preserve all five controls. Save the phase decision and finish. Do not repeat an unchanged architecture or release approval; report any material inconsistency instead. Do not modify the record or source. If its API-only run is reviewing, inspect runner-owned transaction, persistence, rejected-write, recovery and explicit audit-retention evidence and call approve_backend with the exact evidence hash; employee isolation is excluded from functional-development scope. For production/browser verification retain all original denied-access and visual requirements. If its browser run is reviewing, inspect every captured desktop/mobile screenshot, accessibility report, usability results and recovery rehearsal evidence, then read docs/QUALITY-EVIDENCE.md and quality-evidence.json when present. Inspect each check artifact and the pinned user, administrator, operations and architecture documents; file presence, headings and command success alone are insufficient. Supply quality_decisions for every exact checkId/evidenceSha256 with approved/rejected decision and concrete notes. Withhold approval for missing, weak or rejected checks. Call approve_visual with the run ID, evidence hash, five visual scores, specific review notes and the per-check decisions. Otherwise review the plan and its pinned architecture. Call delivery_status, inspect the exact pinned commit with git show, read docs/DELIVERY.md, and inspect all acceptance scenarios. Do not modify source or approve weak/static assertions. Every required issue must be implemented in the pinned commit, each component packaged, and persistence must prove a write survives reload. Production and browser authorization must exercise denied access. The explicit functional-development API slice proves the pinned caller and runner-owned mutation boundaries; do not certify employee isolation or demand it as an undeclared acceptance criterion. Read docs/architecture/drafts/<architecture.docId>.json and .md from the exact pinned commit with git show. Assess requirements coverage, data and permission boundaries, tradeoffs, risks, implementation sequence and missing evidence. Call review_architecture with the release ID, plan hash, artifact hash, approved or rejected decision, and specific notes. A saved template does not prove model synthesis or governance compliance. If architecture and acceptance are adequate call approve_release with the exact plan hash. Otherwise explain the specific gaps without approving.`, `${DELIVERY_ENGINEERING}\n${deliveryCapabilitiesPrompt('delivery discovery architecture review')}`);
    if (!started) throw new HttpError(409, a.lastError || 'Release-review admission was cancelled');
    this.save(); return 'Assigned QA review started';
  }

  requestReview() {
    this.requireOpen();
    if (this.state.repos.length === 0) throw new HttpError(400, 'Connect a repo first: the CEO needs a floor to review.');
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  onboardFloor(repoId: string) {
    this.requireOpen();
    const repo = this.repo(repoId);
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
  }

  /** The manager hands the CEO a brief for a floor; the CEO turns it into issues and a team. */
  planFloor(repoId: string, mission?: string) {
    this.requireOpen();
    const repo = this.repo(repoId);
    if (typeof mission === 'string') {
      repo.mission = mission.trim().slice(0, 4000);
      this.emitRepo(repo);
    }
    if (!repo.mission) throw new HttpError(400, 'Write a brief first: what should this floor build?');
    this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
  }

  /** Everything the heartbeat cares about. When it hasn't changed since the last review, the review is skipped. */
  private fingerprint() {
    const data = {
      capabilities: this.capabilityFingerprint(),
      delivery: this.deliveryRevision(),
      repos: this.state.repos.map((r) => {
        const rt = this.repoRt.get(r.id);
        return [r.id, r.mission, r.summary, rt?.issues.map((i) => i.number), rt?.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number)];
      }),
      agents: this.state.agents.filter((a) => a.role !== 'ceo').map((a) => [a.id, FREE.includes(a.status) ? 'free' : a.status]),
      qa: this.state.qa.map((q) => [q.repoId, q.prNumber, q.status]),
      requests: this.state.requests.filter((r) => r.status === 'pending').map((r) => r.id),
    };
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  }

  private maybeHeartbeat() {
    const min = this.state.settings.ceoHeartbeatMin;
    const c = this.state.ceo;
    if (!min || this.state.repos.length === 0 || c.job?.kind === 'review' || c.queue.some((j) => j.kind === 'review')) return;
    if (Date.now() < (c.lastReviewAt ?? 0) + min * 60_000) return;
    if (this.fingerprint() === c.lastFingerprint) {
      c.lastReviewAt = Date.now(); // nothing changed since the last review
      this.emitCeo();
      this.save();
      return;
    }
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  // ---------- the phone ----------

  private postMessage(from: PhoneMessage['from'], text: string, requestId?: string) {
    const m: PhoneMessage = { id: this.messageSeq++, from, text: text.trim().slice(0, 6000), at: Date.now(), ...(requestId ? { requestId } : {}) };
    this.state.messages.push(m);
    if (this.state.messages.length > KEEP_MESSAGES) this.state.messages.splice(0, this.state.messages.length - KEEP_MESSAGES);
    this.broadcast({ type: 'message', message: m });
    this.save();
    return m;
  }

  markPhoneRead(at: number) {
    this.requireOpen();
    const t = Math.min(Number(at) || Date.now(), Date.now());
    if (t <= this.state.phoneReadAt) return;
    this.state.phoneReadAt = t;
    this.broadcast({ type: 'phoneRead', at: t });
    this.save();
  }

  // ---------- hire and let-go proposals ----------

  private addRequest(req: HireRequestView) {
    this.state.requests.push(req);
    const decided = this.state.requests.filter((r) => r.status !== 'pending');
    if (decided.length > KEEP_DECIDED_REQUESTS) {
      const drop = new Set(decided.slice(0, decided.length - KEEP_DECIDED_REQUESTS));
      this.state.requests = this.state.requests.filter((r) => !drop.has(r));
    }
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  private decide(req: HireRequestView, patch: Pick<HireRequestView, 'status' | 'note' | 'decidedBy'>) {
    Object.assign(req, patch, { decidedAt: Date.now() });
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  approveRequest(id: string, overrides: { name?: string; model?: string; effort?: string } = {}, by: 'manager' | 'auto' = 'manager') {
    this.requireOpen();
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That proposal no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That proposal was already ${req.status}`);
    const repo = this.repo(req.repoId);
    if (req.kind === 'hire') {
      const name = overrides.name?.trim() || req.name;
      const agent = this.hireAgent(repo.id, {
        name,
        role: req.role,
        model: overrides.model ?? req.model,
        effort: overrides.effort ?? req.effort,
        look: name === req.name ? req.look : undefined,
        title: req.title,
        specialty: req.specialty,
        brief: req.brief,
        hiredBy: 'ceo',
        appearance: { color: req.color, hair: req.hair, skin: req.skin },
      });
      req.agentId = agent.id;
      req.name = agent.name;
      this.decide(req, { status: 'approved', note: '', decidedBy: by });
      this.postMessage(
        'office',
        by === 'auto' ? `🤖 Auto-approved: ${agent.name} joined floor ${repo.floor} as ${req.title}.` : `✅ You hired ${agent.name} as ${req.title} on floor ${repo.floor}.`,
        req.id,
      );
      this.toast('success', `${agent.name} (${req.title}) joined floor ${repo.floor}`);
      return;
    }
    const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
    this.decide(req, { status: 'approved', note: a ? '' : 'They had already left.', decidedBy: by });
    if (a) {
      try {
        this.fireAgent(a.id);
      } catch (err) {
        this.decide(req, { status: 'pending', note: '', decidedBy: null });
        throw err;
      }
    }
    this.postMessage('office', `👋 ${req.name} left floor ${repo.floor}${by === 'auto' ? ' (auto-approved)' : ''}.`, req.id);
  }

  rejectRequest(id: string, note = '') {
    this.requireOpen();
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That proposal no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That proposal was already ${req.status}`);
    this.decide(req, { status: 'rejected', note: note.trim().slice(0, 400), decidedBy: 'manager' });
    const what = req.kind === 'hire' ? `${req.name} (${req.title})` : `letting ${req.name} go`;
    this.postMessage('office', `✋ You declined ${what}${req.note ? `: "${req.note}"` : '.'}`, req.id);
  }

  // ---------- the CEO's office tools ----------

  private floorRepo(floor: number) {
    const r = this.state.repos.find((x) => x.floor === Number(floor));
    if (!r) throw new Error(`There is no floor ${floor}. Floors: ${this.state.repos.map((x) => `${x.floor} (${x.fullName})`).join(', ') || 'none'}.`);
    return r;
  }

  private agentByRef(ref: string) {
    const r = String(ref ?? '').trim().toLowerCase();
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!a) throw new Error(`No agent "${ref}". Use the ids from company_status.`);
    return a;
  }

  private agentDoing(a: PersistedAgent) {
    return !BUSY.includes(a.status) ? null : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `issue #${a.issueNumber}`;
  }

  private companyStatus() {
    const s = this.state.settings;
    const doing = (a: PersistedAgent) => this.agentDoing(a);
    // Keep the status compact, but make the cut visible so the CEO knows to read agent_detail before rewriting.
    const jobDescription = (brief: string) => {
      if (brief.length <= 400) return brief;
      const mark = `… (truncated, ${brief.length} chars; see agent_detail)`;
      return brief.slice(0, 400 - mark.length).trimEnd() + mark;
    };
    const floors = [...this.state.repos]
      .sort((x, y) => x.floor - y.floor)
      .map((r) => {
        const rt = this.repoRt.get(r.id)!;
        const open = new Set(rt.issues.map((i) => i.number));
        return {
          floor: r.floor,
          repo: r.fullName,
          description: r.description,
          clone: rt.cloneStatus === 'ready' ? this.backend.mainDir(r.fullName) : `(not available: clone ${rt.cloneStatus})`,
          brief: r.mission || null,
          deliveryPlan: this.deliveryRecordContext(r.id),
          profile: r.summary || null,
          qaBrief: r.qaBrief || null,
          preview: { command: r.preview.command, env: r.preview.env, status: this.previews.view(r).status },
          autoAssign: r.autoAssign,
          autoMerge: r.autoMerge,
          folderSync: rt.folderSync,
          capacity: {
            developers: this.state.agents.filter((a) => a.repoId === r.id && a.role === 'dev').length,
            developersFree: this.available(r, 'dev').length,
            issuesReadyToStart: this.readyIssues(r).length,
            issuesWaitingOnOthers: rt.issues.filter((i) => blockers(i.body, open).length > 0).length,
            longestDependencyChain: Math.max(0, ...[...holdUps(rt.issues).values()].map((w) => w.chain)),
          },
          team: this.state.agents
            .filter((a) => a.repoId === r.id)
            .map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              title: a.title || (a.role === 'qa' ? 'QA tester' : 'Developer'),
              specialty: a.specialty || null,
              status: a.status,
              doing: doing(a),
              hiredBy: a.hiredBy,
              jobDescription: a.brief ? jobDescription(a.brief) : null,
            })),
          backlog: rt.issues.map((i) => ({
            number: i.number,
            title: i.title,
            specialty: issueSpecialty(i.labels) || null,
            waitsFor: blockers(i.body, open),
            inProgress: this.issueTaken(r, i.number),
          })),
          pullRequests: rt.pulls
            .filter((p) => p.state === 'OPEN')
            .map((p) => {
              const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
              return { number: p.number, title: p.title, qa: q ? `${q.status}${q.round > 1 ? ` (round ${q.round})` : ''}` : 'not tested', merge: q?.mergeNote ?? null, checks: p.checks };
            }),
          mergedRecently: rt.pulls.filter((p) => p.state === 'MERGED').map((p) => `#${p.number} ${p.title}`),
        };
      });
    const req = (r: HireRequestView) => ({
      id: r.id,
      kind: r.kind,
      floor: this.state.repos.find((x) => x.id === r.repoId)?.floor ?? null,
      role: r.role,
      name: r.name,
      title: r.title,
      specialty: r.specialty || null,
      reason: r.reason,
      status: r.status,
      managerNote: r.note || null,
    });
    return JSON.stringify(
      {
        company: {
          ceo: this.ceo().name,
          hiring: s.hiring === 'auto' ? `auto-approved while a floor has fewer than ${s.teamCap} people` : 'the manager approves every proposal',
          teamCap: s.teamCap,
          sessionLimit: s.sessionLimit || 'none',
          sessionsRunning: this.running(),
          sessionUsage:this.sessionUsage(),
          usage: usageLabel(this.usageNow(), Date.now()),
          deskLimits: { dev: MAX_DESKS.dev, qa: MAX_DESKS.qa },
        },
        floors,
        pendingProposals: this.state.requests.filter((r) => r.status === 'pending').map(req),
        recentDecisions: this.state.requests.filter((r) => r.status !== 'pending').slice(-10).map(req),
      },
      null,
      1,
    );
  }

  private agentDetail(x: { agent_id: string }) {
    const a = this.agentByRef(x.agent_id);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    const ceo = a.role === 'ceo';
    return JSON.stringify(
      {
        id: a.id,
        name: a.name,
        floor: repo?.floor ?? null,
        role: a.role,
        title: a.title || (a.role === 'qa' ? 'QA tester' : a.role === 'dev' ? 'Developer' : 'CEO'),
        specialty: a.specialty || null,
        status: a.status,
        doing: this.agentDoing(a),
        issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
        pullRequest: a.prNumber ? { number: a.prNumber, url: a.prUrl } : null,
        codingAgent: ceo ? BUSY.includes(a.status)&&isCli(a.sessionCli)?a.sessionCli:this.ceoCli(a) : a.cli || this.state.settings.defaultCli,
        model: ceo ? a.model || 'the coding agent default' : this.modelFor(a, a.cli || this.state.settings.defaultCli) || 'the coding agent default',
        effort: a.effort || (ceo ? CEO_EFFORT : this.state.settings.defaultEffort),
        hiredBy: a.hiredBy,
        jobDescription: a.brief || null,
      },
      null,
      1,
    );
  }

  private setFloorProfile(x: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }) {
    const r = this.floorRepo(x.floor);
    if (this.state.agents.some(a => a.repoId === r.id && BUSY.includes(a.status))) {
      throw new Error(`Floor ${r.floor} has active work. Keep its profile and QA brief stable until those sessions finish, then retry.`);
    }
    const preview = parsePreviewPatch(x.preview_command, x.preview_env);
    if (x.summary !== undefined) r.summary = String(x.summary).trim().slice(0, 140);
    if (x.qa_brief !== undefined) r.qaBrief = String(x.qa_brief).trim().slice(0, 2500);
    r.preview = { ...r.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(r);
    this.emitRepo(r);
    this.save();
    return `Saved floor ${r.floor}'s profile.`;
  }

  private updateJob(x: { agent_id: string; title?: string; specialty?: string; job_description?: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("That's you.");
    if (BUSY.includes(a.status)) throw new Error('This agent has active work. Wait until its session finishes before changing its job.');
    this.updateAgent(a.id, { title: x.title, specialty: x.specialty, brief: x.job_description });
    const title = a.title || (a.role === 'qa' ? 'QA tester' : 'Developer');
    this.appendLog(a, [{ kind: 'system', text: `🪪 ${this.ceo().name} updated ${a.name}'s job: ${title}${a.specialty ? ` · swarm:${a.specialty}` : ''}` }]);
    return `Updated ${a.name}: ${title}${a.specialty ? ` (specialty ${a.specialty})` : ''}.`;
  }

  private proposeHire(x: { floor: number; role: 'dev' | 'qa'; title: string; specialty: string; job_description: string; reason: string; model?: string; effort?: string }) {
    const repo = this.floorRepo(x.floor);
    const role = x.role === 'qa' ? 'qa' : 'dev';
    const title = String(x.title ?? '').trim().slice(0, 60);
    if (!title) throw new Error('A hire needs a job title.');
    const specialty = specialtySlug(x.specialty);
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    if (pending.length >= MAX_PENDING_REQUESTS) throw new Error(`${pending.length} proposals are already waiting for the manager. Wait for their decisions first.`);
    const dup = pending.find((r) => r.kind === 'hire' && r.repoId === repo.id && r.role === role && r.specialty === specialty);
    if (dup) throw new Error(`${dup.name} (${dup.title}) is already proposed for floor ${repo.floor} with that specialty.`);
    const seated = this.state.agents.filter((a) => a.repoId === repo.id && a.role === role).length;
    const waiting = pending.filter((r) => r.kind === 'hire' && r.repoId === repo.id && r.role === role).length;
    if (seated + waiting >= MAX_DESKS[role]) throw new Error(role === 'qa' ? `The QA lab on floor ${repo.floor} is full.` : `Floor ${repo.floor} has no free desks.`);
    const name = this.freeName(role);
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'hire',
      repoId: repo.id,
      role,
      agentId: null,
      name,
      title,
      specialty,
      brief: String(x.job_description ?? '').trim().slice(0, 2500),
      reason: String(x.reason ?? '').trim().slice(0, 600),
      model: String(x.model ?? '').trim(),
      effort: EFFORTS.includes(x.effort as EffortLevel) ? (x.effort as EffortLevel) : '',
      look: lookFor(name),
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    const s = this.state.settings;
    if (s.hiring === 'auto' && this.state.agents.filter((a) => a.repoId === repo.id).length < s.teamCap) {
      this.approveRequest(req.id, {}, 'auto');
      return `Hired ${req.name} as ${title} on floor ${repo.floor} (auto-approved; agent id ${req.agentId}).`;
    }
    this.postMessage('ceo', `📄 New candidate for floor ${repo.floor}: ${name}, ${title}. ${req.reason}`, req.id);
    return `Proposed ${name} as ${title} on floor ${repo.floor}. The manager will approve or decline (request ${req.id}).`;
  }

  private proposeLetGo(x: { agent_id: string; reason: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("You can't let yourself go.");
    const repo = this.repo(a.repoId);
    if (a.role === 'qa' && this.state.agents.filter((y) => y.repoId === repo.id && y.role === 'qa').length <= 1) {
      throw new Error(`${a.name} is floor ${repo.floor}'s only QA tester, and every floor keeps one.`);
    }
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    if (pending.some((r) => r.kind === 'let-go' && r.agentId === a.id)) throw new Error(`Letting ${a.name} go is already proposed.`);
    if (pending.length >= MAX_PENDING_REQUESTS) throw new Error(`${pending.length} proposals are already waiting for the manager. Wait for their decisions first.`);
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'let-go',
      repoId: repo.id,
      role: a.role,
      agentId: a.id,
      name: a.name,
      title: a.title || (a.role === 'qa' ? 'QA tester' : 'Developer'),
      specialty: a.specialty,
      brief: a.brief,
      reason: String(x.reason ?? '').trim().slice(0, 600),
      model: a.model,
      effort: a.effort,
      look: a.look,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    if (this.state.settings.hiring === 'auto' && FREE.includes(a.status)) {
      this.approveRequest(req.id, {}, 'auto');
      return `Let ${a.name} go (auto-approved).`;
    }
    this.postMessage('ceo', `👋 I suggest letting ${a.name} (${req.title}, floor ${repo.floor}) go. ${req.reason}`, req.id);
    return `Proposed letting ${a.name} go. The manager will decide (request ${req.id}).`;
  }

  private async fileIssue(x: { floor: number; title: string; body: string; specialty?: string }) {
    const repo = this.floorRepo(x.floor);
    this.ceoIssues.check();
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new Error('An issue needs a title.');
    const slug = specialtySlug(x.specialty);
    const body = `${String(x.body ?? '').trim()}\n\n---\n_Filed by ${this.ceo().name}, the Agent Swarm CEO._`;
    const n = await this.backend.createIssue(repo.fullName, title, body, slug ? [specialtyLabel(slug)] : []);
    this.ceoIssues.record(repo.id);
    return `Filed #${n} on floor ${repo.floor}: ${title}${slug ? ` (routed to ${slug})` : ''}.`;
  }

  /** Change an open issue's specialty and/or dependencies (see planRoute for what is refused). */
  private async routeIssue(x: { floor: number; number: number; specialty?: string; depends_on?: number[] }) {
    const repo = this.floorRepo(x.floor);
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const asked = [Number(x.number), ...(x.depends_on ?? []).map(Number)].filter((n) => !issues.some((i) => i.number === n));
    const observations=await Promise.allSettled([...new Set(asked)].map(async(n)=>[n,await this.backend.issueState(repo.fullName,n)] as const));
    if(observations.some(result=>result.status==='rejected'))throw new HttpError(503,'Issue prerequisite status could not be verified; restore GitHub access and retry routing');
    const states=new Map(observations.flatMap(result=>result.status==='fulfilled'?[result.value]:[]));
    const specialties = [
      ...this.state.agents.filter((a) => a.repoId === repo.id && a.specialty).map((a) => a.specialty.toLowerCase()),
      ...this.state.requests.filter((r) => r.status === 'pending' && r.kind === 'hire' && r.repoId === repo.id && r.specialty).map((r) => r.specialty),
    ];
    const plan = planRoute({
      floor: repo.floor,
      number: Number(x.number),
      specialty: x.specialty,
      dependsOn: x.depends_on,
      issues,
      closed: (n) => states.get(n) === 'CLOSED',
      inProgress: this.issueTaken(repo, Number(x.number)),
      specialties,
    });
    if (plan.body !== null || plan.addLabels.length || plan.removeLabels.length) {
      await this.backend.editIssue(repo.fullName, Number(x.number), { body: plan.body ?? undefined, addLabels: plan.addLabels, removeLabels: plan.removeLabels });
      await this.syncRepo(repo.id); // the scheduler sees the new routing right away
    }
    return plan.summary;
  }
}
