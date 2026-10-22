import {withSyntheticIntegration} from './testFixtures/taskIntegration.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {DeliveryRecords} from './deliveryRecords.ts';
import {HttpError} from './httpError.ts';
import {taskScopeHash,taskAuthorityHash} from './taskScope.ts';
import {assertOriginalTaskQa,assertEvidenceOnlyRevision,type OriginalTaskQa} from './taskReconciliation.ts';
import {deliveryRecordContentSchema,discoveryAreas,recordReference,type DeliveryRecordContent} from '../shared/deliveryRecord.ts';
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

async function approve(records:DeliveryRecords){const record=records.current('test/repo')!;return records.review('test/repo',recordReference(record),review,'qa',context);}
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

async function reconciliationFixture(input=plannedContent()){
  const f=await fixture(input);await approve(f.records);await approveTask(f.records,11);
  const proof={prNumber:101,status:'passed',issueNumber:11,passedSha:head,qaAgentId:'qa',commentUrl:'https://example.test/report',summary:'Independent source verified',checks:[{name:'Source',result:'pass',details:'Exact reviewed source'}],taskAuthorityHash:taskAuthorityHash(f.records.current('test/repo')!,11)};
  const evidenceHash=crypto.createHash('sha256').update(JSON.stringify({pr:101,head,reviewer:'qa',summary:proof.summary,checks:proof.checks,commentUrl:proof.commentUrl})).digest('hex');
  await f.records.acceptTask('test/repo',recordReference(f.records.current('test/repo')!),11,{...taskEvidence,evidenceHash},'qa',context);
  const original=f.records.current('test/repo')!,data=structuredClone(original.content);
  data.findings[0].evidence=[{reference:'fixtures/new-observation.json',sha256:'d'.repeat(64),observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}];
  await f.records.save('test/repo',original.revision,data,'manager');await approve(f.records);await approveTask(f.records,11);
  const current=f.records.current('test/repo')!,verify=vi.fn(async()=>proof);
  const reconcile=(actor='qa',source=recordReference(original),ref=recordReference(current))=>f.records.reconcileTask('test/repo',ref,11,source,review.notes,actor,context,verify);
  return {...f,original,current,data,verify,reconcile,proof};
}
it('reconciles fresh evidence only after current independent review and exact merged-source verification; survives restart without altering original history',async()=>{
  const f=await reconciliationFixture();expect(f.current.taskAcceptances).toEqual([]);
  const updated=await f.reconcile(),receipt=updated.taskAcceptances![0];
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.original,f.original.taskAcceptances![0]);
  expect(receipt).toMatchObject({...taskEvidence,evidenceHash:f.original.taskAcceptances![0].evidenceHash,taskHash:taskScopeHash(f.current,11),reconciliation:{sourceRecord:recordReference(f.original),sourceTaskHash:taskScopeHash(f.original,11),reviewer:'qa'}});
  expect(f.records.view('test/repo').find(r=>r.revision===f.original.revision)).toEqual(f.original);
  await f.reconcile();expect(f.records.current('test/repo')!.taskAcceptances).toHaveLength(1);
  await f.records.close();const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current('test/repo')!.taskAcceptances).toEqual(updated.taskAcceptances);await reopened.close();
});
it.each(['dev','manager','other-qa'])('rejects reconciliation by %s without verifying or changing acceptance',async actor=>{
  const f=await reconciliationFixture();await expect(f.reconcile(actor)).rejects.toThrow('independent QA');expect(f.verify).not.toHaveBeenCalled();expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);
});
it('withholds reconciliation on failed original QA/GitHub verification and on cancellation after verification',async()=>{
  const f=await reconciliationFixture();f.verify.mockRejectedValueOnce(new Error('Exact merged evidence differs'));
  await expect(f.reconcile()).rejects.toThrow('merged evidence');expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);
  let cancelled=false;f.verify.mockImplementationOnce(async()=>{cancelled=true;return f.proof;});
  await expect(f.records.reconcileTask('test/repo',recordReference(f.current),11,recordReference(f.original),review.notes,'qa',context,f.verify,()=>{if(cancelled)throw Error('Stopped');})).rejects.toThrow('Stopped');
  expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);
});
it.each(['source','target','requirements','task-owner','component','finding-decision','retimed-artifact'])('rejects %s changes rather than carrying accepted work',async change=>{
  const f=await reconciliationFixture(),data=structuredClone(f.current.content);
  if(change==='source')data.sourceCommit='e'.repeat(40);
  if(change==='target')data.environmentUrl='https://other.crm.dynamics.com';
  if(change==='requirements')data.requirements[0].description+=' changed';
  if(change==='task-owner'){data.taskPlan!.tasks[0].owner='other-dev';data.applicationSpec!.components[0].owner='other-dev';}
  if(change==='component')data.applicationSpec!.components[0].platform='dataverse';
  if(change==='finding-decision')data.findings[0].conclusion='not-applicable';
  if(change==='retimed-artifact')data.findings[0].evidence=f.original.content.findings[0].evidence.map(e=>({...e,expiresAt:new Date(Date.parse(e.expiresAt)+1000).toISOString()}));
  await f.records.save('test/repo',f.current.revision,data,'manager');
  const latest=f.records.current('test/repo')!;
  // Review/accept under matching synthetic target when testing a changed target;
  // the reconciliation comparison must still reject the original target.
  const ctx={...context,environmentUrl:data.environmentUrl!};
  await f.records.review('test/repo',recordReference(latest),review,'qa',ctx);await f.records.reviewTask('test/repo',recordReference(latest),11,{taskHash:taskScopeHash(latest,11)!,decision:'approved',notes:review.notes},'qa',ctx);
  await expect(f.records.reconcileTask('test/repo',recordReference(latest),11,recordReference(f.original),review.notes,'qa',ctx,f.verify)).rejects.toThrow(/unchanged|decision|immutable/);
  expect(f.verify).not.toHaveBeenCalled();expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);
});
it('rejects stale references, missing source acceptance and expired current observations',async()=>{
  const f=await reconciliationFixture();await expect(f.reconcile('qa',recordReference(f.original),{...recordReference(f.current),sha256:'f'.repeat(64)})).rejects.toThrow('changed');
  await expect(f.reconcile('qa',{...recordReference(f.original),revision:999})).rejects.toThrow('unavailable');
  const empty=f.records.view('test/repo').find(r=>r.revision===1)!; // source1 is accepted; source2/current has no original receipt.
  expect(empty.taskAcceptances).toHaveLength(1);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
  await expect(f.reconcile()).rejects.toThrow('stale');expect(f.verify).not.toHaveBeenCalled();
});
it.each(['missing','status','issue','head','reviewer','comment','checks','scope','hash'])('requires exact original QA provenance: %s',async variant=>{
  const f=await reconciliationFixture();
  const qa:OriginalTaskQa={prNumber:101,status:'passed',issueNumber:11,passedSha:head,qaAgentId:'qa',commentUrl:'https://example.test/report',summary:'Independent source verified',checks:[{result:'pass'}],taskAuthorityHash:taskAuthorityHash(f.original,11)};
  const receipt={...f.original.taskAcceptances![0],evidenceHash:crypto.createHash('sha256').update(JSON.stringify({pr:qa.prNumber,head:qa.passedSha,reviewer:qa.qaAgentId,summary:qa.summary,checks:qa.checks,commentUrl:qa.commentUrl})).digest('hex')};
  expect(()=>assertOriginalTaskQa(f.original,receipt,11,qa)).not.toThrow();
  if(variant==='status')qa.status='failed';if(variant==='issue')qa.issueNumber=12;if(variant==='head')qa.passedSha='f'.repeat(40);if(variant==='reviewer')qa.qaAgentId='other';if(variant==='comment')qa.commentUrl=null;if(variant==='checks')qa.checks=[{result:'skip'}];if(variant==='scope')qa.taskAuthorityHash='f'.repeat(64);if(variant==='hash')receipt.evidenceHash='f'.repeat(64);
  expect(()=>assertOriginalTaskQa(f.original,receipt,11,variant==='missing'?undefined:qa)).toThrow('QA evidence');
});
it('withholds authority before initialization, after close and for missing records or repair links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'record-independent-qa-')); roots.push(root); const records = new DeliveryRecords(root);
  expect(() => records.current('test/repo')).toThrow('unavailable'); await records.init();
  expect(() => records.assertDiscovery('missing/repo', context)).toThrow('Create the shared'); expect(() => records.assertWork('missing/repo', 1, context)).toThrow('Create a shared');
  await records.save('test/repo', 0, content(), 'ceo'); expect(() => records.assertWork('test/repo', 0, context)).toThrow('Link this repair');
  await records.close(); expect(() => records.view('test/repo')).toThrow('unavailable');
});
it('requires current design provenance before task review and rejects unknown tasks without changing history', async () => {
  const { records } = await fixture(plannedContent()), ref = recordReference(records.current('test/repo')!);
  await expect(approveTask(records, 11)).rejects.toThrow('current design'); await approve(records);
  await expect(records.reviewTask('test/repo', ref, 999, { taskHash: hash, decision: 'approved', notes: review.notes }, 'qa', context)).rejects.toThrow('Task scope changed');
  expect(records.current('test/repo')?.taskReviews).toEqual([]);
});
it('revokes accepted dependency closures on independent task rejection and keeps repeat acceptance idempotent', async () => {
  const { records, root } = await fixture(plannedContent()); await approve(records); for (const issue of [11, 12, 13]) await approveTask(records, issue);
  const ref = recordReference(records.current('test/repo')!); await records.acceptTask('test/repo', ref, 11, taskEvidence, 'qa', context); await records.acceptTask('test/repo', ref, 12, { ...taskEvidence, prNumber: 102 }, 'qa', context);
  const file = path.join(root, 'delivery-records.json'), before = await fs.readFile(file, 'utf8'); await records.acceptTask('test/repo', ref, 11, taskEvidence, 'qa', context); expect(await fs.readFile(file, 'utf8')).toBe(before);
  await records.acceptTask('test/repo', ref, 13, { ...taskEvidence, prNumber: 103 }, 'qa', context);
  await approveTask(records, 11, 'rejected'); expect(records.current('test/repo')?.taskAcceptances?.map(a => a.issue)).toEqual([13]);
  expect(() => records.assertWork('test/repo', 11, context)).toThrow('exact task scope'); expect(() => records.assertWork('test/repo', 12, context)).toThrow('dependency #11');
  await records.review('test/repo', ref, { ...review, decision: 'rejected' }, 'qa', context); expect(records.current('test/repo')?.taskReviews).toEqual([]); expect(records.current('test/repo')?.taskAcceptances).toEqual([]);
});
it.each(['duplicate-task-review', 'duplicate-task-acceptance', 'wrong-reviewer', 'stale-task-hash', 'missing-design-source', 'missing-task-review', 'missing-prerequisite', 'wrong-design-reviewer', 'quality-reviewer', 'quality-evidence', 'slice-without-design', 'first-slice-record'] as const)('preserves and rejects retained %s authority corruption', async mode => {
  const f = await fixture(plannedContent()); await approve(f.records); for (const n of [11, 12]) await approveTask(f.records, n);
  const ref = recordReference(f.records.current('test/repo')!); await f.records.acceptTask('test/repo', ref, 11, taskEvidence, 'qa', context); await f.records.acceptTask('test/repo', ref, 12, taskEvidence, 'qa', context);
  const file = path.join(f.root, 'delivery-records.json'), state = JSON.parse(await fs.readFile(file, 'utf8')), record = state.records[0];
  if (mode === 'duplicate-task-review') record.taskReviews.push(record.taskReviews[0]);
  if (mode === 'duplicate-task-acceptance') record.taskAcceptances.push(record.taskAcceptances[0]);
  if (mode === 'wrong-reviewer') record.taskAcceptances[0].reviewer = 'dev';
  if (mode === 'stale-task-hash') record.taskAcceptances[0].taskHash = 'e'.repeat(64);
  if (mode === 'missing-design-source') record.taskReviews[0].designRecord.revision = 99;
  if (mode === 'missing-task-review') record.taskReviews = record.taskReviews.filter((r: { issue: number }) => r.issue !== 12);
  if (mode === 'missing-prerequisite') record.taskAcceptances = record.taskAcceptances.filter((r: { issue: number }) => r.issue !== 11);
  if (mode === 'wrong-design-reviewer') record.designReview.reviewer = 'dev';
  if (mode.startsWith('quality') || mode === 'slice-without-design' || mode === 'first-slice-record') record.sliceReceipt = { releaseId: crypto.randomUUID(), runId: crypto.randomUUID(), evidenceHash: hash, head, acceptedAt: new Date().toISOString() };
  if (mode.startsWith('quality')) record.sliceReceipt.qualityAcceptance = { reviewer: mode === 'quality-reviewer' ? 'dev' : 'qa', evidenceHash: mode === 'quality-evidence' ? 'e'.repeat(64) : hash, contractHash: hash, artifactSha256: hash };
  if (mode === 'slice-without-design') delete record.designReview;
  if (mode === 'first-slice-record') record.sliceReceipt.firstSlice = { schemaVersion: 1, observedAfter: new Date().toISOString(), contractHash: hash, artifactSha256: hash, evidenceFile: 'first-slice-verification.json', planHash: hash, recordSha256: 'e'.repeat(64) };
  const raw = JSON.stringify(state); await fs.writeFile(file, raw); const reopened = new DeliveryRecords(f.root); await expect(reopened.init()).rejects.toThrow(); expect(() => reopened.current('test/repo')).toThrow('unavailable'); expect(await fs.readFile(file, 'utf8')).toBe(raw);
});
it('keeps publication atomic when a session guard loses authority and permits a fresh current owner to retry', async () => {
  const { records, root, record } = await fixture(); const file = path.join(root, 'delivery-records.json'), before = await fs.readFile(file, 'utf8');
  let checks = 0; await expect(records.save('test/repo', 1, { ...content(), outcome: 'Guarded draft' }, 'ceo', () => { if (++checks > 2) throw new HttpError(409, 'Synthetic session ownership lost'); })).rejects.toThrow('ownership lost');
  expect(await fs.readFile(file, 'utf8')).toBe(before); expect(records.current('test/repo')?.sha256).toBe(record.sha256);
  await records.save('test/repo', 1, { ...content(), outcome: 'Fresh owner draft' }, 'ceo'); expect(records.current('test/repo')?.revision).toBe(2);
});
it('does not grant readiness after publication storage fails and leaves the last retained record intact', async () => {
  const { records, root } = await fixture(), file = path.join(root, 'delivery-records.json'), before = await fs.readFile(file, 'utf8');
  const rename = fs.rename.bind(fs); const spy = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => { if (String(args[1]) === file) throw new Error('Synthetic storage failure'); return rename(...args); });
  try { await expect(records.save('test/repo', 1, { ...content(), outcome: 'Unpublished draft' }, 'ceo')).rejects.toThrow('storage failure'); expect(() => records.current('test/repo')).toThrow('unavailable'); expect(await fs.readFile(file, 'utf8')).toBe(before); }
  finally { spy.mockRestore(); }
});
it.each([false, true])('does not allow reviewed slice tasks to widen the declared first journey (taskPlan=%s)', async planned => {
  const data = plannedContent(); data.slice.requirementIds = ['r1']; if (!planned) delete data.taskPlan;
  if(planned){withSyntheticIntegration(data);const {records,record}=await fixture(plannedContent());await expect(records.save('test/repo',1,data,'ceo')).rejects.toThrow('exceeds the declared first journey');expect(records.current('test/repo')?.sha256).toBe(record.sha256);return;}
  const {records}=await fixture(data);await expect(approve(records)).rejects.toThrow('task contracts');expect(()=>records.assertWork('test/repo',13,context)).toThrow('task contracts');
});
it('rejects a first implementation task without accepted slice provenance even after task approval', async () => {
  const data = plannedContent(); data.tasks[0].stage = 'implementation';withSyntheticIntegration(data); const { records } = await fixture(data); await approve(records); await approveTask(records, 11);
  expect(() => records.assertWork('test/repo', 11, context)).toThrow('accepted first slice');
});
it('retains review and acceptance authority only for an exact current revision and clones all views', async () => {
  const { records, record } = await fixture(plannedContent()); await approve(records); await approveTask(records, 11);
  const view = records.current('test/repo')!; view.content.owner = 'changed outside'; view.taskReviews![0].decision = 'rejected';
  expect(records.current('test/repo')?.content.owner).toBe('dev'); expect(records.current('test/repo')?.taskReviews?.[0].decision).toBe('approved');
  const stale = { ...recordReference(record), sha256: 'f'.repeat(64) }; await expect(records.acceptTask('test/repo', stale, 11, taskEvidence, 'qa', context)).rejects.toThrow('changed');
  await expect(records.reviewTask('test/repo', stale, 11, { taskHash: taskScopeHash(record, 11)!, decision: 'approved', notes: review.notes }, 'qa', context)).rejects.toThrow('changed');
  expect(records.current('test/repo')?.taskAcceptances).toEqual([]);
});

