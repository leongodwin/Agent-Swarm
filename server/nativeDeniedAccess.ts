import {validateSharepointHistoryCheckpoint} from './sharepointProviderHistory.ts';
import {beginNativeCapture,inspectNativeCapture,nativeCaptureBindingSchema,nativeCaptureReceiptSchema} from './nativeHistoryCapture.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {nativeClaimSchema,reserveNativeClaim,verifyNativeSuccessorCopy} from './nativeClaimReconciliation.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {nativeDeniedCheckSchema,nativeQaContextSchema,deniedAssertionSchema,type NativeDeniedCheck,type NativeQaContext} from '../shared/nativeQa.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeObservedIdentitySchema=z.strictObject({tenantId:z.uuid(),subject:z.uuid(),username:z.email(),clientId:z.uuid().optional(),authenticated:z.literal(true),audience:z.literal('native-target'),targetSha256:hash});
/** New mode tests application permission isolation, never separation of human users. */
export function nativeIdentityClientMatches(check:NativeDeniedCheck,role:'denied'|'observer',row:z.infer<typeof nativeObservedIdentitySchema>){
 const boundary=check.authorizationBoundary;
 return !boundary||row.clientId?.toLowerCase()===(role==='denied'?boundary.deniedClientId:boundary.observerClientId).toLowerCase();
}
const identity=nativeObservedIdentitySchema;
const denialResponse=z.strictObject({status:z.literal(403),targetSha256:hash,subject:z.uuid(),correlationKey:z.string()});
const observedIdentity=z.strictObject({role:z.enum(['denied','observer']),observedAt:z.iso.datetime(),identity});
export const nativeCompleteCapabilitiesSchema=z.strictObject({contract:z.literal('native-denied-create-v1'),authenticatedIdentity:z.literal(true),deniedCreate:z.literal(true),exactCorrelation:z.literal(true),completeWrites:z.literal(true),completeDispatches:z.literal(true)});
export const nativeSnapshotSchema=z.strictObject({targetSha256:hash,correlationKey:z.string(),complete:z.literal(true),visible:z.literal(true),from:z.iso.datetime(),through:z.iso.datetime(),writes:z.array(z.string().min(1).max(200)).max(1000),dispatches:z.array(z.string().min(1).max(200)).max(1000)});
const capabilities=nativeCompleteCapabilitiesSchema,snapshot=nativeSnapshotSchema;
/** Implemented by trusted server adapters only, never project scripts or reports.
 * complete requires exhausted pagination and authoritative freshness/visibility,
 * including all historical effects since from even if later deleted. Current
 * list counts or snapshots cannot prove this temporal absence contract.
 * Summarized top-N flow history cannot implement this interface. */
export interface NativeDeniedAdapter{
 capabilities():Promise<unknown>;
 identity(role:'denied'|'observer'):Promise<unknown>;
 observe(correlationKey:string):Promise<unknown>;
 attempt(correlationKey:string):Promise<unknown>;
 close():Promise<void>;
}
export interface NativeDeniedAuthority{phase:'preflight'|'execution'|'reconciliation';context?:NativeQaContext;cwd:string;credentialRoot?:string;owned:()=>Promise<void>;historyCheckpoint?:unknown;persistHistoryCheckpoint?:(checkpoint:unknown)=>Promise<void>;persistSharepointHistoryPage?:(page:import('./sharepointProviderHistory.ts').SharepointHistoryPage)=>Promise<void>;persistDispatchHistoryPage?:(page:import('./flowProviderHistory.ts').FlowHistoryPage,providerPage:unknown)=>Promise<void>}
export type NativeDeniedFactory=(check:NativeDeniedCheck,signal:AbortSignal,authority?:NativeDeniedAuthority)=>Promise<NativeDeniedAdapter>;
async function durable(file:string,value:unknown){
 const handle=await fs.open(file,'wx');try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
}
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Exactly one attempt; ambiguous transport/cleanup outcomes remain blocked.
 * Absence is bounded to the observed interval, never a permanent no-effect claim. */
