import {z} from 'zod';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),text=z.string().trim().min(1).max(4000);
const links=z.array(id).min(1).max(100).refine(rows=>new Set(rows).size===rows.length,'Links must be unique'),refs=z.array(id).max(100).refine(rows=>new Set(rows).size===rows.length,'References must be unique');
export const applicationSpecSchema=z.strictObject({
  schemaVersion:z.literal(1),
  journeys:z.array(z.strictObject({id,actor:text,outcome:text,requirementIds:links,scenarios:z.array(z.strictObject({id,kind:z.enum(['happy','denied','failure']),given:text,when:text,then:text})).min(1).max(30)})).min(1).max(50),
  decisions:z.array(z.strictObject({id,question:text,owner:id,requirementIds:links,material:z.boolean(),status:z.enum(['open','answered']),answer:text.optional(),answerSource:text.optional()})).max(100),
  assumptions:z.array(z.strictObject({id,statement:text,owner:id,requirementIds:links,critical:z.boolean(),status:z.enum(['unverified','validated','rejected']),findingIds:refs})).max(100),
  components:z.array(z.strictObject({id,platform:z.enum(['dataverse','sharepoint','canvas','flow','model-driven','power-pages','code-apps','copilot-studio','other']),owner:id,requirementIds:links,contractIds:refs,dependsOn:refs,findingIds:refs})).min(1).max(100),
  securityBoundaries:z.array(z.strictObject({id,actor:text,allowed:text,denied:text,requirementIds:links,findingIds:refs})).min(1).max(100),
  checks:z.array(z.strictObject({id,kind:z.enum(['compile','package','runtime','access','recovery','documentation']),requirementIds:links,componentIds:links,scenarioIds:refs,expectedEvidence:text})).min(1).max(200),
}).superRefine((spec,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  for(const key of ['journeys','decisions','assumptions','components','securityBoundaries','checks'] as const)if(new Set(spec[key].map(row=>row.id)).size!==spec[key].length)fail(`Duplicate application ${key} IDs`);
  const scenarios=spec.journeys.flatMap(j=>j.scenarios.map(s=>s.id));if(new Set(scenarios).size!==scenarios.length)fail('Scenario IDs must be unique across journeys');
  const components=new Set(spec.components.map(c=>c.id));
  for(const decision of spec.decisions){if(decision.status==='answered'&&(!decision.answer||!decision.answerSource))fail('Answered decisions need an answer and source');if(decision.status==='open'&&(decision.answer||decision.answerSource))fail('Open decisions cannot silently contain an accepted answer');}
  for(const assumption of spec.assumptions)if(assumption.status==='validated'&&!assumption.findingIds.length)fail('Validated assumptions need observed findings');
  for(const check of spec.checks){if(check.componentIds.some(ref=>!components.has(ref)))fail('Check refers to an unknown component');if(check.scenarioIds.some(ref=>!scenarios.includes(ref)))fail('Check refers to an unknown scenario');if(['runtime','access'].includes(check.kind)&&!check.scenarioIds.length)fail('Runtime and access checks need observable scenarios');}
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(key:string)=>{if(visiting.has(key)){fail('Component dependencies contain a cycle');return;}if(visited.has(key))return;visiting.add(key);for(const dep of spec.components.find(c=>c.id===key)?.dependsOn??[]){if(!components.has(dep))fail('Unknown component dependency');else visit(dep);}visiting.delete(key);visited.add(key);};
  for(const component of spec.components)visit(component.id);
});
export type ApplicationSpec=z.infer<typeof applicationSpecSchema>;
type Finding={id:string;status:string;conclusion?:string;evidence:{observedAt:string;expiresAt:string}[]};
export function applicationSpecBlockers(spec:ApplicationSpec,findings:Finding[],now=Date.now()):string[]{
  const blockers=spec.decisions.filter(d=>d.material&&d.status==='open').map(d=>`${d.id}: answer ${d.question} (owner: ${d.owner})`);
  for(const assumption of spec.assumptions){
    const observed=assumption.findingIds.map(id=>findings.find(f=>f.id===id));
    const valid=assumption.status==='validated'&&observed.length>0&&observed.every(f=>f?.status==='observed'&&f.conclusion==='ready'&&f.evidence.length>0&&f.evidence.every(e=>Date.parse(e.observedAt)<=now+60000&&Date.parse(e.expiresAt)>now));
    if(assumption.critical&&!valid)blockers.push(`${assumption.id}: validate or reconcile the critical assumption (owner: ${assumption.owner})`);
  }
  return blockers;
}

/** Link the specification to existing record identities instead of copying platform facts. */
export function applicationSpecLinkErrors(spec:ApplicationSpec,record:{requirements:{id:string}[];contracts:{id:string}[];findings:{id:string}[]}):string[]{
  const errors:string[]=[],requirements=new Set(record.requirements.map(r=>r.id)),contracts=new Set(record.contracts.map(c=>c.id)),findings=new Set(record.findings.map(f=>f.id));
  const rows=[...spec.journeys,...spec.decisions,...spec.assumptions,...spec.components,...spec.securityBoundaries,...spec.checks];
  for(const row of rows)if(row.requirementIds.some(id=>!requirements.has(id))||new Set(row.requirementIds).size!==row.requirementIds.length)errors.push(`${row.id}: unknown or duplicate requirement link`);
  for(const requirement of requirements){if(!spec.journeys.some(j=>j.requirementIds.includes(requirement)))errors.push(`${requirement}: missing user journey`);if(!spec.checks.some(c=>c.requirementIds.includes(requirement)))errors.push(`${requirement}: missing verification check`);}
  for(const component of spec.components){if(component.contractIds.some(id=>!contracts.has(id)))errors.push(`${component.id}: unknown shared contract`);}
  for(const row of [...spec.assumptions,...spec.components,...spec.securityBoundaries])if(row.findingIds.some(id=>!findings.has(id)))errors.push(`${row.id}: unknown evidence finding`);
  for(const check of spec.checks){
    if(check.componentIds.some(id=>!spec.components.find(component=>component.id===id)?.requirementIds.some(requirement=>check.requirementIds.includes(requirement))))errors.push(`${check.id}: component belongs to unrelated requirements`);
    for(const scenario of check.scenarioIds){const journey=spec.journeys.find(j=>j.scenarios.some(s=>s.id===scenario));if(journey&&!journey.requirementIds.some(id=>check.requirementIds.includes(id)))errors.push(`${check.id}: scenario belongs to unrelated requirements`);}
  }
  return errors;
}
