import {expect,it} from 'vitest';
import {qualityContract,qualityDocument} from './testFixtures/quality.ts';
import {assertQualityPlan,assertQualityManifest,validateQualityDocument,buildQualityIndex,qualityHash,qualityBytesHash,assertQualityDecisions,type QualityContext} from './qualityEvidence.ts';
import {qualityContractSchema} from '../shared/qualityEvidence.ts';
import type {DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import type {ReleasePlan} from './releasePlan.ts';
function fixture(){
  const q=qualityContract(),plan={qualityEvidence:q,deliveryRecord:{id:'record',revision:1,sha256:'a'.repeat(64),purpose:'slice'},acceptanceCriteria:['Value survives reload'],verification:{baseUrl:'https://app.example.test',scenarios:['journey','authorization','error-handling'].map((category,i)=>({name:['journey 0','authorization 1','error-handling 3'][i],category,criterion:0,identity:i===1?'manager':'employee'}))}} as ReleasePlan;
  const record={requirements:[{id:'r1',acceptance:'Value survives reload'}],slice:{requirementIds:['r1'],acceptanceCriteria:['Value survives reload']},applicationSpec:{components:[{id:'data',platform:'dataverse',requirementIds:['r1'],dependsOn:[]}],journeys:[{id:'journey',requirementIds:['r1'],scenarios:['happy','denied','failure'].map(id=>({id,kind:id}))}],checks:q.checks.map(c=>({id:c.checkId,kind:c.kind,requirementIds:['r1'],componentIds:['data'],scenarioIds:'cases' in c?c.cases.map(s=>s.scenarioId):[],expectedEvidence:'Actual independent evidence'}))}} as unknown as DeliveryRecordContent;
  const manifest={documentation:['user.md','administrator.md','operations.md','architecture.md'],build:[{executable:'compile',args:[]}],test:[{executable:'test',args:['--strict']}],targetComponents:[{key:'expenses',kind:'dataverse-table'}]};
  const context:QualityContext={runId:'run',releaseId:'release',planHash:'b'.repeat(64),sourceCommit:'c'.repeat(40),environmentUrl:'https://target.crm.dynamics.com',packageSha256:'d'.repeat(64),manifestSha256:'e'.repeat(64),observedAfter:new Date().toISOString(),buildAttempts:[{id:'11111111-1111-4111-8111-111111111111',startedAt:'2026-01-01T00:00:00Z'}]};
  const receipt={schemaVersion:1,originAttemptId:context.buildAttempts[0].id,runId:context.runId,releaseId:context.releaseId,sourceCommit:context.sourceCommit,manifestSha256:context.manifestSha256,phase:'test',index:0,commandSha256:qualityHash(manifest.test[0]),outcome:'returned-success',finishedAt:context.observedAfter,outputFile:'quality-command-test-0-output.json',outputSha256:qualityBytesHash(Buffer.from('{"stdout":"Compiler and tests passed"}'))};
  const files=new Map<string,Buffer>();const put=(name:string,value:unknown)=>files.set(name,Buffer.from(JSON.stringify(value)));
  put('quality-command-test-0.json',receipt);put('quality-command-test-0-output.json',{stdout:'Compiler and tests passed'});
  put('acceptance-scope.json',context);put('solution-inventory.json',{solution:'Synthetic'});put('previous-inventory.json',[]);
  const runbook=Buffer.from(qualityDocument('operations'));files.set('recovery-runbook.md',runbook);put('recovery-rehearsal.json',{sourceCommit:context.sourceCommit,restored:true,dataPreserved:true,procedureSha256:qualityBytesHash(runbook)});
  put('independent-verification.json',{applicationUrl:plan.verification.baseUrl,completedAt:context.observedAfter,results:plan.verification.scenarios.flatMap(s=>[1440,390].map(width=>({...s,passed:true,viewport:{width,height:900}})))});
  for(const c of q.checks)if(c.kind==='documentation')files.set(`quality-document-${c.checkId}.md`,Buffer.from(qualityDocument(c.document.role)));
  const read=async(file:string)=>{const bytes=files.get(file);if(!bytes)throw new Error(`Missing evidence ${file}`);return bytes;};
  return {q,plan,record,manifest,context,files,read,put,receipt};
}
it('requires complete declared check coverage with exact kinds, related executable scenarios and handover roles',()=>{
  const {q,plan,record,manifest}=fixture();expect(qualityContractSchema.safeParse(q).success).toBe(true);expect(()=>assertQualityPlan(record,plan)).not.toThrow();expect(()=>assertQualityManifest(plan,manifest)).not.toThrow();
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{delete f.plan.qualityEvidence;},
    (f:ReturnType<typeof fixture>)=>{f.q.checks[0].checkId='undeclared';},
    (f:ReturnType<typeof fixture>)=>{f.record.applicationSpec!.checks[0].kind='package';},
    (f:ReturnType<typeof fixture>)=>{f.record.applicationSpec!.checks[0].requirementIds=['other'];},
    (f:ReturnType<typeof fixture>)=>{f.q.components[0].platform='canvas';},
    (f:ReturnType<typeof fixture>)=>{const c=f.q.checks.find(c=>c.kind==='access')!;if(c.kind==='access')c.cases[0].testName='journey 0';},
  ]){const f=fixture();mutate(f);expect(()=>assertQualityPlan(f.record,f.plan)).toThrow();}
});
it('bounds slice evidence to selected requirements and requires full expansion coverage',()=>{
  const f=fixture();f.record.requirements.push({id:'r2',description:'Another feature',acceptance:'Another outcome'});f.record.applicationSpec!.components.push({id:'other',owner:'dev',platform:'canvas',dependsOn:[],requirementIds:['r2'],contractIds:[],findingIds:[]});
  expect(()=>assertQualityPlan(f.record,f.plan)).not.toThrow();f.plan.deliveryRecord!.purpose='expansion';expect(()=>assertQualityPlan(f.record,f.plan)).toThrow('components');
});
it('rejects duplicate IDs, missing roles, unsafe documentation paths and API-only quality claims',()=>{
  const f=fixture();const docs=f.q.checks.filter(c=>c.kind==='documentation');docs[0].document.file='../outside.md';expect(qualityContractSchema.safeParse(f.q).success).toBe(false);
  const duplicate=fixture();duplicate.q.checks[1].checkId=duplicate.q.checks[0].checkId;expect(qualityContractSchema.safeParse(duplicate.q).success).toBe(false);
  const missing=fixture();missing.q.checks.pop();expect(qualityContractSchema.safeParse(missing.q).success).toBe(false);
  const api=fixture();api.plan.verification.api={} as NonNullable<ReleasePlan['verification']['api']>;expect(()=>assertQualityPlan(api.record,api.plan)).toThrow('denied-action');
});
it('requires actual pinned documents with headings and executable compile commands from the manifest',()=>{
  const f=fixture(),document=f.q.checks.find(c=>c.kind==='documentation')!;if(document.kind!=='documentation')throw new Error('fixture');
  expect(()=>validateQualityDocument(document.document,Buffer.from(qualityDocument('user')))).not.toThrow();
  for(const bytes of [Buffer.from('present but incomplete'),Buffer.alloc(0),Buffer.alloc(1024*1024+1),Buffer.from([0xff])])expect(()=>validateQualityDocument(document.document,bytes)).toThrow();
  f.manifest.test=[];expect(()=>assertQualityManifest(f.plan,f.manifest)).toThrow('command');f.manifest.test=[{executable:'test',args:[]}];f.manifest.documentation=[];expect(()=>assertQualityManifest(f.plan,f.manifest)).toThrow('pinned manifest');
});
it('indexes executed command receipts, bound package/recovery evidence and retained document bytes',async()=>{
  const f=fixture(),index=await buildQualityIndex(f.plan,f.context,f.manifest,f.read);expect(index.checks).toHaveLength(9);expect(index).toMatchObject({runId:'run',sourceCommit:f.context.sourceCommit,packageSha256:f.context.packageSha256});
  const decisions=index.checks.map(c=>({checkId:c.checkId,evidenceSha256:c.evidenceSha256,decision:'approved',notes:'Independent synthetic assessment of actual content, coverage and remaining limits.'}));expect(assertQualityDecisions(index.checks,decisions)).toHaveLength(9);
  for(const changed of [decisions.slice(1),[...decisions.slice(1),decisions[1]],decisions.map((d,i)=>i===0?{...d,decision:'rejected'}:d),decisions.map((d,i)=>i===0?{...d,evidenceSha256:'f'.repeat(64)}:d)])expect(()=>assertQualityDecisions(index.checks,changed)).toThrow();
});
it('revalidates identical legacy evidence with private functional capture storage configured',async()=>{
 const f=fixture(),initial=await buildQualityIndex(f.plan,f.context,f.manifest,f.read);
 const reopened=await buildQualityIndex(f.plan,{...f.context,functionalRecoveryCaptureRoot:'C:/private/runner/functional-recovery-captures'},f.manifest,f.read);
 expect(reopened).toEqual(initial);expect(JSON.stringify(reopened)).not.toContain('C:/private');
});
it.each(['head','origin','time','output','package','recovery','missing'] as const)('rejects stale/mismatched %s evidence instead of issuing a quality index',async mode=>{
  const f=fixture();if(mode==='head')f.receipt.sourceCommit='f'.repeat(40);if(mode==='origin')f.receipt.originAttemptId='22222222-2222-4222-8222-222222222222';if(mode==='time')f.receipt.finishedAt='2099-01-01T00:00:00Z';if(mode==='output')f.receipt.outputSha256='f'.repeat(64);f.put('quality-command-test-0.json',f.receipt);
  if(mode==='package')f.put('acceptance-scope.json',{...f.context,packageSha256:'f'.repeat(64)});if(mode==='recovery')f.put('recovery-rehearsal.json',{sourceCommit:'f'.repeat(40)});if(mode==='missing')f.files.delete('quality-document-doc-user.md');
  await expect(buildQualityIndex(f.plan,f.context,f.manifest,f.read)).rejects.toThrow();
});

