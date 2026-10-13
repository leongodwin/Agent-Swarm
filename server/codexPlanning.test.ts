import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach,expect,it,vi} from 'vitest';
import type {SessionOptions,SessionResult} from './agentRunner.ts';
const native=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:native.spawn}));
vi.mock('./clis.ts',()=>({commandFor:()=>({file:'synthetic-codex',args:[]})}));
import {startCodexPlanning} from './codexPlanning.ts';
const options:SessionOptions={cwd:process.cwd(),prompt:'Synthetic requirements',systemAppend:'No tools',model:'',effort:'medium',browserTesting:false,additionalDirectories:[],role:'dev',noTools:true,outputSchema:{type:'object'}};
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks();});
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
