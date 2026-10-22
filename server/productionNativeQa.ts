import {configuredSharepointSilent,configuredGraphNativeSilent,configuredPowerPlatformHistorySilent,SharepointSilentAuthError} from './sharepointRestAuth.ts';
import {readFlowProviderHistory,FlowHistoryReadError} from './flowProviderHistory.ts';
import {readSharepointProviderHistory,SharepointHistoryHttpError,SharepointHistoryCredentialError} from './sharepointProviderHistory.ts';
import {collectNativeDelta} from './nativeHistory.ts';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {nativeDeniedCheckSchema,nativeQaContextSchema,type NativeDeniedCheck} from '../shared/nativeQa.ts';
import type {NativeDeniedFactory,NativeDeniedAuthority} from './nativeDeniedAccess.ts';
export type NativeTokenCommand=(command:{executable:string;args:string[]},cwd:string,env:Record<string,string>,signal:AbortSignal)=>Promise<string>;
const guid=z.uuid();
export const nativeTargetHash=(check:Pick<NativeDeniedCheck,'tenantId'|'target'>)=>crypto.createHash('sha256').update(JSON.stringify({tenantId:check.tenantId.toLowerCase(),target:check.target})).digest('hex');
/** Lossless 64-character encoding for the dedicated request column; receipts keep
 * the original run:attempt key. Never truncate a UUID or an existing claim. */
export function nativeRequestCorrelation(key:string){const parts=key.split(':');if(parts.length!==2||parts.some(p=>!guid.safeParse(p).success))throw Error('Native request correlation invalid');return parts.map(p=>p.replaceAll('-','').toLowerCase()).join('');}
export function nativeDeniedFields(check:NativeDeniedCheck,key:string){return check.contract.operation==='create-request'?{Title:'Agent Swarm denied-access verification',RequestLabel:'CF-DENIED-PROBE',RequestCorrelation:nativeRequestCorrelation(key),ProbeStatus:'New',AttemptCount:0}:{Title:'Agent Swarm denied-access verification',RunIdentifier:key,RecordClass:'Live',SwarmStatus:'New'};}
/** Preflight is read-only; execution permits one fixed correlated create. A token accepted by Graph /me, not a supplied
 * subject or unverified JWT alone, establishes the caller. Never switches az
 * profiles or silently signs in. One cached account cannot represent two roles. */
