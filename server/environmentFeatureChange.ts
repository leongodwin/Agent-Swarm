import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {acquireResourceLease} from './resourceLease.ts';

// Provider IDs include legacy/sequential GUIDs without RFC UUID version bits,
// matching targetOperations.dataverseGuid and platformIdentitySchema.
export const environmentFeatureGuidSchema=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i).transform(value=>value.toLowerCase());
const guid=environmentFeatureGuidSchema,uuid=z.uuid().transform(value=>value.toLowerCase()),hash=z.string().regex(/^[a-f0-9]{64}$/),owner=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const origin=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&/^[-a-z0-9]+\.crm[0-9]*\.dynamics\.com$/.test(u.hostname);},'Exact commercial Dataverse origin required').transform(value=>new URL(value).origin+'/');
export const environmentFeaturePlanSchema=z.strictObject({
 schemaVersion:z.literal(1),kind:z.literal('disable-default-solution-flows'),
 record:z.strictObject({id:uuid,revision:z.number().int().positive(),sha256:hash}),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),configurationSha256:hash,implementationSha256:hash,
 owner,qaOwner:owner,target:z.strictObject({tenantId:uuid,environmentId:guid,organizationId:guid,userId:guid,aadObjectId:uuid,username:z.email(),environmentUrl:origin}),
 field:z.literal('enableflowsinsolutionbydefault'),value:z.literal(false),
}).refine(value=>value.owner!==value.qaOwner,'Independent QA required');
export type EnvironmentFeaturePlan=z.infer<typeof environmentFeaturePlanSchema>;
const grantSchema=z.strictObject({plan:environmentFeaturePlanSchema,proposalSha256:hash,reviewer:owner,decision:z.literal('approved'),reviewedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),settingChangeAllowed:z.literal(true),businessAuthorityGranted:z.literal(false),flowMutationAllowed:z.literal(false)});
export type EnvironmentFeatureGrant=z.infer<typeof grantSchema>;
const etag=z.string().regex(/^(?:W\/)?"[\x21\x23-\x7E]{1,256}"$/);
const rowSchema=z.strictObject({organizationId:guid,value:z.boolean(),etag});
const preflightSchema=z.strictObject({tenantId:guid,environmentId:guid,organizationId:guid,userId:guid,aadObjectId:guid,username:z.email(),environmentUrl:origin,attributeUpdateable:z.literal(true),optimisticConcurrency:z.literal(true),canUpdateOrganization:z.literal(true),row:rowSchema});
const responseSchema=z.strictObject({status:z.number().int().min(100).max(599),requestId:guid.optional()});
export type EnvironmentFeaturePreflight=z.infer<typeof preflightSchema>;
export const environmentFeatureDigest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface EnvironmentFeatureChangeDependencies {
 home:string;leaseRoot:string;releaseStartedAt:number;guard():void;
 /** Production composition must bind current source/config/record/policy and the
  * assigned independent review. This engine is not an HTTP execution endpoint. */
 authority(expected:string):Promise<EnvironmentFeatureGrant>;
 preflight(plan:EnvironmentFeaturePlan,signal:AbortSignal,admit:()=>Promise<void>):Promise<EnvironmentFeaturePreflight>;
 /** Each method below is exactly one native request, without redirect/retry. */
 patch(plan:EnvironmentFeaturePlan,request:{path:string;body:{enableflowsinsolutionbydefault:false};ifMatch:string},signal:AbortSignal):Promise<z.infer<typeof responseSchema>>;
 read(plan:EnvironmentFeaturePlan,signal:AbortSignal):Promise<z.infer<typeof rowSchema>>;
}
async function exclusive(file:string,value:unknown){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}

/** Internal one-shot administrative engine. No native client, public route or
 * review authority is supplied here. A future reviewed normal-host composition
 * is required; merely importing this module grants no tenant capability.
 *
 * The stable claim excludes discovery revisions/proposals. Neither a changed
 * name nor a new review can rearm an attempted operation. Every post-claim error
 * preserves its intent and non-reclaiming lease, including acknowledged writes
 * whose state readback fails. No flow operation or restoration is exposed. */
