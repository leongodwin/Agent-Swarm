import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite} from './atomicFile.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {sharepointHash,journalSchema,SharepointProvisioning,type SharepointPlan,type SharepointRequest} from './sharepointProvisioning.ts';
import {receiptSchema,validateSchemaReconciliation,schemaMetadata,schemaMetadataHash} from './sharepointReconciliation.ts';
import {acceptResourceLeaseTransfer} from './resourceLease.ts';

const sha=z.string().regex(/^[a-f0-9]{64}$/),hash=(v:string|Uint8Array)=>crypto.createHash('sha256').update(v).digest('hex');
const leaseSchema=z.strictObject({resource:z.string(),owner:z.string(),pid:z.number().int().positive(),token:z.uuid(),acquiredAt:z.iso.datetime()});
export const schemaContinuationSpec=z.strictObject({schemaVersion:z.literal(1),leaseState:z.enum(['held','released']).default('held'),receiptBytes:z.string().max(128*1024),receiptSha256:sha,journalBytes:z.string().max(65536),journalSha256:sha,leaseBytes:z.string().max(16384),leaseSha256:sha,quiescence:z.strictObject({ownerPid:z.number().int().positive(),sessions:z.literal(0),nativePids:z.array(z.number()).length(0),directGraphTransport:z.literal(true),stoppedAt:z.iso.datetime()})});
export type SchemaContinuationSpec=z.infer<typeof schemaContinuationSpec>;
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH';}};
const read=async(file:string,max:number)=>{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Continuation path differs');const b=await readBoundedBytes(file,max);if(!b)throw Error('Continuation history absent');return b;};
async function durable(file:string,bytes:string,guard:()=>void){guard();await atomicWrite(file,bytes,()=>{guard();return true;});const h=await fs.open(file,'r+');try{await h.sync();}finally{await h.close();}guard();}

/** A new review authorizes an exact retained execution identity; it does not
 * rewrite the prior review or pretend that a refreshed grant produced it. */
export function validateSchemaContinuation(raw:unknown,plan:SharepointPlan,repoId:string,owner:string,issue:number,record:{id:string;revision:number}){
 const s=schemaContinuationSpec.parse(raw);
 if(hash(s.receiptBytes)!==s.receiptSha256||hash(s.journalBytes)!==s.journalSha256||hash(s.leaseBytes)!==s.leaseSha256)throw Error('Continuation snapshot digest differs');
 const receipt=receiptSchema.parse(parseUnambiguousJson(s.receiptBytes,{maxBytes:128*1024})),journal=journalSchema.parse(parseUnambiguousJson(s.journalBytes,{maxBytes:65536})),lease=leaseSchema.parse(parseUnambiguousJson(s.leaseBytes,{maxBytes:16384}));
 const identity=z.strictObject({scope:z.literal('independently-reviewed-schema-bootstrap'),repoId:z.string(),record:z.strictObject({id:z.uuid(),revision:z.number().int().positive(),sha256:sha}),sourceAuthority:sha,issue:z.number().int(),actor:z.string(),planSha256:sha}).parse(parseUnambiguousJson(receipt.binding.authority,{maxBytes:4000}));
 const v=validateSchemaReconciliation(receipt.binding.spec,plan,repoId,owner,issue,identity.record),entry=journal.entries[0],migration=sharepointHash(receipt.binding);
 if(receipt.phase!=='applied'||receipt.binding.planSha256!==sharepointHash(plan)||identity.repoId!==repoId||identity.actor!==owner||identity.issue!==issue||identity.planSha256!==sharepointHash(plan)||identity.record.id!==record.id||identity.record.revision>=record.revision||receipt.oldJournalBytes!==v.s.journalBytes||receipt.oldLeaseBytes!==v.s.leaseBytes||receipt.newJournalBytes!==s.journalBytes||receipt.newLeaseBytes!==s.leaseBytes||journal.authority!==receipt.binding.authority||journal.planSha256!==sharepointHash(plan)||journal.entries.length!==1||JSON.stringify(entry)!==JSON.stringify({...receipt.binding.entry,migration})||lease.owner!==journal.authority||lease.resource!==v.resource||lease.pid!==s.quiescence.ownerPid||Date.parse(s.quiescence.stoppedAt)>Date.now()+60000)throw Error('Applied continuation binding differs; no replay permitted');
 return{s,receipt,journal,lease,identity,resource:v.resource,siteId:v.siteId,migration,metadataSha256:v.s.metadataSha256,resourceId:v.s.resourceId,authority:journal.authority};
}

export async function continueAppliedSchema(input:{root:string;leaseRoot:string;repoId:string;owner:string;issue:number;record:{id:string;revision:number};plan:SharepointPlan;spec:unknown;freshAuthority:string;request:SharepointRequest;guard():void;authorize():Promise<void>},deps:{alive?:(pid:number)=>boolean;checkpoint?:(phase:string)=>Promise<void>}={}){
 const v=validateSchemaContinuation(input.spec,input.plan,input.repoId,input.owner,input.issue,input.record),check=async()=>{input.guard();await input.authorize();if((deps.alive??alive)(v.lease.pid))throw Error('Applied handoff owner remains alive');input.guard();};
 const leaseFile=path.join(input.leaseRoot,hash(v.resource)+'.json'),journalFile=path.join(input.leaseRoot,'sharepoint-history',sharepointHash(v.siteId.toLowerCase())+'.json'),originalFile=path.join(input.leaseRoot,'sharepoint-reconciliations',v.migration+'.json'),lock=leaseFile+'.reaping',exclusive=path.join(lock,'continuation');
 const exists=async(file:string)=>fs.lstat(file).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 const held=v.s.leaseState==='held';
 if(held){const guardStat=await fs.lstat(lock);if(!guardStat.isDirectory()||guardStat.isSymbolicLink()||await fs.realpath(lock)!==path.resolve(lock))throw Error('Expected retained handoff guard differs');}else if(await exists(lock)||await exists(leaseFile))throw Error('Released continuation has a successor lease or recovery guard');
 const snapshots=async()=>{await check();if((held?hash(await read(leaseFile,16384))!==v.s.leaseSha256:await exists(leaseFile))||hash(await read(journalFile,65536))!==v.s.journalSha256||hash(await read(originalFile,128*1024))!==v.s.receiptSha256)throw Error('Applied handoff snapshots changed');};
 await snapshots();
 const observe=async()=>{const inv=await new SharepointProvisioning(input.root,input.leaseRoot).inventory(input.plan.siteUrl,input.plan.tenantId,async(method,route)=>{if(method!=='GET')throw Error('Continuation forbids provider writes');await check();const r=await input.request('GET',route);await check();return r;},input.guard);const matches=inv.lists.filter(l=>l.id===v.resourceId||l.description===v.journal.entries[0].marker);if(matches.length!==1||schemaMetadataHash(schemaMetadata(inv.site,matches[0]))!==v.metadataSha256)throw Error('Continuation provider metadata changed');};
 await observe();await observe();await snapshots();
 if(!held)await fs.mkdir(lock).catch(()=>{throw Error('Released continuation already in progress');});
 try{await fs.mkdir(exclusive);}catch(e){if(!held)await fs.rmdir(lock).catch(()=>{});throw e;}let pending=false;
 try{
  await snapshots();await deps.checkpoint?.('locked');
  const binding={spec:v.s,planSha256:sharepointHash(input.plan),retainedAuthority:v.authority,freshAuthority:input.freshAuthority,record:input.record},receiptSha256=sharepointHash(binding),receiptFile=path.join(input.leaseRoot,'sharepoint-continuations',receiptSha256+'.json');
  if(await fs.lstat(receiptFile).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Existing continuation requires independent recovery');
  const newLeaseBytes=JSON.stringify({...v.lease,pid:process.pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()}),receipt={schemaVersion:1,binding,phase:'pending',newLeaseBytes};
  pending=true;await durable(receiptFile,JSON.stringify(receipt),input.guard);await deps.checkpoint?.('pending');await snapshots();
  await durable(leaseFile,newLeaseBytes,input.guard);await deps.checkpoint?.('lease');await check();
  if((await read(leaseFile,16384)).toString()!==newLeaseBytes||hash(await read(journalFile,65536))!==v.s.journalSha256||hash(await read(originalFile,128*1024))!==v.s.receiptSha256)throw Error('Continuation publication differs');
  await durable(receiptFile,JSON.stringify({...receipt,phase:'applied'}),input.guard);await deps.checkpoint?.('applied');await check();
  // Release only our child guard and then the exact retained empty guard. A
  // concurrent/unknown recovery file prevents rmdir and keeps delivery blocked.
  await fs.rmdir(exclusive);await fs.rmdir(lock);pending=false;
  return{receiptFile,receiptSha256,authority:v.authority,lease:await acceptResourceLeaseTransfer(input.leaseRoot,v.resource,v.authority,hash(newLeaseBytes))};
 }finally{if(!pending){await fs.rmdir(exclusive).catch(e=>{if(e.code!=='ENOENT')throw e;});if(!held)await fs.rmdir(lock).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
}
