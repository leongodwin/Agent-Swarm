import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fake=vi.hoisted(()=>({connect:vi.fn(),spawn:vi.fn(),native:vi.fn()}));
vi.mock('node:net',()=>({default:{connect:fake.connect}}));
vi.mock('node:child_process',()=>({spawn:fake.spawn}));
vi.mock('@lydell/node-pty',()=>({spawn:fake.native}));

class Socket extends EventEmitter {
  destroyed=false;
  writes:Record<string,unknown>[]=[];
  setEncoding=vi.fn();
  write(value:string){this.writes.push(JSON.parse(value));return true;}
  destroy(){this.destroyed=true;this.emit('close');return this;}
  end(value?:string){if(value)this.write(value);this.emit('close');return this;}
  message(value:unknown){this.emit('data',JSON.stringify(value)+'\n');}
}
let homes:string[]=[];
const home=()=>{const result=fs.mkdtempSync(path.join(os.tmpdir(),'cf-runtime-client-'));homes.push(result);return result;};
const ready=(overrides:Record<string,unknown>={})=>({op:'ready',version:2,hookPort:4321,pid:123,instance:'synthetic-instance',ptys:[],...overrides});
const options={cols:80,rows:24,cwd:os.tmpdir(),env:{}};
function answer(socket:Socket,value:unknown){fake.connect.mockImplementationOnce(()=>{queueMicrotask(()=>{socket.emit('connect');socket.message(value);});return socket;});}
beforeEach(()=>{vi.resetModules();fake.connect.mockReset();fake.spawn.mockReset();fake.native.mockReset();fake.spawn.mockReturnValue({once:vi.fn().mockReturnThis(),unref:vi.fn()});vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'log').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();for(const dir of homes)fs.rmSync(dir,{recursive:true,force:true,maxRetries:10});homes=[];});

describe('terminal client synthetic keeper protocol',()=>{
  it('authenticates and forwards operations, preserves native exit exactly once and replays it to late subscribers',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket();answer(socket,ready());
    expect(await client.startKeeper(home(),()=>({}))).toEqual([]);
    expect(socket.writes[0]).toMatchObject({op:'hello',version:2,secret:expect.stringMatching(/^[a-f0-9]{48}$/)});
    expect(client.keeperPid()).toBe(123);expect(client.keeperInstance()).toBe('synthetic-instance');expect(client.keeperHookUrl()).toBe('http://127.0.0.1:4321');
    const terminal=client.spawnPty('synthetic',['arg'],options,{agent:'fixture'});
    const spawn=socket.writes.at(-1)!;expect(spawn).toMatchObject({op:'spawn',file:'synthetic',args:['arg'],meta:{agent:'fixture'}});
    socket.message({op:'spawned',id:spawn.id,pid:321});expect(terminal.pid).toBe(321);
    const received=vi.fn(),exited=vi.fn();terminal.onData(received);terminal.onExit(()=>{throw new Error('synthetic observer fault');});terminal.onExit(exited);
    terminal.write('input');terminal.resize(90,30);terminal.setMeta({updated:true});terminal.kill();
    expect(socket.writes.slice(-4)).toEqual([{op:'write',id:spawn.id,data:'input'},{op:'resize',id:spawn.id,cols:90,rows:30},{op:'meta',id:spawn.id,meta:{updated:true}},{op:'kill',id:spawn.id}]);
    socket.message({op:'data',id:spawn.id,data:'output'});socket.message({op:'exit',id:spawn.id,code:7});socket.message({op:'exit',id:spawn.id,code:9});
    expect(received).toHaveBeenCalledWith('output');expect(exited).toHaveBeenCalledExactlyOnceWith(7);expect(terminal.verifiedExit).toBe(true);
    expect(await new Promise<number>(resolve=>terminal.onExit(resolve))).toBe(7);
  });

  it('fails closed for governance exceptions while keeping successful hook replies distinct',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket();answer(socket,ready());
    await client.startKeeper(home(),token=>{if(token==='bad')throw new Error('secret diagnostic');return {allowed:true};});
    socket.message({op:'hook',rid:1,token:'bad',body:{hook_event_name:'PreToolUse'}});
    socket.message({op:'hook',rid:2,token:'bad',body:{hook_event_name:'Stop'}});
    socket.message({op:'hook',rid:3,token:'good',body:{}});
    for(let i=0;i<8;i++)await Promise.resolve();
    expect(socket.writes).toContainEqual({op:'hookReply',rid:1,answer:{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Office governance unavailable; tool execution denied'}}});
    expect(socket.writes).toContainEqual({op:'hookReply',rid:2,answer:{}});expect(socket.writes).toContainEqual({op:'hookReply',rid:3,answer:{allowed:true}});
  });

  it('marks unexpected transport loss unverified but preserves terminals on deliberate restart',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket();answer(socket,ready());await client.startKeeper(home(),()=>({}));
    const lost=client.spawnPty('fixture',[],options,{}),onLost=vi.fn();lost.onExit(onLost);socket.destroy();
    expect(onLost).toHaveBeenCalledExactlyOnceWith(-1);expect(lost.verifiedExit).toBe(false);expect(client.keeperPid()).toBe(0);expect(client.keeperInstance()).toBeNull();expect(client.keeperHookUrl()).toBeNull();
    const next=new Socket();answer(next,ready());await client.startKeeper(home(),()=>({}));const retained=client.spawnPty('fixture',[],options,{}),onRetained=vi.fn();retained.onExit(onRetained);
    client.leaveKeeper();expect(onRetained).not.toHaveBeenCalled();
  });

  it('adopts and discards held terminals without launching replacements and handles spawn failures',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket(),held={id:'held-fixture',pid:77,meta:{},exit:null};answer(socket,ready({ptys:[held]}));
    expect(await client.startKeeper(home(),()=>({}))).toEqual([held]);const terminal=client.adoptPty(held);expect(terminal.pid).toBe(77);await Promise.resolve();
    expect(socket.writes).toContainEqual({op:'attach',id:held.id});client.discardPty(held);client.hooksReady();expect(socket.writes.slice(-2)).toEqual([{op:'kill',id:held.id},{op:'hooksReady'}]);
    const failed=client.spawnPty('fixture',[],options,{}),exit=vi.fn(),id=socket.writes.at(-1)!.id;failed.onExit(exit);socket.message({op:'failed',id,error:'synthetic launch fault'});expect(exit).toHaveBeenCalledExactlyOnceWith(-1);expect(fake.native).not.toHaveBeenCalled();
  });

  it('preserves a live legacy keeper without pretending it has an instance identity',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket(),held={id:'legacy',pid:10,meta:{},exit:null};answer(socket,ready({version:1,ptys:[held]}));
    expect(await client.startKeeper(home(),()=>({}))).toEqual([held]);expect(client.keeperInstance()).toBeNull();expect(fake.spawn).not.toHaveBeenCalled();expect(socket.writes.some(row=>row.op==='shutdown')).toBe(false);
  });

  it('refuses to replace an incompatible keeper holding live terminals',async()=>{
    const client=await import('./ptyClient.ts'),socket=new Socket();answer(socket,ready({version:99,ptys:[{id:'live',pid:10,meta:{},exit:null}]}));
    await expect(client.startKeeper(home(),()=>({}))).rejects.toThrow('incompatible keeper holds live terminals');expect(fake.spawn).not.toHaveBeenCalled();expect(socket.writes.some(row=>row.op==='shutdown')).toBe(false);
  });

  it('replaces only an incompatible keeper with no live terminals',async()=>{
    vi.useFakeTimers();const client=await import('./ptyClient.ts'),old=new Socket(),next=new Socket();answer(old,ready({version:99,ptys:[{id:'ended',pid:10,meta:{},exit:0}]}));answer(next,ready());
    const started=client.startKeeper(home(),()=>({}));await vi.advanceTimersByTimeAsync(3800);expect(await started).toEqual([]);expect(old.writes).toContainEqual({op:'shutdown'});expect(fake.spawn).toHaveBeenCalledWith(process.execPath,expect.arrayContaining(['launch']),expect.objectContaining({detached:true,windowsHide:true,stdio:'ignore'}));
  });

  it('falls back after bounded keeper connection failures without launching a real process',async()=>{
    vi.useFakeTimers();const client=await import('./ptyClient.ts');fake.connect.mockImplementation(()=>{const socket=new Socket();queueMicrotask(()=>socket.emit('error',new Error('synthetic refusal')));return socket;});
    const started=client.startKeeper(home(),()=>({}));await vi.advanceTimersByTimeAsync(7000);expect(await started).toEqual([]);expect(fake.connect).toHaveBeenCalledTimes(31);expect(client.keeperHookUrl()).toBeNull();
  });

  it('returns safely if the keeper secret cannot be created',async()=>{
    const client=await import('./ptyClient.ts'),dir=home(),file=path.join(dir,'not-a-directory');fs.writeFileSync(file,'fixture');expect(await client.startKeeper(file,()=>({}))).toEqual([]);expect(fake.connect).not.toHaveBeenCalled();
  });
});

