import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
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
const review={docId,artifactSha256:hash,decision:'approved',notes:'Independent synthetic review of requirements, discovery evidence, alternatives, contracts and the deployed first journey.'};
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
  expect(()=>records.assertWork('test/repo',1,context)).not.toThrow();expect(()=>records.assertWork('test/repo',2,context)).toThrow('Inspect');
  await records.save('test/repo',1,content(),'ceo');expect(()=>records.assertWork('test/repo',2,context)).not.toThrow();
  expect(()=>records.assertWork('test/repo',3,context)).toThrow('review');await approve(records);
  expect(()=>records.assertWork('test/repo',3,context)).not.toThrow();expect(()=>records.assertWork('test/repo',4,context)).toThrow('vertical slice');
  expect(()=>records.assertWork('test/repo',99,context)).toThrow('Link issue');expect(()=>records.assertWork('test/repo',1,{...context,brief:'Changed'})).toThrow('Brief or target');
});
it('allows discovery before a target is known without inventing environment readiness',async()=>{
  const data=content();data.environmentUrl=null;data.sourceCommit=null;data.findings=[];const {records,record}=await fixture(data);
  expect(()=>records.assertWork('test/repo',1,{brief:context.brief})).not.toThrow();expect(discoveryBlockers(record)).toContain('Discover and approve the deployment target');
  expect(()=>records.assertWork('test/repo',2,{brief:context.brief})).toThrow('Inspect');
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
    await vi.waitFor(()=>expect(options).toBeDefined());const supplied=JSON.parse(options.prompt);expect(supplied.discoveryEvidence.sha256).toBe(record.sha256);expect(supplied.requirementCatalogue.map((r:{id:string})=>r.id)).toContain('delivery-r1');
    if(mode==='changed')await records.save('test/repo',1,{...content(),outcome:'Changed scope during model execution'},'ceo');
    const detail='Synthetic design text with observable acceptance; no tenant validation claimed.';
    callbacks.finished({ok:true,text:'',costUsd:0,turns:1,errors:[],structured:{summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],missingEvidence:['Independent tenant verification remains required'],skillBindings:[],implementationPlan:['build','test','deploy'].map(id=>({id,title:id,deliverables:[detail],acceptance:[detail]})),requirements:supplied.requirementCatalogue.map((source:{id:string;sourceSha256:string})=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['build'],requirement:detail,design:detail,acceptance:detail})),mermaidDiagrams:{topology:'flowchart LR\nA-->B',erd:'erDiagram\nA ||--o{ B : contains',sequence:'sequenceDiagram\nA->>B: Submit'}}});
    await vi.waitFor(()=>expect(service.view('test/repo',job.id)[0].status).toBe(mode==='success'?'completed':'failed'));
    if(mode==='success'){const artifact=await service.result('test/repo',job.id);expect(artifact.result.deliveryRecord).toEqual(recordReference(record));expect(artifact.result.markdownContent).toContain('Captured discovery and delivery scope');}
    else await expect(service.result('test/repo',job.id)).rejects.toThrow();
  }finally{await service.close();}
});
