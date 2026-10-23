import {functionalRejectedCheckSchema} from './functionalShowcase.ts';
import {z} from 'zod';
import {deniedAssertionSchema} from './nativeQa.ts';
import type {DeliveryRecordContent} from './deliveryRecord.ts';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),text=z.string().trim().min(1).max(2000);
const ids=z.array(id).max(100).refine(v=>new Set(v).size===v.length,'Duplicate task links');
export const integrationQaSchema=z.strictObject({
 id,owner:id,purpose:z.enum(['preparation','slice','expansion']),requirementIds:ids.optional(),runner:z.literal('delivery'),
 dependsOn:z.array(z.number().int().positive()).min(1).max(200),
 checkIds:ids.refine(v=>v.length>0,'Declare integration checks'),
 cases:z.array(z.strictObject({checkId:id,scenarioId:id,testName:z.string().trim().min(1).max(200),criterion:text,nativeAssertion:deniedAssertionSchema.optional(),functionalAssertion:functionalRejectedCheckSchema.shape.contract.optional()})).min(1).max(200),
 maxTaskDurationMs:z.number().int().min(1000).max(120000),
 maxVerificationDurationMs:z.number().int().min(1000).max(3600000).optional(),
 stopConditions:z.array(text).min(1).max(20),
});
export const taskPlanSchema=z.strictObject({schemaVersion:z.union([z.literal(1),z.literal(2)]),integrationQa:z.array(integrationQaSchema).min(1).max(3).optional(),tasks:z.array(z.strictObject({
  issue:z.number().int().positive(),owner:id,componentIds:ids.refine(v=>v.length>0,'Declare owned components'),
  dependsOn:z.array(z.number().int().positive()).max(100).refine(v=>new Set(v).size===v.length,'Duplicate task dependencies'),
  resources:ids,inputs:z.array(text).min(1).max(20),outputs:z.array(text).min(1).max(20),checkIds:ids.refine(v=>v.length>0,'Declare checks'),stopConditions:z.array(text).min(1).max(20),
})).min(1).max(200)});
export type TaskPlan=z.infer<typeof taskPlanSchema>;
export function taskPlanErrors(content:DeliveryRecordContent):string[]{
  const plan=content.taskPlan;if(!plan)return [];
  const errors:string[]=[],spec=content.applicationSpec;
  if(!spec)return ['Task contracts require an application specification'];
  if(new Set(plan.tasks.map(t=>t.issue)).size!==plan.tasks.length)errors.push('Duplicate task contract issues');
  for(const task of plan.tasks){
    if(plan.schemaVersion===2)for(const key of task.checkIds){const check=spec.checks.find(c=>c.id===key);if(check&&(check.componentIds.some(id=>!task.componentIds.includes(id))||check.requirementIds.some(id=>!content.tasks.find(t=>t.issue===task.issue)?.requirementIds.includes(id))))errors.push(`Task #${task.issue}: author acceptance check ${key} exceeds owned component or requirement scope`);}
    if(task.owner===content.qaOwner)errors.push(`Task #${task.issue}: author and independent QA must differ`);
    const linked=content.tasks.find(t=>t.issue===task.issue);
    if(!linked||!['slice','implementation'].includes(linked.stage))errors.push(`Task #${task.issue} must be an authoring-stage issue`);
    for(const key of task.componentIds){const component=spec.components.find(c=>c.id===key);if(!component||component.owner!==task.owner)errors.push(`Task #${task.issue}: component owner mismatch or unknown component ${key}`);else if(!component.requirementIds.some(r=>linked?.requirementIds.includes(r)))errors.push(`Task #${task.issue}: unrelated component ${key}`);}
    for(const key of task.checkIds){const check=spec.checks.find(c=>c.id===key);if(!check||!check.componentIds.some(c=>task.componentIds.includes(c))||!check.requirementIds.some(r=>linked?.requirementIds.includes(r)))errors.push(`Task #${task.issue}: missing or unrelated check ${key}`);}
    for(const dep of task.dependsOn)if(!plan.tasks.some(t=>t.issue===dep))errors.push(`Task #${task.issue}: missing dependency #${dep}`);
    const requiredComponents=task.componentIds.flatMap(key=>spec.components.find(c=>c.id===key)?.dependsOn??[]).filter(key=>!task.componentIds.includes(key));
    for(const key of requiredComponents)if(!task.dependsOn.some(issue=>plan.tasks.find(t=>t.issue===issue)?.componentIds.includes(key)))errors.push(`Task #${task.issue}: component dependency ${key} needs an explicit prerequisite task`);
  }
  for(const task of content.tasks.filter(t=>['slice','implementation'].includes(t.stage)))if(!plan.tasks.some(t=>t.issue===task.issue))errors.push(`Task #${task.issue} lacks an execution contract`);
  const visiting=new Set<number>(),visited=new Set<number>();
  const visit=(issue:number)=>{if(visiting.has(issue)){errors.push('Task dependencies contain a cycle');return;}if(visited.has(issue))return;visiting.add(issue);for(const dep of plan.tasks.find(t=>t.issue===issue)?.dependsOn??[])visit(dep);visiting.delete(issue);visited.add(issue);};
  for(const task of plan.tasks)visit(task.issue);
  if(plan.schemaVersion===2){
    const qa=plan.integrationQa??[];
    for(const purpose of ['preparation','slice','expansion'] as const){
      if(purpose==='preparation'&&!qa.some(q=>q.purpose==='preparation'))continue;
      if(purpose==='expansion'&&!content.tasks.some(t=>t.stage==='implementation'))continue;
      const scoped=plan.tasks.filter(t=>purpose==='expansion'||content.tasks.find(link=>link.issue===t.issue)?.stage==='slice');
      if(!scoped.length)continue;
      const matches=qa.filter(q=>q.purpose===purpose);
      if(matches.length!==1){errors.push(`Declare exactly one ${purpose} independent integration QA contract`);continue;}
      const q=matches[0],required=scoped.map(t=>t.issue);
      if(q.owner!==content.qaOwner||q.owner===content.owner||plan.tasks.some(t=>t.owner===q.owner))errors.push(`${q.id}: integration QA must belong to the assigned independent reviewer`);
      if(q.dependsOn.length!==new Set(q.dependsOn).size||q.dependsOn.length!==required.length||required.some(n=>!q.dependsOn.includes(n)))errors.push(`${q.id}: integration prerequisites must be exactly the scoped author tasks`);
      const requirements=purpose==='preparation'?(q.requirementIds??[]):purpose==='slice'?content.slice.requirementIds:content.requirements.map(r=>r.id);
      if(purpose==='preparation'&&(!requirements.length||requirements.some(id=>!content.requirements.some(r=>r.id===id))||spec.components.some(c=>c.platform!=='flow')))errors.push(`${q.id}: preparation requires explicit declared requirements and flow-only components`);
      if(purpose!=='preparation'&&q.requirementIds!==undefined)errors.push(`${q.id}: real acceptance scope cannot be narrowed`);
      const scenarios=spec.journeys.filter(j=>j.requirementIds.some(r=>requirements.includes(r))).flatMap(j=>j.scenarios);
      const componentIds=new Set(scoped.flatMap(t=>t.componentIds));
      const authorChecks=new Set(plan.tasks.flatMap(t=>t.checkIds)),scopedChecks=new Set(scoped.flatMap(t=>t.checkIds));
      const checks=spec.checks.filter(c=>purpose==='preparation'?c.requirementIds.some(r=>requirements.includes(r)):scopedChecks.has(c.id)||!authorChecks.has(c.id)&&(c.requirementIds.some(r=>requirements.includes(r))||c.componentIds.some(id=>componentIds.has(id))));
      if(q.checkIds.length!==checks.length||checks.some(c=>!q.checkIds.includes(c.id)))errors.push(`${q.id}: integration contract must cover every scoped check`);
      for(const key of q.checkIds)if(!checks.some(c=>c.id===key))errors.push(`${q.id}: unknown or unrelated integration check ${key}`);
      for(const check of checks.filter(c=>['runtime','access'].includes(c.kind)))for(const id of check.scenarioIds.filter(id=>scenarios.some(s=>s.id===id)))if(!q.cases.some(row=>row.checkId===check.id&&row.scenarioId===id))errors.push(`${q.id}: missing executable check/scenario ${check.id}/${id}`);
      for(const scenario of scenarios)if(!q.cases.some(c=>c.scenarioId===scenario.id))errors.push(`${q.id}: missing executable scenario ${scenario.id}`);
      for(const row of q.cases){const check=spec.checks.find(c=>c.id===row.checkId),scenario=scenarios.find(s=>s.id===row.scenarioId);
        if((row.nativeAssertion||row.functionalAssertion)&&scenario?.kind!=='denied')errors.push(`${q.id}: native denial requires a denied scenario`);
        if(row.nativeAssertion&&row.functionalAssertion)errors.push(`${q.id}: choose one explicit denial assurance contract`);
        if(!q.checkIds.includes(row.checkId)||!check||!['runtime','access'].includes(check.kind)||!check.scenarioIds.includes(row.scenarioId)||!scenario)errors.push(`${q.id}: unrelated integration scenario/check binding`);
        if(!content.requirements.some(r=>requirements.includes(r.id)&&check?.requirementIds.includes(r.id)&&spec.journeys.some(j=>j.scenarios.some(s=>s.id===row.scenarioId)&&j.requirementIds.includes(r.id))&&r.acceptance===row.criterion))errors.push(`${q.id}: unrelated acceptance criterion`);
      }
      if(new Set(q.cases.map(c=>`${c.checkId}:${c.scenarioId}`)).size!==q.cases.length||q.cases.some(c=>q.cases.some(other=>other.testName===c.testName&&other.scenarioId!==c.scenarioId)))errors.push(`${q.id}: duplicate executable scenario bindings`);
    }
    if(!content.tasks.some(t=>t.stage==='implementation')&&qa.some(q=>q.purpose==='expansion'))errors.push('Expansion integration requires scoped implementation tasks');
    if(new Set(qa.map(q=>q.id)).size!==qa.length||new Set(qa.map(q=>q.purpose)).size!==qa.length)errors.push('Integration QA identities and phases must be unique');
  }
  return errors;
}

