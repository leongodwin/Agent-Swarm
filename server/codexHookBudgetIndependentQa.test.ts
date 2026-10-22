import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {CODEX_HOOK_SOURCE,CODEX_HOOK_EVENTS,codexHookInvocation,codexHookTimeout,launchArgs,type LaunchContext} from './clis.ts';
import {establishCodexHookTrust,type HookRpc} from './codexHookTrust.ts';
const ctx:LaunchContext={prompt:'Synthetic',systemAppend:'Synthetic',model:'openai/gpt-synthetic',effort:'medium',sessionId:'synthetic',name:'QA',role:'dev',additionalDirectories:[],files:{settings:'settings.json',mcp:null,system:'instructions.md'},notify:{script:'notify.cjs',url:'http://127.0.0.1:1/api/hooks/test'},codexHook:'owned-hook.cjs',plugin:'file:///plugin.mjs',browser:null};
it('generates native hook budgets that outlast the bounded relay and verifies exactly those budgets',async()=>{
 const launch=launchArgs('codex',ctx),specs=CODEX_HOOK_EVENTS.map(event=>({event,command:codexHookInvocation(ctx.codexHook,event),timeout:codexHookTimeout(event)}));
 for(const spec of specs){expect(launch.args).toContain(`hooks.${spec.event}=[{hooks=[{type="command",command=${JSON.stringify(spec.command)},timeout=${spec.timeout}}]}]`);if(spec.event==='Interrupt')expect(spec.timeout).toBe(3);else expect(spec.timeout).toBeGreaterThan(30);}
 const names:Record<string,string>={SessionStart:'sessionStart',UserPromptSubmit:'userPromptSubmit',PreToolUse:'preToolUse',PostToolUse:'postToolUse',Interrupt:'interrupt'};
 const inventory=specs.map((s,i)=>({key:`owned-${i}`,eventName:names[s.event],handlerType:'command',command:s.command,source:'sessionFlags',enabled:true,isManaged:false,currentHash:`sha256:${'a'.repeat(64)}`,trustStatus:'trusted',matcher:null,timeoutSec:s.timeout,async:false}));
 const rpc:HookRpc={close:async()=>{},request:async method=>method==='config/read'?{config:{features:{hooks:true}}}:method==='configRequirements/read'?{requirements:null}:{data:[{cwd:process.cwd(),hooks:inventory,warnings:[],errors:[]}]}};
 expect((await establishCodexHookTrust(rpc,process.cwd(),specs,async()=>{})).verified).toBe(specs.length);
 inventory.find(x=>x.eventName==='preToolUse')!.timeoutSec=10;await expect(establishCodexHookTrust(rpc,process.cwd(),specs,async()=>{})).rejects.toThrow('configuration cannot be verified');
});
it('returns a structured denial when the relay request reaches its bounded deadline',async()=>{
 const input=new EventEmitter(),writes:string[]=[],errors:string[]=[];let relayDeadline=0;
 const proc={argv:['node','owned-hook.cjs','http://127.0.0.1:1/api/hooks/test','--event','PreToolUse'],env:{},stdin:input,stdout:{write:(v:string)=>writes.push(v)},stderr:{write:(v:string)=>errors.push(v)},exitCode:undefined as number|undefined};
 const fetch=vi.fn(async(_url:unknown,options:any)=>{throw options.signal.reason;});
 vm.runInNewContext(CODEX_HOOK_SOURCE,{process:proc,Buffer,URL,__filename:'owned-hook.cjs',require:(id:string)=>id==='node:crypto'?crypto:{readFileSync:()=>Buffer.from(CODEX_HOOK_SOURCE)},fetch,AbortSignal:{timeout:(ms:number)=>{relayDeadline=ms;return AbortSignal.abort(new DOMException('Synthetic deadline','TimeoutError'));}}});
 input.emit('data',Buffer.from(JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{content:'synthetic'}})));input.emit('end');await vi.waitFor(()=>expect(writes).toHaveLength(1));
 expect(relayDeadline).toBe(30000);expect(codexHookTimeout('PreToolUse')*1000).toBeGreaterThan(relayDeadline);const decision=JSON.parse(writes[0]);expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('timeout');expect(proc.exitCode).toBe(0);expect(fetch).toHaveBeenCalledOnce();
});
