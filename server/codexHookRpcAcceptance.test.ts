import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:native.spawn}));
import {openCodexHookRpc} from './codexHookTrust.ts';
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
function fixture(){
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
 native.spawn.mockReturnValue(child);
 const rpc=openCodexHookRpc({file:'synthetic-codex',args:['--synthetic']},'C:/synthetic/desk',[{event:'PreToolUse',command:'node owned-hook.cjs',timeout:10}],{SYNTHETIC:'1'});
 const reply=(id:number,result:unknown)=>child.stdout.write(JSON.stringify({id,result})+'\n');
 const close=async()=>{const pending=rpc.close();child.emit('close');await pending;};
 return {child,rpc,reply,close};
}
it('initializes once, correlates concurrent replies, and ignores unsolicited notifications',async()=>{
 const f=fixture(),first=f.rpc.request('hooks/list',{cwds:['synthetic']}),second=f.rpc.request('config/read',{});
 expect(JSON.parse(f.child.stdin.read()!.toString()).method).toBe('initialize');f.reply(1,{});await Promise.resolve();await Promise.resolve();
 const lines=f.child.stdin.read()!.toString().trim().split('\n').map((line:string)=>JSON.parse(line));
 expect(lines.map((line:any)=>line.method)).toEqual(['initialized','hooks/list','config/read']);
 f.reply(999,{private:'unrelated'});f.reply(3,{config:'second'});f.reply(2,{hooks:'first'});
 expect(await first).toEqual({hooks:'first'});expect(await second).toEqual({config:'second'});
 expect(native.spawn).toHaveBeenCalledWith('synthetic-codex',expect.arrayContaining(['--synthetic','app-server','--enable','hooks']),expect.objectContaining({shell:false,windowsHide:true,env:{SYNTHETIC:'1'}}));await f.close();
});
it.each(['malformed','overflow','spawn','stdin','closed','deadline'] as const)('rejects pending native readiness on %s without leaking native diagnostics',async mode=>{
 if(mode==='deadline')vi.useFakeTimers();const f=fixture(),pending=f.rpc.request('hooks/list',{});const rejected=expect(pending).rejects.toThrow(/Codex hook/);
 if(mode==='malformed')f.child.stdout.write('private invalid JSON\n');
 if(mode==='overflow')f.child.stdout.emit('data',Buffer.alloc(4*1024*1024+1));
 if(mode==='spawn')f.child.emit('error',new Error('private spawn diagnostic'));
 if(mode==='stdin')f.child.stdin.emit('error',new Error('private transport diagnostic'));
 if(mode==='closed')f.child.emit('close');
 if(mode==='deadline')await vi.advanceTimersByTimeAsync(20000);
 await rejected;if(mode!=='closed')expect(f.child.kill).toHaveBeenCalled();await f.close();
});
it('rejects provider errors and refuses further requests after transport close',async()=>{
 const f=fixture(),pending=f.rpc.request('hooks/list',{});f.reply(1,{});await Promise.resolve();await Promise.resolve();
 const rejected=expect(pending).rejects.toThrow('Codex hook RPC rejected the request');f.child.stdout.write(JSON.stringify({id:2,error:{message:'private native failure'}})+'\n');await rejected;
 await f.close();await expect(f.rpc.request('config/read',{})).rejects.toThrow('Codex hook RPC is closed');
});
it('closes an idle native RPC without sending configuration mutations',async()=>{
 const f=fixture();await f.close();expect(f.child.stdin.read()).toBeNull();expect(f.child.kill).toHaveBeenCalledOnce();
});
