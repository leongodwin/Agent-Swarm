import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({net:vi.fn(),http:vi.fn(),connect:vi.fn(),spawn:vi.fn(),native:vi.fn()}));
vi.mock('node:net',()=>({default:{createServer:mocks.net,connect:mocks.connect}}));
vi.mock('node:http',()=>({default:{createServer:mocks.http}}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('@lydell/node-pty',()=>({spawn:mocks.native}));
class Socket extends EventEmitter {
  destroyed=false;writes:Record<string,unknown>[]=[];setEncoding=vi.fn();
  write(value:string){this.writes.push(JSON.parse(value));return true;}
  destroy(){this.destroyed=true;this.emit('close');return this;}
  message(value:unknown){this.emit('data',JSON.stringify(value)+'\n');}
}
let dir='',oldArgs:string[]=[];
let connection:(socket:Socket)=>void,request:(req:EventEmitter&{method:string;url:string},res:ReturnType<typeof response>)=>void;
let network:EventEmitter&{listen:ReturnType<typeof vi.fn>};
const response=()=>({writableEnded:false,writeHead:vi.fn().mockReturnThis(),end:vi.fn().mockReturnThis()});
const native=()=>{const terminal={pid:112233,write:vi.fn(),resize:vi.fn(),kill:vi.fn(),onData:vi.fn(),onExit:vi.fn()};mocks.native.mockReturnValue(terminal);return terminal;};
const spawnMessage=(id='fixture')=>({op:'spawn',id,file:'synthetic',args:[],cwd:dir,env:{},cols:80,rows:24,meta:{agent:'test'}});
function office(){const socket=new Socket();connection(socket);socket.message({op:'hello',version:2,secret:'synthetic-secret'});return socket;}
function hook(body:unknown,url='/api/hooks/synthetic',method='POST'){const req=Object.assign(new EventEmitter(),{method,url}),res=response();request(req,res);req.emit('data',Buffer.from(typeof body==='string'?body:JSON.stringify(body)));req.emit('end');return res;}
const cleanup: [string,((...args:unknown[])=>void)[]][]=[];
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();for(const mock of Object.values(mocks))mock.mockReset();dir=fs.mkdtempSync(path.join(os.tmpdir(),'cf-runtime-host-'));fs.writeFileSync(path.join(dir,'pty.secret'),'synthetic-secret');oldArgs=process.argv;process.argv=[process.execPath,'synthetic-pty-host.ts','serve',path.join(dir,'socket'),path.join(dir,'pty.secret')];
  for(const signal of ['uncaughtException','SIGINT','SIGHUP','SIGBREAK'])cleanup.push([signal,process.listeners(signal) as ((...args:unknown[])=>void)[]]);
  network=Object.assign(new EventEmitter(),{listen:vi.fn()});mocks.net.mockImplementation(cb=>{connection=cb;return network;});mocks.http.mockImplementation(cb=>{request=cb;return {listen:(_port:number,_host:string,cb:()=>void)=>cb(),address:()=>({port:1234})};});
  mocks.spawn.mockReturnValue({once:vi.fn().mockReturnThis(),unref:vi.fn()});vi.spyOn(process,'exit').mockImplementation(()=>undefined as never);vi.spyOn(process,'kill').mockImplementation(()=>true);
});
afterEach(()=>{for(const [name,previous] of cleanup.splice(0)){for(const listener of process.listeners(name))if(!previous.includes(listener as (...args:unknown[])=>void))process.removeListener(name,listener);}process.argv=oldArgs;vi.useRealTimers();vi.restoreAllMocks();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10});});

it('rejects unauthenticated sockets, supersedes an old office, and exposes keeper identity without its secret',async()=>{
  await import('./ptyHost.ts');expect(network.listen).toHaveBeenCalledWith(path.join(dir,'socket'));
  const invalid=new Socket();connection(invalid);invalid.message({op:'hooksReady'});expect(invalid.destroyed).toBe(true);
  const wrong=new Socket();connection(wrong);wrong.message({op:'hello',secret:'wrong'});expect(wrong.destroyed).toBe(true);
  const first=office(),second=office();expect(first.destroyed).toBe(true);expect(second.writes[0]).toMatchObject({op:'ready',version:2,ptys:[],instance:expect.stringMatching(/^[a-f0-9-]{36}$/)});expect(JSON.stringify(second.writes)).not.toContain('synthetic-secret');
});

