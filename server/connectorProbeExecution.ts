import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {FlowAdapter} from './flowAdapter.ts';
import {verifyFlowIdentity} from './platformAuth.ts';
import {buildConnectorMetadataProbe,assertConnectorProbeReadback,connectorProbeDigest,type ConnectorProbePlan} from './connectorMetadataProbe.ts';
import type {ConnectorProbeReview} from './connectorProbeReview.ts';
import {acquireResourceLease} from './resourceLease.ts';

type Grant=Awaited<ReturnType<ConnectorProbeReview['authority']>>;
export interface ConnectorProbeExecutionDependencies {
 home:string;leaseRoot:string;releaseStartedAt:number;
 authority(expected:string):Promise<Grant>;
 /** Must independently re-admit the existing Windows ACL/path; never repair it. */
 privateLeaf(plan:ConnectorProbePlan,admit:()=>Promise<void>):Promise<string>;
 /** Fixed production management implementation only, never caller-selected code.
  * It must account each provider call through admit, retain each creation intent
  * before dispatch, and verify exact returned ownership/solution/reference IDs. */
 prepareSameResources(plan:ConnectorProbePlan,admit:()=>Promise<void>,journal:(stage:string,metadata:Record<string,unknown>)=>Promise<void>):Promise<{flowId:string;workflowId:string;solutionId:string}>;
 connect(plan:ConnectorProbePlan,signal:AbortSignal):Promise<FlowAdapter>;
 guard():void;
}
const id=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const runId=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
async function exclusive(file:string,value:unknown){const fd=await fs.open(file,'wx',0o600);try{await fd.writeFile(JSON.stringify(value));await fd.sync();}finally{await fd.close();}}

/** One-shot protocol engine behind normal host exact independent admission.
 * Any failure leaves its original exclusive intent and lease held, including
 * pre-trigger failures. No cancellation, retry, reset or replay is performed. */
