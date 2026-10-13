import {expect,it} from 'vitest';
import {selectSynthesisSkills,planningSkillReferences,requireSynthesisSkills} from './synthesisSkills.ts';
import {synthesisOutputSchema} from '../shared/hldSynthesis.ts';
import type {InstalledSkill} from './skillRegistry.ts';
import type {z} from 'zod';
const skill=(id:string,platform:string):InstalledSkill=>({id,name:id,platform,sha256:'a'.repeat(64),file:'synthetic/SKILL.md',source:'shared',description:'Synthetic installed guidance',toolStatus:'unverified'});
const skills=[skill('dataverse:dv-metadata','dataverse'),skill('create-site','power-pages'),skill('copilot-studio:publish','copilot-studio'),skill('code-apps:add-mcscopilot','code-apps')];
const binding={skillId:skills[0].id,sourceSha256:skills[0].sha256,planStepIds:['build'],rationale:'Use the installed schema instructions; runtime tooling remains unverified.',toolStatus:'unverified' as const};
function design(){return {skillBindings:[{...binding}],implementationPlan:[{id:'build',title:'Build',deliverables:['Artifact'],acceptance:['Independent verification']}] } as z.infer<typeof synthesisOutputSchema>;}
it('selects skills from the submitted scope while keeping paused integration guidance excluded',()=>{
  const catalogue={fingerprint:'synthetic',skills,warnings:[]},input={solutionName:'Website',problemContext:'Build a Power Pages portal and Copilot integration.',components:[]};
  const selected=selectSynthesisSkills(catalogue,'Dataverse schema',input,true);expect(selected.map(row=>row.platform)).toEqual(expect.arrayContaining(['dataverse','power-pages']));expect(selected.some(row=>row.platform==='copilot-studio')).toBe(false);expect(planningSkillReferences(skills,true)).toHaveLength(2);
  expect(selectSynthesisSkills(catalogue,'',input,false).some(row=>row.platform==='copilot-studio')).toBe(true);
});
it('binds actual skill identities and hashes without promoting installation to runtime readiness',()=>{
  expect(()=>requireSynthesisSkills(skills,true,design())).not.toThrow();expect(planningSkillReferences(skills,true)[0].toolStatus).toBe('unverified');
  expect(()=>planningSkillReferences([{...skills[0],toolStatus:'verified'}],true)).toThrow();expect(()=>planningSkillReferences([skills[0],skills[0]],true)).toThrow();
  expect(()=>requireSynthesisSkills([],true,{...design(),skillBindings:[]})).not.toThrow();
});
it('keeps relevant platform guidance in the bounded context despite many higher-scoring specialist skills',()=>{
  const catalogue={fingerprint:'synthetic',warnings:[],skills:[...Array.from({length:12},(_,i)=>skill(`dataverse:dv-specialist-${i}`,'dataverse')),skill('create-site','power-pages')]};
  const selected=selectSynthesisSkills(catalogue,'Dataverse schema',{solutionName:'Portal',problemContext:'A Power Pages portal using Dataverse',components:[]},true);expect(selected).toHaveLength(8);expect(selected.some(row=>row.platform==='power-pages')).toBe(true);
});
it.each(['omitted','unknown','changed','paused','duplicate','bad-link','duplicate-link'] as const)('rejects an unsupported skill plan binding: %s',mode=>{
  const output=design();if(mode==='omitted')output.skillBindings=[];if(mode==='unknown')output.skillBindings[0].skillId='invented';if(mode==='changed')output.skillBindings[0].sourceSha256='b'.repeat(64);if(mode==='paused')output.skillBindings[0].skillId=skills[2].id;if(mode==='duplicate')output.skillBindings.push({...binding});if(mode==='bad-link')output.skillBindings[0].planStepIds=['invented'];if(mode==='duplicate-link')output.skillBindings[0].planStepIds=['build','build'];expect(()=>requireSynthesisSkills(skills,true,output)).toThrow();
});