export async function verifyNativeDeniedAccess(raw:unknown,rawContext:unknown,evidence:string,connect:NativeDeniedFactory,signal:AbortSignal,owned:()=>Promise<void>,clock:{now:()=>number;mono:()=>number;wait:(ms:number,s:AbortSignal)=>Promise<void>}={now:()=>Date.now(),mono:()=>performance.now(),wait:(ms:number,s:AbortSignal)=>delay(ms,undefined,{signal:s})},claimRoot=evidence,captureOptions?:{leaseSha256:string}){
 const check=nativeDeniedCheckSchema.parse(raw),context=nativeQaContextSchema.parse(rawContext),attemptId=crypto.randomUUID();
 const logicalKey=digest({tenantId:check.tenantId.toLowerCase(),targetSha256:check.targetSha256,operation:check.contract.operation});
 const correlationKey=`${context.runId}:${attemptId}`,prefix=`native-denied-${attemptId}`,contractHash=digest(check),start=clock.mono();
 let adapter:NativeDeniedAdapter|undefined,intent=false,attempted=false,denied=false,cleanup=false,success=false;
 let windowStartedAt:string|undefined,windowEndedAt:string|undefined,observationElapsedMs:number|undefined,denialReceipt:z.infer<typeof denialResponse>|undefined;
 let capture:Awaited<ReturnType<typeof beginNativeCapture>>|undefined,captured: {binding:z.infer<typeof nativeCaptureBindingSchema>;receipt:z.infer<typeof nativeCaptureReceiptSchema>}|undefined;
 const captureBinding=captureOptions?nativeCaptureBindingSchema.parse({id:attemptId,context,leaseSha256:captureOptions.leaseSha256,contractHash,targetSha256:check.targetSha256,correlationKey}):undefined;
 const observedIdentities:z.infer<typeof observedIdentity>[]=[];
 const observations:{snapshot:z.infer<typeof snapshot>;sha256:string}[]=[];
 const coverageStart=clock.now();
 const guard=async()=>{signal.throwIfAborted();await owned();signal.throwIfAborted();const wall=clock.now();if(!Number.isFinite(wall)||wall<Date.parse(context.startedAt))throw new Error('Native denial wall clock inconsistent');const elapsed=clock.mono()-start;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>check.contract.observationWindowMs+60000)throw new Error('Native denial deadline expired');};
 const identities=async()=>{for(const role of ['denied','observer'] as const){await guard();const row=identity.parse(await adapter!.identity(role));await guard();if(!nativeIdentityClientMatches(check,role,row)||row.tenantId.toLowerCase()!==check.tenantId.toLowerCase()||row.subject.toLowerCase()!==(role==='denied'?check.deniedSubject:check.observerSubject).toLowerCase()||row.username.toLowerCase()!==(role==='denied'?check.deniedUsername:check.observerUsername).toLowerCase()||row.targetSha256!==check.targetSha256)throw new Error('Native denial identity or target differs');observedIdentities.push({role,observedAt:new Date(clock.now()).toISOString(),identity:row});}};
 const observe=async(minThrough:number)=>{await guard();const row=snapshot.parse(await adapter!.observe(correlationKey));await guard();await capture?.append('observation',{snapshot:row});if(row.targetSha256!==check.targetSha256||row.correlationKey!==correlationKey||Date.parse(row.from)>coverageStart||Date.parse(row.from)>Date.parse(row.through)||Date.parse(row.through)<minThrough||Date.parse(row.through)>clock.now()+1000||row.writes.length||row.dispatches.length)throw new Error('Native denial effects, freshness or correlation unverified');observations.push({snapshot:row,sha256:digest(row)});};
 await guard();await fs.mkdir(evidence,{recursive:true});
 try{
  if(captureBinding)capture=await beginNativeCapture(path.join(claimRoot,'captures'),captureBinding,guard);
  let checkpointSaved=false;
  adapter=await connect(check,signal,{phase:'execution',context,cwd:evidence,owned,persistHistoryCheckpoint:async raw=>{
   await guard();if(!capture||checkpointSaved)throw Error('One durable native history checkpoint required');
   const checkpoint=validateSharepointHistoryCheckpoint(raw,check,context.startedAt);
   await capture.append('provider-checkpoint',{checkpoint});await guard();checkpointSaved=true;
  },persistSharepointHistoryPage:async page=>{await guard();if(!capture)throw Error('Durable provider page capture required');await capture.append('provider-history-page',{page});await guard();},persistDispatchHistoryPage:async(page,providerPage)=>{await guard();if(!capture)throw Error('Durable dispatch capture required');await capture.append('dispatch-history-page',{page,providerPage});await guard();}});await guard();capabilities.parse(await adapter.capabilities());await guard();await capture?.append('connected',{});await identities();
  await observe(clock.now());await guard();
  if(check.target&&capture&&!checkpointSaved)throw Error('Targeted native execution requires its durable pre-claim history checkpoint');
  const claim={schemaVersion:1,logicalKey,context,check,contractHash,attemptId,correlationKey,state:'reserved-or-unknown',observedAt:new Date(clock.now()).toISOString()};
  await fs.mkdir(claimRoot,{recursive:true});
  // Exclusive machine-wide target/operation claim is never auto-reclaimed, even
  // after success. Independent reconciliation is required before another write.
  const reservation=await reserveNativeClaim(claimRoot,claim,guard);await guard();await capture?.append('claim',{claimSha256:digest(reservation.claim)});
  await durable(path.join(evidence,prefix+'-claim.json'),reservation.claim);await guard();
  const reconciliationFiles:string[]=[];
  if(reservation.previous&&reservation.authorization){await durable(path.join(evidence,prefix+'-previous.json'),reservation.previous);await guard();await durable(path.join(evidence,prefix+'-authorization.json'),reservation.authorization);await guard();reconciliationFiles.push(prefix+'-previous.json',prefix+'-authorization.json');}
  await durable(path.join(evidence,prefix+'-intent.json'),{schemaVersion:1,context,check,contractHash,attemptId,correlationKey,state:'dispatched-or-unknown',observedAt:new Date(clock.now()).toISOString()});intent=true;
  await identities();await guard();await capture?.append('attempt-intent',{});attempted=true;
  const response=z.strictObject({status:z.number().int(),targetSha256:hash,subject:z.uuid(),correlationKey:z.string()}).parse(await adapter.attempt(correlationKey));await guard();
  await capture?.append('attempt-response',response);
  if(response.status!==403||response.targetSha256!==check.targetSha256||response.subject.toLowerCase()!==check.deniedSubject.toLowerCase()||response.correlationKey!==correlationKey)throw new Error('Authenticated denial is unverified');denialReceipt=denialResponse.parse(response);denied=true;
  const observedStart=clock.mono(),wallStart=clock.now();windowStartedAt=new Date(wallStart).toISOString();
  do{await identities();await observe(clock.now());await guard();const elapsed=clock.mono()-observedStart;if(!Number.isFinite(elapsed)||elapsed<0||clock.now()<wallStart)throw new Error('Native denial observation clock inconsistent');if(elapsed>=check.contract.observationWindowMs){observationElapsedMs=Math.floor(elapsed);break;}await clock.wait(Math.min(check.contract.pollIntervalMs,check.contract.observationWindowMs-elapsed),signal);}while(true);
  await identities();windowEndedAt=new Date(clock.now()).toISOString();await observe(Date.parse(windowEndedAt));await guard();await adapter.close();cleanup=true;await guard();if(capture&&captureBinding){await capture.append('cleanup',{verified:true});captured={binding:captureBinding,receipt:await capture.seal('candidate')};}
  await durable(path.join(evidence,prefix+'-result.json'),{schemaVersion:1,context,check,contractHash,attemptId,correlationKey,denialReceipt,observedIdentities,windowStartedAt,windowEndedAt,observationElapsedMs,...(captured?{capture:captured}:{}),status:'unreviewed-candidate',assertionsPassed:true,assertions:check.contract.assertions,observations,observationWindowMs:check.contract.observationWindowMs,cleanupVerified:true,limitation:'No correlated write or dispatch observed in complete authoritative scans during this bounded interval only'});await guard();success=true;
  return [prefix+'-claim.json',prefix+'-intent.json',prefix+'-result.json',...reconciliationFiles];
 }catch{
  throw new Error('Native denied-access verification blocked; inspect the bound journal and adapter prerequisites, never retry an ambiguous attempt blindly');
 }finally{
  if(adapter&&!cleanup){try{await adapter.close();cleanup=true;}catch{/* Retained failure cannot certify cleanup. */}}
  if(!success&&capture&&!captured){try{await capture.append('cleanup',{verified:cleanup});await capture.seal('blocked');}catch{/* Missing seal is an explicit gap, never a reconstructed success. */}}
  if(!success)await durable(path.join(evidence,prefix+'-failure.json'),{schemaVersion:1,context,contractHash,attemptId,correlationKey,intent,attempted,authenticatedDenial:denied,passed:false,outcome:attempted?'dispatched-or-unknown':'not-attempted',cleanupVerified:cleanup,observations});
 }
}


