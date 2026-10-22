import {z} from 'zod';
import type {SynthesisRequirement} from './synthesisTraceability.ts';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';

/** Bound generated prose before inference, never truncate returned/source data.
 * Required fields, complete traceability and semantic review remain mandatory. */
export function synthesisResponseSchema(){
 const schema=z.toJSONSchema(synthesisOutputSchema,{target:'draft-07'}) as any;
 for(const field of ['summary','architecture','dataModel','securityAndGovernance','operationsAndRecovery'])schema.properties[field].maxLength=1200;
 const requirement=schema.properties.requirements.items.properties;
 for(const field of ['design','acceptance'])requirement[field].maxLength=240;
 for(const field of ['topology','erd','sequence'])schema.properties.mermaidDiagrams.properties[field].maxLength=1600;
 for(const field of ['decisions','risks']){
  schema.properties[field].maxItems=8;
  for(const value of Object.values(schema.properties[field].items.properties) as any[])value.maxLength=600;
 }
 delete requirement.sourceSha256;
 delete requirement.requirement;
 schema.properties.requirements.items.required=schema.properties.requirements.items.required.filter((key:string)=>!['sourceSha256','requirement'].includes(key));
 return schema;
}
export const synthesisResponseGuidance='Return compact structured JSON within the existing five-minute budget: use concise distinct design/acceptance sentences, not repeated copies of source records. Narrative sections must fit 1200 characters each and design/acceptance prose 240 characters per field; use compact diagrams. Cover every supplied catalogue ID exactly once with valid plan links. Omit requirement and sourceSha256 from requirement output: the server copies the exact complete source text and digest after validating complete unique IDs. Spend output only on design, acceptance and valid plan links. Preserve all substantive missing evidence, risk and permission boundaries; do not invent readiness or drop requirements to fit. The full source remains available to independent QA. Do not emit preliminary messages; return only the final schema-valid object.';

/** Source digests are server-owned copies, never an inference task. Full legacy
 * responses still validate their claimed digest before publication. */
export function expandSynthesisResponse(raw:unknown,catalogue:SynthesisRequirement[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return synthesisOutputSchema.parse(raw);
 const value=raw as Record<string,unknown>;
 if(!Array.isArray(value.requirements))return synthesisOutputSchema.parse(raw);
 const seen=new Set<string>();
 const requirements=value.requirements.map((row:unknown)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Synthesis requirement row is malformed');
  const item=row as Record<string,unknown>,source=catalogue.find(source=>source.id===item.requirementId);
  if(!source||seen.has(source.id))throw new Error('Synthesis requirement identity is unknown or duplicated');
  seen.add(source.id);
  if(Object.hasOwn(item,'sourceSha256')&&item.sourceSha256!==source.sourceSha256)throw new Error('Synthesis requirement source differs from the captured brief');
  const requirement=Object.hasOwn(item,'requirement')?z.string().trim().min(20).max(8000).parse(item.requirement):source.text;
  return {...item,requirement,sourceSha256:source.sourceSha256};
 });
 if(seen.size!==catalogue.length)throw new Error('Synthesis does not cover every declared requirement exactly once');
 return synthesisOutputSchema.parse({...value,requirements});
}
