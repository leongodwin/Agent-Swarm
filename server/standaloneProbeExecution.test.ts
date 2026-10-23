import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {executeStandaloneProbe} from './standaloneProbeExecution.ts';
import {standaloneProbeFixturePlan} from './testFixtures/standaloneProbe.ts';
import {buildStandaloneMetadataProbe} from './standaloneMetadataProbe.ts';
const quarantine=vi.hoisted(()=>vi.fn());
vi.mock('./standaloneProbeQuarantine.ts',()=>({verifyStandaloneQuarantine:(...args:any[])=>quarantine(...args)}));
it('refuses a broken original quarantine before acquiring any replacement lease or native session',async()=>{
 const f=await fixture();quarantine.mockRejectedValue(Error('Original quarantine changed'));
 await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('Original quarantine changed');expect(f.deps.connect).not.toHaveBeenCalled();expect(f.deps.prepareStandaloneResources).not.toHaveBeenCalled();await expect(fs.stat(f.deps.leaseRoot)).rejects.toMatchObject({code:'ENOENT'});
});
it('preserves an existing original lease while using a separate replacement journal and releasing only its own lease',async()=>{
 const f=await fixture();await fs.mkdir(f.deps.leaseRoot);const oldResource='connector-probe:'+crypto.createHash('sha256').update(JSON.stringify({tenant:f.plan.identity.tenantId,environment:f.plan.identity.environmentId,repo:'synthetic/repo',record:f.plan.record.id})).digest('hex'),oldFile=path.join(f.deps.leaseRoot,crypto.createHash('sha256').update(oldResource).digest('hex')+'.json'),bytes='SYNTHETIC ORIGINAL HOLD - never read or rewrite';await fs.writeFile(oldFile,bytes);
 await executeStandaloneProbe('a'.repeat(64),f.deps);expect(await fs.readFile(oldFile,'utf8')).toBe(bytes);expect(await fs.readdir(f.deps.leaseRoot)).toEqual([path.basename(oldFile)]);expect(await fs.readdir(path.join(f.home,'planning','standalone-probe-executions'))).toHaveLength(1);
});
it('does not re-arm replacement creation when a later record/proposal is supplied after unknown trigger outcome',async()=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;f.call.mockImplementation(async(t,a)=>{if(t==='run_flow')throw Error('Unknown provider outcome');return original(t,a);});
 await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');const before=f.call.mock.calls.length;f.plan.record.revision++;f.plan.record.sha256='e'.repeat(64);f.plan.historyPolicy.recordSha256=f.plan.record.sha256;
 await expect(executeStandaloneProbe('b'.repeat(64),f.deps)).rejects.toThrow();expect(f.call.mock.calls).toHaveLength(before);expect(f.deps.prepareStandaloneResources).toHaveBeenCalledOnce();
});
it('refuses any returned identity overlapping the original resources before activation or trigger',async()=>{
 const f=await fixture();f.resources.flowId=f.plan.quarantine.flowId;await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.call.mock.calls.some(([t])=>t==='publish_flow'||t==='run_flow')).toBe(false);
});
it('retains bounded original context and both native outputs when context validation fails',async()=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;f.call.mockImplementation(async(t,a)=>t==='get_run_action_content'&&a.action==='Probe_context'?{action:'Probe_context',which:'outputs',content:{unexpectedNativeShape:true}}:original(t,a));
 await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');const files=await fs.readdir(f.leaf);expect(files).toHaveLength(5);expect(JSON.parse(await fs.readFile(path.join(f.leaf,f.plan.probeId+'.context.json'),'utf8')).content).toEqual({unexpectedNativeShape:true});expect(f.call.mock.calls.filter(([t])=>t==='disable_flow')).toHaveLength(1);
});
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('as-standalone-execution-'))throw Error('Unexpected test root');await fs.rm(root,{recursive:true,force:true});}vi.restoreAllMocks();});
async function fixture(){
 quarantine.mockReset().mockResolvedValue({originalHoldPreserved:true,providerMembershipSettlementVerified:false,replayAuthorized:false,tenantAuthorityGranted:false});
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'as-standalone-execution-'));roots.push(home);const plan=standaloneProbeFixturePlan(),leaf=path.join(home,'recruitment-e2e-'+plan.record.id);await fs.mkdir(leaf);const built=buildStandaloneMetadataProbe(plan),resources={flowId:'22222222-2222-4222-8222-222222222222',workflowId:'33333333-3333-4333-8333-333333333333'};let state='Stopped',nonce='';
 const call=vi.fn(async(tool:string,args:any):Promise<any>=>{
  if(tool==='whoami')return{azIdentity:{tenantId:plan.identity.tenantId,user:plan.identity.username},tokenIdentity:{tenantId:plan.identity.tenantId,username:plan.identity.username},effectiveConnectivityIdentity:{tenantId:plan.identity.tenantId,username:plan.identity.username},identityMismatch:false,connectivityIdentityMismatch:false};
  if(tool==='list_connections')return[{name:plan.connection.connectionId,connector:'/providers/Microsoft.PowerApps/apis/shared_office365',accountName:plan.identity.username,status:'Connected',statuses:[{status:'Connected'}]}];
  if(tool==='get_flow'){if(args.path==='properties')return{definition:built.definition,connectionReferences:built.connectionRefs,state};if(args.path==='properties.definition')return built.definition;if(args.path==='properties.connectionReferences')return built.connectionRefs;if(args.path==='properties.state')return state;}
  if(tool==='preflight_flow'){expect(Object.keys(args).sort()).toEqual(['connectionReferences','definition','env']);return{overall:'ready'};}
  if(tool==='publish_flow'){state='Started';return{};}
  if(tool==='disable_flow'){state='Stopped';return{};}
  if(tool==='run_flow'){nonce=args.body.correlationId;return{triggered:true,runId:'original-run',status:'Failed',startTime:new Date().toISOString(),endTime:new Date().toISOString()};}
  if(tool==='get_run_actions')return[{name:'Metadata_http',status:'Succeeded'},{name:'Missing_folder_http',status:'Failed'}];
  if(tool==='get_run_action_content')return{action:args.action,which:'outputs',content:args.action==='Probe_context'?{kind:plan.kind,probeId:plan.probeId,correlationId:nonce}:{syntheticNativeWrapper:true}};
  throw Error('Unexpected tool');
 });
 const flow={metadata:plan.adapter,call,close:vi.fn(async()=>{})},authority=vi.fn(async()=>({proposal:{plan,repoId:'synthetic/repo'}} as any)),guard=vi.fn(),deps={home,leaseRoot:path.join(home,'leases'),releaseStartedAt:Date.now(),authority,privateLeaf:vi.fn(async()=>leaf),verifyStandaloneResources:vi.fn(async(_p:any,flowId:string,admit:()=>Promise<void>)=>{await admit();return{flowId,context:'synthetic-non-solution-observation'};}),prepareStandaloneResources:vi.fn(async(_p:any,admit:any,journal:any)=>{await admit();await journal('synthetic-setup',{...resources});return resources;}),connect:vi.fn(async(_plan:unknown,_signal:AbortSignal,admit:()=>Promise<void>)=>{await admit();await admit();return flow;}),guard};
 return{home,plan,leaf,built,resources,call,flow,deps};
}
it('captures original bounded synthetic outputs, stops the same flow and grants no semantic/business credit',async()=>{const f=await fixture(),r=await executeStandaloneProbe('a'.repeat(64),f.deps);expect(r).toMatchObject({flowId:f.resources.flowId,runId:'original-run',nativeSemanticsAccepted:false,businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false});expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(1);expect(f.call.mock.calls.filter(([t])=>t==='disable_flow')).toHaveLength(1);expect(await fs.readdir(f.deps.leaseRoot)).toEqual([]);expect((await fs.readdir(f.leaf)).sort()).toHaveLength(5);expect(f.flow.close).toHaveBeenCalledOnce();await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(1);});
it.each(['trigger','capture','activation','definition','adapter','context','close'])('holds the original intent without a second trigger after %s failure',async mode=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;
 if(mode==='adapter')(f.flow as any).metadata={...f.plan.adapter,version:'changed'};
 if(mode==='close')f.flow.close.mockRejectedValue(Error('Unknown cleanup'));
 f.call.mockImplementation(async(t,a)=>{if(mode==='trigger'&&t==='run_flow')throw Error('Lost response');if(mode==='capture'&&t==='get_run_action_content'&&a.action==='Metadata_http')return{content:'x'.repeat(256001)};if(mode==='activation'&&t==='get_flow'&&a.path==='properties')return{definition:f.built.definition,connectionReferences:f.built.connectionRefs,state:'Unknown'};if(mode==='definition'&&t==='get_flow'&&a.path==='properties')return{definition:{},connectionReferences:f.built.connectionRefs,state:'Stopped'};if(mode==='context'&&t==='get_run_action_content'&&a.action==='Probe_context')return{action:'Probe_context',which:'outputs',content:{kind:f.plan.kind,probeId:f.plan.probeId,correlationId:'wrong'}};return original(t,a);});
 await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow();const before=f.call.mock.calls.filter(([t])=>t==='run_flow').length;expect(before).toBeLessThanOrEqual(1);expect((await fs.readdir(f.deps.leaseRoot)).some(n=>n.endsWith('.json'))).toBe(true);await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(before);
});
it('refuses missing independent authority before connecting or setup',async()=>{const f=await fixture();f.deps.authority.mockRejectedValue(Error('Unapproved'));await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('Unapproved');expect(f.deps.connect).not.toHaveBeenCalled();expect(f.deps.prepareStandaloneResources).not.toHaveBeenCalled();});
it('refuses a changed protected leaf before tenant setup',async()=>{const f=await fixture();f.deps.privateLeaf.mockResolvedValue(f.home);await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.deps.connect).not.toHaveBeenCalled();});
it('refuses expired release and revoked guards before tenant work',async()=>{const f=await fixture();f.deps.releaseStartedAt=Date.now()-3600001;await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.deps.connect).not.toHaveBeenCalled();});
it('counts management setup calls within the fixed call cap',async()=>{const f=await fixture();f.deps.prepareStandaloneResources.mockImplementation(async(_p,admit)=>{for(let i=0;i<65;i++)await admit();return f.resources;});await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(0);});
it.each(['activation-state','disable-state','final-state','invalid-stage','missing-adapter'])('holds ownership for %s',async mode=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;
 if(mode==='missing-adapter')delete (f.flow as any).metadata;
 if(mode==='invalid-stage')f.deps.prepareStandaloneResources.mockImplementation(async(_p,_admit,journal)=>{await journal('../unsafe',{});return f.resources;});
 f.call.mockImplementation(async(t,a)=>{const result=await original(t,a);if(t==='get_flow'&&a.path==='properties'){const seen=(tool:string)=>f.call.mock.calls.some(([called])=>called===tool),final=f.call.mock.calls.some(([called,args])=>called==='get_run_action_content'&&args.action==='Missing_folder_http');if(mode==='activation-state'&&seen('publish_flow')&&!seen('run_flow')||mode==='disable-state'&&seen('disable_flow')&&!final||mode==='final-state'&&final)return{...result,state:'Unknown'};}return result;});
 await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect((await fs.readdir(f.deps.leaseRoot)).some(n=>n.endsWith('.json'))).toBe(true);expect(f.call.mock.calls.filter(([t])=>t==='run_flow').length).toBeLessThanOrEqual(1);
});
it.each(['missing','duplicate','wrong-account','disconnected','saturated'])('refuses %s current Outlook connection before setup',async mode=>{const f=await fixture(),original=f.call.getMockImplementation()!;f.call.mockImplementation(async(t,a)=>{const result=await original(t,a);if(t!=='list_connections')return result;if(mode==='missing')return[];if(mode==='duplicate')return[result[0],result[0]];if(mode==='wrong-account')result[0].accountName='other@example.test';if(mode==='disconnected')result[0].status='Error';if(mode==='saturated')return Array(1000).fill(result[0]);return result;});await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.deps.prepareStandaloneResources).not.toHaveBeenCalled();expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(0);});
it.each(['known','unknown','invalid'])('retains bounded failure accounting without private diagnostics for %s provider code',async mode=>{const f=await fixture();const {PlatformCommandError}=await import('./platformCommandError.ts');f.deps.prepareStandaloneResources.mockImplementation(async(_p,admit)=>{await admit();throw new PlatformCommandError('PRIVATE response body must never be retained',mode==='known'?'0x80040216':mode==='invalid'?'PRIVATE INVALID ERROR CODE':undefined);});await expect(executeStandaloneProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');const dirs=await fs.readdir(path.join(f.home,'planning','standalone-probe-executions'));const raw=await fs.readFile(path.join(f.home,'planning','standalone-probe-executions',dirs[0],'held.json'),'utf8'),held=JSON.parse(raw);expect(held).toMatchObject({admissionAttempts:5,admittedCalls:5,providerErrorCode:mode==='known'?'0x80040216':null,nativeOutcomeAccepted:false,holdPreserved:true,replayAuthorized:false});expect(raw).not.toContain('PRIVATE');expect(await fs.readdir(f.deps.leaseRoot)).toHaveLength(1);expect(f.call.mock.calls.some(([t])=>t==='run_flow')).toBe(false);});
