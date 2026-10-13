import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {launcherPolicyReader} from './launcherPolicyReader.ts';
import {PolicyReaderHost} from './policyReaderHost.mjs';
import type {StartPolicyReader} from './tenantDlp.ts';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const identity={tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',caller:'leon@graspai.co.uk'};
const requestId='11111111-1111-4111-8111-111111111111',nextId='22222222-2222-4222-8222-222222222222';
const readerPath=fileURLToPath(new URL('./tenantDlpReader.ps1',import.meta.url));

class Channel extends EventEmitter {
  connected=true;
  send=vi.fn((_value:unknown,callback?:(error?:Error|null)=>void)=>{callback?.();});
}

it('scopes IPC responses to the current owner and request and removes listeners on release',()=>{
  const channel=new Channel(),result=vi.fn(),end=vi.fn();const handle=launcherPolicyReader(channel)(identity,result,end,requestId);
  const ownerId=(channel.send.mock.calls[0][0] as {ownerId:string}).ownerId;
  channel.emit('message',{type:'office:policy',ownerId,requestId,event:'ready',pid:123});expect(handle.pid).toBe(123);
  handle.refresh(nextId);
  for(const response of [{ownerId,requestId},{ownerId:'33333333-3333-4333-8333-333333333333',requestId:nextId}])channel.emit('message',{type:'office:policy',event:'result',result:{old:true},...response});
  expect(result).not.toHaveBeenCalled();channel.emit('message',{type:'office:policy',ownerId,requestId:nextId,event:'result',result:{current:true}});
  expect(result).toHaveBeenCalledExactlyOnceWith({current:true},nextId);
  handle.stop(true);expect(channel.send.mock.calls.at(-1)?.[0]).toMatchObject({action:'release',keepWarm:true});
  expect(channel.listenerCount('message')).toBe(0);expect(channel.listenerCount('disconnect')).toBe(0);expect(end).not.toHaveBeenCalled();
});

it('fails closed on missing launcher, disconnect and send failures',()=>{
  const channel=new Channel();channel.connected=false;expect(()=>launcherPolicyReader(channel)(identity,vi.fn(),vi.fn(),requestId)).toThrow('unavailable');
  channel.connected=true;const end=vi.fn();launcherPolicyReader(channel)(identity,vi.fn(),end,requestId);channel.emit('disconnect');channel.emit('disconnect');expect(end).toHaveBeenCalledOnce();
  const broken=new Channel();broken.send.mockImplementation((_input,callback)=>{callback?.(new Error('closed'));});const failed=vi.fn();launcherPolicyReader(broken)(identity,vi.fn(),failed,requestId);expect(failed).toHaveBeenCalledOnce();
});

function fixture(script=readerPath) {
  const reports:Array<{result:(value:unknown,id:string)=>void;end:()=>void;refresh:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}>=[];
  const start=vi.fn<StartPolicyReader>((_identity,result,end)=>{const refresh=vi.fn(),stop=vi.fn();reports.push({result,end,refresh,stop});return {pid:123,refresh,stop};});
  const host=new PolicyReaderHost(script,start);return {host,start,reports};
}
const read=(ownerId=requestId,id=requestId,account=identity)=>({type:'office:policy',action:'read',ownerId,requestId:id,identity:account});

it('retains a warm native reader across office ownership and queues a read behind detached authentication',()=>{
  const {host,start,reports}=fixture();const first=new Channel(),second=new Channel();
  host.handle(first,read());host.handle(first,{type:'office:policy',action:'release',ownerId:requestId,keepWarm:true});
  host.handle(second,read(nextId,nextId));expect(start).toHaveBeenCalledOnce();expect(reports[0].refresh).not.toHaveBeenCalled();
  host.handle(first,read(requestId,requestId,{...identity,caller:'other@company.test'}));expect(start).toHaveBeenCalledOnce();expect(reports[0].stop).not.toHaveBeenCalled();
  reports[0].result({old:true},requestId);expect(reports[0].refresh).toHaveBeenCalledExactlyOnceWith(nextId);
  expect(second.send.mock.calls.some(([value])=>(value as {event:string}).event==='result')).toBe(false);
  reports[0].result({fresh:true},nextId);expect(second.send.mock.calls.at(-1)?.[0]).toMatchObject({event:'result',requestId:nextId,result:{fresh:true}});
  host.clear();expect(reports[0].stop).toHaveBeenCalledOnce();
});

it('rejects competing owners, malformed commands and client-supplied executable paths',()=>{
  const {host,start,reports}=fixture();const first=new Channel(),other=new Channel();
  expect(host.handle(first,{...read(),readerPath:'evil.ps1'})).toBe(false);expect(start).not.toHaveBeenCalled();
  host.handle(first,read());host.handle(other,read(nextId,nextId));expect(other.send.mock.calls.at(-1)?.[0]).toMatchObject({event:'ended'});
  host.handle(other,read(nextId,nextId,{...identity,caller:'other@company.test'}));expect(start).toHaveBeenCalledOnce();expect(reports[0].stop).not.toHaveBeenCalled();
  host.handle(other,{type:'office:policy',action:'release',ownerId:requestId,keepWarm:false});expect(reports[0].stop).not.toHaveBeenCalled();
  host.clear();
});

it('replaces identity scopes and ignores old-process results and terminations',()=>{
  const {host,start,reports}=fixture();const client=new Channel();host.handle(client,read());
  host.handle(client,{type:'office:policy',action:'release',ownerId:requestId,keepWarm:true});
  host.handle(client,read(nextId,nextId,{...identity,caller:'other@company.test'}));expect(start).toHaveBeenCalledTimes(2);expect(reports[0].stop).toHaveBeenCalledOnce();
  client.send.mockClear();reports[0].result({wrongAccount:true},nextId);reports[0].end();expect(client.send).not.toHaveBeenCalled();
  reports[1].result({current:true},nextId);expect(client.send.mock.calls.at(-1)?.[0]).toMatchObject({result:{current:true}});host.clear();
});

it('expires idle readers and retires them on ordinary office disconnect',async()=>{
  vi.useFakeTimers();const {host,reports}=fixture();const client=new Channel();
  try {host.handle(client,read());reports[0].result({},requestId);host.disconnect(client,true);await vi.advanceTimersByTimeAsync(30*60_000);expect(reports[0].stop).toHaveBeenCalledOnce();
    host.handle(client,read(nextId,nextId));host.disconnect(client);expect(reports[1].stop).toHaveBeenCalledOnce();}
  finally {host.clear();vi.useRealTimers();}
});

it('keeps the original authentication deadline across a detached office reload',async()=>{
  vi.useFakeTimers();const {host,reports}=fixture();const first=new Channel(),second=new Channel();
  try {host.handle(first,read());await vi.advanceTimersByTimeAsync(9*60_000);host.disconnect(first,true);
    host.handle(second,read(nextId,nextId));await vi.advanceTimersByTimeAsync(60_000);
    expect(reports[0].stop).toHaveBeenCalledOnce();expect(second.send.mock.calls.at(-1)?.[0]).toMatchObject({event:'ended',requestId:nextId});}
  finally {host.clear();vi.useRealTimers();}
});

it('replaces a cached process when the reader script changes and fails safely when it disappears',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-policy-revision-')),script=path.join(root,'reader.ps1');
  await fs.writeFile(script,'version one');const {host,start,reports}=fixture(script);const client=new Channel();
  try {
    host.handle(client,read());reports[0].result({},requestId);host.disconnect(client,true);
    await fs.writeFile(script,'version two');host.handle(client,read(nextId,nextId));
    expect(start).toHaveBeenCalledTimes(2);expect(reports[0].stop).toHaveBeenCalledOnce();
    host.disconnect(client,true);await fs.unlink(script);host.handle(client,read(requestId,requestId));
    expect(start).toHaveBeenCalledTimes(2);expect(client.send.mock.calls.at(-1)?.[0]).toMatchObject({event:'ended'});
    expect(reports[1].stop).toHaveBeenCalledOnce();
  } finally {host.clear();await fs.rm(root,{recursive:true,force:true});}
});
