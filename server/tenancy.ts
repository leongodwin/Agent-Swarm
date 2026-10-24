import {HOME_DIR} from './config.ts';
import {TenancyMutationStore} from './tenancyMutation.ts';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveCommand, unwrapCmdShim } from './clis.ts';
import { HttpError } from './httpError.ts';
import type { TenancyInfo, TenancyLogin, TenancyLoginInput,TenancyActivity } from '../shared/tenancy.ts';
import {identityRoot} from './identityContracts.ts';
import {currentEnvironment} from '../shared/tenancy.ts';
import {parsePacIdentity} from './platformAuth.ts';
import {parsePacTenantIdentity} from './pacTenantIdentity.ts';
export type { TenancyInfo, TenancyEnvironment } from '../shared/tenancy.ts';

/** Resolve CLI shims to programs so values never pass through a shell. */
export function resolveTenancyCommand(name: string): { file: string; args: string[] } {
  const installed = name === 'pac' && process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'PowerAppsCLI', 'pac.launcher.exe') : '';
  if (installed && fs.existsSync(installed)) return { file: installed, args: [] };
  const file = path.isAbsolute(name) && fs.existsSync(name) && fs.statSync(name).isFile() ? name : resolveCommand(name);
  if (!file) throw new HttpError(503, `${name} CLI is not installed`);
  if (/\.(cmd|bat)$/i.test(file)) {
    const text = fs.readFileSync(file, 'utf8');
    // Azure's MSI shim runs its bundled Python with module flags. Preserve those
    // flags instead of treating python.exe as a standalone Azure executable.
    if (name === 'az' && /-IBm azure\.cli %\*/.test(text)) {
      const python = path.resolve(path.dirname(file), '..', 'python.exe');
      if (fs.existsSync(python)) return { file: python, args: ['-IBm', 'azure.cli'] };
    }
    const native = text.match(/"%~dp0([^"\r\n]+\.exe)"/i)?.[1];
    if (native) return { file: path.resolve(path.dirname(file), native), args: [] };
    const unwrapped = unwrapCmdShim(file, text);
    if (unwrapped) return unwrapped;
    throw new HttpError(503, `Cannot safely resolve the ${name} CLI shim; install its executable on PATH`);
  }
  return { file, args: [] };
}

export interface TenancyRunner {
  run(name: string, args: string[]): Promise<string>;
  start(args: string[], output: (text: string) => void, ended: (error?: string) => void): () => void;
}
const realRunner: TenancyRunner = {
  run(name, args) {
    return new Promise((resolve, reject) => {
      try {
        const cmd = resolveTenancyCommand(name);
        execFile(cmd.file, [...cmd.args, ...args], { encoding: 'utf8', windowsHide: true, timeout: name==='pac'&&args[0]==='org'&&args[1]==='select'?20000:8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
          if (err) reject(new Error(`${name} CLI request failed`)); else resolve(stdout);
        });
      } catch (err) { reject(err); }
    });
  },
  start(args, output, ended) {
    const cmd = resolveTenancyCommand('pac');
    const child = spawn(cmd.file, [...cmd.args, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false,processError=false;
    const finish = (error?: string) => { if (!done) { done = true; ended(error); } };
    child.stdout.on('data', (data: Buffer) => output(data.toString()));
    child.stderr.on('data', (data: Buffer) => output(data.toString()));
    child.on('error', () => {processError=true;if(child.pid===undefined)finish('PAC could not start');else output('Error: PAC process error; waiting for confirmed native exit\n');});
    child.once('close', (code) => finish(code === 0&&!processError ? undefined : 'PAC authentication failed'));
    return () => {
      if(process.platform==='win32'&&child.pid)execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},error=>{if(error&&!done)output('Error: PAC process-tree cancellation failed; waiting for confirmed native exit\n');});
      else child.kill();
    };
  },
};
const disconnected = (): TenancyInfo => ({ tenantName: '', tenantDomain: '', tenantId: '', user: '', environments: [], isReal: false, status: 'disconnected' });