describe('local terminal synthetic fallback',()=>{
  it('forwards native operations and protects exit observers before and after native exit',async()=>{
    const data:((value:string)=>void)[]=[],exits:((value:{exitCode:number})=>void)[]=[];
    const native={pid:99,write:vi.fn(),resize:vi.fn(),kill:vi.fn(),onData:(cb:(value:string)=>void)=>data.push(cb),onExit:(cb:(value:{exitCode:number})=>void)=>exits.push(cb)};fake.native.mockReturnValue(native);
    const client=await import('./ptyClient.ts'),terminal=client.spawnPty('fixture',['test'],options,{}),received=vi.fn(),exit=vi.fn();
    expect(terminal.pid).toBe(99);expect(terminal.verifiedExit).toBe(false);terminal.onData(received);terminal.onExit(()=>{throw new Error('fixture');});terminal.onExit(exit);terminal.write('abc');terminal.resize(100,40);terminal.setMeta({});
    expect(native.write).toHaveBeenCalledWith('abc');expect(native.resize).toHaveBeenCalledWith(100,40);data[0]('output');exits[0]({exitCode:4});expect(received).toHaveBeenCalledWith('output');expect(exit).toHaveBeenCalledExactlyOnceWith(4);expect(terminal.verifiedExit).toBe(true);expect(await new Promise<number>(resolve=>terminal.onExit(resolve))).toBe(4);
    if(process.platform==='win32'){terminal.kill();expect(fake.spawn).toHaveBeenCalledWith('taskkill',['/PID','99','/T','/F'],expect.objectContaining({windowsHide:true}));}
    else {const kill=vi.spyOn(process,'kill').mockImplementation(()=>{throw new Error('synthetic missing group');});terminal.kill();expect(kill).toHaveBeenCalledWith(-99,'SIGTERM');expect(native.kill).toHaveBeenCalledOnce();}
  });
});
