import {withSyntheticIntegration} from './testFixtures/taskIntegration.ts';
import {qualityContract} from './testFixtures/quality.ts';
import {qualityContractHash} from './qualityEvidence.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {firstSliceContractHash} from './firstSlice.ts';
import {taskScopeHash,taskAuthorityHash,workerTaskFingerprint} from './taskScope.ts';
import {deliveryRecordContentSchema} from '../shared/deliveryRecord.ts';
import {DeliveryRecords} from './deliveryRecords.ts';
import {deliveryRecordHandler} from './deliveryRecordTools.ts';
import {discoveryAreas,recordReference,discoveryBlockers,type DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import type {DeliveryRelease,DeliveryRun} from '../shared/delivery.ts';
import {generateHldContent} from '../shared/hld.ts';
import {saveHldArtifact} from './hldArtifacts.ts';
import {inspectRepository} from './repositoryDiscovery.ts';
import {HttpError} from './httpError.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {synthesisRequirements,requireSynthesisTraceability} from './synthesisTraceability.ts';
import {HldSynthesisService} from './hldSynthesis.ts';
import type {SessionOptions,SessionCallbacks} from './agentRunner.ts';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
const context={brief:'Allow an employee to submit a valid expense',environmentUrl:'https://example.crm.dynamics.com'};
const hash='a'.repeat(64),head='b'.repeat(40),docId='HLD-11111111-1111-4111-8111-111111111111';
function content():DeliveryRecordContent {
  return {brief:context.brief,outcome:'An employee can submit an expense',successMeasure:'A valid submission persists after reload and an unauthorised user cannot read it',users:['Employee','Approver'],scope:['Expense submission'],exclusions:['Payroll'],owner:'dev',qaOwner:'qa',sourceCommit:head,environmentUrl:context.environmentUrl,
    requirements:[{id:'r1',description:'Persist submitted expenses',acceptance:'Submission survives reload'}],
    findings:discoveryAreas.map(area=>({id:area,area,status:'observed',conclusion:'ready',critical:true,owner:'dev',statement:`Synthetic ${area} observation`,remedy:'Refresh and independently inspect before delivery',evidence:[{reference:`fixtures/${area}.json`,sha256:hash,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()}]})),
    contracts:[{id:'expense',owner:'dev',description:'Submission contract includes a unique revision',requirementIds:['r1']}],
    tasks:[{issue:1,stage:'discovery',requirementIds:['r1']},{issue:2,stage:'design',requirementIds:['r1']},{issue:3,stage:'slice',requirementIds:['r1']},{issue:4,stage:'implementation',requirementIds:['r1']}],
    slice:{description:'Submit one expense using the intended employee role',requirementIds:['r1'],acceptanceCriteria:['Submission survives reload']}};
}
async function fixture(input=content()) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-record-test-'));roots.push(root);
  const records=new DeliveryRecords(root);await records.init();const record=await records.save('test/repo',0,input,'ceo');return {root,records,record};
}
it('keeps a read-only design session usable after persisting its own finding, without granting authoring',async()=>{
  const {records,record,root}=await fixture();
  const admitted=workerTaskFingerprint(record,2);
  const assertOpen=()=>{if(workerTaskFingerprint(records.current('test/repo')!,2)!==admitted)throw new Error('Task instructions changed');};
  const worker=deliveryRecordHandler(records,{repo:()=>({...context,checkoutPath:root}),agents:()=>[],delivery:()=>({}) as never,assertOpen},{id:'dev',role:'dev',repoId:'test/repo'});
  await worker({repo_id:'test/repo',action:'finding',expected_revision:1,payload_json:JSON.stringify({finding:{id:'design-observation',area:'integrations',status:'assumed',conclusion:'unknown',critical:false,owner:'dev',statement:'A proposed recovery path still needs actual native contracts.',remedy:'Independent review and native verification before authoring.',evidence:[]}})});
  const read=JSON.parse(await worker({repo_id:'test/repo',action:'read'}));
  expect(read.record.revision).toBe(2);
  expect(read.record.content.findings.some((f:{id:string})=>f.id==='design-observation')).toBe(true);
  expect(read.record.designReview).toBeUndefined();
  expect(()=>records.assertWork('test/repo',3,context)).toThrow();
  expect(workerTaskFingerprint(read.record,3)).not.toBe(workerTaskFingerprint(record,3));
});
it.each(['target','instructions','source','stage','owner'] as const)('revokes a design session when its %s changes',async change=>{
  const {records,record}=await fixture(),admitted=workerTaskFingerprint(record,2),next=structuredClone(record.content);
  if(change==='target')next.environmentUrl='https://other.crm.dynamics.com';
  if(change==='instructions')next.contracts[0].description='Changed processing instructions with a different recovery strategy';
  if(change==='source')next.sourceCommit='c'.repeat(40);
  if(change==='stage')next.tasks.find(t=>t.issue===2)!.stage='discovery';
  if(change==='owner')next.owner='other-dev';
  const saved=await records.save('test/repo',record.revision,next,'manager');
  expect(workerTaskFingerprint(saved,2)).not.toBe(admitted);
});
const review={docId,artifactSha256:hash,decision:'approved',notes:'Independent synthetic review of requirements, discovery evidence, alternatives, contracts and the deployed first journey.'};
it('persists an application contract, holds material questions, binds synthesis and prevents silent downgrade',async()=>{
  const data=content();data.applicationSpec={schemaVersion:1,journeys:[{id:'submit',actor:'Employee',outcome:'Submit a valid expense',requirementIds:['r1'],scenarios:[{id:'persist',kind:'happy',given:'A valid draft',when:'The employee submits',then:'The submission survives reload'}]}],decisions:[{id:'approver',question:'Who approves?',owner:'dev',requirementIds:['r1'],material:true,status:'open'}],assumptions:[],components:[{id:'app',platform:'canvas',owner:'dev',requirementIds:['r1'],contractIds:['expense'],findingIds:['repository'],dependsOn:[]}],securityBoundaries:[{id:'own',actor:'Employee',allowed:'Read own expenses',denied:'Read another employee expense',requirementIds:['r1'],findingIds:['security']}],checks:[{id:'runtime',kind:'runtime',requirementIds:['r1'],componentIds:['app'],scenarioIds:['persist'],expectedEvidence:'Authenticated persisted readback'}]};
  const {records,root}=await fixture(data);expect(()=>records.assertDiscovery('test/repo',context)).toThrow('Who approves?');expect(()=>records.assertWork('test/repo',1,context)).not.toThrow();
  await expect(approve(records)).rejects.toThrow('Who approves?');
  const input={solutionName:'Expense',problemContext:context.brief,components:[]};const before=synthesisRequirements(input,records.current('test/repo')!);
  Object.assign(data.applicationSpec.decisions[0],{status:'answered',answer:'Assigned manager',answerSource:'Synthetic manager clarification reference'});
  data.taskPlan={schemaVersion:1,tasks:[3,4].map(issue=>({issue,owner:'dev',componentIds:['app'],dependsOn:issue===4?[3]:[],resources:[],inputs:['Reviewed application requirements'],outputs:['Scoped implementation and evidence'],checkIds:['runtime'],stopConditions:['Missing required input or actual capability']}))};
  withSyntheticIntegration(data);await records.save('test/repo',1,data,'ceo');await approve(records);
  const after=synthesisRequirements(input,records.current('test/repo')!);
  expect(before.find(r=>r.id==='application-decisions-approver')?.sourceSha256).not.toBe(after.find(r=>r.id==='application-decisions-approver')?.sourceSha256);
  expect(after.some(row=>row.kind==='application-specification'&&row.id==='application-journeys-submit')).toBe(true);
  const reopened=new DeliveryRecords(root);await reopened.init();expect(reopened.current('test/repo')?.content.applicationSpec).toEqual(data.applicationSpec);
  const legacy={...data};delete legacy.applicationSpec;delete legacy.taskPlan;await expect(records.save('test/repo',2,legacy,'ceo')).rejects.toThrow('silently removed');
  await records.save('test/repo',2,{...data,outcome:'Revised outcome'},'ceo');expect(records.current('test/repo')?.designReview).toBeUndefined();
});
it('binds a licence-aware control baseline to its approved tenant and blocks required unknown controls',async()=>{
  const data=content(),tenantId='11111111-1111-4111-8111-111111111111';
  data.governanceProfile={tenantId,environmentUrl:context.environmentUrl,audience:'Synthetic pilot user',subscriptions:[],controls:[{id:'classification',name:'Classification',owner:'dev',scope:'Pilot data',requirement:'required',availability:'unknown',subscriptionProducts:[],delivery:'none',verification:'unverified',rationale:'Awaiting evidence of an available control or a manual alternative',evidence:data.findings[0].evidence}]};
  const {records,record}=await fixture(data);
  expect(()=>records.assertContext(record,context)).toThrow('approved tenant');
  expect(()=>records.assertDiscovery('test/repo',{...context,tenantId})).toThrow('required control');
});
async function approve(records:DeliveryRecords){const record=records.current('test/repo')!;return records.review('test/repo',recordReference(record),review,'qa',context);}
function release(records:DeliveryRecords):DeliveryRelease {
  const record=records.current('test/repo')!;
  return {id:crypto.randomUUID(),repoId:'test/repo',head,environmentUrl:context.environmentUrl,createdAt:new Date().toISOString(),planHash:hash,plan:{owner:'dev',qaOwner:'qa',architecture:{docId,sha256:hash},deliveryRecord:{...recordReference(record),purpose:'slice'},requiredIssues:[3],acceptanceCriteria:['Submission survives reload']} as DeliveryRelease['plan']};
}
function run(release:DeliveryRelease):DeliveryRun {
  return {id:crypto.randomUUID(),repoId:'test/repo',releaseId:release.id,head,environmentUrl:context.environmentUrl,phase:'complete',startedAt:new Date().toISOString(),appUrls:['https://example.com/app'],evidence:[],log:[],evidenceHash:hash,visualReview:{reviewer:'qa',reviewedAt:new Date().toISOString(),evidenceHash:hash,scores:[5,5,5,5,5],notes:'Independent synthetic acceptance'}};
}
it('retains expired historical observations without giving them critical readiness authority',async()=>{
  const data=content(),finding=data.findings[0];finding.critical=false;
  finding.evidence[0].observedAt=new Date(Date.now()-120000).toISOString();finding.evidence[0].expiresAt=new Date(Date.now()-60000).toISOString();
  const {record}=await fixture(data);expect(discoveryBlockers(record)).toEqual([]);
  record.content.findings[0].critical=true;expect(discoveryBlockers(record).join(' ')).toContain('refresh stale');
});
it('keeps revision history on restart and rejects concurrent stale edits',async()=>{
  const {records,root,record}=await fixture();const next={...content(),outcome:'Revised outcome'};
  const results=await Promise.allSettled([records.save('test/repo',1,next,'ceo'),records.save('test/repo',1,next,'ceo')]);
  expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']);
  const restored=new DeliveryRecords(root);await restored.init();expect(restored.view('test/repo')).toHaveLength(2);expect(restored.current('test/repo')?.previousSha256).toBe(record.sha256);
  expect(restored.current('other/repo')).toBeNull();await records.close();await expect(records.save('test/repo',2,next,'ceo')).rejects.toThrow('unavailable');
});
it('allows discovery and design at the correct stages but holds slice and wider work',async()=>{
  const data=content();data.sourceCommit=null;data.findings=[];const {records}=await fixture(data);
  expect(()=>records.assertWork('test/repo',1,context)).not.toThrow();expect(()=>records.assertWork('test/repo',2,context)).not.toThrow();
  await records.save('test/repo',1,content(),'ceo');expect(()=>records.assertWork('test/repo',2,context)).not.toThrow();
  expect(()=>records.assertWork('test/repo',3,context)).toThrow('review');await approve(records);
  expect(()=>records.assertWork('test/repo',3,context)).not.toThrow();expect(()=>records.assertWork('test/repo',4,context)).toThrow('vertical slice');
  expect(()=>records.assertWork('test/repo',99,context)).toThrow('Link issue');expect(()=>records.assertWork('test/repo',1,{...context,brief:'Changed'})).toThrow('Brief or target');
});
it('allows discovery before a target is known without inventing environment readiness',async()=>{
  const data=content();data.environmentUrl=null;data.sourceCommit=null;data.findings=[];const {records,record}=await fixture(data);
  expect(()=>records.assertWork('test/repo',1,{brief:context.brief})).not.toThrow();expect(discoveryBlockers(record)).toContain('Discover and approve the deployment target');
  expect(()=>records.assertWork('test/repo',2,{brief:context.brief})).not.toThrow();expect(()=>records.assertWork('test/repo',3,{brief:context.brief})).toThrow();
});
it.each(['assumed','unresolved'] as const)('critical %s findings block discovery while naming owner and remedy',async status=>{
  const data=content();data.findings.push({...data.findings[0],id:'licence',status,remedy:'Obtain the required licence',owner:'admin',evidence:[]});const {record,records}=await fixture(data);
  expect(discoveryBlockers(record).join(';')).toContain('Obtain the required licence (owner: admin)');expect(()=>records.assertDiscovery('test/repo',context)).toThrow('licence');
});
it('blocks missing coverage, stale and future evidence and accepts noncritical explicit assumptions',async()=>{
  const data=content();data.findings[0].evidence[0].expiresAt=new Date(Date.now()-100).toISOString();
  data.findings[1].evidence[0].observedAt=new Date(Date.now()+120_000).toISOString();data.findings[1].evidence[0].expiresAt=new Date(Date.now()+180_000).toISOString();
  data.findings=data.findings.filter(f=>f.area!=='deployment');const {record}=await fixture(data);
  expect(discoveryBlockers(record).join(';')).toMatch(/Inspect deployment.*repository.*user-journey/);
  const good=content();good.findings.push({...good.findings[0],id:'optional',critical:false,status:'assumed',evidence:[]});expect(discoveryBlockers((await fixture(good)).record)).toEqual([]);
});
it('requires real assigned independent review and invalidates approvals on every content revision',async()=>{
  const {records,record}=await fixture();await expect(records.review('test/repo',recordReference(record),review,'dev',context)).rejects.toThrow('independent');
  await expect(records.review('test/repo',recordReference(record),review,'other-qa',context)).rejects.toThrow('independent');
  await approve(records);expect(records.current('test/repo')?.designReview?.decision).toBe('approved');
  const changed=await records.save('test/repo',1,content(),'ceo');expect(changed.designReview).toBeUndefined();expect(changed.sliceReceipt).toBeUndefined();
  await expect(records.review('test/repo',recordReference(record),review,'qa',context)).rejects.toThrow('changed');
});
it('keeps observed failures blocked and permits independent rejection without granting implementation authority',async()=>{
  const input=content();input.findings[0].conclusion='blocked';const {records,record}=await fixture(input);
  expect(()=>records.assertDiscovery('test/repo',context)).toThrow('observed blocked');
  await expect(approve(records)).rejects.toThrow('observed blocked');
  await records.review('test/repo',recordReference(record),{...review,decision:'rejected'},'qa',context);
  expect(records.current('test/repo')?.designReview?.decision).toBe('rejected');expect(()=>records.assertWork('test/repo',3,context)).toThrow('observed blocked');
});
it('does not infer readiness for legacy critical observations lacking a conclusion',async()=>{
  const input=content();delete input.findings[0].conclusion;const {record}=await fixture(input);expect(discoveryBlockers(record).join('; ')).toContain('observed unknown');
});
it('unlocks expansion only from the completed independently reviewed deployment on the exact record and target',async()=>{
  const {records}=await fixture();await approve(records);const r=release(records),deployment=run(r),ref=recordReference(records.current('test/repo')!);
  const expansion={...r.plan,deliveryRecord:{...ref,purpose:'expansion' as const}};
  expect(()=>records.assertRelease('test/repo',expansion,context)).toThrow('slice');
  for(const invalid of [{...deployment,phase:'reviewing'}, {...deployment,evidenceHash:undefined},{...deployment,environmentUrl:'https://other.example.com'},{...deployment,visualReview:{...deployment.visualReview!,reviewer:'dev'}},{...deployment,head:'c'.repeat(40)}])await expect(records.acceptSlice('test/repo',ref,r,invalid as DeliveryRun,context)).rejects.toThrow('completed');
  await records.acceptSlice('test/repo',ref,r,deployment,context);expect(()=>records.assertWork('test/repo',4,context)).not.toThrow();expect(()=>records.assertRelease('test/repo',expansion,context)).not.toThrow();
  await expect(approve(records)).rejects.toThrow('immutable');
});
it('rejects missing release bindings, wrong ownership/design, missing acceptance and wrong task stages',async()=>{
  const {records}=await fixture();await approve(records);const r=release(records);
  for(const plan of [{...r.plan,deliveryRecord:undefined},{...r.plan,owner:'other'},{...r.plan,architecture:{docId,sha256:'c'.repeat(64)}},{...r.plan,acceptanceCriteria:[]},{...r.plan,requiredIssues:[4]}])expect(()=>records.assertRelease('test/repo',plan,context)).toThrow();
});
it('preserves corrupt state and refuses writes instead of resetting history',async()=>{
  const {root,records}=await fixture();const file=path.join(root,'delivery-records.json');const raw=await fs.readFile(file,'utf8');
  await fs.writeFile(file,raw.replace('Expense submission','Changed scope'));
  const broken=new DeliveryRecords(root);await expect(broken.init()).rejects.toThrow('inconsistent');expect(()=>broken.current('test/repo')).toThrow('unavailable');
  await expect(broken.save('test/repo',0,content(),'ceo')).rejects.toThrow('unavailable');expect(await fs.readFile(file,'utf8')).not.toBe(raw);await records.close();
});
it('leaves the acknowledged snapshot intact and revokes authority after failed publication',async()=>{
  const {root,records}=await fixture();const file=path.join(root,'delivery-records.json'),before=await fs.readFile(file,'utf8');
  vi.spyOn(fs,'rename').mockRejectedValue(new Error('disk unavailable'));
  await expect(records.save('test/repo',1,content(),'ceo')).rejects.toThrow('disk unavailable');expect(()=>records.current('test/repo')).toThrow('unavailable');expect(await fs.readFile(file,'utf8')).toBe(before);
});
it('denies a cancelled publication without disabling unrelated record work',async()=>{
  const {records,root}=await fixture();let active=true;
  const original=fs.writeFile.bind(fs);vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{await original(...args);active=false;});
  await expect(records.save('test/repo',1,content(),'ceo',()=>{if(!active)throw new HttpError(403,'Task cancelled');})).rejects.toThrow('Task cancelled');
  expect(records.current('test/repo')?.revision).toBe(1);const persisted=JSON.parse(await fs.readFile(path.join(root,'delivery-records.json'),'utf8'));expect(persisted.records).toHaveLength(1);
});
it('enforces tool roles/project scope and only reviews architecture bound to the exact discovery version',async()=>{
  const {records,root,record}=await fixture();
  const deps={repo:()=>({...context,checkoutPath:root}),agents:()=>[{id:'dev',repoId:'test/repo',role:'dev'},{id:'qa',repoId:'test/repo',role:'qa'}],delivery:()=>({releases:[],runs:[]}) as never,assertOpen(){}};
  const dev=deliveryRecordHandler(records,deps,{id:'dev',role:'dev',repoId:'test/repo'}),qa=deliveryRecordHandler(records,deps,{id:'qa',role:'qa',repoId:'test/repo'});
  const reviewer=deliveryRecordHandler(records,deps,{id:'qa',role:'qa',repoId:'test/repo',reviewOnly:true});
  for(const action of ['finding','inspect_repository'] as const)await expect(reviewer({repo_id:'test/repo',action,expected_revision:1})).rejects.toThrow('cannot change its discovery inputs');
  expect(records.current('test/repo')?.revision).toBe(1);
  await expect(dev({repo_id:'other/repo',action:'read'})).rejects.toThrow('another project');
  await expect(dev({repo_id:'test/repo',action:'save',expected_revision:1,payload_json:JSON.stringify(content())})).rejects.toThrow('Only the CEO');
  const input={solutionName:'Synthetic solution',problemContext:context.brief,components:[]};
  const result={...generateHldContent(input),deliveryRecord:recordReference(record)};
  const artifact=await saveHldArtifact(root,input,result,()=>{},'test/repo');
  expect(JSON.parse(await reviewer({repo_id:'test/repo',action:'read'})).architectureDraft).toMatchObject({artifactSha256:artifact.artifactSha256,result:{docId:result.docId,markdownContent:result.markdownContent}});
  const payload={reference:recordReference(record),docId:result.docId,artifactSha256:artifact.artifactSha256,decision:'approved',notes:review.notes};
  await expect(dev({repo_id:'test/repo',action:'review',expected_revision:1,payload_json:JSON.stringify(payload)})).rejects.toThrow('independent QA');
  await reviewer({repo_id:'test/repo',action:'review',expected_revision:1,payload_json:JSON.stringify(payload)});expect(records.current('test/repo')?.designReview?.decision).toBe('approved');
  await records.save('test/repo',1,content(),'ceo');await expect(qa({repo_id:'test/repo',action:'review',expected_revision:2,payload_json:JSON.stringify(payload)})).rejects.toThrow('exact discovery');
});
it('records worker evidence with optimistic concurrency and keeps unverified claims out of discovery',async()=>{
  const {records,root}=await fixture();const worker=deliveryRecordHandler(records,{repo:()=>({...context,checkoutPath:root}),agents:()=>[],delivery:()=>({}) as never,assertOpen(){}},{id:'dev',role:'dev',repoId:'test/repo'});
  const finding={...content().findings[0],id:'blocked-auth',status:'unresolved',evidence:[],remedy:'Sign in using the approved account'};
  await worker({repo_id:'test/repo',action:'finding',expected_revision:1,payload_json:JSON.stringify({finding})});
  expect(()=>records.assertDiscovery('test/repo',context)).toThrow('Sign in');await expect(worker({repo_id:'test/repo',action:'finding',expected_revision:1,payload_json:JSON.stringify({finding})})).rejects.toThrow('changed');
});
it('collects an actual committed inventory without modifying the repository and stores hash-verifiable evidence',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'repository-discovery-'));roots.push(root);const git=promisify(execFile);
  await git('git',['init'],{cwd:root,windowsHide:true});await fs.writeFile(path.join(root,'README.md'),'Synthetic fixture only');await git('git',['add','README.md'],{cwd:root,windowsHide:true});await git('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture'],{cwd:root,windowsHide:true});
  const before=(await git('git',['status','--porcelain'],{cwd:root,windowsHide:true})).stdout;
  const evidenceRoot=await fs.mkdtemp(path.join(os.tmpdir(),'discovery-evidence-'));roots.push(evidenceRoot);
  const result=await inspectRepository(root,evidenceRoot);expect(result.observation.trackedFiles).toEqual(['README.md']);expect(result.observation.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(crypto.createHash('sha256').update(await fs.readFile(result.evidence.reference)).digest('hex')).toBe(result.evidence.sha256);
  expect((await git('git',['status','--porcelain'],{cwd:root,windowsHide:true})).stdout).toBe(before);
});
it('includes every shared-record requirement in design traceability, beyond the supplied component brief',async()=>{
  const {record}=await fixture();const catalogue=synthesisRequirements({solutionName:'Synthetic',problemContext:'A short brief',components:[]},record);
  expect(catalogue.map(r=>r.id)).toEqual(['brief','delivery-r1']);expect(catalogue[1].text).toContain('Submission survives reload');
  expect(()=>requireSynthesisTraceability(catalogue,{implementationPlan:[],requirements:[]} as never)).toThrow('every declared requirement');
});
it.each(['success','changed'] as const)('grounds actual synthesis in the shared discovery record and binds publication: %s',async mode=>{
  const {records,root,record}=await fixture();let callbacks!:SessionCallbacks,options!:SessionOptions;
  const service=new HldSynthesisService(path.join(root,'synthesis'),{reserve:()=>({running(){},stopping(){},release(){}}),assertOpen(){},context:()=>({checkoutPath:root,fingerprint:records.current('test/repo')!.sha256,copilotPaused:true,skills:[],discoveryRecord:records.current('test/repo')!}),admission:async()=>null,start:(input,cb)=>{options=input;callbacks=cb;return {stop(){},send(){}};}});
  await service.init();
  try{
    const input={solutionName:'Synthetic expenses',problemContext:'A short supplied brief',components:[]},job=await service.start('test/repo',input);
    await vi.waitFor(()=>expect(options).toBeDefined());const supplied=JSON.parse(options.prompt);expect(supplied.discoveryEvidence.reference.sha256).toBe(record.sha256);expect(supplied.requirementCatalogue.map((r:{id:string})=>r.id)).toContain('delivery-r1');
    if(mode==='changed')await records.save('test/repo',1,{...content(),outcome:'Changed scope during model execution'},'ceo');
    const detail='Synthetic design text with observable acceptance; no tenant validation claimed.';
    callbacks.finished({ok:true,text:'',costUsd:0,turns:1,errors:[],structured:{summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],missingEvidence:['Independent tenant verification remains required'],skillBindings:[],implementationPlan:['build','test','deploy'].map(id=>({id,title:id,deliverables:[detail],acceptance:[detail]})),requirements:supplied.requirementCatalogue.map((source:{id:string;sourceSha256:string})=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['build'],requirement:detail,design:detail,acceptance:detail})),mermaidDiagrams:{topology:'flowchart LR\nA-->B',erd:'erDiagram\nA ||--o{ B : contains',sequence:'sequenceDiagram\nA->>B: Submit'}}});
    await vi.waitFor(()=>expect(service.view('test/repo',job.id)[0].status).toBe(mode==='success'?'completed':'failed'));
    if(mode==='success'){const artifact=await service.result('test/repo',job.id);expect(artifact.result.deliveryRecord).toEqual(recordReference(record));expect(artifact.result.markdownContent).toContain('Captured discovery and delivery scope');}
    else await expect(service.result('test/repo',job.id)).rejects.toThrow();
  }finally{await service.close();}
});