export async function executeConnectorProbe(expected:string,deps:ConnectorProbeExecutionDependencies){
 const started=Date.now(),deadline=Math.min(started+120000,deps.releaseStartedAt+3600000),signal=AbortSignal.timeout(Math.max(1,deadline-started));let calls=0,flow:FlowAdapter|undefined,sequence=0,closed=false;
 const check=(newWork=false)=>{signal.throwIfAborted();deps.guard();if(!Number.isFinite(deps.releaseStartedAt)||deps.releaseStartedAt>started||Date.now()>=deadline||newWork&&Date.now()-started>=90000)throw Error('Connector probe deadline reached');};
 check();const initial=await deps.authority(expected),plan=initial.proposal.plan;
 const scope=connectorProbeDigest({tenant:plan.identity.tenantId,environment:plan.identity.environmentId,repo:initial.proposal.repoId,record:plan.record.id});
 const lease=await acquireResourceLease(deps.leaseRoot,'connector-probe:'+scope,expected,{reclaimDeadOwner:false});
 const owned=async()=>{check();await lease.assertOwned();await deps.authority(expected);check();};
 const root=path.join(deps.home,'planning','connector-probe-executions',scope);await fs.mkdir(root,{recursive:true});
 const intent=path.join(root,'intent.json');await exclusive(intent,{schemaVersion:1,proposalSha256:expected,record:plan.record,probeId:plan.probeId,startedAt:new Date(started).toISOString(),releaseStartedAt:new Date(deps.releaseStartedAt).toISOString(),pid:process.pid,businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false});
 const journal=async(stage:string,metadata:Record<string,unknown>)=>{await owned();if(!/^[a-z][a-z0-9-]{1,60}$/.test(stage))throw Error('Invalid probe journal stage');await exclusive(path.join(root,String(sequence++).padStart(3,'0')+'-'+stage+'.json'),{stage,observedAt:new Date().toISOString(),proposalSha256:expected,...metadata});};
 const admit=async()=>{check(true);await owned();if(++calls>64)throw Error('Connector probe call limit reached');};
 const privateLeaf=async()=>{await owned();const leaf=await deps.privateLeaf(plan,admit);await owned();if(path.basename(leaf)!=='recruitment-e2e-'+plan.record.id||await fs.realpath(leaf)!==path.resolve(leaf)||(await fs.lstat(leaf)).isSymbolicLink())throw Error('Protected probe leaf changed');return leaf;};
 const capture=async(name:string,value:unknown)=>{const text=JSON.stringify(value);if(Buffer.byteLength(text)>256000)throw Error('Probe native output exceeds capture bound');const leaf=await privateLeaf();await exclusive(path.join(leaf,plan.probeId+'.'+name+'.json'),value);if(await privateLeaf()!==leaf)throw Error('Protected probe leaf changed');return crypto.createHash('sha256').update(text).digest('hex');};
 try{
  await privateLeaf();await admit();flow=await deps.connect(plan,signal);await owned();if(!flow.metadata||connectorProbeDigest(flow.metadata)!==connectorProbeDigest(plan.adapter))throw Error('Probe adapter differs');
  const call=async(tool:string,args:Record<string,unknown>)=>{await admit();const result=await flow!.call(tool,args);await owned();return result;};
  verifyFlowIdentity(await call('whoami',{}),plan.identity);
  const connectionRows=z.array(z.record(z.string(),z.unknown())).max(999).parse(await call('list_connections',{env:plan.identity.environmentId,connector:'shared_office365'})),matches=connectionRows.filter(row=>row.name===plan.connection.connectionId);
  if(matches.length!==1)throw Error('Exact current Outlook connection required');
  const connection=z.object({name:z.literal(plan.connection.connectionId),connector:z.literal('/providers/Microsoft.PowerApps/apis/shared_office365'),accountName:z.string(),status:z.literal('Connected'),statuses:z.array(z.object({status:z.literal('Connected')})).min(1).max(10).optional()}).parse(matches[0]);
  if(connection.accountName.toLowerCase()!==plan.identity.username.toLowerCase())throw Error('Current Outlook account differs');
  const resources=z.strictObject({flowId:id,workflowId:id,solutionId:id}).parse(await deps.prepareSameResources(plan,admit,journal));
  const args={env:plan.identity.environmentId,flow:resources.flowId};
  const pinned=async()=>{const definition=z.record(z.string(),z.unknown()).parse(await call('get_flow',{...args,path:'properties.definition'})),refs=await call('get_flow',{...args,path:'properties.connectionReferences'});return assertConnectorProbeReadback(plan,definition,refs);};
  await pinned();if(await call('get_flow',{...args,path:'properties.state'})!=='Stopped')throw Error('Probe must initially be stopped');
  const built=buildConnectorMetadataProbe(plan),preflight=z.object({overall:z.literal('ready')}).parse(await call('preflight_flow',{env:plan.identity.environmentId,definition:built.definition,connectionReferences:built.connectionRefs}));
  await journal('activation-intent',{...resources,definitionSha256:built.definitionSha256,preflightSha256:connectorProbeDigest(preflight)});
  await call('publish_flow',args);if(await call('get_flow',{...args,path:'properties.state'})!=='Started')throw Error('Probe activation unknown');await pinned();
  const nonce=crypto.randomUUID();await journal('trigger-intent',{...resources,correlationId:nonce});
  const invoked=await call('run_flow',{...args,body:{kind:plan.kind,correlationId:nonce},triggerName:'manual',wait:true,timeout:30});
  const result=z.object({triggered:z.literal(true),runId,status:z.enum(['Succeeded','Failed','TimedOut','Cancelled']),startTime:z.string().min(1),endTime:z.string().min(1)}).parse(invoked);
  await journal('terminal-run',{...resources,runId:result.runId,providerResultSha256:connectorProbeDigest(invoked)});
  // A known terminal run can be disabled without cancelling an active run.
  // Restore the exact manual flow before later capture can fail or time out.
  await pinned();await journal('disable-intent',{...resources,runId:result.runId});await call('disable_flow',args);if(await call('get_flow',{...args,path:'properties.state'})!=='Stopped')throw Error('Probe stopped-state cleanup unknown');await pinned();
  await capture('run',invoked);
  const runArgs={...args,run:result.runId};
  const actions=await call('get_run_actions',{...runArgs,includeSizes:true});const actionSha256=await capture('actions',actions);
  const context=await call('get_run_action_content',{...runArgs,action:'Probe_context',which:'outputs',maxBytes:256000});
  const parsed=z.object({action:z.literal('Probe_context'),which:z.literal('outputs'),content:z.object({kind:z.literal(plan.kind),probeId:z.literal(plan.probeId),correlationId:z.literal(nonce)})}).parse(context);await capture('context',parsed);
  // Preserve original native shapes, including errors and unknown wrappers.
  // Their semantic acceptance belongs a subsequent independent evidence review.
  const positive=await call('get_run_action_content',{...runArgs,action:'Metadata_http',which:'outputs',maxBytes:256000});const positiveSha256=await capture('folder-output',positive);
  const negative=await call('get_run_action_content',{...runArgs,action:'Missing_folder_http',which:'outputs',maxBytes:256000});const negativeSha256=await capture('invalid-folder-output',negative);
  await pinned();if(await call('get_flow',{...args,path:'properties.state'})!=='Stopped')throw Error('Probe state changed during capture');
  await flow.close();closed=true;await owned();
  const receipt={schemaVersion:1,proposalSha256:expected,...resources,runId:result.runId,actionSha256,positiveSha256,negativeSha256,calls,completedAt:new Date().toISOString(),nativeSemanticsAccepted:false,businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false};
  await journal('completed',receipt);await lease.release();return receipt;
 }catch{throw Error('Connector probe held; preserve original intent, evidence and ownership without replay');}
 finally{if(flow&&!closed)await flow.close();}
}
