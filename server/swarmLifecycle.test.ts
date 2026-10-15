import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import type { SessionCallbacks } from './agentRunner.ts';
import type { SessionOptions } from './agentRunner.ts';
import type { PullInfo } from '../shared/types.ts';
import {CEO_ID} from '../shared/types.ts';
import type {WebSocket} from 'ws';

vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-lifecycle-'));
  return {...real, HOME_DIR: root, STATE_FILE: path.join(root, 'state.json'), WORKSPACE_ROOT: path.join(root, 'workspaces')};
});
import { HOME_DIR, STATE_FILE } from './config.ts';
import { Swarm } from './swarm.ts';

const offices: Swarm[] = [];
const issue = {number: 1, title: 'Build synthetic feature', body: 'Test only', url: 'https://example.test/issues/1', labels: [], assignees: []};
function backend() {
  const external = {
    demo: false, terminals: false,
    listMyRepos:vi.fn<Backend['listMyRepos']>(async()=>[]),
    repoMeta:vi.fn<Backend['repoMeta']>(async()=>({nameWithOwner:'synthetic/new',description:'Synthetic',url:'https://example.test/repo',defaultBranch:'main'})),
    scanProjects:vi.fn<Backend['scanProjects']>(async()=>[]),
    inspectFolder:vi.fn<Backend['inspectFolder']>(async()=>{throw new Error('Unexpected folder inspection');}),
    publishFolder:vi.fn<Backend['publishFolder']>(async()=>{throw new Error('Unexpected folder publication');}),
    createProject:vi.fn<Backend['createProject']>(async()=>{throw new Error('Unexpected repository creation');}),
    createIssue:vi.fn<Backend['createIssue']>(async()=>{throw new Error('Unexpected issue creation');}),
    closePull:vi.fn<Backend['closePull']>(async()=>{}),
    tenancy:{info:vi.fn<Backend['tenancy']['info']>(async()=>({tenantName:'',tenantDomain:'',tenantId:'',user:'',environments:[],isReal:false,status:'disconnected'}))},
    user: vi.fn(async () => 'synthetic-user'), reconnectClis: vi.fn<Backend['reconnectClis']>(async () => []), hooksReady: vi.fn(),
    detectClis: vi.fn(async () => []), releaseClis: vi.fn(async () => {}),
    setLocalPath: vi.fn(), ensureClone: vi.fn(async () => {}), releaseDesk: vi.fn(async () => {}), removeDesk: vi.fn(async () => {}),
    listIssues: vi.fn(async () => [issue]), listPulls: vi.fn(async (): Promise<PullInfo[]> => []), syncMain: vi.fn(async () => null),
    prDetails: vi.fn(async () => ({state: 'OPEN'})),
    commentPull: vi.fn(async () => 'https://example.test/comment'), mergePull: vi.fn(async () => {}),
    prFiles: vi.fn<Backend['prFiles']>(async () => []),
    prForBranch: vi.fn<Backend['prForBranch']>(async () => null),
    issueState:vi.fn<Backend['issueState']>(async()=> 'CLOSED'),editIssue:vi.fn<Backend['editIssue']>(async()=>{}),
    uploadEvidence: vi.fn<Backend['uploadEvidence']>(async () => 'https://example.test/evidence'),
    mainDir: () => HOME_DIR, deskDir: () => HOME_DIR, prepareDesk: vi.fn<Backend['prepareDesk']>(async () => HOME_DIR),
    startSession: vi.fn((_opts: unknown, _cb: SessionCallbacks) => ({stop: vi.fn(), send: vi.fn()})),
    previews: {hasDefault: vi.fn(async () => false), start: vi.fn(() => {throw new Error('Unexpected preview execution');})},
    office: {head: vi.fn(async () => null), takeLastUpdate: vi.fn(async () => null), isOwnFolder: () => false},
  };
  return external;
}
async function office(withRepo = false, configure?: (fake: ReturnType<typeof backend>) => void) {
  const persisted = {version: 2, settings: {runtime: 'sdk', ceoHeartbeatMin: 0},
    repos: withRepo ? [{id: 'synthetic/repo', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, color: '#000', description: '', url: '', autoAssign: false, autoMerge: false, browserTesting: false, addedAt: 1}] : []};
  await fs.writeFile(STATE_FILE, JSON.stringify(persisted));
  const fake = backend(); configure?.(fake); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
  swarm.capabilityPreflight = vi.fn(async () => null); // explicitly approved synthetic readiness
  await swarm.init(); return {swarm, fake};
}
beforeEach(() => vi.useFakeTimers());
it('blocks manual and automatic implementation assignment at the delivery stage gate before preparation',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{});
  swarm.deliveryWorkGate=()=>{throw new Error('Independent design review is required');};
  await expect(swarm.assign(agent.id,1)).rejects.toThrow('design review');expect(fake.prepareDesk).not.toHaveBeenCalled();
  swarm.updateRepo('synthetic/repo',{autoAssign:true});await vi.advanceTimersByTimeAsync(60_000);expect(fake.prepareDesk).not.toHaveBeenCalled();expect(fake.startSession).not.toHaveBeenCalled();
});
it('gives discovery workers a documentation-only workflow and rechecks the gate before subsequent tools',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{});let allowed=true;
  swarm.deliveryTaskStage=()=> 'discovery';swarm.deliveryWorkGate=()=>{if(!allowed)throw new Error('Record target changed');};
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const options=fake.startSession.mock.calls[0][0] as SessionOptions;expect(options.systemAppend).toContain('do not implement application code');
  expect(await options.authorizeTool!()).toBeNull();allowed=false;expect(await options.authorizeTool!()).toBe('Record target changed');
});
it('keeps routing held through unavailable prerequisite reads and returns a fresh verified refusal after repair',async()=>{
 const {swarm,fake}=await office(true);let release!:(state:'CLOSED')=>void;
 fake.issueState.mockImplementation(async(_repo,number)=>{if(number===2)throw new Error('private-auth-token');return new Promise(resolve=>{release=resolve;});});
 const route=(swarm as unknown as {routeIssue(x:{floor:number;number:number;depends_on:number[]}):Promise<string>}).routeIssue.bind(swarm);
 let settled=false;const pending=route({floor:1,number:1,depends_on:[2,3]}).then(()=>null,error=>{settled=true;return error;});for(let i=0;i<20;i++)await Promise.resolve();expect(fake.issueState).toHaveBeenCalledTimes(2);expect(settled).toBe(false);expect(fake.editIssue).not.toHaveBeenCalled();release('CLOSED');const error=await pending;expect(error.status).toBe(503);expect(error.message).not.toContain('private-auth-token');expect(fake.editIssue).not.toHaveBeenCalled();
 fake.issueState.mockResolvedValue('CLOSED');await expect(route({floor:1,number:1,depends_on:[2,3]})).rejects.toThrow('#2 is closed');expect(fake.issueState).toHaveBeenCalledTimes(4);expect(fake.editIssue).not.toHaveBeenCalled();
});
it('backs off automatic worker preflight while permitting a fresh explicit retry after repair',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Backoff worker'}),checks=vi.fn(async()=> 'Synthetic authentication unavailable');swarm.capabilityPreflight=checks;
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('error'));expect(checks).toHaveBeenCalledOnce();expect(fake.prepareDesk).not.toHaveBeenCalled();
  swarm.updateRepo('synthetic/repo',{autoAssign:true});swarm.updateAgent(agent.id,{name:'Cosmetic rename',effort:'high'});await vi.advanceTimersByTimeAsync(60000);expect(checks).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.lastError).toContain('resume after');
  swarm.updateRepo('synthetic/repo',{autoAssign:false});checks.mockResolvedValue(null as any);await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());expect(checks).toHaveBeenCalledTimes(2);
  expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.recovery).toBeNull();
});
it('extends automatic worker preflight delay after another failure instead of repeating the normal cooldown',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{}),checks=vi.fn(async()=> 'Synthetic persistent outage');swarm.capabilityPreflight=checks;
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('error'));swarm.updateRepo('synthetic/repo',{autoAssign:true});
  await vi.advanceTimersByTimeAsync(130000);expect(checks).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(130000);expect(checks).toHaveBeenCalledTimes(2);expect(fake.prepareDesk).not.toHaveBeenCalled();expect(fake.startSession).not.toHaveBeenCalled();
});
it('retains worker preflight backoff across restart and releases it for a changed runtime context',async()=>{
  const {swarm}=await office(true,fake=>{fake.terminals=true;});const agent=swarm.hireAgent('synthetic/repo',{cli:'codex'});swarm.capabilityPreflight=async()=> 'Synthetic endpoint unavailable';await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('error'));
  swarm.updateRepo('synthetic/repo',{autoAssign:true});vi.useRealTimers();await swarm.shutdown(true);vi.useFakeTimers();const fresh=backend();fresh.terminals=true;const restored=new Swarm(fresh as unknown as Backend);offices.push(restored);const checks=vi.fn(async()=>null);restored.capabilityPreflight=checks;await restored.init();await vi.advanceTimersByTimeAsync(60000);expect(checks).not.toHaveBeenCalled();expect(fresh.startSession).not.toHaveBeenCalled();
  restored.updateAgent(agent.id,{cli:'gemini'});await vi.advanceTimersByTimeAsync(31000);await vi.waitFor(()=>expect(fresh.startSession).toHaveBeenCalledOnce());expect(checks).toHaveBeenCalledWith('synthetic/repo','gemini');
  expect(restored.snapshot().agents.find(row=>row.id===agent.id)?.recovery).toBeNull();
});
it('opens the worker preflight circuit after repeated explicit failures without discarding changed error text',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{}),checks=vi.fn(async()=>`Synthetic outage ${checks.mock.calls.length}`);swarm.capabilityPreflight=checks;
  for(let i=0;i<6;i++){await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('error'));}
  expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.lastError).toContain('held until configuration changes');swarm.updateRepo('synthetic/repo',{autoAssign:true});await vi.advanceTimersByTimeAsync(3600000);expect(checks).toHaveBeenCalledTimes(6);expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.recovery).toMatchObject({kind:'preflight',failures:6,nextAttemptAt:null});
});
it('holds an unadvertised worker pin across retry, cosmetic edits and restart until its effective model changes',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const agent=swarm.hireAgent('synthetic/repo',{cli:'codex',model:'gpt-not-listed'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',costUsd:0,turns:0,errors:['Model is not advertised'],configurationError:{kind:'unverified-model',cli:'codex',model:'gpt-not-listed'}});
  const recovery=swarm.snapshot().agents.find(row=>row.id===agent.id)?.recovery;
  expect(recovery).toMatchObject({kind:'model',nextAttemptAt:null});expect(recovery).not.toHaveProperty('fingerprint');
  swarm.updateRepo('synthetic/repo',{autoAssign:true});const preparationCalls=fake.prepareDesk.mock.calls.length;await vi.advanceTimersByTimeAsync(180000);expect(fake.prepareDesk).toHaveBeenCalledTimes(preparationCalls);expect(fake.startSession).toHaveBeenCalledOnce();swarm.updateRepo('synthetic/repo',{autoAssign:false});
  swarm.updateAgent(agent.id,{name:'Cosmetic rename',effort:'high'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.lastError).toContain('retries remain held'));expect(fake.startSession).toHaveBeenCalledOnce();
  vi.useRealTimers();await swarm.shutdown(true);vi.useFakeTimers();const restoredBackend=backend();restoredBackend.terminals=true;const restored=new Swarm(restoredBackend as unknown as Backend);offices.push(restored);restored.capabilityPreflight=vi.fn(async()=>null);await restored.init();
  await restored.assign(agent.id,1);await vi.waitFor(()=>expect(restored.snapshot().agents.find(row=>row.id===agent.id)?.lastError).toContain('retries remain held'));expect(restoredBackend.startSession).not.toHaveBeenCalled();expect(restored.capabilityPreflight).not.toHaveBeenCalled();
  restored.updateAgent(agent.id,{model:''});await restored.assign(agent.id,1);await vi.waitFor(()=>expect(restoredBackend.startSession).toHaveBeenCalledOnce());expect(restored.capabilityPreflight).toHaveBeenCalled();
  expect(restored.snapshot().agents.find(row=>row.id===agent.id)?.recovery).toBeNull();
});
it.each(['wrong-runtime','wrong-model'])('does not persist an unrelated %s model rejection on the worker',async mode=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const agent=swarm.hireAgent('synthetic/repo',{cli:'codex',model:'gpt-selected'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',costUsd:0,turns:0,errors:['Synthetic model error'],configurationError:{kind:'unverified-model',cli:mode==='wrong-runtime'?'gemini':'codex',model:mode==='wrong-model'?'gpt-other':'gpt-selected'}});
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
});
it('holds a pending assignment when drain begins during capability readiness and rechecks on explicit retry',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Drain race worker'});let ready!:(value:string|null)=>void;
  const checks=vi.fn(()=>new Promise<string|null>(resolve=>{ready=resolve;}));swarm.capabilityPreflight=checks;
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(checks).toHaveBeenCalledOnce());swarm.setDraining(true);ready(null);
  await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('stopped'));
  expect(fake.prepareDesk).not.toHaveBeenCalled();expect(fake.startSession).not.toHaveBeenCalled();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.lastError).toContain('draining');
  swarm.setDraining(false);swarm.capabilityPreflight=vi.fn(async()=>null);await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());expect(swarm.capabilityPreflight).toHaveBeenCalled();
});
it('does not launch after drain begins during an already admitted worktree preparation',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Preparing drain worker'});let prepared!:(value:string)=>void;
  fake.prepareDesk.mockImplementationOnce(()=>new Promise<string>(resolve=>{prepared=resolve;}));await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.prepareDesk).toHaveBeenCalledOnce());
  swarm.setDraining(true);prepared(HOME_DIR);await vi.waitFor(()=>expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('stopped'));expect(fake.startSession).not.toHaveBeenCalled();
});
it('does not resume an idle checkpoint if drain starts while its follow-up readiness is pending',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Checkpoint drain worker'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const cb=fake.startSession.mock.calls[0][1];cb.sessionId('synthetic-checkpoint');await cb.finished({ok:false,text:'',errors:['Synthetic stop'],costUsd:0,turns:0});
  let ready!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{ready=resolve;});const pending=swarm.message(agent.id,'Synthetic follow-up');const denied=expect(pending).rejects.toThrow('readiness');await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));swarm.setDraining(true);ready(null);await denied;
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.status).toBe('stopped');
});
it.each(['codex','gemini','opencode'] as const)('does not let scheduler polling replace an owning %s session based on terminal prose',async cli=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const model=cli==='opencode'?'openai/gpt-synthetic':'synthetic-model',agent=swarm.hireAgent('synthetic/repo',{cli,model});
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());const options=fake.startSession.mock.calls[0][0] as SessionOptions;
  expect(options.terminal).toBeDefined();options.terminal!.write('Test fixture: Subscribe to OpenCode Go; Free limit reached\r\n');
  await vi.waitFor(()=>expect(options.terminal!.screen()).toContain('Free limit reached'));await vi.advanceTimersByTimeAsync(3000);
  expect(fake.startSession).toHaveBeenCalledOnce();expect(fake.startSession.mock.results[0].value.stop).not.toHaveBeenCalled();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)).toMatchObject({cli,model,status:'working'});
});
it.each(['codex','gemini','opencode'] as const)('does not switch %s based on quota words in task output without an owning quota flag',async cli=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const model=cli==='opencode'?'openai/gpt-synthetic':'synthetic-model';const agent=swarm.hireAgent('synthetic/repo',{cli,model});
  await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'Tests include Subscribe to OpenCode Go and Free limit reached',errors:['Synthetic task test failed'],costUsd:0,turns:0});
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)).toMatchObject({cli,model,status:'error'});
});
it.each(['codex','gemini'] as const)('does not accept an OpenCode quota flag from an owning %s session',async cli=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const agent=swarm.hireAgent('synthetic/repo',{cli,model:'synthetic-model'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['Synthetic failure'],opencodeLimit:true,costUsd:0,turns:0});
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)).toMatchObject({cli,status:'error'});
});
it('falls back from an owning OpenCode quota completion through fresh Codex readiness',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const readiness=vi.fn(async()=>null);swarm.capabilityPreflight=readiness;
  const agent=swarm.hireAgent('synthetic/repo',{cli:'opencode',model:'openai/gpt-synthetic'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['OpenCode quota'],opencodeLimit:true,costUsd:0,turns:0});await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(fake.startSession.mock.calls[1][0]).toMatchObject({cli:'codex'});expect(readiness).toHaveBeenLastCalledWith('synthetic/repo','codex');
  expect(swarm.snapshot().agents.find(row=>row.id===agent.id)?.cli).toBe('codex');
});
it('keeps Codex fallback blocked when fresh readiness cannot authorize it',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const readiness=vi.fn(async(_repo:string,cli:string)=>cli==='codex'?'Synthetic Codex authentication unavailable':null);swarm.capabilityPreflight=readiness;
  const agent=swarm.hireAgent('synthetic/repo',{cli:'opencode',model:'openai/gpt-synthetic'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['OpenCode quota'],opencodeLimit:true,costUsd:0,turns:0});
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)).toMatchObject({cli:'codex',status:'error',lastError:expect.stringContaining('authentication unavailable')});
});
it.each(['drain','configuration-change'] as const)('does not auto-fallback a completed OpenCode quota after %s',async mode=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const agent=swarm.hireAgent('synthetic/repo',{cli:'opencode',model:'openai/gpt-synthetic'});await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  if(mode==='drain')swarm.setDraining(true);else swarm.updateAgent(agent.id,{cli:'gemini',model:'changed-model'});
  await fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['OpenCode quota'],opencodeLimit:true,costUsd:0,turns:0});
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(row=>row.id===agent.id)).toMatchObject({cli:mode==='drain'?'opencode':'gemini',status:'error'});
});
it.each(['rename','clear-own-model','clear-cli'] as const)('accepts a valid inherited OpenCode pin for %s and dispatches that exact effective model',async mode=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.updateSettings({defaultCli:'opencode',defaultModel:'openai/gpt-synthetic'});
  const agent=swarm.hireAgent('synthetic/repo',{name:'Inherited model worker',cli:mode==='clear-cli'?'codex':'opencode'});
  if(mode==='rename')swarm.updateAgent(agent.id,{name:'Renamed pinned worker'});if(mode==='clear-own-model')swarm.updateAgent(agent.id,{model:''});if(mode==='clear-cli')swarm.updateAgent(agent.id,{cli:'',model:''});
  await swarm.assign(agent.id,1);await vi.advanceTimersByTimeAsync(200);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({cli:'opencode',model:'openai/gpt-synthetic'});
});
it.each(['dev','ceo'] as const)('clears an explicit OpenCode selection to the correct default for %s',async role=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  const agent=role==='ceo'?swarm.snapshot().agents.find(a=>a.id===CEO_ID)!:swarm.hireAgent('synthetic/repo',{cli:'opencode',model:'openai/gpt-synthetic'});
  if(role==='ceo')swarm.updateAgent(agent.id,{cli:'opencode',model:'openai/gpt-synthetic'});
  swarm.updateAgent(agent.id,{cli:'',model:''});expect(swarm.snapshot().agents.find(a=>a.id===agent.id)).toMatchObject({cli:'',model:''});
  if(role==='ceo')await swarm.messageCeo('Synthetic cleared CLI request');else await swarm.assign(agent.id,1);
  await vi.advanceTimersByTimeAsync(200);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());expect(fake.startSession.mock.calls[0][0]).toMatchObject({cli:'codex',model:''});
});
it.each(['unconfigured-default','unconfigured-worker','unconfigured-ceo','prohibited-model','invalid-model-type'] as const)('rejects %s configuration atomically before dispatch',async mode=>{
  const {swarm,fake}=await office(true),settings=structuredClone(swarm.snapshot().settings),agents=structuredClone(swarm.snapshot().agents);
  if(mode==='unconfigured-default')expect(()=>swarm.updateSettings({defaultCli:'opencode',sessionLimit:7})).toThrow('explicit');
  if(mode==='unconfigured-worker')expect(()=>swarm.hireAgent('synthetic/repo',{cli:'opencode'})).toThrow('explicit');
  if(mode==='unconfigured-ceo')expect(()=>swarm.updateAgent(CEO_ID,{cli:'opencode',name:'Rejected rename'})).toThrow('explicit');
  if(mode==='prohibited-model')expect(()=>swarm.updateSettings({defaultModel:'anthropic/claude-sonnet',managerName:'Rejected manager'})).toThrow('not permitted');
  if(mode==='invalid-model-type')expect(()=>swarm.updateSettings({defaultModel:1 as any,sessionLimit:7})).toThrow('string');
  expect(swarm.snapshot().settings).toEqual(settings);expect(swarm.snapshot().agents).toEqual(agents);expect(fake.startSession).not.toHaveBeenCalled();expect(fake.prepareDesk).not.toHaveBeenCalled();
});
it('boots an unpinned legacy office without executing or silently selecting another runtime, then restores QA after repair',async()=>{
  await fs.writeFile(STATE_FILE,JSON.stringify({version:2,settings:{defaultCli:'opencode',defaultModel:'',runtime:'terminal',ceoHeartbeatMin:0},repos:[{id:'synthetic/repo',fullName:'synthetic/repo',defaultBranch:'main',floor:1,autoAssign:false,autoMerge:false}],agents:[]}));
  const fake=backend(),swarm=new Swarm(fake as unknown as Backend);offices.push(swarm);await swarm.init();expect(swarm.snapshot().settings.defaultCli).toBe('opencode');expect(swarm.snapshot().agents.some(a=>a.role==='qa')).toBe(false);expect(swarm.snapshot().messages.some(message=>message.text.includes('QA setup'))).toBe(true);expect(fake.startSession).not.toHaveBeenCalled();
  swarm.updateSettings({defaultModel:'google/gemini-synthetic'});expect(swarm.snapshot().agents.filter(a=>a.role==='qa')).toHaveLength(1);expect(fake.startSession).not.toHaveBeenCalled();
});
it.each([null,1,{},[]])('rejects malformed model value %j without partial settings, hiring or agent edits',async value=>{
  const {swarm,fake}=await office(true),settings=structuredClone(swarm.snapshot().settings),agents=structuredClone(swarm.snapshot().agents);
  expect(()=>swarm.updateSettings({defaultModel:value as any,sessionLimit:7})).toThrow('string');expect(()=>swarm.hireAgent('synthetic/repo',{model:value as any})).toThrow('string');expect(()=>swarm.updateAgent(CEO_ID,{model:value as any,name:'Rejected name'})).toThrow('string');
  expect(swarm.snapshot().settings).toEqual(settings);expect(swarm.snapshot().agents).toEqual(agents);expect(fake.startSession).not.toHaveBeenCalled();expect(fake.prepareDesk).not.toHaveBeenCalled();
});
it.each(['throw','callback','event'] as const)('isolates a browser telemetry failure by %s without failing state transitions',async mode=>{
  const {swarm}=await office();let fail=false;const events=new Map<string,()=>void>();
  const broken={OPEN:1,readyState:1,on:(type:string,fn:()=>void)=>events.set(type,fn),terminate:vi.fn(()=>{throw new Error('private terminate failure');}),send:vi.fn((_message:string,callback?:(error?:Error)=>void)=>{if(!fail)return;if(mode==='throw')throw new Error('private send error');if(mode==='callback')callback?.(new Error('private send error'));})};
  const healthy={OPEN:1,readyState:1,on:vi.fn(),terminate:vi.fn(),send:vi.fn()};
  swarm.addClient(broken as unknown as WebSocket);swarm.addClient(healthy as unknown as WebSocket);fail=true;if(mode==='event')events.get('error')?.();
  expect(()=>swarm.setDraining(true)).not.toThrow();expect(swarm.snapshot().draining).toBe(true);expect(healthy.send.mock.calls.at(-1)?.[0]).toContain('draining');expect(broken.terminate).toHaveBeenCalledOnce();
  const calls=broken.send.mock.calls.length;swarm.setDraining(false);expect(broken.send).toHaveBeenCalledTimes(calls);
});
it('reports unexpected async completion failure without exposing provider details or leaving the worker busy',async()=>{
  const {swarm,fake}=await office(true);const developer=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(developer.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  // Fault injection at the completion transaction boundary, before a business
  // result can be considered processed or retried.
  const internal=swarm as unknown as {onFinished:()=>Promise<void>};vi.spyOn(internal,'onFinished').mockRejectedValueOnce(new Error('private provider credentials'));
  await fake.startSession.mock.calls[0][1].finished({ok:true,text:'synthetic',costUsd:0,turns:1,errors:[]});
  const current=swarm.snapshot().agents.find(agent=>agent.id===developer.id)!;expect(current.status).toBe('error');expect(current.lastError).toContain('reconcile');expect(current.lastError).not.toContain('private provider');expect(swarm.sessionUsage().agentSessions).toBe(0);
});
it('does not apply an old completion failure to a replacement task generation',async()=>{
  const {swarm,fake}=await office(true);const developer=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(developer.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  let reject!:(error:Error)=>void;const internal=swarm as unknown as {onFinished:()=>Promise<void>};vi.spyOn(internal,'onFinished').mockImplementationOnce(()=>new Promise<void>((_resolve,no)=>{reject=no;}));
  const pending=fake.startSession.mock.calls[0][1].finished({ok:true,text:'synthetic',costUsd:0,turns:1,errors:[]});
  swarm.stopAgent(developer.id);await swarm.assign(developer.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  reject(new Error('stale completion fault'));await pending;
  const current=swarm.snapshot().agents.find(agent=>agent.id===developer.id)!;expect(current.status).toBe('working');expect(current.lastError).toBeNull();
});
it('shares a reserved architecture slot with manual workers, release QA and the queued CEO',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.updateSettings({sessionLimit:1});swarm.ceoPreflight=async()=>null;
  const developer=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'}),qa=swarm.snapshot().agents.find(a=>a.role==='qa')!;
  const lease=swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111');
  expect(swarm.sessionUsage()).toMatchObject({used:1,freeSlots:0,agentSessions:0});
  await expect(swarm.assign(developer.id,1)).rejects.toThrow('slots are busy');await expect(swarm.reviewDeliveryRelease(qa.id,'synthetic/repo','release')).rejects.toThrow('busy');
  swarm.messageCeo('Synthetic queued CEO question');await vi.advanceTimersByTimeAsync(250);expect(fake.startSession).not.toHaveBeenCalled();
  lease.running();lease.stopping();expect(swarm.sessionUsage().auxiliary[0].state).toBe('stopping');lease.release();lease.release();
  await vi.advanceTimersByTimeAsync(250);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());expect(swarm.sessionUsage()).toMatchObject({used:1,agentSessions:1,auxiliary:[]});
});
it('denies architecture admission while a worker is preparing and preserves stale lease ownership',async()=>{
  const {swarm}=await office(true);swarm.updateSettings({sessionLimit:1});const developer=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});const pending=swarm.assign(developer.id,1);
  expect(()=>swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111')).toThrow('slots are busy');await vi.waitFor(()=>expect(checked).toBeTypeOf('function'));checked('Synthetic readiness blocker');await pending;await vi.waitFor(()=>expect(swarm.sessionUsage().agentSessions).toBe(0));
  const id='11111111-1111-4111-8111-111111111111',old=swarm.reserveArchitectureSession('synthetic/repo',id);old.release();const current=swarm.reserveArchitectureSession('synthetic/repo',id);
  old.release();expect(swarm.sessionUsage().used).toBe(1);expect(()=>old.running()).toThrow('no longer owns');current.release();
  swarm.setDraining(true);expect(()=>swarm.reserveArchitectureSession('synthetic/repo',id)).toThrow('draining');
});
it('counts recovered model cleanup before granting new slots and denies unverifiable capacity',async()=>{
  const {swarm}=await office(true);swarm.updateSettings({sessionLimit:1});
  swarm.restoreArchitectureCleanup([{jobId:'11111111-1111-4111-8111-111111111111',repoId:'synthetic/repo',reservedAt:1}],'Prior model acknowledgement is absent');
  expect(swarm.sessionUsage()).toMatchObject({used:1,freeSlots:0,auxiliary:[{state:'stopping'}]});
  expect(()=>swarm.reserveArchitectureSession('synthetic/repo','22222222-2222-4222-8222-222222222222')).toThrow('slots are busy');
  swarm.restoreArchitectureCleanup([],'Corrupt model state');expect(swarm.sessionUsage().blockedReason).toBe('Corrupt model state');expect(swarm.sessionUsage().freeSlots).toBeNull();
  expect(()=>swarm.reserveArchitectureSession('synthetic/repo','22222222-2222-4222-8222-222222222222')).toThrow('capacity is unverified');
});
it('quarantines cancelled worker roots even with an unlimited session budget',async()=>{
  const {swarm}=await office(true);swarm.updateSettings({sessionLimit:0});
  const record={id:'digest',agentId:'stopped-worker',cli:'codex',pid:123,keeperInstance:null,requestedAt:1,state:'unverified' as const};
  swarm.runtimeCleanup=()=>({records:[record]});expect(swarm.sessionUsage()).toMatchObject({used:1,agentSessions:0,freeSlots:null,cleanup:[record],blockedReason:expect.stringContaining('quarantined')});
  expect(()=>swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111')).toThrow('capacity is unverified');
  swarm.runtimeCleanup=()=>({records:[]});const lease=swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111');lease.release();
  swarm.runtimeCleanup=()=>({records:[],unavailableReason:'Unreadable native cleanup evidence',failureCode:'evidence'});expect(swarm.sessionUsage().cleanupFailureCode).toBe('evidence');expect(()=>swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111')).toThrow('Unreadable native');
});
it('retains pending readiness capacity after cancellation, including an unlimited budget',async()=>{
 const {swarm}=await office(true);swarm.updateSettings({sessionLimit:0});
 const entry={id:'digest',agentId:'stopped-worker',cli:'codex',startedAt:1,state:'checking' as 'checking'|'cancelled',scope:'process-local-runtime-readiness' as const};
 swarm.runtimeCleanup=()=>({records:[],readiness:[entry]});expect(swarm.sessionUsage()).toMatchObject({used:1,agentSessions:0,readiness:[entry]});expect(swarm.sessionUsage().blockedReason).toBeUndefined();
 entry.state='cancelled';expect(swarm.sessionUsage()).toMatchObject({used:1,freeSlots:null,blockedReason:expect.stringContaining('Cancelled runtime readiness')});expect(()=>swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111')).toThrow('capacity is unverified');
 swarm.runtimeCleanup=()=>({records:[]});expect(swarm.sessionUsage().used).toBe(0);const lease=swarm.reserveArchitectureSession('synthetic/repo','11111111-1111-4111-8111-111111111111');lease.release();
});
afterEach(async () => {
  vi.useRealTimers(); // allow real terminal-emulator flushes during cleanup
  await Promise.all(offices.splice(0).map(swarm => swarm.shutdown().catch(() => {})));
  vi.useRealTimers();
  for (const entry of await fs.readdir(HOME_DIR)) await fs.rm(path.join(HOME_DIR, entry), {recursive: true, force: true});
});
afterAll(async () => fs.rm(HOME_DIR, {recursive: true, force: true}));

it('preserves corrupt, malformed and future state even when cleanup follows failed initialization', async () => {
  for (const raw of ['broken JSON', 'null', '[]', '{"version":3}', '{"agents":{}}', '{"settings":null}', '{"repos":[{"id":"x"}]}', '{"agents":[{"id":"x","name":"X","repoId":"","status":"idle","logTail":{}}]}', '{"repos":[{"id":"x","fullName":"x/y","defaultBranch":"main"},{"id":"x","fullName":"x/y","defaultBranch":"main"}]}']) {
    await fs.writeFile(STATE_FILE, raw); const fake = backend(); const swarm = new Swarm(fake as unknown as Backend);
    await expect(swarm.init()).rejects.toThrow('preserve and repair');
    await swarm.shutdown(); await vi.advanceTimersByTimeAsync(60000);
    expect(await fs.readFile(STATE_FILE, 'utf8')).toBe(raw);
    expect(fake.user).not.toHaveBeenCalled(); expect(fake.reconnectClis).not.toHaveBeenCalled();
    expect(fake.releaseClis).not.toHaveBeenCalled();
  }
});

it('initializes a missing file and round trips a legacy office without discarding its settings', async () => {
  await fs.rm(STATE_FILE, {force: true}); const fake = backend(); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
  await swarm.init(); await swarm.shutdown();
  expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).version).toBe(2);
  await fs.writeFile(STATE_FILE, JSON.stringify({settings: {companyName: 'Retained company', maxConcurrent: 7}, repos: [], agents: []}));
  const restored = new Swarm(backend() as unknown as Backend); offices.push(restored); await restored.init(); await restored.shutdown();
  expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).settings).toMatchObject({companyName: 'Retained company', sessionLimit: 7,defaultCli:'codex',runtime:'terminal'});
});

