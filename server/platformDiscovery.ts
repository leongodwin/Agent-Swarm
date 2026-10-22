import {standardDlpEvidence} from './standardDlpEvidence.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite} from './atomicFile.ts';
import {deliveryCommands} from './delivery.ts';
import {connectFlowAdapter,type FlowAdapter} from './flowAdapter.ts';
import {parsePacIdentity,verifyFlowIdentity} from './platformAuth.ts';
import type {CapabilityConfig} from './capabilityChecks.ts';
import {dataverseGuid} from './targetOperations.ts';
import {platformIdentitySchema} from './identityContracts.ts';
import {callerLicensing} from './callerLicensing.ts';
import {userEntitlements} from './userEntitlements.ts';
import {resourcePermissions} from './resourcePermissions.ts';
import {sharepointWriteReadiness} from './sharepointWriteReadiness.ts';
import {sharepointConnectorSchema} from './sharepointConnectorSchema.ts';
import {sharepointPlan} from './sharepointProvisioning.ts';
import {verifyTenantSnapshot} from './tenantDlp.ts';
import {deliveryPermissions} from './deliveryPermissions.ts';
import {readPinnedBlob} from './pinnedPreparation.ts';
import {sharepointHash,journalSchema} from './sharepointProvisioning.ts';
import {packagingPlan} from './canvasPackaging.ts';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {readBoundedText} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const connector=z.enum(['shared_sharepointonline','shared_teams','shared_approvals']);
export const platformDiscoveryRequest=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('identity')}),
 z.strictObject({kind:z.literal('assigned-licenses')}),
 z.strictObject({kind:z.literal('user-entitlements'),username:z.email().max(254)}),
 z.strictObject({kind:z.literal('resource-permissions')}),
 z.strictObject({kind:z.literal('delivery-permissions')}),
 z.strictObject({kind:z.literal('delivery-authoring-prerequisites')}),
 z.strictObject({kind:z.literal('write-readiness')}),
 z.strictObject({kind:z.literal('dlp-inventory')}),
 z.strictObject({kind:z.literal('environments')}),
 z.strictObject({kind:z.literal('sharepoint-sites')}),
 z.strictObject({kind:z.literal('sharepoint-list-schema'),resourceKey:sharepointPlan.shape.resources.element.shape.key}),
 z.strictObject({kind:z.literal('connector-operations'),connector,query:z.string().trim().min(1).max(100)}),
 z.strictObject({kind:z.literal('operation'),connector,operation:z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/)}),
]);
export type PlatformDiscoveryRequest=z.infer<typeof platformDiscoveryRequest>;
/** Full inventories and cold PAC identity plus verified schema reads need a
 * bounded 90s window. Other metadata probes retain their existing deadline. */
export function platformDiscoveryBudget(input:unknown){const {kind}=platformDiscoveryRequest.parse(input);return kind==='delivery-authoring-prerequisites'?100_000:['write-readiness','sharepoint-list-schema','user-entitlements','delivery-permissions'].includes(kind)?90_000:45_000;}
/** Stable catalogue/schema observations need enough time for independent planning
 * review. This never extends identity, permissions, licence or writer readiness. */
