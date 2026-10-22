import crypto from 'node:crypto';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';

/** A model input projection, never a replacement for the retained record or QA.
 * Keep current scope/contracts and every evidence identity. Noncritical prose
 * is explicitly omitted with exact-byte provenance, never declared resolved. */
export function synthesisRecordContext(record:DeliveryRecord|undefined){
 if(!record)return null;
 return {projection:'planning-only-noncritical-finding-index-v3',reference:{id:record.id,revision:record.revision,sha256:record.sha256},historyLimit:'Noncritical finding prose is not inspected by the model. These are retained noncritical findings, not resolved or approved findings. Independent QA must inspect the full retained record. Current critical findings and executable contracts remain whole.',content:{...record.content,findings:record.content.findings.map(f=>{
  if(f.critical)return f;
  const {statement,remedy,...identity}=f,bytes=Buffer.from(JSON.stringify(f));
  return {...identity,omittedFields:['statement','remedy'],fullFindingBytes:bytes.length,fullFindingSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 })}};
}

/** Keep whole verified texts when they fit; never silently truncate evidence. */
export function boundedSynthesisPrompt(base:Record<string,unknown>,captured:readonly {reference:string;sha256:string;status:string;reason?:string;text?:string}[],maxBytes=256*1024){
 const items=captured.map(({text,...item})=>({...item,...(text?{status:'unavailable',reason:'Verified text omitted from model input to respect planning budget; do not infer contents'}:{})}));
 const encode=()=>JSON.stringify({...base,capturedEvidence:items});
 if(Buffer.byteLength(encode())>maxBytes)throw new Error('Architecture planning scope exceeds its bound; split the current scope without deleting history');
 // Keep inference input bounded even when omitted history frees capacity.
 // Whole evidence texts only; larger sources remain available to independent
 // QA through their exact retained references, never silently truncated.
 let textBytes=0;
 for(let i=0;i<captured.length;i++)if(captured[i].text!==undefined){const prior=items[i],bytes=Buffer.byteLength(captured[i].text!);if(textBytes+bytes>16*1024)continue;items[i]=captured[i];if(Buffer.byteLength(encode())>maxBytes)items[i]=prior;else textBytes+=bytes;}
 return encode();
}
