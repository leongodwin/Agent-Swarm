import {afterEach,expect,it,vi} from 'vitest';
import {flowCleanup} from './flowCleanup.ts';
import {platformDiscoveryBudget} from './platformDiscovery.ts';

afterEach(()=>vi.useRealTimers());

it('settles the real worst-case cleanup after composite cancellation before the native client deadline',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const controller=new AbortController(),budget=platformDiscoveryBudget({kind:'delivery-authoring-prerequisites'});
 const never=()=>new Promise<void>(()=>{}),client={close:vi.fn(never)},transport={close:vi.fn(never),onclose:undefined as (()=>void)|undefined};
 const cleanup=flowCleanup(client,transport);cleanup.started();let settled=false;
 const timer=setTimeout(()=>controller.abort(),budget);
 const task=(async()=>{
  try{await new Promise<void>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('collection cancelled')),{once:true}));}
  finally{await cleanup.close();}
 })().then(()=>({error:null}),error=>({error})).finally(()=>{settled=true;clearTimeout(timer);});
 await vi.advanceTimersByTimeAsync(budget-1);expect(settled).toBe(false);expect(client.close).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(controller.signal.aborted).toBe(true);expect(client.close).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(5000);expect(transport.close).toHaveBeenCalledOnce();expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(9999);expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(1);const result=await task;
 expect(result.error).toBeInstanceOf(AggregateError);expect(result.error.errors).toHaveLength(3);
 expect(result.error.errors[2].message).toContain('process exit is unacknowledged');
 expect(Date.now()).toBe(budget+15000);expect(Date.now()).toBeLessThan(120000);
 expect(client.close).toHaveBeenCalledOnce();expect(transport.close).toHaveBeenCalledOnce();
});
