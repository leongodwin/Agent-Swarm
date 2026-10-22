import crypto from 'node:crypto';
import {z} from 'zod';
import {nativeDeniedCheckSchema} from '../shared/nativeQa.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const flowRun=z.object({flowRunId:z.uuid(),workflowId:z.uuid(),startTime:z.iso.datetime({offset:true}),status:z.string().min(1).max(100)});
// Native contracts: Microsoft Learn REST List Flow Runs (2024-10-01), and
// Power Platform for Admins V2 ListFlowRuns/FlowRun. This is provider inventory,
// not proof of complete dispatches: FlowRun lacks the trigger's RunIdentifier.
const pageSchema=z.object({value:z.array(flowRun).max(250),nextLink:z.string().min(1).max(8192).nullable().optional()});
export class FlowHistoryReadError extends Error{
 constructor(readonly category:'configuration'|'credentials'|'transport'|'http'|'response'|'pagination'|'persistence',readonly status?:number){super(`Flow history unavailable (${category}); no resubmit, sign-in or alternate identity`);this.name='FlowHistoryReadError';}
}
export interface FlowHistoryPage{
 schemaVersion:1;kind:'power-platform-flow-history-page';workflowId:string;environmentId:string;page:number;
 requestSha256:string;responseSha256:string;rows:z.infer<typeof flowRun>[];hasNext:boolean;observedAt:string;
}
/** Fixed authenticated GETs only; no summary SDK, top-N slicing, automatic retry
 * or token forwarding to foreign continuation URLs. Persist before next page. */
export async function readFlowProviderHistory(raw:unknown,credential:()=>Promise<{tenant:string;accessToken:string}>,signal:AbortSignal,owned:()=>Promise<void>,fetcher:typeof fetch=globalThis.fetch,persistPage?:(page:FlowHistoryPage,providerPage:unknown)=>Promise<void>){
 const check=nativeDeniedCheckSchema.parse(raw),scope=check.dispatchHistory,boundary=check.authorizationBoundary;
 if(!scope||!boundary)throw new FlowHistoryReadError('configuration');
 const guard=async()=>{signal.throwIfAborted();await owned();signal.throwIfAborted();};await guard();
 let bearer:string,expires:number;
 try{
  const token=await credential();await guard();
  const claims=z.object({tid:z.uuid(),oid:z.uuid(),aud:z.literal('https://api.powerplatform.com'),exp:z.number(),appid:z.uuid().optional(),azp:z.uuid().optional()}).parse(parseUnambiguousJson(Buffer.from(token.accessToken.split('.')[1],'base64url').toString('utf8'),{maxBytes:65536}));
  const clients=[claims.appid,claims.azp].filter((v):v is string=>!!v);
  if(token.tenant.toLowerCase()!==check.tenantId.toLowerCase()||claims.tid.toLowerCase()!==check.tenantId.toLowerCase()||claims.oid.toLowerCase()!==check.observerSubject.toLowerCase()||!clients.length||clients.some(v=>v.toLowerCase()!==boundary.observerClientId.toLowerCase())||claims.exp*1000<=Date.now()+30000)throw Error();
  bearer=token.accessToken;expires=claims.exp*1000;
 }catch{await guard();throw new FlowHistoryReadError('credentials');}
 const pages:FlowHistoryPage[]=[],seenRuns=new Set<string>();let count=0;
 for(const workflowId of scope.workflowIds){
  const initial=new URL(`https://api.powerplatform.com/powerautomate/environments/${scope.environmentId}/flowRuns`);
  initial.searchParams.set('workflowId',workflowId);initial.searchParams.set('api-version','2024-10-01');
  let url=initial.href;const seen=new Set<string>();
  for(let page=0;;page++){
   await guard();if(page>=100||seen.has(url))throw new FlowHistoryReadError('pagination');seen.add(url);
   if(expires<=Date.now()+30000)throw new FlowHistoryReadError('credentials');
   let response:Response;
   try{response=await fetcher(url,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+bearer,Accept:'application/json'}});}catch{await guard();throw new FlowHistoryReadError('transport');}
   await guard();if(!response.ok){await response.body?.cancel().catch(()=>{});await guard();throw new FlowHistoryReadError('http',response.status);}
   let parsed:z.infer<typeof pageSchema>,responseSha256:string,providerPage:unknown;
   try{
    if(response.status===204){parsed={value:[]};providerPage=null;responseSha256=hash(null);await response.body?.cancel();}
    else{
     const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;
     try{for(;;){const part=await reader.read();await guard();if(part.done)break;bytes+=part.value.length;if(bytes>2*1024*1024)throw Error();chunks.push(part.value);}}finally{await reader.cancel();}
     const body=parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),{maxBytes:2*1024*1024});
     // Reject explicit truncation and unknown continuation mechanisms; never
     // reinterpret missing data from an MCP summary as a terminal raw page.
     if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['value','nextLink','@odata.context'].includes(k)))throw Error();
     parsed=pageSchema.parse(body);providerPage=body;responseSha256=hash(body);
    }
   }catch{await guard();throw new FlowHistoryReadError('response');}
   await guard();for(const row of parsed.value){
    if(row.workflowId.toLowerCase()!==workflowId.toLowerCase()||seenRuns.has(row.flowRunId.toLowerCase())||Date.parse(row.startTime)>Date.now()+1000)throw new FlowHistoryReadError('response');
    seenRuns.add(row.flowRunId.toLowerCase());if(++count>10000)throw new FlowHistoryReadError('pagination');
   }
   const next=parsed.nextLink;
   if(next){
    let link:URL;try{link=new URL(next);}catch{throw new FlowHistoryReadError('pagination');}
    if(link.origin!==initial.origin||link.pathname!==initial.pathname||link.username||link.password||link.hash||link.port||/[\r\n\\]/.test(next)||link.searchParams.getAll('workflowId').length!==1||link.searchParams.get('workflowId')?.toLowerCase()!==workflowId.toLowerCase()||link.searchParams.getAll('api-version').length!==1||link.searchParams.get('api-version')!=='2024-10-01'||[...link.searchParams.keys()].some(k=>!['workflowId','api-version','$skiptoken','$skip','continuationToken'].includes(k)))throw new FlowHistoryReadError('pagination');
    if(seen.has(link.href))throw new FlowHistoryReadError('pagination');url=link.href;
   }
   const receipt:FlowHistoryPage={schemaVersion:1,kind:'power-platform-flow-history-page',workflowId,environmentId:scope.environmentId,page,requestSha256:hash([...seen].at(-1)),responseSha256,rows:parsed.value,hasNext:!!next,observedAt:new Date().toISOString()};
   if(persistPage)try{await persistPage(receipt,providerPage);await guard();}catch{await guard();throw new FlowHistoryReadError('persistence');}
   pages.push(receipt);if(!next)break;
  }
 }
 return{schemaVersion:1,kind:'power-platform-flow-run-inventory',environmentId:scope.environmentId,workflowIds:scope.workflowIds,pages,itemsObserved:count,paginationExhausted:true,pagesPersisted:!!persistPage,observedAt:new Date().toISOString(),completeDispatches:false,correlationVerified:false,retentionVerified:false,endBarrierVerified:false,limitation:'All returned pages were consumed. FlowRun inventory does not prove trigger correlation, retention, ingestion completeness or historical absence; never authorizes replay.'};
}
