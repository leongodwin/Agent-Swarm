import {EventEmitter} from 'node:events';
import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {LauncherReloadController,OfficeReloadRequester,type ReloadPeer} from './officeReload.mjs';
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();vi.useRealTimers();});
class Peer extends EventEmitter implements ReloadPeer {
  connected=true;
  constructor(public pid:number){super();}
  send=vi.fn<(value:unknown,callback?:(error?:Error|null)=>void)=>void>();
}
function fixture(){
  const parentPeer=new Peer(123),clientPeer=new Peer(123),next=new Peer(456);
  let current:Peer|undefined=parentPeer,busy=false;
  const restart=vi.fn(async()=>{current=next;return next;});
  const report=vi.fn();
  const controller=new LauncherReloadController({current:()=>current,busy:()=>busy,restart,report,prepareMs:100,readyMs:100});
  const client=new OfficeReloadRequester(clientPeer,50);
  parentPeer.send.mockImplementation((msg,cb)=>{clientPeer.emit('message',msg);cb?.();});
  clientPeer.send.mockImplementation((msg,cb)=>{controller.handle(parentPeer,msg);cb?.();});
  cleanup.push(()=>{client.close();controller.close();});
  return {client,controller,parentPeer,clientPeer,next,restart,report,setBusy:(value:boolean)=>{busy=value;}};
}
it('acknowledges prepare without stopping, then commits once and waits for replacement listener readiness',async()=>{
  const f=fixture();await f.client.probe();expect(f.client.view()).toMatchObject({supported:true,phase:'idle'});
  const prepared=await f.client.prepare();expect(f.restart).not.toHaveBeenCalled();expect(f.controller.state.phase).toBe('prepared');
  expect(await prepared.commit()).toBe('accepted');expect(f.restart).toHaveBeenCalledOnce();
  expect(f.controller.state).toMatchObject({phase:'restarting',sourcePid:123,targetPid:456,operationId:prepared.operationId});
  f.controller.handle(f.next,{type:'office:reload',action:'ready',requestId:crypto.randomUUID(),pid:456});
  expect(f.controller.state.phase).toBe('ready');expect(f.controller.owns(f.parentPeer)).toBe(false);
  await prepared.commit();expect(f.restart).toHaveBeenCalledOnce();
});
it('cancels and expires prepared reservations without stopping a server',async()=>{
  vi.useFakeTimers();const f=fixture();const cancelled=await f.client.prepare();cancelled.cancel();await vi.advanceTimersByTimeAsync(0);
  expect(f.controller.state.phase).toBe('idle');expect(f.restart).not.toHaveBeenCalled();
  await f.client.prepare();await vi.advanceTimersByTimeAsync(101);
  expect(f.controller.state.phase).toBe('failed');expect(f.restart).not.toHaveBeenCalled();expect(f.report).toHaveBeenCalledOnce();
});
it('rejects a second caller before it can replace the active reservation',async()=>{
  const f=fixture();const first=f.client.prepare();await expect(f.client.prepare()).rejects.toThrow('already prepared');
  (await first).cancel();expect(f.restart).not.toHaveBeenCalled();
});
it('refuses an update/stop collision at both prepare and commit',async()=>{
  const f=fixture();f.setBusy(true);await expect(f.client.prepare()).rejects.toThrow('updating');
  f.setBusy(false);const prepared=await f.client.prepare();f.setBusy(true);
  expect(await prepared.commit()).toBe('refused');expect(f.restart).not.toHaveBeenCalled();expect(f.controller.state.phase).toBe('failed');
});
it('ignores malformed messages and rejects a foreign child even with a known operation ID',async()=>{
  const f=fixture();const prepared=await f.client.prepare();const foreign=new Peer(999);
  for(const input of [null,{}, {type:'office:reload',action:'commit',requestId:prepared.operationId,pid:'123'}])f.controller.handle(f.parentPeer,input);
  f.controller.handle(foreign,{type:'office:reload',action:'commit',requestId:prepared.operationId,pid:999});
  f.controller.handle(f.parentPeer,{type:'office:reload',action:'commit',requestId:prepared.operationId,pid:999});
  expect(f.restart).not.toHaveBeenCalled();prepared.cancel();
});
it('rejects commits with a different reservation and keeps cancellation from undoing a committed restart',async()=>{
  const f=fixture();const prepared=await f.client.prepare();
  f.controller.handle(f.parentPeer,{type:'office:reload',action:'commit',requestId:crypto.randomUUID(),pid:123});expect(f.restart).not.toHaveBeenCalled();
  await prepared.commit();prepared.cancel();expect(f.restart).toHaveBeenCalledOnce();expect(f.controller.state.phase).toBe('restarting');
});
it('leaves an older or disconnected launcher running and reports unsupported status',async()=>{
  vi.useFakeTimers();const f=fixture();f.clientPeer.send.mockImplementation((_msg,cb)=>{cb?.();});
  const pending=expect(f.client.prepare()).rejects.toThrow('did not acknowledge');await vi.advanceTimersByTimeAsync(51);await pending;
  expect(f.restart).not.toHaveBeenCalled();expect(f.client.view()).toMatchObject({supported:false});
  f.clientPeer.connected=false;await expect(f.client.prepare()).rejects.toThrow('unavailable');
});
it.each(['throw','callback','disconnect'])('fails preparation without shutdown on IPC %s',mode=>{
  const f=fixture();f.clientPeer.send.mockImplementation((_msg,cb)=>{
    if(mode==='throw')throw new Error('Synthetic transport failure');
    if(mode==='callback')cb?.(new Error('Synthetic transport failure'));
    if(mode==='disconnect')f.clientPeer.emit('disconnect');
  });
  return expect(f.client.prepare()).rejects.toThrow().then(()=>expect(f.restart).not.toHaveBeenCalled());
});
it('reports an unknown commit outcome without interpreting a timeout as a completed reload',async()=>{
  vi.useFakeTimers();const f=fixture();const prepared=await f.client.prepare();
  f.clientPeer.send.mockImplementation((_msg,cb)=>cb?.());const pending=prepared.commit();await vi.advanceTimersByTimeAsync(51);
  expect(await pending).toBe('unknown');expect(f.client.view()).toMatchObject({phase:'failed',supported:false});expect(f.restart).not.toHaveBeenCalled();
});
it('rejects pending work on close and detaches native transport listeners',async()=>{
  const f=fixture();f.clientPeer.send.mockImplementation(()=>{});const pending=expect(f.client.prepare()).rejects.toThrow('closed');
  f.client.close();await pending;expect(f.clientPeer.listenerCount('message')).toBe(0);expect(f.clientPeer.listenerCount('disconnect')).toBe(0);
  await expect(f.client.prepare()).rejects.toThrow('closed');
});
it('does not replace an acknowledged response with a late transport callback error',async()=>{
  const f=fixture();f.clientPeer.send.mockImplementation((msg,cb)=>{f.controller.handle(f.parentPeer,msg);cb?.(new Error('Synthetic late callback error'));});
  const prepared=await f.client.prepare();expect(f.client.view()).toMatchObject({supported:true,phase:'prepared'});expect(await prepared.commit()).toBe('accepted');expect(f.restart).toHaveBeenCalledOnce();
});
it.each(['rejected','missing'])('reports a %s replacement without claiming readiness or retrying',async mode=>{
  const f=fixture();if(mode==='rejected')f.restart.mockRejectedValueOnce(new Error('Synthetic failure'));
  else f.restart.mockResolvedValueOnce(undefined as unknown as Peer);
  const prepared=await f.client.prepare();await prepared.commit();await vi.waitFor(()=>expect(f.controller.state.phase).toBe('failed'));
  expect(f.restart).toHaveBeenCalledOnce();expect(f.report).toHaveBeenCalledOnce();
});
it('reports native failure before replacement readiness, while a clean original exit preserves ownership',async()=>{
  const f=fixture();const prepared=await f.client.prepare();await prepared.commit();
  f.controller.exited(f.parentPeer,0);expect(f.controller.state.phase).toBe('restarting');expect(f.controller.owns(f.parentPeer)).toBe(true);
  f.controller.exited(f.next,1);expect(f.controller.state.phase).toBe('failed');expect(f.report).toHaveBeenCalledOnce();
});
it('continues observing the same replacement after a readiness timeout and accepts its later listener evidence',async()=>{
  vi.useFakeTimers();const f=fixture();const prepared=await f.client.prepare();await prepared.commit();
  await vi.advanceTimersByTimeAsync(101);
  expect(f.controller.state).toMatchObject({phase:'restarting',targetPid:456,reason:expect.stringContaining('same native server')});expect(f.restart).toHaveBeenCalledOnce();
  f.controller.handle(f.next,{type:'office:reload',action:'ready',requestId:crypto.randomUUID(),pid:456});
  expect(f.controller.state.phase).toBe('ready');expect(f.restart).toHaveBeenCalledOnce();
});
