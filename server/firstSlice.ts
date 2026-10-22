import {HttpError} from './httpError.ts';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import type {ReleasePlan} from './releasePlan.ts';
import {assertHeadlessEvidence} from './headlessFlowVerification.ts';
export const firstSliceContractHash=(plan:ReleasePlan)=>crypto.createHash('sha256').update(JSON.stringify({record:plan.deliveryRecord,execution:plan.firstSlice})).digest('hex');
export function assertFirstSlicePlan(content:DeliveryRecordContent,plan:ReleasePlan){
  if(plan.deliveryRecord?.purpose!=='slice')return;
  const spec=content.applicationSpec;if(!spec)return;
  const execution=plan.firstSlice;if(!execution)throw new HttpError(409,'First-slice execution mapping is required for an application specification');
  if(plan.verification.api)throw new HttpError(409,'API-only first slices are blocked: a runner-owned denied-action adapter is required; backend functional checks cannot certify a denied user scenario');
  const relevant=(row:{requirementIds:string[]})=>row.requirementIds.some(id=>content.slice.requirementIds.includes(id));
  const components=new Set(spec.components.filter(relevant).map(c=>c.id));
  const visit=(id:string)=>{for(const dep of spec.components.find(c=>c.id===id)?.dependsOn??[])if(!components.has(dep)){components.add(dep);visit(dep);}};for(const id of components)visit(id);
  if(execution.components.length!==components.size||execution.components.some(c=>!components.has(c.componentId)||c.platform!==spec.components.find(s=>s.id===c.componentId)?.platform))throw new HttpError(409,'First-slice mapping must cover exactly its components and transitive dependencies');
  // Target IDs are unavailable in the application specification; the actual
  // manifest is checked separately at release preparation and execution.
  const supported=new Set(['dataverse','sharepoint','canvas','flow','copilot-studio']);
  if(execution.components.some(c=>!supported.has(c.platform)))throw new HttpError(409,'First-slice component has no supported typed target mapping');
  const tests=plan.verification.headlessFlow?.checks??plan.verification.scenarios;
  const journeys=spec.journeys.filter(relevant),scenarios=journeys.flatMap(j=>j.scenarios);
  for(const journey of journeys)for(const kind of ['happy','denied','failure'])if(!journey.scenarios.some(s=>s.kind===kind))throw new HttpError(409,`First journey ${journey.id} requires happy, denied and failure scenarios`);
  const checks=spec.checks.filter(c=>relevant(c)&&['runtime','access'].includes(c.kind));
  for(const id of content.slice.requirementIds)if(!checks.some(c=>c.requirementIds.includes(id)))throw new HttpError(409,`First-slice requirement ${id} needs an executable runtime/access check`);
  for(const s of scenarios)if(!execution.cases.some(c=>c.scenarioId===s.id))throw new HttpError(409,`First-slice scenario ${s.id} has no executable test`);
  for(const c of checks)if(!execution.cases.some(row=>row.checkId===c.id))throw new HttpError(409,`First-slice check ${c.id} is unmapped`);
  for(const row of execution.cases){
    const scenario=scenarios.find(s=>s.id===row.scenarioId),check=checks.find(c=>c.id===row.checkId),test=tests.find(t=>t.name===row.testName);
    if(!scenario||!check||!check.scenarioIds.includes(row.scenarioId)||!test)throw new HttpError(409,'First-slice case has unrelated check, scenario or executable test');
    const criterion=plan.acceptanceCriteria[test.criterion];
    if(!content.requirements.some(r=>check.requirementIds.includes(r.id)&&r.acceptance===criterion)&&!content.slice.acceptanceCriteria.includes(criterion))throw new HttpError(409,'First-slice test does not verify its declared acceptance criterion');
    const expected=scenario.kind==='denied'?'authorization':scenario.kind==='failure'?'error-handling':null;
    if(expected?test.category!==expected:!['journey','persistence'].includes(test.category))throw new HttpError(409,'First-slice scenario kind differs from its executable test category');
  }

}
export function assertFirstSliceComponents(plan:ReleasePlan,manifest:{targetComponents:{key:string;kind:string}[];sharepoint?:{plan:{resources:{key:string}[]};bindings:{key:string;listId:string}[]}}){
  if(plan.firstSlice&&plan.verification.api)throw new HttpError(409,'API-only first slices require a runner-owned denied-action adapter');
  for(const row of plan.firstSlice?.components??[]){const platform=row.platform,expected:Record<string,string>={dataverse:'dataverse-table',canvas:'canvas',flow:'cloud-flow','copilot-studio':'copilot'};
    if(platform==='sharepoint'){if(!manifest.sharepoint?.plan.resources.some(r=>r.key===row.targetKey)||manifest.sharepoint.bindings.filter(b=>b.key===row.targetKey).length!==1)throw new HttpError(409,`First-slice component ${row.componentId} has no exact external SharePoint mapping`);continue;}
    if(!expected[platform]||!manifest.targetComponents.some(c=>c.key===row.targetKey&&c.kind===expected[platform]))throw new HttpError(409,`First-slice component ${row.componentId} has no supported typed target mapping`);
  }
}
const observed=z.object({name:z.string(),criterion:z.number().int(),category:z.string(),passed:z.literal(true),identity:z.string().optional(),viewport:z.object({width:z.number(),height:z.number()}).optional()});
export function firstSliceEvidence(plan:ReleasePlan,context:{runId:string;releaseId:string;planHash:string;sourceCommit:string;environmentUrl:string;packageSha256:string;startedAt:string;observedAfter:string},raw:unknown){
  if(!plan.firstSlice)throw new HttpError(409,'First-slice execution contract missing');
  if(plan.verification.api)throw new HttpError(409,'API-only first slices require a runner-owned denied-action adapter');
  assertBrowserEvidence(plan,plan.firstSlice.cases,context.observedAfter,raw);
  return {schemaVersion:1,contractHash:firstSliceContractHash(plan),...context,deliveryRecord:plan.deliveryRecord,components:plan.firstSlice.components,cases:plan.firstSlice.cases,method:plan.verification.headlessFlow?'power-automate-headless':'browser',limitations:[plan.verification.headlessFlow?'Single-owner flow guards do not certify multi-user isolation or UI.':'Browser identity checks alone do not establish least-privilege permissions.']};
}

