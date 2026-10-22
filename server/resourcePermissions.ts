import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {configuredSharepointSilent} from './sharepointRestAuth.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {sharepointSiteUrl} from './sharepointProvisioning.ts';

const guid=z.uuid(),mask=z.string().regex(/^(0|[1-9][0-9]{0,9})$/).refine(v=>BigInt(v)<=0xffffffffn);
const permissions=z.object({High:mask,Low:mask});
export const resourcePermissionConfig=z.strictObject({schemaVersion:z.literal(1),tenantId:guid,username:z.email(),subject:guid,observerProfile:z.string().min(1).max(2000),siteUrl:sharepointSiteUrl,siteCollectionId:guid,webId:guid,listIds:z.array(guid).min(1).max(5).refine(v=>new Set(v.map(x=>x.toLowerCase())).size===v.length)});
type Config=z.infer<typeof resourcePermissionConfig>;
type Binding={tenantId:string;username:string;subject?:string;siteUrl?:string;siteCollectionId?:string;webId?:string;listIds?:string[]};
type Credential=()=>Promise<{tenant:string;accessToken:string}>;
type Dependencies={fetch:typeof fetch;credential:(config:Config,signal:AbortSignal,guard:()=>Promise<void>)=>Promise<Credential|undefined>};
const defaults:Dependencies={fetch:globalThis.fetch,credential:(c,s,g)=>configuredSharepointSilent(c.observerProfile,{tenantId:c.tenantId,observerSubject:c.subject,observerUsername:c.username},new URL(c.siteUrl).origin,s,g)};
const flags={viewItems:1,addItems:2,editItems:3,deleteItems:4,openItems:6,manageLists:12,managePermissions:26} as const;
function decode(value:z.infer<typeof permissions>){const low=BigInt(value.Low);return{mask:value,flags:Object.fromEntries(Object.entries(flags).map(([name,bit])=>[name,(low&(1n<<BigInt(bit-1)))!==0n]))};}

/** Fixed GETs in one server-configured observer context. No request-selected
 * site, list, credential, permission change, write or fallback identity. */
