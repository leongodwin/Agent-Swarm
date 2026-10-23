import {dataverseGuid} from './targetOperations.ts';
import {z} from 'zod';
import {deliveryCommands} from './delivery.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const origin='https://api.powerplatform.com';
const assignment=z.strictObject({policyId:z.string().min(1).max(160),resourceId:z.string().min(1).max(200),resourceType:z.enum(['Environment','EnvironmentGroup','NotSpecified']),ruleSetCount:z.number().int().nonnegative(),tenantId:z.uuid()});
const collection=z.strictObject({value:z.array(assignment).max(1000)});

/** Existing delegated identity, one fixed environment metadata route, no writes. */
export async function environmentRuleAssignments(binding:{tenantId:string;username:string;environmentId:string},cwd:string,signal:AbortSignal,guard:()=>void,deps={run:deliveryCommands.run,fetch:globalThis.fetch}){
 const check=()=>{signal.throwIfAborted();guard();};check();
 try{
  z.uuid().parse(binding.tenantId);dataverseGuid.parse(binding.environmentId);z.email().parse(binding.username);
  const raw=await deps.run({executable:'az',args:['account','get-access-token','--resource',origin,'--tenant',binding.tenantId,'--output','json']},cwd,{},signal);check();
  const credential=z.object({tenant:z.uuid(),accessToken:z.string().min(1).max(16384)}).parse(parseUnambiguousJson(raw,{maxBytes:65536}));
  const parts=credential.accessToken.split('.');if(parts.length!==3)throw Error();
  const claims=z.object({tid:z.uuid(),oid:z.uuid(),aud:z.string(),exp:z.number(),scp:z.string().min(1),upn:z.string().optional(),preferred_username:z.string().optional(),unique_name:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(parts[1],'base64url').toString('utf8'),{maxBytes:65536}));
  const names=[claims.upn,claims.preferred_username,claims.unique_name].filter((name):name is string=>name!==undefined);
  if(credential.tenant.toLowerCase()!==binding.tenantId.toLowerCase()||claims.tid.toLowerCase()!==binding.tenantId.toLowerCase()||![origin,origin+'/'].includes(claims.aud)||!names.length||names.some(name=>name.toLowerCase()!==binding.username.toLowerCase()))throw Error();
  const url=origin+'/governance/ruleBasedPolicies/environments/'+binding.environmentId+'/assignments?includeRuleSetCounts=true&api-version=2024-10-01';
  const read=async()=>{
   check();if(claims.exp*1000<=Date.now()+30000)throw Error();
   const response=await deps.fetch(url,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+credential.accessToken,Accept:'application/json'}});check();
   if(!response.ok){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();check();if(part.done)break;size+=part.value.length;if(size>65536)throw Error();chunks.push(part.value);}}finally{await reader.cancel();}
   const rows=collection.parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:65536})).value;
   if(rows.some(row=>row.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||row.resourceType==='Environment'&&row.resourceId.toLowerCase()!==binding.environmentId.toLowerCase()))throw Error();
   const key=(row:z.infer<typeof assignment>)=>JSON.stringify([row.policyId,row.resourceType,row.resourceId]);
   if(new Set(rows.map(key)).size!==rows.length)throw Error();
   return rows.sort((a,b)=>key(a).localeCompare(key(b)));
  };
  const before=await read(),after=await read();check();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return{status:'observed',scope:'environment-rule-assignment-metadata',tenantId:binding.tenantId,caller:binding.username,subject:claims.oid,environmentId:binding.environmentId,completeResponse:true,assignmentCount:after.length,assignments:after,effectivePolicyVerified:false,operationEligibilityVerified:false,limits:['Two stable reads of the documented environment assignment endpoint only; no policy or permission change','Assignments are not combined classic/advanced policy evaluation, connector/action eligibility or runtime approval','An empty assignment response alone does not establish that no effective restriction applies']};
 }catch{check();return{status:'unavailable',scope:'environment-rule-assignment-metadata',environmentId:binding.environmentId,completeResponse:false,effectivePolicyVerified:false,operationEligibilityVerified:false,reason:'Existing delegated identity or complete stable environment assignments unavailable; no login, consent, grants or alternative target used'};}
}