// Phase 3 acceptance: explicit task authority, merged inputs and bounded context.
function plannedContent():DeliveryRecordContent {
  const data=content();
  data.requirements=[1,2,3].map(n=>({id:`r${n}`,description:`Requirement ${n}`,acceptance:`Observable outcome ${n}`}));
  data.tasks=[1,2,3].map(n=>({issue:n+10,stage:'slice' as const,requirementIds:[`r${n}`]}));
  data.slice.requirementIds=['r1','r2','r3'];
  data.applicationSpec={schemaVersion:1,journeys:[1,2,3].map(n=>({id:`j${n}`,actor:'Tester',outcome:`Outcome ${n}`,requirementIds:[`r${n}`],scenarios:[{id:`s${n}`,kind:'happy' as const,given:'An authenticated user',when:'They perform the operation',then:'The expected outcome persists'}]})),decisions:[],assumptions:[],securityBoundaries:[{id:'own',actor:'Tester',allowed:'Read own records',denied:'Read other records',requirementIds:['r1'],findingIds:['security']}],
    components:[1,2,3].map(n=>({id:`c${n}`,platform:'canvas' as const,owner:`dev${n}`,requirementIds:[`r${n}`],contractIds:[],findingIds:['repository'],dependsOn:n===2?['c1']:[]})),
    checks:[1,2,3].map(n=>({id:`check${n}`,kind:'runtime' as const,requirementIds:[`r${n}`],componentIds:[`c${n}`],scenarioIds:[`s${n}`],expectedEvidence:'Authenticated persisted readback'}))};
  data.taskPlan={schemaVersion:1,tasks:[1,2,3].map(n=>({issue:n+10,owner:`dev${n}`,componentIds:[`c${n}`],dependsOn:n===2?[11]:[],resources:[],inputs:['Approved source contract'],outputs:['Implemented component and evidence'],checkIds:[`check${n}`],stopConditions:['Stop if required input or authenticated capability is unavailable']}))};
  return withSyntheticIntegration(data);
}
async function approveTask(records:DeliveryRecords,issue:number,decision:'approved'|'rejected'='approved'){
  const record=records.current('test/repo')!;
  return records.reviewTask('test/repo',recordReference(record),issue,{taskHash:taskScopeHash(record,issue)!,decision,notes:review.notes},'qa',context);
}
const taskEvidence={prNumber:101,headSha:head,mergeCommitSha:'c'.repeat(40),evidenceHash:hash};
it('rejects invalid ownership, missing contracts/checks, undeclared component prerequisites and cyclic tasks',()=>{
  expect(deliveryRecordContentSchema.safeParse(plannedContent()).success).toBe(true);
  for(const mutate of [
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[0].owner='qa';},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks.pop();},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[0].checkIds=['unknown'];},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[1].dependsOn=[];},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[0].dependsOn=[12];},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[0].dependsOn=[99];},
    (d:DeliveryRecordContent)=>{d.taskPlan!.tasks[0].componentIds=['c3'];},
  ]){const d=plannedContent();mutate(d);expect(deliveryRecordContentSchema.safeParse(d).success).toBe(false);}
});
it('holds exact task scope for independent review and prerequisites for merged QA receipts, never issue closure',async()=>{
  const {records}=await fixture(plannedContent());await approve(records);
  expect(()=>records.assertWork('test/repo',11,context)).toThrow('exact task scope');
  const record=records.current('test/repo')!;
  await expect(records.reviewTask('test/repo',recordReference(record),11,{taskHash:taskScopeHash(record,11)!,decision:'approved',notes:review.notes},'dev1',context)).rejects.toThrow('independent QA');
  await expect(records.reviewTask('test/repo',recordReference(record),11,{taskHash:'f'.repeat(64),decision:'approved',notes:review.notes},'qa',context)).rejects.toThrow('scope changed');
  await approveTask(records,11);await approveTask(records,12);
  expect(()=>records.assertWork('test/repo',11,context)).not.toThrow();
  expect(()=>records.assertWork('test/repo',12,context)).toThrow('dependency #11');
  await expect(records.acceptTask('test/repo',recordReference(records.current('test/repo')!),11,taskEvidence,'dev1',context)).rejects.toThrow('independent QA');
  await records.acceptTask('test/repo',recordReference(records.current('test/repo')!),11,taskEvidence,'qa',context);
  expect(()=>records.assertWork('test/repo',12,context)).not.toThrow();
});
it('preserves unrelated scoped approvals and receipts but invalidates edited tasks and transitive dependents',async()=>{
  const {records,root}=await fixture(plannedContent());await approve(records);for(const n of [11,12,13])await approveTask(records,n);
  await records.acceptTask('test/repo',recordReference(records.current('test/repo')!),11,taskEvidence,'qa',context);
  const before=records.current('test/repo')!,fingerprint=taskAuthorityHash(before,12),data=structuredClone(before.content);
  data.requirements[2].acceptance='Revised unrelated acceptance';withSyntheticIntegration(data);await records.save('test/repo',1,data,'ceo');
  let current=records.current('test/repo')!;expect(current.designReview).toBeUndefined();expect(current.taskReviews?.map(r=>r.issue)).toEqual([11,12]);expect(current.taskAcceptances).toHaveLength(1);expect(taskAuthorityHash(current,12)).toBe(fingerprint);
  expect(()=>records.assertWork('test/repo',12,context)).not.toThrow();
  const reopened=new DeliveryRecords(root);await reopened.init();expect(reopened.current('test/repo')?.taskAcceptances).toHaveLength(1);
  data.requirements[0].acceptance='Changed prerequisite contract';withSyntheticIntegration(data);await records.save('test/repo',2,data,'ceo');current=records.current('test/repo')!;
  expect(current.taskReviews).toEqual([]);expect(current.taskAcceptances).toEqual([]);expect(()=>records.assertWork('test/repo',12,context)).toThrow('exact task scope');
  delete data.taskPlan;await expect(records.save('test/repo',3,data,'ceo')).rejects.toThrow('silently removed');
});
it('rejects tampered persisted task evidence and slice provenance at restart',async()=>{
  const {records,root}=await fixture(plannedContent());await approve(records);await approveTask(records,11);
  const filename=path.join(root,'delivery-records.json'),original=await fs.readFile(filename,'utf8');
  for(const mutate of [
    (r:ReturnType<DeliveryRecords['current']>)=>{r!.taskReviews![0].taskHash='f'.repeat(64);},
    (r:ReturnType<DeliveryRecords['current']>)=>{r!.taskReviews![0].reviewer='dev1';},
    (r:ReturnType<DeliveryRecords['current']>)=>{r!.taskReviews![0].sliceReceipt={releaseId:crypto.randomUUID(),runId:crypto.randomUUID(),evidenceHash:hash,head,acceptedAt:new Date().toISOString()};},
  ]){const state=JSON.parse(original);mutate(state.records[0]);await fs.writeFile(filename,JSON.stringify(state));await expect(new DeliveryRecords(root).init()).rejects.toThrow();}
});
it('requires task splitting when the dependency context exceeds its authoring budget',async()=>{
  const data=plannedContent();const {records,record}=await fixture(data);await approve(records);await approveTask(records,11);data.taskPlan!.tasks[0].inputs=Array(20).fill('x'.repeat(2000));
  await expect(records.save('test/repo',1,data,'ceo')).rejects.toThrow('24 KiB');expect(records.current('test/repo')?.sha256).toBe(record.sha256);expect(records.current('test/repo')?.content.taskPlan?.tasks[0].inputs).toEqual(['Approved source contract']);
});

