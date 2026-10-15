import fs from 'node:fs/promises';
import {stablePackageDigest} from './deliveryPackage.ts';
import {verifyDeploymentSettings} from './deploymentSettings.ts';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { z } from 'zod';
import { atomicWrite, SerialWriter } from './atomicFile.ts';
import { readBoundedJson } from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import { validateDeliveryState, type DeliveryStoredState } from './deliveryState.ts';
import {inspectDeliveryRecovery,recoverEmptyDelivery} from './deliveryRecovery.ts';
import {acquireDeliveryLease,type DeliveryLease} from './deliveryLease.ts';
import {connectOwnedFlowAdapter} from './ownedFlowAdapter.ts';
import { resolveTenancyCommand } from './tenancy.ts';
import { HttpError } from './httpError.ts';
import type { RepoView } from '../shared/types.ts';
import type { DeliveryRun, DeliveryView, DeliveryRelease,DeliveryAttempt } from '../shared/delivery.ts';
import {deliveryAttemptSummary} from './deliveryAttempts.ts';
import {nextPreflightRetry,preflightContext,preflightDeferred} from './deliveryRetry.ts';

import { releasePlanSchema, acceptanceScope, type ReleasePlan } from './releasePlan.ts';
import {assertMonitoringContract,type MonitoringManifest} from './monitoringContract.ts';
import {architectureReviewSchema,verifyCommittedArchitecture,requireArchitectureReview} from './architectureGate.ts';
import { verifyIndependently } from './independentVerification.ts';
import { verifyApiIndependently } from './apiVerification.ts';
import { discoverSkills, selectSkills } from './skillRegistry.ts';
import { acquireResourceLease } from './resourceLease.ts';
import { targetBindingSchema, targetComponentSchema, targetActionSchema, verifyTarget, mapTargetComponents, verifyMappedCanvasUrls, reconcileWorkflowAction, verifyConnectionReference, type Request,type TargetAction } from './targetOperations.ts';
import { platformIdentitySchema, verifyPlatformAuthentication,verifyTypedActionAuthentication } from './platformAuth.ts';
import { connectFlowAdapter, verifyCloudFlowContext, verifyCloudFlowBindings, verifyCloudFlowActivationBindings, verifyCloudFlowRun, type FlowAdapter } from './flowAdapter.ts';
import { reconcileCloudFlow, reconcileCopilot } from './platformLifecycle.ts';
import { reconcileAdditionalAction, verifyMigrationCompatibility } from './deploymentAdapters.ts';
import { canvasResource } from './canvasOwnership.ts';
import { lifecycleResultSchema,requireLifecycleGovernance, type LifecycleCheck, type GovernancePhase } from './lifecycleGovernance.ts';
import {PlatformCommandError,providerErrorCode} from './platformCommandError.ts';
import {verifyBackendJourney} from './backendJourney.ts';