export async function resourcePermissions(root:string,binding:Binding,signal:AbortSignal,guard:()=>void,deps:Dependencies=defaults){
 const check=async()=>{signal.throwIfAborted();guard();};await check();
 const file=path.join(root,'resource-access-config.json');let raw:Buffer|undefined;
 try{
  const regular=async()=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Resource configuration path changed');};await regular();
  raw=await readBoundedBytes(file,16384);if(!raw)throw Error();
  const config=resourcePermissionConfig.parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(raw),{maxBytes:16384}));
  if(!path.isAbsolute(config.observerProfile)||config.tenantId.toLowerCase()!==binding.tenantId.toLowerCase()||config.username.toLowerCase()!==binding.username.toLowerCase())throw Error();
  // A task-scoped collector must pin its entire expected target BEFORE reading
  // credentials or remote resources. Legacy observer-only callers omit it.
  if([binding.subject,binding.siteUrl,binding.siteCollectionId,binding.webId,binding.listIds].some(v=>v!==undefined)&&(!binding.subject||!binding.siteUrl||!binding.siteCollectionId||!binding.webId||!binding.listIds||config.subject.toLowerCase()!==binding.subject.toLowerCase()||config.siteUrl!==binding.siteUrl||config.siteCollectionId.toLowerCase()!==binding.siteCollectionId.toLowerCase()||config.webId.toLowerCase()!==binding.webId.toLowerCase()||JSON.stringify(config.listIds.map(v=>v.toLowerCase()).sort())!==JSON.stringify(binding.listIds.map(v=>v.toLowerCase()).sort())))throw Error('Configured resource observer differs from the task target');
  const owned=async()=>{await check();await regular();if(!raw!.equals(await readBoundedBytes(file,16384)??Buffer.alloc(0)))throw Error('Resource configuration changed');await regular();await check();};
  const acquire=await deps.credential(config,signal,owned);await owned();if(!acquire)throw Error();const credential=await acquire();await owned();
  const claims=z.object({tid:guid,oid:guid,aud:z.string(),exp:z.number().finite(),scp:z.string().min(1),upn:z.string().optional(),preferred_username:z.string().optional(),unique_name:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(credential.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));
  const origin=new URL(config.siteUrl).origin;
  if(credential.tenant.toLowerCase()!==config.tenantId.toLowerCase()||claims.tid.toLowerCase()!==config.tenantId.toLowerCase()||claims.oid.toLowerCase()!==config.subject.toLowerCase()||String(claims.preferred_username??claims.upn??claims.unique_name??'').toLowerCase()!==config.username.toLowerCase()||![origin,'00000003-0000-0ff1-ce00-000000000000'].includes(claims.aud)||!claims.scp.split(' ').includes('AllSites.Read'))throw Error();
  const routes=['web/currentuser?$select=LoginName','site?$select=Id','web?$select=Id,Url,EffectiveBasePermissions',...config.listIds.map(id=>`web/lists(guid'${id}')?$select=Id,BaseType,EffectiveBasePermissions`)];let total=0;
  const read=async(route:string)=>{await owned();if(!routes.includes(route)||claims.exp*1000<=Date.now()+30000)throw Error();const r=await deps.fetch(config.siteUrl+'/_api/'+route,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+credential.accessToken,Accept:'application/json;odata=verbose'}});await owned();if(!r.ok){await r.body?.cancel();throw Error();}const reader=r.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];try{for(;;){const part=await reader.read();await owned();if(part.done)break;size+=part.value.length;total+=part.value.length;if(size>256*1024||total>2*1024*1024)throw Error();chunks.push(part.value);}}finally{await reader.cancel();}return parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:256*1024});};
  const pass=async()=>{
   const user=z.object({d:z.object({LoginName:z.string()})}).parse(await read(routes[0])).d;
   if(user.LoginName.split('|').at(-1)?.toLowerCase()!==config.username.toLowerCase())throw Error();
   const site=z.object({d:z.object({Id:guid})}).parse(await read(routes[1])).d;
   const web=z.object({d:z.object({Id:guid,Url:z.string(),EffectiveBasePermissions:permissions})}).parse(await read(routes[2])).d;
   if(site.Id.toLowerCase()!==config.siteCollectionId.toLowerCase()||web.Id.toLowerCase()!==config.webId.toLowerCase()||web.Url!==config.siteUrl)throw Error();
   const lists=[];for(let i=0;i<config.listIds.length;i++){const list=z.object({d:z.object({Id:guid,BaseType:z.union([z.literal(0),z.literal(1)]),EffectiveBasePermissions:permissions})}).parse(await read(routes[i+3])).d;if(list.Id.toLowerCase()!==config.listIds[i].toLowerCase())throw Error();lists.push({id:list.Id,baseType:list.BaseType,permissions:decode(list.EffectiveBasePermissions)});}
   return{siteCollectionId:site.Id,webId:web.Id,siteUrl:web.Url,permissions:decode(web.EffectiveBasePermissions),lists};
  };
  const before=await pass(),after=await pass();await owned();if(JSON.stringify(before)!==JSON.stringify(after))throw Error();
  return{status:'observed',scope:'current-caller-resource-permission-metadata',tenantId:config.tenantId,username:config.username,subject:config.subject,observerOAuthScope:'AllSites.Read',complete:true,...after,writeApproved:false,operationEligibilityVerified:false,limits:['Effective permission metadata is observed only in this read-only observer application context','No dedicated write allowlist, delegated writer/connector rights, denied identity, tenant write or runtime approval','Existing site and library remain protected; flags do not authorize provisioning, content writes or permission changes']};
 }catch{await check();return{status:'unavailable',scope:'current-caller-resource-permission-metadata',complete:false,writeApproved:false,operationEligibilityVerified:false,reason:'Configured observer credentials, resource identity or permission metadata unavailable, incomplete or changed; no login, fallback, writes or grants'};}
}
