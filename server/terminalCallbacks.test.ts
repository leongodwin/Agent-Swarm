import {afterEach,expect,it,vi} from 'vitest';
import {terminalCallback,terminalListeners} from './terminalCallbacks.ts';
import {RemotePty} from './ptyClient.ts';
afterEach(()=>vi.restoreAllMocks());
it('continues capacity observers after a synchronous task-consumer failure and omits sensitive diagnostics',()=>{
  const report=vi.spyOn(console,'warn').mockImplementation(()=>{}),closed=vi.fn();
  const terminal=new RemotePty('owned-callback-fixture');terminal.onExit(()=>{throw new Error('private token');});terminal.onExit(closed);
  expect(()=>terminal.exit(0)).not.toThrow();expect(terminal.verifiedExit).toBe(true);expect(closed).toHaveBeenCalledExactlyOnceWith(0);
  expect(report).toHaveBeenCalledOnce();expect(JSON.stringify(report.mock.calls)).not.toContain('private token');
});
it('contains rejected async consumers and keeps native closure distinct from disconnect',async()=>{
  const report=vi.spyOn(console,'warn').mockImplementation(()=>{}),observed=vi.fn();
  const terminal=new RemotePty('owned-async-fixture');terminal.onExit(async()=>{throw new Error('private error');});terminal.onExit(observed);terminal.exit(-1,false);
  await Promise.resolve();expect(observed).toHaveBeenCalledExactlyOnceWith(-1);expect(terminal.verifiedExit).toBe(false);expect(report).toHaveBeenCalledOnce();
});
it('isolates data consumers and late exit replay without turning a failed logger into a supervisor error',async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{throw new Error('logger failed');});const next=vi.fn();
  const terminal=new RemotePty('owned-data-fixture');terminal.onData(()=>{throw new Error('bad consumer');});terminal.onData(next);terminal.data('payload');expect(next).toHaveBeenCalledExactlyOnceWith('payload');
  terminal.exit(3);terminal.onExit(()=>{throw new Error('late failure');});const late=vi.fn();terminal.onExit(late);await Promise.resolve();expect(late).toHaveBeenCalledExactlyOnceWith(3);
  terminal.data('after exit');expect(next).toHaveBeenCalledOnce();
});
it('handles throwing thenables and preserves a listener snapshot during registration changes',()=>{
  const report=vi.fn();terminalCallback(()=>({get then(){throw new Error('thenable failure');}}),'value',report);expect(report).toHaveBeenCalledOnce();
  const later=vi.fn(),listeners:((value:number)=>unknown)[]=[()=>listeners.push(later)];terminalListeners(listeners,1);expect(later).not.toHaveBeenCalled();terminalListeners(listeners,2);expect(later).toHaveBeenCalledExactlyOnceWith(2);
});