const command = z.object({ executable: z.string().min(1), args: z.array(z.string()).max(100) }).strict();
export const deliveryManifest = z.object({
  schemaVersion: z.literal(1), solutionUniqueName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  solutionVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/), solutionZip: z.string().min(1),
  settingsFile: z.string().min(1).optional(),settingsSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(), hasUi: z.boolean(),
  manualDevelopmentGovernance:z.literal(true).optional(),
  canvasAuthoringApps: z.array(z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)).max(30).default([]),
  recovery: z.object({ runbook: z.string().min(1), rehearsalReport: z.string().min(1).optional(),scope:z.literal('pilot-owned-development-records').optional() }).strict(),
  documentation: z.array(z.string().min(1)).min(3),
  build: z.array(command).min(1).max(10), test: z.array(command).min(1).max(10),
  postDeploy: z.array(command).max(10).default([]), verify: z.array(command).min(1).max(10),
  targetBinding: targetBindingSchema.optional(),
  platformIdentity: platformIdentitySchema.optional(),
  targetComponents: z.array(targetComponentSchema).max(100).default([]),
  postDeployActions: z.array(targetActionSchema).max(30).default([]),
}).strict().superRefine((manifest, ctx) => {
  if(!manifest.recovery.scope&&!manifest.recovery.rehearsalReport)ctx.addIssue({code:'custom',message:'Production recovery requires a separate-environment rehearsal report'});
  if(!!manifest.settingsFile!==!!manifest.settingsSha256)ctx.addIssue({code:'custom',message:'Deployment settings require both settingsFile and an approved settingsSha256'});
  if ((manifest.targetComponents.length || manifest.postDeployActions.length) && !manifest.targetBinding) ctx.addIssue({ code: 'custom', message: 'Typed target operations require targetBinding' });
  if (new Set(manifest.targetComponents.map((c) => c.key)).size !== manifest.targetComponents.length || new Set(manifest.postDeployActions.map((a) => a.id)).size !== manifest.postDeployActions.length) ctx.addIssue({ code: 'custom', message: 'Component keys and action IDs must be unique' });
  if (manifest.platformIdentity && !manifest.targetBinding) ctx.addIssue({ code: 'custom', message: 'Platform authentication requires targetBinding' });
  if (manifest.targetComponents.some((c) => ['cloud-flow', 'copilot'].includes(c.kind)) && !manifest.platformIdentity) ctx.addIssue({ code: 'custom', message: 'Cloud-flow/Copilot delivery requires platformIdentity' });
  for (const action of manifest.postDeployActions) {
    const expected = action.type === 'workflow-state' ? 'workflow' : action.type === 'cloud-flow-state' ? 'cloud-flow' : ['connection-reference-check', 'connection-reference-bind'].includes(action.type) ? 'connection-reference' : ['schema-check', 'record-share'].includes(action.type) ? 'dataverse-table' : 'copilot';
    if (!manifest.targetComponents.some((c) => c.key === action.component && c.kind === expected)) ctx.addIssue({ code: 'custom', message: `Missing ${expected} mapping for ${action.id}` });
  }
  for (const action of manifest.postDeployActions) if (action.type === 'connection-reference-bind' && !manifest.postDeployActions.some((check) => check.type === 'connection-reference-check' && check.component === action.component && check.connectionId === action.connectionId && check.connectorId === action.connectorId)) ctx.addIssue({ code: 'custom', message: 'Binding repairs require a matching final binding check' });
  for (const component of manifest.targetComponents.filter((c) => c.kind === 'connection-reference')) if (!manifest.postDeployActions.some((a) => a.type === 'connection-reference-check' && a.component === component.key)) ctx.addIssue({ code: 'custom', message: `Connection reference ${component.key} requires an approved binding check` });
  for (const component of manifest.targetComponents.filter((c) => c.kind === 'copilot')) if (!manifest.postDeployActions.some((a) => a.type === 'copilot-publish' && a.component === component.key)) ctx.addIssue({ code: 'custom', message: `Copilot ${component.key} requires a publication action` });
});
const https = z.url().refine((value) => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; });
export const verificationReport = z.object({
  environmentUrl: https, sourceCommit: z.string(), solutionUniqueName: z.string(), solutionVersion: z.string(),
  verifiedAt: z.iso.datetime(), authenticatedUser: z.string().min(3),
  appUrls: z.array(https),
  tests: z.array(z.object({ name: z.string().min(5), category: z.enum(['journey', 'authorization', 'persistence', 'error-handling']), passed: z.literal(true), evidence: z.string().min(1) })).min(4)
    .refine((tests) => ['journey', 'authorization', 'persistence', 'error-handling'].every((category) => tests.some((test) => test.category === category)), 'Live journey, authorization, persistence and error handling must all pass'),
  security: z.enum(['passed', 'not-verified']), persistence: z.literal('passed'),
  ui: z.object({ desktop: z.string(), mobile: z.string(), trace: z.string(), accessibility: z.literal('passed'), designReview: z.literal('passed') }).optional(),
}).strict();
export interface DeliveryCommand { executable: string; args: string[] }
export function pacReportedError(executable: string, output: string) {
  return /^pac(?:\.launcher)?(?:\.exe|\.cmd)?$/i.test(path.basename(executable)) && /(?:^\s*Error:\s*\S|\bthe app encountered a non-recoverable error\b)/im.test(output);
}
export function importJobId(output: string) {
  return output.match(/\bimport\s+job\s*(?:id)?\s*[:=]\s*\{?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\}?/i)?.[1].toLowerCase();
}
export interface DeliveryDependencies {
  governance?: LifecycleCheck;
  flow?: typeof connectFlowAdapter;
  verify?: typeof verifyIndependently;
  run(command: DeliveryCommand, cwd: string, env: Record<string, string>, signal: AbortSignal): Promise<string>;
}
export const deliveryCommands: DeliveryDependencies = {
  run(command, cwd, env, signal) {
    const cmd = resolveTenancyCommand(command.executable);
    if (signal.aborted) return Promise.reject(new Error('Delivery cancelled'));
    return new Promise((resolve, reject) => {
      const child = spawn(cmd.file, [...cmd.args, ...command.args], { cwd, env: { ...process.env, ...env }, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', failure = '',bytes=0;
      const outDecoder=new TextDecoder('utf-8',{fatal:true}),errDecoder=new TextDecoder('utf-8',{fatal:true});
      let stopping:Promise<void>|undefined;
      const kill = (reason: string) => {
        if(failure)return;
        failure = reason;
        if (!child.pid) return;
        const pid=child.pid;
        stopping=Promise.resolve().then(async()=>{
          if(process.platform==='win32')await new Promise<void>((done,failed)=>execFile('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true},error=>error?failed(new Error('Tree stop failed')):done()));
          else process.kill(-pid,'SIGKILL');
        });
        void stopping.catch(()=>{try{child.kill();}catch{/* Root stop also remains unverified. */}});
      };
      const abort = () => kill('Delivery cancelled');
      const timer = setTimeout(() => kill('Delivery command timed out'), 20 * 60_000);
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const collect=(chunk:Buffer,isError:boolean)=>{
        if(failure)return;bytes+=chunk.length;
        if(bytes>8*1024*1024){kill('Delivery output exceeded its limit');return;}
        try{const text=(isError?errDecoder:outDecoder).decode(chunk,{stream:true});if(isError)stderr+=text;else stdout+=text;}
        catch{kill('Delivery output contained invalid UTF-8');}
      };
      child.stdout.on('data',chunk=>collect(chunk,false));
      child.stderr.on('data',chunk=>collect(chunk,true));
      child.once('error', (err) => { if(!child.pid){clean();reject(err);}else kill('Delivery process failed before exit acknowledgement'); });
      child.once('close', (code) => {void (async()=>{
        clean();
        try{await stopping;}catch{failure='Delivery process-tree cleanup is unverified; inspect native processes before recovery';}
        if(!failure)try{stdout+=outDecoder.decode();stderr+=errDecoder.decode();}catch{failure='Delivery output contained invalid UTF-8';}
        if (failure || code !== 0 || pacReportedError(command.executable, stdout)) reject(new PlatformCommandError(`${path.basename(command.executable)} failed: ${failure || stderr.slice(-4000) || (pacReportedError(command.executable, stdout) ? stdout.slice(-4000) : `exit ${code}`)}${providerErrorCode(stdout)?` (provider ${providerErrorCode(stdout)})`:''}`,providerErrorCode(stdout)));
        else resolve(stdout);
      })().catch(reject);});
    });
  },
};
const canonical = (url: string) => new URL(url).origin.toLowerCase();
export async function containedFile(root: string, relative: string) {
  const base = await fs.realpath(root); const file = await fs.realpath(path.resolve(base, relative));
  const rel = path.relative(base, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !(await fs.stat(file)).isFile()) throw new Error(`File is outside the delivery directory: ${relative}`);
  if ((await fs.stat(file)).size === 0) throw new Error(`Evidence/document is empty: ${relative}`);
  return file;
}
export function installedSolution(output: string, name: string, version: string) {
  // PAC may print a connection banner before its JSON array.
  const start = output.indexOf('['), end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('PAC did not return a solution inventory');
  const list = z.array(z.record(z.string(),z.unknown())).max(5000).parse(parseUnambiguousJson(output.slice(start, end + 1)));
  const identities=new Set<string>();let found=false;
  for(const row of list){
    const names=Object.entries(row).filter(([key])=>['uniquename','solutionuniquename'].includes(key.toLowerCase()));
    const versions=Object.entries(row).filter(([key])=>['version','versionnumber'].includes(key.toLowerCase()));
    if(names.length!==1||versions.length!==1)throw new Error('PAC solution inventory identities are ambiguous');
    const identity=z.string().min(1).max(200).parse(names[0][1]).toLowerCase(),observedVersion=z.string().min(1).max(200).parse(versions[0][1]);
    if(identities.has(identity))throw new Error('PAC solution inventory contains duplicate solution identities');identities.add(identity);
    if(identity===name.toLowerCase()&&observedVersion===version)found=true;
  }
  return found;
}

/** One real release at a time. An interrupted/failed release never resumes deployment automatically. */
/** Include the raw owned-record proof on every retry, not just its summary. */
export async function retainOwnedRecoveryEvidence(scope:string|undefined,directory:string,files:string[]) {
  if(scope!=='pilot-owned-development-records')return;
  const required=['independent-recovery.json','independent-recovery-journal.json'];
  await Promise.all(required.map(file=>containedFile(directory,file)));
  for(const file of required)if(!files.includes(file))files.push(file);
}

export class DeliveryService {
  private state: DeliveryStoredState = { schemaVersion: 1, policy: null, runs: [], releases: [], blockers: [], revision: 0 };
  onChange: () => void = () => {};
  checkCapabilities: (repoId: string, cwd: string, environment: string, force: boolean) => Promise<{ status: string; configHash?: string; checks: { id: string; category: string; passed: boolean; remedy: string }[] }> = async () => { throw new Error('Configure capability checks before delivery'); };
  validateMonitoring?: (repoId:string,plan:ReleasePlan,manifest:MonitoringManifest,environmentUrl:string)=>void;
  checkDeliveryRecord?: (repo:Pick<RepoView,'id'>,plan:ReleasePlan) => void;
  checkGovernance?: LifecycleCheck;
  private lease: DeliveryLease | null = null;
  private writer = new SerialWriter();
  private active: AbortController | null = null;
  private closed = false;
  private draining = false;
  get isDraining(){return this.draining;}
  setDraining(value:boolean){if(!value)this.requireReady();this.draining=value;}
  get available(){return this.ready&&!this.closed&&!this.stateFailed&&!this.ownershipLost;}
  private startupUnavailable=false;
  private permanentlyClosed=false;
  private recovering=false;
  private recoveryWork:Promise<DeliveryView>|null=null;
  private stateFailed = false;
  private ownershipLost = false;
  private ready = false;
  private initializing: Promise<void> | null = null;
  private preparing: Promise<void> | null = null;
  private pending: Promise<void> | null = null;
  constructor(private root: string, private demo: boolean, private deps = deliveryCommands, private resourceLeaseRoot = path.join(root, 'resource-leases')) {}
  init(options?:{allowUnavailable?:boolean}): Promise<void> {
    if (this.closed || this.ready || this.initializing) return Promise.reject(new HttpError(409, 'Delivery lifecycle already started or stopped'));
    this.initializing = this.initialize().catch(error=>{if(!options?.allowUnavailable)throw error;this.startupUnavailable=true;}).finally(() => { this.initializing = null; });
    return this.initializing;
  }
  async recoveryInspection(){if(this.demo||!this.startupUnavailable||this.permanentlyClosed)throw new HttpError(409,'Startup recovery is not available');return inspectDeliveryRecovery(this.root);}
  recoverStartup(expectedSha256:string):Promise<DeliveryView>{
    if(this.demo||!this.startupUnavailable||this.permanentlyClosed||this.recovering||!this.draining)return Promise.reject(new HttpError(409,'Startup recovery requires an unavailable delivery service in maintenance mode'));
    this.recovering=true;
    const assertOpen=()=>{if(this.permanentlyClosed||!this.draining)throw new HttpError(409,'Delivery closed or maintenance changed during recovery');};
    this.recoveryWork=(async()=>{
      try{
        await recoverEmptyDelivery(this.root,expectedSha256,assertOpen);
        assertOpen();
        this.closed=false;this.stateFailed=false;this.ownershipLost=false;this.startupUnavailable=false;
        await this.init({allowUnavailable:true});
        if(!this.available)throw new HttpError(409,'Recovery preserved the marker, but startup remains unavailable');
        try{this.onChange();}catch(error){console.warn('Delivery recovery notification failed',error);}
        return this.view();
      }finally{this.recovering=false;this.recoveryWork=null;}
    })();
    return this.recoveryWork;
  }
  private async initialize() {
    if (this.demo) { this.ready = true; return; }
    try {
      await fs.mkdir(this.root, { recursive: true });
      if (this.closed) throw new Error('Delivery startup cancelled');
      await this.acquire();
      if (this.closed) throw new Error('Delivery startup cancelled');
      const saved = await readBoundedJson(path.join(this.root, 'delivery.json'));
      if (this.closed) throw new Error('Delivery startup cancelled');
      if (saved !== undefined) this.state = validateDeliveryState(saved);
      this.state.attemptHistory??={version:1,startedAt:new Date().toISOString(),legacyRunIds:this.state.runs.map(run=>run.id),attempts:[]};
      for(const attempt of this.state.attemptHistory.attempts)if(['preparing','running'].includes(attempt.status)){attempt.status='interrupted';attempt.reason='restart';attempt.endedAt=new Date().toISOString();}
      // Derive scope without rewriting immutable plans or their approved hashes.
      for (const run of this.state.runs) {
        const release = this.state.releases.find((r) => r.id === run.releaseId);
        if (release) run.acceptance = acceptanceScope(release.plan);
      }
      for (const run of this.state.runs) if (!['complete', 'blocked', 'reviewing'].includes(run.phase)) {
        this.state.revision++; run.phase = 'blocked'; run.recoveryRequired = true; run.error = 'Office restarted during delivery. Resume checks the persisted checkpoint; ambiguous imports require investigation.'; run.endedAt = new Date().toISOString();
      }
      await this.save();
      if (this.closed) throw new Error('Delivery startup cancelled');
      this.ready = true;
    } catch (err) {
      this.stateFailed = true; this.closed = true;
      await this.releaseLease();
      if (err instanceof HttpError) throw err;
      throw new Error('Cannot load delivery state; preserve and repair it before restarting', {cause:err});
    }
  }
  private save() { return this.writer.write(async()=>{await this.assertLeaseOwned();await atomicWrite(path.join(this.root,'delivery.json'),JSON.stringify(this.state,null,2));}); }
  private async assertLeaseOwned(){
    if(this.ownershipLost)throw new HttpError(409,'Delivery ownership lost');
    try{if(!this.lease)throw new HttpError(409,'Delivery ownership is unavailable');await this.lease.assertOwned();}
    catch(error){this.ownershipLost=true;this.closed=true;this.active?.abort();throw error;}
  }
  private async command(command:DeliveryCommand,cwd:string,env:Record<string,string>,signal:AbortSignal,additionalOwnership?:()=>Promise<void>){
    await this.assertLeaseOwned();await additionalOwnership?.();signal.throwIfAborted();
    await this.assertLeaseOwned();signal.throwIfAborted();
    const output=await this.deps.run(command,cwd,env,signal);
    await this.assertLeaseOwned();await additionalOwnership?.();signal.throwIfAborted();
    await this.assertLeaseOwned();signal.throwIfAborted();
    return output;
  }
  private requireReady() { if (this.closed || !this.ready) throw new HttpError(409, 'Delivery service is not ready or is closed'); }
  view(repoId?: string): DeliveryView {
    if(this.startupUnavailable)return {availability:'unavailable',policy:null,releases:[],runs:[],blockers:[],revision:0,running:false,message:'Delivery initialization is unavailable. History and policy are unverified; inspect recovery before starting work. Copilot Studio remains paused.'};
    if(this.ownershipLost)throw new HttpError(409,'Delivery ownership lost; inspect the current owner before restarting');
    if (this.stateFailed || !this.ready) throw new HttpError(409, 'Delivery state is unavailable; preserve and repair it before restarting');
    return structuredClone({ ...this.state, availability:'ready' as const, running: !!this.active, releases: this.state.releases.filter((r) => !repoId || r.repoId === repoId), blockers: this.state.blockers.filter((r) => !repoId || r.repoId === repoId), runs: this.state.runs.filter((r) => !repoId || r.repoId === repoId).map((r) => ({ ...r, evidenceDirectory: path.join(this.root, 'delivery-runs', r.id, 'evidence') })),
      attemptHistory:deliveryAttemptSummary(this.state.attemptHistory,this.state.runs,repoId),message: this.demo ? 'Real delivery is disabled in demo mode.' : !this.state.policy?.enabled ? 'Choose the development environment to enable real delivery.' : 'A scoped, QA-approved release pins the commit, target and acceptance tests. Missing evidence blocks completion.' });
  }
  async configure(environmentUrl: string, enabled: boolean) {
    this.requireReady();
    if (this.demo) throw new HttpError(409, 'Demo cannot configure real deployments');
    if (this.active) throw new HttpError(409, 'Wait for the active delivery to finish before changing its target');
    https.parse(environmentUrl);
    const previous = this.state.policy;
    this.state.policy = { environmentUrl: canonical(environmentUrl), enabled, approvedAt: new Date().toISOString(), ...(previous?.copilotPaused !== undefined ? { copilotPaused: previous.copilotPaused } : {}) };
    try { await this.save(); } catch (err) { this.state.policy = previous; throw err; }
    return this.view();
  }
  private async changed() { this.state.revision++; await this.save(); try { this.onChange(); } catch (err) { console.warn('Delivery notification failed:', err); } }
  async pauseCopilot(paused: boolean) {
    this.requireReady();
    if (this.active || this.demo || !this.state.policy) throw new HttpError(409, 'Configure delivery and wait for the active run before changing platform scope');
    this.state.policy.copilotPaused = paused; await this.changed(); return this.view();
  }
  private async blocker(repoId: string, error: unknown, release?: DeliveryRelease,preflight=false) {
    const message = String((error as Error).message ?? error).slice(0, 4000);
    const prior = this.state.blockers.find((b) => b.repoId === repoId);
    if (!preflight&&prior?.error === message && prior.releaseId === release?.id) return;
    const preflightRetry=preflight?nextPreflightRetry(prior?.preflightRetry,preflightContext(release,this.state.policy!.environmentUrl)):undefined;
    this.state.blockers = this.state.blockers.filter((b) => b.repoId !== repoId);
    this.state.blockers.push({ repoId, releaseId: release?.id, owner: release && !release.approvedAt ? release.plan.qaOwner : release?.plan.owner ?? 'CEO', error: message,
      recovery: 'Resolve the stated prerequisite, then run this release again. For interrupted imports inspect PAC import history before creating a new release.', at: new Date().toISOString(),...(preflightRetry?{preflightRetry}:{}) });
    await this.changed();
  }
  async createRelease(repo: RepoView, input: unknown) {
    this.requireReady();
    if (this.demo || this.active || !this.state.policy?.enabled) throw new HttpError(409, 'Enable real delivery and wait for the active run');
    const plan = releasePlanSchema.parse(input);
    this.checkDeliveryRecord?.(repo,plan);
    if(!plan.architecture)throw new HttpError(409,'Save and commit an architecture version, then pin its document ID and content hash in the release plan');
    const controller = new AbortController();
    await this.command({ executable: 'git', args: ['fetch', 'origin', repo.defaultBranch] }, repo.checkoutPath, {}, controller.signal);
    this.requireReady();
    const head = (await this.command({ executable: 'git', args: ['rev-parse', `origin/${repo.defaultBranch}`] }, repo.checkoutPath, {}, controller.signal)).trim();
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Cannot pin release commit');
    const architecturePath=`docs/architecture/drafts/${plan.architecture.docId}`;
    const artifactJson=await this.command({executable:'git',args:['show',`${head}:${architecturePath}.json`]},repo.checkoutPath,{},controller.signal);
    const artifactMarkdown=await this.command({executable:'git',args:['show',`${head}:${architecturePath}.md`]},repo.checkoutPath,{},controller.signal);
    verifyCommittedArchitecture(artifactJson,artifactMarkdown,repo.id,plan.architecture);
    if(this.validateMonitoring){const monitoringManifest=deliveryManifest.parse(parseUnambiguousJson(await this.command({executable:'git',args:['show',`${head}:cubefarm.delivery.json`]},repo.checkoutPath,{},controller.signal)));this.validateMonitoring(repo.id,plan,monitoringManifest,this.state.policy.environmentUrl);}
    this.checkDeliveryRecord?.(repo,plan);
    if (this.closed || this.active || !this.state.policy?.enabled) throw new HttpError(409, 'Delivery state changed during release preparation; retry');
    const environmentUrl = this.state.policy.environmentUrl;
    const skillLock = selectSkills(discoverSkills(), `${plan.name} ${plan.components.join(' ')} ${plan.acceptanceCriteria.join(' ')}`)
      .map(({ id, sha256, version, file }) => ({ id, sha256, version, file }));
    const planHash = crypto.createHash('sha256').update(JSON.stringify({ plan, head, environmentUrl, skillLock })).digest('hex');
    const duplicate = this.state.releases.find((r) => r.repoId === repo.id && r.planHash === planHash);
    if (duplicate) return structuredClone(duplicate);
    const release: DeliveryRelease = { id: crypto.randomUUID(), repoId: repo.id, head, environmentUrl, plan, planHash, skillLock, createdAt: new Date().toISOString() };
    this.state.releases.unshift(release); await this.changed(); return structuredClone(release);
  }
  async approveRelease(id: string, reviewer: string, hash: string) {
    this.requireReady();
    if (this.demo) throw new HttpError(409, 'Delivery approval unavailable');
    const release = this.state.releases.find((r) => r.id === id);
    if (!release || release.plan.qaOwner !== reviewer || release.plan.owner === reviewer || release.planHash !== hash) throw new HttpError(403, 'Only the assigned independent QA agent can approve this exact release hash');
    requireArchitectureReview(release);
    this.checkDeliveryRecord?.({id:release.repoId},release.plan);
    if (!release.approvedAt) { release.approvedAt = new Date().toISOString(); release.approvedBy = reviewer; await this.changed(); }
    return structuredClone(release);
  }
  async reviewArchitecture(id:string,reviewer:string,hash:string,input:unknown){
    this.requireReady();
    if(this.demo||this.active)throw new HttpError(409,'Architecture review is unavailable during delivery or in demo mode');
    const release=this.state.releases.find(item=>item.id===id);
    if(!release||release.plan.qaOwner!==reviewer||release.plan.owner===reviewer||release.planHash!==hash)throw new HttpError(403,'Only the assigned independent QA session may review this release architecture');
    if(this.state.runs.some(run=>run.releaseId===id))throw new HttpError(409,'Architecture review is immutable once a delivery run exists; create a new release for changes');
    const review=architectureReviewSchema.parse(input);
    this.checkDeliveryRecord?.({id:release.repoId},release.plan);
    if(!release.plan.architecture||review.artifactSha256!==release.plan.architecture.sha256)throw new HttpError(409,'Architecture review differs from its pinned version');
    release.architectureReview={...review,reviewer,reviewedAt:new Date().toISOString()};
    // Any changed review requires a fresh release approval, including rejection.
    delete release.approvedAt;delete release.approvedBy;
    await this.changed();return structuredClone(release);
  }
  // Exclusive process lease prevents two office processes from importing simultaneously.
  private async acquire(): Promise<void> {
    this.lease=await acquireDeliveryLease(this.root);
  }
  private async releaseLease() {
    if (!this.lease) return;
    await this.lease.release();
    this.lease = null;
  }
  async start(repo: RepoView, retry = false, releaseId?: string) {
    this.requireReady();
    if(this.draining)throw new HttpError(409,'Office is draining; new delivery work is paused');
    if (this.demo) throw new HttpError(409, 'Demo never runs delivery commands');
    if (!this.state.policy?.enabled) throw new HttpError(409, 'Real delivery is not enabled');
    if (this.active) throw new HttpError(409, 'A delivery is already running');
    const release = this.state.releases.find((r) => r.repoId === repo.id && (!releaseId || r.id === releaseId));
    const controller = new AbortController(); this.active = controller;
    let attempt:DeliveryAttempt|undefined;
    let prepared!: () => void; this.preparing = new Promise<void>((resolve) => { prepared = resolve; });
    try {
      if (!release) throw new Error('Create a scoped release with required issues, components, acceptance criteria and an independent QA owner');
      if (!releasePlanSchema.safeParse(release.plan).success) throw new Error('Release plan does not satisfy the current UX and monitoring contract; create an updated release and obtain fresh QA approval');
      if (!release.approvedAt) throw new Error(`Awaiting independent QA approval from ${release.plan.qaOwner} for release ${release.id}`);
      requireArchitectureReview(release);
      this.checkDeliveryRecord?.(repo,release.plan);
      if (release.skillLock?.length) {
        const current = discoverSkills();
        for (const skill of release.skillLock) if (!current.skills.some((item) => item.id === skill.id && item.sha256 === skill.sha256 && item.file === skill.file && item.version === skill.version)) throw new Error(`Pinned skill ${skill.id} changed or is unavailable; create a new release for QA review`);
      }
      if (release.environmentUrl !== this.state.policy.environmentUrl) throw new Error('Release target differs from the approved environment; create a new release');
      if (repo.cloneStatus !== 'ready' || repo.syncError) throw new Error('Resolve repository sync errors before delivery');
      const prior = this.state.runs.find((r) => r.releaseId === release.id);
      if (prior && (prior.phase === 'complete' || !retry)) { this.active = null; return this.view(repo.id); }
      const history=this.state.attemptHistory!;
      if(history.attempts.length>=5000)throw new Error('Delivery attempt retention is full; preserve/export history before starting another attempt');
      if(prior?.currentAttemptId){const previous=history.attempts.find(row=>row.id===prior.currentAttemptId);if(previous?.status==='reviewing'){previous.status='superseded';previous.reason='superseded';previous.endedAt=new Date().toISOString();}}
      attempt={id:crypto.randomUUID(),releaseId:release.id,repoId:repo.id,head:release.head,environmentUrl:release.environmentUrl,startedAt:new Date().toISOString(),status:'preparing',acceptanceProfile:acceptanceScope(release.plan).profile};
      history.attempts.push(attempt);await this.save();
      await this.verifyArchitecture(repo,release,controller.signal);
      await this.requireCapabilities(repo, release);
      const git = (args: string[]) => this.command({ executable: 'git', args }, repo.checkoutPath, {}, controller.signal);
      for (const number of release.plan.requiredIssues) {
        const issue = z.object({state:z.enum(['OPEN','CLOSED'])}).parse(parseUnambiguousJson(await this.command({ executable: 'gh', args: ['issue', 'view', String(number), '--repo', repo.fullName ?? repo.id, '--json', 'state'] }, repo.checkoutPath, {}, controller.signal)));
        if (issue.state !== 'CLOSED') throw new Error(`Required issue #${number} is still open`);
      }
      await git(['fetch', 'origin', repo.defaultBranch]);
      // Never substitute a newer commit after QA approval.
      await git(['merge-base', '--is-ancestor', release.head, `origin/${repo.defaultBranch}`]);
      deliveryManifest.parse(parseUnambiguousJson(await git(['show', `${release.head}:cubefarm.delivery.json`])));
      const run: DeliveryRun = prior ?? { id: crypto.randomUUID(), releaseId: release.id, repoId: repo.id, head: release.head, environmentUrl: release.environmentUrl, phase: 'waiting', startedAt: new Date().toISOString(), appUrls: [], evidence: [], log: [] };
      if (!prior) { run.previousRunId = this.state.runs.find((r) => r.repoId === repo.id && r.environmentUrl === run.environmentUrl && r.phase === 'complete')?.id; this.state.runs.unshift(run); }
      attempt.runId=run.id;attempt.status='running';run.currentAttemptId=attempt.id;
      run.error = undefined; run.endedAt = undefined; run.phase = 'waiting';
      run.acceptance = acceptanceScope(release.plan);
      this.state.blockers = this.state.blockers.filter((b) => b.repoId !== repo.id);
      await this.changed();
      const currentAttempt=attempt;
      this.pending = this.execute(repo, run, controller).then(async()=>{
        currentAttempt.status=run.phase==='reviewing'?'reviewing':'failed';
        if(currentAttempt.status==='failed'){currentAttempt.reason='execution';currentAttempt.endedAt=new Date().toISOString();}
        await this.save();
      }).catch(async(error) => {
        currentAttempt.status='failed';currentAttempt.reason='cleanup';currentAttempt.endedAt=new Date().toISOString();
        run.phase='blocked';run.recoveryRequired=true;run.error=`Delivery execution or cleanup failed; reconcile ownership and the persisted checkpoint before retrying: ${error.message}`;
        // A lost office owner cannot write. Otherwise retain the cleanup failure,
        // rather than misreporting every failed lease release as a persistence error.
        await this.save().catch(()=>{});console.warn(run.error);
      }).finally(async () => { this.active = null; this.pending = null; });
      return this.view(repo.id);
    } catch (err) { this.active = null;if(attempt){attempt.status='failed';attempt.reason='preflight';attempt.endedAt=new Date().toISOString();await this.save();}await this.blocker(repo.id, err, release,true); throw err; }
    finally { prepared(); this.preparing = null; }
  }
  async tick(repos: RepoView[]) {
    if (this.closed || this.draining || !this.ready || this.active || this.demo || !this.state.policy?.enabled) return;
    for (const repo of repos) {
      const latest = this.state.runs.find((r) => r.repoId === repo.id && r.environmentUrl === this.state.policy?.environmentUrl);
      if (latest?.phase === 'complete' && latest.health && Date.parse(latest.health.nextCheckAt) <= Date.now()) { await this.monitor(repo, latest.id); return; }
      const release=this.state.releases.find(row=>row.repoId===repo.id);
      if(preflightDeferred(this.state.blockers.find(row=>row.repoId===repo.id)?.preflightRetry,preflightContext(release,this.state.policy.environmentUrl)))continue;
      try { await this.start(repo); } catch { /* Persisted blocker is visible and triggers one review per change. */ }
      if (this.active) break;
    }
  }
  private async requireCapabilities(repo: RepoView, release: DeliveryRelease) {
    this.checkDeliveryRecord?.(repo,release.plan);
    const result = await this.checkCapabilities(repo.id, repo.checkoutPath, release.environmentUrl, true);
    this.checkDeliveryRecord?.(repo,release.plan);
    if (result.status !== 'ready') throw new Error(`Capability preflight blocked: ${result.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.remedy}`).join('; ')}`);
    const manifest=deliveryManifest.parse(parseUnambiguousJson(await this.command({executable:'git',args:['show',`${release.head}:cubefarm.delivery.json`]},repo.checkoutPath,{},this.active?.signal??new AbortController().signal)));
    assertMonitoringContract(release.plan,manifest,result.checks,true);
    return result.configHash ?? crypto.createHash('sha256').update(JSON.stringify(result.checks.map((c) => ({ id: c.id, category: c.category })))).digest('hex');
  }
  private async verifyArchitecture(repo:RepoView,release:DeliveryRelease,signal:AbortSignal){
    const reference=release.plan.architecture;
    if(!reference)throw new HttpError(409,'Release has no pinned architecture; create a reviewed release');
    const location=`docs/architecture/drafts/${reference.docId}`;
    const json=await this.command({executable:'git',args:['show',`${release.head}:${location}.json`]},repo.checkoutPath,{},signal);
    const markdown=await this.command({executable:'git',args:['show',`${release.head}:${location}.md`]},repo.checkoutPath,{},signal);
    verifyCommittedArchitecture(json,markdown,repo.id,reference);
  }
  private async evidenceHash(run: DeliveryRun) {
    const hash = crypto.createHash('sha256');
    for (const name of [...new Set(run.evidence)].sort()) { hash.update(name); hash.update(await fs.readFile(await containedFile(path.join(this.root, 'delivery-runs', run.id, 'evidence'), name))); }
    return hash.digest('hex');
  }
  async approveVisual(id: string, reviewer: string, input: unknown) {
    this.requireReady();
    if (this.demo || this.active) throw new HttpError(409, 'Wait for the active delivery to finish');
    const run = this.state.runs.find((r) => r.id === id); const release = this.state.releases.find((r) => r.id === run?.releaseId);
    if (!run || !release || run.phase !== 'reviewing' || release.plan.qaOwner !== reviewer || reviewer === release.plan.owner) throw new HttpError(403, 'Only the assigned QA reviewer may approve the captured release evidence');
    this.checkDeliveryRecord?.({id:release.repoId},release.plan);
    const attempt=run.currentAttemptId?this.state.attemptHistory?.attempts.find(row=>row.id===run.currentAttemptId):undefined;
    if(run.currentAttemptId&&attempt?.status!=='reviewing')throw new HttpError(409,'Delivery attempt is not awaiting verified QA review; reconcile or rerun before approval');
    const review = z.object({ evidenceHash: z.string(), scores: release.plan.verification.api ? z.array(z.number()).length(0) : z.array(z.number().int().min(4).max(5)).length(5), notes: z.string().min(40).max(4000), recoveryReviewed: z.literal(true) }).strict().parse(input);
    if (review.evidenceHash !== run.evidenceHash || await this.evidenceHash(run) !== review.evidenceHash) throw new HttpError(409, 'Evidence changed; repeat verification and review');
    this.checkDeliveryRecord?.({id:release.repoId},release.plan);
    run.visualReview = { reviewer, reviewedAt: new Date().toISOString(), scores: review.scores, notes: review.notes, evidenceHash: review.evidenceHash };
    if(attempt){attempt.status='successful';attempt.endedAt=new Date().toISOString();attempt.evidenceHash=review.evidenceHash;}
    run.phase = 'complete'; run.endedAt = new Date().toISOString(); await this.changed(); return this.view(run.repoId);
  }
  async monitor(repo: RepoView, id: string) {
    if (this.demo || this.closed || this.draining || !this.ready || this.active || !this.state.policy?.enabled) return;
    const run = this.state.runs.find((r) => r.id === id); const release = this.state.releases.find((r) => r.id === run?.releaseId);
    if (!run || run.repoId !== repo.id || !release || run.phase !== 'complete' || run.environmentUrl !== this.state.policy.environmentUrl) return;
    const controller = new AbortController(); this.active = controller;
    this.pending = (async () => {
      const previous = run.health?.status;
      try {
        requireArchitectureReview(release);
        await this.verifyArchitecture(repo,release,controller.signal);
        const inventory = await this.command({ executable: 'pac', args: ['solution', 'list', '--environment', run.environmentUrl, '--json'] }, repo.checkoutPath, {}, controller.signal);
        if (!installedSolution(inventory, run.solution!, run.version!)) throw new Error('Installed solution/version drift detected');
        const capabilityHash = await this.requireCapabilities(repo, release);
        const manifest=deliveryManifest.parse(parseUnambiguousJson(await this.command({executable:'git',args:['show',`${run.head}:cubefarm.delivery.json`]},repo.checkoutPath,{},controller.signal)));
        await this.governance(run,manifest,'health');
        if (run.health?.capabilityHash && run.health.capabilityHash !== capabilityHash) throw new Error('Capability configuration drift detected; review and issue a new release');
        run.health = { status: 'healthy', checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + release.plan.monitoring.intervalMinutes * 60000).toISOString(), capabilityHash, governanceEvidence:run.health?.governanceEvidence };
        if (previous === 'degraded') this.state.blockers = this.state.blockers.filter((b) => b.repoId !== repo.id || b.releaseId !== release.id);
      } catch (err) {
        run.health = { ...run.health, status: 'degraded', checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + release.plan.monitoring.intervalMinutes * 60000).toISOString(), error: String((err as Error).message) };
        await this.blocker(repo.id, err, release);
      }
      if (previous !== run.health.status) await this.changed(); else await this.save();
    })().finally(() => { this.active = null; this.pending = null; });
    await this.pending;
  }
  async close() { this.permanentlyClosed=true; this.closed = true; this.active?.abort(); await this.recoveryWork?.catch(()=>{}); await this.initializing?.catch(() => {}); await this.preparing; await this.pending; await this.writer.drain(); await this.releaseLease(); }
  async waitForIdle() { await this.pending; }
  private async governance(run:DeliveryRun,manifest:unknown,phase:GovernancePhase) {
    const releaseId=run.releaseId;
    if(!releaseId) throw new Error('Lifecycle governance requires a pinned release identity');
    const checkout=path.join(this.root,'delivery-runs',run.id,'checkout');
    let packageSha256:string|undefined;
    let settingsSha256:string|undefined;
    if(['import','post-deploy','verify','health'].includes(phase)||deliveryManifest.parse(manifest).manualDevelopmentGovernance===true) {
      const parsed=deliveryManifest.parse(manifest),packageFile=await containedFile(checkout,parsed.solutionZip);
      packageSha256=await stablePackageDigest(packageFile,this.active?.signal);
      if(run.recovery&&packageSha256!==run.recovery.packageSha256)throw new Error('Pinned deployment package changed; create a new release');
      if(parsed.settingsFile)settingsSha256=await verifyDeploymentSettings(await containedFile(checkout,parsed.settingsFile),parsed.settingsSha256!,parsed);
    }
    const directory=path.join(this.root,'delivery-runs',run.id,phase==='health'?'health':'evidence');
    const existing=phase==='health'?await fs.readdir(directory).catch((error)=>{if(error.code==='ENOENT')return [] as string[];throw error;}):run.evidence;
    const index=Math.max(-1,...existing.map(file=>Number(file.match(/^governance-(\d+)-/)?.[1]??-1)))+1;
    const file=`governance-${index}-${phase}.json`;
    if(phase==='health') run.health={...(run.health??{status:'pending',nextCheckAt:new Date().toISOString()}),governanceEvidence:`health/${file}`};
    else run.evidence.push(file);
    await this.save();
    try {await requireLifecycleGovernance(this.checkGovernance??this.deps.governance,{phase,sourceCommit:run.head,environmentUrl:run.environmentUrl,releaseId,checkout,manifest,packageSha256,settingsSha256,signal:this.active?.signal,evidenceDirectory:directory,acceptanceProfile:this.state.releases.find(release=>release.id===releaseId)?.plan.acceptanceProfile},directory,index,undefined,async reason=>{
      run.log.push(`${new Date().toISOString()} ${phase} governance ${reason==='deadline'?'deadline exceeded':'cancelled'}; waiting for provider cleanup before releasing delivery ownership`);
      await this.changed();
    });}
    finally {
      const decision=await fs.readFile(path.join(directory,file),'utf8').then(value=>lifecycleResultSchema.parse(parseUnambiguousJson(value))).catch(()=>null);
      if(phase!=='health')for(const field of ['packageInventoryFile','declaredSchemaFile','advancedPolicyFile','connectorCatalogueFile','manualAssessmentFile'] as const){
        const file=decision?.[field];if(typeof file==='string'&&!run.evidence.includes(file))run.evidence.push(file);
      }
    }
  }
  private async execute(repo: RepoView, run: DeliveryRun, controller: AbortController) {
    const recordGate=()=>{const release=this.state.releases.find(r=>r.id===run.releaseId);if(!release)throw new Error('Release disappeared during delivery');this.checkDeliveryRecord?.(repo,release.plan);};
    const dir = path.join(this.root, 'delivery-runs', run.id);
    const checkout = path.join(dir, 'checkout'); const evidence = path.join(dir, 'evidence');
    const env: Record<string, string> = { SWARM_DELIVERY_ENVIRONMENT: run.environmentUrl, SWARM_DELIVERY_COMMIT: run.head,
      SWARM_DELIVERY_REPORT: path.join(evidence, 'verification.json'), SWARM_DELIVERY_EVIDENCE: evidence, SWARM_DELIVERY_RUN_ID: run.id };
    const dotnetDir = path.join(this.root, 'tools', 'dotnet');
    if (await fs.access(path.join(dotnetDir, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')).then(() => true, () => false)) {
      const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
      env[pathKey] = `${dotnetDir}${path.delimiter}${process.env[pathKey] ?? ''}`; env.DOTNET_ROOT = dotnetDir;
    }
    // The target lease is absent only during local checkout preparation. Once acquired,
    // recheck it at every native boundary, including after asynchronous governance.
    let targetLease: Awaited<ReturnType<typeof acquireResourceLease>> | undefined;
    const command = (executable: string, args: string[], cwd = checkout,boundary?:()=>Promise<void>) => this.command({ executable, args }, cwd, env, controller.signal,async()=>{recordGate();await boundary?.();await targetLease?.assertOwned();recordGate();});
    const step = async (phase: DeliveryRun['phase'], fn: () => Promise<unknown>) => {
      recordGate();run.phase = phase; run.log.push(`${new Date().toISOString()} ${phase}`); await this.save(); await fn();recordGate();
    };
    const commands = async (list: DeliveryCommand[],manifest:unknown,phase:GovernancePhase) => { for (const item of list) {await this.governance(run,manifest,phase);await command(item.executable, item.args);} };
    const authoringLeases: Awaited<ReturnType<typeof acquireResourceLease>>[] = [];
    let flow: FlowAdapter | undefined;
    try {
      await fs.mkdir(evidence, { recursive: true });
      if (!(await fs.access(checkout).then(() => true, () => false))) await command('git', ['worktree', 'add', '--detach', checkout, run.head], repo.checkoutPath);
      const release = this.state.releases.find((r) => r.id === run.releaseId);
      if (!release?.approvedAt) throw new Error('Release is not independently approved');
      await atomicWrite(path.join(evidence, 'release.json'), JSON.stringify(release, null, 2));
      run.evidence = ['release.json', ...run.evidence.filter((name) => /^(recovery-|native-operation-|governance-|manual-assessment-|package-inventory-|declared-schema-|advanced-policy-|connector-catalogue-)/.test(name) || name === 'previous-inventory.json' || name === 'target-component-map.json')];
      await command('git', ['diff', '--quiet', run.head, '--']);
      const manifest = deliveryManifest.parse(parseUnambiguousJson(await command('git', ['show', `${run.head}:cubefarm.delivery.json`])));
      if (this.state.policy?.copilotPaused && manifest.targetComponents.some((component) => component.kind === 'copilot')) throw new Error('Copilot Studio delivery is paused by the user');
      if (release.plan.verification.api) {
        if (manifest.hasUi || manifest.targetComponents.some((component) => ['canvas', 'copilot'].includes(component.kind))) throw new Error('API-only verification cannot certify a UI release');
        if (!manifest.targetBinding || JSON.stringify(manifest.targetBinding) !== JSON.stringify(release.plan.verification.api.binding)) throw new Error('API verification must match the approved target binding');
      } else if (!manifest.hasUi) throw new Error('Backend-only releases require API verification');
      run.solution = manifest.solutionUniqueName; run.version = manifest.solutionVersion;
      targetLease = await acquireResourceLease(this.resourceLeaseRoot, `deployment:${canonical(run.environmentUrl)}`, run.id, { reclaimDeadOwner: false });
      for (const appId of [...new Set(manifest.canvasAuthoringApps)].sort()) authoringLeases.push(await acquireResourceLease(this.resourceLeaseRoot, canvasResource(run.environmentUrl, appId), run.id, { reclaimDeadOwner: false }));
      const request: Request = async (method, resource, body, headers) => {
        await targetLease!.assertOwned();
        if(method!=='GET') await this.governance(run,manifest,'post-deploy');
        const receiptFile=method!=='GET'&&release.plan.verification.api?.transaction?`native-operation-${crypto.randomUUID()}.json`:undefined;
        const governanceFile=run.evidence.findLast(file=>/^governance-\d+-post-deploy\.json$/.test(file));
        const decision=receiptFile&&governanceFile?lifecycleResultSchema.parse(await readBoundedJson(path.join(evidence,governanceFile))):undefined;
        const receipt={schemaVersion:1,runId:run.id,sourceCommit:run.head,releaseId:run.releaseId,environmentUrl:run.environmentUrl,method,resource,body:body??null,headers:headers??{},requestSha256:crypto.createHash('sha256').update(JSON.stringify({method,resource,body:body??null,headers:headers??{}})).digest('hex'),governanceFile,manualAssessmentId:decision?.manualAssessmentId,authorisation:'Phase approval of the exact reviewed transaction code and contract; dynamic GUID/payload guards are runner-owned, not individually approved by a human',at:new Date().toISOString(),outcome:'intent',responseSha256:undefined as string|undefined,errorCode:undefined as string|undefined};
        if(receiptFile){if(decision?.status!=='clear')throw new Error('Mutation lacks its retained clear phase assessment');await atomicWrite(path.join(evidence,receiptFile),JSON.stringify(receipt,null,2));run.evidence.push(receiptFile);await this.save();}
        let output:string;
        try{output=await command('dataverse', ['api', 'request', '--target', 'dataverse', '--environment', run.environmentUrl, '--method', method, '--path', `/api/data/v9.2/${resource}`, ...(body ? ['--body', JSON.stringify(body)] : []), ...Object.entries(headers ?? {}).flatMap(([key, value]) => ['--header', `${key}:${value}`])]);receipt.outcome='returned';receipt.responseSha256=crypto.createHash('sha256').update(output).digest('hex');}
        catch(error){receipt.outcome='failed-or-unknown';if(error instanceof PlatformCommandError)receipt.errorCode=error.platformErrorCode;throw error;}
        finally{if(receiptFile)await atomicWrite(path.join(evidence,receiptFile),JSON.stringify(receipt,null,2));}
        if (method !== 'GET' && !output.trim()) return null;
        // Fail closed on unexpected CLI output rather than guessing a JSON fragment.
        return parseUnambiguousJson(output.trim());
      };
      if (manifest.targetBinding) await verifyTarget(request, manifest.targetBinding);
      const transaction=release.plan.verification.api?.transaction;
      if(transaction){const mapping=await mapTargetComponents(request,manifest.solutionUniqueName,manifest.targetComponents,run.environmentUrl);if(!mapping.some(component=>component.kind==='dataverse-table'&&component.entitySet===transaction.entitySet&&component.primaryId===transaction.idField)||!mapping.some(component=>component.kind==='dataverse-table'&&component.entitySet===transaction.childEntitySet&&component.primaryId===transaction.childIdField))throw new Error('Runner transaction must use the declared mapped table and dependent table');}
      const cloudComponents = manifest.targetComponents.filter((c) => c.kind === 'cloud-flow');
      for (const component of cloudComponents) if (!release.plan.verification.cloudFlowChecks?.some((check) => check.component === component.key)) throw new Error(`Cloud flow ${component.key} requires a QA-owned correlated runtime check`);
      for (const check of release.plan.verification.cloudFlowChecks ?? []) if (!cloudComponents.some((c) => c.key === check.component)) throw new Error(`Cloud-flow check references unknown component ${check.component}`);
      const copilotComponents = manifest.targetComponents.filter((c) => c.kind === 'copilot');
      for (const component of copilotComponents) if (!manifest.hasUi || !release.plan.verification.copilotChecks?.some((check) => check.component === component.key)) throw new Error(`Copilot ${component.key} requires QA-owned published-channel conversation checks`);
      for (const check of release.plan.verification.copilotChecks ?? []) if (!copilotComponents.some((c) => c.key === check.component)) throw new Error(`Copilot check references unknown component ${check.component}`);
      if (cloudComponents.length) flow = await connectOwnedFlowAdapter(
        ()=>(this.deps.flow??connectFlowAdapter)(checkout,controller.signal),
        async()=>{await this.assertLeaseOwned();await targetLease!.assertOwned();},controller.signal);
      const checkAuthentication = async (action?:TargetAction) => {
        if (!manifest.platformIdentity || !manifest.targetBinding) {if(manifest.targetBinding)await verifyTarget(request,manifest.targetBinding);return;}
        const flowWho=flow?()=>flow!.call('whoami',{}):undefined;
        const receipt=action
          ?await verifyTypedActionAuthentication(action,command,request,run.environmentUrl,manifest.targetBinding,manifest.platformIdentity,flowWho)
          :await verifyPlatformAuthentication(command,request,run.environmentUrl,manifest.targetBinding,manifest.platformIdentity,flowWho);
        const file=action?`platform-authentication-${action.id}.json`:'platform-authentication.json';
        await atomicWrite(path.join(evidence,file), JSON.stringify(receipt, null, 2));
        if (!run.evidence.includes(file)) run.evidence.push(file);
      };
      await checkAuthentication();
      for (const doc of manifest.documentation) await containedFile(checkout, doc);
      if (!run.checkpoint || run.checkpoint === 'prepared') await verifyMigrationCompatibility(manifest.postDeployActions, manifest.targetComponents, request);
      if (!run.checkpoint || run.checkpoint === 'prepared') {
        await step('building', () => commands(manifest.build,manifest,'build'));
        await step('testing', () => commands(manifest.test,manifest,'test'));
        run.checkpoint = 'prepared'; await this.save();
      }
      for (const identity of release.plan.verification.identities) {
        const file = path.join(this.root, 'delivery-identities', `${identity.id}.json`);
        try { z.object({cookies:z.array(z.unknown()),origins:z.array(z.unknown())}).parse(parseUnambiguousJson(await fs.readFile(file, 'utf8'))); }
        catch { throw new Error(`Connect QA identity ${identity.id} in delivery-identities/${identity.id}.json before deployment`); }
      }
      const zip = await containedFile(checkout, manifest.solutionZip);
      if (run.recovery && await stablePackageDigest(zip,controller.signal) !== run.recovery.packageSha256) throw new Error('Retained deployment package changed; create a new release');
      const settings = manifest.settingsFile ? await containedFile(checkout, manifest.settingsFile) : undefined;
      if(settings)await verifyDeploymentSettings(settings,manifest.settingsSha256!,manifest);
      // Retain the prior deployment inventory and verify a data-preserving rehearsal before import.
      const priorInventory = await command('pac', ['solution', 'list', '--environment', run.environmentUrl, '--json']);
      if (!run.recovery) {
        const runbook = await containedFile(checkout, manifest.recovery.runbook);
        const reportFile = manifest.recovery.scope?undefined:await containedFile(checkout, manifest.recovery.rehearsalReport!);
        const digest = z.string().regex(/^[a-f0-9]{64}$/);
        const development=manifest.recovery.scope==='pilot-owned-development-records';
        if(development&&(!manifest.manualDevelopmentGovernance||release.plan.acceptanceProfile!=='functional-development'||!release.plan.verification.api?.transaction||manifest.hasUi))throw new Error('Same-environment recovery is restricted to a reviewed runner-owned development transaction');
        const runbookBytes = await fs.readFile(runbook);
        const drill=development?await verifyBackendJourney(release.plan.verification.api!.transaction!,manifest.targetBinding!,request,evidence,controller.signal,{runId:run.id,sourceCommit:run.head},'recovery',()=>this.governance(run,manifest,'post-deploy')):undefined;
        const rehearsal = z.object({ sourceCommit: z.string(), performedAt: z.iso.datetime(), environmentUrl: https, procedureSha256: digest, restored: z.literal(true), dataPreserved: z.literal(true), protectedRecords: z.array(z.object({ table: z.string().min(1), id: z.string().min(1), beforeSha256: digest, afterSha256: digest }).strict()).min(1), evidence: z.array(z.string().min(1)).min(1) }).strict().parse(drill?{sourceCommit:run.head,performedAt:drill.result.performedAt,environmentUrl:run.environmentUrl,procedureSha256:crypto.createHash('sha256').update(runbookBytes).digest('hex'),restored:drill.result.restored,dataPreserved:drill.result.dataPreserved,protectedRecords:drill.result.protectedRecords,evidence:[drill.file,'independent-recovery-journal.json']}:parseUnambiguousJson(await fs.readFile(reportFile!, 'utf8')));
        if (rehearsal.sourceCommit !== run.head || (!development&&canonical(rehearsal.environmentUrl) === run.environmentUrl) || Date.parse(rehearsal.performedAt) < Date.now() - 30 * 86400000 || Date.parse(rehearsal.performedAt) > Date.now() + 60000 || rehearsal.procedureSha256 !== crypto.createHash('sha256').update(runbookBytes).digest('hex')) throw new Error(development?'Recovery rehearsal must match the approved development scope, commit, runbook and environment':'Recovery rehearsal must match this commit/runbook, be recent, and use a separate authorized test environment');
        if (rehearsal.protectedRecords.some((record) => record.beforeSha256 !== record.afterSha256) || new Set(rehearsal.protectedRecords.map((record) => `${record.table}:${record.id}`)).size !== rehearsal.protectedRecords.length) throw new Error('Recovery rehearsal did not preserve every protected record');
        for (const [i, file] of rehearsal.evidence.entries()) { const original = await containedFile(development?evidence:checkout, file); const name = `recovery-rehearsal-${i}${path.extname(file)}`; await fs.copyFile(original, path.join(evidence, name)); run.evidence.push(name); }
        await atomicWrite(path.join(evidence, 'previous-inventory.json'), priorInventory);
        if(development)await atomicWrite(path.join(evidence,'recovery-rehearsal.json'),JSON.stringify({...rehearsal,scope:manifest.recovery.scope},null,2));else await fs.copyFile(reportFile!, path.join(evidence, 'recovery-rehearsal.json'));
        await fs.writeFile(path.join(evidence, 'recovery-runbook.md'), runbookBytes);
        run.recovery = { inventoryFile: 'previous-inventory.json', runbook: 'recovery-runbook.md', drillReport: 'recovery-rehearsal.json', packageSha256: await stablePackageDigest(zip,controller.signal) };
        run.evidence.push('previous-inventory.json', 'recovery-rehearsal.json', 'recovery-runbook.md'); await this.save();
      }
      await retainOwnedRecoveryEvidence(manifest.recovery.scope,evidence,run.evidence);
      const capabilityHash = await this.requireCapabilities(repo, release);
      const mutation = async (id: string, kind: 'import' | 'post-deploy', executable: string, args: string[]) => {
        await targetLease!.assertOwned();
        await checkAuthentication();
        if (manifest.targetBinding) await verifyTarget(request, manifest.targetBinding);
        await this.governance(run,manifest,kind==='import'?'import':'post-deploy');
        if(kind==='import') run.checkpoint='import-started';
        run.operations ??= [];
        if (run.operations.some((op) => op.id === id)) throw new Error(`Operation ${id} already has a recorded outcome; reconcile it before retrying`);
        const operation: NonNullable<DeliveryRun['operations']>[number] = { id, kind, status: 'intent',
          commandSha256: crypto.createHash('sha256').update(JSON.stringify({ executable, args })).digest('hex'), startedAt: new Date().toISOString() };
        run.operations.push(operation); await this.save();
        try {
          const output = await command(executable, args,checkout,kind==='import'?async()=>{
            const current=await containedFile(checkout,manifest.solutionZip);
            if(current!==zip||await stablePackageDigest(current,controller.signal)!==run.recovery!.packageSha256)throw new Error('Pinned deployment package changed at native import boundary; reconcile before retrying');
            if(settings){if(await containedFile(checkout,manifest.settingsFile!)!==settings)throw new Error('Deployment settings path changed at import boundary');await verifyDeploymentSettings(settings,manifest.settingsSha256!,manifest);}
          }:undefined);
          operation.status = 'reported-success'; operation.endedAt = new Date().toISOString();
          if (kind === 'import') operation.platformJobId = importJobId(output);
          await this.save();
        } catch (error) { operation.status = 'unknown'; operation.endedAt = new Date().toISOString();run.recoveryRequired=true; await this.save(); throw error; }
      };

      if (run.checkpoint === 'import-started') {
        const inventory = await command('pac', ['solution', 'list', '--environment', run.environmentUrl, '--json']);
        const found = installedSolution(inventory, manifest.solutionUniqueName, manifest.solutionVersion);
        throw new Error(`Import outcome is ambiguous after interruption (${found ? 'matching version exists but does not prove this import completed' : 'version not found'}). Inspect tenant import history; this run will not re-import automatically.`);
      }
      if (run.checkpoint === 'post-started' && (manifest.postDeploy.length || !manifest.postDeployActions.length)) throw new Error('Post-deployment outcome is ambiguous; inspect activation/sharing/flow state before creating a replacement release');
      await step('deploying', async () => {
        if (run.checkpoint === 'prepared') {
          const referenceDevelopment=manifest.manualDevelopmentGovernance===true&&release.plan.acceptanceProfile==='functional-development';
          await mutation('solution-import', 'import', 'pac', ['solution', 'import', '--environment', run.environmentUrl, '--path', zip, ...(!referenceDevelopment?['--publish-changes']:[]), ...(settings ? ['--settings-file', settings] : [])]);
          run.checkpoint = 'imported'; await this.save();
        }
        if (run.checkpoint === 'imported' || run.checkpoint === 'post-started') {
          await this.governance(run,manifest,'post-deploy');
          run.checkpoint = 'post-started'; await this.save();
          for (const [index, item] of manifest.postDeploy.entries()) await mutation(`post-deploy-${index}`, 'post-deploy', item.executable, item.args);
          if (manifest.targetBinding) {
            await verifyTarget(request, manifest.targetBinding);
            const mapping = await mapTargetComponents(request, manifest.solutionUniqueName, manifest.targetComponents,run.environmentUrl);
            await atomicWrite(path.join(evidence, 'target-component-map.json'), JSON.stringify({ environmentUrl: run.environmentUrl, binding: manifest.targetBinding, mapping }, null, 2));
            run.evidence.push('target-component-map.json');
            // Verify references before any flow can be activated, regardless of manifest order.
            const priority = (type: string) => type === 'connection-reference-bind' ? 0 : type === 'connection-reference-check' || type === 'schema-check' ? 1 : 2;
            const orderedActions = [...manifest.postDeployActions].sort((a, b) => priority(a.type) - priority(b.type));
            for (const action of orderedActions) {
              await this.governance(run,manifest,'post-deploy');
              await checkAuthentication(action);
              const component = mapping.find((c) => c.key === action.component)!;
              const save = () => this.save(), owned = async () => {recordGate();await this.assertLeaseOwned();await targetLease!.assertOwned();recordGate();};
              if (action.type === 'workflow-state') await reconcileWorkflowAction(action, component, request, run, save, owned);
              else if (action.type === 'cloud-flow-state') {
                if (action.state === 'active') await verifyCloudFlowActivationBindings(flow!, manifest.platformIdentity!.environmentId, component.id, manifest.targetComponents, manifest.postDeployActions, async (check) => {
                  await verifyTarget(request, manifest.targetBinding!);
                  await verifyConnectionReference(check, mapping.find((item) => item.key === check.component)!, request, run, save, owned);
                });
                await reconcileCloudFlow(action, component, flow!, manifest.platformIdentity!, manifest.solutionUniqueName, run, save, owned);
                if (action.state === 'active') await verifyCloudFlowBindings(flow!, manifest.platformIdentity!.environmentId, component.id, manifest.targetComponents, manifest.postDeployActions);
              }
              else if (action.type === 'connection-reference-check') await verifyConnectionReference(action, component, request, run, save, owned);
              else if (action.type === 'connection-reference-bind' || action.type === 'record-share' || action.type === 'schema-check') await reconcileAdditionalAction(action, component, request, run, save, owned);
              else await reconcileCopilot(action, component, request, command, run, save, owned);
            }
          }
          run.checkpoint = 'deployed'; await this.save();
        }
      });
      await step('verifying', async () => {
        await this.governance(run,manifest,'verify');
        let verifiedMapping: Awaited<ReturnType<typeof mapTargetComponents>> = [];
        if (manifest.targetBinding) {
          await verifyTarget(request, manifest.targetBinding);
          verifiedMapping = await mapTargetComponents(request, manifest.solutionUniqueName, manifest.targetComponents,run.environmentUrl);
          const retained = z.object({mapping:z.array(z.unknown())}).parse(parseUnambiguousJson(await fs.readFile(path.join(evidence, 'target-component-map.json'), 'utf8')));
          if (JSON.stringify(retained.mapping) !== JSON.stringify(verifiedMapping)) throw new Error('Target component mapping changed after deployment; inspect the target before retrying');
        }
        const inventory = await command('pac', ['solution', 'list', '--environment', run.environmentUrl, '--json']);
        if (!installedSolution(inventory, manifest.solutionUniqueName, manifest.solutionVersion)) throw new Error('Imported solution/version was not found in the target environment');
        const imported = run.operations?.find((operation) => operation.id === 'solution-import');
        if (imported?.status === 'reported-success') { imported.status = 'verified'; await this.save(); }
        await atomicWrite(path.join(evidence, 'solution-inventory.json'), inventory);
        await atomicWrite(path.join(evidence, 'operation-journal.json'), JSON.stringify({ schemaVersion: 1, releaseId: release.id,
          environmentUrl: run.environmentUrl, packageSha256: run.recovery!.packageSha256, operations: run.operations ?? [],
          note: 'Reported command success alone does not establish post-deployment action correctness. Ambiguous outcomes require platform reconciliation.' }, null, 2));
        await fs.rm(env.SWARM_DELIVERY_REPORT, { force: true });
        await commands(manifest.verify,manifest,'verify');
        for (const action of [...manifest.postDeployActions].sort((a, b) => Number(b.type === 'connection-reference-check') - Number(a.type === 'connection-reference-check'))) {
          await this.governance(run,manifest,'verify');
          if (!run.operations?.some((op) => op.id === `typed:${action.id}` && op.status === 'verified')) throw new Error(`Post-deployment action ${action.id} lacks a verified journal entry`);
          const component = verifiedMapping.find((item) => item.key === action.component)!;
          const save = () => this.save(), owned = async () => {await this.assertLeaseOwned();await targetLease!.assertOwned();};
          if (action.type === 'workflow-state') await reconcileWorkflowAction(action, component, request, run, save, owned);
          else if (action.type === 'cloud-flow-state') {
            if (action.state === 'active') await verifyCloudFlowBindings(flow!, manifest.platformIdentity!.environmentId, component.id, manifest.targetComponents, manifest.postDeployActions);
            await reconcileCloudFlow(action, component, flow!, manifest.platformIdentity!, manifest.solutionUniqueName, run, save, owned);
          }
          else if (action.type === 'connection-reference-check') await verifyConnectionReference(action, component, request, run, save, owned);
          else if (action.type === 'connection-reference-bind' || action.type === 'record-share' || action.type === 'schema-check') await reconcileAdditionalAction(action, component, request, run, save, owned);
          else await reconcileCopilot(action, component, request, command, run, save, owned);
        }
        if (flow && manifest.platformIdentity) {
          const observations = [];
          for (const check of release.plan.verification.cloudFlowChecks ?? []) {
            const component = verifiedMapping.find((c) => c.key === check.component)!;
            await verifyCloudFlowContext(flow, manifest.platformIdentity, component.id, component.id, manifest.solutionUniqueName);
            await verifyCloudFlowBindings(flow, manifest.platformIdentity.environmentId, component.id, manifest.targetComponents, manifest.postDeployActions);
            observations.push(await verifyCloudFlowRun(flow, manifest.platformIdentity.environmentId, component.id, run.id, run.startedAt, check));
          }
          await atomicWrite(path.join(evidence, 'cloud-flow-verification.json'), JSON.stringify({ environmentUrl: run.environmentUrl, sourceCommit: run.head, observations }, null, 2));
          run.evidence.push('cloud-flow-verification.json');
        }
        let independent:string[]|undefined;
        if(release.plan.verification.api?.transaction){
          independent=await verifyApiIndependently(release.plan.verification.api,request,evidence,controller.signal,{runId:run.id,sourceCommit:run.head},()=>this.governance(run,manifest,'post-deploy'));
          const report={environmentUrl:run.environmentUrl,sourceCommit:run.head,solutionUniqueName:manifest.solutionUniqueName,solutionVersion:manifest.solutionVersion,verifiedAt:new Date().toISOString(),authenticatedUser:manifest.platformIdentity!.username,appUrls:[],security:'not-verified',persistence:'passed',tests:[
            {name:'Runner created a uniquely owned draft',category:'journey',passed:true,evidence:'independent-journey.json'},
            {name:'Fresh authenticated read preserved pilot business values',category:'persistence',passed:true,evidence:'independent-journey.json'},
            {name:'Server rejected the overlength write without changing state',category:'error-handling',passed:true,evidence:'independent-journey.json'},
            {name:'Approved caller and own-record ownership checked before guarded writes',category:'authorization',passed:true,evidence:'independent-journey.json'},
          ]};await atomicWrite(path.join(evidence,'verification.json'),JSON.stringify(report,null,2));
        }
        const report = verificationReport.parse(parseUnambiguousJson(await fs.readFile(await containedFile(evidence, 'verification.json'), 'utf8')));
        if (manifest.hasUi && !report.appUrls.length) throw new Error('UI verification requires deployed app URLs');
        verifyMappedCanvasUrls(verifiedMapping, report.appUrls);
        for (const check of release.plan.verification.copilotChecks ?? []) if (!report.appUrls.some((url) => new URL(url).href === new URL(check.channelUrl).href)) throw new Error('Verification report must include the approved published Copilot channel URL');
        if (release.plan.acceptanceProfile !== 'functional-development' && report.security !== 'passed') throw new Error('Production acceptance requires passing authorization evidence; use functional-development scope for unverified permission isolation');
        if (canonical(report.environmentUrl) !== run.environmentUrl || report.sourceCommit !== run.head || report.solutionUniqueName !== run.solution || report.solutionVersion !== run.version || Date.parse(report.verifiedAt) < Date.parse(run.startedAt) || Date.parse(report.verifiedAt) > Date.now() + 60_000) throw new Error('Verification evidence does not match this deployment');
        if (manifest.hasUi && !report.ui) throw new Error('Desktop/mobile, accessibility and design evidence is required');
        const files = [...report.tests.map((t) => t.evidence), ...(report.ui ? [report.ui.desktop, report.ui.mobile, report.ui.trace] : [])];
        for (const file of files) await containedFile(evidence, file);
        await this.assertLeaseOwned();await targetLease!.assertOwned();
        independent ??= release.plan.verification.api
          ? await verifyApiIndependently(release.plan.verification.api, request, evidence, controller.signal,{runId:run.id,sourceCommit:run.head})
          : await (this.deps.verify ?? verifyIndependently)(release.plan, this.root, evidence, controller.signal);
        await this.assertLeaseOwned();await targetLease!.assertOwned();
        if (copilotComponents.length) {
          await atomicWrite(path.join(evidence, 'copilot-verification.json'), JSON.stringify({ environmentUrl: run.environmentUrl, sourceCommit: run.head, mapping: verifiedMapping.filter((c) => c.kind === 'copilot'),
            checks: release.plan.verification.copilotChecks, independentEvidence: independent }, null, 2));
          run.evidence.push('copilot-verification.json');
        }
        for (const file of independent) await containedFile(evidence, file);
        // Runner-owned scope is hash-bound with QA evidence; repository reports cannot widen it.
        await atomicWrite(path.join(evidence, 'acceptance-scope.json'), JSON.stringify({ schemaVersion: 1,
          ...acceptanceScope(release.plan), releaseId: release.id, planHash: release.planHash, sourceCommit: run.head,
          environmentUrl: run.environmentUrl, solutionUniqueName: run.solution, solutionVersion: run.version,
          packageSha256: run.recovery!.packageSha256, verifiedAt: new Date().toISOString(),
          independentMethod: release.plan.verification.api ? 'dataverse-api' : release.plan.verification.frame ? 'browser-frame' : 'browser-dom', identities: release.plan.verification.identities.map(({ id, expectedUser }) => ({ id, expectedUser })),
          privilegeVerification: 'not-established-by-browser-identity-check',
        }, null, 2));
        run.appUrls = release.plan.verification.api ? [] : [release.plan.verification.baseUrl]; run.evidence = [...new Set([...run.evidence, 'operation-journal.json', 'acceptance-scope.json', 'verification.json', 'solution-inventory.json', ...files, ...independent])];
      });
      run.phase = 'reviewing'; run.recoveryRequired = false;
      run.evidenceHash = await this.evidenceHash(run);
      run.health = { status: 'pending', capabilityHash, nextCheckAt: new Date(Date.now() + release.plan.monitoring.intervalMinutes * 60000).toISOString() };
    } catch (err) {
      run.phase = 'blocked'; run.error = String((err as Error).message).slice(0, 4000);
      if (run.operations?.length) {
        await atomicWrite(path.join(evidence, 'operation-journal.json'), JSON.stringify({ schemaVersion: 1, releaseId: run.releaseId,
          environmentUrl: run.environmentUrl, operations: run.operations }, null, 2));
        run.evidence.push('operation-journal.json');
      }
      // Retain central diagnostics for failed browser checks as well as successful runs.
      for (const file of await fs.readdir(evidence).catch(() => [] as string[])) {
        if (!/^(independent-[a-zA-Z0-9_-]+\.(json|png|zip)|solution-inventory\.json)$/.test(file)) continue;
        if (await containedFile(evidence, file).then(() => true, () => false)) run.evidence.push(file);
      }
      run.evidence = [...new Set(run.evidence)];
    }
    finally {
      try { run.endedAt = new Date().toISOString(); if (run.phase === 'blocked') { await this.blocker(repo.id, new Error(run.error), this.state.releases.find((r) => r.id === run.releaseId)); await this.save(); } else await this.changed(); }
      finally { try { await flow?.close(); } finally { try { for (const lease of authoringLeases.reverse()) await lease.release(); } finally { await targetLease?.release(); } } }
    }
  }
}