it('does not invent a quality contract for a legacy record without an application specification',()=>{const f=fixture();delete f.record.applicationSpec;expect(()=>assertQualityPlan(f.record,f.plan)).not.toThrow();delete f.plan.qualityEvidence;expect(()=>assertQualityManifest(f.plan,f.manifest)).not.toThrow();});
it.each(['dependency','first-slice-components','component-check','journey-kind','scenario-mapping','declared-scenario','unrelated-scenario','unrelated-test','access-category','criterion','first-slice-case'] as const)('refuses incomplete quality contract %s',fault=>{const f=fixture(),spec=f.record.applicationSpec!,runtime=f.q.checks.find(c=>c.kind==='runtime')! as any;if(fault==='dependency')spec.components[0].dependsOn=['missing'];if(fault==='first-slice-components')f.plan.firstSlice={components:[]} as any;if(fault==='component-check')spec.checks[0].componentIds=[];if(fault==='journey-kind')spec.journeys[0].scenarios.pop();if(fault==='scenario-mapping')spec.journeys[0].scenarios.push({id:'unmapped',kind:'happy'} as any);if(fault==='declared-scenario')spec.checks.find(c=>c.id==='runtime')!.scenarioIds.push('undeclared');if(fault==='unrelated-scenario')runtime.cases.push({scenarioId:'other',testName:'journey 0'});if(fault==='unrelated-test')runtime.cases[0].testName='missing';if(fault==='access-category'){const access=f.q.checks.find(c=>c.kind==='access')! as any;access.cases=[{scenarioId:'happy',testName:'journey 0'}];spec.checks.find(c=>c.id==='access')!.scenarioIds=['happy'];}if(fault==='criterion'){f.plan.acceptanceCriteria=['Unrelated outcome'];}if(fault==='first-slice-case')f.plan.firstSlice={components:f.q.components,cases:[{checkId:'runtime',scenarioId:'happy',testName:'unrelated'}]} as any;expect(()=>assertQualityPlan(f.record,f.plan)).toThrow();});
it('allows separately approved slice acceptance wording while retaining requirement linkage',()=>{const f=fixture();f.plan.acceptanceCriteria=['Slice-specific measured outcome'];f.record.slice.acceptanceCriteria=['Slice-specific measured outcome'];expect(()=>assertQualityPlan(f.record,f.plan)).not.toThrow();f.plan.deliveryRecord!.purpose='expansion';expect(()=>assertQualityPlan(f.record,f.plan)).toThrow('unrelated');});
it.each([true,false])('requires recovery manifest scope to agree with functional acceptance=%s',functional=>{const f=fixture();if(functional)f.plan.verification.functionalShowcase={} as any;else(f.manifest as any).recovery={scope:'functional-owned-request'};expect(()=>assertQualityManifest(f.plan,f.manifest)).toThrow('scope differ');});
it('does not index evidence without a quality contract',async()=>{const f=fixture();delete f.plan.qualityEvidence;await expect(buildQualityIndex(f.plan,f.context,f.manifest,f.read)).rejects.toThrow('contract missing');});
it.each(['profile','claim-root','capture-lease','recovery-root'] as const)('requires functional producer provenance for %s',async fault=>{const f=fixture();(f.manifest as any).recovery={scope:'functional-owned-request'};f.plan.verification.functionalShowcase={} as any;f.plan.acceptanceProfile='functional-development';Object.assign(f.context,{nativeClaimRoot:'synthetic-private-claims',nativeCaptureLeaseSha256:'f'.repeat(64),functionalRecoveryCaptureRoot:'synthetic-private-captures'});if(fault==='profile')f.plan.acceptanceProfile='production';if(fault==='claim-root')delete f.context.nativeClaimRoot;if(fault==='capture-lease')delete f.context.nativeCaptureLeaseSha256;if(fault==='recovery-root')delete f.context.functionalRecoveryCaptureRoot;await expect(buildQualityIndex(f.plan,f.context,f.manifest,f.read)).rejects.toThrow('producer capture provenance');});