it('cancels startup and recurring work and performs shutdown only once', async () => {
  const {swarm, fake} = await office(true); const reads = fake.listIssues.mock.calls.length;
  const first = swarm.shutdown(true); expect(swarm.shutdown(false)).toBe(first); await first;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(180000);
  expect(fake.listIssues).toHaveBeenCalledTimes(reads); expect(fake.startSession).not.toHaveBeenCalled();
  expect(fake.releaseClis).toHaveBeenCalledExactlyOnceWith(true);
});

it('does not start a session when preparation completes after shutdown', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementation(() => new Promise<string>(resolve => {prepared = resolve;}));
  await swarm.assign(agent.id, 1);
  for (let i = 0; i < 60 && !prepared; i++) await Promise.resolve();
  expect(prepared).toBeTypeOf('function'); await swarm.shutdown(true); prepared(HOME_DIR);
  await Promise.resolve(); await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((item: {id: string}) => item.id === agent.id)).toMatchObject({status: 'preparing', issueNumber: 1, task: 'issue'});
  await expect(swarm.assign(agent.id, 1)).rejects.toThrow('shutting down');
});

it('stops SDK work, ignores its closing callback and preserves a resumable checkpoint', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const stop = vi.fn(); let callbacks!: SessionCallbacks;
  fake.startSession.mockImplementation((_opts, cb) => {callbacks = cb; return {stop, send: vi.fn()};});
  await swarm.assign(agent.id, 1);
  for (let i = 0; i < 20 && !callbacks; i++) await Promise.resolve();
  expect(callbacks).toBeDefined(); callbacks.sessionId('synthetic-resumable-session');
  stop.mockImplementation(() => callbacks.finished({ok: false, interrupted: true, errors: [], costUsd: 0, turns: 0, text: ''}));
  await swarm.shutdown(true); expect(stop).toHaveBeenCalledOnce();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((item: {id: string}) => item.id === agent.id)).toMatchObject({status: 'working', sessionId: 'synthetic-resumable-session', task: 'issue'});
  callbacks.log([{kind: 'text', text: 'late log'}]); callbacks.sessionId('late changed session'); callbacks.screenshot(Buffer.from('late'), 'image/png');
  await vi.advanceTimersByTimeAsync(60000);
  expect(vi.getTimerCount()).toBe(0); expect(await fs.readFile(STATE_FILE, 'utf8')).toBe(JSON.stringify(saved, null, 2));
});