it('exposes scoped hashes and accepts independent review_task through the actual office tool contract',async()=>{
  const {records,root}=await fixture(plannedContent());await approve(records);
  const deps={repo:()=>({...context,checkoutPath:root}),agents:()=>[],delivery:()=>({releases:[],runs:[]} as unknown as import('../shared/delivery.ts').DeliveryView),assertOpen:()=>{}};
  const tool=deliveryRecordHandler(records,deps,{id:'qa',role:'qa',repoId:'test/repo',reviewOnly:true});
  const read=JSON.parse(await tool({repo_id:'test/repo',action:'read'}));expect(read.taskScopes).toHaveLength(3);
  const payload={reference:recordReference(records.current('test/repo')!),issue:11,taskHash:read.taskScopes[0].taskHash,decision:'approved',notes:review.notes};
  const result=JSON.parse(await tool({repo_id:'test/repo',action:'review_task',expected_revision:1,payload_json:JSON.stringify(payload)}));expect(result.taskReviews[0].decision).toBe('approved');
  const developer=deliveryRecordHandler(records,deps,{id:'dev1',role:'dev',repoId:'test/repo'});
  await expect(developer({repo_id:'test/repo',action:'review_task',expected_revision:1,payload_json:JSON.stringify(payload)})).rejects.toThrow('independent QA');
});

