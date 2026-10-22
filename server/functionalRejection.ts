import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {functionalRejectedCheckSchema,functionalTransportCheck,functionalLimits} from '../shared/functionalShowcase.ts';
import {nativeQaContextSchema} from '../shared/nativeQa.ts';
import {nativeIdentityClientMatches,nativeObservedIdentitySchema,type NativeDeniedFactory} from './nativeDeniedAccess.ts';
import {beginNativeCapture,inspectNativeCapture,nativeCaptureBindingSchema,nativeCaptureReceiptSchema} from './nativeHistoryCapture.ts';
import {reserveNativeClaim,nativeClaimKey,claimHash} from './nativeClaimReconciliation.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const responseSchema=z.strictObject({status:z.literal(403),targetSha256:hash,subject:z.uuid(),correlationKey:z.string()});
const resultSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('functional-rejected-request'),context:nativeQaContextSchema,check:functionalRejectedCheckSchema,binding:nativeCaptureBindingSchema,capture:nativeCaptureReceiptSchema,response:responseSchema,cleanupVerified:z.literal(true),completeHistoricalAbsenceVerified:z.literal(false),productionAcceptance:z.literal(false),retryAuthorized:z.literal(false),limits:z.array(z.string()).min(3)});
async function write(file:string,value:unknown){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}}

/** A new explicit functional contract. The v1 complete-history verifier is unchanged.
 * The internal legacy check configures transport only; none of its temporal
 * assertions are reported as satisfied by this producer. */
export async function verifyFunctionalRejection(raw:unknown,rawContext:unknown,evidence:string,claimRoot:string,leaseSha256:string,connect:NativeDeniedFactory,signal:AbortSignal,owned:()=>Promise<void>,wait=(ms:number)=>delay(ms,undefined,{signal})){
 const check=functionalRejectedCheckSchema.parse(raw),context=nativeQaContextSchema.parse(rawContext),transport=functionalTransportCheck(check),id=crypto.randomUUID(),correlationKey=context.runId+':'+id;
 const binding=nativeCaptureBindingSchema.parse({id,context,leaseSha256,contractHash:claimHash(check),targetSha256:check.targetSha256,correlationKey}),guard=async()=>{signal.throwIfAborted();await owned();signal.throwIfAborted();};
 await guard();await fs.mkdir(evidence,{recursive:true});await fs.mkdir(claimRoot,{recursive:true});
 const capture=await beginNativeCapture(path.join(claimRoot,'captures'),binding,guard);let adapter:Awaited<ReturnType<NativeDeniedFactory>>|undefined,cleanup=false,candidate=false,response:z.infer<typeof responseSchema>|undefined;
 const identities=async()=>{const rows=[];for(const role of ['denied','observer'] as const){await guard();const identity=nativeObservedIdentitySchema.parse(await adapter!.identity(role));await guard();if(!nativeIdentityClientMatches(transport,role,identity)||identity.targetSha256!==check.targetSha256||identity.tenantId.toLowerCase()!==check.tenantId.toLowerCase()||identity.subject.toLowerCase()!==check.deniedSubject.toLowerCase()||identity.username.toLowerCase()!==check.deniedUsername.toLowerCase())throw Error('Functional native identity or target differs');rows.push({role,identity});}return rows;};
 const observe=async()=>{await guard();const value=await adapter!.observe(correlationKey);await guard();z.object({targetSha256:z.literal(check.targetSha256),correlationKey:z.literal(correlationKey)}).parse(value);await capture.append('observation',{snapshot:value,completeHistoricalAbsenceVerified:false});};
 let error:unknown;
 try{
  adapter=await connect(transport,signal,{phase:'execution',context,cwd:evidence,owned:guard,persistHistoryCheckpoint:async checkpoint=>{await capture.append('provider-checkpoint',{checkpoint});},persistSharepointHistoryPage:async page=>{await capture.append('provider-history-page',{page});},persistDispatchHistoryPage:async(page,providerPage)=>{await capture.append('dispatch-history-page',{page,providerPage});}});
  await guard();z.object({authenticatedIdentity:z.literal(true),deniedCreate:z.literal(true),exactCorrelation:z.literal(true)}).parse(await adapter.capabilities());await guard();await capture.append('connected',{identities:await identities()});await observe();
  const claim={schemaVersion:1,logicalKey:nativeClaimKey(transport),context,check:transport,contractHash:claimHash(transport),attemptId:id,correlationKey,state:'reserved-or-unknown',observedAt:new Date().toISOString()};
  const reservation=await reserveNativeClaim(claimRoot,claim,guard);await capture.append('claim',{claimSha256:claimHash(reservation.claim)});await guard();
  await capture.append('attempt-intent',{identities:await identities()});await guard();
  response=responseSchema.parse(await adapter.attempt(correlationKey));await guard();if(response.targetSha256!==check.targetSha256||response.subject.toLowerCase()!==check.deniedSubject.toLowerCase()||response.correlationKey!==correlationKey)throw Error('Functional rejection response differs');await capture.append('attempt-response',response);
  await wait(check.contract.observationWindowMs);await guard();await observe();await identities();candidate=true;
 }catch(e){error=e;}
 finally{if(adapter)try{await adapter.close();cleanup=true;}catch(e){error=e;candidate=false;}await capture.append('cleanup',{verified:cleanup});}
 const receipt=await capture.seal(candidate&&cleanup?'candidate':'blocked');
 const file=`functional-rejection-${id}.json`;
 if(!candidate||!cleanup||!response){await write(path.join(evidence,file),{schemaVersion:1,kind:'functional-rejection-blocked',context,binding,capture:receipt,cleanupVerified:cleanup,retryAuthorized:false});throw error??Error('Functional rejection incomplete; retain claim and capture');}
 await write(path.join(evidence,file),resultSchema.parse({schemaVersion:1,kind:'functional-rejected-request',context,check,binding,capture:receipt,response,cleanupVerified:true,completeHistoricalAbsenceVerified:false,productionAcceptance:false,retryAuthorized:false,limits:functionalLimits}));return file;
}

