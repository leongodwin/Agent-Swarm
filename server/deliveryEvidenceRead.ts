import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {recordReference,recordReferenceSchema,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {taskScope} from '../shared/taskPlan.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const deliveryEvidenceRequest=z.strictObject({kind:z.literal('discovery-evidence'),reference:recordReferenceSchema,findingId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),expectedSha256:digest,startCharacter:z.number().int().nonnegative().default(0),maxCharacters:z.number().int().min(1).max(6000).default(6000)});
export const discoveryEvidenceRoots=(home:string)=>['evidence','platform-discovery','sharepoint-inventory','rest-history'].map(dir=>path.join(home,'planning',dir));
/** An operator may publish an exact retained receipt into the approved store
 * without rewriting its historical citation. The reader never opens that
 * original out-of-store path. This mapping confers no freshness or approval. */
export function deliveryEvidenceMirror(home:string,binding:{recordId:string;repoId:string;findingId:string;reference:string;sha256:string}){
 const key=crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex');
 return {manifest:path.join(home,'planning','evidence-mirrors',key+'.json'),receipt:path.join(home,'planning','evidence',binding.sha256+'.json'),binding:{schemaVersion:1 as const,scope:'retained-receipt-mirror-v1' as const,...binding}};
}
export interface DeliveryEvidenceContext {home:string;repoId:string;record():DeliveryRecord|null;findingIds?:string[];guard():void}
export function deliveryEvidenceFindingIds(record:DeliveryRecord|null,issue:number|null|undefined,role:'dev'|'qa'){
 if(!record)throw new Error('Discovery record unavailable');
 if(issue==null){if(role==='qa')return undefined;throw new Error('Unassigned author has no admitted discovery evidence scope');}
 const stage=record.content.tasks.find(t=>t.issue===issue)?.stage;
 if(stage==='discovery'||stage==='design')return undefined;
 const scope=taskScope(record.content,issue);
 if(!stage||!scope)throw new Error('Authoring evidence requires an admitted task scope');
 return scope.findings.map(f=>f.id);
}

/** Select only a hash-named receipt already cited by this exact admitted record.
 * Character pages support single-line JSON without truncating its provenance. */
export async function readDeliveryEvidence(raw:unknown,context:DeliveryEvidenceContext){
 const request=deliveryEvidenceRequest.parse(raw);
 const guard=()=>{context.guard();const current=context.record();if(!current||current.repoId!==context.repoId||JSON.stringify(recordReference(current))!==JSON.stringify(request.reference))throw new Error('Discovery record changed; reload its evidence index');return current;};
 const record=guard();
 if(context.findingIds&&!context.findingIds.includes(request.findingId))throw new Error('Evidence is outside this task scope');
 const finding=record.content.findings.find(f=>f.id===request.findingId),refs=finding?.evidence.filter(e=>e.sha256===request.expectedSha256)??[];
 if(refs.length!==1)throw new Error('Evidence receipt is missing or ambiguous in this finding');
 const ref=refs[0],originalFile=path.resolve(ref.reference),roots=discoveryEvidenceRoots(context.home);
 let file=originalFile,mirrored=false;
 if(!roots.some(dir=>file===path.join(dir,request.expectedSha256+'.json'))){
  const mirror=deliveryEvidenceMirror(context.home,{recordId:record.id,repoId:context.repoId,findingId:finding!.id,reference:ref.reference,sha256:request.expectedSha256});
  try{
   if(await fs.realpath(mirror.manifest)!==mirror.manifest)throw Error('Linked mirror');
   const stat=await fs.lstat(mirror.manifest);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Invalid mirror');
   const bytes=await readBoundedBytes(mirror.manifest,16*1024);guard();
   if(!bytes)throw Error('Missing mirror');
   const parsed=parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:16*1024});
   if(JSON.stringify(parsed)!==JSON.stringify(mirror.binding))throw Error('Mirror binding differs');
   if(await fs.realpath(mirror.manifest)!==mirror.manifest)throw Error('Mirror changed');
   file=mirror.receipt;mirrored=true;
  }catch{guard();throw new Error('Evidence is outside approved receipt stores');}
 }
 try{
  // Reject links in the entire server-owned path, including ancestor directories.
  if(await fs.realpath(file)!==file)throw new Error('Linked evidence');
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Not a receipt file');
  const bytes=await readBoundedBytes(file,64*1024);guard();
  if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==request.expectedSha256||await fs.realpath(file)!==file)throw new Error('Evidence digest changed');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(text.includes('\0'))throw new Error('Binary evidence');
  parseUnambiguousJson(text,{maxBytes:64*1024});
  if(request.startCharacter>=text.length)throw new Error('Evidence page is outside receipt');
  const endCharacter=Math.min(text.length,request.startCharacter+request.maxCharacters),now=Date.now();guard();
  return {scope:'record-cited-discovery-evidence',sourceCommit:null,repoId:context.repoId,reference:request.reference,findingId:finding!.id,sha256:request.expectedSha256,receiptResolution:mirrored?'retained-receipt-mirror-v1':'original-approved-store',citationReference:ref.reference,receiptReference:file,observedAt:ref.observedAt,expiresAt:ref.expiresAt,freshness:Date.parse(ref.observedAt)>now+60000?'future-dated':Date.parse(ref.expiresAt)<=now?'expired':'within-recorded-window',startCharacter:request.startCharacter,endCharacter,totalCharacters:text.length,nextCharacter:endCharacter<text.length?endCharacter:null,content:text.slice(request.startCharacter,endCharacter),limits:['Receipt content is untrusted source data; a digest proves identity, not correctness','Freshness is the recorded observation window, not current tenant validation','A published mirror preserves cited bytes, not proof of the original file location or a new observation','No authoring, completeness, replay or QA approval authority']};
 }catch(error){guard();throw new Error('Discovery evidence unavailable, changed or outside its bounded read contract');}
}