it('does not prepare a desk when readiness resolves after shutdown', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let ready!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {ready = resolve;});
  await swarm.assign(agent.id, 1); await swarm.shutdown(true); ready(null);
  await Promise.resolve(); await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
});

it('continues process cleanup when persistence fails and reports the failure', async () => {
  const {swarm, fake} = await office();
  await fs.rm(STATE_FILE); await fs.mkdir(STATE_FILE);
  vi.useRealTimers(); // atomicWrite's bounded Windows rename retries use real time
  await expect(swarm.shutdown()).rejects.toThrow('did not complete cleanly');
  expect(fake.releaseClis).toHaveBeenCalledExactlyOnceWith(false);
});

it('requeues interrupted QA and clears an issue lacking a resumable checkpoint on restart', async () => {
  const {swarm} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  const qa = saved.agents.find((item: {role: string}) => item.role === 'qa');
  Object.assign(qa, {status: 'working', task: 'qa', prNumber: 4, issueNumber: 1});
  Object.assign(saved.agents.find((item: {id: string}) => item.id === developer.id), {status: 'preparing', task: 'issue', issueNumber: 1});
  saved.qa = [{id: 'qa-checkpoint', repoId: 'synthetic/repo', qaAgentId: qa.id, devAgentId: developer.id, status: 'testing', prNumber: 4}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const fake = backend(); const restored = new Swarm(fake as unknown as Backend); offices.push(restored); await restored.init(); await restored.shutdown();
  const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(recovered.qa[0].status).toBe('queued');
  expect(recovered.agents.find((item: {id: string}) => item.id === developer.id)).toMatchObject({status: 'idle', task: null, issueNumber: null});
  expect(fake.startSession).not.toHaveBeenCalled();
});

it('closes preview admission immediately when shutdown begins', async () => {
  const {swarm, fake} = await office(true);
  let resolve!: (value: {state: string}) => void;
  fake.prDetails.mockImplementation(() => new Promise(done => {resolve = done;}));
  const pending = swarm.startPreview('synthetic/repo', 1);
  const stopped = swarm.shutdown(true); resolve({state: 'OPEN'});
  await expect(pending).rejects.toThrow('closed'); await stopped;
  expect(fake.previews.start).not.toHaveBeenCalled();
});

const pull: PullInfo = {number: 7, title: 'Synthetic PR', url: 'https://example.test/pr/7', headRefName: 'swarm/issue-1-synthetic', headSha: 'tested-head', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', checks: 'passing', failedChecks: [], pendingChecks: [], closesIssues: [], createdAt: '', mergedAt: null, additions: 1, deletions: 0, reviewDecision: null};
const qaReport = {verdict: 'pass', summary: 'Synthetic acceptance verified.', checks: [{name: 'API response', result: 'pass', details: 'Observed the expected response.'}], commands: [], screenshots: []};
async function qaOffice(head = pull.headSha) {
  const fixture = await office(true, fake => {
    fake.listPulls.mockResolvedValue([pull]);
    const details = {...pull, headSha: head, body: 'Synthetic requirements', isCrossRepository: false};
    fake.prDetails.mockResolvedValue(details);
  });
  await fixture.swarm.sendToQa('synthetic/repo', 7); await vi.advanceTimersByTimeAsync(200);
  expect(fixture.fake.startSession).toHaveBeenCalledOnce();
  return {...fixture, callbacks: fixture.fake.startSession.mock.calls[0][1]};
}
it('holds unrelated queued QA before preparing a reviewer or starting its native session',async()=>{
  const {swarm,fake}=await office(true,backend=>{backend.listPulls.mockResolvedValue([pull]);});
  swarm.deliveryWorkGate=()=>{throw new Error('PR is outside the recorded pilot scope');};
  await swarm.sendToQa('synthetic/repo',7);await vi.advanceTimersByTimeAsync(60_000);
  expect(fake.startSession).not.toHaveBeenCalled();expect(fake.prepareDesk).not.toHaveBeenCalled();expect(swarm.snapshot().qa[0].status).toBe('queued');
});
async function finishQa(swarm: Swarm, callbacks: SessionCallbacks, report: unknown) {
  callbacks.finished({ok: true, structured: report, text: '', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 50 && swarm.snapshot().qa[0].status === 'testing'; i++) await Promise.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve(); // settle the completion-triggered repo refresh
}
it('returns an unlaunched QA round to its queue when drain begins during readiness',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.listPulls.mockResolvedValue([pull]);const details={...pull,body:'Synthetic acceptance',isCrossRepository:false};fake.prDetails.mockResolvedValue(details);});
  let ready!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{ready=resolve;});await swarm.sendToQa('synthetic/repo',7);await vi.advanceTimersByTimeAsync(200);await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
  swarm.setDraining(true);ready(null);await vi.waitFor(()=>expect(swarm.snapshot().qa[0]).toMatchObject({status:'queued',qaAgentId:null,testedSha:null,passedSha:null}));expect(fake.startSession).not.toHaveBeenCalled();expect(fake.prepareDesk).not.toHaveBeenCalled();
});

