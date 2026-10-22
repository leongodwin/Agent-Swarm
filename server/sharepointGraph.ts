import {z} from 'zod';
import {deliveryCommands} from './delivery.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import type {SharepointRequest} from './sharepointProvisioning.ts';

export class SharepointGraphHttpError extends Error{constructor(readonly status:number){super(`SharePoint Graph request refused (${status}); no automatic retry`);this.name='SharepointGraphHttpError';}}

/** Delegated Graph transport. Tokens/provider errors never enter evidence. */
export type SharepointGraphRequest=SharepointRequest&{readonly schemaWriteScopeObserved:boolean;readonly schemaWriterIdentity?:{readonly clientId:string;readonly subject:string;readonly configurationSha256:string}};
export async function connectSharepointGraph(tenantId:string,username:string,cwd:string,signal:AbortSignal,guard:()=>void,deps:{run:typeof deliveryCommands.run;fetch:typeof globalThis.fetch;acquire?:()=>Promise<{tenant:string;accessToken:string}>}={run:deliveryCommands.run,fetch:globalThis.fetch}):Promise<SharepointGraphRequest>{
 const check=()=>{signal.throwIfAborted();guard();};check();
 let raw:string;try{raw=deps.acquire?JSON.stringify(await deps.acquire()):await deps.run({executable:'az',args:['account','get-access-token','--resource','https://graph.microsoft.com','--tenant',tenantId,'--output','json']},cwd,{},signal);}catch{check();throw new Error('SharePoint Graph credentials unavailable; native error content withheld');}check();
 let token:string,expires:number,schemaWriteScopeObserved=false;
 try{
  const value=z.object({accessToken:z.string(),tenant:z.string()}).parse(parseUnambiguousJson(raw,{maxBytes:64*1024}));
  const claims=z.object({aud:z.string(),tid:z.string(),exp:z.number().finite(),scp:z.string().min(1),preferred_username:z.string().optional(),upn:z.string().optional(),unique_name:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(value.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));
  if(value.tenant.toLowerCase()!==tenantId.toLowerCase()||claims.tid.toLowerCase()!==tenantId.toLowerCase()||![ 'https://graph.microsoft.com','00000003-0000-0000-c000-000000000000'].includes(claims.aud)||String(claims.preferred_username??claims.upn??claims.unique_name??'').toLowerCase()!==username.toLowerCase()||claims.exp*1000<=Date.now()+30_000)throw new Error();
  token=value.accessToken;expires=claims.exp*1000;schemaWriteScopeObserved=claims.scp.split(' ').includes('Sites.Manage.All');
 }catch{throw new Error('SharePoint Graph delegated token identity, audience or expiry is unverified');}
 const request:SharepointRequest=async(method,resource,body)=>{
  check();if(Date.now()+30_000>=expires)throw new Error('SharePoint Graph token expired; refresh in a new operation');
  if(!resource.startsWith('sites/')||resource.includes('..')||resource.includes('\\')||resource.includes('#')||/\s/.test(resource)||resource.startsWith('//'))throw new Error('Invalid typed SharePoint Graph resource');
  // The documented delegated list-create contract requires Sites.Manage.All.
  // Read/item-write scopes do not authorize schema creation. Existing office
  // design/task/resource governance is still required in addition to this check.
  if(method==='POST'&&(!schemaWriteScopeObserved||!/^sites\/[a-zA-Z0-9.,-]+\/lists$/.test(resource)))throw new Error('SharePoint schema POST requires declared Sites.Manage.All and an exact list-create route; no request dispatched');
  const u=new URL('https://graph.microsoft.com/v1.0/'+resource);if(u.origin!=='https://graph.microsoft.com'||!u.pathname.startsWith('/v1.0/sites/'))throw new Error('SharePoint Graph resource escaped its origin');
  let response:Response;
  try{response=await deps.fetch(u,{method,redirect:'error',signal,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error('SharePoint Graph request interrupted; dispatched write outcome may be unknown');}
  check();if(!response.ok)throw new SharepointGraphHttpError(response.status);
  const reader=response.body?.getReader();if(!reader)throw new Error('SharePoint Graph response body unavailable');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const result=await reader.read();check();if(result.done)break;size+=result.value.length;if(size>2*1024*1024)throw new Error('SharePoint Graph response exceeds2MiB');chunks.push(result.value);}}finally{await reader.cancel();}
  check();try{return parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:2*1024*1024});}catch{throw new Error('SharePoint Graph response is invalid; content withheld');}
 };
 return Object.defineProperty(request,'schemaWriteScopeObserved',{value:schemaWriteScopeObserved,enumerable:true}) as SharepointGraphRequest;
}