it('relays native IO, survives native operation races, and updates held metadata for the next office',async()=>{
  const terminal=native();await import('./ptyHost.ts');const first=office();first.message(spawnMessage());
  expect(first.writes.at(-1)).toEqual({op:'spawned',id:'fixture',pid:112233});first.message({op:'write',id:'fixture',data:'hello'});first.message({op:'resize',id:'fixture',cols:90,rows:40});expect(terminal.write).toHaveBeenCalledWith('hello');expect(terminal.resize).toHaveBeenCalledWith(90,40);
  terminal.write.mockImplementation(()=>{throw new Error('native exit race');});expect(()=>first.message({op:'write',id:'fixture',data:'race'})).not.toThrow();first.message({op:'meta',id:'fixture',meta:{updated:true}});terminal.onData.mock.calls[0][0]('output');expect(first.writes.at(-1)).toEqual({op:'data',id:'fixture',data:'output'});
  first.destroy();const second=office();expect(second.writes[0]).toMatchObject({ptys:[{id:'fixture',pid:112233,meta:{updated:true},exit:null}]});second.message({op:'attach',id:'unknown'});expect(second.writes.at(-1)).toEqual({op:'exit',id:'unknown',code:-1});
});

it('refreshes the asynchronous Windows native PID before forwarding first terminal data',async()=>{
  const terminal=native();terminal.pid=0;await import('./ptyHost.ts');const socket=office();socket.message(spawnMessage());
  expect(socket.writes.at(-1)).toEqual({op:'spawned',id:'fixture',pid:0});
  terminal.pid=445566;terminal.onData.mock.calls[0][0]('native-ready');
  expect(socket.writes.slice(-2)).toEqual([{op:'spawned',id:'fixture',pid:445566},{op:'data',id:'fixture',data:'native-ready'}]);
  terminal.onData.mock.calls[0][0]('more data');expect(socket.writes.filter(row=>row.op==='spawned')).toHaveLength(2);
});

it('replays bounded detached output and native exit before deleting an adopted finished terminal',async()=>{
  const terminal=native();await import('./ptyHost.ts');const first=office();first.message(spawnMessage());first.destroy();const onData=terminal.onData.mock.calls[0][0],onExit=terminal.onExit.mock.calls[0][0];
  onData('discarded'.repeat(200000));onData('retained'.repeat(200000));onExit({exitCode:3});expect(terminal.kill).toHaveBeenCalledOnce();
  const second=office();expect(second.writes[0]).toMatchObject({ptys:[{id:'fixture',exit:3}]});second.message({op:'attach',id:'fixture'});expect(second.writes.slice(-2)).toEqual([{op:'data',id:'fixture',data:'retained'.repeat(200000)},{op:'exit',id:'fixture',code:3}]);const third=office();expect(third.writes[0]).toMatchObject({ptys:[]});
});

it('reports native spawn failure and tolerates duplicate/unknown terminal commands',async()=>{
  mocks.native.mockImplementation(()=>{throw new Error('synthetic missing executable');});await import('./ptyHost.ts');const socket=office();socket.message(spawnMessage());expect(socket.writes.at(-1)).toEqual({op:'failed',id:'fixture',error:'synthetic missing executable'});
  for(const op of ['write','resize','meta','kill'])expect(()=>socket.message({op,id:'missing'})).not.toThrow();
});

it('holds hooks until readiness, replays unanswered hooks after restart and answers each request once',async()=>{
  await import('./ptyHost.ts');const first=office(),res=hook({hook_event_name:'PreToolUse'});expect(first.writes).toHaveLength(1);first.message({op:'hooksReady'});expect(first.writes.at(-1)).toMatchObject({op:'hook',token:'synthetic',body:{hook_event_name:'PreToolUse'}});const rid=first.writes.at(-1)!.rid;
  first.destroy();const second=office();second.message({op:'hooksReady'});expect(second.writes.at(-1)).toMatchObject({op:'hook',rid});second.message({op:'hookReply',rid,answer:{allowed:true}});second.message({op:'hookReply',rid,answer:{allowed:false}});expect(res.end).toHaveBeenCalledExactlyOnceWith('{"allowed":true}');
});

it('denies tool execution when no office answers before the hook deadline and never overwrites an ended response',async()=>{
  await import('./ptyHost.ts');const denied=hook({hook_event_name:'PreToolUse'}),ended=hook({hook_event_name:'Stop'});ended.writableEnded=true;
  await vi.advanceTimersByTimeAsync(110000);expect(denied.end).toHaveBeenCalledWith(expect.stringContaining('"permissionDecision":"deny"'));expect(ended.end).not.toHaveBeenCalled();
});

