import {expect,it} from 'vitest';
import {taskPlanSchema,taskPlanErrors} from '../shared/taskPlan.ts';
import {withSyntheticIntegration} from './testFixtures/taskIntegration.ts';
import {taskScopeHash} from './taskScope.ts';
import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import {assertTaskIntegrationPlan} from './taskIntegration.ts';
import type {ReleasePlan} from './releasePlan.ts';
import {taskPlanningBlockers} from './taskInputs.ts';
import {functionalFixture} from './testFixtures/functionalShowcase.ts';
function fixture(){
 const data={owner:'author',qaOwner:'qa',requirements:[{id:'r',description:'Persist record',acceptance:'Persists after reload'}],slice:{requirementIds:['r'],acceptanceCriteria:['Persists after reload']},tasks:[{issue:5,stage:'slice',requirementIds:['r']},{issue:6,stage:'slice',requirementIds:['r']}],contracts:[],findings:[],applicationSpec:{journeys:[{id:'journey',requirementIds:['r'],scenarios:[{id:'reload',kind:'happy'}]}],components:[{id:'data',owner:'author',requirementIds:['r'],dependsOn:[]},{id:'app',owner:'author',requirementIds:['r'],dependsOn:['data']}],assumptions:[],securityBoundaries:[],decisions:[],checks:[{id:'runtime',kind:'runtime',requirementIds:['r'],componentIds:['data','app'],scenarioIds:['reload']}]},taskPlan:{schemaVersion:1,tasks:[{issue:5,owner:'author',componentIds:['data'],dependsOn:[],resources:[],inputs:['Reviewed data schema'],outputs:['Data component'],checkIds:['runtime'],stopConditions:['Unavailable real provider']},{issue:6,owner:'author',componentIds:['app'],dependsOn:[5],resources:[],inputs:['Accepted data component'],outputs:['App component'],checkIds:['runtime'],stopConditions:['Missing dependency']} ]}} as unknown as DeliveryRecordContent;
 return withSyntheticIntegration(data);
}
it('separates achievable local author checks from independent integration after merged prerequisites',()=>{
 const data=fixture();expect(taskPlanErrors(data)).toEqual([]);expect(data.taskPlan!.tasks[0].checkIds).toEqual(['local-5']);expect(data.taskPlan!.tasks[1].dependsOn).toEqual([5]);expect(data.taskPlan!.integrationQa![0].dependsOn).toEqual([5,6]);expect(data.taskPlan!.integrationQa![0].owner).toBe('qa');expect(taskPlanSchema.parse(data.taskPlan)).toEqual(data.taskPlan);
});
it.each(['downstream-component','unrelated-requirement','self-review','missing-qa','missing-dependency','duplicate-dependency','missing-case','unknown-check','duplicate-test','cycle'])('refuses %s in explicit v2 planning',mode=>{
 const data=fixture(),plan=data.taskPlan!,qa=plan.integrationQa![0];
 if(mode==='downstream-component')plan.tasks[0].checkIds=['runtime'];
 if(mode==='unrelated-requirement')data.applicationSpec!.checks.find(c=>c.id==='local-5')!.requirementIds.push('outside');
 if(mode==='self-review')qa.owner='author';if(mode==='missing-qa')plan.integrationQa=[];if(mode==='missing-dependency')qa.dependsOn=[5];if(mode==='duplicate-dependency')qa.dependsOn=[5,5,6];if(mode==='missing-case')qa.cases=[];if(mode==='unknown-check')qa.cases[0].checkId='unknown';if(mode==='duplicate-test')qa.cases.push({...qa.cases[0]});if(mode==='cycle')plan.tasks[0].dependsOn=[6];
 expect(taskPlanErrors(data).length).toBeGreaterThan(0);
});
it('keeps historical v1 plans readable but explicitly blocks new admission',()=>{const data=fixture();data.taskPlan!.schemaVersion=1;delete data.taskPlan!.integrationQa;const before=JSON.stringify(data);expect(taskPlanSchema.parse(data.taskPlan).schemaVersion).toBe(1);expect(taskPlanningBlockers({content:data,id:'synthetic',revision:1,sha256:'a'.repeat(64)}).join(' ')).toMatch(/version 2|version2|legacy|Migrate/i);expect(JSON.stringify(data)).toBe(before);});
it('preserves local author authority when independent integration criteria change',()=>{
 const data=fixture(),record={content:data},before=taskScopeHash(record,5);data.taskPlan!.integrationQa![0].cases[0].criterion+=' independently';expect(taskScopeHash(record,5)).toBe(before);
});
it.each([0,999,120001])('refuses unsafe integration duration %s',duration=>{const data=fixture();data.taskPlan!.integrationQa![0].maxTaskDurationMs=duration;expect(()=>taskPlanSchema.parse(data.taskPlan)).toThrow();});
function release(data:DeliveryRecordContent):ReleasePlan{const q=data.taskPlan!.integrationQa![0];return{qaOwner:'qa',deliveryRecord:{purpose:'slice'},requiredIssues:[...q.dependsOn],quality:{maxTaskDurationMs:10000},acceptanceCriteria:['Persists after reload'],verification:{scenarios:q.cases.map(row=>({name:row.testName,criterion:0}))},qualityEvidence:{checks:q.checkIds.map(checkId=>({checkId,...(q.cases.some(row=>row.checkId===checkId)?{cases:q.cases.filter(row=>row.checkId===checkId).map(({scenarioId,testName})=>({scenarioId,testName}))}:{})}))}} as unknown as ReleasePlan;}
it('binds independent integration to the existing delivery runner without dispatching',()=>{const data=fixture();expect(()=>assertTaskIntegrationPlan(data,release(data))).not.toThrow();});
it.each(['legacy','owner','phase','prerequisites','budget','missing-quality','checks','case','test','criterion'])('refuses release %s drift',mode=>{const data=fixture(),plan=release(data);if(mode==='legacy')data.taskPlan!.schemaVersion=1;if(mode==='owner')plan.qaOwner='author';if(mode==='phase')plan.deliveryRecord!.purpose='expansion';if(mode==='prerequisites')plan.requiredIssues=[5];if(mode==='budget')plan.quality.maxTaskDurationMs=30001;if(mode==='missing-quality')delete plan.qualityEvidence;if(mode==='checks')plan.qualityEvidence!.checks.pop();if(mode==='case')(plan.qualityEvidence!.checks.find(c=>'cases'in c) as any).cases[0].scenarioId='unrelated';if(mode==='test')plan.verification.scenarios[0].name='unrelated';if(mode==='criterion')plan.acceptanceCriteria[0]='Different outcome';expect(()=>assertTaskIntegrationPlan(data,plan)).toThrow();});
it('excludes expansion-only local checks from slice prerequisites while expansion includes every author',()=>{
 const data=fixture();data.tasks[1].stage='implementation';withSyntheticIntegration(data);const slice=data.taskPlan!.integrationQa!.find(q=>q.purpose==='slice')!,expansion=data.taskPlan!.integrationQa!.find(q=>q.purpose==='expansion')!;
 expect(slice.dependsOn).toEqual([5]);expect(slice.checkIds).toContain('local-5');expect(slice.checkIds).not.toContain('local-6');expect(expansion.dependsOn).toEqual([5,6]);expect(expansion.checkIds).toContain('local-6');expect(taskPlanErrors(data)).toEqual([]);
 slice.checkIds.push('local-6');expect(taskPlanErrors(data).join(' ')).toMatch(/scoped check|unrelated integration check/);
});
it('requires every scoped runtime/access check-scenario pair, not merely scenario coverage elsewhere',()=>{
 const data=fixture();data.applicationSpec!.checks.push({id:'access',kind:'access',componentIds:['app'],requirementIds:['r'],scenarioIds:['reload'],expectedEvidence:'Actual denied/allowed user evidence'});withSyntheticIntegration(data);expect(taskPlanErrors(data)).toEqual([]);
 data.taskPlan!.integrationQa![0].cases=data.taskPlan!.integrationQa![0].cases.filter(row=>row.checkId!=='access');expect(taskPlanErrors(data).join(' ')).toMatch(/access|scenario|binding/);
});
it('refuses a premature expansion integration contract when there are no expansion author tasks',()=>{const data=fixture();data.taskPlan!.integrationQa!.push({...structuredClone(data.taskPlan!.integrationQa![0]),id:'premature',purpose:'expansion'});expect(taskPlanErrors(data).length).toBeGreaterThan(0);});
it('requires a reviewed suite deadline and the exact opt-in functional rejection contract',()=>{
 const data=fixture(),q=data.taskPlan!.integrationQa![0],p=release(data),c=functionalFixture().config.rejection;
 q.maxVerificationDurationMs=1800000;p.quality.maxVerificationDurationMs=1800000;
 const row=q.cases[0];row.functionalAssertion=c.contract as any;
 (p.verification as any).functionalShowcase={rejection:{...c,testName:row.testName,scenarioId:row.scenarioId}};
 expect(()=>assertTaskIntegrationPlan(data,p)).not.toThrow();
 for(const mode of ['missing-suite','extended-suite','unreviewed-suite','changed-assertion','missing-assertion','missing-producer']){
  const d=structuredClone(data),r=structuredClone(p);
  if(mode==='missing-suite')delete r.quality.maxVerificationDurationMs;
  if(mode==='extended-suite')r.quality.maxVerificationDurationMs=1800001;
  if(mode==='unreviewed-suite')delete d.taskPlan!.integrationQa![0].maxVerificationDurationMs;
  if(mode==='changed-assertion')(r.verification.functionalShowcase!.rejection.contract as any).observationWindowMs=2000;
  if(mode==='missing-assertion')delete d.taskPlan!.integrationQa![0].cases[0].functionalAssertion;
  if(mode==='missing-producer')delete r.verification.functionalShowcase;
  expect(()=>assertTaskIntegrationPlan(d,r),mode).toThrow();
 }
});
