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
  return {...identity,evidence,omittedProse:[bytes.length,crypto.createHash('sha256').update(bytes).digest('hex')] as const};
 });
 const prefixes:string[]=[],prefixCounts=new Map<string,number>();
 for(const item of evidencePool)if(/^[a-f0-9]{64}$/.test(item.sha256)&&item.reference.endsWith(item.sha256+'.json')){const prefix=item.reference.slice(0,-69);prefixCounts.set(prefix,(prefixCounts.get(prefix)??0)+1);}
 const encodedPool=evidencePool.map(item=>{
  if(!/^[a-f0-9]{64}$/.test(item.sha256)||!item.reference.endsWith(item.sha256+'.json'))return item;
  const prefix=item.reference.slice(0,-69);if((prefixCounts.get(prefix)??0)<2)return item;
  let index=prefixes.indexOf(prefix);if(index<0){index=prefixes.length;prefixes.push(prefix);}
  const {reference,...rest}=item;return {...rest,referenceFromSha256:index};
 });
 const compactPool=encodedPool.map((encoded,index)=>{
  const item=evidencePool[index];
  if(Object.keys(item).length!==4||!['reference','sha256','observedAt','expiresAt'].every(k=>Object.hasOwn(item,k))||!/^[a-f0-9]{64}$/.test(item.sha256)||typeof item.reference!=='string'||typeof item.observedAt!=='string'||typeof item.expiresAt!=='string')return encoded;
  return ['referenceFromSha256' in encoded?encoded.referenceFromSha256:item.reference,item.sha256,item.observedAt,item.expiresAt] as const;
 });
 const findingOwners:string[]=[],ownerCounts=new Map<string,number>();
 for(const f of record.content.findings)if(typeof f.owner==='string'&&f.owner.length>16)ownerCounts.set(f.owner,(ownerCounts.get(f.owner)??0)+1);
 const compactFindings=findings.map(f=>{if(typeof f.owner!=='string'||(ownerCounts.get(f.owner)??0)<2)return f;let ownerIndex=findingOwners.indexOf(f.owner);if(ownerIndex<0){ownerIndex=findingOwners.length;findingOwners.push(f.owner);}const {owner,...rest}=f;return{...rest,ownerIndex};});
 return {projection:'planning-only-exact-evidence-pool-v7',reference:{id:record.id,revision:record.revision,sha256:record.sha256},findingOwners,ownerEncoding:'Only a finding ownerIndex refers to the exact literal findingOwners[index]. Other owner fields remain literal. This is identity compression, never a role assignment or approval.',omittedProseEncoding:'An omittedProse pair is [fullFindingBytes,fullFindingSha256] for the complete original finding. Only statement and remedy were omitted under the existing noncritical/explicit-execution rule; all other fields remain explicit. It grants no resolution, freshness or approval.',evidenceEncoding:'Each finding.evidence entry refers by evidenceIndex to the complete original receipt in evidencePool. A four-element row is [referenceOrPrefixIndex,sha256,observedAt,expiresAt], preserving each exact original string without date conversion. This layout does not redefine original source serialization or hashes; independent QA uses the retained originals. A string first element is the literal reference; an integer first element reconstructs ONLY reference as the exact literal evidenceReferencePrefixes[index] + the same row own sha256 + .json. Fallback object rows preserve their fields. If an object has referenceFromSha256, reconstruct ONLY its reference as the exact literal evidenceReferencePrefixes[referenceFromSha256] + its own sha256 + .json. This representation is used only when that string exactly matches the original reference; do not normalize paths, case or separators. All other fields remain their own original values. Expand those exact objects in order; every finding-to-receipt relationship is retained. Only byte-identical serialized receipt objects are shared. Same hashes with different references or observation/expiry times remain separate. No receipt is renewed or inferred current.',evidencePool:compactPool,evidenceReferencePrefixes:prefixes,historyLimit:'Noncritical finding prose and explicitly classified execution finding prose are not inspected by the model; do not infer their omitted contents. These are retained findings, not resolved or approved findings. Independent QA must inspect the full retained record and each classification. Unclassified critical prose and all executable contracts remain whole. Explicit execution contracts retain every original evidence identity, conclusion and expiry; they require future fresh server-owned checks and imply no live readiness.',content:{...record.content,findings:compactFindings}};
}

/** Resolve a prompt identity only; this never authorizes a filesystem read. */
export function synthesisEvidenceReference(value:unknown,prefixes:unknown,allowEncoded=false):string|undefined{
 if(!value||typeof value!=='object')return undefined;
 const row=value as Record<string,unknown>;
 if(Object.hasOwn(row,'reference'))return !Object.hasOwn(row,'referenceFromSha256')&&typeof row.reference==='string'?row.reference:undefined;
 if(!allowEncoded||!Object.hasOwn(row,'referenceFromSha256')||!Number.isSafeInteger(row.referenceFromSha256)||Number(row.referenceFromSha256)<0||!Array.isArray(prefixes)||!Object.hasOwn(prefixes,Number(row.referenceFromSha256))||typeof prefixes[Number(row.referenceFromSha256)]!=='string'||!Object.hasOwn(row,'sha256')||typeof row.sha256!=='string'||! /^[a-f0-9]{64}$/.test(row.sha256))return undefined;
 return prefixes[Number(row.referenceFromSha256)]+row.sha256+'.json';
}

