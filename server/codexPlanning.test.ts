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
function fixture(){
  const proc=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
  native.spawn.mockReturnValue(proc);let finished!:(value:SessionResult)=>void;const result=new Promise<SessionResult>(resolve=>{finished=resolve;});
  const callback=vi.fn(finished);const handle=startCodexPlanning(options,{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:callback});
  return {proc,result,handle,callback};
}
it('launches without shell interpolation or inherited project config and parses the structured final response',async()=>{
  const {proc,result}=fixture();await vi.waitFor(()=>expect(native.spawn).toHaveBeenCalledOnce());
  const [file,args,config]=native.spawn.mock.calls[0];expect(file).toBe('synthetic-codex');expect(config).toMatchObject({shell:false,windowsHide:true});expect(config.cwd).not.toBe(options.cwd);
  expect(args).toContain('--ignore-user-config');expect(args).toContain('--ignore-rules');expect(args).toContain('read-only');expect(args).toContain('shell_tool');expect(args).toContain('--output-schema');
  expect(proc.stdin.read()?.toString()).toContain('Synthetic requirements');
  proc.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"draft":"complete"}'}})+'\n');proc.emit('close',0);
  expect(await result).toMatchObject({ok:true,structured:{draft:'complete'},turns:1});
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
