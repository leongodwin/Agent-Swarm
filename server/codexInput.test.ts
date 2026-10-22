import {afterEach,expect,it,vi} from 'vitest';
import {submitCodexPaste} from './codexInput.ts';
afterEach(()=>vi.useRealTimers());
function fixture(text='Synthetic task',before='› '){
  vi.useFakeTimers();let screen=before,current=true;
  const write=vi.fn(),failed=vi.fn();
  const cancel=submitCodexPaste({text,screen:()=>screen,write,current:()=>current,failed});
  return {write,failed,cancel,setScreen:(value:string)=>{screen=value;},lose:()=>{current=false;}};
}
it('waits past a busy native child and submits the actual large-paste contract once',async()=>{
  const text='x'.repeat(8453),f=fixture(text);
  await vi.advanceTimersByTimeAsync(1500);expect(f.write).toHaveBeenCalledExactlyOnceWith(`\x1b[200~${text}\x1b[201~`);
  f.setScreen('› [Pasted Content 8453 chars]');await vi.advanceTimersByTimeAsync(149);expect(f.write).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(f.write).toHaveBeenLastCalledWith('\r');
  await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(2);expect(f.failed).not.toHaveBeenCalled();
});
it('accepts rendered short multiline input',async()=>{
  const f=fixture('first\nsecond');f.setScreen('› first\nsecond');await vi.advanceTimersByTimeAsync(150);
  expect(f.write).toHaveBeenCalledTimes(2);expect(f.write).toHaveBeenLastCalledWith('\r');
});
it('recognizes the complete native word-wrapped editor without replay',async()=>{
  const f=fixture('Manager message:\nActual evidence with a long continuation and exact identifier abc123.');
  f.setScreen('› Manager message:\n  Actual evidence with a long\n  continuation and exact identifier abc123.\n  tab to queue message');
  await vi.advanceTimersByTimeAsync(150);expect(f.write).toHaveBeenCalledTimes(2);expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.failed).not.toHaveBeenCalled();
});
it.each(['abc124.','abc123. extra'])('rejects changed or extra wrapped content %s',async suffix=>{
  const f=fixture('Actual evidence with identifier abc123.');f.setScreen('› Actual evidence with\n  identifier '+suffix);
  await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
it('counts Unicode scalar characters in the native placeholder',async()=>{
  const f=fixture('😀'.repeat(600));f.setScreen('› [Pasted Content 600 chars]');await vi.advanceTimersByTimeAsync(150);
  expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.failed).not.toHaveBeenCalled();
});
it.each(['no acknowledgement','wrong size','Gemini marker','stale marker'])('fails without Enter or replay for %s',async mode=>{
  const before=mode==='stale marker'?'History [Pasted Content 600 chars]\n› ':'› ';
  const f=fixture('x'.repeat(600),before);
  f.setScreen(mode==='wrong size'?'› [Pasted Content 601 chars]':mode==='Gemini marker'?'› [Pasted Text: 600 chars]':before+'spinner');
  await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
it.each(['before acknowledgement','after acknowledgement'])('cancels on ownership loss %s',async mode=>{
  const f=fixture();if(mode==='after acknowledgement'){f.setScreen('› Synthetic task');await vi.advanceTimersByTimeAsync(50);}
  f.lose();await vi.advanceTimersByTimeAsync(20000);expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).not.toHaveBeenCalled();
});
it('cancels pending Enter when the session finishes or another send replaces it',async()=>{
  const f=fixture();f.setScreen('› Synthetic task');await vi.advanceTimersByTimeAsync(50);f.cancel();await vi.advanceTimersByTimeAsync(20000);
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).not.toHaveBeenCalled();
});
it('withholds Enter if the input disappears during the acknowledgement guard',async()=>{
  const f=fixture();f.setScreen('› Synthetic task');await vi.advanceTimersByTimeAsync(50);f.setScreen('› ');await vi.advanceTimersByTimeAsync(20000);
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
it('does not paste to an invalid owner',async()=>{
  vi.useFakeTimers();const write=vi.fn(),failed=vi.fn();submitCodexPaste({text:'task',screen:()=>'',write,current:()=>false,failed});
  await vi.advanceTimersByTimeAsync(20000);expect(write).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
});
it.each(['› \nexisting task','No native input prompt','› new task\nexisting task'])('rejects unrecognized existing input: %s',async screen=>{
  const f=fixture('new task',screen);await vi.advanceTimersByTimeAsync(20000);expect(f.write).not.toHaveBeenCalled();expect(f.failed).toHaveBeenCalledOnce();
});
it('recognizes empty native input above the observed model/status footer',async()=>{
  const f=fixture('new task','› \n \n  GPT-6.1-Sol medium · C:\\synthetic');f.setScreen('› new task\n \n  GPT-6.1-Sol medium · C:\\synthetic');await vi.advanceTimersByTimeAsync(150);
  expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.failed).not.toHaveBeenCalled();
});
it('recognizes the observed busy Codex queue footer without including it in the pasted input',async()=>{
  const f=fixture('x'.repeat(7327),'• Working (28s • esc to interrupt)\n\n› \n  tab to queue message                    92% context left');
  f.setScreen('• Working (29s • esc to interrupt)\n\n› [Pasted Content 7327 chars]\n  tab to queue message                    92% context left');
  await vi.advanceTimersByTimeAsync(150);expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.failed).not.toHaveBeenCalled();
});
it.each(['[Pasted Content 600 chars]','x'.repeat(600)])('ignores newly echoed output outside the active input',async output=>{
  const f=fixture('x'.repeat(600));f.setScreen(`Assistant echoed ${output}\n› `);await vi.advanceTimersByTimeAsync(20000);
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
it('does not overwrite or submit existing native input',async()=>{
  const f=fixture('new task','› [Pasted Content 8453 chars]');await vi.advanceTimersByTimeAsync(20000);
  expect(f.write).not.toHaveBeenCalled();expect(f.failed).toHaveBeenCalledOnce();expect(f.cancel.pending()).toBe(false);
});
it('accepts the observed native empty-input placeholder',async()=>{
  const f=fixture('new task','Worked for 2s\n› Ask Codex to do anything');f.setScreen('Worked for 2s\n› new task');await vi.advanceTimersByTimeAsync(150);
  expect(f.write).toHaveBeenLastCalledWith('\r');expect(f.failed).not.toHaveBeenCalled();
});
it('does not submit acknowledgement that crosses the absolute deadline',async()=>{
  const f=fixture();await vi.advanceTimersByTimeAsync(9900);f.setScreen('› Synthetic task');await vi.advanceTimersByTimeAsync(200);
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.failed).toHaveBeenCalledOnce();
});