it.each([
  {...qaReport, checks: [{name: 'API', result: 'unknown', details: 'Never verified'}]},
  {...qaReport, screenshots: ['Claimed screenshot without captured evidence']},
  {...qaReport, checks: []},
])('does not approve malformed or unobserved QA evidence through the actual scheduler %#', async report => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, report);
  expect(swarm.snapshot().qa[0].status).toBe('queued'); expect(fake.commentPull).not.toHaveBeenCalled();
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', passedSha: null, sessionFailures: 1});
});

it('accepts complete QA evidence at its tested head and revokes it immediately when retesting is requested', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  expect(swarm.snapshot().qa[0].status).toBe('passed'); expect(fake.commentPull).toHaveBeenCalledOnce();
  await swarm.sendToQa('synthetic/repo', 7); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', passedSha: null, testedSha: null});
});

it('does not grant QA approval when posting evidence completes after shutdown', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); let posted!: (value: string) => void;
  fake.commentPull.mockImplementation(() => new Promise(resolve => {posted = resolve;}));
  callbacks.finished({ok: true, structured: qaReport, text: '', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30 && !posted; i++) await Promise.resolve();
  expect(posted).toBeTypeOf('function'); await swarm.shutdown(true); posted('https://example.test/comment');
  await Promise.resolve(); await Promise.resolve();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'testing', passedSha: null});
  expect(saved.agents.find((agent: {role: string}) => agent.role === 'qa').status).toBe('working');
});

it('merges only the actual commit approved by QA through the real merge loop', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.mergePull.mockImplementation(async () => {fake.listPulls.mockResolvedValue([{...pull, state: 'MERGED', mergedAt: '2026-10-13T00:00:00Z'}]);});
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && !fake.mergePull.mock.calls.length; i++) await Promise.resolve();
  expect(fake.prFiles).toHaveBeenCalledWith('synthetic/repo', 7, 'tested-head');
  expect(fake.mergePull.mock.calls).toEqual([['synthetic/repo', 7, 'squash', 'tested-head']]);
});

it('never applies cached checks and scans to a different head returned by PR details', async () => {
  const {swarm, fake, callbacks} = await qaOffice('new-tested-head'); await finishQa(swarm, callbacks, qaReport);
  fake.listPulls.mockResolvedValue([{...pull, mergeable: 'UNKNOWN', mergeState: 'UNKNOWN'}]);
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && swarm.snapshot().qa[0].status === 'passed'; i++) await Promise.resolve();
  expect(swarm.snapshot().qa[0].status).toBe('queued'); expect(fake.mergePull).not.toHaveBeenCalled();
  await swarm.shutdown(); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({passedSha: null, testedSha: null});
});

it.each(['retest', 'shutdown'])('does not merge when %s happens during the scan', async action => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  let scanned!: (files: {file: string; content: string}[]) => void;
  fake.prFiles.mockImplementation(() => new Promise(resolve => {scanned = resolve;}));
  swarm.updateRepo('synthetic/repo', {autoMerge: true}); await swarm.syncRepo('synthetic/repo');
  for (let i = 0; i < 40 && !scanned; i++) await Promise.resolve();
  expect(scanned).toBeTypeOf('function');
  if (action === 'shutdown') await swarm.shutdown(); else await swarm.sendToQa('synthetic/repo', 7);
  scanned([]); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it('requires commit-bound QA for the manager merge action and validates its method', async () => {
  const {swarm, fake} = await office(true, fake => fake.listPulls.mockResolvedValue([pull]));
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('commit-bound QA');
  await expect(swarm.mergePull('synthetic/repo', 7, 'bad' as 'squash')).rejects.toThrow('Invalid merge method');
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it('pins the approved commit and selected method for a verified manager merge', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.mergePull.mockImplementation(async () => {fake.listPulls.mockResolvedValue([{...pull, state: 'MERGED', mergedAt: '2026-10-13T00:00:00Z'}]);});
  await swarm.mergePull('synthetic/repo', 7, 'rebase');
  expect(fake.mergePull.mock.calls).toEqual([['synthetic/repo', 7, 'rebase', 'tested-head']]);
});

it.each([
  {name: 'stale QA head', patch: {headSha: 'changed-head'}},
  {name: 'pending checks', patch: {checks: 'pending' as const}},
  {name: 'blocked branch', patch: {mergeState: 'BLOCKED'}},
  {name: 'behind branch', patch: {mergeState: 'BEHIND'}},
])('blocks manager merging on $name', async ({patch}) => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.listPulls.mockResolvedValue([{...pull, ...patch}]);
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow();
  expect(fake.mergePull).not.toHaveBeenCalled(); expect(fake.startSession).toHaveBeenCalledOnce();
});

it('blocks manager merging on a local scan finding and unavailable scan evidence', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); await finishQa(swarm, callbacks, qaReport);
  fake.prFiles.mockResolvedValue([{file: 'flow.json', content: '{"connection":"shared_dropbox"}'}]);
  await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('Merge blocked (dlp)');
  fake.prFiles.mockRejectedValue(new Error('Synthetic scan unavailable'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {await expect(swarm.mergePull('synthetic/repo', 7)).rejects.toThrow('DLP scan unavailable');} finally {warn.mockRestore();}
  expect(fake.mergePull).not.toHaveBeenCalled();
});

it.each(['unconfigured', 'empty'])('denies execution when readiness is %s', async mode => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  swarm.capabilityPreflight = mode === 'empty' ? async () => '' : new Swarm(fake as unknown as Backend).capabilityPreflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error'});
});

it('checks the effective SDK runtime when terminal execution is unavailable', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  swarm.updateSettings({runtime: 'terminal', defaultCli: 'codex'});
  const preflight = vi.fn(async () => 'Synthetic node runtime unavailable'); swarm.capabilityPreflight = preflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).not.toHaveBeenCalled();
});

it.each(['runtime', 'model', 'agent', 'project', 'pause', 'policy'])('rejects changed %s context while capability admission is pending', async change => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  await swarm.assign(agent.id, 1);
  if (change === 'runtime') swarm.updateSettings({runtime: 'terminal', defaultCli: 'gemini'});
  if (change === 'model') swarm.updateSettings({defaultModel: 'changed-synthetic-model'});
  if (change === 'agent') swarm.updateAgent(agent.id, {cli: 'codex'});
  if (change === 'project') swarm.updateRepo('synthetic/repo', {mission: 'New synthetic scope'});
  if (change === 'pause') swarm.taskPaused = () => true;
  if (change === 'policy') swarm.workerAdmissionContext = () => 'updated-synthetic-policy';
  checked(null); for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.lastError).toContain('Execution context changed');
});

it('denies an unavailable configuration snapshot without issuing probes or leaving a task preparing', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const preflight = vi.fn(async () => null); swarm.capabilityPreflight = preflight;
  swarm.workerAdmissionContext = () => {throw new Error('Synthetic configuration unavailable');};
  await swarm.assign(agent.id, 1); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.prepareDesk).not.toHaveBeenCalled();
  expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error', lastError: expect.stringContaining('context is unavailable')});
});

it('does not launch unchecked settings changed during worktree preparation and can retry with fresh admission', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementationOnce(() => new Promise(resolve => {prepared = resolve;}));
  const preflight = vi.fn(async () => null); swarm.capabilityPreflight = preflight;
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !prepared; i++) await Promise.resolve();
  expect(prepared).toBeTypeOf('function'); swarm.updateAgent(agent.id, {model: 'synthetic-model'}); prepared(HOME_DIR);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error', lastError: expect.stringContaining('Execution context changed')});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledTimes(2); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({model: 'synthetic-model'});
});

it('checks linked repositories and denies a blocked reference before preparing the workspace', async () => {
  const {swarm, fake} = await office(true);
  const state = (swarm as unknown as {state: {repos: Array<{id: string; fullName: string; links: string[]}>}}).state;
  const linked = {...state.repos[0], id: 'synthetic/reference', fullName: 'synthetic/reference', links: []}; state.repos.push(linked);
  const runtime = (swarm as unknown as {repoRt: Map<string, unknown>}).repoRt;
  runtime.set(linked.id, {...runtime.get('synthetic/repo') as Record<string, unknown>});
  swarm.updateRepo('synthetic/repo', {links: [linked.id]});
  const preflight = vi.fn(async (id: string) => id === linked.id ? 'Reference authentication expired' : null); swarm.capabilityPreflight = preflight;
  const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60; i++) await Promise.resolve();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(preflight).toHaveBeenCalledWith(linked.id, 'codex');
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.lastError).toContain(`${linked.id}: Reference authentication expired`);
});

it('does not send a live follow-up if its checked project scope changes', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 60 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value;
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.message(agent.id, 'Continue with the synthetic feature');
  const rejected = expect(pending).rejects.toThrow('Execution context changed');
  for (let i = 0; i < 20 && !checked; i++) await Promise.resolve();
  expect(checked).toBeTypeOf('function');
  swarm.updateRepo('synthetic/repo', {mission: 'Changed project scope'}); checked(null);
  await rejected; expect(handle.send).not.toHaveBeenCalled();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.status).toBe('working');
});