it('rejects non-hook routes and treats malformed or empty hook bodies conservatively',async()=>{
  await import('./ptyHost.ts');const socket=office();socket.message({op:'hooksReady'});expect(hook({},'/api/hooks/synthetic','GET').writeHead).toHaveBeenCalledWith(404);const invalid=hook('not-json'),empty=hook('');expect(socket.writes.slice(-2).map(item=>item.body)).toEqual([{},{}]);socket.message({op:'hookReply',rid:socket.writes.at(-2)!.rid,answer:null});expect(invalid.end).toHaveBeenCalledWith('{}');socket.message({op:'hookReply',rid:socket.writes.at(-1)!.rid});expect(empty.end).toHaveBeenCalledWith('{}');
});

it('stops orphaned live process trees once, discards orphaned finished terminals and exits when empty',async()=>{
  const terminal=native();await import('./ptyHost.ts');const socket=office();socket.message(spawnMessage());socket.destroy();await vi.advanceTimersByTimeAsync(620000);
  if(process.platform==='win32')expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('taskkill',['/PID','112233','/T','/F'],expect.objectContaining({windowsHide:true}));else expect(process.kill).toHaveBeenCalledExactlyOnceWith(-112233,'SIGTERM');
  terminal.onExit.mock.calls[0][0]({exitCode:0});await vi.advanceTimersByTimeAsync(10000);expect(process.exit).toHaveBeenCalledWith(0);
});

it('kills live terminals on explicit shutdown and removes stopped finished terminals',async()=>{
  const terminal=native();await import('./ptyHost.ts');const socket=office();socket.message(spawnMessage());socket.message({op:'shutdown'});await vi.advanceTimersByTimeAsync(3000);expect(process.exit).toHaveBeenCalledWith(0);socket.destroy();terminal.onExit.mock.calls[0][0]({exitCode:1});const next=office();next.message({op:'kill',id:'fixture'});const third=office();expect(third.writes[0]).toMatchObject({ptys:[]});
});

it('exits on a nonrecoverable socket bind failure and records the failure in its isolated log',async()=>{
  await import('./ptyHost.ts');const append=vi.spyOn(fs,'appendFile').mockImplementation((...args:unknown[])=>{const callback=args.at(-1);if(typeof callback==='function')callback(null);});vi.mocked(process.exit).mockImplementation(()=>{throw new Error('synthetic process exit');});expect(()=>network.emit('error',Object.assign(new Error('synthetic permission denied'),{code:'EACCES'}))).toThrow('synthetic process exit');expect(process.exit).toHaveBeenCalledWith(1);expect(append).toHaveBeenCalledWith(path.join(dir,'pty-host.log'),expect.stringContaining('cannot listen'),expect.any(Function));
});

it('does not orphan a live terminal while an office remains connected',async()=>{
  const terminal=native();await import('./ptyHost.ts');const socket=office();socket.message(spawnMessage());await vi.advanceTimersByTimeAsync(700000);expect(process.kill).not.toHaveBeenCalled();expect(mocks.spawn).not.toHaveBeenCalled();expect(process.exit).not.toHaveBeenCalled();socket.message({op:'kill',id:'fixture'});terminal.onExit.mock.calls[0][0]({exitCode:0});socket.destroy();const next=office();expect(next.writes[0]).toMatchObject({ptys:[]});
});

it.skipIf(process.platform==='win32')('probes an occupied Unix socket and preserves an answering keeper',async()=>{
  await import('./ptyHost.ts');const probe=new Socket();mocks.connect.mockImplementation((_path,cb:()=>void)=>{queueMicrotask(cb);return probe;});network.emit('error',Object.assign(new Error('synthetic occupied socket'),{code:'EADDRINUSE'}));await Promise.resolve();expect(probe.destroyed).toBe(true);expect(process.exit).toHaveBeenCalledWith(0);expect(network.listen).toHaveBeenCalledOnce();
});

it.skipIf(process.platform==='win32')('reclaims only a stale Unix socket when its keeper does not answer',async()=>{
  await import('./ptyHost.ts');const probe=new Socket();mocks.connect.mockReturnValue(probe);network.emit('error',Object.assign(new Error('synthetic stale socket'),{code:'EADDRINUSE'}));probe.emit('error',new Error('synthetic refusal'));expect(network.listen).toHaveBeenCalledTimes(2);expect(process.exit).not.toHaveBeenCalled();
});