it('verifies preparation-only quality scenarios without claiming the real Inbox journey',()=>{
 const {record,plan,q}=fixture();record.owner='author';record.qaOwner='qa';record.applicationSpec!.components[0].platform='flow';q.components[0].platform='flow';
 const real=JSON.stringify(record.applicationSpec!.journeys),criterion='Synthetic samples follow the same rule and failure guards';
 const scenarios=['happy','denied','failure'].map(kind=>({id:'prep-'+kind,kind:kind as 'happy'|'denied'|'failure',given:'Synthetic sample data only',when:'The sample path runs without mailbox reads',then:'The exact synthetic result occurs'}));
 for(const check of q.checks)if('cases'in check)for(const c of check.cases)if(!c.scenarioId.startsWith('prep-'))c.scenarioId='prep-'+c.scenarioId;
 const cases=q.checks.flatMap(c=>'cases'in c?c.cases.map(row=>({...row,checkId:c.checkId,criterion})):[]);
 record.taskPlan={schemaVersion:2,tasks:[{issue:5,owner:'author',componentIds:['data'],dependsOn:[],resources:[],inputs:['Reviewed package'],outputs:['Stopped flow'],checkIds:['compile'],stopConditions:['No private execution']}],integrationQa:[{id:'prep',owner:'qa',purpose:'preparation',runner:'delivery',requirementIds:['r1'],preparation:{acceptanceCriteria:[criterion],scenarios},dependsOn:[5],checkIds:q.checks.map(c=>c.checkId),cases,maxTaskDurationMs:30000,stopConditions:['Synthetic only']}]};
 plan.qaOwner='qa';plan.requiredIssues=[5];plan.quality={maxTaskDurationMs:30000,maxSeriousAccessibilityIssues:0};plan.deliveryRecord!.purpose='preparation';plan.acceptanceCriteria=[criterion];plan.verification.headlessFlow={checks:plan.verification.scenarios.map(c=>({...c})),postDispatchChecks:[]} as any;plan.verification.scenarios=[];
 expect(()=>assertQualityPlan(record,plan)).not.toThrow();expect(JSON.stringify(record.applicationSpec!.journeys)).toBe(real);
 plan.acceptanceCriteria=['Value survives reload'];expect(()=>assertQualityPlan(record,plan)).toThrow(/criterion/);
 plan.acceptanceCriteria=[criterion];delete record.taskPlan.integrationQa![0].preparation;expect(()=>assertQualityPlan(record,plan)).toThrow(/preparation/);
});