/** Decode only the declared prompt format. This restores identity metadata,
 * never filesystem access, freshness, or an execution grant. */
export function synthesisEvidenceReceipt(value:unknown,prefixes:unknown,projection:unknown):Record<string,unknown>&{reference:string;sha256:string}|undefined{
 if(!['planning-only-exact-evidence-pool-v5','planning-only-exact-evidence-pool-v6','planning-only-exact-evidence-pool-v7'].includes(String(projection)))return undefined;
 if(Array.isArray(value)){
  if(projection!=='planning-only-exact-evidence-pool-v7'||value.length!==4||Object.keys(value).length!==4||![0,1,2,3].every(i=>Object.hasOwn(value,i)))return undefined;
  const [ref,sha256,observedAt,expiresAt]=value;
  if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||typeof observedAt!=='string'||typeof expiresAt!=='string')return undefined;
  const reference=typeof ref==='string'?ref:synthesisEvidenceReference({referenceFromSha256:ref,sha256},prefixes,true);
  return reference===undefined?undefined:{reference,sha256,observedAt,expiresAt};
 }
 if(!value||typeof value!=='object'||!Object.hasOwn(value,'sha256')||typeof (value as Record<string,unknown>).sha256!=='string')return undefined;
 const row=value as Record<string,unknown>,reference=synthesisEvidenceReference(row,prefixes,['planning-only-exact-evidence-pool-v6','planning-only-exact-evidence-pool-v7'].includes(String(projection)));
 if(reference===undefined)return undefined;
 const {referenceFromSha256,...rest}=row;return{...rest,reference,sha256:row.sha256 as string};
}

/** Keep whole verified texts when they fit; never silently truncate evidence. */
export function boundedSynthesisPrompt(base:Record<string,unknown>,captured:readonly {reference:string;sha256:string;status:string;reason?:string;text?:string}[],maxBytes=256*1024){
 const items: {reference:string;sha256:string;status:string;reason?:string;text?:string;textOmitted?:true}[]=captured.map(({text,...item})=>({...item,...(text!==undefined?{status:'unavailable',textOmitted:true as const}:{})}));
 const context=base.discoveryEvidence as {projection?:unknown;evidencePool?:unknown;evidenceReferencePrefixes?:unknown}|null|undefined;
 const pool=['planning-only-exact-evidence-pool-v5','planning-only-exact-evidence-pool-v6','planning-only-exact-evidence-pool-v7'].includes(String(context?.projection))&&Array.isArray(context?.evidencePool)?context.evidencePool:[];
 const indices=items.map(item=>pool.findIndex(e=>{const decoded=synthesisEvidenceReceipt(e,context?.evidenceReferencePrefixes,context?.projection);return decoded?.reference===item.reference&&decoded.sha256===item.sha256;}));
 const encode=()=>JSON.stringify({...base,capturedEvidenceIdentityRule:indices.some(index=>index>=0)?'For each sourceEvidenceIndex, copy ONLY reference and sha256 from discoveryEvidence.evidencePool at that index, reconstructing reference exactly per discoveryEvidence.evidenceEncoding for encoded rows or referenceFromSha256. This is an exact source-identity link; no observation time, expiry, approval or readiness is inferred from that receipt.':undefined,capturedEvidenceOmissionRule:items.some(item=>item.textOmitted)?'For each textOmitted:true entry, verified text was omitted from model input to respect the planning budget; do not infer its contents. References and digests are retained.':undefined,capturedEvidence:items.map((item,i)=>{if(indices[i]<0)return item;const {reference,sha256,...rest}=item;return{...rest,sourceEvidenceIndex:indices[i]};})});
 if(Buffer.byteLength(encode())>maxBytes)throw new Error('Architecture planning scope exceeds its bound; split the current scope without deleting history');
 // Keep inference input bounded even when omitted history frees capacity.
 // Whole evidence texts only; larger sources remain available to independent
 // QA through their exact retained references, never silently truncated.
 let textBytes=0;
 for(let i=0;i<captured.length;i++)if(captured[i].text!==undefined){const prior=items[i],bytes=Buffer.byteLength(captured[i].text!);if(textBytes+bytes>16*1024)continue;items[i]=captured[i];if(Buffer.byteLength(encode())>maxBytes)items[i]=prior;else textBytes+=bytes;}
 return encode();
}