/** Validate the runner-owned observations again when building QA evidence.
 * File presence, a passed flag, a browser message or an author's report cannot
 * replace the complete bound denial/temporal absence receipts. */
export async function nativeDeniedEvidence(plan:{verification:{nativeDeniedChecks?:NativeDeniedCheck[]};deliveryRecord?:{sha256:string}},context:NativeQaContext,read:(file:string)=>Promise<Buffer>,claimRoot?:string,captureLeaseSha256?:string){
 const expected=(plan.verification.nativeDeniedChecks??[]).map(c=>nativeDeniedCheckSchema.parse(c));if(!expected.length)return [];
 context=nativeQaContextSchema.parse(context);
 const json=async(file:string)=>parseUnambiguousJson((await read(file)).toString('utf8'),{maxBytes:2*1024*1024});
 const index=z.strictObject({schemaVersion:z.literal(1),entries:z.array(z.strictObject({testName:z.string(),files:z.union([z.tuple([z.string(),z.string(),z.string()]),z.tuple([z.string(),z.string(),z.string(),z.string(),z.string()])])})).max(20)}).parse(await json('native-denied-index.json'));
 if(index.entries.length!==expected.length||new Set(index.entries.map(e=>e.testName)).size!==expected.length)throw new Error('Native denial evidence scope differs');
 const files=['native-denied-index.json'];
 for(const check of expected){
  const entry=index.entries.find(e=>e.testName===check.testName);if(!entry)throw new Error('Native denied check missing');
  const match=/^native-denied-([a-f0-9-]{36})-claim\.json$/.exec(entry.files[0]);if(!match||entry.files[1]!==`native-denied-${match[1]}-intent.json`||entry.files[2]!==`native-denied-${match[1]}-result.json`)throw new Error('Native denied evidence filename differs');
  const attemptId=z.uuid().parse(match[1]),correlationKey=`${context.runId}:${attemptId}`;
  const common={schemaVersion:z.literal(1),context:nativeQaContextSchema,check:nativeDeniedCheckSchema,contractHash:hash,attemptId:z.uuid(),correlationKey:z.string()};
  const claim=nativeClaimSchema.parse(await json(entry.files[0]));
  if(claim.diagnosticId)throw Error('Component diagnostic claims are not delivery QA evidence');
  if(claim.previousClaimSha256||claim.reconciliationSha256||entry.files.length===5){if(!claimRoot||entry.files.length!==5||entry.files[3]!==`native-denied-${attemptId}-previous.json`||entry.files[4]!==`native-denied-${attemptId}-authorization.json`)throw new Error('Native successor evidence authority missing');await verifyNativeSuccessorCopy(claimRoot,claim,await json(entry.files[3]),await json(entry.files[4]));}
  const intent=z.strictObject({...common,state:z.literal('dispatched-or-unknown'),observedAt:z.iso.datetime()}).parse(await json(entry.files[1]));
  const result=z.strictObject({...common,capture:z.strictObject({binding:nativeCaptureBindingSchema,receipt:nativeCaptureReceiptSchema}).optional(),denialReceipt:denialResponse,observedIdentities:z.array(observedIdentity).min(4).max(3000),windowStartedAt:z.iso.datetime(),windowEndedAt:z.iso.datetime(),observationElapsedMs:z.number().int().nonnegative(),status:z.literal('unreviewed-candidate'),assertionsPassed:z.literal(true),assertions:deniedAssertionSchema.shape.assertions,observations:z.array(z.strictObject({snapshot,sha256:hash})).min(3).max(1000),observationWindowMs:z.number(),cleanupVerified:z.literal(true),limitation:z.string().min(1)}).parse(await json(entry.files[2]));
  if(captureLeaseSha256&&!result.capture)throw new Error('Required prospective native capture missing');
  if(result.capture){const {binding,receipt}=result.capture;if(!claimRoot||!captureLeaseSha256||binding.leaseSha256!==captureLeaseSha256||binding.id!==attemptId||JSON.stringify(binding.context)!==JSON.stringify(context)||binding.contractHash!==digest(check)||binding.targetSha256!==check.targetSha256||binding.correlationKey!==correlationKey||receipt.outcome!=='candidate')throw new Error('Native capture authority differs');const history=await inspectNativeCapture(path.join(claimRoot,'captures'),receipt,binding);const kinds=history.events.map(e=>e.kind),claims=history.events.filter(e=>e.kind==='claim'),intents=history.events.filter(e=>e.kind==='attempt-intent'),responses=history.events.filter(e=>e.kind==='attempt-response');if(kinds[0]!=='connected'||claims.length!==1||intents.length!==1||responses.length!==1||claims[0].sequence>=intents[0].sequence||intents[0].sequence>=responses[0].sequence||responses[0].sequence>=history.events.length-1||kinds.at(-1)!=='cleanup'||history.events.at(-1)?.data.verified!==true||claims[0].data.claimSha256!==digest(claim))throw new Error('Native capture lifecycle differs');if(check.target){const anchors=history.events.filter(e=>e.kind==='provider-checkpoint');if(anchors.length!==1||anchors[0].sequence>=claims[0].sequence||Date.parse(anchors[0].observedAt)>Date.parse(claim.observedAt))throw Error('Targeted native capture lacks its original pre-claim history checkpoint');const anchor=validateSharepointHistoryCheckpoint(anchors[0].data.checkpoint,check,context.startedAt);if(Date.parse(anchor.capturedAt)>Date.parse(anchors[0].observedAt))throw Error('Native checkpoint publication time differs');}
  const response=responses[0];if(JSON.stringify(response.data)!==JSON.stringify(result.denialReceipt))throw new Error('Native capture response differs');}
  if(claim.logicalKey!==digest({tenantId:check.tenantId.toLowerCase(),targetSha256:check.targetSha256,operation:check.contract.operation})||Date.parse(claim.observedAt)>Date.parse(intent.observedAt))throw new Error('Native denial claim differs');
  for(const receipt of [claim,intent,result])if(JSON.stringify(receipt.context)!==JSON.stringify(context)||JSON.stringify(receipt.check)!==JSON.stringify(check)||receipt.contractHash!==digest(check)||receipt.attemptId!==attemptId||receipt.correlationKey!==correlationKey)throw new Error('Native denial receipt binding differs');
  if(plan.deliveryRecord?.sha256!==context.recordSha256||JSON.stringify(result.assertions)!==JSON.stringify(check.contract.assertions)||result.observationWindowMs!==check.contract.observationWindowMs||result.observationElapsedMs<check.contract.observationWindowMs||result.observationElapsedMs>check.contract.observationWindowMs+60000||Date.parse(intent.observedAt)<Date.parse(context.startedAt)||Date.parse(result.windowStartedAt)<Date.parse(intent.observedAt)||Date.parse(result.windowEndedAt)-Date.parse(result.windowStartedAt)<check.contract.observationWindowMs||Date.parse(result.windowEndedAt)>Date.now()+1000)throw new Error('Native denial observation window differs');
  if(result.denialReceipt.targetSha256!==check.targetSha256||result.denialReceipt.subject.toLowerCase()!==check.deniedSubject.toLowerCase()||result.denialReceipt.correlationKey!==correlationKey)throw new Error('Native denial response binding differs');
  for(const row of result.observedIdentities)if(!nativeIdentityClientMatches(check,row.role,row.identity)||row.identity.tenantId.toLowerCase()!==check.tenantId.toLowerCase()||row.identity.subject.toLowerCase()!==(row.role==='denied'?check.deniedSubject:check.observerSubject).toLowerCase()||row.identity.username.toLowerCase()!==(row.role==='denied'?check.deniedUsername:check.observerUsername).toLowerCase()||row.identity.targetSha256!==check.targetSha256||Date.parse(row.observedAt)<Date.parse(context.startedAt)||Date.parse(row.observedAt)>Date.parse(result.windowEndedAt))throw new Error('Native denial observed identity differs');
  for(const role of ['denied','observer'])if(!result.observedIdentities.some(row=>row.role===role&&Date.parse(row.observedAt)>=Date.parse(result.windowStartedAt)+check.contract.observationWindowMs))throw new Error('Native denial terminal identity verification missing');
  for(const row of result.observations)if(row.sha256!==digest(row.snapshot)||row.snapshot.targetSha256!==check.targetSha256||row.snapshot.correlationKey!==correlationKey||row.snapshot.writes.length||row.snapshot.dispatches.length||Date.parse(row.snapshot.from)>Date.parse(intent.observedAt)||Date.parse(row.snapshot.from)>Date.parse(row.snapshot.through))throw new Error('Native denial observation integrity differs');
  if(Date.parse(result.observations.at(-1)!.snapshot.through)<Date.parse(result.windowEndedAt))throw new Error('Native denial terminal coverage missing');
  files.push(...entry.files);
 }
 return files;
}
