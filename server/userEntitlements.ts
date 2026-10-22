import {z} from 'zod';
import {delegatedEvidenceReader} from './delegatedEvidenceReader.ts';
import {deliveryCommands} from './delivery.ts';

const guid=z.uuid(),text=z.string().min(1).max(160);
const userSchema=z.object({id:guid,userPrincipalName:z.email().max(254),accountEnabled:z.boolean(),userType:z.enum(['Member','Guest']).nullable(),error:z.never().optional()});
const collection=z.object({value:z.array(z.object({skuId:guid,skuPartNumber:text,servicePlans:z.array(z.object({servicePlanId:guid,servicePlanName:text,provisioningStatus:text,appliesTo:text})).max(500)})).max(100),error:z.never().optional(),'@odata.nextLink':z.never().optional(),nextLink:z.never().optional()});
// Microsoft Entra product/service-plan reference. All four must be successful
// User plans in the same SPB assignment; premium/developer SKUs cannot fill gaps.
const baseline={skuId:'cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46',skuPartNumber:'SPB',plans:[
 ['SHAREPOINTSTANDARD','c7699d2e-19aa-44de-8edf-1736da088ca1'],
 ['TEAMS1','57ff2da0-773e-42df-b2af-ffb7a2317929'],
 ['POWERAPPS_O365_P1','92f7a6f3-b89b-4bbd-8c30-809e6da5ad1c'],
 ['FLOW_O365_P1','0f9b09cb-62d1-4ff4-9129-43f4996f83f4'],
]};
/** One explicitly named user, fixed delegated reads, no tenant-wide search or grants. */
export async function userEntitlements(binding:{tenantId:string;username:string},username:string,cwd:string,signal:AbortSignal,guard:()=>void,deps={run:deliveryCommands.run,fetch:globalThis.fetch}){
 const target=z.email().max(254).parse(username).toLowerCase(),check=()=>{signal.throwIfAborted();guard();};check();
 try{
  const {read,subject}=await delegatedEvidenceReader({graphUser:target},binding,cwd,signal,guard,deps),prefix=`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(target)}`;
  const caller=async()=>{const me=z.object({id:guid,userPrincipalName:z.email(),error:z.never().optional()}).parse(await read('https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName'));if(me.id.toLowerCase()!==subject.toLowerCase()||me.userPrincipalName.toLowerCase()!==binding.username.toLowerCase())throw Error();};
  const identity=async()=>{const user=userSchema.parse(await read(prefix+'?$select=id,userPrincipalName,accountEnabled,userType'));if(user.userPrincipalName.toLowerCase()!==target)throw Error();return user;};
  const licenses=async()=>{const rows=collection.parse(await read(prefix+'/licenseDetails')).value;
   if(new Set(rows.map(r=>r.skuId.toLowerCase())).size!==rows.length||rows.some(r=>new Set(r.servicePlans.map(p=>p.servicePlanId.toLowerCase())).size!==r.servicePlans.length))throw Error();
   return rows.map(r=>({...r,servicePlans:r.servicePlans.sort((a,b)=>a.servicePlanId.localeCompare(b.servicePlanId))})).sort((a,b)=>a.skuId.localeCompare(b.skuId));};
  await caller();const beforeUser=await identity(),before=await licenses(),after=await licenses(),afterUser=await identity();await caller();check();
  if(JSON.stringify(beforeUser)!==JSON.stringify(afterUser)||JSON.stringify(before)!==JSON.stringify(after))throw Error();
  const spb=after.find(s=>s.skuId.toLowerCase()===baseline.skuId&&s.skuPartNumber===baseline.skuPartNumber);
  const services=baseline.plans.map(([name,id])=>({name,id,successfulUserPlan:spb?.servicePlans.some(p=>p.servicePlanId.toLowerCase()===id&&p.servicePlanName===name&&p.provisioningStatus==='Success'&&p.appliesTo==='User')??false}));
  return {status:'observed',scope:'named-user-license-baseline',tenantId:binding.tenantId,observer:binding.username,user:afterUser,completeResponse:true,businessPremiumBaseline:afterUser.accountEnabled&&services.every(s=>s.successfulUserPlan),services,assignments:after,entitlementsVerified:false,nominationVerified:false,limits:['One named user only; role nomination, complete intended-user roster and independent denied identity remain unverified','Baseline service-plan assignment is not product use-rights, operation eligibility, resource access or runtime approval','Premium, developer and trial assignments cannot replace missing Business Premium plans']};
 }catch{check();return {status:'unavailable',scope:'named-user-license-baseline',username:target,completeResponse:false,businessPremiumBaseline:false,entitlementsVerified:false,nominationVerified:false,reason:'Named-user identity or licence evidence unavailable, incomplete or changed; no login, grants or alternative identity used'};}
}