it('does not prepare a workspace when an assignment is stopped during its readiness check', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  await swarm.assign(agent.id, 1); swarm.stopAgent(agent.id); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
});

it('blocks new prompts to a working session when readiness expires without sending the prompt', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value;
  swarm.capabilityPreflight = vi.fn(async () => 'Synthetic authentication expired');
  await expect(swarm.message(agent.id, 'Continue the feature')).rejects.toThrow('authentication expired');
  expect(handle.send).not.toHaveBeenCalled(); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)?.status).toBe('working');
});

it('keeps tool authority through a legitimate checkpoint update and revokes it on configuration change and cancellation', async () => {
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  const callbacks=fake.startSession.mock.calls[0][1];
  expect(await opts.authorizeTool?.()).toBeNull();callbacks.sessionId('synthetic-runtime-checkpoint');
  expect(await opts.authorizeTool?.()).toBeNull();
  swarm.updateAgent(agent.id,{model:'changed-model'});expect(await opts.authorizeTool?.()).toContain('configuration changed');
  swarm.stopAgent(agent.id);expect(await opts.authorizeTool?.()).toContain('no longer owns');
});

it('revokes worker authority on completion before a replacement is dispatched', async () => {
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'synthetic',costUsd:0,turns:1,errors:['synthetic failure']});
  expect(await opts.authorizeTool?.()).toContain('no longer owns');
});

it('rechecks running worker prerequisites, shares concurrent refreshes and recovers after a transient blocker',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;
  const preflight=vi.fn(()=>new Promise<string|null>(resolve=>{checked=resolve;}));swarm.capabilityPreflight=preflight;
  const first=authorize();const second=authorize();
  for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  expect(preflight).toHaveBeenCalledExactlyOnceWith('synthetic/repo','codex');checked('Synthetic authentication expired');
  expect(await first).toContain('authentication expired');expect(await second).toContain('authentication expired');
  swarm.capabilityPreflight=vi.fn(async()=>null);expect(await authorize()).toBeNull();
  expect(fake.startSession).toHaveBeenCalledOnce();
});

it.each(['stop','fire'])('cancels a pending tool refresh immediately on worker %s and cannot grant from a late reply',async action=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  expect(checked).toBeTypeOf('function');if(action==='stop')swarm.stopAgent(agent.id);else swarm.fireAgent(agent.id);
  expect(await pending).toContain('no longer owns');checked(null);
  expect(await authorize()).toContain('no longer owns');
});

it('denies changed worker configuration while a tool refresh is pending',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  swarm.updateAgent(agent.id,{model:'changed-model'});checked(null);
  expect(await pending).toContain('configuration changed');
});

it('bounds a stalled worker tool refresh and ignores its late successful response',async()=>{
  const {swarm,fake}=await office(true);const agent=swarm.hireAgent('synthetic/repo',{name:'Synthetic developer'});
  await swarm.assign(agent.id,1);for(let i=0;i<60&&!fake.startSession.mock.calls.length;i++)await Promise.resolve();
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  let checked!:(value:string|null)=>void;swarm.capabilityPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  await vi.advanceTimersByTimeAsync(90001);expect(await pending).toContain('expired after 90 seconds');
  checked(null);swarm.capabilityPreflight=async()=>null;expect(await authorize()).toBeNull();
});

it('does not send a checked follow-up after shutdown changes its session', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const handle = fake.startSession.mock.results[0].value; let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.message(agent.id, 'Continue the feature'); const rejected = expect(pending).rejects.toThrow('Session changed');
  await Promise.resolve(); await swarm.shutdown(true); checked(null);
  await rejected; expect(handle.send).not.toHaveBeenCalled();
});

it('reserves a release reviewer while checking and requires readiness before starting', async () => {
  const {swarm, fake} = await office(true); const qa = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  const developer=swarm.hireAgent('synthetic/repo',{name:'Synthetic release owner'});
  await expect(swarm.reviewDeliveryRelease(developer.id,'synthetic/repo','synthetic-release')).rejects.toThrow('Assigned QA reviewer');
  await expect(swarm.reviewDeliveryRelease(qa.id,'different/repo','synthetic-release')).rejects.toThrow('Assigned QA reviewer');
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;}));
  const pending = swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release');
  await expect(swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'another-release')).rejects.toThrow('busy');
  expect(fake.startSession).not.toHaveBeenCalled(); checked(null);
  await expect(pending).resolves.toContain('started'); expect(fake.startSession).toHaveBeenCalledOnce();
  expect((fake.startSession.mock.calls[0][0] as SessionOptions).prompt).toContain('exact pinned commit');
  expect(fake.commentPull).not.toHaveBeenCalled();expect(fake.prForBranch).not.toHaveBeenCalled();
});

it('does not start release QA on blocked readiness or after the reviewer is stopped', async () => {
  const {swarm, fake} = await office(true); const qa = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  swarm.capabilityPreflight = async () => 'Synthetic environment unavailable';
  await expect(swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release')).rejects.toThrow('environment unavailable');
  let checked!: (value: string | null) => void;
  swarm.capabilityPreflight = () => new Promise(resolve => {checked = resolve;});
  const pending = swarm.reviewDeliveryRelease(qa.id, 'synthetic/repo', 'synthetic-release'); const rejected = expect(pending).rejects.toThrow('Reviewer stopped');
  await Promise.resolve(); swarm.stopAgent(qa.id); checked(null);
  await rejected; expect(fake.startSession).not.toHaveBeenCalled();
});

it('checks the owning CLI before restart recovery resumes a saved session', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  fake.startSession.mock.calls[0][1].sessionId('synthetic-session'); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  saved.settings.runtime = 'terminal'; saved.settings.defaultCli = 'codex';
  saved.agents.find((a: {id: string}) => a.id === agent.id).sessionCli = 'codex';
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const restoredBackend = backend(); restoredBackend.terminals = true;
  const restored = new Swarm(restoredBackend as unknown as Backend); offices.push(restored);
  const preflight = vi.fn(async () => 'Synthetic Codex readiness unavailable'); restored.capabilityPreflight = preflight;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {await restored.init(); for (let i = 0; i < 30; i++) await Promise.resolve();} finally {warn.mockRestore();}
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(restoredBackend.startSession).not.toHaveBeenCalled();
  expect(restored.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'error'});
  await restored.shutdown();
  const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(recovered.agents.find((a: {id: string}) => a.id === agent.id).sessionId).toBe('synthetic-session');
});

it('persists session ID and CLI together when a developer hands its PR to QA', async () => {
  const {swarm, fake} = await office(true); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.sessionId('original-sdk-session');
  callbacks.finished({ok: true, text: 'https://github.com/synthetic/repo/pull/7', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30; i++) await Promise.resolve(); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devAgentId: agent.id, devSessionId: 'original-sdk-session', devSessionCli: 'codex'});
});

async function repairOffice(checkpointCli: string | null, terminal: boolean, blocked: boolean) {
  const {swarm} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'}); await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  saved.settings.runtime = terminal ? 'terminal' : 'sdk'; saved.settings.defaultCli = 'codex';
  Object.assign(saved.agents.find((a: {id: string}) => a.id === developer.id), {status: 'done', task: 'issue', prNumber: 7, sessionId: 'newer-unrelated-session', sessionCli: 'codex'});
  saved.qa = [{repoId: 'synthetic/repo', prNumber: 7, status: 'failed', round: 1, devAgentId: developer.id, qaAgentId: null, summary: 'Synthetic failure', checks: [{name: 'Acceptance', result: 'fail', details: 'Synthetic incorrect response'}], issueNumber: 1, devSessionId: 'original-repair-session', devSessionCli: checkpointCli, fixInstructions: 'Fix the synthetic response', sessionFailures: 0, fixReason: 'qa', mergeFixes: 0, retests: 0}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  const fake = backend(); fake.terminals = terminal; fake.listPulls.mockResolvedValue([pull]);
  const restored = new Swarm(fake as unknown as Backend); offices.push(restored);
  const preflight = vi.fn(async () => blocked ? 'Synthetic runtime blocked' : null); restored.capabilityPreflight = preflight;
  await restored.init(); await vi.advanceTimersByTimeAsync(1000);
  return {swarm: restored, fake, preflight, developer};
}

it('uses the repair checkpoint CLI even when the developer has a newer unrelated session', async () => {
  const {swarm, fake, preflight, developer} = await repairOffice('codex', true, true);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).not.toHaveBeenCalled();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((a: {id: string}) => a.id === developer.id)).toMatchObject({sessionId: 'original-repair-session', sessionCli: 'codex'});
  expect(saved.qa[0]).toMatchObject({devSessionId: 'original-repair-session', devSessionCli: 'codex'});
});

it.each([null, 'unknown-runtime'])('never guesses a CLI for legacy repair checkpoint %s', async cli => {
  const {swarm, fake, preflight} = await repairOffice(cli, true, true);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).not.toHaveBeenCalled();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devSessionId: null, devSessionCli: null});
});

it.each(['codex'])('dispatches the compatible %s repair and stores the new checkpoint pair on completion', async cli => {
  const terminal = cli === 'codex'; const {swarm, fake} = await repairOffice(cli, terminal, false);
  expect(fake.startSession).toHaveBeenCalledOnce();
  const options = fake.startSession.mock.calls[0][0] as {cli?: string; resumeSessionId?: string};
  expect(options.resumeSessionId).toBe('original-repair-session'); expect(options.cli ?? 'codex').toBe(cli);
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.sessionId('completed-repair-session');
  callbacks.finished({ok: true, text: 'Synthetic repair completed', costUsd: 0, turns: 1, errors: []});
  for (let i = 0; i < 30; i++) await Promise.resolve();
  vi.useRealTimers(); // xterm's asynchronous flush during terminal persistence must run
  await swarm.shutdown(true);
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({status: 'queued', devSessionId: 'completed-repair-session', devSessionCli: cli});
});

it('starts fresh rather than giving a Codex checkpoint to the SDK', async () => {
  const {swarm, fake, preflight} = await repairOffice('codex', false, false);
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).toHaveBeenCalledOnce();
  expect((fake.startSession.mock.calls[0][0] as {resumeSessionId?: string}).resumeSessionId).toBeUndefined();
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.qa[0]).toMatchObject({devSessionId: null, devSessionCli: null});
});

it('blocks CEO work without native terminal readiness and retains the queued job', async () => {
  const {swarm, fake} = await office(); const preflight = vi.fn(async () => null); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(swarm.snapshot().ceo).toMatchObject({job: null, blockedReason: expect.stringContaining('terminal runtime'), queue: [{kind: 'chat'}]});
  expect(swarm.snapshot().ceo.retryAt).toBeGreaterThan(Date.now());
});

it.each(['codex','gemini','opencode'] as const)('uses selected CEO %s for readiness, dispatch and tool refresh without changing the model',async cli=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});const preflight=vi.fn(async()=>null);swarm.ceoPreflight=preflight;
  const model=cli==='opencode'?'openai/gpt-synthetic':'explicit-model';swarm.updateAgent(CEO_ID,{cli,model});await swarm.messageCeo('Synthetic architecture request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());expect(preflight).toHaveBeenCalledWith(['synthetic/repo'],cli);
  const options=fake.startSession.mock.calls[0][0] as SessionOptions;expect(options).toMatchObject({role:'ceo',cli,model});expect(options.office).toBeDefined();expect(await options.authorizeTool!()).toBeNull();expect(preflight).toHaveBeenLastCalledWith(['synthetic/repo'],cli);
  expect(swarm.snapshot().agents.find(a=>a.id===CEO_ID)?.cli).toBe(cli);
});
it.each([false,true])('never transfers a CEO checkpoint to a different coding agent (change %s)',async change=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.updateAgent(CEO_ID,{cli:'codex'});await swarm.messageCeo('Synthetic first request');await vi.advanceTimersByTimeAsync(150);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const callbacks=fake.startSession.mock.calls[0][1];callbacks.sessionId('codex-owned-session');callbacks.finished({ok:true,text:'synthetic',costUsd:0,turns:1,errors:[]});
  if(change)swarm.updateAgent(CEO_ID,{cli:'gemini'});await swarm.messageCeo('Synthetic next request');await vi.advanceTimersByTimeAsync(300);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  const options=fake.startSession.mock.calls[1][0] as SessionOptions;expect(options.cli).toBe(change?'gemini':'codex');expect(options.resumeSessionId).toBe(change?undefined:'codex-owned-session');
});
it('defers a CEO runtime change during preflight instead of dispatching with the old readiness result',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});let ready!:(value:string|null)=>void;
  const preflight=vi.fn(()=>new Promise<string|null>(resolve=>{ready=resolve;}));swarm.ceoPreflight=preflight;
  await swarm.messageCeo('Synthetic runtime change');await vi.advanceTimersByTimeAsync(150);swarm.updateAgent(CEO_ID,{cli:'gemini'});ready(null);
  for(let i=0;i<20;i++)await Promise.resolve();expect(fake.startSession).not.toHaveBeenCalled();expect(swarm.snapshot().ceo.blockedReason).toContain('runtime configuration changed');expect(swarm.snapshot().ceo.queue).toHaveLength(1);
});
it('releases only the rejected provider hold when the operator selects another CEO CLI',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.updateAgent(CEO_ID,{cli:'gemini',model:'same-model'});await swarm.messageCeo('Synthetic held request');await vi.advanceTimersByTimeAsync(150);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'',costUsd:0,turns:0,errors:['Native rejection'],configurationError:{kind:'unsupported-model',cli:'gemini',model:'same-model'}});
  swarm.updateAgent(CEO_ID,{cli:'codex'});await vi.advanceTimersByTimeAsync(300);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));expect((fake.startSession.mock.calls[1][0] as SessionOptions)).toMatchObject({cli:'codex',model:'same-model'});expect(swarm.snapshot().ceo.blockedReason).toBeNull();
});

