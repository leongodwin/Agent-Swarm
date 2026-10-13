import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import crypto from 'node:crypto';
import {HldSynthesisService,type SynthesisDependencies} from './hldSynthesis.ts';
import {synthesisRequirements} from './synthesisTraceability.ts';
import type {SessionCallbacks,SessionOptions} from './agentRunner.ts';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.useRealTimers();for(const close of cleanup.splice(0))await close();});
const input={solutionName:'Synthetic expense design',problemContext:'Capture GBP expenses with a receipt for each item.',components:[]};
const detail='Synthetic explicit design decision with independently observable acceptance evidence.';
const output={summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],requirements:synthesisRequirements(input).map(source=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['data'],requirement:detail,design:detail,acceptance:detail})),missingEvidence:['Tenant validation remains unavailable.'],implementationPlan:['data','app','verify'].map(id=>({id,title:id,deliverables:['Synthetic artifact'],acceptance:[detail]})),mermaidDiagrams:{topology:'flowchart LR\n A-->B',erd:'erDiagram\n REPORT ||--o{ ITEM : contains',sequence:'sequenceDiagram\n A->>B: Submit'}};
async function fixture(admission:SynthesisDependencies['admission']=async()=>null){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hld-synthesis-')),checkout=path.join(root,'repo');await fs.mkdir(checkout);
  let fingerprint='original';let callbacks!:SessionCallbacks;
  const stop=vi.fn(),start=vi.fn((_options:SessionOptions,cb:SessionCallbacks)=>{callbacks=cb;return {stop,send:vi.fn()};});
  const lease={running:vi.fn(),stopping:vi.fn(),release:vi.fn()};
  const deps:SynthesisDependencies={reserve:()=>lease,assertOpen:()=>{},context:()=>({checkoutPath:checkout,fingerprint,copilotPaused:true,skills:[{id:'dataverse:dv-metadata',sha256:'a'.repeat(64),toolStatus:'unverified'}]}),admission,start};
  const service=new HldSynthesisService(root,deps);await service.init();
  cleanup.push(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  return {service,root,checkout,start,stop,deps,lease,get callbacks(){return callbacks;},change:()=>{fingerprint='changed';}};
}
const success=(structured:unknown=output)=>({ok:true,text:'',structured,costUsd:0.01,turns:1,errors:[]});
it('requires component/deliverable coverage before publishing a model draft',async()=>{
  const f=await fixture(),brief={...input,components:[{title:'Expense Canvas',role:'Maker',badge:'Canvas',details:'Capture GBP expenses and every receipt.',deliverables:['Expense.msapp','Deployment runbook']}]};
  const job=await f.service.start('synthetic/project',brief);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());expect(f.start.mock.calls[0][0].prompt).toContain('component-1-deliverable-2');f.callbacks.finished(success());
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(f.service.view('synthetic/project',job.id)[0].error).toContain('every declared requirement');expect(await fs.readdir(f.checkout)).toEqual([]);
  const retry=await f.service.start('synthetic/project',brief);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledTimes(2));f.callbacks.finished(success({...output,requirements:synthesisRequirements(brief).map(source=>({...output.requirements[0],requirementId:source.id,sourceSha256:source.sourceSha256}))}));
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',retry.id)[0].status).toBe('completed'));const artifact=await f.service.result('synthetic/project',retry.id);expect(artifact.result.markdownContent).toContain('Declared-source traceability');expect(artifact.result.markdownContent).toContain('component-1-deliverable-2: Deployment runbook');
});
it('rejects an oversized requirement catalogue before reserving a model session',async()=>{
  const f=await fixture(),reserve=vi.spyOn(f.deps,'reserve'),file=path.join(f.root,'architecture-synthesis.json'),before=await fs.readFile(file,'utf8');
  const components=Array.from({length:10},()=>({title:'Synthetic',role:'Maker',badge:'Canvas',details:'Bounded synthetic scope',deliverables:Array.from({length:100},()=> 'Artifact')}));
  await expect(f.service.start('synthetic/project',{...input,components})).rejects.toThrow('1,000');expect(reserve).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();expect(await fs.readFile(file,'utf8')).toBe(before);expect(f.service.view('synthetic/project')).toEqual([]);
});
it('runs structured model synthesis with no tool authority and retains a validated version across restart',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);
  await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const options=f.start.mock.calls[0][0];expect(options).toMatchObject({noTools:true,browserTesting:false,additionalDirectories:[],model:'',keepAlive:false});expect(await options.authorizeTool!()).toContain('no runtime tool authority');expect(options.prompt).toContain('dataverse:dv-metadata');expect(options.prompt).toContain('copilotStudioPaused');
  expect(options.outputSchema?.$schema).toBe('http://json-schema.org/draft-07/schema#');
  f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));
  const artifact=await f.service.result('synthetic/project',job.id);expect(artifact.result.generationMethod).toBe('model-synthesis');expect(artifact.result.synthesis?.jobId).toBe(job.id);expect(artifact.result.status).toBe('draft');expect(artifact.result.markdownContent).toContain('Requirements and acceptance');expect(artifact.result.missingEvidence.join(' ')).toContain('Independent architecture approval');
  await f.service.close();const restored=new HldSynthesisService(f.root,f.deps);await restored.init();expect((await restored.result('synthetic/project',job.id)).sha256).toBe(artifact.sha256);await restored.close();
});
it('does not start a model for blocked readiness and does not invent a template response',async()=>{
  const f=await fixture(async()=> 'Synthetic authentication unavailable');const job=await f.service.start('synthetic/project',input);
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('blocked'));expect(f.start).not.toHaveBeenCalled();await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('no completed');
});
it('reports an unauthenticated native model as blocked and retains its actionable reason',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.callbacks.finished({...success(),ok:false,errors:['Not logged in · Please run /login']});
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('blocked'));
  expect(f.service.view('synthetic/project',job.id)[0].error).toContain('Not logged in');expect(await fs.readdir(f.checkout)).toEqual([]);
});
it.each([undefined,{...output,summary:''}])('rejects absent or malformed structured output without publishing a fallback',async structured=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());f.callbacks.finished({...success(),structured});
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(f.service.view('synthetic/project',job.id)[0].costUsd).toBe(0.01);expect(await fs.readdir(f.checkout)).toEqual([]);
});
it('denies concurrent model jobs and late output from cancelled ownership',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  await expect(f.service.start('other/project',input)).rejects.toThrow('already running');expect(()=>f.service.cancel('other/project',job.id)).toThrow('outside this project');
  f.service.cancel('synthetic/project',job.id);f.callbacks.finished(success());await f.service.close();expect(f.stop).toHaveBeenCalledOnce();expect(await fs.readdir(f.checkout)).toEqual([]);expect(f.service.view('synthetic/project',job.id)[0].status).toBe('cancelled');
});
it('keeps cancelled capacity occupied until the exact model callback acknowledges completion',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.service.cancel('synthetic/project',job.id);expect(f.lease.stopping).toHaveBeenCalledOnce();expect(f.lease.release).not.toHaveBeenCalled();
  expect(f.service.view('synthetic/project',job.id)[0].runtimeCleanup).toBe('awaiting-completion');await expect(f.service.start('synthetic/project',input)).rejects.toThrow('already running');
  f.callbacks.finished(success());expect(f.lease.release).toHaveBeenCalledOnce();expect(f.service.view('synthetic/project',job.id)[0].runtimeCleanup).toBe('released');f.callbacks.finished(success());expect(f.lease.release).toHaveBeenCalledOnce();
});
it('preserves and denies a cold restart with unacknowledged model cleanup',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());f.service.cancel('synthetic/project',job.id);await f.service.close();
  const file=path.join(f.root,'architecture-synthesis.json'),before=await fs.readFile(file,'utf8');const restored=new HldSynthesisService(f.root,f.deps);
  await expect(restored.init()).rejects.toThrow('lacks completion acknowledgement');expect(restored.pendingCleanup()).toEqual([{jobId:job.id,repoId:'synthetic/project',reservedAt:job.startedAt}]);
  await restored.close();expect(await fs.readFile(file,'utf8')).toBe(before);
});
it('denies changed project or skill scope before publishing the model result',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());f.change();f.callbacks.finished(success());
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(await fs.readdir(f.checkout)).toEqual([]);
});
it('bounds readiness by the entire five-minute deadline and ignores a late result',async()=>{
  let complete!:(value:null)=>void;const f=await fixture(()=>new Promise(resolve=>{complete=resolve;}));vi.useFakeTimers();
  const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
  await vi.advanceTimersByTimeAsync(300000);complete(null);vi.useRealTimers();await f.service.close();
  expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed');expect(f.start).not.toHaveBeenCalled();
});
it('cancels pending admission at shutdown and restores the interrupted job as blocked',async()=>{
  let complete!:(value:null)=>void;const f=await fixture(()=>new Promise(resolve=>{complete=resolve;}));const job=await f.service.start('synthetic/project',input);
  await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));await f.service.close();complete(null);
  expect(f.start).not.toHaveBeenCalled();const restored=new HldSynthesisService(f.root,f.deps);await restored.init();expect(restored.view('synthetic/project',job.id)[0].status).toBe('blocked');await restored.close();
});
it('denies a running model after the deadline even if its late response is valid',async()=>{
  const f=await fixture();vi.useFakeTimers();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(300000);f.callbacks.finished(success());vi.useRealTimers();await f.service.close();
  expect(f.stop).toHaveBeenCalledOnce();expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed');expect(await fs.readdir(f.checkout)).toEqual([]);
});
it('preserves corrupted persisted state instead of replacing it with an empty job list',async()=>{
  const f=await fixture();await f.service.close();const file=path.join(f.root,'architecture-synthesis.json');await fs.writeFile(file,'broken');
  const restored=new HldSynthesisService(f.root,f.deps);await expect(restored.init()).rejects.toThrow('preserve and repair');await restored.close();expect(await fs.readFile(file,'utf8')).toBe('broken');
});
it('denies altered saved model artifacts when a completed job is loaded',async()=>{
  const f=await fixture();const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());f.callbacks.finished(success());
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));const docId=f.service.view('synthetic/project',job.id)[0].result!.docId;
  await fs.appendFile(path.join(f.checkout,'docs','architecture','drafts',`${docId}.md`),'Changed');await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('Markdown differs');
});
it.each(['deadline','clock-backwards'] as const)('denies a completion boundary race and restores its failed record: %s',async mode=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const clock=vi.spyOn(Date,'now').mockReturnValue(job.startedAt+299999),original=f.deps.context;let afterPublication=0;
  f.deps.context=id=>{const context=original(id);if(existsSync(path.join(f.checkout,'docs','architecture','drafts','current.json'))&&++afterPublication===2)clock.mockReturnValue(mode==='deadline'?job.startedAt+300000:job.startedAt-1);return context;};
  try{f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));const failed=f.service.view('synthetic/project',job.id)[0];expect(afterPublication).toBe(2);expect(failed.result).toBeUndefined();expect(failed.error).toContain('completion missed');expect(failed.runtimeCleanup).toBe('released');await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('no completed');}
  finally{clock.mockRestore();f.deps.context=original;}
  await f.service.close();const restored=new HldSynthesisService(f.root,f.deps);try{await restored.init();expect(restored.view('synthetic/project',job.id)[0].status).toBe('failed');expect(restored.summary('synthetic/project').successfulDurationMs.count).toBe(0);}finally{await restored.close();}
});
it('retains older failed jobs beyond the recent 30-job response and across restart',async()=>{
  const f=await fixture(async()=> 'Synthetic authentication blocker');let first='';
  for(let i=0;i<31;i++){const job=await f.service.start('synthetic/project',input);if(!i)first=job.id;await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('blocked'));}
  expect(f.service.view('synthetic/project')).toHaveLength(30);expect(f.service.view('synthetic/project',first)[0].status).toBe('blocked');expect(f.service.summary('synthetic/project').recorded.blocked).toBe(31);expect(f.service.summary('other/project').recorded.blocked).toBe(0);
  const marker=f.service.summary('synthetic/project').coverageStartedAt;await f.service.close();const saved=JSON.parse(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8'));expect(saved.jobs).toHaveLength(31);
  const restored=new HldSynthesisService(f.root,f.deps);try{await restored.init();expect(restored.summary('synthetic/project').coverageStartedAt).toBe(marker);expect(restored.view('synthetic/project',first)).toHaveLength(1);}finally{await restored.close();}
});
it.each(['count','bytes'] as const)('preserves a full history and refuses admission before reserving capacity: %s',async mode=>{
  const f=await fixture();await f.service.close();const file=path.join(f.root,'architecture-synthesis.json'),now=Date.now();
  const job={id:crypto.randomUUID(),repoId:'synthetic/project',status:'blocked',runtime:'codex-cli',runtimeCleanup:'released',startedAt:now,endedAt:now,elapsedMs:0,deadlineMs:300000,costUsd:0,turns:0,events:mode==='bytes'?Array.from({length:100},()=>({at:now,kind:'progress',text:'x'.repeat(1000)})):[]};
  const saved=JSON.stringify({schemaVersion:1,historyStartedAt:now,jobs:Array.from({length:mode==='count'?1000:36},()=>({...job,id:crypto.randomUUID()}))});await fs.writeFile(file,saved);const reserve=vi.fn(f.deps.reserve),restored=new HldSynthesisService(f.root,{...f.deps,reserve});
  try{await restored.init();const before=await fs.readFile(file,'utf8');await expect(restored.start('synthetic/project',input)).rejects.toThrow('retention is full');expect(reserve).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();expect(await fs.readFile(file,'utf8')).toBe(before);}finally{await restored.close();}
});