it('requires mapped first-slice execution and merged implementation before accepting a deployment or unlocking expansion',async()=>{
  const data=plannedContent();data.requirements=data.requirements.slice(0,1);data.slice.requirementIds=['r1'];data.slice.acceptanceCriteria=[data.requirements[0].acceptance];data.tasks=[{issue:11,stage:'slice',requirementIds:['r1']},{issue:12,stage:'implementation',requirementIds:['r1']}];
  const spec=data.applicationSpec!;spec.components=spec.components.slice(0,1);spec.journeys=spec.journeys.slice(0,1);spec.checks=spec.checks.slice(0,1);
  spec.journeys[0].scenarios=['happy','denied','failure'].map(kind=>({id:kind,kind:kind as 'happy'|'denied'|'failure',given:'Authenticated synthetic identity',when:'They submit',then:'Expected result is observed'}));spec.checks[0].scenarioIds=['happy','denied','failure'];
  const quality=qualityContract([{componentId:'c1',targetKey:'app',platform:'canvas'}],['happy','denied','failure']);quality.checks.find(c=>c.kind==='runtime')!.checkId='check1';
  spec.checks=quality.checks.map(c=>({id:c.checkId,kind:c.kind,requirementIds:['r1'],componentIds:['c1'],scenarioIds:'cases' in c?c.cases.map(row=>row.scenarioId):[],expectedEvidence:'Independently inspect the runner-owned evidence and handover content'}));
  data.taskPlan!.tasks=[data.taskPlan!.tasks[0],{...data.taskPlan!.tasks[0],issue:12,dependsOn:[11]}];
  withSyntheticIntegration(data);spec.checks=spec.checks.filter(c=>!c.id.startsWith('local-'));for(const task of data.taskPlan!.tasks)task.checkIds=['compile'];for(const qa of data.taskPlan!.integrationQa!){qa.checkIds=quality.checks.map(c=>c.checkId);for(const row of qa.cases)row.testName=row.scenarioId;}const {records}=await fixture(data);await approve(records);const r=release(records);r.plan.quality={maxTaskDurationMs:30000} as any;r.plan.acceptanceCriteria=[data.requirements[0].acceptance];r.plan.requiredIssues=[11];r.plan.verification={scenarios:['journey','authorization','error-handling'].map((category,i)=>({name:['happy','denied','failure'][i],category,criterion:0}))} as DeliveryRelease['plan']['verification'];
  expect(()=>records.assertRelease('test/repo',r.plan,context)).toThrow('execution mapping');
  r.plan.firstSlice={schemaVersion:1,components:[{componentId:'c1',targetKey:'app',platform:'canvas'}],cases:[...['happy','denied','failure'].map(scenarioId=>({checkId:'check1',scenarioId,testName:scenarioId})),{checkId:'access',scenarioId:'denied',testName:'denied'}]};
  expect(()=>records.assertRelease('test/repo',r.plan,context)).toThrow('merged task evidence');
  await approveTask(records,11);await records.acceptTask('test/repo',recordReference(records.current('test/repo')!),11,taskEvidence,'qa',context);
  expect(()=>records.assertRelease('test/repo',r.plan,context)).toThrow('quality evidence bindings');r.plan.qualityEvidence=quality;
  expect(()=>records.assertRelease('test/repo',r.plan,context)).not.toThrow();
  const deployment=run(r),ref=recordReference(records.current('test/repo')!);
  await expect(records.acceptSlice('test/repo',ref,r,deployment,context)).rejects.toThrow('Runner-owned');
  deployment.firstSlice={schemaVersion:1,observedAfter:new Date().toISOString(),contractHash:firstSliceContractHash(r.plan),artifactSha256:hash,evidenceFile:'first-slice-verification.json'};deployment.evidence=['first-slice-verification.json'];
  await expect(records.acceptSlice('test/repo',ref,r,deployment,context)).rejects.toThrow('QA and documentation');
  deployment.qualityEvidence={schemaVersion:1,contractHash:qualityContractHash(r.plan),artifactSha256:hash,evidenceFile:'quality-evidence.json',observedAfter:new Date().toISOString(),checks:quality.checks.map(c=>({checkId:c.checkId,kind:c.kind,evidenceSha256:hash}))};
  deployment.qualityReview={reviewer:'qa',reviewedAt:new Date().toISOString(),evidenceHash:hash,contractHash:deployment.qualityEvidence.contractHash,decisions:quality.checks.map(c=>({checkId:c.checkId,evidenceSha256:hash,decision:'approved',notes:'Independent synthetic assessment of the actual check evidence and its limits.'}))};
  const deps={repo:()=>({...context,checkoutPath:'synthetic'}),agents:()=>[],delivery:()=>({releases:[r],runs:[deployment]} as unknown as import('../shared/delivery.ts').DeliveryView),assertOpen:()=>{}};
  const input={repo_id:'test/repo',action:'accept_slice' as const,expected_revision:1,payload_json:JSON.stringify({reference:ref,runId:deployment.id})};
  await expect(deliveryRecordHandler(records,deps,{id:'qa',role:'qa'})(input)).rejects.toThrow('Trusted');
  const verifySliceAcceptance=vi.fn(async()=>{throw new Error('Evidence changed after approval');});
  await expect(deliveryRecordHandler(records,{...deps,verifySliceAcceptance},{id:'qa',role:'qa'})(input)).rejects.toThrow('Evidence changed');expect(records.current('test/repo')?.sliceReceipt).toBeUndefined();
  verifySliceAcceptance.mockResolvedValueOnce(undefined as never);await deliveryRecordHandler(records,{...deps,verifySliceAcceptance},{id:'qa',role:'qa'})(input);
  expect(records.current('test/repo')?.sliceReceipt?.firstSlice).toMatchObject({recordSha256:ref.sha256,planHash:r.planHash,contractHash:firstSliceContractHash(r.plan)});
  await approveTask(records,12);expect(()=>records.assertWork('test/repo',12,context)).not.toThrow();
});