it('holds unsupported CEO model work through messages, cosmetic edits and restart until the model changes',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.updateAgent(CEO_ID,{model:'synthetic-invalid'});await swarm.messageCeo('Original synthetic request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['Error: Model "synthetic-invalid" from --model flag is not available.'],costUsd:0,turns:0,configurationError:{kind:'unsupported-model',cli:'codex',model:'synthetic-invalid'}});
  expect(swarm.snapshot().ceo).toMatchObject({job:null,retryAt:null,blockedReason:expect.stringContaining('model changes'),queue:[{kind:'chat'}]});
  await swarm.messageCeo('Additional synthetic context');swarm.updateAgent(CEO_ID,{name:'Renamed CEO',effort:'high'});await vi.advanceTimersByTimeAsync(180000);
  expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().agents.find(a=>a.id===CEO_ID)?.status).toBe('error');
  vi.useRealTimers();await swarm.shutdown(true);vi.useFakeTimers();
  const restoredBackend=backend();restoredBackend.terminals=true;
  const restored=new Swarm(restoredBackend as unknown as Backend);offices.push(restored);restored.ceoPreflight=async()=>null;restored.capabilityPreflight=async()=>null;
  await restored.init();await vi.advanceTimersByTimeAsync(180000);expect(restoredBackend.startSession).not.toHaveBeenCalled();
  restored.updateAgent(CEO_ID,{model:''});await vi.advanceTimersByTimeAsync(200);
  await vi.waitFor(()=>expect(restoredBackend.startSession).toHaveBeenCalledOnce());
  const options=restoredBackend.startSession.mock.calls[0][0] as SessionOptions;expect(options.model).toBe('');expect(options.prompt).toContain('Original synthetic request');expect(options.prompt).toContain('Additional synthetic context');
  expect(restored.snapshot().ceo.blockedReason).toBeNull();
});

it('does not hold a replacement model when the old active CLI reports its rejection late',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.updateAgent(CEO_ID,{model:'old-invalid'});await swarm.messageCeo('Synthetic model change request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());swarm.updateAgent(CEO_ID,{model:'replacement-model'});
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['native model unavailable'],costUsd:0,turns:0,configurationError:{kind:'unsupported-model',cli:'codex',model:'old-invalid'}});
  await vi.advanceTimersByTimeAsync(300);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect((fake.startSession.mock.calls[1][0] as SessionOptions).model).toBe('replacement-model');expect(swarm.snapshot().ceo.blockedReason).toBeNull();
});

it('does not transfer a retired provider rejection into the Codex default',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.updateAgent(CEO_ID,{model:'legacy-invalid'});await swarm.messageCeo('Synthetic legacy request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].finished({ok:false,text:'',errors:['GitHub Copilot CLI exited with code 1. Error: Model "legacy-invalid" from --model flag is not available.'],costUsd:0,turns:0});
  vi.useRealTimers();await swarm.shutdown(true);vi.useFakeTimers();
  const restoredBackend=backend();restoredBackend.terminals=true;const restored=new Swarm(restoredBackend as unknown as Backend);offices.push(restored);restored.ceoPreflight=async()=>null;
  await restored.init();await restored.messageCeo('Synthetic retry context');await vi.advanceTimersByTimeAsync(180000);
  expect(restoredBackend.startSession).toHaveBeenCalledOnce();expect((restoredBackend.startSession.mock.calls[0][0] as SessionOptions).cli).toBe('codex');
});

it('binds CEO tool authority to its active job and revokes it when stopped', async () => {
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});
  swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Synthetic company review');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const opts=fake.startSession.mock.calls[0][0] as SessionOptions;
  expect(await opts.authorizeTool?.()).toBeNull();swarm.stopAgent(CEO_ID);
  expect(await opts.authorizeTool?.()).toContain('no longer owns');
  const result=await opts.office!.call('company_status',{});
  expect(result).toContain('no longer owns');
});

it('rechecks running CEO prerequisites and cancels pending refresh when its job stops',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Synthetic CEO readiness');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const authorize=(fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!;
  swarm.ceoPreflight=async()=> 'Synthetic Copilot prerequisites unavailable';
  expect(await authorize()).toContain('prerequisites unavailable');
  let checked!:(value:string|null)=>void;swarm.ceoPreflight=()=>new Promise(resolve=>{checked=resolve;});
  const pending=authorize();for(let i=0;i<20&&!checked;i++)await Promise.resolve();
  swarm.stopAgent(CEO_ID);expect(await pending).toContain('no longer owns');checked(null);
});

it.each(['missing', 'empty', 'blocked'])('blocks %s CEO readiness without dropping the job or spamming retries', async mode => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;});
  if (mode !== 'missing') swarm.ceoPreflight = vi.fn(async () => mode === 'empty' ? '' : 'Synthetic project access unavailable');
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  const messages = swarm.snapshot().messages.length;
  await vi.advanceTimersByTimeAsync(16000);
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().ceo.queue).toHaveLength(1);
  expect(swarm.snapshot().messages).toHaveLength(messages);
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.ceo).toMatchObject({job: null, blockedReason: expect.any(String), retryAt: expect.any(Number)});
  expect(saved.ceo.queue[0].text).toBe('Synthetic company question');
});

it('reserves the CEO during checks and starts a ready job using the fixed Copilot runtime', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  expect(swarm.snapshot().agents.find(a => a.id === CEO_ID)?.status).toBe('preparing');
  expect(preflight).toHaveBeenCalledExactlyOnceWith(['synthetic/repo'],'codex'); expect(fake.startSession).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); expect(preflight).toHaveBeenCalledOnce(); checked(null);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({role: 'ceo', cli: 'codex', additionalDirectories: [HOME_DIR]});
  expect(swarm.snapshot().ceo.blockedReason).toBeNull();
  const callbacks = fake.startSession.mock.calls[0][1]; callbacks.turn?.('Synthetic answer');
  callbacks.finished({ok: true, text: 'Synthetic answer', costUsd: 0, turns: 1, errors: []});
  expect(swarm.snapshot().ceo.job).toBeNull();
});

it('retains startup failures and retries immediately when fresh operator information arrives', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); swarm.ceoPreflight = async () => null;
  fake.startSession.mockImplementationOnce(() => {throw new Error('Synthetic CLI start failed');});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(swarm.snapshot().ceo.blockedReason).toContain('could not start'));
  expect(swarm.snapshot().ceo.queue).toHaveLength(1);
  swarm.messageCeo('Additional synthetic context'); await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(swarm.snapshot().ceo.blockedReason).toBeNull();
});

it('cannot start an older cancelled CEO preflight while its replacement is preparing', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); const checks: ((value: string | null) => void)[] = [];
  swarm.ceoPreflight = () => new Promise(resolve => {checks.push(resolve);});
  swarm.messageCeo('Old synthetic request'); await vi.advanceTimersByTimeAsync(150); swarm.stopAgent(CEO_ID);
  swarm.messageCeo('New synthetic request'); await vi.advanceTimersByTimeAsync(150);
  expect(checks).toHaveLength(2); checks[0](null); for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); checks[1](null);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).toContain('New synthetic request');
  expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).not.toContain('Old synthetic request');
});

it('ignores every cancelled CEO callback while a replacement job owns the terminal', async () => {
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  swarm.messageCeo('Old synthetic CEO request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const old=fake.startSession.mock.calls[0][1];const oldHandle=fake.startSession.mock.results[0].value;
  swarm.stopAgent(CEO_ID);expect(oldHandle.stop).toHaveBeenCalledOnce();
  expect(swarm.snapshot().ceo.job).toBeNull();
  swarm.messageCeo('Replacement synthetic CEO request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  const before=swarm.snapshot();
  old.log([{kind:'error',text:'Obsolete CEO log'}]);old.tool('obsolete-tool');old.sessionId('obsolete-checkpoint');
  old.turn?.('Obsolete phone reply');old.limited?.(Date.now()+60000);old.usageWarning?.({rateLimitType:'five_hour',resetsAt:Date.now()+60000,utilization:.99});
  old.finished({ok:false,text:'obsolete',costUsd:90,turns:90,errors:['Obsolete error']});
  expect(swarm.snapshot()).toEqual(before);
  const current=fake.startSession.mock.calls[1][1];current.sessionId('replacement-checkpoint');current.tool('replacement-tool');
  current.turn?.('Replacement phone reply');current.finished({ok:true,text:'replacement',costUsd:2,turns:3,errors:[]});
  const after=swarm.snapshot();expect(after.ceo.job).toBeNull();
  expect(after.agents.find(a=>a.id===CEO_ID)).toMatchObject({status:'done',costUsd:2,turns:3});
  expect(after.messages.some(message=>message.text==='Replacement phone reply')).toBe(true);
  vi.useRealTimers();await swarm.shutdown(true);
  const saved=JSON.parse(await fs.readFile(STATE_FILE,'utf8'));
  expect(saved.agents.find((a:{id:string})=>a.id===CEO_ID).sessionId).toBe('replacement-checkpoint');
});

it('ignores callbacks from a failed CEO launch when the same retained job object is retried',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  let failed!:SessionCallbacks;
  fake.startSession.mockImplementationOnce((_options,callbacks)=>{failed=callbacks;throw new Error('Synthetic launch failure');});
  swarm.messageCeo('Retry this synthetic CEO job');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(swarm.snapshot().ceo.blockedReason).toContain('could not start'));
  const state=(swarm as unknown as {state:{ceo:{queue:unknown[];job:unknown}}}).state;
  const retained=state.ceo.queue[0];
  await vi.advanceTimersByTimeAsync(65000);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(state.ceo.job).toBe(retained);
  const before=swarm.snapshot();failed.turn?.('Obsolete failed reply');failed.sessionId('obsolete-failed-checkpoint');
  failed.finished({ok:true,text:'obsolete',costUsd:10,turns:10,errors:[]});
  expect(swarm.snapshot()).toEqual(before);
});

it('handles synchronous CEO completion once without leaving a stale session handle',async()=>{
  const {swarm,fake}=await office(true,fake=>{fake.terminals=true;});swarm.ceoPreflight=async()=>null;
  const staleHandle={stop:vi.fn(),send:vi.fn()};
  fake.startSession.mockImplementationOnce((_options,callbacks)=>{
    const result={ok:true,text:'synchronous synthetic reply',costUsd:1,turns:2,errors:[]};
    callbacks.finished(result);callbacks.finished(result);callbacks.turn?.('Obsolete post-completion reply');
    return staleHandle;
  });
  swarm.messageCeo('First synthetic request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  expect(swarm.snapshot().agents.find(a=>a.id===CEO_ID)).toMatchObject({status:'done',costUsd:1,turns:2});
  expect(swarm.snapshot().ceo.job).toBeNull();
  swarm.messageCeo('Second synthetic request');await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(staleHandle.send).not.toHaveBeenCalled();expect(staleHandle.stop).not.toHaveBeenCalled();
});

it('blocks CEO dispatch if project requirements change during readiness verification', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  swarm.ceoPreflight = () => new Promise(resolve => {checked = resolve;});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150);
  swarm.updateRepo('synthetic/repo', {mission: 'Changed synthetic requirements'}); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().ceo.blockedReason).toContain('scope changed');
});

