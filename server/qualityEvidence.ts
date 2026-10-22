import {headlessChecks,headlessCheckFiles} from './headlessFlowVerification.ts';
import {functionalRejectionEvidence} from './functionalRejection.ts';
import {functionalRecoveryEvidence} from './functionalRecovery.ts';
import crypto from 'node:crypto';
import {nativeDeniedEvidence} from './nativeDeniedAccess.ts';
import {assertTaskIntegrationPlan} from './taskIntegration.ts';
import {z} from 'zod';
import {HttpError} from './httpError.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {assertBrowserEvidence,assertFirstSliceComponents} from './firstSlice.ts';
import {qualityKinds,qualityDecisionSchema,type QualityContract} from '../shared/qualityEvidence.ts';
import type {ReleasePlan} from './releasePlan.ts';
import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
function fail(message:string):never{throw new HttpError(409,message);}
export const qualityHash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const qualityBytesHash=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
export const qualityContractHash=(plan:ReleasePlan)=>qualityHash({record:plan.deliveryRecord,contract:plan.qualityEvidence});
export function assertQualityPlan(content:DeliveryRecordContent,plan:ReleasePlan){
  if(!content.applicationSpec)return;
  assertTaskIntegrationPlan(content,plan);
  const q=plan.qualityEvidence;if(!q)fail('Application-spec releases require a QA and documentation evidence contract');
  if(plan.verification.api)fail('API quality acceptance requires an independent denied-action adapter');
  const spec=content.applicationSpec,requirements=plan.deliveryRecord?.purpose==='slice'?content.slice.requirementIds:content.requirements.map(r=>r.id);
  const relevant=(r:{requirementIds:string[]})=>r.requirementIds.some(id=>requirements.includes(id));
  const integration=content.taskPlan?.schemaVersion===2?content.taskPlan.integrationQa?.find(q=>q.purpose===plan.deliveryRecord?.purpose):undefined;
  const componentIds=new Set(integration?content.taskPlan!.tasks.filter(t=>integration.dependsOn.includes(t.issue)).flatMap(t=>t.componentIds):spec.components.filter(relevant).map(c=>c.id));
  const visit=(id:string)=>{for(const dep of spec.components.find(c=>c.id===id)?.dependsOn??[])if(!componentIds.has(dep)){componentIds.add(dep);visit(dep);}};for(const id of componentIds)visit(id);
  if(q.components.length!==componentIds.size||q.components.some(c=>!componentIds.has(c.componentId)||spec.components.find(s=>s.id===c.componentId)?.platform!==c.platform))fail('Quality evidence must cover the release components and transitive dependencies');
  if(plan.firstSlice&&JSON.stringify(q.components)!==JSON.stringify(plan.firstSlice.components))fail('Quality and first-slice target mappings must agree');
  const checks=spec.checks.filter(c=>integration?integration.checkIds.includes(c.id):relevant(c)||c.componentIds.some(id=>componentIds.has(id)));
  if(checks.length!==q.checks.length||q.checks.some(c=>!checks.some(s=>s.id===c.checkId&&s.kind===c.kind)))fail('Quality evidence must map every declared release check with its exact kind');
  for(const kind of qualityKinds){
    for(const requirement of requirements)if(!checks.some(c=>c.kind===kind&&c.requirementIds.includes(requirement)))fail(`${requirement}: missing ${kind} check`);
    for(const component of componentIds)if(!checks.some(c=>c.kind===kind&&c.componentIds.includes(component)))fail(`${component}: missing ${kind} check`);
  }
  const journeys=spec.journeys.filter(relevant),scenarios=journeys.flatMap(j=>j.scenarios);
  for(const journey of journeys)for(const kind of ['happy','denied','failure'])if(!journey.scenarios.some(s=>s.kind===kind))fail(`${journey.id}: quality acceptance requires happy, denied and failure scenarios`);
  const mappings=q.checks.flatMap(c=>'cases' in c?c.cases:[]);
  for(const scenario of scenarios)if(!mappings.some(c=>c.scenarioId===scenario.id))fail(`${scenario.id}: no executable quality test`);
  for(const row of q.checks){if(!('cases' in row))continue;
    const declared=checks.find(c=>c.id===row.checkId)!;
    if(declared.scenarioIds.filter(id=>content.taskPlan?.schemaVersion!==2||scenarios.some(s=>s.id===id)).some(id=>!row.cases.some(c=>c.scenarioId===id)))fail(`${row.checkId}: missing declared scenario binding`);
    for(const c of row.cases){const scenario=scenarios.find(s=>s.id===c.scenarioId),test=((plan.verification.headlessFlow?headlessChecks(plan.verification.headlessFlow):undefined)??plan.verification.scenarios).find(t=>t.name===c.testName);
      if(!scenario||!declared.scenarioIds.includes(c.scenarioId)||!test)fail(`${row.checkId}: unrelated scenario or executable test`);
      const category=scenario.kind==='denied'?'authorization':scenario.kind==='failure'?'error-handling':null;
      if(category?test.category!==category:!['journey','persistence'].includes(test.category))fail(`${row.checkId}: test category differs from declared scenario`);
      if(row.kind==='access'&&test.category!=='authorization')fail('Access evidence requires an authorization test');
      if(!content.requirements.some(r=>declared.requirementIds.includes(r.id)&&r.acceptance===plan.acceptanceCriteria[test.criterion])&&!(plan.deliveryRecord?.purpose==='slice'&&content.slice.acceptanceCriteria.includes(plan.acceptanceCriteria[test.criterion])))fail('Quality test acceptance criterion is unrelated to its requirement');
    }
  }
  for(const row of plan.firstSlice?.cases??[])if(!q.checks.some(c=>'cases' in c&&c.checkId===row.checkId&&c.cases.some(s=>s.scenarioId===row.scenarioId&&s.testName===row.testName)))fail('First-slice and quality scenario bindings must agree');
}
export type QualityManifest={documentation:string[];build:{executable:string;args:string[]}[];test:{executable:string;args:string[]}[];targetComponents:{key:string;kind:string}[];recovery?:{scope?:string};sharepoint?:{plan:{resources:{key:string}[]};bindings:{key:string;listId:string}[]}};
export function assertQualityManifest(plan:ReleasePlan,manifest:QualityManifest){
  const q=plan.qualityEvidence;if(!q)return;
  if(Boolean(plan.verification.functionalShowcase)!==(manifest.recovery?.scope==='functional-owned-request'))fail('Functional recovery manifest and acceptance scope differ');
  assertFirstSliceComponents({...plan,firstSlice:{schemaVersion:1,components:q.components,cases:[]}},manifest);
  for(const c of q.checks){if(c.kind==='compile'&&!manifest[c.phase][c.commandIndex])fail(`${c.checkId}: missing executable compile/test command`);if(c.kind==='documentation'&&!manifest.documentation.includes(c.document.file))fail(`${c.checkId}: document is not in the pinned manifest`);}
}
export function validateQualityDocument(document:Extract<QualityContract['checks'][number],{kind:'documentation'}>['document'],bytes:Buffer){
  if(!bytes.length||bytes.length>1024*1024)fail(`${document.file}: documentation must be nonempty and at most 1 MiB`);
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(`${document.file}: documentation must be UTF-8`);}
  const headings=text!.split(/\r?\n/).map(line=>line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1]?.toLowerCase());
  for(const section of document.sections)if(!headings.includes(section.toLowerCase()))fail(`${document.file}: missing required section ${section}`);
}
export const qualityDocumentFile=(checkId:string)=>`quality-document-${checkId}.md`;
export const qualityCommandFile=(phase:string,index:number)=>`quality-command-${phase}-${index}.json`;
export interface QualityContext {runId:string;releaseId:string;planHash:string;sourceCommit:string;environmentUrl:string;packageSha256:string;observedAfter:string;manifestSha256:string;buildAttempts:{id:string;startedAt:string}[];nativeStartedAt?:string;nativeClaimRoot?:string;nativeCaptureLeaseSha256?:string;functionalRecoveryCaptureRoot?:string}
export async function buildQualityIndex(plan:ReleasePlan,context:QualityContext,manifest:QualityManifest,read:(file:string)=>Promise<Buffer>){
  const q=plan.qualityEvidence;if(!q)fail('Quality evidence contract missing');
  assertQualityManifest(plan,manifest);
  const artifact=async(file:string)=>({file,sha256:qualityBytesHash(await read(file))});
  const scope=parseUnambiguousJson((await read('acceptance-scope.json')).toString('utf8')) as Record<string,unknown>;
  for(const key of ['releaseId','planHash','sourceCommit','environmentUrl','packageSha256'] as const)if(scope[key]!==context[key])fail('Quality package evidence differs from the deployed source/target/package');
  const functional=plan.verification.functionalShowcase,qaContext={runId:context.runId,releaseId:context.releaseId,planHash:context.planHash,recordSha256:plan.deliveryRecord?.sha256??'',sourceCommit:context.sourceCommit,environmentUrl:context.environmentUrl,startedAt:context.nativeStartedAt??context.observedAfter};
  let recoveryFiles=['recovery-rehearsal.json','recovery-runbook.md','previous-inventory.json'],functionalNativeFiles:string[]=[];
  if(functional){if(plan.acceptanceProfile!=='functional-development'||!context.nativeClaimRoot||!context.nativeCaptureLeaseSha256||!context.functionalRecoveryCaptureRoot)fail('Functional producer capture provenance missing');recoveryFiles=await functionalRecoveryEvidence(functional,qaContext,qualityBytesHash(await read('recovery-runbook.md')),read,context.functionalRecoveryCaptureRoot,context.nativeCaptureLeaseSha256);functionalNativeFiles=await functionalRejectionEvidence(functional.rejection,qaContext,read,context.nativeClaimRoot,context.nativeCaptureLeaseSha256);}
  else{const recovery=parseUnambiguousJson((await read('recovery-rehearsal.json')).toString('utf8')) as Record<string,unknown>;if(recovery.sourceCommit!==context.sourceCommit||recovery.restored!==true||recovery.dataPreserved!==true||recovery.procedureSha256!==qualityBytesHash(await read('recovery-runbook.md')))fail('Quality recovery evidence differs from the approved source/runbook');}
  const raw=parseUnambiguousJson((await read('independent-verification.json')).toString('utf8'));
  const nativeFiles=await nativeDeniedEvidence(plan,{runId:context.runId,releaseId:context.releaseId,planHash:context.planHash,recordSha256:plan.deliveryRecord?.sha256??'',sourceCommit:context.sourceCommit,environmentUrl:context.environmentUrl,startedAt:context.nativeStartedAt??context.observedAfter},read,context.nativeClaimRoot,context.nativeCaptureLeaseSha256);
  const rows=[];
  for(const check of q.checks){let files:string[]=[];
    if(check.kind==='compile'){
      const file=qualityCommandFile(check.phase,check.commandIndex),receipt=z.strictObject({schemaVersion:z.literal(1),originAttemptId:z.uuid(),runId:z.string(),releaseId:z.string(),sourceCommit:z.string(),manifestSha256:z.string(),phase:z.enum(['build','test']),index:z.number().int(),commandSha256:z.string(),outcome:z.literal('returned-success'),finishedAt:z.iso.datetime(),outputFile:z.string(),outputSha256:z.string()}).parse(parseUnambiguousJson((await read(file)).toString('utf8')));
      if(receipt.runId!==context.runId||receipt.releaseId!==context.releaseId||receipt.sourceCommit!==context.sourceCommit||receipt.manifestSha256!==context.manifestSha256||receipt.phase!==check.phase||receipt.index!==check.commandIndex||receipt.commandSha256!==qualityHash(manifest[check.phase][check.commandIndex])||receipt.outputFile!==`quality-command-${check.phase}-${check.commandIndex}-output.json`||qualityBytesHash(await read(receipt.outputFile))!==receipt.outputSha256)fail(`${check.checkId}: compile receipt differs from the executed pinned command`);
      const origin=context.buildAttempts.find(a=>a.id===receipt.originAttemptId);
      if(!origin||Date.parse(receipt.finishedAt)<Date.parse(origin.startedAt)||Date.parse(receipt.finishedAt)>Date.parse(context.observedAfter)||Date.parse(receipt.finishedAt)>Date.now()+60000)fail(`${check.checkId}: command receipt lacks a valid originating attempt or execution time`);
      files=[file,receipt.outputFile];
    }else if(check.kind==='package')files=['solution-inventory.json','acceptance-scope.json'];
    else if(check.kind==='recovery')files=recoveryFiles;
    else if(check.kind==='documentation'){const file=qualityDocumentFile(check.checkId);validateQualityDocument(check.document,await read(file));files=[file];}
    else{assertBrowserEvidence(plan,check.cases,context.observedAfter,raw);files=['independent-verification.json',...nativeFiles,...functionalNativeFiles,...(functional?recoveryFiles:[]),...(plan.verification.headlessFlow?check.cases.flatMap(c=>{return headlessCheckFiles(plan.verification.headlessFlow!,c.testName);}):[])];}
    const row={checkId:check.checkId,kind:check.kind,binding:check,artifacts:await Promise.all(files.map(artifact))};rows.push({...row,evidenceSha256:qualityHash(row)});
  }
  const {buildAttempts:_attempts,nativeStartedAt:_nativeStartedAt,nativeClaimRoot:_nativeClaimRoot,nativeCaptureLeaseSha256:_nativeCaptureLeaseSha256,functionalRecoveryCaptureRoot:_functionalRecoveryCaptureRoot,...identity}=context;
  return {schemaVersion:1,contractHash:qualityContractHash(plan),...identity,record:plan.deliveryRecord,components:q.components,checks:rows,limitations:['Command return status and structural document coverage require independent semantic review. Browser identities alone do not establish least-privilege permissions.']};
}
export function assertQualityDecisions(checks:{checkId:string;evidenceSha256:string}[],input:unknown){
  const parsed=z.array(qualityDecisionSchema).min(9).max(200).safeParse(input);if(!parsed.success)fail('Independent per-check quality decisions are required');
  const decisions=parsed.data;
  if(decisions.length!==checks.length||new Set(decisions.map(c=>c.checkId)).size!==decisions.length||decisions.some(d=>d.decision!=='approved'||!checks.some(c=>c.checkId===d.checkId&&c.evidenceSha256===d.evidenceSha256)))fail('Every exact quality check must be independently approved; missing, rejected, duplicate or stale decisions block completion');
  return decisions;
}
