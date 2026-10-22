import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import type {SessionOptions,SessionResult} from './agentRunner.ts';
const native=vi.hoisted(()=>({spawn:vi.fn(),commandFor:vi.fn(()=>({file:'synthetic-codex',args:[]} as {file:string;args:string[]}|null))}));
vi.mock('node:child_process',()=>({spawn:native.spawn}));
vi.mock('./clis.ts',()=>({commandFor:native.commandFor}));
import {startCodexPlanning} from './codexPlanning.ts';
import {HldSynthesisService} from './hldSynthesis.ts';
const options:SessionOptions={cwd:process.cwd(),prompt:'Synthetic requirements',systemAppend:'No tools',model:'',effort:'medium',browserTesting:false,additionalDirectories:[],role:'dev',noTools:true,outputSchema:{type:'object'}};
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks();native.commandFor.mockReset().mockReturnValue({file:'synthetic-codex',args:[]});});
function fixture(override:Partial<SessionOptions>={}){
  const proc=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
  native.spawn.mockReturnValue(proc);let finished!:(value:SessionResult)=>void;const result=new Promise<SessionResult>(resolve=>{finished=resolve;});
  const callback=vi.fn(finished),log=vi.fn(),request={...options,...override};const handle=startCodexPlanning(request,{log,tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:callback});
  return {proc,result,handle,callback,log,request};
}
it('waits for the Windows tree-stop helper and quarantines a failed stop after launcher close',async()=>{
  vi.spyOn(process,'platform','get').mockReturnValue('win32');const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  Object.assign(run.proc,{pid:12345});const helper=new EventEmitter();native.spawn.mockReturnValueOnce(helper);
  run.handle.stop();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledTimes(2));
  expect(native.spawn.mock.calls[1]).toEqual(['taskkill',['/PID','12345','/T','/F'],{windowsHide:true,stdio:'ignore',shell:false}]);
  run.proc.emit('close',null);await Promise.resolve();expect(run.callback).not.toHaveBeenCalled();helper.emit('close',1);
  expect(await run.result).toMatchObject({ok:false,cleanupVerified:false});expect(run.callback).toHaveBeenCalledOnce();
});
it('streams bounded status metadata before close without exposing native reasoning, prompt or draft text',async()=>{
  const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  run.proc.stdout.write(JSON.stringify({type:'thread.started',thread_id:'private-session'})+'\n'+JSON.stringify({type:'turn.started'})+'\n'+JSON.stringify({type:'item.completed',item:{type:'reasoning',text:'private native reasoning'}})+'\n');
  expect(run.log.mock.calls.flatMap(([entries])=>entries).map(entry=>entry.text)).toEqual(['Codex planning session opened','Codex architecture generation in progress']);expect(run.callback).not.toHaveBeenCalled();
  run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"draft":"private draft"}'}})+'\n');expect(JSON.stringify(run.log.mock.calls)).not.toContain('private');expect(run.callback).not.toHaveBeenCalled();run.proc.emit('close',0);expect(await run.result).toMatchObject({ok:true,structured:{draft:'private draft'}});
  const calls=run.log.mock.calls.length;run.proc.stdout.write(JSON.stringify({type:'turn.started'})+'\n');expect(run.log).toHaveBeenCalledTimes(calls);
});
it.each(['invalid-json','invalid-event','forbidden-start'] as const)('stops on %s streaming evidence before process close while retaining completion ownership',async mode=>{
  const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  const line=mode==='invalid-json'?'private malformed JSON':mode==='invalid-event'?'null':JSON.stringify({type:'item.started',item:{type:'command_execution',command:'private forbidden command'}});
  expect(()=>run.proc.stdout.write(line+'\n')).not.toThrow();expect(run.proc.kill).toHaveBeenCalledOnce();expect(run.callback).not.toHaveBeenCalled();run.proc.emit('close',0);const value=await run.result;expect(value.ok).toBe(false);expect(JSON.stringify(value.errors)).not.toContain('private');expect(run.callback).toHaveBeenCalledOnce();
});
it('accepts a final unterminated event line and isolates a rejected progress consumer',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),run=fixture();run.log.mockImplementation(()=>{throw new Error('private progress callback');});await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}}));run.proc.emit('close',0);expect(await run.result).toMatchObject({ok:true,structured:{}});expect(warn).toHaveBeenCalledOnce();expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});
it('launches without shell interpolation or inherited project config and parses the structured final response',async()=>{
  const {proc,result}=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  const [file,args,config]=native.spawn.mock.calls[0];expect(file).toBe('synthetic-codex');expect(config).toMatchObject({shell:false,windowsHide:true});expect(config.cwd).not.toBe(options.cwd);
  expect(args).toContain('--ignore-user-config');expect(args).toContain('--ignore-rules');expect(args).toContain('read-only');expect(args).toContain('shell_tool');expect(args).toContain('--output-schema');
  expect(proc.stdin.read()?.toString()).toContain('Synthetic requirements');
  proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"draft":"complete"}'}})+'\n');proc.emit('close',0);
  expect(await result).toMatchObject({ok:true,structured:{draft:'complete'},turns:1});
});
it.each(['low','medium','high','xhigh','max'] as const)('honors explicit planning model and %s reasoning effort while retaining isolation',async effort=>{
 const {proc,result}=fixture({model:'gpt-synthetic-pinned',effort});await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());const args=native.spawn.mock.calls[0][1] as string[];
 expect(args.slice(args.indexOf('--model'),args.indexOf('--model')+2)).toEqual(['--model','gpt-synthetic-pinned']);expect(args).toContain(`model_reasoning_effort="${effort==='max'?'xhigh':effort}"`);expect(args).toContain('--ignore-user-config');expect(args).toContain('read-only');expect(args).toContain('shell_tool');
 proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}}));proc.emit('close',0);expect(await result).toMatchObject({ok:true});
});
it('pins model, effort, schema and prompt before asynchronous preparation',async()=>{
 const schema={type:'object',description:'Original schema'},run=fixture({model:'gpt-pinned',effort:'low',outputSchema:schema});run.request.model='anthropic/claude';run.request.effort='max';run.request.prompt='Unapproved replacement prompt';schema.description='Unapproved schema';
 await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());const args=native.spawn.mock.calls[0][1] as string[];expect(args).toContain('gpt-pinned');expect(args).not.toContain('anthropic/claude');expect(args).toContain('model_reasoning_effort="low"');expect(run.proc.stdin.read()?.toString()).toContain('Synthetic requirements');expect(JSON.parse(await fs.readFile(args[args.indexOf('--output-schema')+1],'utf8'))).toEqual({type:'object',description:'Original schema'});
 run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}}));run.proc.emit('close',0);expect(await run.result).toMatchObject({ok:true});
});
it.each([{model:'anthropic/claude'},{model:'claude-opus'},{model:' gpt-model'},{model:'gpt-model '},{model:'x'.repeat(501)},{effort:'unsupported' as any},{effort:'constructor' as any}])('rejects unsupported planning configuration before discovery or spawn: %#',override=>{
 expect(()=>fixture(override)).toThrow();expect(native.commandFor).not.toHaveBeenCalled();expect(native.spawn).not.toHaveBeenCalled();
});
it('waits for process close after cancellation before reporting completion',async()=>{
  const {proc,handle,callback,result}=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());handle.stop();expect(proc.kill).toHaveBeenCalledOnce();expect(callback).not.toHaveBeenCalled();
  proc.emit('close',null);expect(await result).toMatchObject({ok:false,errors:['Cancelled']});expect(callback).toHaveBeenCalledOnce();
});
it.each(['missing','throw'] as const)('acknowledges pre-spawn discovery failure without launching a child: %s',async mode=>{
  if(mode==='missing')native.commandFor.mockReturnValue(null);else native.commandFor.mockImplementation(()=>{throw new Error('Synthetic discovery failure');});
  const run=fixture();expect(await run.result).toMatchObject({ok:false,turns:0,costUsd:0});expect(native.spawn).not.toHaveBeenCalled();expect(run.callback).toHaveBeenCalledOnce();expect(()=>run.handle.stop()).not.toThrow();
});
it('releases the real synthesis service reservation after a pre-spawn CLI failure',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-planning-start-failure-')),lease={running:vi.fn(),stopping:vi.fn(),release:vi.fn()};
  const deps={reserve:()=>lease,assertOpen:()=>{},context:()=>({checkoutPath:root,fingerprint:'synthetic',copilotPaused:true,skills:[]}),admission:async()=>null,start:startCodexPlanning};
  const service=new HldSynthesisService(root,deps);let restored:HldSynthesisService|undefined;
  try{native.commandFor.mockReturnValue(null);await service.init();const job=await service.start('synthetic/project',{solutionName:'Synthetic',problemContext:'Synthetic startup recovery',components:[]});
    await vi.waitFor(()=>expect(service.view('synthetic/project',job.id)[0]).toMatchObject({status:'failed',runtimeCleanup:'released'}));expect(lease.release).toHaveBeenCalledOnce();expect(native.spawn).not.toHaveBeenCalled();expect(service.pendingCleanup()).toEqual([]);
    await service.close();restored=new HldSynthesisService(root,deps);await restored.init();expect(restored.pendingCleanup()).toEqual([]);
  }finally{await service.close();await restored?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
it('preserves Unicode split across every output chunk boundary',async()=>{
  const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());const structured={title:'£ dépenses — 東京 😀'};
  const bytes=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(structured)}})+'\n');
  for(const byte of bytes)run.proc.stdout.write(Buffer.from([byte]));run.proc.emit('close',0);
  expect(await run.result).toMatchObject({ok:true,structured});
});
it.each(['invalid','truncated','stderr'] as const)('denies malformed UTF-8 without a successful draft: %s',async mode=>{
  const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');
  (mode==='stderr'?run.proc.stderr:run.proc.stdout).write(Buffer.from(mode==='truncated'?[0xe2]:[0xff]));
  if(mode!=='truncated')expect(run.proc.kill).toHaveBeenCalledOnce();expect(run.callback).not.toHaveBeenCalled();run.proc.emit('close',0);
  expect(await run.result).toMatchObject({ok:false});expect(run.callback).toHaveBeenCalledOnce();
});
it('contains a rejected stop signal while retaining the process-close boundary',async()=>{
  const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());run.proc.kill.mockImplementation(()=>{throw new Error('Synthetic denied stop');});
  expect(()=>run.proc.stdout.write(Buffer.from([0xff]))).not.toThrow();expect(run.callback).not.toHaveBeenCalled();run.proc.emit('close',0);expect(await run.result).toMatchObject({ok:false,errors:['Codex planning stop could not be signalled; await process completion']});
});
it.each(['mcp_tool_call','command_execution','file_change','web_search'])('denies output after a forbidden tool event: %s',type=>{
  const run=fixture();return vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce()).then(async()=>{
    run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type}})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');run.proc.emit('close',0);
    expect(await run.result).toMatchObject({ok:false,errors:['Planning emitted a forbidden tool event']});
  });
});
it.each(['throw','reject'] as const)('does not redeliver a planning result when its consumer fails by %s',async mode=>{
  const report=vi.spyOn(console,'warn').mockImplementation(()=>{}),run=fixture();
  run.callback.mockImplementation(()=>{if(mode==='throw')throw new Error('private callback diagnostic');return Promise.reject(new Error('private callback diagnostic')) as never;});
  await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');run.proc.emit('close',0);
  await vi.waitFor(()=>expect(report).toHaveBeenCalledOnce());expect(run.callback).toHaveBeenCalledOnce();expect(run.callback.mock.calls[0][0].ok).toBe(true);expect(JSON.stringify(report.mock.calls)).not.toContain('private callback diagnostic');
});

