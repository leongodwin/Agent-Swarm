import {delegatedEvidenceReader} from './delegatedEvidenceReader.ts';
import {z} from 'zod';
import {deliveryCommands} from './delivery.ts';
const guid=z.uuid(),text=z.string().min(1).max(160);
const sku=z.object({skuId:guid,skuPartNumber:text,servicePlans:z.array(z.object({servicePlanId:guid,servicePlanName:text,provisioningStatus:text,appliesTo:text})).max(500)});
/** Fixed delegated self reads only. Assignment does not certify product use rights. */
export async function callerLicensing(binding:{tenantId:string;username:string},cwd:string,signal:AbortSignal,guard:()=>void,deps={run:deliveryCommands.run,fetch:globalThis.fetch}){
 const check=()=>{signal.throwIfAborted();guard();};check();
 try{
  const {read,subject}=await delegatedEvidenceReader('graph-self',binding,cwd,signal,guard,deps);
  const identity=async()=>{const me=z.object({id:guid,userPrincipalName:z.string()}).parse(await read('https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName'));if(me.id.toLowerCase()!==subject.toLowerCase()||me.userPrincipalName.toLowerCase()!==binding.username.toLowerCase())throw Error();};
  const licences=async()=>{const rows=z.object({value:z.array(sku).max(100),error:z.never().optional(),'@odata.nextLink':z.never().optional(),nextLink:z.never().optional()}).parse(await read('https://graph.microsoft.com/v1.0/me/licenseDetails')).value;
   if(new Set(rows.map(r=>r.skuId.toLowerCase())).size!==rows.length||rows.some(r=>new Set(r.servicePlans.map(p=>p.servicePlanId.toLowerCase())).size!==r.servicePlans.length))throw Error();
   return rows.map(r=>({...r,servicePlans:r.servicePlans.sort((a,b)=>a.servicePlanId.localeCompare(b.servicePlanId))})).sort((a,b)=>a.skuId.localeCompare(b.skuId));};
  await identity();const before=await licences(),after=await licences();await identity();check();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return {status:'observed',scope:'current-caller-assigned-license-details',subject:subject,username:binding.username,completeResponse:true,assignments:after,entitlementsVerified:false,limits:['One authenticated caller only; other users and service accounts are unverified','SKU and provisioning status are facts, not operation licensing, DLP, effective access or approval','No premium trial or other assigned SKU is accepted as the standard-only baseline']};
 }catch{check();return {status:'unavailable',scope:'current-caller-assigned-license-details',completeResponse:false,assignments:[],entitlementsVerified:false,reason:'Delegated caller licence details unavailable, incomplete, changed or identity differs; no login, fallback or credential details disclosed'};}
}
