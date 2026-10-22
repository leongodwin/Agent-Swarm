import fs from 'node:fs/promises';
import path from 'node:path';
import {PublicClientApplication,type AccountInfo,type AuthenticationResult,type INetworkModule} from '@azure/msal-node';
import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {readBoundedBytes} from './boundedJson.ts';

export const sharepointRestAuthSchema=z.strictObject({provider:z.literal('msal-silent'),tenantId:z.uuid(),clientId:z.uuid(),subject:z.uuid(),username:z.email(),homeAccountId:z.string().min(1).max(500),cacheFile:z.string().min(1).max(2000)});
export type SharepointRestAuth=z.infer<typeof sharepointRestAuthSchema>;
export class SharepointSilentAuthError extends Error{
 readonly providerCode:string|null;
 constructor(readonly category:'configuration-unavailable'|'cache-unavailable'|'account-unavailable'|'interaction-required'|'token-unavailable',code?:string){
  super(`SharePoint silent authentication blocked (${category}); use the configured app/account and existing consent; no interactive sign-in or alternate identity`);this.name='SharepointSilentAuthError';
  this.providerCode=code&&/^\d{5,8}$/.test(code)?code:null;
 }
}
/** Public-cloud OAuth only. No redirects, unbounded bodies or detached SDK HTTP. */
export function sharepointMsalNetwork(signal:AbortSignal,guard:()=>Promise<void>,fetcher:typeof fetch=globalThis.fetch):INetworkModule{
 const send=async<T>(url:string,options:{headers?:Record<string,string>;body?:string}|undefined,method:'GET'|'POST')=>{
  await guard();signal.throwIfAborted();const target=new URL(url);
  if(target.origin!=='https://login.microsoftonline.com'||target.username||target.password||target.hash||target.port)throw new Error('Unsupported identity authority');
  const response=await fetcher(target,{method,headers:options?.headers,body:method==='POST'?options?.body:undefined,redirect:'error',signal});
  await guard();signal.throwIfAborted();const reader=response.body?.getReader();if(!reader)throw Error('Identity response unavailable');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();await guard();signal.throwIfAborted();if(part.done)break;size+=part.value.length;if(size>1024*1024)throw Error('Identity response oversized');chunks.push(part.value);}}finally{await reader.cancel();}
  return{status:response.status,headers:Object.fromEntries(response.headers),body:parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:1024*1024}) as T};
 };
 return{sendGetRequestAsync:<T>(url:string,options?:{headers?:Record<string,string>})=>send<T>(url,options,'GET'),sendPostRequestAsync:<T>(url:string,options?:{headers?:Record<string,string>;body?:string})=>send<T>(url,options,'POST')};
}
type MsalClient={getTokenCache():{deserialize(value:string):void;getAllAccounts():Promise<AccountInfo[]>};acquireTokenSilent(request:{account:AccountInfo;scopes:string[]}):Promise<AuthenticationResult|null>};
type ClientFactory=(config:SharepointRestAuth,network:INetworkModule)=>MsalClient;
const defaultClient:ClientFactory=(config,network)=>new PublicClientApplication({auth:{clientId:config.clientId,authority:`https://login.microsoftonline.com/${config.tenantId}`},system:{networkClient:network,loggerOptions:{piiLoggingEnabled:false,loggerCallback:()=>{}}}});
async function regularBytes(file:string,max:number){
 if(!path.isAbsolute(file)||await fs.realpath(file)!==path.resolve(file)||(await fs.lstat(file)).isSymbolicLink()||!(await fs.lstat(file)).isFile())throw Error('Nonregular credential file');
 const bytes=await readBoundedBytes(file,max);if(!bytes)throw Error('Credential file absent');return bytes;
}
/** No cache plugin, writes, account chooser, first-account default or fallback.
 * Refreshes remain in memory; the existing provider owns its disk cache. */