it('preserves a pending CEO job on shutdown without launching after its check completes', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  swarm.ceoPreflight = () => new Promise(resolve => {checked = resolve;});
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(150); await swarm.shutdown(true); checked(null);
  for (let i = 0; i < 20; i++) await Promise.resolve(); expect(fake.startSession).not.toHaveBeenCalled();
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); expect(saved.ceo.job.text).toBe('Synthetic company question');
});

it('expires stalled CEO readiness and ignores its eventual result', async () => {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;}); let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); swarm.ceoPreflight = preflight;
  swarm.messageCeo('Synthetic company question'); await vi.advanceTimersByTimeAsync(90150);
  expect(swarm.snapshot().ceo.blockedReason).toContain('expired after 90 seconds');
  expect(swarm.snapshot().ceo.queue).toHaveLength(1); expect(preflight).toHaveBeenCalledOnce();
  checked(null); for (let i = 0; i < 20; i++) await Promise.resolve(); expect(fake.startSession).not.toHaveBeenCalled();
});

async function retainedCeo(preflight: Swarm['ceoPreflight'], resumeId: string | null = 'ceo-owned-session') {
  const {swarm, fake} = await office(true, fake => {fake.terminals = true;});
  swarm.updateAgent(CEO_ID, {cli: 'codex'}); swarm.ceoPreflight = async () => null;
  swarm.messageCeo('Synthetic retained CEO question'); await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].sessionId('ceo-owned-session');
  vi.useRealTimers(); await swarm.shutdown(true); vi.useFakeTimers();
  const fakeRestored = backend(); fakeRestored.terminals = true; const releaseIdle = vi.fn();
  fakeRestored.reconnectClis.mockImplementation(async terminalFor => {
    const terminal = terminalFor(CEO_ID)!; expect(terminal).toBeTruthy(); terminal.releaseIdle = releaseIdle;
    return [{agentId: CEO_ID, cli: 'codex', resumeId, busy: true}];
  });
  const restored = new Swarm(fakeRestored as unknown as Backend); offices.push(restored);
  restored.ceoPreflight = preflight; restored.capabilityPreflight = async () => null;
  return {swarm: restored, fake: fakeRestored, releaseIdle};
}

it('rebinds a retained CEO only after checking its selected runtime and owned checkpoint', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle} = await retainedCeo(preflight);
  await swarm.init();
  expect(preflight).toHaveBeenCalledWith(['synthetic/repo'], 'codex');
  expect(fake.startSession).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({cli: 'codex', reattach: true, resumeSessionId: 'ceo-owned-session'});
  expect(swarm.snapshot().ceo.queue).toHaveLength(0); expect(swarm.snapshot().ceo.job?.kind).toBe('chat');
  expect(releaseIdle).not.toHaveBeenCalled();
  expect(fake.startSession.mock.invocationCallOrder[0]).toBeLessThan(fake.hooksReady.mock.invocationCallOrder[0]);
});

it('holds a retained CEO job when readiness fails and releases the old terminal', async () => {
  const {swarm, fake, releaseIdle} = await retainedCeo(async () => 'Synthetic readiness expired'); await swarm.init();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
  expect(swarm.snapshot().ceo.blockedReason).toBe('Synthetic readiness expired'); expect(swarm.snapshot().ceo.queue).toHaveLength(1);
});

it.each(['wrong-checkpoint', null])('rejects an unowned or absent retained CEO checkpoint: %s', async checkpoint => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle} = await retainedCeo(preflight, checkpoint);
  if (checkpoint === null) {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    saved.agents.find((a: {id: string}) => a.id === CEO_ID).sessionId = null;
    await fs.writeFile(STATE_FILE, JSON.stringify(saved));
  }
  await swarm.init(); expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled();
  expect(releaseIdle).toHaveBeenCalledOnce(); expect(swarm.snapshot().ceo.queue).toHaveLength(1);
});

it('does not rebind a retained CEO after shutdown interrupts readiness', async () => {
  let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;}));
  const {swarm, fake} = await retainedCeo(preflight); const pending = swarm.init();
  await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  vi.useRealTimers(); await swarm.shutdown(true); checked(null); await pending;
  expect(fake.startSession).not.toHaveBeenCalled(); expect(fake.hooksReady).not.toHaveBeenCalled();
});

async function retainedOffice(preflight: Swarm['capabilityPreflight'], cli = 'codex', resumeId: string | null = 'keeper-owned-session') {
  const {swarm, fake} = await office(true); const developer = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(developer.id, 1); for (let i = 0; i < 30 && !fake.startSession.mock.calls.length; i++) await Promise.resolve();
  fake.startSession.mock.calls[0][1].sessionId('older-persisted-session'); await swarm.shutdown(true);
  const restoredBackend = backend(); restoredBackend.terminals = true; const releaseIdle = vi.fn();
  restoredBackend.reconnectClis.mockImplementation(async terminalFor => {
    const terminal = terminalFor(developer.id)!; terminal.releaseIdle = releaseIdle;
    return [{agentId: developer.id, cli: cli as 'codex', resumeId, busy: true}];
  });
  const restored = new Swarm(restoredBackend as unknown as Backend); offices.push(restored); restored.capabilityPreflight = preflight;
  return {swarm: restored, fake: restoredBackend, releaseIdle, developer};
}

it('reattaches a verified retained CLI using keeper ownership despite an SDK default', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle, developer} = await retainedOffice(preflight);
  await swarm.init();
  expect(preflight).toHaveBeenCalledWith('synthetic/repo', 'codex'); expect(fake.startSession).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.calls[0][0]).toMatchObject({cli: 'codex', reattach: true, resumeSessionId: 'keeper-owned-session', terminal: expect.anything()});
  expect(releaseIdle).not.toHaveBeenCalled(); expect(fake.hooksReady).toHaveBeenCalledOnce();
  expect(fake.startSession.mock.invocationCallOrder[0]).toBeLessThan(fake.hooksReady.mock.invocationCallOrder[0]);
  vi.useRealTimers(); // flush the real emulator while persisting the adopted terminal
  await swarm.shutdown(true); const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  expect(saved.agents.find((a: {id: string}) => a.id === developer.id)).toMatchObject({sessionId: 'keeper-owned-session', sessionCli: 'codex'});
});

it('quarantines blocked retained work before releasing waiting hooks', async () => {
  const {swarm, fake, releaseIdle, developer} = await retainedOffice(async () => 'Synthetic target access expired'); await swarm.init();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
  expect(releaseIdle.mock.invocationCallOrder[0]).toBeLessThan(fake.hooksReady.mock.invocationCallOrder[0]);
  expect(swarm.snapshot().agents.find(a => a.id === developer.id)).toMatchObject({status: 'error', lastError: 'Synthetic target access expired'});
});

it('quarantines a retained paused task without starting a new session', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle, developer} = await retainedOffice(preflight);
  swarm.taskPaused = () => true; await swarm.init();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
  expect(swarm.snapshot().agents.find(a => a.id === developer.id)?.status).toBe('stopped');
});

it('rechecks a pause applied during retained-session readiness', async () => {
  let paused = false; let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake, releaseIdle} = await retainedOffice(preflight);
  swarm.taskPaused = () => paused; const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  paused = true; checked(null); await pending;
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
});

it('quarantines invalid retained CLI metadata without querying readiness', async () => {
  const preflight = vi.fn(async () => null); const {swarm, fake, releaseIdle} = await retainedOffice(preflight, 'unknown-runtime'); await swarm.init();
  expect(preflight).not.toHaveBeenCalled(); expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce();
});

it('times out retained admission, quarantines the process and ignores late readiness', async () => {
  let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake, releaseIdle} = await retainedOffice(preflight);
  const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(90000); await pending; checked(null); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(releaseIdle).toHaveBeenCalledOnce(); expect(fake.hooksReady).toHaveBeenCalledOnce();
});

it('does not reopen hooks or reattach after shutdown interrupts retained admission', async () => {
  let checked!: (value: string | null) => void;
  const preflight = vi.fn(() => new Promise<string | null>(resolve => {checked = resolve;})); const {swarm, fake} = await retainedOffice(preflight);
  const pending = swarm.init(); await vi.waitFor(() => expect(preflight).toHaveBeenCalledOnce());
  vi.useRealTimers(); await swarm.shutdown(true); checked(null); await pending;
  expect(fake.startSession).not.toHaveBeenCalled(); expect(fake.hooksReady).not.toHaveBeenCalled();
});

it.each(['qa', 'fix'])('removes stale %s pipeline activity when retained work is quarantined', async task => {
  const {swarm, fake, developer} = await retainedOffice(async () => 'Synthetic access expired');
  const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  Object.assign(saved.agents.find((a: {id: string}) => a.id === developer.id), {task, prNumber: 7});
  saved.qa = [{repoId: 'synthetic/repo', prNumber: 7, status: task === 'qa' ? 'testing' : 'fixing', qaAgentId: developer.id, devAgentId: developer.id, testedSha: 'old-head', passedSha: 'old-head'}];
  await fs.writeFile(STATE_FILE, JSON.stringify(saved)); await swarm.init();
  expect(fake.startSession).not.toHaveBeenCalled(); expect(swarm.snapshot().qa[0].status).toBe(task === 'qa' ? 'queued' : 'failed');
  if (task === 'qa') {vi.useRealTimers(); await swarm.shutdown(true); const recovered = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); expect(recovered.qa[0]).toMatchObject({testedSha: null, passedSha: null, qaAgentId: null});}
});

