import {expect,it} from 'vitest';
import {assertFirstSlicePlan,assertFirstSliceComponents,firstSliceEvidence,firstSliceContractHash} from './firstSlice.ts';
import {firstSliceSchema} from '../shared/firstSlice.ts';
import {type ReleasePlan} from './releasePlan.ts';
import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
export function firstSliceFixture(){
  const record={requirements:[{id:'r1',acceptance:'Record survives reload'}],slice:{requirementIds:['r1'],acceptanceCriteria:['Record survives reload']},applicationSpec:{
    components:[{id:'app',platform:'canvas',requirementIds:['r1'],dependsOn:['data']},{id:'data',platform:'dataverse',requirementIds:['r1'],dependsOn:[]}],
    journeys:[{id:'submit',requirementIds:['r1'],scenarios:[{id:'happy',kind:'happy'},{id:'denied',kind:'denied'},{id:'failure',kind:'failure'}]}],
    checks:[{id:'runtime',kind:'runtime',requirementIds:['r1'],componentIds:['app'],scenarioIds:['happy','denied','failure']}],
  }} as DeliveryRecordContent;
  const plan={deliveryRecord:{id:'11111111-1111-4111-8111-111111111111',revision:1,sha256:'a'.repeat(64),purpose:'slice'},acceptanceCriteria:['Record survives reload'],
    firstSlice:{schemaVersion:1,components:[{componentId:'app',platform:'canvas',targetKey:'expense-app'},{componentId:'data',platform:'dataverse',targetKey:'expense-data'}],cases:['happy','denied','failure'].map(scenarioId=>({checkId:'runtime',scenarioId,testName:scenarioId}))},
    verification:{baseUrl:'https://apps.example.test',scenarios:['journey','authorization','error-handling'].map((category,i)=>({name:['happy','denied','failure'][i],category,criterion:0,identity:'employee'}))}} as ReleasePlan;
  return {record,plan};
}
const context={observedAfter:new Date(Date.now()-1000).toISOString(),runId:'run',releaseId:'release',planHash:'b'.repeat(64),sourceCommit:'c'.repeat(40),environmentUrl:'https://synthetic.crm.dynamics.com',packageSha256:'d'.repeat(64),startedAt:new Date(Date.now()-1000).toISOString()};
function report(plan:ReleasePlan){return {applicationUrl:plan.verification.baseUrl,completedAt:new Date().toISOString(),results:plan.verification.scenarios.flatMap(s=>[1440,390].map(width=>({...s,passed:true,viewport:{width,height:900}})))};}
it('binds all first-slice components, dependencies and happy/denied/failure scenarios to executable verification',()=>{
  const {record,plan}=firstSliceFixture();expect(()=>assertFirstSlicePlan(record,plan)).not.toThrow();expect(firstSliceSchema.safeParse(plan.firstSlice).success).toBe(true);
  const artifact=firstSliceEvidence(plan,context,report(plan));expect(artifact).toMatchObject({...context,contractHash:firstSliceContractHash(plan),cases:plan.firstSlice!.cases});
});
it('rejects incomplete, unrelated or misclassified scenario execution and unsupported component platforms',()=>{
  for(const mutate of [
    (p:ReleasePlan)=>{delete p.firstSlice;},
    (p:ReleasePlan)=>{p.firstSlice!.components.pop();},
    (p:ReleasePlan)=>{p.firstSlice!.components[0].platform='flow';},
    (p:ReleasePlan)=>{p.firstSlice!.cases.pop();},
    (p:ReleasePlan)=>{p.firstSlice!.cases[0].checkId='unrelated';},
    (p:ReleasePlan)=>{p.verification.scenarios[1].category='journey';},
    (p:ReleasePlan)=>{p.verification.scenarios[0].criterion=10;},
  ]){const {record,plan}=firstSliceFixture();mutate(plan);expect(()=>assertFirstSlicePlan(record,plan)).toThrow();}
  const {record,plan}=firstSliceFixture();record.applicationSpec!.journeys[0].scenarios.pop();expect(()=>assertFirstSlicePlan(record,plan)).toThrow('happy, denied and failure');
});
it('requires unique component/check mappings and distinct tests for distinct scenarios',()=>{
  const {plan}=firstSliceFixture();plan.firstSlice!.components.push({...plan.firstSlice!.components[0]});expect(firstSliceSchema.safeParse(plan.firstSlice).success).toBe(false);
  plan.firstSlice!.components.pop();plan.firstSlice!.cases[1].testName='happy';expect(firstSliceSchema.safeParse(plan.firstSlice).success).toBe(false);
});
it('matches component kinds to typed target operations and fails closed for unsupported adapters',()=>{
  const {plan}=firstSliceFixture();expect(()=>assertFirstSliceComponents(plan,{targetComponents:[{key:'expense-app',kind:'canvas'},{key:'expense-data',kind:'dataverse-table'}]})).not.toThrow();
  expect(()=>assertFirstSliceComponents(plan,{targetComponents:[]})).toThrow('typed target mapping');plan.firstSlice!.components[0].platform='model-driven';expect(()=>assertFirstSliceComponents(plan,{targetComponents:[]})).toThrow('supported');
});
it('holds API-only first slices until denied-action evidence can be independently executed',()=>{
  const {record,plan}=firstSliceFixture();plan.verification.api={checks:plan.verification.scenarios} as unknown as NonNullable<ReleasePlan['verification']['api']>;
  expect(()=>assertFirstSlicePlan(record,plan)).toThrow('denied-action adapter');record.applicationSpec!.components[0].platform='dataverse';plan.firstSlice!.components[0].platform='dataverse';expect(()=>assertFirstSlicePlan(record,plan)).toThrow('denied-action adapter');
});
it('rejects missing, failed, stale, wrong-target and wrong-category independent observations',()=>{
  const {plan}=firstSliceFixture();for(const mutate of [
    (r:ReturnType<typeof report>)=>{r.results.pop();},
    (r:ReturnType<typeof report>)=>{r.results[0].passed=false;},
    (r:ReturnType<typeof report>)=>{r.results[0].identity='other';},
    (r:ReturnType<typeof report>)=>{r.results[0].category='authorization';},
    (r:ReturnType<typeof report>)=>{r.completedAt='2000-01-01T00:00:00Z';},
    (r:ReturnType<typeof report>)=>{r.applicationUrl='https://other.example.test';},
  ]){const raw=report(plan);mutate(raw);expect(()=>firstSliceEvidence(plan,context,raw)).toThrow();}
  expect(()=>firstSliceEvidence(plan,context,{results:[]})).toThrow();
});
it('retains legacy release behavior without claiming first-slice verification',()=>{
  const {record,plan}=firstSliceFixture();delete record.applicationSpec;delete plan.firstSlice;expect(()=>assertFirstSlicePlan(record,plan)).not.toThrow();
  expect(()=>firstSliceEvidence(plan,context,{})).toThrow('contract missing');
});
