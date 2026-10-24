import {dataverseGuid} from './targetOperations.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {RecordReference} from '../shared/deliveryRecord.ts';
import {readBoundedText} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {SOURCE_CAPSULE_BYTES,sourceDigest,validateSourceCapsule} from './headlessSourceContract.ts';
import type {observeHeadlessSource,SourceObservationBinding} from './headlessSourceObservation.ts';

type Observation=Awaited<ReturnType<typeof observeHeadlessSource>>;
const digest=(bytes:string)=>crypto.createHash('sha256').update(bytes,'utf8').digest('hex');
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const captureReceiptSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('protected-source-files-v1'),recordId:z.uuid(),recordRevision:z.number().int().positive(),recordSha256:hash,flowId:dataverseGuid,runId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),nonce:z.uuid(),definitionSha256:hash,sourceSha256:hash,indexSha256:hash,sourceFileSha256:hash,indexFileSha256:hash,observationSha256:hash,successAccepted:z.literal(false),checkerExecuted:z.literal(false)});
export type ProtectedSourceReceipt=z.infer<typeof captureReceiptSchema>;

/** This callback must re-run the existing Windows ACL/path admission. A bare
 * filesystem check is deliberately not presented as an ACL or privacy proof. */
export type ProtectedSourceLeaf=()=>Promise<string>;
async function leaf(getLeaf:ProtectedSourceLeaf,expected?:string){
 const raw=await getLeaf(),resolved=path.resolve(raw),stat=await fs.lstat(raw);
 if(!path.isAbsolute(raw)||!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await fs.realpath(raw))!==resolved||expected&&resolved!==expected)throw Error('SOURCE_LEAF_CHANGED');
 return resolved;
}
async function regular(file:string){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||path.resolve(await fs.realpath(file))!==path.resolve(file))throw Error('SOURCE_FILE_UNSUPPORTED');return stat;
}
async function persist(file:string,text:string,check:()=>Promise<void>){
 await check();const fd=await fs.open(file,'wx',0o600);
 try{
  const opened=await fd.stat();if(!opened.isFile()||opened.nlink!==1)throw Error('SOURCE_FILE_UNSUPPORTED');
  await fd.writeFile(text,'utf8');await fd.sync();await check();
  const retained=await regular(file);if(retained.dev!==opened.dev||retained.ino!==opened.ino||retained.size!==Buffer.byteLength(text))throw Error('SOURCE_FILE_CHANGED');
 }finally{await fd.close();}
}
const files=(root:string,nonce:string)=>({source:path.join(root,nonce+'.source.json'),index:path.join(root,nonce+'.source-index.json')});

/** Unwired storage primitive. Existing exact admission must supply getLeaf.
 * Exclusive creation never overwrites/reuses an old capture, even on failure.
 * Partial files remain for reconciliation; no cleanup or replay is authorized. */