it.each([false,true])('keeps retained legacy receipts readable but blocks application-spec expansion (taskPlan=%s)',async withPlan=>{
  const data=plannedContent();if(!withPlan)delete data.taskPlan;const {records,root}=await fixture(data);if(!withPlan){await expect(approve(records)).rejects.toThrow('task contracts');expect(()=>records.assertWork('test/repo',11,context)).toThrow('task contracts');return;}await approve(records);const r=release(records);
  const filename=path.join(root,'delivery-records.json'),stored=JSON.parse(await fs.readFile(filename,'utf8'));
  stored.records[0].sliceReceipt={releaseId:r.id,runId:crypto.randomUUID(),head,evidenceHash:hash,acceptedAt:new Date().toISOString()};await fs.writeFile(filename,JSON.stringify(stored));
  const reopened=new DeliveryRecords(root);await reopened.init();expect(reopened.current('test/repo')?.sliceReceipt).toBeDefined();
  expect(()=>reopened.assertRelease('test/repo',{...r.plan,deliveryRecord:{...recordReference(reopened.current('test/repo')!),purpose:'expansion'}},context)).toThrow('First deployed slice');
});
it('saves a complete manager record above the worker action ceiling without losing findings or restart history',async()=>{
  const {records,record,root}=await fixture(),large=content();
  large.findings=Array.from({length:80},(_,i)=>({...large.findings[0],id:`retained-${i}`,statement:'Retained observation '.repeat(180).trim(),critical:false}));
  const bytes=JSON.stringify(large);expect(Buffer.byteLength(bytes)).toBeGreaterThan(256*1024);expect(Buffer.byteLength(bytes)).toBeLessThan(1024*1024);
  const deps={repo:()=>({...context,checkoutPath:root}),agents:()=>[{id:'dev',role:'dev',repoId:'test/repo'},{id:'qa',role:'qa',repoId:'test/repo'}],delivery:()=>({}) as never,assertOpen(){}};
  const manager=deliveryRecordHandler(records,deps,{id:'manager',role:'manager'});
  const saved=JSON.parse(await manager({repo_id:'test/repo',action:'save',expected_revision:record.revision,payload_json:bytes}));
  expect(saved.content).toEqual(large);await records.close();const reloaded=new DeliveryRecords(root);await reloaded.init();expect(reloaded.current('test/repo')?.content).toEqual(large);expect(reloaded.view('test/repo')).toHaveLength(2);await reloaded.close();
});
it('keeps worker payload bounds and rejects oversized manager saves without changing history',async()=>{
  const {records,record,root}=await fixture(),deps={repo:()=>({...context,checkoutPath:root}),agents:()=>[],delivery:()=>({}) as never,assertOpen(){}};
  const dev=deliveryRecordHandler(records,deps,{id:'dev',role:'dev',repoId:'test/repo'}),manager=deliveryRecordHandler(records,deps,{id:'manager',role:'manager'});
  await expect(dev({repo_id:'test/repo',action:'finding',expected_revision:record.revision,payload_json:JSON.stringify({secret:'x'.repeat(270000)})})).rejects.toMatchObject({status:413});
  await expect(manager({repo_id:'test/repo',action:'save',expected_revision:record.revision,payload_json:JSON.stringify({secret:'x'.repeat(1024*1024)})})).rejects.toMatchObject({status:413});
  expect(records.current('test/repo')).toEqual(record);expect(records.view('test/repo')).toHaveLength(1);
});
