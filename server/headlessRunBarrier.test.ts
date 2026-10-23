vi.mock('./handoffMutex.ts',()=>({withHandoffMutex:async(_root:string,work:(owned:()=>void)=>Promise<unknown>)=>work(()=>{})}));
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
import {claimHeadlessRun,beforeHeadlessDeadline} from './headlessRunBarrier.ts';
it('retains an unresolved provider invocation across new callers and releases only on terminal evidence',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'headless-barrier-'));
 try{const claim=await claimHeadlessRun(root,{flow:'one'},{nonce:'original'});
 await expect(claimHeadlessRun(root,{flow:'one'},{nonce:'replay'})).rejects.toThrow('Unresolved headless invocation');
 const separate=await claimHeadlessRun(root,{flow:'two'},{nonce:'separate'});await separate.terminal({status:'Failed'});
 await claim.terminal({status:'Succeeded'});expect((await fs.readdir(root)).filter(f=>f.endsWith('.terminal.json'))).toHaveLength(2);
 await claimHeadlessRun(root,{flow:'one'},{nonce:'new'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('does not invoke work after its deadline or claim cancellation of timed-out work',async()=>{
 vi.useFakeTimers();try{
 const operation=vi.fn(async()=>42);await expect(beforeHeadlessDeadline(Date.now()-1,operation)).rejects.toThrow('deadline');expect(operation).not.toHaveBeenCalled();
 let complete!:(v:number)=>void;const work=new Promise<number>(resolve=>{complete=resolve;});
 const pending=expect(beforeHeadlessDeadline(Date.now()+50,()=>work)).rejects.toThrow('outcome may remain unknown');
 await vi.advanceTimersByTimeAsync(50);await pending;complete(42);await expect(work).resolves.toBe(42);
 }finally{vi.useRealTimers();}
});
