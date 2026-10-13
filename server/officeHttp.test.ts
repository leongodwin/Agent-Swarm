import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
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

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const name of await fs.readdir(HOME_DIR)) await fs.rm(path.join(HOME_DIR, name), { recursive: true, force: true });
  vi.restoreAllMocks();
});
afterAll(async () => fs.rm(HOME_DIR, { recursive: true, force: true }));
const tenantId='11111111-1111-4111-8111-111111111111';
const environment='https://synthetic.crm4.dynamics.com';
async function office(withEvidence=false) {
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
  const swarm=new Swarm(external as unknown as Backend);cleanup.push(()=>swarm.shutdown());await swarm.init();
  const features=new FeatureStore(path.join(HOME_DIR,'features.json'),false);await features.init();
  const capabilities=new CapabilityService(HOME_DIR,false,async()=>{throw new Error('Synthetic provider unavailable');});await capabilities.init();cleanup.push(()=>capabilities.close());
  if(withEvidence){
    const root=path.join(HOME_DIR,'delivery-runs','synthetic-run','evidence');await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'proof.txt'),'synthetic evidence bytes');
    await fs.writeFile(path.join(HOME_DIR,'delivery.json'),JSON.stringify({policy:null,releases:[],blockers:[],revision:0,runs:[{id:'synthetic-run',repoId:'synthetic/repo',head:'synthetic-commit',environmentUrl:environment,phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:['proof.txt','../outside.txt'],log:[]}]}));
  }
  const delivery=new DeliveryService(HOME_DIR,false);await delivery.init();cleanup.push(()=>delivery.close());
  const toolGovernance=new ToolGovernanceService(path.join(HOME_DIR,'governance'),()=>true);await toolGovernance.init();
  const reader=vi.fn<StartPolicyReader>(()=>({pid:123,refresh(){},stop(){}}));
  const tenantDlp=new TenantDlpService(path.join(HOME_DIR,'governance'),reader);await tenantDlp.init();cleanup.push(()=>tenantDlp.close());
  const canvasOwnership=new CanvasOwnership(path.join(HOME_DIR,'leases'));cleanup.push(()=>canvasOwnership.close());
  const {app,closeAdmission}=createOfficeHttpApp({backend:external as unknown as Backend,swarm,features,capabilities,delivery,toolGovernance,tenantDlp,canvasOwnership,homeDir:HOME_DIR,runtimeStartedAt:new Date().toISOString(),policyReaderMode:'launcher'});
  const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session=await fetch(`${url}/api/session`);const cookie=session.headers.get('set-cookie')!.split(';')[0];
  const request=(resource:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+resource,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {url,cookie,request,swarm,external,tenancy,delivery,features,capabilities,reader,closeAdmission};
}

it('uses the production session boundary and reports actual initialized services',async()=>{
  const {request,url,external}=await office();
  expect((await fetch(url+'/api/state')).status).toBe(401);
  expect((await request('/api/state','GET',undefined,{Origin:'https://foreign.example'})).status).toBe(403);
  expect((await request('/api/state')).status).toBe(200);
  expect(await (await request('/api/runtime')).json()).toMatchObject({demo:false,policyReaderMode:'launcher'});
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
  expect((await request('/api/delivery/runs/synthetic-run/evidence?file=../outside.txt')).status).toBe(500);
});
