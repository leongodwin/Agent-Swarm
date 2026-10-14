import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';

vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-http-'));
  return { ...real, HOME_DIR: root, STATE_FILE: path.join(root, 'state.json'), WORKSPACE_ROOT: path.join(root, 'workspaces') };
});
import { HOME_DIR, STATE_FILE } from './config.ts';
import { Swarm } from './swarm.ts';
import { FeatureStore } from './features.ts';
import { CapabilityService } from './capabilityChecks.ts';
import { DeliveryService } from './delivery.ts';
import { ToolGovernanceService } from './toolGovernance.ts';
import { TenantDlpService, type StartPolicyReader } from './tenantDlp.ts';
import { CanvasOwnership } from './canvasOwnership.ts';
import { createOfficeHttpApp } from './officeHttp.ts';
import { OfficeMaintenance } from './officeMaintenance.ts';
import {observeWorkflowReliability} from './workflowReliability.ts';
import {unavailableGovernance} from './lifecycleGovernance.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const name of await fs.readdir(HOME_DIR)) await fs.rm(path.join(HOME_DIR, name), { recursive: true, force: true });
  vi.restoreAllMocks();
});
afterAll(async () => fs.rm(HOME_DIR, { recursive: true, force: true }));
const tenantId='11111111-1111-4111-8111-111111111111';
const environment='https://synthetic.crm4.dynamics.com';
async function office(withEvidence=false,requestHandoff?:()=>void,workflowReliability?:Parameters<typeof createOfficeHttpApp>[0]['workflowReliability'],officeReload?:Parameters<typeof createOfficeHttpApp>[0]['officeReload']) {
  await fs.writeFile(STATE_FILE, JSON.stringify({ version: 2, settings: { runtime: 'sdk', ceoHeartbeatMin: 0, autoUpdate: false },
    repos: [{ id:'synthetic/repo',fullName:'synthetic/repo',defaultBranch:'main',floor:1,color:'#000',description:'',url:'',autoAssign:false,autoMerge:false,browserTesting:false,addedAt:1 }] }));
  const tenancy = {status:'connected', user:'synthetic@example.com', environments:[{name:'Synthetic',url:environment,active:true}], isReal:true};
  const external = {
    demo:false,terminals:false,tenancy:{info:vi.fn(async()=>tenancy),select:vi.fn(async()=>({status:'connected'})),login:vi.fn(async()=>({status:'pending'})),loginStatus:vi.fn(()=>({status:'pending'})),cancelLogin:vi.fn(()=>({status:'cancelled'})),close:vi.fn()},
    user:vi.fn(async()=>'synthetic'),reconnectClis:vi.fn(async()=>[]),hooksReady:vi.fn(),detectClis:vi.fn(async()=>[]),releaseClis:vi.fn(async()=>{}),
    setLocalPath:vi.fn(),ensureClone:vi.fn(async()=>{}),releaseDesk:vi.fn(async()=>{}),removeDesk:vi.fn(async()=>{}),
    listIssues:vi.fn(async()=>[]),listPulls:vi.fn(async()=>[]),syncMain:vi.fn(async()=>null),
    mainDir:()=>HOME_DIR,deskDir:()=>HOME_DIR,
    repoMeta:vi.fn(async()=>{throw new Error('Unexpected remote repository lookup');}),
    startSession:vi.fn(()=>{throw new Error('Unexpected agent session');}),
    previews:{hasDefault:vi.fn(async()=>false),start:vi.fn(()=>{throw new Error('Unexpected preview');})},
    office:{head:vi.fn(async()=>null),takeLastUpdate:vi.fn(async()=>null),isOwnFolder:()=>false},
  };
  const maintenance=new OfficeMaintenance(path.join(HOME_DIR,'maintenance.json'));await maintenance.init();cleanup.push(()=>maintenance.close());
  const swarm=new Swarm(external as unknown as Backend);if(maintenance.draining)swarm.setDraining(true);cleanup.push(()=>swarm.shutdown());await swarm.init();
  const features=new FeatureStore(path.join(HOME_DIR,'features.json'),false);await features.init();
  const capabilities=new CapabilityService(HOME_DIR,false,async()=>{throw new Error('Synthetic provider unavailable');});await capabilities.init();cleanup.push(()=>capabilities.close());
  if(withEvidence){
    const root=path.join(HOME_DIR,'delivery-runs','synthetic-run','evidence');await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'proof.txt'),'synthetic evidence bytes');
    await fs.writeFile(path.join(HOME_DIR,'delivery.json'),JSON.stringify({policy:null,releases:[],blockers:[],revision:0,runs:[{id:'synthetic-run',repoId:'synthetic/repo',head:'synthetic-commit',environmentUrl:environment,phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:['proof.txt'],log:[]}]}));
  }
  const delivery=new DeliveryService(HOME_DIR,false);await delivery.init();cleanup.push(()=>delivery.close());
  if(maintenance.draining)delivery.setDraining(true);
  const toolGovernance=new ToolGovernanceService(path.join(HOME_DIR,'governance'),()=>true);await toolGovernance.init();
  const reader=vi.fn<StartPolicyReader>(()=>({pid:123,refresh(){},stop(){}}));
  const tenantDlp=new TenantDlpService(path.join(HOME_DIR,'governance'),reader);await tenantDlp.init();cleanup.push(()=>tenantDlp.close());
  const canvasOwnership=new CanvasOwnership(path.join(HOME_DIR,'leases'));cleanup.push(()=>canvasOwnership.close());
  const {app,closeAdmission}=createOfficeHttpApp({officeReload,backend:external as unknown as Backend,swarm,features,capabilities,delivery,toolGovernance,tenantDlp,canvasOwnership,homeDir:HOME_DIR,runtimeStartedAt:new Date().toISOString(),policyReaderMode:'launcher',requestHandoff,workflowReliability,changeDrain:(value,apply)=>maintenance.change(value,apply)});
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session=await fetch(`${url}/api/session`);const cookie=session.headers.get('set-cookie')!.split(';')[0];
  const request=(resource:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+resource,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {url,cookie,request,swarm,external,tenancy,delivery,features,capabilities,reader,closeAdmission,maintenance};
}
it('reads reliability only for authenticated connected repositories and rejects scope overrides',async()=>{
  const observe=vi.fn(()=>observeWorkflowReliability('synthetic/repo',async()=>{throw new Error('Synthetic history unavailable');}));const {url,request}=await office(false,undefined,{observe});
  expect((await fetch(url+'/api/repos/synthetic%2Frepo/reliability')).status).toBe(401);expect((await request('/api/repos/foreign%2Frepo/reliability')).status).toBe(404);
  expect((await request('/api/repos/synthetic%2Frepo/reliability?branch=other')).status).toBe(400);expect(observe).not.toHaveBeenCalled();
  expect((await request('/api/repos/synthetic%2Frepo/reliability')).status).toBe(200);expect(observe).toHaveBeenCalledExactlyOnceWith('synthetic/repo');
});
it.each(['stale','not-real','ambiguous','no-active','unsafe-root'])('blocks tenant writes from %s profile discovery before provider calls',async mode=>{
  const f=await office();if(mode==='stale')f.tenancy.status='stale';if(mode==='not-real')f.tenancy.isReal=false;
  if(mode==='ambiguous')f.tenancy.environments.push({...f.tenancy.environments[0],name:'Other'});
  if(mode==='no-active')f.tenancy.environments[0].active=false;
  if(mode==='unsafe-root')f.tenancy.environments[0].url=environment+'/path';
  const configure=vi.spyOn(f.delivery,'configure');
  expect((await f.request('/api/delivery/configure','POST',{enabled:true})).status).toBe(409);
  expect((await f.request(`/api/authoring/canvas/${tenantId}/lease`,'POST',{owner:'Synthetic maker'})).status).toBe(409);
  expect((await f.request('/api/governance/tenant/refresh','POST',{tenantId})).status).toBe(409);
  expect(configure).not.toHaveBeenCalled();expect(f.reader).not.toHaveBeenCalled();
});
it('authenticates reload, pins PID and requires both services drained before preparing',async()=>{
  const commit=vi.fn(async()=>'accepted' as const),cancel=vi.fn(),prepare=vi.fn(async()=>({operationId:'11111111-1111-4111-8111-111111111111',commit,cancel}));
  const {url,request,delivery}=await office(false,undefined,undefined,{prepare,view:()=>({supported:true,phase:'idle'})});
  expect((await fetch(url+'/api/office/reload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedPid:process.pid})})).status).toBe(401);
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid+1})).status).toBe(409);
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid,command:'arbitrary'})).status).toBe(400);
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid})).status).toBe(409);expect(prepare).not.toHaveBeenCalled();
  await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true});delivery.setDraining(false);
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid})).status).toBe(409);delivery.setDraining(true);
  const response=await request('/api/office/reload','POST',{expectedPid:process.pid});expect(response.status).toBe(202);expect(await response.json()).toMatchObject({accepted:true,preserveMaintenance:true});
  await vi.waitFor(()=>expect(commit).toHaveBeenCalledOnce());expect(cancel).not.toHaveBeenCalled();
  expect((await request('/api/runtime')).status).toBe(200);
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:false})).status).toBe(503);
});
it('keeps HTTP admission and maintenance unchanged when the owning launcher cannot acknowledge reload',async()=>{
  const prepare=vi.fn(async()=>{throw new Error('Older launcher');});const {request}=await office(false,undefined,undefined,{prepare,view:()=>({supported:false,phase:'idle',reason:'Older launcher'})});
  await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true});
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid})).status).toBe(503);
  expect(await (await request('/api/runtime')).json()).toMatchObject({pid:process.pid,draining:true,reload:{supported:false}});
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true})).status).toBe(200);
});
it.each(['active','cleanup','undrained'])('rechecks %s work after asynchronous reload preparation and cancels before acceptance',async mode=>{
  const commit=vi.fn(async()=>'accepted' as const),cancel=vi.fn();let intervene=()=>{};
  const prepare=vi.fn(async()=>{intervene();return {operationId:'11111111-1111-4111-8111-111111111111',commit,cancel};});
  const {request,swarm,delivery}=await office(false,undefined,undefined,{prepare,view:()=>({supported:true,phase:'idle'})});
  await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true});
  intervene=()=>{if(mode==='undrained'){delivery.setDraining(false);return;}const usage=swarm.sessionUsage();vi.spyOn(swarm,'sessionUsage').mockReturnValue({...usage,...(mode==='active'?{used:1}:{blockedReason:'Synthetic cleanup'})});};
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid})).status).toBe(409);
  expect(cancel).toHaveBeenCalledOnce();expect(commit).not.toHaveBeenCalled();
});
it.each(['refused','unknown'])('reopens mutation admission only on an explicit parent refusal, never an %s outcome',async result=>{
  const {request}=await office(false,undefined,undefined,{prepare:async()=>({operationId:'11111111-1111-4111-8111-111111111111',commit:async()=>result as 'refused'|'unknown',cancel(){}}),view:()=>({supported:true,phase:'failed'})});
  await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true});
  expect((await request('/api/office/reload','POST',{expectedPid:process.pid})).status).toBe(202);
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true})).status).toBe(result==='refused'?200:503);
  expect((await request('/api/runtime')).status).toBe(200);
});