async function acquireSilent(raw:unknown,origin:string,signal:AbortSignal,owned:()=>Promise<void>,factory:ClientFactory,graph:boolean,graphScope='Sites.Manage.All',graphUserRead=false,powerPlatform=false){
 const config=sharepointRestAuthSchema.parse(raw),site=new URL(origin);if(site.origin!==origin||site.protocol!=='https:'||!(powerPlatform?origin==='https://api.powerplatform.com':graph?origin==='https://graph.microsoft.com':/^https:\/\/[a-z0-9-]+[.]sharepoint[.]com$/.test(origin)))throw new SharepointSilentAuthError('configuration-unavailable');
 const guard=async()=>{signal.throwIfAborted();await owned();signal.throwIfAborted();};await guard();
 let cache:Buffer;try{cache=await regularBytes(config.cacheFile,2*1024*1024);}catch{await guard();throw new SharepointSilentAuthError('cache-unavailable');}
 await guard();let result:AuthenticationResult|null;
 try{
  const client=factory(config,sharepointMsalNetwork(signal,guard));client.getTokenCache().deserialize(new TextDecoder('utf-8',{fatal:true}).decode(cache));
  const accounts=await client.getTokenCache().getAllAccounts();await guard();
  const matches=accounts.filter(account=>account.tenantId.toLowerCase()===config.tenantId.toLowerCase()&&account.localAccountId.toLowerCase()===config.subject.toLowerCase()&&account.username.toLowerCase()===config.username.toLowerCase()&&account.homeAccountId===config.homeAccountId);
  if(matches.length!==1)throw new SharepointSilentAuthError('account-unavailable');
  result=await client.acquireTokenSilent({account:matches[0],scopes:[origin+(powerPlatform?'/.default':graph?'/'+graphScope:'/AllSites.Read'),...(graphUserRead?[origin+'/User.Read']:[])]});await guard();
 }catch(error){await guard();if(error instanceof SharepointSilentAuthError)throw error;const code=error&&typeof error==='object'&&'errorCode' in error?String(error.errorCode):'',providerCode=error instanceof Error?/\bAADSTS(\d{5,8}):/.exec(error.message)?.[1]:undefined;throw new SharepointSilentAuthError(['interaction_required','consent_required','login_required','invalid_grant'].includes(code)?'interaction-required':'token-unavailable',providerCode);}
 await guard();try{if(!cache.equals(await regularBytes(config.cacheFile,2*1024*1024)))throw Error();}catch{await guard();throw new SharepointSilentAuthError('cache-unavailable');}await guard();
 const account=result?.account;
 if(!result?.accessToken||!account||account.homeAccountId!==config.homeAccountId||account.localAccountId.toLowerCase()!==config.subject.toLowerCase()||account.tenantId.toLowerCase()!==config.tenantId.toLowerCase()||account.username.toLowerCase()!==config.username.toLowerCase())throw new SharepointSilentAuthError('account-unavailable');
 try{const claims=z.object({appid:z.string().optional(),azp:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(result.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));const clients=[claims.appid,claims.azp].filter((x):x is string=>x!==undefined);if(!clients.length||clients.some(x=>x.toLowerCase()!==config.clientId.toLowerCase()))throw Error();}catch{await guard();throw new SharepointSilentAuthError('token-unavailable');}
 return{tenant:config.tenantId,accessToken:result.accessToken};
}
export function acquireSharepointSilent(raw:unknown,origin:string,signal:AbortSignal,owned:()=>Promise<void>,factory:ClientFactory=defaultClient){return acquireSilent(raw,origin,signal,owned,factory,false);}
/** Separate API audience, using only existing customer-app consent. Never signs in. */
export function acquirePowerPlatformHistorySilent(raw:unknown,signal:AbortSignal,owned:()=>Promise<void>,factory:ClientFactory=defaultClient){return acquireSilent(raw,'https://api.powerplatform.com',signal,owned,factory,false,undefined,false,true);}
export async function configuredPowerPlatformHistorySilent(profile:string,expected:{tenantId:string;subject:string;username:string;clientId:string},signal:AbortSignal,guard:()=>Promise<void>){
 const file=path.join(profile,'power-platform-history-auth.json');await guard();let bytes:Buffer,config:SharepointRestAuth;
 try{bytes=await regularBytes(file,16384);config=sharepointRestAuthSchema.parse(parseUnambiguousJson(bytes.toString('utf8'),{maxBytes:16384}));}catch{await guard();throw new SharepointSilentAuthError('configuration-unavailable');}
 if(['tenantId','subject','username','clientId'].some(key=>config[key as keyof typeof expected].toLowerCase()!==expected[key as keyof typeof expected].toLowerCase()))throw new SharepointSilentAuthError('account-unavailable');
 const same=async()=>{await guard();try{if(!bytes.equals(await regularBytes(file,16384)))throw Error();}catch{await guard();throw new SharepointSilentAuthError('configuration-unavailable');}await guard();};
 await same();const token=await acquirePowerPlatformHistorySilent(config,signal,same);await same();return token;
}
/** Dedicated schema scope only; no interactive sign-in or observer configuration changes. */
export function acquireGraphSchemaSilent(raw:unknown,signal:AbortSignal,owned:()=>Promise<void>,factory:ClientFactory=defaultClient){return acquireSilent(raw,'https://graph.microsoft.com',signal,owned,factory,true);}
/** Explicit single-user native test apps. No scope escalation, interactive login or cache writes. */
export function acquireGraphNativeSilent(raw:unknown,scope:'Sites.Selected'|'Sites.Read.All'|'Sites.Manage.All',signal:AbortSignal,owned:()=>Promise<void>,factory:ClientFactory=defaultClient){
 if(!['Sites.Selected','Sites.Read.All','Sites.Manage.All'].includes(scope))throw new SharepointSilentAuthError('configuration-unavailable');
 return acquireSilent(raw,'https://graph.microsoft.com',signal,owned,factory,true,scope,true);
}
/** This metadata lives only in the office-owned isolated profile directory. */
export async function configuredGraphNativeSilent(profile:string,expected:{tenantId:string;subject:string;username:string;clientId:string},scope:'Sites.Selected'|'Sites.Read.All'|'Sites.Manage.All',signal:AbortSignal,guard:()=>Promise<void>){
 const file=path.join(profile,'graph-native-auth.json');await guard();let bytes:Buffer,config:SharepointRestAuth;
 try{bytes=await regularBytes(file,16384);config=sharepointRestAuthSchema.parse(parseUnambiguousJson(bytes.toString('utf8'),{maxBytes:16384}));}
 catch{throw new SharepointSilentAuthError('configuration-unavailable');}
 if(['tenantId','subject','username','clientId'].some(key=>config[key as keyof typeof expected].toLowerCase()!==expected[key as keyof typeof expected].toLowerCase()))throw new SharepointSilentAuthError('account-unavailable');
 const same=async()=>{await guard();try{if(!bytes.equals(await regularBytes(file,16384)))throw Error();}catch{throw new SharepointSilentAuthError('configuration-unavailable');}await guard();};
 await same();const token=await acquireGraphNativeSilent(config,scope,signal,same);await same();return token;
}
/** File belongs to the server's isolated observer profile, never the project. */
export async function configuredSharepointSilent(profile:string,expected:{tenantId:string;observerSubject:string;observerUsername:string},origin:string,signal:AbortSignal,guard:()=>Promise<void>){
 const file=path.join(profile,'sharepoint-rest-auth.json');await guard();
 try{await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new SharepointSilentAuthError('configuration-unavailable');}
 let bytes:Buffer,config:SharepointRestAuth;
 try{bytes=await regularBytes(file,16384);config=sharepointRestAuthSchema.parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:16384}));}catch{await guard();throw new SharepointSilentAuthError('configuration-unavailable');}
 if(config.tenantId.toLowerCase()!==expected.tenantId.toLowerCase()||config.subject.toLowerCase()!==expected.observerSubject.toLowerCase()||config.username.toLowerCase()!==expected.observerUsername.toLowerCase())throw new SharepointSilentAuthError('account-unavailable');
 await guard();return async()=>{await guard();const same=async()=>{await guard();try{if(!bytes.equals(await regularBytes(file,16384)))throw Error();}catch{await guard();throw new SharepointSilentAuthError('configuration-unavailable');}await guard();};await same();const result=await acquireSharepointSilent(config,origin,signal,same);await same();return result;};
}