export function createProductionNativeQa(run:NativeTokenCommand,fetcher:typeof fetch=globalThis.fetch):NativeDeniedFactory{
 return async(raw,signal,authority)=>{
  const check=nativeDeniedCheckSchema.parse(raw);
  if(!authority)throw new Error('Native adapter requires server-owned execution authority');
  let closed=false,attempted=false;let historyAnchor=authority.historyCheckpoint;
  const guard=async()=>{signal.throwIfAborted();if(closed)throw new Error('Native Graph context closed');await authority.owned();signal.throwIfAborted();if(closed)throw new Error('Native Graph context closed');};
  await guard();
  if(!check.target||nativeTargetHash(check)!==check.targetSha256)throw new Error('Approved native site/list target binding is missing or differs');
  const accounts=new Map<string,{token:string;expires:number;subject:string;username:string;scopes:string[];clientId?:string}>();
  const request=async(account:{token:string;expires:number},resource:string)=>{
   await guard();if(closed||account.expires<=Date.now()+30000)throw new Error('Native Graph context closed or expired');
   if(!/^me[?]|^sites\//.test(resource)||resource.includes('..')||/[\\\r\n#]/.test(resource))throw new Error('Native Graph read resource is invalid');
   let response:Response;try{response=await fetcher('https://graph.microsoft.com/v1.0/'+resource,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+account.token,Accept:'application/json'}});}catch{throw new Error('Native Graph read interrupted; provider content withheld');}
   await guard();if(!response.ok)throw new Error('Native Graph identity/target read refused ('+response.status+'); content withheld');
   const reader=response.body?.getReader();if(!reader)throw new Error('Native Graph body unavailable');const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const item=await reader.read();await guard();if(item.done)break;size+=item.value.length;if(size>2*1024*1024)throw new Error('Native Graph response oversized');chunks.push(item.value);}}finally{await reader.cancel();}
   return parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:2*1024*1024});
  };
  const account=async(role:'denied'|'observer')=>{
   await guard();
   const username=role==='denied'?check.deniedUsername:check.observerUsername,subject=role==='denied'?check.deniedSubject:check.observerSubject;
   let result=accounts.get(role);
   if(!result){
    if(!authority.credentialRoot)throw new Error('Isolated native identity cache root is unavailable');
    const cache=path.resolve(authority.credentialRoot,role==='denied'?check.deniedIdentity:check.observerIdentity);
    const real=await fs.realpath(cache).catch(()=>null);if(!real||real.toLowerCase()!==cache.toLowerCase()||!(await fs.stat(real)).isDirectory())throw new Error('Isolated native identity cache is unavailable or linked; authenticate this identity separately');
    await guard();let raw:string;const boundary=check.authorizationBoundary,clientId=boundary?(role==='denied'?boundary.deniedClientId:boundary.observerClientId):undefined;
    try{raw=boundary?JSON.stringify(await configuredGraphNativeSilent(cache,{tenantId:check.tenantId,subject,username,clientId:clientId!},role==='denied'?'Sites.Selected':(boundary.observerGraphScope??'Sites.Read.All'),signal,guard)):await run({executable:'az',args:['account','get-access-token','--resource','https://graph.microsoft.com','--tenant',check.tenantId,'--output','json']},authority.cwd,{AZURE_CONFIG_DIR:cache},signal);}catch{await guard();throw new Error('Native delegated credentials unavailable; provider output withheld');}await guard();
    try{const token=z.object({accessToken:z.string(),tenant:z.string()}).parse(parseUnambiguousJson(raw,{maxBytes:65536}));const claims=z.object({aud:z.string(),tid:guid,oid:guid,exp:z.number(),scp:z.string().min(1),appid:guid.optional(),azp:guid.optional(),preferred_username:z.string().optional(),upn:z.string().optional(),unique_name:z.string().optional()}).parse(JSON.parse(Buffer.from(token.accessToken.split('.')[1],'base64url').toString('utf8')));
     if(token.tenant.toLowerCase()!==check.tenantId.toLowerCase()||claims.tid.toLowerCase()!==check.tenantId.toLowerCase()||claims.oid.toLowerCase()!==subject.toLowerCase()||String(claims.preferred_username??claims.upn??claims.unique_name??'').toLowerCase()!==username.toLowerCase()||!['https://graph.microsoft.com','00000003-0000-0000-c000-000000000000'].includes(claims.aud)||claims.exp*1000<=Date.now()+30000)throw new Error();
     const scopes=claims.scp.split(' '),clients=[claims.appid,claims.azp].filter((v):v is string=>!!v);
     if(boundary&&(!clients.length||clients.some(v=>v.toLowerCase()!==clientId!.toLowerCase())||(role==='denied'&&(!scopes.includes('Sites.Selected')||scopes.some(v=>!['User.Read','Sites.Selected','openid','profile','email','offline_access'].includes(v))))))throw Error();
     result={token:token.accessToken,expires:claims.exp*1000,subject,username,scopes,...(clientId?{clientId}:{})};
    }catch{throw new Error('Native delegated token tenant/subject/account/audience/expiry differs; no profile substitution');}
   }
   const me=z.object({id:guid,userPrincipalName:z.string()}).parse(await request(result,'me?$select=id,userPrincipalName'));
   if(me.id.toLowerCase()!==subject.toLowerCase()||me.userPrincipalName.toLowerCase()!==username.toLowerCase())throw new Error('Native Graph authenticated subject/account differs');
   accounts.set(role,result);return result;
  };
  const validateTarget=async()=>{
   const actor=await account('observer'),target=check.target!,host=new URL(target.siteUrl).hostname,siteId=`${host},${target.siteCollectionId},${target.webId}`;
   const site=z.object({id:z.string(),webUrl:z.string(),sharepointIds:z.object({tenantId:guid,siteId:guid,webId:guid})}).parse(await request(actor,`sites/${siteId}?$select=id,webUrl,sharepointIds`));
   if(site.id.toLowerCase()!==siteId.toLowerCase()||site.webUrl!==target.siteUrl||site.sharepointIds.tenantId.toLowerCase()!==check.tenantId.toLowerCase()||site.sharepointIds.siteId.toLowerCase()!==target.siteCollectionId.toLowerCase()||site.sharepointIds.webId.toLowerCase()!==target.webId.toLowerCase())throw new Error('Native Graph site binding differs');
   const list=z.object({id:guid,webUrl:z.url(),list:z.object({template:z.literal('genericList')})}).parse(await request(actor,`sites/${siteId}/lists/${target.listId}?$select=id,webUrl,list`));const u=new URL(list.webUrl),siteUrl=new URL(target.siteUrl);
   if(list.id.toLowerCase()!==target.listId.toLowerCase()||u.origin!==siteUrl.origin||!u.pathname.startsWith(siteUrl.pathname+'/'))throw new Error('Native Graph list binding differs');
   if(check.contract.operation==='create-request'){
    const metadata=z.object({value:z.array(z.object({name:z.string(),required:z.boolean().optional(),readOnly:z.boolean().optional(),text:z.object({maxLength:z.number(),allowMultipleLines:z.boolean().optional()}).nullish(),choice:z.object({choices:z.array(z.string()),allowTextEntry:z.boolean().optional()}).nullish(),number:z.object({decimalPlaces:z.string(),minimum:z.number().optional(),maximum:z.number().optional()}).nullish()})).max(200),'@odata.nextLink':z.never().optional()}).parse(await request(actor,`sites/${siteId}/lists/${target.listId}/columns?$select=name,required,readOnly,text,choice,number&$top=200`));
    const column=(name:string)=>{const matches=metadata.value.filter(c=>c.name===name);if(matches.length!==1||matches[0].required!==true||matches[0].readOnly!==false||[matches[0].text,matches[0].choice,matches[0].number].filter(Boolean).length!==1)throw Error('Native request schema differs');return matches[0];};
    if(column('Title').text?.maxLength!==255||column('RequestLabel').text?.maxLength!==120||column('RequestCorrelation').text?.maxLength!==64||['Title','RequestLabel','RequestCorrelation'].some(name=>column(name).text?.allowMultipleLines!==false)||column('AttemptCount').number?.decimalPlaces!=='none'||(column('AttemptCount').number?.minimum??0)>0||(column('AttemptCount').number?.maximum??0)<0||metadata.value.some(c=>c.required===true&&!['Title','RequestLabel','RequestCorrelation','ProbeStatus','AttemptCount'].includes(c.name)))throw Error('Native request schema differs');
    const choice=column('ProbeStatus').choice;if(!choice||choice.allowTextEntry===true||choice.choices.length!==3||new Set(choice.choices).size!==3||!['New','Processed','Failed'].every(value=>choice.choices.includes(value)))throw Error('Native request status schema differs');
   }
  };
  const attempt=async(correlationKey:string)=>{
   if(authority.phase!=='execution')throw new Error('Native writes unsupported outside execution authority');
   const context=nativeQaContextSchema.parse(authority.context),parts=correlationKey.split(':');
   if(parts.length!==2||parts[0]!==context.runId||!guid.safeParse(parts[1]).success)throw new Error('Native correlation differs from execution run/attempt');
   if(attempted)throw new Error('Native create already attempted or reserved; reconciliation required');
   // Latch before the first await: ambiguous failures and concurrent calls never retry.
   attempted=true;
   await guard();await validateTarget();const actor=await account('denied');
   if(check.authorizationBoundary){
    const target=check.target!,siteId=`${new URL(target.siteUrl).hostname},${target.siteCollectionId},${target.webId}`;
    const list=z.object({id:guid}).parse(await request(actor,`sites/${siteId}/lists/${target.listId}?$select=id`));
    if(list.id.toLowerCase()!==target.listId.toLowerCase())throw Error('Selected app cannot read the exact approved target');
   }else if(!actor.scopes.includes('Sites.ReadWrite.All'))throw new Error('Native denied-create requires delegated write scope; missing scope is not resource denial');
   await guard();
   const target=check.target!,siteId=`${new URL(target.siteUrl).hostname},${target.siteCollectionId},${target.webId}`;
   // Fixed reviewed operation payload; request schema is verified before dispatch.
   const body=JSON.stringify({fields:nativeDeniedFields(check,correlationKey)});
   let response:Response;
   try{response=await fetcher(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${target.listId}/items`,{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+actor.token,Accept:'application/json','Content-Type':'application/json'},body});}
   catch{throw new Error('Native create outcome unknown; reconciliation required; provider content withheld');}
   try{await response.body?.cancel();}
   catch{throw new Error('Native create response cleanup uncertain; reconciliation required; provider content withheld');}
   await guard();
   return{status:response.status,targetSha256:check.targetSha256,subject:actor.subject,correlationKey};
  };
  const observeDispatch=async()=>{
   await guard();
   if(!check.dispatchHistory||!check.authorizationBoundary)return{status:'blocked',completeDispatches:false,reason:'Pin exact reviewed environment and workflow IDs before dispatch-history collection; display-name inventory does not establish coverage'};
   try{
    const profile=path.resolve(authority.credentialRoot!,check.observerIdentity),boundary=check.authorizationBoundary;
    return await readFlowProviderHistory(check,()=>configuredPowerPlatformHistorySilent(profile,{tenantId:check.tenantId,subject:check.observerSubject,username:check.observerUsername,clientId:boundary.observerClientId},signal,guard),signal,guard,fetcher,authority.persistDispatchHistoryPage);
   }catch(error){await guard();return{status:'unavailable',completeDispatches:false,...(error instanceof SharepointSilentAuthError?{credentialCategory:error.category,providerCode:error.providerCode}:{}),...(error instanceof FlowHistoryReadError?{category:error.category,httpStatus:error.status}:{}),reason:'Raw flow-history credentials, pinned scope or coverage unavailable; no top-N fallback or resubmission'};}
  };
  return {async capabilities(){await guard();const actor=await account('denied');await validateTarget();const write=check.authorizationBoundary?actor.scopes.includes('Sites.Selected'):actor.scopes.includes('Sites.ReadWrite.All');return{contract:'native-denied-create-v1',authenticatedIdentity:true,deniedCreate:write,exactCorrelation:write,completeWrites:false,completeDispatches:false};},async identity(role){const actor=await account(role);return{tenantId:check.tenantId,subject:actor.subject,username:actor.username,...(actor.clientId?{clientId:actor.clientId}:{}),authenticated:true,audience:'native-target',targetSha256:check.targetSha256};},observe:async(correlationKey:string)=>{await guard();await validateTarget();const actor=await account('observer'),target=check.target!,siteId=`${new URL(target.siteUrl).hostname},${target.siteCollectionId},${target.webId}`;const delta=await collectNativeDelta(`sites/${siteId}/lists/${target.listId}/items/delta`,resource=>request(actor,resource),guard);let providerHistory:unknown;try{const profile=path.resolve(authority.credentialRoot!,check.observerIdentity),credential=await configuredSharepointSilent(profile,check,new URL(check.target!.siteUrl).origin,signal,guard);providerHistory=await readSharepointProviderHistory(check,run,authority.cwd,{AZURE_CONFIG_DIR:profile},signal,guard,fetcher,credential,{anchor:historyAnchor,savePage:authority.persistSharepointHistoryPage,saveAnchor:async checkpoint=>{await authority.persistHistoryCheckpoint?.(checkpoint);await guard();historyAnchor=checkpoint;}});}catch(error){await guard();providerHistory={status:'unavailable',...(error instanceof SharepointSilentAuthError?{credentialCategory:error.category,providerCode:error.providerCode}:{}),...((error instanceof SharepointHistoryHttpError||error instanceof SharepointHistoryCredentialError)?{diagnostic:error.diagnostic}:{}),completeWrites:false,completeDispatches:false,reason:'Provider change-log credentials, identity, scope or coverage unavailable; native details withheld'};}const dispatchHistory=await observeDispatch();await guard();return{targetSha256:check.targetSha256,correlationKey,...delta,providerHistory,dispatchHistory};},attempt,async close(){closed=true;accounts.clear();}};
 };
}
export async function inspectProductionNativeQa(check:NativeDeniedCheck,signal:AbortSignal,authority:NativeDeniedAuthority,run:NativeTokenCommand,fetcher?:typeof fetch){
 let adapter:Awaited<ReturnType<NativeDeniedFactory>>|undefined;
 try{adapter=await createProductionNativeQa(run,fetcher)(check,signal,authority);const capabilities=await adapter.capabilities();return{status:'blocked',capabilities,reason:'Complete authoritative historical write/dispatch observations are unavailable; execution also requires isolated identities and a retained run claim'};}finally{await adapter?.close();}
}
