import {z} from 'zod';
import type {HldInput} from '../shared/hld.ts';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';
import {selectSkills,type SkillCatalogue} from './skillRegistry.ts';
const reference=z.object({id:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),platform:z.string().max(100).optional(),toolStatus:z.literal('unverified')}).passthrough();
const paused=(skill:{id:string;platform?:string})=>skill.platform==='copilot-studio'||/add-mcscopilot|copilot-publish/i.test(skill.id);
export function selectSynthesisSkills(catalogue:SkillCatalogue,mission:string,input:HldInput|undefined,copilotPaused:boolean){
  const filtered={...catalogue,skills:catalogue.skills.filter(skill=>!copilotPaused||!paused(skill))};
  const ranked=selectSkills(filtered,`${mission} ${input?JSON.stringify(input):''}`,filtered.skills.length),selected:typeof ranked=[];
  // Give each recognized platform a relevant reference before filling the
  // remaining bounded context with highest-scoring specialist instructions.
  for(const skill of ranked)if(!selected.some(row=>row.platform===skill.platform))selected.push(skill);
  for(const skill of ranked)if(selected.length<8&&!selected.includes(skill))selected.push(skill);
  return selected.slice(0,8);
}
export function planningSkillReferences(raw:unknown[],copilotPaused:boolean){
  const skills=z.array(reference).max(100).parse(raw).filter(skill=>!copilotPaused||!paused(skill));
  if(new Set(skills.map(skill=>skill.id)).size!==skills.length)throw new Error('Synthesis skill catalogue has ambiguous identities');return skills;
}
export function requireSynthesisSkills(raw:unknown[],copilotPaused:boolean,design:z.infer<typeof synthesisOutputSchema>){
  const skills=planningSkillReferences(raw,copilotPaused),selected=design.skillBindings,steps=new Set(design.implementationPlan.map(step=>step.id));
  if(skills.length&&!selected.length)throw new Error('Synthesis must bind selected installed skill guidance to its implementation plan');
  if(new Set(selected.map(row=>row.skillId)).size!==selected.length)throw new Error('Synthesis skill bindings contain duplicate identities');
  for(const binding of selected){const skill=skills.find(row=>row.id===binding.skillId);if(!skill||skill.sha256!==binding.sourceSha256)throw new Error('Synthesis selected an unavailable, paused or changed skill');
    if(new Set(binding.planStepIds).size!==binding.planStepIds.length||binding.planStepIds.some(id=>!steps.has(id)))throw new Error('Synthesis skill binding has missing or ambiguous plan links');
  }
}
