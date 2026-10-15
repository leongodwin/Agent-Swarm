import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readBoundedBytes} from './boundedJson.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
type Capture={reference:string;sha256:string;status:'captured'|'unavailable';reason?:string;text?:string};
const inside=(root:string,file:string)=>{const relative=path.relative(root,file);return !relative.startsWith('..')&&!path.isAbsolute(relative);};
/** Only explicitly referenced, hash-verified text in approved local evidence roots
 * enters the tool-free model. Captured bytes are data, never instructions. */
export async function captureSynthesisEvidence(record:DeliveryRecord|undefined,roots:string[]):Promise<Capture[]>{
  if(!record)return [];
  const approved=(await Promise.all(roots.map(root=>fs.realpath(root).catch(()=>null)))).filter((root):root is string=>!!root);
  const refs=[...record.content.findings.flatMap(f=>f.evidence),...record.content.governanceProfile?.controls.flatMap(c=>c.evidence)??[]];
  const unique=[...new Map(refs.map(ref=>[`${ref.reference}:${ref.sha256}`,ref])).values()];let bytes=0;
  const results:Capture[]=[];
  for(const ref of unique.slice(0,24)){
    const item:Capture={reference:ref.reference,sha256:ref.sha256,status:'unavailable'};
    try{
      if(!path.isAbsolute(ref.reference)||!/[.](json|md|txt|ts|py|xml)$/i.test(ref.reference))throw new Error('Not an approved local text reference');
      const file=await fs.realpath(ref.reference);if(!approved.some(root=>inside(root,file)))throw new Error('Outside approved evidence roots');
      const content=await readBoundedBytes(file,32*1024);if(!content||crypto.createHash('sha256').update(content).digest('hex')!==ref.sha256)throw new Error('Evidence missing, oversized or hash differs');
      if(bytes+content.length>96*1024)throw new Error('Planning text budget reached');
      item.text=new TextDecoder('utf-8',{fatal:true}).decode(content);bytes+=content.length;item.status='captured';
    }catch{item.reason='Unavailable within approved roots, digest, text or size limits; do not infer its contents';}
    results.push(item);
  }
  return results;
}
export async function verifySynthesisEvidence(captured:Capture[]){
  for(const item of captured.filter(item=>item.status==='captured')){const bytes=await readBoundedBytes(item.reference,32*1024);if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Captured discovery evidence changed during synthesis; repeat with reviewed current bytes');}
}
