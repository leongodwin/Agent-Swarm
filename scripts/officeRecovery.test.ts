import {afterEach,expect,it,vi} from 'vitest';
import {LauncherCrashRecovery} from './officeRecovery.mjs';

afterEach(()=>vi.useRealTimers());
function fixture(){
 vi.useFakeTimers();vi.setSystemTime(1000);
 let current:{pid:number}|null=null,busy=false;
 const restart=vi.fn(()=>{current={pid:200};}),report=vi.fn(),exhausted=vi.fn();
 const recovery=new LauncherCrashRecovery({current:()=>current,busy:()=>busy,restart,report,exhausted,limit:3,windowMs:300000,delayMs:500});
 return {recovery,restart,report,exhausted,setCurrent:(value:typeof current)=>{current=value;},setBusy:(value:boolean)=>{busy=value;}};
}
it('waits for the bounded recovery delay before starting one replacement',async()=>{
 const f=fixture();f.recovery.exited({pid:100},1);
 expect(f.restart).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(499);expect(f.restart).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(f.restart).toHaveBeenCalledOnce();expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it.each([0])('does not recover an intentional clean exit %s',async how=>{
 const f=fixture();f.recovery.exited({pid:100},how);await vi.advanceTimersByTimeAsync(1000);
 expect(f.restart).not.toHaveBeenCalled();expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it.each(['SIGKILL',137,1])('recognizes native abnormal exit %s',async how=>{
 const f=fixture();f.recovery.exited({pid:100},how);await vi.advanceTimersByTimeAsync(500);
 expect(f.restart).toHaveBeenCalledOnce();f.recovery.close();
});
it('coalesces duplicate exit observations without spending another crash slot',async()=>{
 const f=fixture(),peer={pid:100};f.recovery.exited(peer,1);f.recovery.exited(peer,1);
 await vi.advanceTimersByTimeAsync(500);expect(f.restart).toHaveBeenCalledOnce();expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it('passes only the observed crashed child into recovery and never a duplicate foreign hint',async()=>{
 const f=fixture(),owned={pid:100};f.recovery.exited(owned,'SIGKILL');f.recovery.exited({pid:999},1);
 await vi.advanceTimersByTimeAsync(500);expect(f.restart).toHaveBeenCalledExactlyOnceWith(owned);f.recovery.close();
});
it('refuses replacement while another native server owns the launcher',async()=>{
 const f=fixture();f.setCurrent({pid:999});f.recovery.exited({pid:100},1);await vi.advanceTimersByTimeAsync(1000);
 expect(f.restart).not.toHaveBeenCalled();f.recovery.close();
});
it('rechecks server ownership when the delayed restart becomes due',async()=>{
 const f=fixture();f.recovery.exited({pid:100},1);f.setCurrent({pid:999});await vi.advanceTimersByTimeAsync(500);
 expect(f.restart).not.toHaveBeenCalled();f.recovery.close();
});
it('refuses crashes during an update or shutdown and rechecks that barrier after scheduling',async()=>{
 const f=fixture();f.setBusy(true);f.recovery.exited({pid:100},1);await vi.advanceTimersByTimeAsync(500);expect(f.restart).not.toHaveBeenCalled();
 f.setBusy(false);f.recovery.exited({pid:101},1);f.setBusy(true);await vi.advanceTimersByTimeAsync(500);expect(f.restart).not.toHaveBeenCalled();f.recovery.close();
});
it.each(['cancel','close'] as const)('%s clears pending restart without leaking a late launch',async operation=>{
 const f=fixture();f.recovery.exited({pid:100},1);f.recovery[operation]();await vi.advanceTimersByTimeAsync(1000);expect(f.restart).not.toHaveBeenCalled();
 if(operation==='close'){f.recovery.exited({pid:101},1);await vi.advanceTimersByTimeAsync(1000);expect(f.restart).not.toHaveBeenCalled();}f.recovery.close();
});
it('holds a fourth crash within five minutes instead of looping through native launches',async()=>{
 const f=fixture();for(let i=0;i<3;i++){f.setCurrent(null);f.recovery.exited({pid:100+i},1);await vi.advanceTimersByTimeAsync(500);}
 expect(f.restart).toHaveBeenCalledTimes(3);f.setCurrent(null);f.recovery.exited({pid:104},1);await vi.advanceTimersByTimeAsync(1000);
 expect(f.restart).toHaveBeenCalledTimes(3);expect(f.exhausted).toHaveBeenCalledOnce();f.recovery.close();
});
it('allows a later crash after the rolling budget window has expired',async()=>{
 const f=fixture();for(let i=0;i<3;i++){f.setCurrent(null);f.recovery.exited({pid:100+i},1);await vi.advanceTimersByTimeAsync(500);}
 await vi.advanceTimersByTimeAsync(300001);f.setCurrent(null);f.recovery.exited({pid:104},1);await vi.advanceTimersByTimeAsync(500);
 expect(f.restart).toHaveBeenCalledTimes(4);expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it.each([null,undefined,NaN,1.5,'unexpected'])('rejects an unverified native exit status %s',async how=>{
 const f=fixture();f.recovery.exited({pid:100},how as number);await vi.advanceTimersByTimeAsync(500);
 expect(f.restart).not.toHaveBeenCalled();expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it.each([0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])('rejects an unsafe native owner PID %s',async pid=>{
 const f=fixture();f.recovery.exited({pid},1);await vi.advanceTimersByTimeAsync(500);
 expect(f.restart).not.toHaveBeenCalled();expect(f.exhausted).not.toHaveBeenCalled();f.recovery.close();
});
it('reports a failed replacement spawn and stops instead of recursively retrying',async()=>{
 const f=fixture();f.restart.mockImplementationOnce(()=>{throw new Error('Synthetic spawn refusal');});
 f.recovery.exited({pid:100},1);await vi.advanceTimersByTimeAsync(1000);
 expect(f.restart).toHaveBeenCalledOnce();expect(f.exhausted).toHaveBeenCalledOnce();
 expect(f.report).toHaveBeenLastCalledWith(expect.stringContaining('could not start a replacement'));f.recovery.close();
});
