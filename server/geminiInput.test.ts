import {afterEach,expect,it,vi} from 'vitest';
import {submitGeminiPaste} from './geminiInput.ts';
afterEach(()=>vi.useRealTimers());
function fixture(text='Synthetic prompt'){
 vi.useFakeTimers();vi.setSystemTime(1000);let screen='> ',current=true;
 const write=vi.fn(),failed=vi.fn();const cancel=submitGeminiPaste({text,screen:()=>screen,write,current:()=>current,failed});
 return {write,failed,cancel,setScreen:(value:string)=>{screen=value;},lose:()=>{current=false;}};
}
it('waits for child processing acknowledgement instead of parent write spacing before entering',async()=>{
 const text=Array.from({length:37},(_,i)=>`Synthetic line ${i}`).join('\n'),f=fixture(text);
 await vi.advanceTimersByTimeAsync(500);expect(f.write).toHaveBeenCalledExactlyOnceWith(`\x1b[200~${text}\x1b[201~`);
 // A busy native child finally processes its paste here, long after the parent's old 150ms timer.
 const nativePasteAt=Date.now();f.setScreen('> [Pasted Text: 37 lines]');await vi.advanceTimersByTimeAsync(50);
 expect(f.write).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(99);expect(f.write).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(f.write).toHaveBeenLastCalledWith('\r');
 // Native bufferFastReturn (30ms) and unsafe-paste (40ms) both admit this Enter as submit.
 expect(Date.now()-nativePasteAt).toBeGreaterThan(40);await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(2);expect(f.failed).not.toHaveBeenCalled();
});
it('recognizes a newly rendered short input without requiring a large-paste placeholder',async()=>{
 const f=fixture();f.setScreen('> Synthetic prompt');await vi.advanceTimersByTimeAsync(150);
 expect(f.write).toHaveBeenCalledTimes(2);expect(f.write).toHaveBeenLastCalledWith('\r');
});
it('times out an unacknowledged paste without entering or replaying its payload',async()=>{
 const f=fixture();await vi.advanceTimersByTimeAsync(10000);expect(f.failed).toHaveBeenCalledOnce();expect(f.write).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(10000);expect(f.failed).toHaveBeenCalledOnce();expect(f.write).toHaveBeenCalledTimes(1);
});
it.each(['before-ack','after-ack'])('cancels a stopped or replaced owner %s',async mode=>{
 const f=fixture();if(mode==='after-ack'){f.setScreen('> Synthetic prompt');await vi.advanceTimersByTimeAsync(50);}
 f.lose();await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).not.toHaveBeenCalled();
});
it('cancels its pending Enter when the task finishes during the native paste guard',async()=>{
 const f=fixture();f.setScreen('> Synthetic prompt');await vi.advanceTimersByTimeAsync(50);f.cancel();await vi.advanceTimersByTimeAsync(20000);
 expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).not.toHaveBeenCalled();
});
it('does not treat a stale historical large-paste marker and unrelated redraw as acknowledgement',async()=>{
 vi.useFakeTimers();let screen='History [Pasted Text: 37 lines]\n> ';const write=vi.fn(),failed=vi.fn();
 submitGeminiPaste({text:Array.from({length:37},()=> 'Synthetic line').join('\n'),screen:()=>screen,write,current:()=>true,failed});
 screen='History [Pasted Text: 37 lines]\nSpinner changed\n> ';await vi.advanceTimersByTimeAsync(10000);
 expect(write).toHaveBeenCalledTimes(1);expect(failed).toHaveBeenCalledOnce();
});
it('does not paste into an owner that is already invalid at submission entry',async()=>{
 vi.useFakeTimers();const write=vi.fn(),failed=vi.fn();submitGeminiPaste({text:'Synthetic prompt',screen:()=>'> ',write,current:()=>false,failed});
 await vi.advanceTimersByTimeAsync(20000);expect(write).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
});
it.each(['[Pasted Text: unrelated]','[Pasted Text: 99 lines]'])('rejects an unrelated rendered marker as current paste acknowledgement: %s',async marker=>{
 const f=fixture(Array.from({length:37},()=> 'Synthetic line').join('\n'));f.setScreen('> '+marker);await vi.advanceTimersByTimeAsync(10000);
 expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
it.each(['chars','collision'])('recognizes the native %s large-paste contract',async variant=>{
 const text=variant==='chars'?'x'.repeat(501):Array.from({length:7},()=> 'Synthetic line').join('\n');const f=fixture(text);
 f.setScreen(variant==='chars'?'> [Pasted Text: 501 chars]':'> [Pasted Text: 7 lines #2]');await vi.advanceTimersByTimeAsync(150);
 expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.write).toHaveBeenCalledTimes(2);
});
it('withholds Enter when the acknowledged input disappears during the native paste guard',async()=>{
 const f=fixture();f.setScreen('> Synthetic prompt');await vi.advanceTimersByTimeAsync(50);
 f.setScreen('> User changed or cleared the input');await vi.advanceTimersByTimeAsync(100);
 expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(10000);expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
