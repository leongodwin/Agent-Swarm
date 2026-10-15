import crypto from 'node:crypto';
import type {HldInput} from '../shared/hld.ts';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';
import type {z} from 'zod';
export interface SynthesisRequirement {id:string;kind:'brief'|'tenant-context'|'component'|'deliverable'|'delivery-requirement';text:string;sourceSha256:string}
export function synthesisRequirements(input:HldInput,record?:import('../shared/deliveryRecord.ts').DeliveryRecord):SynthesisRequirement[]{
  const rows:{id:string;kind:SynthesisRequirement['kind'];text:string}[]=[{id:'brief',kind:'brief',text:input.problemContext}];
  if(input.tenantName)rows.push({id:'tenant-context',kind:'tenant-context',text:input.tenantName});
  for(const requirement of record?.content.requirements??[])rows.push({id:`delivery-${requirement.id}`,kind:'delivery-requirement',text:JSON.stringify(requirement)});
  input.components.forEach((component,index)=>{const id=`component-${index+1}`;rows.push({id,kind:'component',text:JSON.stringify({title:component.title,role:component.role,badge:component.badge,details:component.details})});component.deliverables.forEach((text,position)=>rows.push({id:`${id}-deliverable-${position+1}`,kind:'deliverable',text}));});
  if(rows.length>1000)throw new Error('Synthesis traceability exceeds 1,000 declared requirements; split the brief before synthesis');
  return rows.map(row=>({...row,sourceSha256:crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')}));
}
/** Exact input coverage and plan links are structural evidence, not semantic QA. */
export function requireSynthesisTraceability(catalogue:SynthesisRequirement[],design:z.infer<typeof synthesisOutputSchema>){
  const planIds=new Set(design.implementationPlan.map(step=>step.id));
  if(planIds.size!==design.implementationPlan.length||design.implementationPlan.some(step=>!step.deliverables.length||!step.acceptance.length))throw new Error('Synthesis plan has ambiguous identities or missing deliverables/acceptance');
  if(design.requirements.length!==catalogue.length||new Set(design.requirements.map(row=>row.requirementId)).size!==catalogue.length)throw new Error('Synthesis does not cover every declared requirement exactly once');
  for(const row of design.requirements){const source=catalogue.find(item=>item.id===row.requirementId);
    if(!source||source.sourceSha256!==row.sourceSha256)throw new Error('Synthesis requirement identity/source differs from the captured brief');
    if(new Set(row.planStepIds).size!==row.planStepIds.length||row.planStepIds.some(id=>!planIds.has(id)))throw new Error('Synthesis requirement has missing or ambiguous implementation-plan links');
  }
}