it('rejects moving an old hash to another finding with renewed dates',async()=>{
  const f=await reconciliationFixture(),data=structuredClone(f.current.content);
  data.findings[1].evidence=[{...f.original.content.findings[0].evidence[0],reference:'moved.json',expiresAt:new Date(Date.now()+120000).toISOString()}];
  await f.records.save('test/repo',f.current.revision,data,'manager');await approve(f.records);await approveTask(f.records,11);
  const ref=recordReference(f.records.current('test/repo')!);
  await expect(f.records.reconcileTask('test/repo',ref,11,recordReference(f.original),review.notes,'qa',context,f.verify)).rejects.toThrow('timestamps');
  expect(f.verify).not.toHaveBeenCalled();
});
it('rejects evidence that expires while external verification is in flight',async()=>{
  const f=await reconciliationFixture(),before=JSON.stringify(f.records.current('test/repo'));
  const now=Date.now;f.verify.mockImplementationOnce(async()=>{vi.spyOn(Date,'now').mockImplementation(()=>now()+120000);return f.proof;});
  try{await expect(f.reconcile()).rejects.toThrow();expect(JSON.stringify(f.records.current('test/repo'))).toBe(before);}finally{vi.restoreAllMocks();}
});

it('requires original proof after restart and preserves corrupt bytes for inspection',async()=>{
 const f=await reconciliationFixture();await f.reconcile();await f.records.close();
 const file=path.join(f.root,'delivery-records.json'),state=JSON.parse(await fs.readFile(file,'utf8'));
 delete state.records.at(-1).taskAcceptances[0].reconciliation.originalQa;
 const raw=JSON.stringify(state);await fs.writeFile(file,raw);const reopened=new DeliveryRecords(f.root);
 await expect(reopened.init()).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe(raw);
});
it('does not accept an external verifier response without original proof',async()=>{
 const f=await reconciliationFixture();f.verify.mockResolvedValueOnce(undefined as never);
 await expect(f.reconcile()).rejects.toThrow('QA evidence');expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);
});