/** PAC profiles are the authority; an unrelated Azure account is never substituted. */
export function parsePacProfiles(output: string): TenancyInfo {
  if(Buffer.byteLength(output)>64*1024)throw new Error('PAC profile inventory exceeds its bound');
  const info = disconnected();
  for (const line of output.split(/\r?\n/)) {
    const index = line.match(/^\s*\[(\d+)\]/)?.[1];
    const url = line.match(/https:\/\/[^\s]+/)?.[0];
    if (!index || !url) continue;
    const number=Number(index);if(!Number.isSafeInteger(number)||number<1||info.environments.some(environment=>environment.index===number))throw new Error('PAC profile identity is invalid or ambiguous');
    const root=identityRoot(url);
    const user = line.match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? '';
    const name = new URL(root).hostname.split('.')[0];
    info.environments.push({ index: number, name, url:root+'/', user, active: /^\s*\[\d+\]\s+\*(?:\s|$)/.test(line) });
  }
  if(info.environments.filter(environment=>environment.active).length>1)throw new Error('PAC active profile is ambiguous');
  const active = info.environments.find((env) => env.active);
  info.user = active?.user ?? ''; info.isReal = !!active;
  info.status = active ? 'connected' : 'disconnected';
  return info;
}
export interface TenancyService {
  info(): Promise<TenancyInfo>;
  verifyCurrentTenant?(environmentUrl:string,username:string):Promise<TenancyInfo>;
  select(index: number): Promise<{ ok: boolean; message: string }>;
  selectEnvironment?(environmentUrl:string,username:string):Promise<{ok:boolean;message:string}>;
  login(input: TenancyLoginInput): TenancyLogin;
  loginStatus(id: string): TenancyLogin;
  cancelLogin(id: string): void;
  close(): void;
  activity():TenancyActivity;
  shutdown():Promise<void>;
}