it('cancels during preparation without launching a native process',async()=>{
 const run=fixture();run.handle.stop();expect(await run.result).toMatchObject({ok:false,errors:['Cancelled before launch']});expect(native.spawn).not.toHaveBeenCalled();
});
it.each([{type:'error',message:'Synthetic native error'},{type:'turn.failed',error:{message:'Synthetic turn error'}},{type:'turn.failed'}])('retains native failure precedence over a later structured draft: %#',async event=>{
 const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
 run.proc.stdout.write(JSON.stringify(event)+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');run.proc.emit('close',0);
 expect(await run.result).toMatchObject({ok:false,structured:undefined,turns:0,errors:[event.message??event.error?.message??'Codex planning failed']});expect(run.callback).toHaveBeenCalledOnce();
});
it.each(['stderr','exit-code','spawn-error','stdin-error','invalid-final','overflow'] as const)('fails planning without publishing a draft after %s',async mode=>{
 const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
 if(mode==='stderr')run.proc.stderr.write('Synthetic stderr diagnostic');
 if(mode==='spawn-error')run.proc.emit('error',new Error('Synthetic spawn error'));
 if(mode==='stdin-error')run.proc.stdin.emit('error',new Error('Synthetic stdin error'));
 if(mode==='invalid-final')run.proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:17}})+'\n');
 if(mode==='overflow')run.proc.stdout.emit('data',Buffer.alloc(3*1024*1024+1));
 run.proc.emit('close',mode==='stderr'||mode==='exit-code'?9:0);
 const result=await run.result;expect(result.ok).toBe(false);expect(result.structured).toBeUndefined();expect(result.errors.length).toBeGreaterThan(0);expect(run.callback).toHaveBeenCalledOnce();
 if(mode==='stderr')expect(result.errors).toEqual(['Synthetic stderr diagnostic']);if(mode==='exit-code')expect(result.errors).toEqual(['Codex exited 9']);
});
it('reports progress for composing and completed turns without granting completion before process close',async()=>{
 const run=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
 run.proc.stdout.write(JSON.stringify({type:'item.started',item:{type:'agent_message'}})+'\n'+JSON.stringify({type:'turn.completed'})+'\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');
 expect(run.log.mock.calls.flatMap(([entries])=>entries).map(entry=>entry.text)).toContain('Composing structured architecture draft');expect(run.callback).not.toHaveBeenCalled();run.proc.emit('close',0);expect(await run.result).toMatchObject({ok:true});
});