it.each([false,true])('persists exact Swarm proof with active QA row removed=%s',async removed=>{
 const f=await reconciliationFixture(),{Swarm}=await import('./swarm.ts');
 const qa={...f.proof,repoId:'test/repo',round:3,devAgentId:'dev',testedSha:head};
 const swarm=Object.assign(Object.create(Swarm.prototype),{closed:false,state:{repos:[{id:'test/repo',fullName:'test/repo',defaultBranch:'main'}],qa:removed?[]:[qa]},backend:{demo:false,prDetails:async()=>({number:101,baseRefName:'main',state:'MERGED',headSha:head,mergeCommitSha:taskEvidence.mergeCommitSha,closesIssues:[11]})}}) as InstanceType<typeof Swarm>;
 const updated=await f.records.reconcileTask('test/repo',recordReference(f.current),11,recordReference(f.original),review.notes,'qa',context,(source,receipt)=>swarm.verifyAcceptedTask('test/repo',11,source,receipt,removed?f.proof:undefined));
 expect(updated.taskAcceptances![0].reconciliation!.originalQa).not.toHaveProperty('repoId');
 await f.records.close();const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current('test/repo')!.taskAcceptances).toEqual(updated.taskAcceptances);await reopened.close();
});
it('requires a real original acceptance rather than only an approved historical task',async()=>{
 const f=await fixture(plannedContent());await approve(f.records);await approveTask(f.records,11);const source=f.records.current('test/repo')!;
 const data=structuredClone(source.content);data.findings[0].evidence=[{reference:'new.json',sha256:'d'.repeat(64),observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}];
 await f.records.save('test/repo',source.revision,data,'manager');await approve(f.records);await approveTask(f.records,11);const verify=vi.fn();
 await expect(f.records.reconcileTask('test/repo',recordReference(f.records.current('test/repo')!),11,recordReference(source),review.notes,'qa',context,verify)).rejects.toThrow('Original independent acceptance');expect(verify).not.toHaveBeenCalled();
});

