import path from 'node:path';
import {z} from 'zod';
import {atomicWrite} from './atomicFile.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {platformDiscoveryBinding} from './platformDiscovery.ts';
import {governanceProfileBlockers} from '../shared/governanceProfile.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import type {CapabilityConfig} from './capabilityChecks.ts';
import {sharepointHash,sharepointPlan,sharepointSiteUrl,SharepointProvisioning,type SharepointRequest} from './sharepointProvisioning.ts';
import {assertWriteTargetApproval} from './sharepointResourceApproval.ts';
import {assertDedicatedWriteTargets} from './sharepointWriteReadiness.ts';
export const sharepointOfficeRequest=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('inspect'),siteUrl:sharepointSiteUrl}),
 z.strictObject({action:z.literal('provision'),planSha256:z.string().regex(/^[a-f0-9]{64}$/)}),
]);
export function assertSharepointAuthority(record:DeliveryRecord|undefined,issue:number|undefined,actor:string,plan:unknown,expected:string){
 const p=sharepointPlan.parse(plan);if(sharepointHash(p)!==expected)throw new Error('Pinned SharePoint plan hash differs');
 const task=record?.content.taskPlan?.tasks.find(t=>t.issue===issue);
 if(!record||!record.content.sourceCommit||record.designReview?.decision!=='approved'||!task||task.owner!==actor||!record.content.tasks.some(t=>t.issue===issue&&['slice','implementation'].includes(t.stage))||!task.inputs.includes(`sharepoint-plan-sha256:${expected}`)||p.resources.some(r=>!task.resources.includes(r.key)))throw new Error('SharePoint provisioning requires independently approved authoring task inputs and owned resources');
 const profile=record.content.governanceProfile;
 if(!profile||profile.tenantId.toLowerCase()!==p.tenantId.toLowerCase()||governanceProfileBlockers(profile).length||['sharepoint-permissions','sharepoint-data-boundary','sharepoint-recovery'].some(id=>!profile.controls.some(c=>c.id===id&&c.scope===p.siteUrl&&c.requirement==='required'&&c.verification==='verified'&&c.availability==='available')))throw new Error('SharePoint permission, data-boundary and recovery governance evidence is required');
 return p;
}
export async function sharepointOffice(input:unknown,context:{root:string;configurationRoot?:string;leaseRoot:string;repoId:string;actor:string;issue:number|undefined;config:CapabilityConfig;guard():void;record():DeliveryRecord|undefined;assertWork():void;readPlan():Promise<string>;connect(binding:ReturnType<typeof platformDiscoveryBinding>):Promise<SharepointRequest&{readonly schemaWriteScopeObserved?:boolean}>}){
 const request=sharepointOfficeRequest.parse(input),binding=platformDiscoveryBinding(context.config);context.guard();
 const configurationRoot=context.configurationRoot??context.root;
 const service=new SharepointProvisioning(context.root,context.leaseRoot,context.configurationRoot&&path.resolve(configurationRoot)!==path.resolve(context.root)?context.repoId:undefined);
 if(request.action==='inspect'){
  const transport=await context.connect(binding);context.guard();const observation=await service.inventory(request.siteUrl,binding.tenantId,transport,context.guard);
  const envelope={scope:'read-only-sharepoint-schema',binding,observation},sha256=sharepointHash(envelope),reference=path.join(context.root,'planning','sharepoint-inventory',`${sha256}.json`);context.guard();await atomicWrite(reference,JSON.stringify(envelope),()=>{context.guard();return true;});context.guard();return {...envelope,evidence:{reference,sha256,observedAt:observation.observedAt,expiresAt:observation.expiresAt}};
 }
 const raw=await context.readPlan();context.guard();const parsed=parseUnambiguousJson(raw,{maxBytes:32*1024});
 let resourceApproval:Awaited<ReturnType<typeof assertWriteTargetApproval>>|undefined;
 const authorize=async()=>{context.guard();context.assertWork();const p=assertSharepointAuthority(context.record(),context.issue,context.actor,parsed,request.planSha256);if(p.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||p.username.toLowerCase()!==binding.username.toLowerCase())throw new Error('SharePoint plan differs from reviewed executing account');await assertDedicatedWriteTargets(configurationRoot,context.repoId,p,context.guard);if(!resourceApproval)resourceApproval=await assertWriteTargetApproval(configurationRoot,context.repoId,p,request.planSha256,context.guard);await resourceApproval.owned();};
 await authorize();const plan=sharepointPlan.parse(parsed),transport=await context.connect(binding);await authorize();
 if(transport.schemaWriteScopeObserved!==true)throw new Error('SharePoint schema writer preflight requires declared Sites.Manage.All; no lease, durable intent or POST started');
 return service.execute(plan,JSON.stringify({repoId:context.repoId,issue:context.issue,actor:context.actor,sourceCommit:context.record()!.content.sourceCommit,planSha256:request.planSha256}),transport,context.guard,authorize);
}