export async function executeEnvironmentFeatureChange(expected:string,deps:EnvironmentFeatureChangeDependencies){
 hash.parse(expected);const wallStarted=Date.now(),monoStarted=performance.now(),deadline=Math.min(wallStarted+120000,deps.releaseStartedAt+3600000);
 if(!Number.isFinite(deps.releaseStartedAt)||deps.releaseStartedAt>wallStarted||deadline<=wallStarted)throw Error('Administrative operation deadline unavailable');
 const signal=AbortSignal.timeout(Math.max(1,deadline-wallStarted));let calls=0,sequence=0;
 const check=(newWork=false)=>{signal.throwIfAborted();deps.guard();const elapsed=performance.now()-monoStarted;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=deadline-wallStarted||Date.now()>=deadline||newWork&&elapsed>=90000)throw Error('Administrative operation deadline reached');};
 const verifyGrant=(raw:unknown)=>{const grant=grantSchema.parse(raw),now=Date.now();if(grant.proposalSha256!==expected||environmentFeatureDigest(grant.plan)!==expected||grant.reviewer!==grant.plan.qaOwner||Date.parse(grant.reviewedAt)>now+60000||Date.parse(grant.expiresAt)<=now||Date.parse(grant.expiresAt)<=Date.parse(grant.reviewedAt)||Date.parse(grant.expiresAt)-Date.parse(grant.reviewedAt)>900000)throw Error('Current exact independent administrative approval required');return grant;};
 check();const initial=verifyGrant(await deps.authority(expected));check();const plan=freeze(structuredClone(initial.plan));
 const scope=environmentFeatureDigest({kind:plan.kind,tenant:plan.target.tenantId,environment:plan.target.environmentId,organization:plan.target.organizationId,field:plan.field});
 const lease=await acquireResourceLease(deps.leaseRoot,'environment-feature:'+scope,expected,{reclaimDeadOwner:false});
 const root=path.join(deps.home,'planning','environment-feature-executions',scope);await fs.mkdir(root,{recursive:true});
 const owned=async()=>{check();await lease.assertOwned();if(await fs.realpath(root)!==path.resolve(root))throw Error('Canonical administrative journal required');const current=verifyGrant(await deps.authority(expected));if(environmentFeatureDigest(current.plan)!==environmentFeatureDigest(plan))throw Error('Administrative scope changed');check();};
 const retain=async(stage:string,metadata:Record<string,unknown>)=>{await lease.assertOwned();if(await fs.realpath(root)!==path.resolve(root))throw Error('Canonical administrative journal required');await exclusive(path.join(root,String(sequence++).padStart(3,'0')+'-'+stage+'.json'),{stage,observedAt:new Date().toISOString(),proposalSha256:expected,...metadata});};
 const journal=async(stage:string,metadata:Record<string,unknown>)=>{await owned();await retain(stage,metadata);};
 const admit=async()=>{check(true);await owned();if(++calls>16)throw Error('Administrative call budget reached');};
 try{
  await owned();await exclusive(path.join(root,'intent.json'),{schemaVersion:1,proposalSha256:expected,record:plan.record,startedAt:new Date(wallStarted).toISOString(),pid:process.pid,field:plan.field,value:false,businessAuthorityGranted:false,flowMutationAllowed:false});
  const observed=preflightSchema.parse(await deps.preflight(plan,signal,admit));await owned();
  for(const key of ['tenantId','environmentId','organizationId','userId','aadObjectId','username','environmentUrl'] as const)if(observed[key].toLowerCase()!==plan.target[key].toLowerCase())throw Error('Administrative native identity or target differs');
  if(observed.row.organizationId.toLowerCase()!==plan.target.organizationId.toLowerCase())throw Error('Administrative row differs');
  await journal('preflight',{observation:observed});
  if(observed.row.value===false){await journal('observed-noop',{settingChangedByThisOperation:false,calls});return{scope,status:'observed-noop' as const,settingChangedByThisOperation:false,businessAuthorityGranted:false,flowMutationAllowed:false};}
  const request=freeze({path:`/api/data/v9.2/organizations(${plan.target.organizationId})`,body:{enableflowsinsolutionbydefault:false as const},ifMatch:observed.row.etag});
  await journal('conditional-write-intent',{request});await admit();
  const response=responseSchema.parse(await deps.patch(plan,request,signal));
  // Preserve the actual allowlisted response even if its approval/deadline
  // expired in flight. Retaining evidence grants no further native operation.
  await retain('conditional-write-response',response);await owned();
  if(response.status!==204)throw Error('Conditional administrative write not acknowledged');
  await admit();const after=rowSchema.parse(await deps.read(plan,signal));await retain('state-readback',after);await owned();
  if(after.organizationId.toLowerCase()!==plan.target.organizationId.toLowerCase()||after.value!==false)throw Error('Administrative readback does not confirm the exact false setting');
  await journal('confirmed',{observation:after,calls,settingChangedByThisOperation:true,businessAuthorityGranted:false,flowMutationAllowed:false});
  return{scope,status:'confirmed' as const,settingChangedByThisOperation:true,businessAuthorityGranted:false,flowMutationAllowed:false};
 }catch{
  // Do not retain arbitrary provider messages, bodies, headers or credentials.
  try{await exclusive(path.join(root,'held.json'),{schemaVersion:1,proposalSha256:expected,observedAt:new Date().toISOString(),calls,journalSequenceAttempts:sequence,holdPreserved:true,replayAuthorized:false,businessAuthorityGranted:false,flowMutationAllowed:false});}catch{}
  throw Error('Administrative operation held; inspect the original intent and allowlisted journal without retry, restoration or rearm');
 }
}
