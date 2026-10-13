import {expect,it,vi} from 'vitest';
import {connectOwnedFlowAdapter} from './ownedFlowAdapter.ts';
import type {FlowAdapter} from './flowAdapter.ts';

it.each(['get_flow','publish_flow'])('refuses %s before dispatch if ownership is lost',async tool=>{
  let live=true;const owned=async()=>{if(!live)throw new Error('ownership lost');};
  const raw={call:vi.fn<FlowAdapter['call']>(async()=>({state:'Started'})),close:vi.fn(async()=>{})};
  const adapter=await connectOwnedFlowAdapter(async()=>raw,owned,new AbortController().signal);live=false;
  await expect(adapter.call(tool,{})).rejects.toThrow('ownership lost');expect(raw.call).not.toHaveBeenCalled();expect(raw.close).toHaveBeenCalledOnce();
  await adapter.close();expect(raw.close).toHaveBeenCalledOnce();
});
it.each(['get_flow','publish_flow'])('rejects a late %s result after ownership changes',async tool=>{
  let live=true,finish!:(value:unknown)=>void;
  const raw={call:vi.fn<FlowAdapter['call']>(()=>new Promise(resolve=>{finish=resolve;})),close:vi.fn(async()=>{})};
  const adapter=await connectOwnedFlowAdapter(async()=>raw,async()=>{if(!live)throw new Error('ownership lost');},new AbortController().signal);
  const pending=adapter.call(tool,{});await vi.waitFor(()=>expect(raw.call).toHaveBeenCalledOnce());live=false;finish({state:'Started'});
  await expect(pending).rejects.toThrow('ownership lost');await expect(adapter.call('whoami',{})).rejects.toThrow('closed');expect(raw.close).toHaveBeenCalledOnce();expect(raw.call).toHaveBeenCalledOnce();
});
it('closes a connector that arrives after its owner is cancelled',async()=>{
  const controller=new AbortController();let finish!:(adapter:FlowAdapter)=>void;
  const raw={call:vi.fn<FlowAdapter['call']>(),close:vi.fn(async()=>{})};
  const connect=vi.fn(()=>new Promise<FlowAdapter>(resolve=>{finish=resolve;}));
  const pending=connectOwnedFlowAdapter(connect,async()=>{},controller.signal);await vi.waitFor(()=>expect(connect).toHaveBeenCalledOnce());controller.abort();finish(raw);
  await expect(pending).rejects.toThrow();expect(raw.close).toHaveBeenCalledOnce();expect(raw.call).not.toHaveBeenCalled();
});
it('shares cleanup while a request is in flight and refuses its later response',async()=>{
  let finish!:(value:unknown)=>void;const raw={call:vi.fn<FlowAdapter['call']>(()=>new Promise(resolve=>{finish=resolve;})),close:vi.fn(async()=>{})};
  const adapter=await connectOwnedFlowAdapter(async()=>raw,async()=>{},new AbortController().signal);
  const pending=adapter.call('get_run_history',{});await vi.waitFor(()=>expect(raw.call).toHaveBeenCalledOnce());
  const first=adapter.close();expect(adapter.close()).toBe(first);await first;finish([]);await expect(pending).rejects.toThrow('closed');expect(raw.close).toHaveBeenCalledOnce();
});
it('preserves admission failure and cleanup failure without returning a usable connector',async()=>{
  let checks=0;const raw={call:vi.fn<FlowAdapter['call']>(),close:vi.fn(async()=>{throw new Error('cleanup failed');})};
  await expect(connectOwnedFlowAdapter(async()=>raw,async()=>{if(++checks>1)throw new Error('ownership lost');},new AbortController().signal)).rejects.toThrow('admission and cleanup failed');expect(raw.call).not.toHaveBeenCalled();
});
it('does not open a connector when initially cancelled or ownership is unavailable',async()=>{
  const connect=vi.fn<()=>Promise<FlowAdapter>>();const controller=new AbortController();controller.abort();
  await expect(connectOwnedFlowAdapter(connect,async()=>{},controller.signal)).rejects.toThrow();
  await expect(connectOwnedFlowAdapter(connect,async()=>{throw new Error('ownership unavailable');},new AbortController().signal)).rejects.toThrow('ownership unavailable');expect(connect).not.toHaveBeenCalled();
});
it('keeps an owned connector reusable after an ordinary tool error without accepting that error as success',async()=>{
  const raw={call:vi.fn<FlowAdapter['call']>().mockRejectedValueOnce(new Error('transient provider failure')).mockResolvedValueOnce({state:'Started'}),close:vi.fn(async()=>{})};
  const adapter=await connectOwnedFlowAdapter(async()=>raw,async()=>{},new AbortController().signal);
  await expect(adapter.call('get_flow',{})).rejects.toThrow('transient provider failure');
  expect(await adapter.call('get_flow',{})).toEqual({state:'Started'});expect(raw.close).not.toHaveBeenCalled();await adapter.close();expect(raw.close).toHaveBeenCalledOnce();
});
