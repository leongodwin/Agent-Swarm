import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:native.spawn}));
import {withHandoffMutex} from './handoffMutex.ts';
beforeEach(()=>{vi.spyOn(process,'platform','get').mockReturnValue('win32');});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();native.spawn.mockReset();});
function host(){const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),exitCode:null as number|null,signalCode:null as string|null,kill:vi.fn()});child.stdin.once('finish',()=>queueMicrotask(()=>child.emit('close',0)));child.kill.mockImplementation(()=>queueMicrotask(()=>child.emit('close',1)));native.spawn.mockReturnValue(child);return child;}
it.each(['startup-error','early-exit','pipe-error','invalid-ack'])('refuses work after mutex %s',async fault=>{
 const child=host(),work=vi.fn();const pending=withHandoffMutex(process.cwd(),work),refused=expect(pending).rejects.toThrow();
 if(fault==='startup-error')child.emit('error',new Error('failed to start'));
 if(fault==='early-exit')child.emit('close',1);
 if(fault==='pipe-error')child.stdin.emit('error',new Error('pipe failed'));
 if(fault==='invalid-ack')child.stdout.write('x'.repeat(101));
 await refused;expect(work).not.toHaveBeenCalled();
});
it.each(['process-exit','signal'])('revokes critical work after helper %s',async mode=>{
 const child=host();const pending=withHandoffMutex(process.cwd(),async assertOwned=>{assertOwned();if(mode==='process-exit')child.exitCode=1;else child.signalCode='SIGKILL';assertOwned();});
 const refused=expect(pending).rejects.toThrow('kernel exclusion lost');child.stdout.write('READY\n');await refused;
});
it('bounds a helper that never acknowledges exclusion',async()=>{
 vi.useFakeTimers();const child=host(),work=vi.fn();const pending=withHandoffMutex(process.cwd(),work),refused=expect(pending).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(15000);await refused;expect(child.kill).toHaveBeenCalledOnce();expect(work).not.toHaveBeenCalled();
});
it('refuses unsupported kernel exclusion before launching helpers',async()=>{vi.spyOn(process,'platform','get').mockReturnValue('linux');await expect(withHandoffMutex(process.cwd(),vi.fn())).rejects.toThrow('Windows');expect(native.spawn).not.toHaveBeenCalled();});