/** Dependency closure and task-local requirements, never a second source of platform facts. */
export function taskScope(content:DeliveryRecordContent,issue:number){
  const plan=content.taskPlan,spec=content.applicationSpec,task=plan?.tasks.find(t=>t.issue===issue);
  if(!plan||!spec||!task)return null;
  const issues=new Set<number>();const visit=(n:number)=>{if(issues.has(n))return;issues.add(n);for(const dep of plan.tasks.find(t=>t.issue===n)?.dependsOn??[])visit(dep);};visit(issue);
  const tasks=plan.tasks.filter(t=>issues.has(t.issue)),components=spec.components.filter(c=>tasks.some(t=>t.componentIds.includes(c.id)));
  const requirements=new Set(content.tasks.filter(t=>issues.has(t.issue)).flatMap(t=>t.requirementIds));
  for(const c of components)for(const id of c.requirementIds)requirements.add(id);
  // The accepted first slice remains a prerequisite of expansion work.
  if(content.tasks.find(t=>t.issue===issue)?.stage==='implementation')for(const id of content.slice.requirementIds)requirements.add(id);
  const relevant=(row:{requirementIds:string[]})=>row.requirementIds.some(id=>requirements.has(id));
  const contracts=content.contracts.filter(c=>relevant(c)||components.some(component=>component.contractIds.includes(c.id)));
  const assumptions=spec.assumptions.filter(relevant),securityBoundaries=spec.securityBoundaries.filter(relevant);
  const findingIds=new Set([...components,...assumptions,...securityBoundaries].flatMap(row=>row.findingIds));
  const {applicationSpec:_spec,taskPlan:_plan,requirements:_req,findings:_findings,contracts:_contracts,tasks:_tasks,slice:_slice,...global}=content;
  return {global,task,tasks,stages:content.tasks.filter(t=>issues.has(t.issue)),requirements:content.requirements.filter(r=>requirements.has(r.id)),
    contracts,findings:content.findings.filter(f=>f.critical||findingIds.has(f.id)),components,journeys:spec.journeys.filter(relevant),decisions:spec.decisions.filter(relevant),assumptions,securityBoundaries,
    checks:spec.checks.filter(c=>relevant(c)&&tasks.some(t=>t.checkIds.includes(c.id))),slice:content.tasks.find(t=>t.issue===issue)?.stage==='implementation'?content.slice:content.tasks.find(t=>t.issue===issue)?.stage==='slice'?{...content.slice,requirementIds:content.slice.requirementIds.filter(id=>requirements.has(id))}:undefined};
}