export function assertBrowserEvidence(plan:ReleasePlan,cases:{testName:string}[],observedAfter:string,raw:unknown){
  if(plan.verification.headlessFlow){assertHeadlessEvidence(plan.verification.headlessFlow,cases,plan.verification.baseUrl,observedAfter,raw);return;}
  if(plan.verification.api)throw new HttpError(409,'Independent denied-action API adapter is unavailable');
  const parsed=z.object({results:z.array(observed).min(1),applicationUrl:z.string(),completedAt:z.iso.datetime()}).safeParse(raw);
  if(!parsed.success)throw new HttpError(409,'First-slice independent execution evidence is malformed or failed');
  const report=parsed.data;
  const when=report.completedAt;
  if(!when||!Number.isFinite(Date.parse(when))||Date.parse(when)<Date.parse(observedAfter)||Date.parse(when)>Date.now()+60000)throw new HttpError(409,'First-slice independent evidence is stale or has no completion time');
  if(report.applicationUrl!==plan.verification.baseUrl)throw new HttpError(409,'First-slice independent evidence targets a different application or environment');
  const tests=plan.verification.scenarios;
  for(const row of cases){const test=tests.find(t=>t.name===row.testName);if(!test)throw new HttpError(409,'Mapped executable test missing');
    const results=report.results.filter(r=>r.name===row.testName&&r.category===test.category&&r.criterion===test.criterion);
    if(![1440,390].every(width=>results.some(r=>r.viewport?.width===width&&r.identity===test.identity)))throw new HttpError(409,`First-slice test ${row.testName} lacks matching independent execution evidence`);
  }
}
