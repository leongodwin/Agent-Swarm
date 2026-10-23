import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {afterEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({spawn:vi.fn(),execFile:vi.fn()}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:native.spawn,execFile:native.execFile}));
vi.mock('./tenancy.ts',async original=>({...await original<typeof import('./tenancy.ts')>(),resolveTenancyCommand:()=>({file:'synthetic-cli',args:[]})}));
import {deliveryCommands} from './delivery.ts';
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();});
it.each(['success','failure'])('retains command ownership after root close until the Windows helper reports %s',async outcome=>{
  vi.spyOn(process,'platform','get').mockReturnValue('win32');
  const child=Object.assign(new EventEmitter(),{pid:12345,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});native.spawn.mockReturnValue(child);
  let helper!:(error:Error|null)=>void;native.execFile.mockImplementation((_file,_args,_options,callback)=>{helper=callback;return new EventEmitter();});
  const controller=new AbortController();let settled=false;const result=deliveryCommands.run({executable:'fixture',args:[]},process.cwd(),{},controller.signal).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  controller.abort();await vi.waitFor(()=>expect(native.execFile).toHaveBeenCalledOnce());child.emit('close',0);await Promise.resolve();expect(settled).toBe(false);
  expect(native.execFile.mock.calls[0].slice(0,3)).toEqual(['taskkill',['/PID','12345','/T','/F'],{windowsHide:true,timeout:4000}]);
  child.stdout.write(Buffer.alloc(8*1024*1024+1));expect(native.execFile).toHaveBeenCalledOnce();
  helper(outcome==='failure'?new Error('private helper detail'):null);const error=await result;expect(error).toBeInstanceOf(Error);expect(error.message).toContain(outcome==='failure'?'cleanup is unverified':'Delivery cancelled');expect(error.message).not.toContain('private');
});
it('does not release a live native root after a signal error while cleanup is pending',async()=>{
  vi.spyOn(process,'platform','get').mockReturnValue('win32');const child=Object.assign(new EventEmitter(),{pid:12345,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});native.spawn.mockReturnValue(child);
  let helper!:(error:Error|null)=>void;native.execFile.mockImplementation((_file,_args,_options,callback)=>{helper=callback;return new EventEmitter();});
  const controller=new AbortController();let settled=false;const result=deliveryCommands.run({executable:'fixture',args:[]},process.cwd(),{},controller.signal).catch(error=>{settled=true;return error;});controller.abort();await vi.waitFor(()=>expect(native.execFile).toHaveBeenCalledOnce());
  child.emit('error',new Error('private signal detail'));helper(new Error('private helper detail'));await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
  child.emit('close',1);expect((await result).message).toContain('cleanup is unverified');
});
it('bounds missing root and helper acknowledgements without claiming termination',async()=>{
 vi.useFakeTimers();vi.spyOn(process,'platform','get').mockReturnValue('win32');
 const child=Object.assign(new EventEmitter(),{pid:12345,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});native.spawn.mockReturnValue(child);native.execFile.mockReturnValue(new EventEmitter());
 const controller=new AbortController();const result=expect(deliveryCommands.run({executable:'fixture',args:[]},process.cwd(),{},controller.signal)).rejects.toThrow('native outcome unknown');controller.abort();await vi.advanceTimersByTimeAsync(5000);await result;expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();
});
it('bounds a helper that never acknowledges even after the root closes',async()=>{
 vi.useFakeTimers();vi.spyOn(process,'platform','get').mockReturnValue('win32');
 const child=Object.assign(new EventEmitter(),{pid:12345,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});native.spawn.mockReturnValue(child);native.execFile.mockReturnValue(new EventEmitter());
 const controller=new AbortController();const result=expect(deliveryCommands.run({executable:'fixture',args:[]},process.cwd(),{},controller.signal)).rejects.toThrow('native outcome unknown');controller.abort();await Promise.resolve();child.emit('close',0);await vi.advanceTimersByTimeAsync(5000);await result;vi.useRealTimers();
});
