import crypto from 'node:crypto';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import type {SynthesisRequirement} from './synthesisTraceability.ts';
import {isExecutionEvidence} from '../shared/executionEvidence.ts';

/** Replace exact duplicate JSON with pointers into the same complete prompt.
 * The retained source, hashes and independent review remain authoritative. */
export function synthesisCatalogueContext(catalogue:readonly SynthesisRequirement[],record:DeliveryRecord|undefined){
 const sources=new Map<string,string>();
 for(const [index,item] of (record?.content.requirements??[]).entries())sources.set(JSON.stringify(item),`/discoveryEvidence/content/requirements/${index}`);
 for(const [section,items] of Object.entries(record?.content.applicationSpec??{}))if(Array.isArray(items)){
  const escaped=section.replace(/~/g,'~0').replace(/\//g,'~1');
  for(const [index,item] of items.entries())sources.set(JSON.stringify(item),`/discoveryEvidence/content/applicationSpec/${escaped}/${index}`);
 }
 return catalogue.map(row=>{
  const pointer=['delivery-requirement','application-specification'].includes(row.kind)?sources.get(row.text):undefined;
  if(!pointer)return row;
  const {text,...identity}=row;
  return {...identity,textSource:{jsonPointer:pointer,serialization:'JSON.stringify',rule:'Complete text is the JSON serialization of the referenced value in this same prompt; nothing is abbreviated.'}};
 });
}

/** A model input projection, never a replacement for the retained record or QA.
 * Keep current scope/contracts and every evidence identity. Only explicitly
 * declared prose omissions are indexed; exact receipt reuse is lossless. */
export function synthesisRecordContext(record:DeliveryRecord|undefined){
 if(!record)return null;
 const evidencePool:DeliveryRecord['content']['findings'][number]['evidence']=[],indices=new Map<string,number>();
 const findings=record.content.findings.map(f=>{
  const evidence=f.evidence.map(item=>{const encoded=JSON.stringify(item);let evidenceIndex=indices.get(encoded);if(evidenceIndex===undefined){evidenceIndex=evidencePool.length;indices.set(encoded,evidenceIndex);evidencePool.push(item);}return{evidenceIndex};});
  if(f.critical&&!isExecutionEvidence(f.executionEvidence))return {...f,evidence};
  const {statement,remedy,...identity}=f,bytes=Buffer.from(JSON.stringify(f));
  return {...identity,evidence,omittedFields:['statement','remedy'],fullFindingBytes:bytes.length,fullFindingSha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 });
 const prefixes:string[]=[],prefixCounts=new Map<string,number>();
 for(const item of evidencePool)if(/^[a-f0-9]{64}$/.test(item.sha256)&&item.reference.endsWith(item.sha256+'.json')){const prefix=item.reference.slice(0,-69);prefixCounts.set(prefix,(prefixCounts.get(prefix)??0)+1);}
 const encodedPool=evidencePool.map(item=>{
  if(!/^[a-f0-9]{64}$/.test(item.sha256)||!item.reference.endsWith(item.sha256+'.json'))return item;
  const prefix=item.reference.slice(0,-69);if((prefixCounts.get(prefix)??0)<2)return item;
  let index=prefixes.indexOf(prefix);if(index<0){index=prefixes.length;prefixes.push(prefix);}
  const {reference,...rest}=item;return {...rest,referenceFromSha256:index};
 });
 return {projection:'planning-only-exact-evidence-pool-v6',reference:{id:record.id,revision:record.revision,sha256:record.sha256},evidenceEncoding:'Each finding.evidence entry refers by evidenceIndex to the complete original object in evidencePool. If that object has referenceFromSha256, reconstruct ONLY its reference as the exact literal evidenceReferencePrefixes[referenceFromSha256] + its own sha256 + .json. This representation is used only when that string exactly matches the original reference; do not normalize paths, case or separators. All other fields remain their own original values. Expand those exact objects in order; every finding-to-receipt relationship is retained. Only byte-identical serialized receipt objects are shared. Same hashes with different references or observation/expiry times remain separate. No receipt is renewed or inferred current.',evidencePool:encodedPool,evidenceReferencePrefixes:prefixes,historyLimit:'Noncritical finding prose and explicitly classified execution finding prose are not inspected by the model; do not infer their omitted contents. These are retained findings, not resolved or approved findings. Independent QA must inspect the full retained record and each classification. Unclassified critical prose and all executable contracts remain whole. Explicit execution contracts retain every original evidence identity, conclusion and expiry; they require future fresh server-owned checks and imply no live readiness.',content:{...record.content,findings}};
}

/** Resolve a prompt identity only; this never authorizes a filesystem read. */
export function synthesisEvidenceReference(value:unknown,prefixes:unknown,allowEncoded=false):string|undefined{
 if(!value||typeof value!=='object')return undefined;
 const row=value as Record<string,unknown>;
 if(Object.hasOwn(row,'reference'))return !Object.hasOwn(row,'referenceFromSha256')&&typeof row.reference==='string'?row.reference:undefined;
 if(!allowEncoded||!Object.hasOwn(row,'referenceFromSha256')||!Number.isSafeInteger(row.referenceFromSha256)||Number(row.referenceFromSha256)<0||!Array.isArray(prefixes)||!Object.hasOwn(prefixes,Number(row.referenceFromSha256))||typeof prefixes[Number(row.referenceFromSha256)]!=='string'||!Object.hasOwn(row,'sha256')||typeof row.sha256!=='string'||! /^[a-f0-9]{64}$/.test(row.sha256))return undefined;
 return prefixes[Number(row.referenceFromSha256)]+row.sha256+'.json';
}

/** Keep whole verified texts when they fit; never silently truncate evidence. */
export function boundedSynthesisPrompt(base:Record<string,unknown>,captured:readonly {reference:string;sha256:string;status:string;reason?:string;text?:string}[],maxBytes=256*1024){
 const items: {reference:string;sha256:string;status:string;reason?:string;text?:string;textOmitted?:true}[]=captured.map(({text,...item})=>({...item,...(text!==undefined?{status:'unavailable',textOmitted:true as const}:{})}));
 const context=base.discoveryEvidence as {projection?:unknown;evidencePool?:unknown;evidenceReferencePrefixes?:unknown}|null|undefined;
 const pool=['planning-only-exact-evidence-pool-v5','planning-only-exact-evidence-pool-v6'].includes(String(context?.projection))&&Array.isArray(context?.evidencePool)?context.evidencePool:[];
 const indices=items.map(item=>pool.findIndex(e=>e&&typeof e==='object'&&Object.hasOwn(e,'sha256')&&synthesisEvidenceReference(e,context?.evidenceReferencePrefixes,context?.projection==='planning-only-exact-evidence-pool-v6')===item.reference&&e.sha256===item.sha256));
 const encode=()=>JSON.stringify({...base,capturedEvidenceIdentityRule:indices.some(index=>index>=0)?'For each sourceEvidenceIndex, copy ONLY reference and sha256 from discoveryEvidence.evidencePool at that index, reconstructing reference exactly per discoveryEvidence.evidenceEncoding when referenceFromSha256 is present. This is an exact source-identity link; no observation time, expiry, approval or readiness is inferred from that receipt.':undefined,capturedEvidenceOmissionRule:items.some(item=>item.textOmitted)?'For each textOmitted:true entry, verified text was omitted from model input to respect the planning budget; do not infer its contents. References and digests are retained.':undefined,capturedEvidence:items.map((item,i)=>{if(indices[i]<0)return item;const {reference,sha256,...rest}=item;return{...rest,sourceEvidenceIndex:indices[i]};})});
 if(Buffer.byteLength(encode())>maxBytes)throw new Error('Architecture planning scope exceeds its bound; split the current scope without deleting history');
 // Keep inference input bounded even when omitted history frees capacity.
 // Whole evidence texts only; larger sources remain available to independent
 // QA through their exact retained references, never silently truncated.
 let textBytes=0;
 for(let i=0;i<captured.length;i++)if(captured[i].text!==undefined){const prior=items[i],bytes=Buffer.byteLength(captured[i].text!);if(textBytes+bytes>16*1024)continue;items[i]=captured[i];if(Buffer.byteLength(encode())>maxBytes)items[i]=prior;else textBytes+=bytes;}
 return encode();
}
