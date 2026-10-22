import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import crypto from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({spawn:vi.fn(),read:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:native.spawn}));
vi.mock('./boundedJson.ts',()=>({readBoundedJson:native.read}));
import {runNativeTree} from './nativeTree.ts';
beforeEach(()=>{vi.spyOn(process,'platform','get').mockReturnValue('win32');});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();native.spawn.mockReset();native.read.mockReset();});
function fixture(){const context={id:crypto.randomUUID(),intentSha256:'a'.repeat(64),proof:'isolated-proof'},controller=new AbortController();const host=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});host.kill.mockImplementation(()=>queueMicrotask(()=>host.emit('close',1)));native.spawn.mockReturnValue(host);const proof={schemaVersion:1,...context,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true};delete (proof as {proof?:string}).proof;native.read.mockResolvedValue(proof);return {context,controller,host,proof};}
it.each(['different-id','different-intent','missing','startup-error'])('rejects supervisor %s evidence',async fault=>{
 const f=fixture();if(fault==='different-id')native.read.mockResolvedValue({...f.proof,id:crypto.randomUUID()});if(fault==='different-intent')native.read.mockResolvedValue({...f.proof,intentSha256:'b'.repeat(64)});if(fault==='missing')native.read.mockResolvedValue(undefined);
 const pending=runNativeTree(process.execPath,[],process.cwd(),{},f.controller.signal,f.context),refused=expect(pending).rejects.toThrow(fault==='startup-error'?'spawn failed':fault==='missing'?'without termination proof':'ownership mismatch');
 if(fault==='startup-error')f.host.emit('error',new Error('spawn failed'));else f.host.emit('close',0);await refused;
});
it('prevents dispatch when cancellation arrives during supervisor creation',async()=>{
 const f=fixture(),write=vi.spyOn(f.host.stdin,'write');native.spawn.mockImplementation(()=>{f.controller.abort();return f.host;});
 const pending=runNativeTree(process.execPath,[],process.cwd(),{},f.controller.signal,f.context),refused=expect(pending).rejects.toThrow('cancelled');f.host.emit('close',1);await refused;expect(write).not.toHaveBeenCalled();
});
it('bounds an unresponsive supervisor and refuses its late receipt',async()=>{
 vi.useFakeTimers();const f=fixture();const pending=runNativeTree(process.execPath,[],process.cwd(),{},f.controller.signal,f.context),refused=expect(pending).rejects.toThrow('deadline exceeded');await vi.advanceTimersByTimeAsync(21*60_000);await refused;expect(f.host.kill).toHaveBeenCalledOnce();
});
it('refuses success after a broken control pipe',async()=>{
 const f=fixture();const pending=runNativeTree(process.execPath,[],process.cwd(),{},f.controller.signal,f.context),refused=expect(pending).rejects.toThrow('control pipe failed');f.host.stdin.emit('error',new Error('closed'));f.host.emit('close',0);await refused;
});