function sourceSyncFinding(){return {id:'canvas-source-sync-failure',area:'authoring' as const,owner:'dev3',status:'observed' as const,critical:true,conclusion:'ready' as const,scope:{kind:'canvas-source-sync' as const,taskIssue:13},statement:'Synthetic source-sync failure resolved with a new observation; original failure remains in history.',remedy:'Require current independent approval and fresh own source capture before authoring.',evidence:[{reference:'fixtures/resolved-source-sync.json',sha256:'e'.repeat(64),observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}]};}
it('reconciles unaffected accepted work across a retained resolved Canvas source-sync failure, with restart-readable proof',async()=>{
 const f=await reconciliationFixture(),blocked=structuredClone(f.current.content),finding=sourceSyncFinding();blocked.findings.push({...finding,conclusion:'blocked'});
 const failed=await f.records.save('test/repo',f.current.revision,blocked,'manager');expect(()=>f.records.assertDiscovery('test/repo',context)).toThrow('canvas-source-sync-failure');
 const resolved=structuredClone(failed.content);resolved.findings.at(-1)!.conclusion='ready';resolved.findings.at(-1)!.evidence=[{...finding.evidence[0],sha256:'f'.repeat(64)}];
 await f.records.save('test/repo',failed.revision,resolved,'manager');await approve(f.records);await approveTask(f.records,11);
 const ref=recordReference(f.records.current('test/repo')!);const reconciled=await f.records.reconcileTask('test/repo',ref,11,recordReference(f.original),review.notes,'qa',context,f.verify);
 expect(reconciled.taskAcceptances![0].headSha).toBe(f.original.taskAcceptances![0].headSha);expect(f.records.view('test/repo').find(r=>r.revision===failed.revision)).toEqual(failed);expect(f.records.view('test/repo').find(r=>r.revision===f.original.revision)).toEqual(f.original);
 await f.records.close();vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current('test/repo')!.taskAcceptances).toEqual(reconciled.taskAcceptances);await reopened.close();
});
it.each(['unscoped','blocked','assumed','stale','future','empty','wrong-owner','security','unknown-task','affected-task','dependency','changed-old-decision','changed-old-critical','changed-old-scope','non-canvas','moved-old-hash'])('rejects unsafe source-sync reconciliation: %s',async variant=>{
 const f=await reconciliationFixture(),current=structuredClone(f.current),added=sourceSyncFinding();current.content.findings.push(added);let issue=11;
 if(variant==='unscoped')delete (added as any).scope;if(variant==='blocked')added.conclusion='blocked' as never;if(variant==='assumed')added.status='assumed' as never;
 if(variant==='stale')added.evidence[0].expiresAt=new Date(Date.now()-1).toISOString();if(variant==='future')added.evidence[0].observedAt=new Date(Date.now()+1000).toISOString();if(variant==='empty')added.evidence=[];
 if(variant==='wrong-owner')added.owner='dev1';if(variant==='security')added.area='security' as never;if(variant==='unknown-task')added.scope.taskIssue=999;
 if(variant==='affected-task'){added.scope.taskIssue=11;added.owner='dev1';}
 if(variant==='dependency'){added.scope.taskIssue=11;added.owner='dev1';issue=12;}
 if(variant==='changed-old-decision')current.content.findings[0].conclusion='blocked';
 if(variant==='changed-old-critical')current.content.findings[0].critical=false;
 if(variant==='changed-old-scope')current.content.findings[0].scope=added.scope;
 if(variant==='non-canvas'){f.original.content.applicationSpec!.components.find(c=>c.id==='c3')!.platform='flow';current.content.applicationSpec!.components.find(c=>c.id==='c3')!.platform='flow';}
 if(variant==='moved-old-hash')added.evidence=[{...f.original.content.findings[0].evidence[0],expiresAt:new Date(Date.now()+120000).toISOString()}];
 expect(()=>assertEvidenceOnlyRevision(f.original,current,issue)).toThrow();
});
it.each(['valid','owner','area','unknown-task','non-canvas','unknown-kind'])('validates the explicit Canvas-only prerequisite finding scope: %s',variant=>{
 const data=plannedContent(),finding=sourceSyncFinding();data.findings.push(finding);
 if(variant==='owner')finding.owner='dev1';if(variant==='area')finding.area='security' as never;if(variant==='unknown-task')finding.scope.taskIssue=999;if(variant==='non-canvas')data.applicationSpec!.components.find(c=>c.id==='c3')!.platform='flow';if(variant==='unknown-kind')finding.scope.kind='arbitrary-failure' as never;
 expect(deliveryRecordContentSchema.safeParse(data).success).toBe(variant==='valid');
});

