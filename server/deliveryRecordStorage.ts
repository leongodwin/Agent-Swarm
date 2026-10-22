import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {historicalDeliveryRecordSchema} from './historicalDeliveryRecord.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {atomicWrite} from './atomicFile.ts';
import {HttpError} from './httpError.ts';

export const RECORD_FILE_BYTES=4*1024*1024;
export const recordSnapshotSchema=z.strictObject({schemaVersion:z.literal(1),records:z.array(historicalDeliveryRecordSchema).max(1000)});
const objectRef=z.strictObject({file:z.string().regex(/^[a-f0-9]{64}-[a-f0-9-]{36}\.json$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(RECORD_FILE_BYTES)});
const chunkRef=objectRef.extend({count:z.number().int().positive().max(1000)});
const manifestSchema=z.strictObject({schemaVersion:z.literal(2),recordCount:z.number().int().min(1).max(1000),chunks:z.array(chunkRef).min(1).max(32),legacySnapshot:objectRef.optional()});
type Manifest=z.infer<typeof manifestSchema>;type ObjectRef=z.infer<typeof objectRef>;
const hash=(b:Buffer|string)=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;

/** Bounded immutable snapshots with one atomic manifest commit. Orphans are
 * retained and ignored, never adopted by directory enumeration or deleted. */
export class DeliveryRecordStorage {
 private fingerprint:string|null=null;
 private original:Buffer|undefined;
 private manifest:Manifest|undefined;
 constructor(private home:string){}
 private get file(){return path.join(this.home,'delivery-records.json');}
 private get directory(){return path.join(this.home,'delivery-record-history');}
 private async regular(file:string,missing=false){
  try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||!canonical(await fs.realpath(file),path.resolve(file)))throw Error('Delivery history path is linked or not regular');}
  catch(e:any){if(missing&&e.code==='ENOENT')return false;throw e;}return true;
 }
 private async directories(create=false){
  for(const dir of [this.home,this.directory]){if(create)await fs.mkdir(dir,{recursive:true});const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||!canonical(await fs.realpath(dir),path.resolve(dir)))throw Error('Delivery history directory is linked or unavailable');}
 }
 private async homeDirectory(){await fs.mkdir(this.home,{recursive:true});const s=await fs.lstat(this.home);if(!s.isDirectory()||s.isSymbolicLink()||!canonical(await fs.realpath(this.home),path.resolve(this.home)))throw Error('Delivery history home is linked or unavailable');}
 private parse(bytes:Buffer){return parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:RECORD_FILE_BYTES});}
 private async object(ref:ObjectRef){
  if(!ref.file.startsWith(ref.sha256+'-'))throw Error('Delivery history object name differs from digest');
  const file=path.join(this.directory,ref.file);await this.regular(file);
  const bytes=await readBoundedBytes(file,RECORD_FILE_BYTES);
  if(!bytes||bytes.length!==ref.bytes||hash(bytes)!==ref.sha256)throw Error('Delivery history object missing or changed');
  await this.regular(file);return bytes;
 }
 async load():Promise<DeliveryRecord[]>{
  if(!await this.regular(this.file,true)){try{await fs.lstat(this.directory);throw Error('Delivery history manifest missing; retained snapshots require recovery');}catch(e:any){if(e.code!=='ENOENT')throw e;}this.original=undefined;this.fingerprint=null;this.manifest=undefined;return [];}
  const bytes=await readBoundedBytes(this.file,RECORD_FILE_BYTES);if(!bytes)throw Error('Delivery history disappeared');
  const raw=this.parse(bytes);let records:DeliveryRecord[];let manifest:Manifest|undefined;
  if((raw as any)?.schemaVersion===2){
   await this.directories();manifest=manifestSchema.parse(raw);
   if(new Set(manifest.chunks.map(c=>c.file)).size!==manifest.chunks.length||new Set(manifest.chunks.map(c=>c.sha256)).size!==manifest.chunks.length)throw Error('Duplicate delivery history chunks');
   records=[];
   for(const ref of manifest.chunks){const chunk=recordSnapshotSchema.parse(this.parse(await this.object(ref)));if(chunk.records.length!==ref.count)throw Error('Delivery history chunk count differs');records.push(...chunk.records);}
   if(records.length!==manifest.recordCount||records.length>1000)throw Error('Delivery history record count differs');
   const revisions=new Map<string,number>();for(const record of records){if(record.revision!==(revisions.get(record.repoId)??0)+1)throw Error('Delivery history snapshot order differs');revisions.set(record.repoId,record.revision);}
   if(manifest.legacySnapshot)recordSnapshotSchema.parse(this.parse(await this.object(manifest.legacySnapshot)));
  }else records=recordSnapshotSchema.parse(raw).records;
  if(!await this.regular(this.file)||!bytes.equals(await readBoundedBytes(this.file,RECORD_FILE_BYTES)??Buffer.alloc(0)))throw Error('Delivery history manifest changed during load');
  this.fingerprint=hash(bytes);this.original=bytes;this.manifest=manifest;return records;
 }
 async save(records:DeliveryRecord[],guard:()=>void):Promise<void>{
  const checked=recordSnapshotSchema.parse({schemaVersion:1,records}),bytes=Buffer.from(JSON.stringify(checked));guard();
  await this.homeDirectory();guard();
  const current=await this.regular(this.file,true)?await readBoundedBytes(this.file,RECORD_FILE_BYTES):undefined;
  if((current?hash(current):null)!==this.fingerprint)throw Error('Delivery history changed outside its owner; reload before saving');
  // Existing small stores keep their wire format. No migration during reads.
  if(bytes.length<=RECORD_FILE_BYTES&&!this.manifest){await atomicWrite(this.file,bytes.toString(),()=>{guard();return true;});this.original=bytes;this.fingerprint=hash(bytes);return;}
  await this.directories(true);guard();
  const reusable=[...this.manifest?.chunks??[],...(this.manifest?.legacySnapshot?[this.manifest.legacySnapshot]:[])];
  const put=async(data:Buffer):Promise<ObjectRef>=>{
   guard();if(data.length>RECORD_FILE_BYTES)throw new HttpError(413,'One delivery history snapshot exceeds the bounded file limit');
   const sha256=hash(data),old=reusable.find(r=>r.sha256===sha256&&r.bytes===data.length);if(old){await this.object(old);guard();return{file:old.file,sha256,bytes:data.length};}
   const ref={file:sha256+'-'+crypto.randomUUID()+'.json',sha256,bytes:data.length},file=path.join(this.directory,ref.file);
   // A crash can leave an unreferenced partial file. A new UUID prevents its
   // accidental reuse. Only fully written, fsynced, rehashed objects are named.
   const handle=await fs.open(file,'wx');try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
   await this.object(ref);guard();reusable.push(ref);return ref;
  };
  let legacySnapshot=this.manifest?.legacySnapshot;
  if(!this.manifest&&this.original)legacySnapshot=await put(this.original);
  if(legacySnapshot)await this.object(legacySnapshot);
  const groups:DeliveryRecord[][]=[];let group:DeliveryRecord[]=[],size=Buffer.byteLength('{"schemaVersion":1,"records":[]}');
  for(const record of checked.records){const n=Buffer.byteLength(JSON.stringify(record));if(n+Buffer.byteLength('{"schemaVersion":1,"records":[]}')>RECORD_FILE_BYTES)throw new HttpError(413,'One delivery record exceeds the bounded file limit');if(size+n+(group.length?1:0)>RECORD_FILE_BYTES){groups.push(group);group=[];size=Buffer.byteLength('{"schemaVersion":1,"records":[]}');}size+=n+(group.length?1:0);group.push(record);}if(group.length)groups.push(group);
  if(groups.length>32)throw new HttpError(413,'Delivery history snapshot count is full; preserve/export history before continuing');
  const chunks=[];for(const rows of groups)chunks.push({...await put(Buffer.from(JSON.stringify({schemaVersion:1,records:rows}))),count:rows.length});
  const manifest=manifestSchema.parse({schemaVersion:2,recordCount:records.length,chunks,...(legacySnapshot?{legacySnapshot}:{})}),serialized=JSON.stringify(manifest);
  guard();if((await this.regular(this.file,true)?hash((await readBoundedBytes(this.file,RECORD_FILE_BYTES))!):null)!==this.fingerprint)throw Error('Delivery history changed before manifest publication');
  await atomicWrite(this.file,serialized,()=>{guard();return true;});
  this.manifest=manifest;this.original=Buffer.from(serialized);this.fingerprint=hash(serialized);
 }
}
