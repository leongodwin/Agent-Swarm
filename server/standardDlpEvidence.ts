import {z} from 'zod';
import {delegatedEvidenceReader} from './delegatedEvidenceReader.ts';
import {deliveryCommands} from './delivery.ts';
/** Same fixed route/audience as installed administration module2.0.219.
 * Uses existing delegated auth only; never opens a browser or changes policy. */
export async function standardDlpEvidence(binding:{tenantId:string;username:string},cwd:string,signal:AbortSignal,guard:()=>void,deps={run:deliveryCommands.run,fetch:globalThis.fetch}){
 const check=()=>{signal.throwIfAborted();guard();};check();
 try{
  const {read,subject}=await delegatedEvidenceReader('standard-dlp',binding,cwd,signal,guard,deps);
  const pass=async()=>{let next:string|undefined='https://api.bap.microsoft.com/providers/PowerPlatform.Governance/v1/policies?$top=50';const seen=new Set<string>(),policies:Record<string,unknown>[]=[];
   while(next){if(seen.has(next)||seen.size>=100)throw Error();seen.add(next);const page=z.object({value:z.array(z.record(z.string(),z.unknown())).max(5000),nextLink:z.string().min(1).optional(),'@odata.nextLink':z.never().optional(),Error:z.never().optional(),error:z.never().optional()}).parse(await read(next));policies.push(...page.value);if(policies.length>5000)throw Error();next=page.nextLink;}
   return {policies,pages:seen.size};};
  const before=await pass(),after=await pass();check();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return {status:'observed',scope:'standard-policy-inventory',source:'fixed-standard-policy-rest',tenantId:binding.tenantId,caller:binding.username,subject,complete:true,...after,complianceVerified:false,policyApplicabilityVerified:false,limits:['Repeated complete standard inventory only; no effective control or operation licensing approval','Advanced policies, exceptions, connector/action/endpoint rules and effective access require separate verification']};
 }catch{check();return {status:'unavailable',scope:'standard-policy-inventory',complete:false,complianceVerified:false,reason:'Standard DLP inventory unavailable, incomplete, changed or identity differs; no interactive login or policy change'};}
}
