import type {DeliveryRecordContent} from '../../shared/deliveryRecord.ts';
/** Explicit synthetic fixture migration only; supplies no runtime evidence. */
export function withSyntheticIntegration(data:DeliveryRecordContent):DeliveryRecordContent{
 const plan=data.taskPlan,spec=data.applicationSpec;if(!plan||!spec)throw Error('Synthetic migration requires existing task plan/application specification');
 spec.checks=spec.checks.filter(check=>!/^local-\d+$/.test(check.id));const original=[...spec.checks];
 for(const task of plan.tasks){const linked=data.tasks.find(row=>row.issue===task.issue)!;const id=`local-${task.issue}`;spec.checks.push({id,kind:'package',requirementIds:[...linked.requirementIds],componentIds:[...task.componentIds],scenarioIds:[],expectedEvidence:'Synthetic component-local assertion; not live runtime proof'});task.checkIds=[id];}
 plan.schemaVersion=2;
 plan.integrationQa=(['slice','expansion'] as const).flatMap(purpose=>{
  if(purpose==='expansion'&&!data.tasks.some(task=>task.stage==='implementation'))return[];
  const tasks=plan.tasks.filter(task=>purpose==='expansion'||data.tasks.find(row=>row.issue===task.issue)?.stage==='slice');if(!tasks.length)return[];
  const requirements=purpose==='slice'?data.slice.requirementIds:data.requirements.map(row=>row.id),cases=spec.journeys.filter(j=>j.requirementIds.some(id=>requirements.includes(id))).flatMap(j=>j.scenarios.flatMap(s=>{const checks=original.filter(c=>['runtime','access'].includes(c.kind)&&c.scenarioIds.includes(s.id)&&c.requirementIds.some(id=>j.requirementIds.includes(id)));if(!checks.length)throw Error('Synthetic fixture has no executable runtime check for '+s.id);return checks.map(check=>{const criterion=data.requirements.find(r=>requirements.includes(r.id)&&check.requirementIds.includes(r.id)&&j.requirementIds.includes(r.id))!.acceptance;return{checkId:check.id,scenarioId:s.id,testName:`synthetic-${purpose}-${s.id}`,criterion};});}));
  const components=new Set(tasks.flatMap(task=>task.componentIds)),allAuthorChecks=new Set(plan.tasks.flatMap(task=>task.checkIds)),localChecks=new Set(tasks.flatMap(task=>task.checkIds));const checks=spec.checks.filter(check=>localChecks.has(check.id)||!allAuthorChecks.has(check.id)&&(check.requirementIds.some(id=>requirements.includes(id))||check.componentIds.some(id=>components.has(id))));
  return[{id:`qa-${purpose}`,owner:data.qaOwner,purpose,runner:'delivery' as const,dependsOn:tasks.map(t=>t.issue),checkIds:checks.map(check=>check.id),cases,maxTaskDurationMs:30000,stopConditions:['Synthetic fixture only; unavailable real adapters must block runtime approval']}];
 });return data;
}