export async function retainHeadlessSource(record:RecordReference,binding:SourceObservationBinding,observation:Observation,getLeaf:ProtectedSourceLeaf){
 try{
  z.strictObject({id:z.uuid(),revision:z.number().int().positive(),sha256:hash}).parse(record);z.uuid().parse(binding.nonce);dataverseGuid.parse(binding.flowId);hash.parse(binding.definitionSha256);z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).parse(binding.runId);
  const recordId=record.id,recordRevision=record.revision,recordSha256=record.sha256;
  const source=validateSourceCapsule(observation.privateSource.capsule,{dataMode:binding.dataMode,nonce:binding.nonce,startedAt:binding.startedAt,endedAt:binding.endedAt});
  const proof=observation.receipt;
  if(proof.successAccepted!==false||proof.checkerExecuted!==false||proof.flowId!==binding.flowId||proof.runId!==binding.runId||proof.nonce!==binding.nonce||proof.definitionSha256!==binding.definitionSha256||proof.dataMode!==binding.dataMode||proof.sourceSha256!==source.capsuleSha256||proof.indexSha256!==sourceDigest(source.index)||sourceDigest(observation.privateSource.counts)!==sourceDigest(source.counts)||sourceDigest(proof.counts)!==sourceDigest(source.counts)||proof.repetitionsSha256!==sourceDigest(observation.privateRepetitions))throw Error('SOURCE_OBSERVATION_CHANGED');
  const envelope={schemaVersion:1,recordId,recordRevision,recordSha256,flowId:binding.flowId,runId:binding.runId,nonce:binding.nonce,definitionSha256:binding.definitionSha256,dataMode:binding.dataMode};
  const sourceText=JSON.stringify({...envelope,capsule:source.capsule}),indexText=JSON.stringify({...envelope,index:source.index,counts:source.counts,repetitions:observation.privateRepetitions,observation:proof});
  // The capsule bound is unchanged. Fixed envelope overhead is not another
  // source payload allowance; the index has its own equally bounded file.
  if(Buffer.byteLength(sourceText)>SOURCE_CAPSULE_BYTES+4096||Buffer.byteLength(indexText)>SOURCE_CAPSULE_BYTES)throw Error('SOURCE_FILE_OVERSIZE');
  const root=await leaf(getLeaf);if(path.basename(root)!=='recruitment-e2e-'+recordId)throw Error('SOURCE_LEAF_SCOPE_DIFFERS');const names=files(root,binding.nonce),check=async()=>{await leaf(getLeaf,root);};
  await persist(names.source,sourceText,check);await persist(names.index,indexText,check);
  const receipt=captureReceiptSchema.parse({schemaVersion:1,kind:'protected-source-files-v1',recordId,recordRevision,recordSha256,flowId:binding.flowId,runId:binding.runId,nonce:binding.nonce,definitionSha256:binding.definitionSha256,sourceSha256:source.capsuleSha256,indexSha256:sourceDigest(source.index),sourceFileSha256:digest(sourceText),indexFileSha256:digest(indexText),observationSha256:sourceDigest(proof),successAccepted:false,checkerExecuted:false});
  await readHeadlessSource(receipt,record,binding,getLeaf);return receipt;
 }catch{throw Error('SOURCE_PROTECTED_PERSISTENCE_FAILED_CONTENT_WITHHELD');}
}

/** Returns private values only to the admitted checker/runner. No content or
 * local path belongs in the public receipt or error. Rehash on every use. */
export async function readHeadlessSource(rawReceipt:ProtectedSourceReceipt,record:RecordReference,binding:SourceObservationBinding,getLeaf:ProtectedSourceLeaf){
 try{
  const receipt=captureReceiptSchema.parse(rawReceipt);if(receipt.recordId!==record.id||receipt.recordRevision!==record.revision||receipt.recordSha256!==record.sha256)throw Error('SOURCE_RECORD_CHANGED');for(const key of ['flowId','runId','nonce','definitionSha256'] as const)if(receipt[key]!==binding[key])throw Error('SOURCE_BINDING_CHANGED');
  const root=await leaf(getLeaf);if(path.basename(root)!=='recruitment-e2e-'+receipt.recordId)throw Error('SOURCE_LEAF_SCOPE_DIFFERS');const names=files(root,receipt.nonce);
  const read=async(file:string,maxBytes:number,sha256:string)=>{await leaf(getLeaf,root);const before=await regular(file),text=await readBoundedText(file,maxBytes),after=await regular(file);if(!text||digest(text)!==sha256||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size)throw Error('SOURCE_CAPTURE_CHANGED');await leaf(getLeaf,root);return parseUnambiguousJson(text,{maxBytes});};
  const source:any=await read(names.source,SOURCE_CAPSULE_BYTES+4096,receipt.sourceFileSha256),index:any=await read(names.index,SOURCE_CAPSULE_BYTES,receipt.indexFileSha256);
  for(const value of [source,index])for(const key of ['recordId','recordRevision','recordSha256','flowId','runId','nonce','definitionSha256'] as const)if(value[key]!==receipt[key])throw Error('SOURCE_ENVELOPE_CHANGED');
  if(source.dataMode!==binding.dataMode||index.dataMode!==binding.dataMode)throw Error('SOURCE_MODE_CHANGED');
  const validated=validateSourceCapsule(source.capsule,{dataMode:binding.dataMode,nonce:binding.nonce,startedAt:binding.startedAt,endedAt:binding.endedAt});
  if(validated.capsuleSha256!==receipt.sourceSha256||sourceDigest(validated.index)!==receipt.indexSha256||sourceDigest(index.index)!==receipt.indexSha256||sourceDigest(index.counts)!==sourceDigest(validated.counts)||sourceDigest(index.observation)!==receipt.observationSha256||sourceDigest(index.repetitions)!==index.observation.repetitionsSha256)throw Error('SOURCE_INDEX_CHANGED');
  await leaf(getLeaf,root);return{source:validated,index,receipt};
 }catch{throw Error('SOURCE_PROTECTED_READ_FAILED_CONTENT_WITHHELD');}
}