export function createTenancyService(demo = false, runner: TenancyRunner = realRunner, stateRoot:string=HOME_DIR): TenancyService {
  const mutations=demo?null:new TenancyMutationStore(path.join(stateRoot,'tenancy-mutation.json'));
  const mutationView=()=>mutations?.view()??{status:'clear' as const,quarantined:false,fingerprint:null};
  let cache: TenancyInfo | null = null;
  let checkedAt = 0;
  let generation = 0;
  let refreshing: Promise<TenancyInfo> | null = null;
  let closed=false,selecting=false;
  const jobs = new Map<string, { value: TenancyLogin; stop: () => void; timer?: NodeJS.Timeout }>();
  const nativeCommands=new Set<object>(),idleWaiters=new Set<()=>void>();
  let shutdownWork:Promise<void>|undefined,cleanupFailure:Error|undefined;
  const localActivity=()=>({profileSelection:selecting,authenticationRequests:[...jobs.values()].filter(job=>job.value.status==='pending').length,awaitingNativeExit:[...jobs.values()].filter(job=>job.value.nativeCleanup==='awaiting-exit').length,nativeCommands:nativeCommands.size});
  const activity=():TenancyActivity=>{const local=localActivity(),profileMutation=mutationView();if(profileMutation.status==='pending'&&!local.profileSelection&&!local.authenticationRequests&&!local.awaitingNativeExit){profileMutation.quarantined=true;profileMutation.reason='An owned profile intent has no tracked terminal outcome. Preserve and reconcile it before starting work.';}return {scope:'process-local-tenancy-work',closed,...local,profileMutation,busy:local.profileSelection||local.authenticationRequests>0||local.awaitingNativeExit>0||local.nativeCommands>0||profileMutation.status!=='clear'};};
  const acknowledge=(id:string|undefined,scope:'native-authentication-terminal'|'profile-command-settled')=>{if(!id)return true;try{mutations!.acknowledge(id,scope);return true;}catch{cleanupFailure=new Error('Authentication ownership acknowledgement failed; preserve and reconcile its evidence');return false;}};
  const notify=()=>{for(const waiter of [...idleWaiters])waiter();};
  const run=async(name:string,args:string[])=>{const ticket={};nativeCommands.add(ticket);try{if(closed)throw new HttpError(503,'Tenancy service is closed');return await runner.run(name,args);}finally{nativeCommands.delete(ticket);notify();}};
  const demoInfo: TenancyInfo = { tenantName: 'Demo tenant', tenantDomain: 'example.com', tenantId: '', user: 'manager@example.com',
    environments: [{ index: 1, name: 'Demo sandbox', url: 'https://demo.example.com', user: 'manager@example.com', active: true }], isReal: false, status: 'demo' };
  const invalidate = () => { cache = null; checkedAt = 0; generation++; refreshing = null; };
  const assertOpen=()=>{if(closed)throw new HttpError(503,'Tenancy service is closed');};
  const profileBusy=()=>mutationView().status!=='clear'||selecting||[...jobs.values()].some(job=>job.value.status==='pending'||job.value.nativeCleanup==='awaiting-exit');
  const assertProfileIdle=()=>{if(profileBusy())throw new HttpError(409,'An authentication profile change or native process cleanup is already pending');};
  const info = async (): Promise<TenancyInfo> => {
    if(closed)return disconnected();
    if (demo) return structuredClone(demoInfo);
    if(profileBusy())return cache?{...structuredClone(cache),status:'stale',isReal:false,authenticationBusy:true}:{...disconnected(),authenticationBusy:true};
    const age=Date.now()-checkedAt;
    if (cache && age>=0&&age < 20_000) return structuredClone(cache);
    if (!refreshing) {
      const current = generation;
      const previous=cache?structuredClone(cache):null;
      const request = run('pac', ['auth', 'list']).then(parsePacProfiles).catch(() => previous ? { ...previous, status: 'stale' as const,isReal:false } : disconnected());
      refreshing = request.then((result) => {
        if(closed)return disconnected();
        if(generation!==current)return {...structuredClone(result),status:'stale',isReal:false};
        if (generation === current) { cache = result; checkedAt = Date.now(); refreshing = null; }
        return structuredClone(result);
      });
    }
    return structuredClone(await refreshing);
  };
  const lookup = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new HttpError(404, 'Authentication request not found');
    return job;
  };
  const close=()=>{
    if(closed)return;closed=true;invalidate();let failed=false;
    for(const job of jobs.values()){
      clearTimeout(job.timer);
      const pending=job.value.status==='pending';
      if(pending){job.value.status='cancelled';job.value.ok=false;job.value.message='Authentication cancelled because the office is closing';}
      if(pending||job.value.nativeCleanup==='awaiting-exit'){try{job.stop();}catch{failed=true;}}
    }
    if(failed){cleanupFailure=new Error('Tenancy authentication cleanup failed');throw cleanupFailure;}
  };
  return {
    info,
    async verifyCurrentTenant(environmentUrl,username){
      assertOpen();assertProfileIdle();const target=identityRoot(environmentUrl),current=generation,ticket={};
      if(demo)return structuredClone(demoInfo);
      nativeCommands.add(ticket);
      const guard=()=>{assertOpen();if(generation!==current||profileBusy())throw new HttpError(409,'Selected PAC profile changed during tenant verification');};
      try{
        guard();const before=parsePacProfiles(await run('pac',['auth','list'])),active=currentEnvironment(before);guard();
        if(!active||identityRoot(active.url)!==target||active.user.toLowerCase()!==username.toLowerCase())throw new HttpError(409,'The intended PAC account and target must already be selected');
        const profile=parsePacTenantIdentity(await run('pac',['auth','who']));guard();
        const organization=parsePacIdentity(await run('pac',['org','who','--environment',target]));guard();
        const after=parsePacProfiles(await run('pac',['auth','list'])),again=currentEnvironment(after);guard();
        if(!again||again.index!==active.index||identityRoot(again.url)!==target||again.user.toLowerCase()!==username.toLowerCase()||profile.username.toLowerCase()!==username.toLowerCase()||organization.username.toLowerCase()!==username.toLowerCase()||organization.environmentUrl!==target||profile.environmentId.toLowerCase()!==organization.environmentId.toLowerCase()||profile.organizationId.toLowerCase()!==organization.organizationId.toLowerCase())throw new HttpError(409,'PAC profile tenant and executing organization were not confirmed');
        return {...after,tenantId:profile.tenantId};
      }finally{nativeCommands.delete(ticket);notify();}
    },
    activity,
    close,
    shutdown(){
      if(shutdownWork)return shutdownWork;
      let resolve!:()=>void,reject!:(error:Error)=>void;
      shutdownWork=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
      try{close();}catch{/* The stop failure remains visible after native work settles. */}
      const settled=()=>{const local=localActivity();if(local.profileSelection||local.authenticationRequests||local.awaitingNativeExit||local.nativeCommands)return;idleWaiters.delete(settled);if(cleanupFailure)reject(cleanupFailure);else if(mutationView().status!=='clear')reject(new Error('Durable authentication ownership requires reconciliation'));else resolve();};
      idleWaiters.add(settled);settled();return shutdownWork;
    },
    async selectEnvironment(environmentUrl,username){
      assertOpen();assertProfileIdle();const target=identityRoot(environmentUrl);
      const observed=await info();assertOpen();assertProfileIdle();
      if(demo||observed.status!=='connected'||observed.user.toLowerCase()!==username.toLowerCase())throw new HttpError(409,'Connect the intended existing account before selecting an environment');
      const mutation=mutations?.begin('profile-selection');selecting=true;invalidate();let settled=false;
      try{
        try{await run('pac',['org','select','--environment',target]);}finally{settled=true;}
        const active=currentEnvironment(parsePacProfiles(await run('pac',['auth','list'])));assertOpen();
        const actual=parsePacIdentity(await run('pac',['org','who','--environment',target]));assertOpen();
        const again=currentEnvironment(parsePacProfiles(await run('pac',['auth','list'])));assertOpen();
        if(!active||!again||identityRoot(active.url)!==target||identityRoot(again.url)!==target||active.index!==again.index||active.user.toLowerCase()!==username.toLowerCase()||again.user.toLowerCase()!==username.toLowerCase()||actual.username.toLowerCase()!==username.toLowerCase()||actual.environmentUrl!==target)throw new HttpError(409,'Selected environment and executing account were not confirmed');
        invalidate();return{ok:true,message:'Existing account and selected organization verified'};
      }finally{const accepted=!settled||acknowledge(mutation,'profile-command-settled');selecting=false;notify();if(!accepted)throw new HttpError(409,'Environment selection ownership could not be acknowledged');}
    },
    async select(index) {
      assertOpen();assertProfileIdle();
      if (!Number.isInteger(index) || index < 1) throw new HttpError(400, 'Profile index must be a positive integer');
      const current=generation,observed=await info();assertOpen();assertProfileIdle();
      if(generation!==current||observed.status==='stale')throw new HttpError(409,'Authentication discovery changed or is stale; refresh before selecting');
      const expected=observed.environments.find((env)=>env.index===index);
      if (!expected) throw new HttpError(404, 'Authentication profile not found');
      const mutation=mutations?.begin('profile-selection');let selectionSettled=false;
      selecting=true;invalidate();
      try {
        if (!demo){try{await run('pac', ['auth', 'select', '--index', String(index)]);}finally{selectionSettled=true;}}
        assertOpen();
        if(!demo){
          const confirmed=parsePacProfiles(await run('pac',['auth','list']));assertOpen();
          const active=confirmed.environments.find(environment=>environment.active);
          if(!active||active.index!==index||active.url!==expected.url||active.user.toLowerCase()!==expected.user.toLowerCase())throw new HttpError(409,'Selected authentication profile was not confirmed; refresh the current account and environment before retrying');
        }
        invalidate();
        return { ok: true, message: `${demo ? 'Demo: ' : ''}Selected profile [${index}]` };
      } finally {const accepted=!selectionSettled||acknowledge(mutation,'profile-command-settled');selecting=false;notify();if(!accepted)throw new HttpError(409,'Authentication ownership acknowledgement failed; profile selection remains unverified');}
    },
    login(input) {
      assertOpen();assertProfileIdle();
      input=structuredClone(input);
      if(input.environmentUrl){try{identityRoot(input.environmentUrl);}catch{throw new HttpError(400,'Sign-in environment must be an HTTPS organization root');}}
      if ([...jobs.values()].some((job) => job.value.status === 'pending')) throw new HttpError(409, 'An authentication request is already pending');
      if (jobs.size >= 20) jobs.delete(jobs.keys().next().value!);
      const mutation=mutations?.begin('sign-in');
      const value: TenancyLogin = { id: crypto.randomUUID(), status: demo ? 'completed' : 'pending', ...(demo?{}:{phase:'authenticating' as const,nativeCleanup:'awaiting-exit' as const}),message: demo ? 'Demo authentication completed; no credentials changed' : 'Waiting for PAC authentication instructions', ok: demo };
      const job: { value: TenancyLogin; stop: () => void; timer?: NodeJS.Timeout } = { value, stop: () => {} };
      jobs.set(value.id, job);
      if (demo) return { ...value };
      invalidate();
      const loginGeneration=generation;
      const verificationActive=()=>!closed&&value.status==='pending'&&generation===loginGeneration;
      const verifyCompletion=async()=>{
        if(!verificationActive())return;
        value.phase='verifying';value.message='Sign-in returned. Verifying the active PAC account and environment…';
        try{
          const discovered=parsePacProfiles(await run('pac',['auth','list']));if(!verificationActive())return;
          const expected=currentEnvironment(discovered);
          if(!expected?.index||!expected.user||input.environmentUrl&&identityRoot(input.environmentUrl)!==identityRoot(expected.url))throw new Error('Active profile differs from sign-in target');
          const identity=parsePacIdentity(await run('pac',['org','who','--environment',identityRoot(expected.url)]));if(!verificationActive())return;
          if(identity.environmentUrl!==identityRoot(expected.url)||identity.username.toLowerCase()!==expected.user.toLowerCase())throw new Error('Organization identity differs from active profile');
          const confirmed=currentEnvironment(parsePacProfiles(await run('pac',['auth','list'])));if(!verificationActive())return;
          if(!confirmed||confirmed.index!==expected.index||confirmed.url!==expected.url||confirmed.user.toLowerCase()!==expected.user.toLowerCase())throw new Error('Active profile changed during confirmation');
          clearTimeout(job.timer);value.observation={scope:'pac-profile-and-organization',checkedAt:new Date().toISOString(),profileIndex:expected.index,environmentUrl:identity.environmentUrl,organizationId:identity.organizationId,userId:identity.userId,username:identity.username,environmentId:identity.environmentId};
          value.status='completed';value.ok=true;value.message='PAC account and environment verified. Tenant, licence, connector and deployment readiness checks still apply.';invalidate();
        }catch{
          if(!verificationActive())return;
          clearTimeout(job.timer);value.status='failed';value.ok=false;value.message='Sign-in returned, but the PAC account and environment could not be verified. Refresh connected identity and resolve the mismatch or access failure before retrying.';
        }finally{notify();}
      };
      const args = ['auth', 'create'];
      if (input.name) args.push('--name', input.name);
      if (input.environmentUrl) args.push('--environment', input.environmentUrl);
      if (input.tenantId) args.push('--tenant', input.tenantId);
      if (input.interactive !== false) { if (input.authMethod === 'device-code') args.push('--deviceCode'); }
      else args.push('--applicationId', input.applicationId!, '--clientSecret', input.clientSecret!);
      const secret = input.clientSecret;
      const redact = (text: string) => secret ? text.replaceAll(secret, '[redacted]') : text;
      let transcript = '',reportedFailure=false;
      try {
        job.stop = runner.start(args, (text) => {
          if (value.status !== 'pending'||value.phase==='verifying') return;
          const combined=transcript+text;
          if(/^[ \t]*(?:Error:|AADSTS\d+\b)/im.test(combined))reportedFailure=true;
          transcript = combined.slice(-12000);
          // Credential-based login does not need a transcript; no secret fragment reaches the browser.
          if (input.interactive !== false) value.message = redact(transcript).slice(-8000);
        }, (error) => {
          if(value.nativeCleanup==='exited')return;
          value.nativeCleanup='exited';
          if(!acknowledge(mutation,'native-authentication-terminal')){if(value.status==='pending'){value.status='failed';value.ok=false;value.message='Authentication ownership needs reconciliation; sign-in was not accepted';clearTimeout(job.timer);}notify();return;}
          notify();
          if (value.status !== 'pending'||value.phase==='verifying') return;
          if(!error&&!reportedFailure){void verifyCompletion();return;}
          clearTimeout(job.timer);value.status='failed';value.ok=false;notify();
          value.message=/53003|conditional access|blocked.*device.code/i.test(transcript)?'Conditional Access blocked this sign-in. Use interactive sign-in; ask your administrator to inspect the failed policy if it persists.':'PAC authentication failed. Check the profile and credentials.';
        });
        if(closed||value.status==='cancelled'||value.status==='expired')job.stop();
        if (value.status === 'pending') {
          job.timer = setTimeout(() => { value.status = 'expired'; value.ok = false; value.message = 'Authentication expired. Start a new request.'; job.stop(); }, 10 * 60_000);
          job.timer.unref();
        }
      } catch { if(value.status==='pending'){value.nativeCleanup='exited';value.status = 'failed'; value.message = 'PAC could not start. Check the CLI installation.';notify();} }
      return { ...value };
    },
    loginStatus: (id) => structuredClone(lookup(id).value),
    cancelLogin(id) {
      const job = lookup(id);
      if (job.value.status === 'pending') { job.value.status = 'cancelled'; job.value.message = 'Authentication cancelled'; clearTimeout(job.timer); job.stop(); }
    },
  };
}
export function activeEnvironment(info: TenancyInfo) {
  const env = currentEnvironment(info,true);
  if (!env) return undefined;
  return { tenantName: info.tenantName, tenantDomain: info.tenantDomain, tenantId: info.tenantId, user: env.user, environmentName: env.name, environmentUrl: env.url };
}
