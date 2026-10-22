import {it,expect,vi,afterEach} from 'vitest';
import {withVerificationBudget} from './verificationBudget.ts';
afterEach(()=>vi.useRealTimers());
it('enforces one aggregate deadline across individually short operations and waits for cleanup',async()=>{
 vi.useFakeTimers();const c=new AbortController();let finish!:(v:number)=>void,cleaned=false;
 const task=withVerificationBudget(c,1000,async()=>{try{return await new Promise<number>(r=>{finish=r;});}finally{cleaned=true;}});let settled=false;const checked=task.catch(e=>{settled=true;return e;});
 await vi.advanceTimersByTimeAsync(1001);expect(c.signal.aborted).toBe(true);expect(settled).toBe(false);finish(1);expect((await checked).message).toContain('deadline');expect(cleaned).toBe(true);
});
it('clears its timer on success and preserves parent interruption',async()=>{
 vi.useFakeTimers();const c=new AbortController();expect(await withVerificationBudget(c,1000,async()=>42)).toBe(42);await vi.advanceTimersByTimeAsync(2000);expect(c.signal.aborted).toBe(false);
 c.abort(Error('operator interruption'));await expect(withVerificationBudget(c,1000,async()=>42)).rejects.toThrow('operator interruption');
});
it('preserves legacy omitted deadlines and refuses invalid configured bounds',async()=>{
 expect(await withVerificationBudget(new AbortController(),undefined,async()=>42)).toBe(42);
 for(const v of [0,999,3600001,Infinity])await expect(withVerificationBudget(new AbortController(),v,async()=>42)).rejects.toThrow('Invalid');
});