it('uses the production session boundary and reports actual initialized services',async()=>{
  const {request,url,external}=await office();
  expect((await fetch(url+'/api/state')).status).toBe(401);
  expect((await request('/api/state','GET',undefined,{Origin:'https://foreign.example'})).status).toBe(403);
  expect((await request('/api/state')).status).toBe(200);
  expect(await (await request('/api/runtime')).json()).toMatchObject({demo:false,policyReaderMode:'launcher',homeDir:HOME_DIR});
  expect(await (await request('/api/governance/tenant')).json()).toMatchObject({status:'unavailable',complianceVerified:false});
  expect(await (await request('/api/governance/tools')).json()).toMatchObject({evaluated:0,tenantPolicyVerified:false});
  expect(await (await request('/api/capabilities')).json()).toMatchObject({results:[]});
  expect((await request('/api/implementation-templates')).status).toBe(200);
  expect((await request('/api/implementation-templates/missing')).status).toBe(404);
  expect((await request('/api/repos/unknown%2Frepo/solution-architecture')).status).toBe(404);
  expect(external.startSession).not.toHaveBeenCalled();
});
it('pins policy discovery to the connected caller and rejects supplied evidence',async()=>{
  const {request,reader,tenancy}=await office();
  expect((await request('/api/governance/tenant/refresh','POST',{tenantId,caller:'forged@example.com',policies:[]})).status).toBe(400);
  expect(reader).not.toHaveBeenCalled();
  tenancy.status='disconnected';expect((await request('/api/governance/tenant/refresh','POST',{tenantId})).status).toBe(409);
  tenancy.status='connected';
  const response=await request('/api/governance/tenant/refresh','POST',{tenantId});expect(response.status).toBe(200);
  expect(reader.mock.calls[0][0]).toEqual({tenantId,caller:'synthetic@example.com'});
  expect((await response.json()).status).toBe('reading');
});
it('configures the actual delivery target, retains the Copilot pause and disables without fresh authentication',async()=>{
  const {request,tenancy,delivery}=await office();
  expect((await request('/api/delivery/configure','POST',{enabled:'yes'})).status).toBe(400);
  tenancy.status='disconnected';expect((await request('/api/delivery/configure','POST',{enabled:true})).status).toBe(409);
  tenancy.status='connected';expect((await request('/api/delivery/configure','POST',{enabled:true})).status).toBe(200);
  expect(delivery.view().policy?.environmentUrl).toBe(environment);
  expect((await request('/api/delivery/platforms','POST',{copilotPaused:true})).status).toBe(200);
  tenancy.status='disconnected';expect((await request('/api/delivery/configure','POST',{enabled:false})).status).toBe(200);
  expect(delivery.view().policy).toMatchObject({enabled:false,copilotPaused:true});
  expect((await request('/api/repos/missing%2Frepo/delivery/run','POST',{})).status).toBe(404);
  expect((await request('/api/delivery/runs/missing/evidence?file=../../secret')).status).toBe(404);
});
it('acquires and releases real local Canvas leases, refusing conflict, forged tokens and disconnected targets',async()=>{
  const {request,tenancy}=await office();const app=tenantId;
  tenancy.status='disconnected';expect((await request(`/api/authoring/canvas/${app}/lease`,'POST',{owner:'synthetic'})).status).toBe(409);
  tenancy.status='connected';const response=await request(`/api/authoring/canvas/${app}/lease`,'POST',{owner:'synthetic'});expect(response.status).toBe(200);
  const lease=await response.json();expect(lease.remoteStudioUnlock).toBe(false);
  expect((await request(`/api/authoring/canvas/${app}/lease`,'POST',{owner:'another'})).status).toBe(409);
  expect((await request('/api/authoring/canvas/lease/release','POST',{token:tenantId})).status).toBe(409);
  expect((await request('/api/authoring/canvas/lease/release','POST',{token:lease.token})).status).toBe(200);
  expect((await request(`/api/authoring/canvas/${app}/lease`,'POST',{owner:'another'})).status).toBe(200);
});
it('validates authentication inputs before passing them to the provider',async()=>{
  const {request,external}=await office();
  expect((await request('/api/tenancy/login','POST',{interactive:false,clientSecret:'synthetic-secret'})).status).toBe(400);
  expect((await request('/api/tenancy/select','POST',{index:0})).status).toBe(400);
  expect(external.tenancy.login).not.toHaveBeenCalled();expect(external.tenancy.select).not.toHaveBeenCalled();
  expect((await request('/api/tenancy/login','POST',{interactive:true})).status).toBe(200);
  expect(external.tenancy.login).toHaveBeenCalledWith({interactive:true});
  expect((await request('/api/tenancy/login/synthetic')).status).toBe(200);
  expect((await request('/api/tenancy/login/synthetic','DELETE')).status).toBe(200);
  expect((await request('/api/tenancy/select','POST',{index:1})).status).toBe(200);
});
it('persists real office settings and refuses malformed numbers before assignments or PR operations',async()=>{
  const {request,swarm}=await office();
  expect((await request('/api/settings','PATCH',{companyName:'Synthetic HTTP company'})).status).toBe(200);
  expect(swarm.snapshot().settings.companyName).toBe('Synthetic HTTP company');
  for(const suffix of ['merge','close','qa'])expect((await request(`/api/repos/synthetic%2Frepo/pulls/0/${suffix}`,'POST',{})).status).toBe(400);
  expect((await request('/api/agents/missing/assign','POST',{issueNumber:-1})).status).toBe(400);
  expect((await request('/api/repos/synthetic%2Frepo/preview','POST',{pr:'12'})).status).toBe(400);
  expect((await request('/api/agents/missing/screen')).status).toBe(404);
  expect((await request('/api/phone/read','POST',{at:123})).status).toBe(200);
});
it('does not expose unexpected backend diagnostics in HTTP errors',async()=>{
  const {request,external}=await office();vi.spyOn(console,'error').mockImplementation(()=>{});
  external.repoMeta.mockRejectedValue(new Error('private-path-and-provider-token'));
  const response=await request('/api/repos','POST',{fullName:'synthetic/other'});
  expect(response.status).toBe(500);expect((await response.json()).error).toBe('Office request failed; inspect the server diagnostics');
});
it('rejects arrays, malformed JSON, oversized bodies and extra deployment controls without external execution',async()=>{
  const {request,url,cookie,external,delivery}=await office();
  expect((await request('/api/delivery/configure','POST')).status).toBe(400);
  for(const body of [[],{enabled:true,environmentUrl:'https://forged.crm4.dynamics.com'}])expect((await request('/api/delivery/configure','POST',body)).status).toBe(400);
  for(const body of [{releaseId:1},{releaseId:tenantId,command:'arbitrary'}])expect((await request('/api/repos/synthetic%2Frepo/delivery/run','POST',body)).status).toBe(400);
  expect((await request('/api/repos/synthetic%2Frepo/capabilities/check','POST',{command:'arbitrary'})).status).toBe(400);
  expect((await fetch(url+'/api/settings',{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"broken":'})).status).toBe(400);
  expect((await request('/api/settings','PATCH',{companyName:'x'.repeat(1024*1024+10)})).status).toBe(413);
  expect(delivery.view().policy).toBeNull();expect(external.startSession).not.toHaveBeenCalled();
});
it('manages synthetic agents through the real swarm, without starting coding sessions',async()=>{
  const {request,swarm,external}=await office();
  const created=await request('/api/repos/synthetic%2Frepo/agents','POST',{name:'Synthetic HTTP developer',role:'dev'});expect(created.status).toBe(200);
  const agent=await created.json();
  expect(swarm.snapshot().agents.find(item=>item.id===agent.id)?.name).toBe('Synthetic HTTP developer');
  expect((await request(`/api/agents/${agent.id}`,'PATCH',{brief:'Test-only brief'})).status).toBe(200);
  expect((await request(`/api/agents/${agent.id}/stop`,'POST')).status).toBe(200);
  expect((await request(`/api/agents/${agent.id}/reset`,'POST')).status).toBe(200);
  expect((await request(`/api/agents/${agent.id}`,'DELETE')).status).toBe(200);
  expect(swarm.snapshot().agents.some(item=>item.id===agent.id)).toBe(false);
  expect(external.startSession).not.toHaveBeenCalled();
});
it('denies forged local hook sessions and unsupported MCP methods before browser authentication',async()=>{
  const {url}=await office();
  const response=await fetch(url+'/api/hooks/missing-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'synthetic'}})});
  expect(response.status).toBe(200);expect((await response.json()).hookSpecificOutput.permissionDecision).toBe('deny');
  const unsupported=await fetch(url+'/api/mcp/missing-session');expect(unsupported.status).toBe(405);expect(unsupported.headers.get('allow')).toBe('POST');
});
it('closes HTTP admission before parsing new commands and rejects a late successful provider response',async()=>{
  const {request,external,tenancy,closeAdmission}=await office();
  let finish!:(value:typeof tenancy)=>void,started!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;});
  external.tenancy.info.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;started();}));
  const pending=request('/api/tenancy');await waiting;
  closeAdmission();closeAdmission();finish(tenancy);
  expect((await pending).status).toBe(503);
  for(const resource of ['/api/settings','/api/hooks/missing-session','/api/mcp/missing-session'])expect((await request(resource,'POST',[])).status).toBe(503);
  expect((await request('/api/session')).status).toBe(503);
  expect(external.startSession).not.toHaveBeenCalled();
});
it('downloads exact registered evidence bytes and refuses unregistered or escaping paths',async()=>{
  const {request}=await office(true);vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await request('/api/delivery/runs/synthetic-run/evidence?file=proof.txt');
  expect(response.status).toBe(200);expect(await response.text()).toBe('synthetic evidence bytes');
  expect(response.headers.get('content-disposition')).toContain('attachment;');
  expect((await request('/api/delivery/runs/synthetic-run/evidence?file=unregistered.txt')).status).toBe(404);
  expect((await request('/api/delivery/runs/synthetic-run/evidence?file=../outside.txt')).status).toBe(404);
});
it('serves only current context-bound health evidence without altering the release evidence ledger',async()=>{
  const {request,url,delivery}=await office(true),snapshot=delivery.view(),run=snapshot.runs[0];run.head='a'.repeat(40);run.releaseId='synthetic-release';run.health={status:'degraded',nextCheckAt:new Date().toISOString(),governanceEvidence:'health/governance-0-health.json'};
  vi.spyOn(delivery,'view').mockImplementation(()=>structuredClone(snapshot));
  const root=path.join(HOME_DIR,'delivery-runs',run.id,'health');await fs.mkdir(root,{recursive:true});
  const policyContent=JSON.stringify({scope:'environment-rule-assignment-inventory',complete:false,complianceVerified:false,accountScope:'azure-cli-profile',status:'unavailable',tenantId:'11111111-1111-4111-8111-111111111111',caller:'tester@company.test',environmentId:'11111111-1111-4111-8111-111111111111',checkedAt:new Date().toISOString(),reason:'Synthetic policy unavailable',assignments:[],policies:[]});
  const policy=`advanced-policy-${crypto.createHash('sha256').update(policyContent).digest('hex')}.json`,schema=`declared-schema-${'c'.repeat(64)}.json`;
  const decision={...unavailableGovernance({phase:'health',sourceCommit:run.head,environmentUrl:run.environmentUrl,releaseId:run.releaseId,checkout:'synthetic',manifest:{}}),advancedPolicyFile:policy,declaredSchemaFile:schema};
  await fs.writeFile(path.join(root,'governance-0-health.json'),JSON.stringify(decision));await fs.writeFile(path.join(root,policy),policyContent);await fs.writeFile(path.join(root,schema),'partial schema bytes');
  expect((await fetch(url+'/api/delivery/runs/synthetic-run/health-evidence')).status).toBe(401);
  const response=await request('/api/delivery/runs/synthetic-run/health-evidence');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({status:'unavailable',files:[{file:'governance-0-health.json',kind:'decision'},{file:schema,kind:'schema'},{file:policy,kind:'advanced-policy'}]});
  const download=await request(`/api/delivery/runs/synthetic-run/health-evidence?file=${policy}`);expect(download.status).toBe(200);expect(await download.text()).toBe(policyContent);expect(download.headers.get('content-disposition')).toContain('attachment');
  await fs.writeFile(path.join(root,policy),'tampered private output');expect((await request(`/api/delivery/runs/synthetic-run/health-evidence?file=${policy}`)).status).toBe(404);await fs.writeFile(path.join(root,policy),policyContent);
  for(const file of ['../proof.txt','unregistered.json','governance-1-health.json'])expect((await request(`/api/delivery/runs/synthetic-run/health-evidence?file=${encodeURIComponent(file)}`)).status).toBe(404);
  expect((await request('/api/delivery/runs/synthetic-run/health-evidence?extra=1')).status).toBe(400);
  expect(snapshot.runs[0].evidence).toEqual(['proof.txt']);expect((await request('/api/delivery/runs/synthetic-run/evidence?file=proof.txt')).status).toBe(200);
  await fs.writeFile(path.join(root,'governance-0-health.json'),JSON.stringify({...decision,sourceCommit:'d'.repeat(40)}));expect((await request('/api/delivery/runs/synthetic-run/health-evidence')).status).toBe(404);
  await fs.writeFile(path.join(root,'governance-0-health.json'),JSON.stringify(decision));await fs.unlink(path.join(root,schema));expect((await request(`/api/delivery/runs/synthetic-run/health-evidence?file=${schema}`)).status).toBe(404);
  let reads=0;vi.mocked(delivery.view).mockImplementation(()=>{const value=structuredClone(snapshot);if(++reads>1)value.runs[0].health!.governanceEvidence='health/governance-1-health.json';return value;});
  expect((await request('/api/delivery/runs/synthetic-run/health-evidence')).status).toBe(409);
});
it('requires a current process and quiescent authenticated office for terminal-preserving handoff',async()=>{
  const handoff=vi.fn();const {request,swarm,url}=await office(false,handoff);
  expect((await fetch(url+'/api/office/prepare-handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedPid:process.pid})})).status).toBe(401);
  expect((await request('/api/office/prepare-handoff','POST',{expectedPid:process.pid+1})).status).toBe(409);
  expect((await request('/api/office/prepare-handoff','POST',{expectedPid:process.pid,command:'arbitrary'})).status).toBe(400);
  expect(handoff).not.toHaveBeenCalled();
  const usage=swarm.sessionUsage();const snapshot=vi.spyOn(swarm,'sessionUsage');
  snapshot.mockReturnValue({...usage,used:1,agentSessions:1});
  expect((await request('/api/office/prepare-handoff','POST',{expectedPid:process.pid})).status).toBe(409);expect(handoff).not.toHaveBeenCalled();snapshot.mockRestore();
  const response=await request('/api/office/prepare-handoff','POST',{expectedPid:process.pid});expect(response.status).toBe(202);expect(await response.json()).toMatchObject({accepted:true,preserveTerminals:true});expect(handoff).toHaveBeenCalledOnce();
});
it('authenticates and pins reversible drain without changing target policy or office settings',async()=>{
  const {request,swarm,delivery,url}=await office();const settings=swarm.snapshot().settings,policy=delivery.view().policy;
  expect((await fetch(url+'/api/office/drain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedPid:process.pid,draining:true})})).status).toBe(401);
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid+1,draining:true})).status).toBe(409);
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:'yes'})).status).toBe(400);
  await expect(fs.access(path.join(HOME_DIR,'maintenance.json'))).rejects.toThrow();
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:true})).status).toBe(200);
  expect(await (await request('/api/runtime')).json()).toMatchObject({draining:true});
  expect(JSON.parse(await fs.readFile(path.join(HOME_DIR,'maintenance.json'),'utf8'))).toEqual({version:1,draining:true});
  expect((await request('/api/repos/synthetic%2Frepo/delivery/run','POST',{})).status).toBe(409);
  expect(swarm.isDraining).toBe(true);expect(delivery.isDraining).toBe(true);expect(swarm.snapshot().settings).toEqual(settings);expect(delivery.view().policy).toEqual(policy);
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:false})).status).toBe(200);expect(swarm.isDraining).toBe(false);expect(delivery.isDraining).toBe(false);
  expect(JSON.parse(await fs.readFile(path.join(HOME_DIR,'maintenance.json'),'utf8')).draining).toBe(false);
});

it('restores maintenance before office admission and fails a resume when storage is unavailable',async()=>{
  await fs.writeFile(path.join(HOME_DIR,'maintenance.json'),JSON.stringify({version:1,draining:true}));
  const {request,swarm,delivery,maintenance}=await office();
  expect(await (await request('/api/runtime')).json()).toMatchObject({draining:true});expect(swarm.isDraining).toBe(true);expect(delivery.isDraining).toBe(true);
  vi.spyOn(maintenance,'change').mockRejectedValueOnce(new Error('synthetic storage failure'));
  expect((await request('/api/office/drain','POST',{expectedPid:process.pid,draining:false})).status).toBe(500);
  expect(swarm.isDraining).toBe(true);expect(delivery.isDraining).toBe(true);expect(JSON.parse(await fs.readFile(path.join(HOME_DIR,'maintenance.json'),'utf8')).draining).toBe(true);
});
