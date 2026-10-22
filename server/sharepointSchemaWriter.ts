import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {sharepointRestAuthSchema,acquireGraphSchemaSilent} from './sharepointRestAuth.ts';
import {connectSharepointGraph} from './sharepointGraph.ts';
import {deliveryCommands} from './delivery.ts';

/** Server-owned, separately configured writer. Absent-only compatibility path;
 * configured failures never use Azure CLI, observer credentials or another app. */
export async function connectSharepointSchemaWriter(root:string,binding:{tenantId:string;username:string},cwd:string,signal:AbortSignal,guard:()=>void,deps={acquire:acquireGraphSchemaSilent,connect:connectSharepointGraph}){
 const check=()=>{signal.throwIfAborted();guard();};check();const file=path.join(root,'graph-schema-writer.json');
 try{await fs.lstat(file);}catch(error){check();if((error as NodeJS.ErrnoException).code==='ENOENT')return deps.connect(binding.tenantId,binding.username,cwd,signal,guard);throw Error('Schema writer configuration unavailable');}
 const read=async()=>{check();const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Schema writer configuration path differs');const bytes=await readBoundedBytes(file,16384);if(!bytes)throw Error('Schema writer configuration absent');check();return bytes;};
 const raw=await read(),config=sharepointRestAuthSchema.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(raw),{maxBytes:16384}));
 if(config.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||config.username.toLowerCase()!==binding.username.toLowerCase())throw Error('Schema writer account binding differs');
 const owned=async()=>{check();if(!raw.equals(await read()))throw Error('Schema writer configuration changed');check();};
 const acquire=async()=>{await owned();const credential=await deps.acquire(config,signal,owned);await owned();
  try{const claims=z.object({tid:z.uuid(),oid:z.uuid(),aud:z.string(),exp:z.number().finite(),scp:z.string(),appid:z.string().optional(),azp:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(credential.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));const clients=[claims.appid,claims.azp].filter((x):x is string=>x!==undefined);if(credential.tenant.toLowerCase()!==config.tenantId.toLowerCase()||claims.tid.toLowerCase()!==config.tenantId.toLowerCase()||claims.oid.toLowerCase()!==config.subject.toLowerCase()||!['https://graph.microsoft.com','00000003-0000-0000-c000-000000000000'].includes(claims.aud)||claims.exp*1000<=Date.now()+30000||!claims.scp.split(' ').includes('Sites.Manage.All')||!clients.length||clients.some(c=>c.toLowerCase()!==config.clientId.toLowerCase()))throw Error();}catch{check();throw Error('Schema writer token identity, scope or lifetime differs');}
  return credential;
 };
 const transport=await deps.connect(binding.tenantId,binding.username,cwd,signal,guard,{run:deliveryCommands.run,fetch:globalThis.fetch,acquire});await owned();
 const request=async(method:'GET'|'POST',resource:string,body?:object)=>{await owned();const result=await transport(method,resource,body);await owned();return result;};
 Object.defineProperty(request,'schemaWriteScopeObserved',{value:transport.schemaWriteScopeObserved,enumerable:true});
 return Object.defineProperty(request,'schemaWriterIdentity',{value:Object.freeze({clientId:config.clientId,subject:config.subject,configurationSha256:crypto.createHash('sha256').update(raw).digest('hex')}),enumerable:true}) as typeof transport;
}