it('promotes only the exact original accepted merge after fresh review and keeps original QA/history across restart',async()=>{const f=await reconciliationFixture(),data=structuredClone(f.current.content);data.sourceCommit=f.original.taskAcceptances![0].mergeCommitSha;await f.records.save('test/repo',f.current.revision,data,'manager');await expect(f.records.reconcileTask('test/repo',recordReference(f.records.current('test/repo')!),11,recordReference(f.original),review.notes,'qa',context,f.verify)).rejects.toThrow();await approve(f.records);await approveTask(f.records,11);const updated=await f.records.reconcileTask('test/repo',recordReference(f.records.current('test/repo')!),11,recordReference(f.original),review.notes,'qa',context,f.verify);expect(updated.content.sourceCommit).toBe(taskEvidence.mergeCommitSha);expect(updated.taskAcceptances![0].evidenceHash).toBe(f.original.taskAcceptances![0].evidenceHash);expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.original,f.original.taskAcceptances![0]);expect(f.records.view('test/repo').find(r=>r.revision===f.original.revision)).toEqual(f.original);await f.records.close();const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current('test/repo')!.taskAcceptances).toEqual(updated.taskAcceptances);await reopened.close();});
it.each(['other-commit','contract-change','changed-proof'])('rejects unsafe accepted-source promotion: %s',async mode=>{const f=await reconciliationFixture(),data=structuredClone(f.current.content);data.sourceCommit=mode==='other-commit'?'d'.repeat(40):taskEvidence.mergeCommitSha;if(mode==='contract-change')data.taskPlan!.tasks[0].outputs[0]+=' plus unreviewed feature';await f.records.save('test/repo',f.current.revision,data,'manager');await approve(f.records);await approveTask(f.records,11);if(mode==='changed-proof')f.verify.mockResolvedValueOnce({...f.proof,summary:'Different native QA result'});await expect(f.records.reconcileTask('test/repo',recordReference(f.records.current('test/repo')!),11,recordReference(f.original),review.notes,'qa',context,f.verify)).rejects.toThrow();expect(f.records.current('test/repo')!.taskAcceptances).toEqual([]);});

