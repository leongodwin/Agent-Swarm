import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
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
const output={skillBindings:[{skillId:'dataverse:dv-metadata',sourceSha256:'a'.repeat(64),planStepIds:['data'],rationale:detail,toolStatus:'unverified' as const}],summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],requirements:synthesisRequirements(input).map(source=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['data'],requirement:detail,design:detail,acceptance:detail})),missingEvidence:['Tenant validation remains unavailable.'],implementationPlan:['data','app','verify'].map(id=>({id,title:id,deliverables:['Synthetic artifact'],acceptance:[detail]})),mermaidDiagrams:{topology:'flowchart LR\n A-->B',erd:'erDiagram\n REPORT ||--o{ ITEM : contains',sequence:'sequenceDiagram\n A->>B: Submit'}};
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
it('does not restore a completed candidate while its publication acknowledgement is pending',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());const rename=fs.rename.bind(fs);let held=false,release!:()=>void;const pending=new Promise<void>(done=>{release=done;});
  const spy=vi.spyOn(fs,'rename').mockImplementation(async(...args:Parameters<typeof fs.rename>)=>{if(!held&&String(args[1])===path.join(f.root,'architecture-synthesis.json')&&JSON.parse(await fs.readFile(args[0],'utf8')).jobs.some((row:any)=>row.id===job.id&&row.status==='completed')){await rename(...args);held=true;await pending;return;}return rename(...args);});
  try{f.callbacks.finished(success());await vi.waitFor(()=>expect(held).toBe(true));const bytes=await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8');expect(JSON.parse(bytes).jobs[0]).toMatchObject({status:'completed',runtimeCleanup:'awaiting-completion'});const restored=new HldSynthesisService(f.root,f.deps);try{await expect(restored.init()).rejects.toThrow('for runtime or publication');expect(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8')).toBe(bytes);}finally{await restored.close();}release();await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));await f.service.close();expect(f.lease.release).toHaveBeenCalledOnce();}finally{release();spy.mockRestore();}
});
it('does not certify completion when runtime shutdown throws after the completion commit',async()=>{const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());f.stop.mockImplementation(()=>{throw new Error('Synthetic stop failure');});f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(f.service.view('synthetic/project',job.id)[0].result).toBeUndefined();expect(f.service.summary('synthetic/project').successfulDurationMs.count).toBe(0);await f.service.close();const saved=JSON.parse(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8')).jobs[0];expect(saved.status).toBe('failed');expect(saved.result).toBeUndefined();});
it.each(['success','expired','cancelled','scope'] as const)('retains ownership and denies premature completion through a held publication commit: %s',async mode=>{
  const mono=vi.spyOn(performance,'now').mockReturnValue(1000),f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const write=fs.writeFile.bind(fs);let held=false,release!:()=>void;const pending=new Promise<void>(done=>{release=done;});
  const spy=vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{if(!held&&String(args[0]).includes('architecture-synthesis.json.')&&JSON.parse(String(args[1])).jobs.some((row:any)=>row.id===job.id&&row.status==='completed')){held=true;await pending;}return write(...args);});
  try{
    f.callbacks.finished(success());await vi.waitFor(()=>expect(held).toBe(true));expect(f.service.view('synthetic/project',job.id)[0].status).toBe('saving');expect(f.lease.release).not.toHaveBeenCalled();await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('no completed');await expect(f.service.start('synthetic/project',input)).rejects.toThrow('already running');
    if(mode==='expired')mono.mockReturnValue(301000);if(mode==='scope')f.change();if(mode==='cancelled'){f.service.cancel('synthetic/project',job.id);expect(f.lease.release).not.toHaveBeenCalled();await expect(f.service.start('synthetic/project',input)).rejects.toThrow('cleanup remains unverified');}
    release();await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe(mode==='success'?'completed':mode==='cancelled'?'cancelled':'failed'));await f.service.close();expect(f.lease.release).toHaveBeenCalledOnce();
    const saved=JSON.parse(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8')).jobs[0];expect(saved.status).toBe(mode==='success'?'completed':mode==='cancelled'?'cancelled':'failed');expect(saved.runtimeCleanup).toBe('released');if(mode!=='success')expect(saved.result).toBeUndefined();
  }finally{release();spy.mockRestore();mono.mockRestore();}
});
it.each(['expired','backwards'] as const)('rejects an %s monotonic clock while wall-clock elapsed remains below the deadline',async mode=>{
  const mono=vi.spyOn(performance,'now').mockReturnValue(1000),wall=vi.spyOn(Date,'now').mockReturnValue(2000000);const f=await fixture();
  try{const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());wall.mockReturnValue(job.startedAt+1000);mono.mockReturnValue(mode==='expired'?301001:999);f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(f.service.view('synthetic/project',job.id)[0].result).toBeUndefined();expect(f.service.summary('synthetic/project').successfulDurationMs.count).toBe(0);}finally{mono.mockRestore();wall.mockRestore();}
});
it('records and restores monotonic timing despite a different wall-clock duration',async()=>{
  const mono=vi.spyOn(performance,'now').mockReturnValue(1000),wall=vi.spyOn(Date,'now').mockReturnValue(2000000);const f=await fixture();
  try{const job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());wall.mockReturnValue(job.startedAt+1000);mono.mockReturnValue(131000);f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));await f.service.close();expect(f.service.view('synthetic/project',job.id)[0]).toMatchObject({elapsedMs:1000,monotonicElapsedMs:130000});const restored=new HldSynthesisService(f.root,f.deps);try{await restored.init();expect(restored.summary('synthetic/project').successfulDurationMs.median).toBe(130000);expect(restored.summary('synthetic/project').durationCoverage).toEqual({monotonic:1,wallClockOnly:0});}finally{await restored.close();}}finally{mono.mockRestore();wall.mockRestore();}
});
it('rejects a monotonic deadline crossed at the final completion boundary',async()=>{
  const mono=vi.spyOn(performance,'now').mockReturnValue(1000),f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());const original=f.deps.context;let published=0;
  f.deps.context=id=>{const context=original(id);if(existsSync(path.join(f.checkout,'docs','architecture','drafts','current.json'))&&++published===2)mono.mockReturnValue(301000);return context;};
  try{f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));const failed=f.service.view('synthetic/project',job.id)[0];expect(failed.error).toMatch(/deadline|clock|completion missed/);expect(failed.result).toBeUndefined();expect(failed.monotonicElapsedMs).toBe(300000);}finally{mono.mockRestore();f.deps.context=original;}
});
it('coalesces a blocked-disk progress burst and ignores logs after runtime completion while preserving the final artifact',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const original=fs.writeFile.bind(fs);let writes=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const spy=vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{if(String(args[0]).includes('architecture-synthesis.json.')&&String(args[0]).endsWith('.tmp')){writes++;if(writes===1)await held;}return original(...args);});
  try{
    for(let i=0;i<1000;i++)f.callbacks.log([{kind:'system',text:`Progress ${i}`}]);await vi.waitFor(()=>expect(writes).toBe(1));
    expect(f.service.view('synthetic/project',job.id)[0].events.at(-1)?.text).toBe('Progress 999');
    f.callbacks.finished(success());for(let i=0;i<1000;i++)f.callbacks.log([{kind:'system',text:`Late ignored ${i}`}]);release();
    await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));await f.service.close();
    expect(writes).toBeLessThanOrEqual(6);const stored=JSON.parse(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8'));expect(stored.jobs[0]).toMatchObject({status:'completed',runtimeCleanup:'released'});expect(stored.jobs[0].events.some((event:any)=>event.text==='Progress 999')).toBe(true);expect(stored.jobs[0].events.some((event:any)=>event.text.startsWith('Late ignored'))).toBe(false);
    expect(await fs.readdir(path.join(f.checkout,'docs','architecture','drafts'))).toContain('current.json');expect(f.lease.release).toHaveBeenCalledOnce();
  }finally{release();spy.mockRestore();}
});
it('closes synthesis after progress persistence failure and retains runtime ownership until completion acknowledgement',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const original=fs.writeFile.bind(fs);let rejected=false;
  const spy=vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{if(!rejected&&String(args[0]).includes('architecture-synthesis.json.')){rejected=true;throw new Error('private disk failure');}return original(...args);});
  try{
    f.callbacks.log([{kind:'system',text:'Synthetic progress'}]);await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(f.stop).toHaveBeenCalledOnce();expect(f.lease.stopping).toHaveBeenCalledOnce();expect(f.lease.release).not.toHaveBeenCalled();
    expect(f.service.view('synthetic/project',job.id)[0].error).not.toContain('private');await expect(f.service.start('synthetic/project',input)).rejects.toThrow('closed');
    f.callbacks.finished(success());await vi.waitFor(()=>expect(f.lease.release).toHaveBeenCalledOnce());await f.service.close();const stored=JSON.parse(await fs.readFile(path.join(f.root,'architecture-synthesis.json'),'utf8'));expect(stored.jobs[0]).toMatchObject({status:'failed',runtimeCleanup:'released'});
  }finally{spy.mockRestore();}
});
it('denies invented skill bindings before publication and saves validated guidance for independent review',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.callbacks.finished(success({...output,skillBindings:[{...output.skillBindings[0],skillId:'invented-skill'}]}));await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));expect(await fs.readdir(f.checkout)).toEqual([]);
  const next=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledTimes(2));f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',next.id)[0].status).toBe('completed'));const saved=await f.service.result('synthetic/project',next.id);expect(saved.result.markdownContent).toContain('Selected installed skill guidance');expect(saved.result.markdownContent).toContain('Runtime tool/tenant availability: unverified');
});
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
  expect(f.service.view('synthetic/project',job.id)[0].runtimeCleanup).toBe('awaiting-completion');await expect(f.service.start('synthetic/project',input)).rejects.toThrow('cleanup remains unverified');
  f.callbacks.finished(success());expect(f.lease.release).toHaveBeenCalledOnce();expect(f.service.view('synthetic/project',job.id)[0].runtimeCleanup).toBe('released');f.callbacks.finished(success());expect(f.lease.release).toHaveBeenCalledOnce();
});
it('quarantines a closed launcher when process-family cleanup was not verified',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.callbacks.finished({...success(),ok:false,cleanupVerified:false,errors:['Process-tree stop failed']});
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));
  expect(f.lease.release).not.toHaveBeenCalled();expect(f.service.view('synthetic/project',job.id)[0].runtimeCleanup).toBe('awaiting-completion');
  await expect(f.service.start('synthetic/project',input)).rejects.toThrow('cleanup remains unverified');
  await f.service.close();const restored=new HldSynthesisService(f.root,f.deps);await expect(restored.init()).rejects.toThrow('lacks completion acknowledgement');await restored.close();
});
it('rejects successful output with unverified cleanup and ignores duplicate completion acknowledgements',async()=>{
  const f=await fixture(),job=await f.service.start('synthetic/project',input);await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  f.callbacks.finished({...success(),cleanupVerified:false});f.callbacks.finished(success());f.callbacks.log([{kind:'system',text:'Late completion progress'}]);
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));
  const saved=f.service.view('synthetic/project',job.id)[0];expect(saved.error).toContain('draft publication is blocked');expect(saved.runtimeCleanup).toBe('awaiting-completion');expect(saved.events.some(event=>event.text==='Late completion progress')).toBe(false);
  expect(f.lease.release).not.toHaveBeenCalled();expect(await fs.readdir(f.checkout)).toEqual([]);await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('no completed');
  f.callbacks.finished(success());expect(f.lease.release).not.toHaveBeenCalled();await expect(f.service.start('synthetic/project',input)).rejects.toThrow('cleanup remains unverified');
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
  try{f.callbacks.finished(success());await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('failed'));const failed=f.service.view('synthetic/project',job.id)[0];expect(afterPublication).toBeGreaterThanOrEqual(2);expect(failed.result).toBeUndefined();expect(failed.error).toMatch(/deadline|clock|completion missed/);expect(failed.runtimeCleanup).toBe('released');await expect(f.service.result('synthetic/project',job.id)).rejects.toThrow('no completed');}
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