export async function functionalRejectionEvidence(raw:unknown,context:unknown,read:(file:string)=>Promise<Buffer>,claimRoot:string,leaseSha256:string){
 const check=functionalRejectedCheckSchema.parse(raw),ctx=nativeQaContextSchema.parse(context),index=z.strictObject({schemaVersion:z.literal(1),file:z.string().regex(/^functional-rejection-[a-f0-9-]{36}\.json$/)}).parse(parseUnambiguousJson((await read('functional-rejection-index.json')).toString('utf8'))),result=resultSchema.parse(parseUnambiguousJson((await read(index.file)).toString('utf8')));
 if(claimHash(result.context)!==claimHash(ctx)||claimHash(result.check)!==claimHash(check)||result.binding.contractHash!==claimHash(check)||result.binding.leaseSha256!==leaseSha256||claimHash(result.binding.context)!==claimHash(ctx)||result.binding.targetSha256!==check.targetSha256||result.response.targetSha256!==check.targetSha256||result.response.subject.toLowerCase()!==check.deniedSubject.toLowerCase()||result.response.correlationKey!==result.binding.correlationKey)throw Error('Functional rejection evidence binding differs');
 const captured=await inspectNativeCapture(path.join(claimRoot,'captures'),result.capture,result.binding),events=captured.events,attempts=events.filter(e=>e.kind==='attempt-intent'),responses=events.filter(e=>e.kind==='attempt-response'),observations=events.filter(e=>e.kind==='observation');
 if(result.capture.outcome!=='candidate'||attempts.length!==1||responses.length!==1||claimHash(responses[0].data)!==claimHash(result.response)||observations.length!==2||observations[0].sequence>=attempts[0].sequence||observations[1].sequence<=responses[0].sequence||Date.parse(observations[1].observedAt)-Date.parse(responses[0].observedAt)<check.contract.observationWindowMs||events.at(-1)?.kind!=='cleanup'||events.at(-1)?.data.verified!==true)throw Error('Functional rejection captured lifecycle differs');
 return ['functional-rejection-index.json',index.file];
}
