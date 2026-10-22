import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {deliveryCommands} from './delivery.ts';
const guid=z.uuid();
export async function delegatedEvidenceReader(kind:'graph-self'|'standard-dlp'|{graphUser:string},binding:{tenantId:string;username:string},cwd:string,signal:AbortSignal,guard:()=>void,deps={run:deliveryCommands.run,fetch:globalThis.fetch}){
 const graph=kind!=='standard-dlp',user=typeof kind==='object'?encodeURIComponent(z.email().max(254).parse(kind.graphUser).toLowerCase()):undefined;
 const graphRoutes=['https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName',...(user?[`https://graph.microsoft.com/v1.0/users/${user}?$select=id,userPrincipalName,accountEnabled,userType`,`https://graph.microsoft.com/v1.0/users/${user}/licenseDetails`]:['https://graph.microsoft.com/v1.0/me/licenseDetails'])];
 const resource=graph?'https://graph.microsoft.com':'https://service.powerapps.com/';const check=()=>{signal.throwIfAborted();guard();};check();
  const raw=await deps.run({executable:'az',args:['account','get-access-token','--resource',resource,'--tenant',binding.tenantId,'--output','json']},cwd,{},signal);check();
  const credential=z.object({tenant:guid,accessToken:z.string()}).parse(parseUnambiguousJson(raw,{maxBytes:65536}));
  const claims=z.object({tid:guid,oid:guid,aud:z.string(),exp:z.number().finite(),scp:z.string().min(1),upn:z.string().optional(),preferred_username:z.string().optional(),unique_name:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(credential.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));
  if(credential.tenant.toLowerCase()!==binding.tenantId.toLowerCase()||claims.tid.toLowerCase()!==binding.tenantId.toLowerCase()||!(graph?['https://graph.microsoft.com','00000003-0000-0000-c000-000000000000']:[resource]).includes(claims.aud)||String(claims.preferred_username??claims.upn??claims.unique_name??'').toLowerCase()!==binding.username.toLowerCase()||claims.exp*1000<=Date.now()+30000)throw Error();
  let totalBytes=0;
  const read=async(route:string)=>{
   const url=new URL(route);if(url.username||url.password||url.hash||url.port||url.protocol!=='https:'||(graph?!graphRoutes.includes(route):url.origin!=='https://api.bap.microsoft.com'||url.pathname!=='/providers/PowerPlatform.Governance/v1/policies'))throw Error('Unsupported evidence route');
   check();if(claims.exp*1000<=Date.now()+30000)throw Error();
   const response=await deps.fetch(route,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+credential.accessToken,Accept:'application/json'}});check();
   if(!response.ok){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const part=await reader.read();check();if(part.done)break;bytes+=part.value.length;totalBytes+=part.value.length;if(bytes>2*1024*1024||totalBytes>8*1024*1024)throw Error();chunks.push(part.value);}}finally{await reader.cancel();}
   return parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:2*1024*1024});
  };
 return {read,subject:claims.oid};
}
