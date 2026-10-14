import {EventEmitter} from 'node:events';import {afterEach,expect,it,vi} from 'vitest';
vi.mock('node:child_process',()=>({spawn:vi.fn(),execFile:vi.fn()}));
vi.mock('./clis.ts',async importOriginal=>({...await importOriginal<typeof import('./clis.ts')>(),resolveCommand:()=>process.execPath}));
import {spawn} from 'node:child_process';import {createTenancyService} from './tenancy.ts';
const services:ReturnType<typeof createTenancyService>[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close();vi.clearAllMocks();});
function fixture(pid:number|undefined){const child=Object.assign(new EventEmitter(),{pid,stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});vi.mocked(spawn).mockReturnValue(child as any);const service=createTenancyService(false);services.push(service);return {child,service};}
it('does not equate a native process error with exit while the spawned root still has an identity',()=>{
  const {child,service}=fixture(123),job=service.login({interactive:true});child.emit('error',new Error('private process failure'));service.cancelLogin(job.id);
  expect(service.loginStatus(job.id)).toMatchObject({status:'cancelled',ok:false,nativeCleanup:'awaiting-exit'});expect(()=>service.login({interactive:true})).toThrow('already pending');
  child.emit('error',new Error('second private process failure'));expect(()=>service.login({interactive:true})).toThrow('already pending');child.emit('close',1);expect(service.loginStatus(job.id).nativeCleanup).toBe('exited');service.login({interactive:true});expect(spawn).toHaveBeenCalledTimes(2);
});
it('reports a spawn failure with no root identity as terminal and withholds private native error details',()=>{
  const {child,service}=fixture(undefined),job=service.login({interactive:true});child.emit('error',new Error('private credentials'));expect(service.loginStatus(job.id)).toMatchObject({status:'failed',ok:false,nativeCleanup:'exited'});expect(service.loginStatus(job.id).message).not.toContain('private credentials');service.login({interactive:true});expect(spawn).toHaveBeenCalledTimes(2);
});
it('does not report authentication success when a root error is followed by a zero close code',()=>{
  const {child,service}=fixture(123),job=service.login({interactive:true});child.emit('error',new Error('synthetic root failure'));child.emit('close',0);expect(service.loginStatus(job.id)).toMatchObject({status:'failed',ok:false,nativeCleanup:'exited'});expect(service.loginStatus(job.id).observation).toBeUndefined();
});
