import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes,readBoundedJson} from './boundedJson.ts';
import {nativeQaContextSchema} from '../shared/nativeQa.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),sha=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const nativeCaptureBindingSchema=z.strictObject({id:z.uuid(),context:nativeQaContextSchema,leaseSha256:hash,contractHash:hash,targetSha256:hash,correlationKey:z.string().min(1).max(200)});
const eventSchema=z.strictObject({sequence:z.number().int().nonnegative(),previousSha256:hash,observedAt:z.iso.datetime(),kind:z.enum(['connected','observation','claim','attempt-intent','attempt-response','cleanup','provider-checkpoint','dispatch-history-page','provider-history-page']),data:z.record(z.string(),z.unknown())});
export const nativeCaptureReceiptSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),headSha256:hash,entries:z.number().int().min(1).max(1200),outcome:z.enum(['candidate','blocked']),completeEffects:z.literal(false),mac:hash});
async function write(file:string,value:unknown){const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>256*1024)throw new Error('Native capture record oversized');const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function regular(file:string){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw new Error('Native capture entry is not regular');}
/** Prospective owned-observation capture. A complete local transcript never
 * certifies a provider omitted no effects, or that an HTTP mutation terminated. */
export async function beginNativeCapture(root:string,input:unknown,owned:()=>Promise<void>){
 const binding=nativeCaptureBindingSchema.parse(input);await owned();await fs.mkdir(root,{recursive:true});const directory=path.join(root,binding.id);await fs.mkdir(directory);await owned();const key=crypto.randomBytes(32),h=await fs.open(path.join(directory,'capture.key'),'wx',0o600);try{await h.writeFile(key);await h.sync();}finally{await h.close();}await write(path.join(directory,'binding.json'),binding);await owned();
 let head=sha(binding),entries=0,bytes=0,sealed=false,closing=false,failed=false;let pending:Promise<unknown>=Promise.resolve();
 const append=(kind:z.infer<typeof eventSchema>['kind'],data:Record<string,unknown>)=>{if(closing||failed)return Promise.reject(new Error('Native capture closing or failed'));const work=pending.then(async()=>{if(sealed||failed)throw new Error('Native capture closed or failed');await owned();const event=eventSchema.parse({sequence:entries,previousSha256:head,observedAt:new Date().toISOString(),kind,data});bytes+=Buffer.byteLength(JSON.stringify(event));if(entries>=1200||bytes>8*1024*1024)throw new Error('Native capture bound exceeded');await write(path.join(directory,String(entries).padStart(4,'0')+'.json'),event);head=sha(event);entries++;await owned();});pending=work.catch(error=>{failed=true;throw error;});void pending.catch(()=>{});return work;};
 return{append,async seal(outcome:'candidate'|'blocked'){
  if(closing)throw new Error('Native capture already closing');closing=true;await pending;await owned();if(sealed||failed||!entries)throw new Error('Native capture cannot seal');sealed=true;
  const unsigned={schemaVersion:1 as const,id:binding.id,headSha256:head,entries,outcome,completeEffects:false as const};const receipt=nativeCaptureReceiptSchema.parse({...unsigned,mac:crypto.createHmac('sha256',key).update(JSON.stringify(unsigned)).digest('hex')});await write(path.join(directory,'seal.json'),receipt);await owned();return receipt;
 }};
}
export async function inspectNativeCapture(root:string,input:unknown,expected:unknown){
 const receipt=nativeCaptureReceiptSchema.parse(input),binding=nativeCaptureBindingSchema.parse(expected);if(receipt.id!==binding.id)throw new Error('Native capture identity differs');const directory=path.join(root,receipt.id);if(!(await fs.lstat(directory)).isDirectory())throw new Error('Native capture directory is not regular');
 for(const name of ['binding.json','capture.key','seal.json'])await regular(path.join(directory,name));
 if(sha(await readBoundedJson(path.join(directory,'binding.json'),16384))!==sha(binding)||sha(await readBoundedJson(path.join(directory,'seal.json'),16384))!==sha(receipt))throw new Error('Native capture binding/seal differs');
 const key=await readBoundedBytes(path.join(directory,'capture.key'),32);if(!key||key.length!==32)throw new Error('Native capture signing key unavailable');const {mac,...unsigned}=receipt,actual=crypto.createHmac('sha256',key).update(JSON.stringify(unsigned)).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(actual,'hex')))throw new Error('Native capture seal signature differs');
 const names=(await fs.readdir(directory)).sort(),expectedNames=['binding.json','capture.key','seal.json',...Array.from({length:receipt.entries},(_,i)=>String(i).padStart(4,'0')+'.json')].sort();if(JSON.stringify(names)!==JSON.stringify(expectedNames))throw new Error('Native capture has missing or unexpected entries');let head=sha(binding),last=Date.parse(binding.context.startedAt),bytes=0;const events=[];
 for(let i=0;i<receipt.entries;i++){const file=path.join(directory,String(i).padStart(4,'0')+'.json');await regular(file);const event=eventSchema.parse(await readBoundedJson(file,256*1024));bytes+=Buffer.byteLength(JSON.stringify(event));if(bytes>8*1024*1024||event.sequence!==i||event.previousSha256!==head||Date.parse(event.observedAt)<last||Date.parse(event.observedAt)>Date.now()+1000)throw new Error('Native capture history differs');head=sha(event);last=Date.parse(event.observedAt);events.push(event);}
 if(head!==receipt.headSha256)throw new Error('Native capture head differs');return{binding,events,localTranscriptVerified:true,completeEffects:false as const};
}