const secondIssue = {...issue, number: 2, title: 'Build replacement feature'};
const closedCommands: [string,(swarm:Swarm)=>unknown][] = [
  ['repository lookup',swarm=>swarm.listGithubRepos()],
  ['connect repository',swarm=>swarm.connectRepo('synthetic/new')],
  ['create repository',swarm=>swarm.createRepo('synthetic-new',{visibility:'private'})],
  ['list folders',swarm=>swarm.listProjectFolders()],
  ['connect folder',swarm=>swarm.connectFolder(HOME_DIR)],
  ['publish folder',swarm=>swarm.publishFolder(HOME_DIR,{visibility:'private',description:'Synthetic'})],
  ['disconnect repository',swarm=>swarm.disconnectRepo('synthetic/repo')],
  ['update repository',swarm=>swarm.updateRepo('synthetic/repo',{mission:'Late mission'})],
  ['sync folder',swarm=>swarm.syncFolderNow('synthetic/repo')],
  ['start preview',swarm=>swarm.startPreview('synthetic/repo')],
  ['stop preview',swarm=>swarm.stopPreview('synthetic/repo')],
  ['create issue',swarm=>swarm.createIssue('synthetic/repo','Late issue','Synthetic')],
  ['merge pull',swarm=>swarm.mergePull('synthetic/repo',1)],
  ['close pull',swarm=>swarm.closePull('synthetic/repo',1)],
  ['hire agent',swarm=>swarm.hireAgent('synthetic/repo',{name:'Late worker'})],
  ['update agent',swarm=>swarm.updateAgent(CEO_ID,{name:'Late CEO'})],
  ['fire agent',swarm=>swarm.fireAgent('missing')],
  ['stop agent',swarm=>swarm.stopAgent(CEO_ID)],
  ['reset agent',swarm=>swarm.resetAgent(CEO_ID)],
  ['assign issue',swarm=>swarm.assign('missing',1)],
  ['send to QA',swarm=>swarm.sendToQa('synthetic/repo',1)],
  ['message agent',swarm=>swarm.message(CEO_ID,'Late synthetic message')],
  ['update settings',swarm=>swarm.updateSettings({companyName:'Late company'})],
  ['setup',swarm=>swarm.setup({companyName:'Late setup'})],
  ['update office',swarm=>swarm.updateOffice('now')],
  ['message CEO',swarm=>swarm.messageCeo('Late synthetic message')],
  ['review release',swarm=>swarm.reviewDeliveryRelease('missing','synthetic/repo','synthetic-release')],
  ['request review',swarm=>swarm.requestReview()],
  ['onboard floor',swarm=>swarm.onboardFloor('synthetic/repo')],
  ['plan floor',swarm=>swarm.planFloor('synthetic/repo','Late mission')],
  ['mark phone read',swarm=>swarm.markPhoneRead(Date.now())],
  ['approve request',swarm=>swarm.approveRequest('missing')],
  ['reject request',swarm=>swarm.rejectRequest('missing')],
];
it.each(closedCommands)('rejects direct %s after shutdown without changing persisted office state',async(_name,command)=>{
  const {swarm,fake}=await office(true);await swarm.shutdown();
  const before=await fs.readFile(STATE_FILE,'utf8');const snapshot=swarm.snapshot();
  fake.startSession.mockClear();fake.listIssues.mockClear();fake.listPulls.mockClear();fake.setLocalPath.mockClear();
  await expect(Promise.resolve().then(()=>command(swarm))).rejects.toThrow('Office is shutting down');
  expect(swarm.snapshot().repos).toEqual(snapshot.repos);expect(swarm.snapshot().agents).toEqual(snapshot.agents);
  expect(swarm.snapshot().settings).toEqual(snapshot.settings);expect(await fs.readFile(STATE_FILE,'utf8')).toBe(before);
  expect(fake.startSession).not.toHaveBeenCalled();expect(fake.listIssues).not.toHaveBeenCalled();expect(fake.listPulls).not.toHaveBeenCalled();expect(fake.setLocalPath).not.toHaveBeenCalled();
});
it.each(['metadata','folder','identity'] as const)('rejects a repository connection completed after shutdown during %s discovery',async stage=>{
  const {swarm,fake}=await office(true);let finish!:(value:any)=>void;
  const pause=()=>new Promise<any>(resolve=>{finish=resolve;});
  const meta={nameWithOwner:'synthetic/new',description:'Synthetic',url:'https://example.test/repo',defaultBranch:'main'};
  const identity={tenantName:'',tenantDomain:'',tenantId:'',user:'',environments:[],isReal:false,status:'disconnected' as const};
  if(stage==='metadata')fake.repoMeta.mockImplementationOnce(pause);
  if(stage==='folder')fake.scanProjects.mockImplementationOnce(pause);
  if(stage==='identity')fake.tenancy.info.mockImplementationOnce(pause);
  fake.setLocalPath.mockClear();fake.ensureClone.mockClear();
  const pending=swarm.connectRepo('synthetic/new');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await swarm.shutdown();const before=await fs.readFile(STATE_FILE,'utf8');
  finish(stage==='metadata'?meta:stage==='folder'?[]:identity);
  await expect(pending).rejects.toThrow('Office is shutting down');
  expect(swarm.snapshot().repos.map(repo=>repo.id)).toEqual(['synthetic/repo']);
  expect(fake.setLocalPath).not.toHaveBeenCalled();expect(fake.ensureClone).not.toHaveBeenCalled();
  expect(await fs.readFile(STATE_FILE,'utf8')).toBe(before);
});
it.each(['issue','pull'] as const)('does not follow a late %s mutation with synchronization or assignments',async action=>{
  const {swarm,fake}=await office(true);let finish!:(value:any)=>void;
  fake.listIssues.mockClear();fake.listPulls.mockClear();
  if(action==='issue')fake.createIssue.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  else fake.closePull.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=action==='issue'?swarm.createIssue('synthetic/repo','Synthetic issue','Test only','missing'):swarm.closePull('synthetic/repo',1);
  expect(finish).toBeTypeOf('function');await swarm.shutdown();const before=await fs.readFile(STATE_FILE,'utf8');finish(action==='issue'?2:undefined);
  await expect(pending).rejects.toThrow('Office is shutting down');
  expect(fake.listIssues).not.toHaveBeenCalled();expect(fake.listPulls).not.toHaveBeenCalled();expect(fake.startSession).not.toHaveBeenCalled();
  expect(await fs.readFile(STATE_FILE,'utf8')).toBe(before);
});
it('does not publish a folder after its inspection completes during shutdown',async()=>{
  const {swarm,fake}=await office(true);let finish!:(value:any)=>void;
  fake.inspectFolder.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=swarm.publishFolder(HOME_DIR,{visibility:'private',description:'Synthetic'});await swarm.shutdown();
  finish({name:'synthetic',path:HOME_DIR,git:true,github:null});
  await expect(pending).rejects.toThrow('Office is shutting down');expect(fake.publishFolder).not.toHaveBeenCalled();expect(fake.repoMeta).not.toHaveBeenCalled();
});
it('refuses new state and terminal subscribers after shutdown without sending a snapshot',async()=>{
  const {swarm}=await office(true);await swarm.shutdown();
  const client={close:vi.fn(),on:vi.fn(),send:vi.fn(),readyState:1,OPEN:1};
  swarm.addClient(client as any);swarm.attachTerminal(CEO_ID,client as any);
  expect(client.close).toHaveBeenCalledTimes(2);expect(client.close).toHaveBeenCalledWith(1001,'Office is shutting down');
  expect(client.on).not.toHaveBeenCalled();expect(client.send).not.toHaveBeenCalled();
});
it.each(['create','publish'] as const)('does not attach a repository after late %s completion',async action=>{
  const {swarm,fake}=await office(true);let finish!:(value:any)=>void;
  fake.inspectFolder.mockResolvedValue({name:'synthetic-new',path:HOME_DIR,git:true,github:null} as any);
  if(action==='create')fake.createProject.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  else fake.publishFolder.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=action==='create'?swarm.createRepo('synthetic-new',{visibility:'private'}):swarm.publishFolder(HOME_DIR,{visibility:'private',description:'Synthetic'});
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await swarm.shutdown();
  finish(action==='create'?{fullName:'synthetic/new',path:HOME_DIR}:'synthetic/new');
  await expect(pending).rejects.toThrow('Office is shutting down');
  expect(fake.repoMeta).not.toHaveBeenCalled();expect(swarm.snapshot().repos.map(repo=>repo.id)).toEqual(['synthetic/repo']);
  expect(action==='create'?fake.createProject:fake.publishFolder).toHaveBeenCalledOnce();
});
it('rejects a late external repository listing after admission closes',async()=>{
  const {swarm,fake}=await office();let finish!:(value:[])=>void;
  fake.listMyRepos.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=swarm.listGithubRepos();await swarm.shutdown();finish([]);
  await expect(pending).rejects.toThrow('Office is shutting down');
});
it('discards folder-sync feedback completed after shutdown without updating its last observation',async()=>{
  const {swarm,fake}=await office(true);let finish!:(value:any)=>void;
  await vi.waitFor(()=>expect(swarm.snapshot().repos[0].cloneStatus).toBe('ready'));
  const observed=swarm.snapshot().repos[0].folderSync;
  fake.syncMain.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=swarm.syncFolderNow('synthetic/repo');expect(finish).toBeTypeOf('function');
  await swarm.shutdown();const before=await fs.readFile(STATE_FILE,'utf8');finish({status:'updated synthetic',behind:0,updatable:false});
  await expect(pending).rejects.toThrow('Office is shutting down');
  expect(swarm.snapshot().repos[0].folderSync).toBe(observed);expect(await fs.readFile(STATE_FILE,'utf8')).toBe(before);
});
async function twoIssueOffice() {return office(true, fake => fake.listIssues.mockResolvedValue([issue, secondIssue]));}
it('drains new dispatch while an admitted task continues, and permits explicit resumption',async()=>{
  const {swarm,fake}=await twoIssueOffice();const first=swarm.hireAgent('synthetic/repo',{name:'Admitted worker'}),second=swarm.hireAgent('synthetic/repo',{name:'Waiting worker'});
  await swarm.assign(first.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledOnce());
  const handle=fake.startSession.mock.results[0].value;swarm.setDraining(true);
  await expect(swarm.assign(second.id,2)).rejects.toThrow('draining');expect(handle.stop).not.toHaveBeenCalled();
  expect(await (fake.startSession.mock.calls[0][0] as SessionOptions).authorizeTool!()).toBeNull();
  await swarm.message(first.id,'Synthetic existing-task follow-up');expect(handle.send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);expect(fake.startSession).toHaveBeenCalledOnce();
  swarm.setDraining(false);await swarm.assign(second.id,2);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));
});

it('cannot apply an old failed readiness decision to a replacement assignment', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  const checks: ((value: string | null) => void)[] = []; swarm.capabilityPreflight = () => new Promise(resolve => {checks.push(resolve);});
  await swarm.assign(agent.id, 1); swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  expect(checks).toHaveLength(2); checks[0]('Old synthetic failure'); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'preparing', issueNumber: 2, lastError: null});
  checks[1](null); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.prepareDesk.mock.calls[0][3]).toContain('issue-2');
});

it('serializes cancelled and replacement worktree preparation without launching the old task', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let prepared!: (value: string) => void;
  fake.prepareDesk.mockImplementationOnce(() => new Promise(resolve => {prepared = resolve;}));
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.prepareDesk).toHaveBeenCalledOnce());
  swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2); for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fake.prepareDesk).toHaveBeenCalledOnce(); prepared(HOME_DIR);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  expect(fake.prepareDesk).toHaveBeenCalledTimes(2); expect((fake.startSession.mock.calls[0][0] as {prompt: string}).prompt).toContain('#2');
});

it('ignores obsolete session callbacks and retains the replacement session handle', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  const old = fake.startSession.mock.calls[0][1]; swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  const replacement = fake.startSession.mock.results[1].value; const usage = swarm.snapshot().usage;
  old.sessionId('obsolete-session'); old.tool('obsolete-tool'); old.browserUrl('https://obsolete.test');
  old.log([{kind: 'text', text: 'obsolete log'}]); old.screenshot(Buffer.from('obsolete'), 'image/png'); old.limited?.(Date.now() + 60000);
  old.finished({ok: true, text: 'https://github.com/synthetic/repo/pull/7', costUsd: 99, turns: 99, errors: []});
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'working', issueNumber: 2, prNumber: null, costUsd: 0, turns: 0, hasScreenshot: false});
  expect(swarm.snapshot().usage).toEqual(usage); expect(swarm.snapshot().qa).toHaveLength(0);
  await swarm.message(agent.id, 'Current follow-up'); expect(replacement.send).toHaveBeenCalledExactlyOnceWith('Current follow-up');
});

it('discards a PR lookup that finishes after its task was replaced', async () => {
  const {swarm, fake} = await twoIssueOffice(); const agent = swarm.hireAgent('synthetic/repo', {name: 'Synthetic developer'});
  let found!: (value: {number: number; url: string}) => void;
  fake.prForBranch.mockImplementationOnce(() => new Promise(resolve => {found = resolve;}));
  await swarm.assign(agent.id, 1); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledOnce());
  fake.startSession.mock.calls[0][1].finished({ok: true, text: 'No PR link in this result', costUsd: 0, turns: 1, errors: []});
  expect(found).toBeTypeOf('function'); swarm.stopAgent(agent.id); await swarm.assign(agent.id, 2);
  found({number: 7, url: 'https://example.test/pr/7'}); await vi.waitFor(() => expect(fake.startSession).toHaveBeenCalledTimes(2));
  expect(swarm.snapshot().agents.find(a => a.id === agent.id)).toMatchObject({status: 'working', issueNumber: 2, prNumber: null});
  expect(swarm.snapshot().qa).toHaveLength(0);
});

it('stops remaining QA uploads and refuses an old approval after the reviewer is reassigned', async () => {
  const {swarm, fake, callbacks} = await qaOffice(); const reviewer = swarm.snapshot().agents.find(a => a.role === 'qa')!;
  callbacks.screenshot(Buffer.from('synthetic image one'), 'image/png'); callbacks.screenshot(Buffer.from('synthetic image two'), 'image/png');
  let uploaded!: (value: string) => void;
  fake.uploadEvidence.mockImplementationOnce(() => new Promise(resolve => {uploaded = resolve;}));
  callbacks.finished({ok: true, text: '', structured: {...qaReport, screenshots: ['First image', 'Second image']}, costUsd: 0, turns: 1, errors: []});
  expect(uploaded).toBeTypeOf('function'); swarm.stopAgent(reviewer.id); swarm.resetAgent(reviewer.id);
  await swarm.sendToQa('synthetic/repo', 7); await vi.advanceTimersByTimeAsync(200);
  expect(fake.startSession).toHaveBeenCalledTimes(2); uploaded('https://example.test/evidence');
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(fake.uploadEvidence).toHaveBeenCalledOnce(); expect(fake.commentPull).not.toHaveBeenCalled();
  expect(swarm.snapshot().qa[0].status).toBe('testing');
});