const recoveredApp='11111111-1111-4111-8111-111111111111';
function ownershipFinding(){const base=sourceSyncFinding();return {...base,id:'interrupted-canvas-owner',scope:{kind:'canvas-ownership-recovery' as const,taskIssue:13,environmentUrl:context.environmentUrl,appId:recoveredApp,leaseOwner:'dev3',method:'original-token-release' as const,remoteStudioUnlock:false as const,releasedAt:new Date(Date.now()-2000).toISOString(),releaseEvidenceSha256:base.evidence[0].sha256},statement:'Original-token local lease release observed; independent review must inspect the exact release receipt. No new lease, provider mutation or authoring/runtime approval.'};}
async function ownershipFixture(){const data=plannedContent();data.taskPlan!.tasks.find(t=>t.issue===13)!.resources=[`canvas_${recoveredApp}`];return reconciliationFixture(data);}
it('preserves unrelated accepted work through a resolved ownership failure only after fresh reviews, and retains proof across restart',async()=>{
 const f=await ownershipFixture(),blocked=structuredClone(f.current.content),finding=ownershipFinding();blocked.findings.push({...finding,scope:undefined,status:'unresolved',conclusion:'blocked'});const failed=await f.records.save('test/repo',f.current.revision,blocked,'manager');
 expect(failed.taskAcceptances).toEqual([]);expect(()=>f.records.assertDiscovery('test/repo',context)).toThrow('interrupted-canvas-owner');
 const resolved=structuredClone(failed.content);resolved.findings[resolved.findings.length-1]=finding;resolved.sourceCommit=taskEvidence.mergeCommitSha;await f.records.save('test/repo',failed.revision,resolved,'manager');
 const reconcile=()=>f.records.reconcileTask('test/repo',recordReference(f.records.current('test/repo')!),11,recordReference(f.original),review.notes,'qa',context,f.verify);
 await expect(reconcile()).rejects.toThrow();expect(f.verify).not.toHaveBeenCalled();await approve(f.records);await expect(reconcile()).rejects.toThrow();await approveTask(f.records,11);const result=await reconcile();
 expect(result.taskAcceptances).toHaveLength(1);expect(result.taskAcceptances![0]).toMatchObject({...taskEvidence,evidenceHash:f.original.taskAcceptances![0].evidenceHash,reviewer:'qa'});expect(f.verify).toHaveBeenCalledExactlyOnceWith(f.original,f.original.taskAcceptances![0]);
 expect(()=>f.records.assertWork('test/repo',13,context)).toThrow();expect(f.records.view('test/repo').find(r=>r.revision===failed.revision)).toEqual(failed);expect(f.records.view('test/repo').find(r=>r.revision===f.original.revision)).toEqual(f.original);
 await f.records.close();vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current('test/repo')!.taskAcceptances).toEqual(result.taskAcceptances);await reopened.close();
});
it.each(['unscoped','blocked','assumed','stale-proof','future-proof','missing-proof','other-fresh-evidence','wrong-hash','duplicate-proof','wrong-owner','wrong-lease-owner','wrong-app','wrong-environment','credentials','non-root-url','http','wrong-method','remote-unlock','future-release','security','unknown-task','accepted-task','dependency','shared-resource','non-canvas','changed-contract','changed-original-decision'] as const)('rejects unsafe ownership recovery: %s',async mode=>{
 const f=await ownershipFixture(),current=structuredClone(f.current),finding=ownershipFinding();current.content.findings.push(finding);let issue=11;
 if(mode==='unscoped')delete (finding as any).scope;if(mode==='blocked')finding.conclusion='blocked' as never;if(mode==='assumed')finding.status='assumed' as never;
 if(mode==='stale-proof'||mode==='other-fresh-evidence')finding.evidence[0].expiresAt=new Date(Date.now()-1).toISOString();if(mode==='other-fresh-evidence')finding.evidence.push({...sourceSyncFinding().evidence[0],sha256:'f'.repeat(64)});
 if(mode==='future-proof')finding.evidence[0].observedAt=new Date(Date.now()+1000).toISOString();if(mode==='missing-proof')finding.evidence=[];if(mode==='wrong-hash')finding.scope.releaseEvidenceSha256='f'.repeat(64);if(mode==='duplicate-proof')finding.evidence.push({...finding.evidence[0]});
 if(mode==='wrong-owner')finding.owner='dev1';if(mode==='wrong-lease-owner')finding.scope.leaseOwner='dev1';if(mode==='wrong-app')finding.scope.appId='22222222-2222-4222-8222-222222222222';if(mode==='wrong-environment')finding.scope.environmentUrl='https://other.crm.dynamics.com';if(mode==='credentials')finding.scope.environmentUrl='https://user:secret@example.crm.dynamics.com';if(mode==='non-root-url')finding.scope.environmentUrl=context.environmentUrl+'/other';if(mode==='http')finding.scope.environmentUrl=context.environmentUrl.replace('https:','http:');
 if(mode==='wrong-method')finding.scope.method='force-unlock' as never;if(mode==='remote-unlock')finding.scope.remoteStudioUnlock=true as never;if(mode==='future-release')finding.scope.releasedAt=new Date(Date.now()+2000).toISOString();
 if(mode==='security')finding.area='security' as never;if(mode==='unknown-task')finding.scope.taskIssue=999;if(mode==='accepted-task'||mode==='dependency'){finding.scope.taskIssue=11;finding.owner='dev1';finding.scope.leaseOwner='dev1';if(mode==='dependency')issue=12;}
 if(mode==='shared-resource'){for(const r of [f.original,current])r.content.taskPlan!.tasks.find(t=>t.issue===11)!.resources=[`canvas_${recoveredApp}`];}
 if(mode==='non-canvas'){for(const r of [f.original,current])r.content.applicationSpec!.components.find(c=>c.id==='c3')!.platform='flow';}
 if(mode==='changed-contract')current.content.taskPlan!.tasks[0].outputs.push('Changed implementation');if(mode==='changed-original-decision')current.content.findings[0].conclusion='blocked';
 expect(()=>assertEvidenceOnlyRevision(f.original,current,issue)).toThrow();expect(f.verify).not.toHaveBeenCalled();
});
it.each(['valid','wrong-resource','wrong-environment','wrong-lease-owner','missing-proof','wrong-method','remote-unlock'] as const)('validates ownership recovery scope before storing a proposed plan: %s',mode=>{
 const data=plannedContent(),finding=ownershipFinding();data.taskPlan!.tasks.find(t=>t.issue===13)!.resources=[`canvas_${recoveredApp}`];data.findings.push(finding);
 if(mode==='wrong-resource')finding.scope.appId='22222222-2222-4222-8222-222222222222';if(mode==='wrong-environment')finding.scope.environmentUrl='https://other.test';if(mode==='wrong-lease-owner')finding.scope.leaseOwner='dev1';if(mode==='missing-proof')finding.evidence=[];if(mode==='wrong-method')finding.scope.method='manual-deletion' as never;if(mode==='remote-unlock')finding.scope.remoteStudioUnlock=true as never;
 expect(deliveryRecordContentSchema.safeParse(data).success).toBe(mode==='valid');
});
it('withholds reconciliation when the specific recovery evidence expires during original PR verification',async()=>{
 const f=await ownershipFixture(),data=structuredClone(f.current.content);data.findings.push(ownershipFinding());await f.records.save('test/repo',f.current.revision,data,'manager');await approve(f.records);await approveTask(f.records,11);const before=f.records.current('test/repo')!;
 const now=Date.now();f.verify.mockImplementationOnce(async()=>{vi.spyOn(Date,'now').mockReturnValue(now+120000);return f.proof;});await expect(f.records.reconcileTask('test/repo',recordReference(before),11,recordReference(f.original),review.notes,'qa',context,f.verify)).rejects.toThrow();expect(f.records.current('test/repo')).toEqual(before);
});