export function platformDiscoveryValidity(input:unknown){const {kind}=platformDiscoveryRequest.parse(input);return ['environments','sharepoint-sites','sharepoint-list-schema','connector-operations','operation'].includes(kind)?15*60_000:60_000;}
/** Only reviewed identity assertions may select this discovery target. */
export function platformDiscoveryBinding(config:CapabilityConfig){
 const url=new URL(config.environmentUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^[a-z0-9-]+\.crm\d*\.dynamics\.com$/.test(url.hostname))throw new Error('Discovery requires a reviewed Microsoft organization root');
 const origin=url.origin;
 const auth=config.checks.flatMap(check=>check.probe.kind==='http'&&check.probe.azureCli?[check.probe.azureCli]:check.probe.kind==='platform-auth'?[{tenantId:check.probe.identity.tenantId,username:check.probe.identity.username}]:[]);
 if(!auth.length||auth.some(value=>value.tenantId.toLowerCase()!==auth[0].tenantId.toLowerCase()||value.username.toLowerCase()!==auth[0].username.toLowerCase()))throw new Error('Discovery requires one reviewed tenant/account');
 const expected=(field:'OrganizationId'|'UserId')=>{
  const values=config.checks.flatMap(check=>{
   const probe=check.probe;
   if(probe.kind==='platform-auth'&&new URL(probe.environmentUrl).origin===origin)return[field==='OrganizationId'?probe.binding.organizationId:probe.binding.userId];
   if(probe.kind==='http'&&probe.azureCli&&probe.url===`${origin}/api/data/v9.2/WhoAmI`&&probe.pointer.length===1&&probe.pointer[0]===field&&typeof probe.equals==='string')return[probe.equals];
   return[];
  });
  if(!values.length||values.some(value=>value.toLowerCase()!==values[0].toLowerCase()))throw new Error('Discovery requires unambiguous target identity assertions');
  return dataverseGuid.parse(values[0]);
 };
 const environments=config.checks.flatMap(check=>check.probe.kind==='platform-auth'&&new URL(check.probe.environmentUrl).origin===origin?[check.probe.identity.environmentId]:[]);
 if(environments.some(value=>value.toLowerCase()!==environments[0].toLowerCase()))throw new Error('Discovery requires one reviewed environment ID');
 return {environmentUrl:origin,tenantId:auth[0].tenantId,username:auth[0].username,organizationId:expected('OrganizationId'),userId:expected('UserId'),...(environments.length?{environmentId:environments[0]}:{})};
}
interface Dependencies{
 run:typeof deliveryCommands.run;
 connect:(cwd:string,signal:AbortSignal)=>Promise<FlowAdapter>;
 licensing?:typeof callerLicensing;
 entitlements?:typeof userEntitlements;
 permissions?:typeof resourcePermissions;
 writer?:typeof sharepointWriteReadiness;
 authorPermissions?:typeof deliveryPermissions;
 dlp?:typeof standardDlpEvidence;
 dlpObservation?:(identity:{tenantId:string;caller:string})=>unknown;
}
/** Fixed metadata-only methods. A caller cannot supply a command, URL, env or tool name. */
export class PlatformDiscovery{
 constructor(private root:string,private deps:Dependencies={run:deliveryCommands.run,connect:connectFlowAdapter}){}
 async inspect(config:CapabilityConfig,cwd:string,input:unknown,guard:()=>void,signal:AbortSignal,repoId?:string,configurationRoot=this.root,scope?:{record:DeliveryRecord;issue:number}){
  const request=platformDiscoveryRequest.parse(input),binding=platformDiscoveryBinding(config);
  if(['delivery-permissions','delivery-authoring-prerequisites'].includes(request.kind)&&(!repoId||scope?.record.repoId!==repoId||!scope.record.content.sourceCommit||!scope.record.content.taskPlan?.tasks.some(t=>t.issue===scope.issue)))throw Error('Delivery permission discovery requires a server-bound current task');
  if(['write-readiness','sharepoint-list-schema'].includes(request.kind)&&!repoId)throw new Error('Write readiness and schema discovery require server-bound repository context');
  const assert=()=>{signal.throwIfAborted();guard();};assert();
  let flow:FlowAdapter|undefined,pac!:ReturnType<typeof parsePacIdentity>,data:unknown;
  try{
   // Only fixed provider identity reads overlap. Wait for both outcomes so an
   // early failure cannot leak a late-connected adapter or dispatch metadata.
   const initial=await Promise.allSettled([this.deps.run({executable:'pac',args:['org','who','--environment',binding.environmentUrl]},cwd,{},signal),(async()=>{flow=await this.deps.connect(cwd,signal);assert();return flow.call('whoami',{});})()]);assert();
   const failure=initial.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failure)throw failure.reason;
   pac=parsePacIdentity((initial[0] as PromiseFulfilledResult<string>).value);
   if(new URL(pac.environmentUrl).origin!==binding.environmentUrl||pac.username.toLowerCase()!==binding.username.toLowerCase()||pac.organizationId.toLowerCase()!==binding.organizationId.toLowerCase()||pac.userId.toLowerCase()!==binding.userId.toLowerCase()||binding.environmentId&&pac.environmentId.toLowerCase()!==binding.environmentId.toLowerCase())throw new Error('Discovery executing target/account differs from the reviewed binding');
   const identity=platformIdentitySchema.parse({tenantId:binding.tenantId,username:binding.username,environmentId:pac.environmentId});
   verifyFlowIdentity((initial[1] as PromiseFulfilledResult<unknown>).value,identity);assert();
   if(request.kind==='identity')data={...binding,environmentId:pac.environmentId,scope:'metadata-discovery-only'};
   else if(request.kind==='assigned-licenses')data=await (this.deps.licensing??callerLicensing)(binding,cwd,signal,guard);
   else if(request.kind==='user-entitlements')data=await(this.deps.entitlements??userEntitlements)(binding,request.username,cwd,signal,guard);
   else if(request.kind==='resource-permissions')data=await(this.deps.permissions??resourcePermissions)(configurationRoot,binding,signal,guard);
   else if(request.kind==='delivery-permissions'||request.kind==='delivery-authoring-prerequisites'){
    const task=scope!.record.content.taskPlan!.tasks.find(t=>t.issue===scope!.issue)!,apps=task.resources.filter(r=>/^canvas_[a-f0-9-]{36}$/i.test(r));if(apps.length!==1)throw Error('Exactly one task-owned Canvas resource required');
    const source=scope!.record.content.sourceCommit!,read=async(file:string)=>{assert();const value=await readPinnedBlob(args=>this.deps.run({executable:'git',args},cwd,{},signal),source,file);assert();return value;};
    const canvas=packagingPlan.parse(parseUnambiguousJson(await read('cubefarm.canvas-package.json'),{maxBytes:4096})),plan=sharepointPlan.parse(parseUnambiguousJson(await read('cubefarm.sharepoint.json'),{maxBytes:65536}));
    if(canvas.appId.toLowerCase()!==apps[0].slice(7).toLowerCase()||canvas.environmentId.toLowerCase()!==pac.environmentId.toLowerCase()||plan.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||plan.username.toLowerCase()!==binding.username.toLowerCase()||plan.resources.length!==1)throw Error('Pinned app or SharePoint target differs');
    const hash=sharepointHash(plan),file=path.join(this.root,'planning','sharepoint-provisioning',hash+'.json'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Verified resource journal unavailable');const raw=await readBoundedText(file,65536);if(!raw)throw Error('Verified resource journal unavailable');const journal=journalSchema.parse(parseUnambiguousJson(raw));
    if(journal.planSha256!==hash||JSON.parse(journal.authority).repoId!==repoId||journal.entries.length!==1||journal.entries[0].key!==plan.resources[0].key||journal.entries[0].status!=='verified'||!journal.entries[0].id||journal.entries[0].migration||!journal.entries[0].marker.startsWith(`CubeFarm:${hash}:`))throw Error('Exact completed resource ownership required');
    const ids=config.checks.flatMap(c=>c.probe.kind==='pac-connection'&&c.probe.api==='shared_sharepointonline'&&new URL(c.probe.environmentUrl).origin===binding.environmentUrl&&c.probe.account?.toLowerCase()===binding.username.toLowerCase()&&c.probe.connectionId?[c.probe.connectionId]:[]);if(!ids.length||new Set(ids).size!==1)throw Error('One reviewed existing connection required');
    // One real collection transaction avoids independently expiring receipts.
    // Keep actual component intervals; do not import or renew earlier evidence.
    const startedAt=new Date().toISOString();let entitlementCompletedAt:string|undefined,permissionsStartedAt:string|undefined,permissionsCompletedAt:string|undefined;
    const entitlementWork=(async()=>{if(request.kind!=='delivery-authoring-prerequisites')return undefined;const result=await(this.deps.entitlements??userEntitlements)(binding,binding.username,cwd,signal,guard);assert();entitlementCompletedAt=new Date().toISOString();return result;})();
    const permissionWork=(async()=>{permissionsStartedAt=new Date().toISOString();const result=await(this.deps.authorPermissions??deliveryPermissions)(configurationRoot,cwd,{tenantId:binding.tenantId,username:binding.username,environmentId:pac.environmentId,appId:canvas.appId,connectionId:ids[0],listIds:[journal.entries[0].id!],siteUrl:plan.siteUrl,siteCollectionId:plan.siteCollectionId,webId:plan.webId},flow!,signal,guard,{run:this.deps.run,fetch:globalThis.fetch,permissions:this.deps.permissions??resourcePermissions});assert();permissionsCompletedAt=new Date().toISOString();return result;})();
    const components=await Promise.allSettled([entitlementWork,permissionWork]);assert();const failed=components.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failed)throw failed.reason;
    const entitlement=(components[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof userEntitlements>>|undefined>).value,observed=(components[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof deliveryPermissions>>>).value;
    if(request.kind==='delivery-authoring-prerequisites'&&(!entitlement||entitlement.status!=='observed'||!entitlement.completeResponse||!entitlement.businessPremiumBaseline||entitlement.user?.userPrincipalName.toLowerCase()!==binding.username.toLowerCase()||entitlement.tenantId?.toLowerCase()!==binding.tenantId.toLowerCase()||observed.status!=='observed'||observed.permissionMetadataSatisfied!==true||entitlement.user.id.toLowerCase()!==observed.subject?.toLowerCase()))throw Error('Current named-user baseline or exact-target permission metadata unavailable');
    data={...observed,repoId,issue:scope!.issue,reference:recordReference(scope!.record),sourceCommit:source,...(entitlement?{entitlement,freshnessContract:'bounded-composite-metadata-v1',collection:{startedAt,entitlementStartedAt:startedAt,entitlementCompletedAt,permissionsStartedAt,permissionsCompletedAt},limits:[...(observed.limits??[]),'Components were read within one bounded interval, not an atomic provider snapshot; no earlier receipt renewed','One-minute validity begins only after final native identity validation; no connector execution or authoring approval']}:{})};assert();if(await readBoundedText(file,65536)!==raw)throw Error('Resource ownership changed during observation');
   }
   else if(request.kind==='write-readiness'){
    const ids=config.checks.flatMap(c=>c.probe.kind==='pac-connection'&&c.probe.api==='shared_sharepointonline'&&new URL(c.probe.environmentUrl).origin===binding.environmentUrl&&c.probe.account?.toLowerCase()===binding.username.toLowerCase()&&c.probe.connectionId?[c.probe.connectionId]:[]);
    if(!ids.length||new Set(ids).size!==1)throw new Error('Write readiness requires one reviewed SharePoint connection');
    data=await(this.deps.writer??sharepointWriteReadiness)(configurationRoot,repoId!,{...binding,environmentId:pac.environmentId},cwd,signal,guard,flow!,ids[0]);
   }
   else if(request.kind==='dlp-inventory'){
    assert();let snapshot:unknown;try{snapshot=this.deps.dlpObservation?.({tenantId:binding.tenantId,caller:binding.username});}catch{assert();}
    if(snapshot===undefined)data=await(this.deps.dlp??standardDlpEvidence)(binding,cwd,signal,guard);
    else{const identity={tenantId:binding.tenantId,caller:binding.username};data={status:'observed',scope:'standard-policy-inventory',inventory:verifyTenantSnapshot(snapshot,identity),complianceVerified:false,limits:['Standard policy inventory only; effective target policy, connector classification and operation eligibility remain unverified']};}
   }
   else if(request.kind==='environments')data=await flow!.call('list_environments',{});
   else if(request.kind==='sharepoint-sites'||request.kind==='sharepoint-list-schema'){
    const connections=config.checks.flatMap(check=>check.probe.kind==='pac-connection'&&check.probe.api==='shared_sharepointonline'&&new URL(check.probe.environmentUrl).origin===binding.environmentUrl&&check.probe.account?.toLowerCase()===binding.username.toLowerCase()&&check.probe.connectionId?[check.probe.connectionId]:[]);
    if(!connections.length||new Set(connections).size!==1)throw new Error('SharePoint discovery requires one reviewed connection ID and account');
    const listed=z.array(z.object({name:z.string(),connector:z.string(),status:z.string(),accountName:z.string().nullable().optional(),statuses:z.array(z.object({status:z.string()})).optional()})).parse(await flow!.call('list_connections',{env:pac.environmentId,connector:'shared_sharepointonline'}));assert();
    if(!listed.some(row=>row.name===connections[0]&&row.connector==='/providers/Microsoft.PowerApps/apis/shared_sharepointonline'&&row.status==='Connected'&&row.accountName?.toLowerCase()===binding.username.toLowerCase()&&row.statuses?.every(status=>status.status==='Connected')!==false))throw new Error('Reviewed SharePoint connection is not connected for this account');
    data=request.kind==='sharepoint-list-schema'?await sharepointConnectorSchema(this.root,cwd,repoId!,request.resourceKey,identity,connections[0],flow!,assert):await flow!.call('invoke_operation',{env:pac.environmentId,connector:'shared_sharepointonline',connection:connections[0],operation:'GetDataSets',params:{}});
   }
   else if(request.kind==='connector-operations')data=await flow!.call('get_connector',{env:pac.environmentId,connector:request.connector,query:request.query});
   else data=await flow!.call('get_operation_details',{env:pac.environmentId,connector:request.connector,operation:request.operation});
   assert();verifyFlowIdentity(await flow!.call('whoami',{}),identity);assert();
  }finally{await flow?.close();}
  assert();
  // Identity diagnostics contain cache paths. They never enter this receipt.
  // Metadata is bounded and excludes credential-bearing fields recursively.
  const redact=(value:unknown):unknown=>Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|secret|password|authorization|authentication|cache|configdir|credential|api.?key|cookie|connection.?string|client.?assertion|private.?key)/i.test(key)).map(([key,item])=>[key,redact(item)])):value;
  const observed=Date.now(),observedAt=new Date(observed).toISOString();
  const observation={schemaVersion:1,scope:'read-only-platform-metadata',configurationSha256:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'),binding:{...binding,environmentId:pac.environmentId},request,observedAt,expiresAt:new Date(observed+platformDiscoveryValidity(request)).toISOString(),data:redact(data),limits:['Validity covers bounded planning metadata only; execution still requires current native identity, permissions, licensing and session preflight checks','No authoring, deployment, permission or licence approval','Metadata observation does not establish effective access or application runtime']};
  const bytes=JSON.stringify(observation);if(Buffer.byteLength(bytes)>64*1024)throw new Error('Discovery metadata exceeds64KiB; narrow the operation query');
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),reference=path.join(this.root,'planning','platform-discovery',`${sha256}.json`);
  await fs.mkdir(path.dirname(reference),{recursive:true});assert();await atomicWrite(reference,bytes,()=>{assert();return true;});assert();
  return{observation,evidence:{reference,sha256,observedAt,expiresAt:observation.expiresAt}};
 }
}
