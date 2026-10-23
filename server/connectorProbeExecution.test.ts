import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {executeConnectorProbe} from './connectorProbeExecution.ts';
import {connectorProbeFixturePlan} from './testFixtures/connectorProbe.ts';
import {buildConnectorMetadataProbe} from './connectorMetadataProbe.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)){if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('as-probe-execution-'))throw Error('Unexpected test root');await fs.rm(root,{recursive:true,force:true});}vi.restoreAllMocks();});
async function fixture(){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'as-probe-execution-'));roots.push(home);const plan=connectorProbeFixturePlan(),leaf=path.join(home,'recruitment-e2e-'+plan.record.id);await fs.mkdir(leaf);const built=buildConnectorMetadataProbe(plan),resources={flowId:'22222222-2222-4222-8222-222222222222',workflowId:'33333333-3333-4333-8333-333333333333',solutionId:'44444444-4444-4444-8444-444444444444'};let state='Stopped',nonce='';
 const call=vi.fn(async(tool:string,args:any):Promise<any>=>{
  if(tool==='whoami')return{azIdentity:{tenantId:plan.identity.tenantId,user:plan.identity.username},tokenIdentity:{tenantId:plan.identity.tenantId,username:plan.identity.username},effectiveConnectivityIdentity:{tenantId:plan.identity.tenantId,username:plan.identity.username},identityMismatch:false,connectivityIdentityMismatch:false};
  if(tool==='get_flow'){if(args.path==='properties.definition')return built.definition;if(args.path==='properties.connectionReferences')return built.connectionRefs;if(args.path==='properties.state')return state;}
  if(tool==='preflight_flow')return{overall:'ready'};
  if(tool==='publish_flow'){state='Started';return{};}
  if(tool==='disable_flow'){state='Stopped';return{};}
  if(tool==='run_flow'){nonce=args.body.correlationId;return{triggered:true,runId:'original-run',status:'Failed',startTime:new Date().toISOString(),endTime:new Date().toISOString()};}
  if(tool==='get_run_actions')return[{name:'Metadata_http',status:'Succeeded'},{name:'Missing_folder_http',status:'Failed'}];
  if(tool==='get_run_action_content')return{action:args.action,which:'outputs',content:args.action==='Probe_context'?{kind:plan.kind,probeId:plan.probeId,correlationId:nonce}:{syntheticNativeWrapper:true}};
  throw Error('Unexpected tool');
 });
 const flow={metadata:plan.adapter,call,close:vi.fn(async()=>{})},authority=vi.fn(async()=>({proposal:{plan,repoId:'synthetic/repo'}} as any)),guard=vi.fn(),deps={home,leaseRoot:path.join(home,'leases'),releaseStartedAt:Date.now(),authority,privateLeaf:vi.fn(async()=>leaf),prepareSameResources:vi.fn(async(_p:any,admit:any,journal:any)=>{await admit();await journal('synthetic-setup',{...resources});return resources;}),connect:vi.fn(async()=>flow),guard};
 return{home,plan,leaf,built,resources,call,flow,deps};
}
it('captures original bounded synthetic outputs, stops the same flow and grants no semantic/business credit',async()=>{const f=await fixture(),r=await executeConnectorProbe('a'.repeat(64),f.deps);expect(r).toMatchObject({flowId:f.resources.flowId,runId:'original-run',nativeSemanticsAccepted:false,businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false});expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(1);expect(f.call.mock.calls.filter(([t])=>t==='disable_flow')).toHaveLength(1);expect(await fs.readdir(f.deps.leaseRoot)).toEqual([]);expect((await fs.readdir(f.leaf)).sort()).toHaveLength(5);expect(f.flow.close).toHaveBeenCalledOnce();await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(1);});
it.each(['trigger','capture','activation','definition','adapter','context','close'])('holds the original intent without a second trigger after %s failure',async mode=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;
 if(mode==='adapter')f.flow.metadata={...f.plan.adapter,version:'changed'};
 if(mode==='close')f.flow.close.mockRejectedValue(Error('Unknown cleanup'));
 f.call.mockImplementation(async(t,a)=>{if(mode==='trigger'&&t==='run_flow')throw Error('Lost response');if(mode==='capture'&&t==='get_run_action_content'&&a.action==='Metadata_http')return{content:'x'.repeat(256001)};if(mode==='activation'&&t==='get_flow'&&a.path==='properties.state')return'Unknown';if(mode==='definition'&&t==='get_flow'&&a.path==='properties.definition')return{};if(mode==='context'&&t==='get_run_action_content'&&a.action==='Probe_context')return{action:'Probe_context',which:'outputs',content:{kind:f.plan.kind,probeId:f.plan.probeId,correlationId:'wrong'}};return original(t,a);});
 await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow();const before=f.call.mock.calls.filter(([t])=>t==='run_flow').length;expect(before).toBeLessThanOrEqual(1);expect((await fs.readdir(f.deps.leaseRoot)).some(n=>n.endsWith('.json'))).toBe(true);await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(before);
});
it('refuses missing independent authority before connecting or setup',async()=>{const f=await fixture();f.deps.authority.mockRejectedValue(Error('Unapproved'));await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow('Unapproved');expect(f.deps.connect).not.toHaveBeenCalled();expect(f.deps.prepareSameResources).not.toHaveBeenCalled();});
it('refuses a changed protected leaf before tenant setup',async()=>{const f=await fixture();f.deps.privateLeaf.mockResolvedValue(f.home);await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.deps.connect).not.toHaveBeenCalled();});
it('refuses expired release and revoked guards before tenant work',async()=>{const f=await fixture();f.deps.releaseStartedAt=Date.now()-3600001;await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow();expect(f.deps.connect).not.toHaveBeenCalled();});
it('counts management setup calls within the fixed call cap',async()=>{const f=await fixture();f.deps.prepareSameResources.mockImplementation(async(_p,admit)=>{for(let i=0;i<65;i++)await admit();return f.resources;});await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect(f.call.mock.calls.filter(([t])=>t==='run_flow')).toHaveLength(0);});
it.each(['activation-state','disable-state','final-state','invalid-stage','missing-adapter'])('holds ownership for %s',async mode=>{
 const f=await fixture(),original=f.call.getMockImplementation()!;let states=0;
 if(mode==='missing-adapter')delete (f.flow as any).metadata;
 if(mode==='invalid-stage')f.deps.prepareSameResources.mockImplementation(async(_p,_admit,journal)=>{await journal('../unsafe',{});return f.resources;});
 f.call.mockImplementation(async(t,a)=>{if(t==='get_flow'&&a.path==='properties.state'){states++;if(mode==='activation-state'&&states===2||mode==='disable-state'&&states===3||mode==='final-state'&&states===4)return'Unknown';}return original(t,a);});
 await expect(executeConnectorProbe('a'.repeat(64),f.deps)).rejects.toThrow('held');expect((await fs.readdir(f.deps.leaseRoot)).some(n=>n.endsWith('.json'))).toBe(true);expect(f.call.mock.calls.filter(([t])=>t==='run_flow').length).toBeLessThanOrEqual(1);
});
