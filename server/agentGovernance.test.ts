import { afterEach, expect, it, vi } from 'vitest';
import { governTool, setToolGovernanceGate, evaluateToolRequest } from './toolGovernance.ts';
const captured=vi.hoisted(()=>({options:null as any}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:({options}:any)=>{
  captured.options=options;
  return (async function*(){yield {type:'result',subtype:'success',is_error:false,result:'synthetic',total_cost_usd:0,num_turns:1};})();
}}));
import { startSession } from './agentRunner.ts';
afterEach(()=>{setToolGovernanceGate(async()=>({status:'unavailable',reason:'Not initialized'}));captured.options=null;});
async function options(authorizeTool: (() => string | null) | undefined = () => null){
 await new Promise<void>(resolve=>startSession({cwd:process.cwd(),prompt:'synthetic',systemAppend:'',model:'test',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',agentId:'developer-1',authorizeTool},
 {log:()=>{},tool:()=>{},sessionId:()=>{},browserUrl:()=>{},screenshot:()=>{},finished:()=>resolve()}));return captured.options;
}
it('checks tools through the SDK pre-tool hook even when edit permissions would otherwise bypass canUseTool',async()=>{
 const calls:any[]=[];setToolGovernanceGate(async(name,input,checkpoint)=>{calls.push(checkpoint);return evaluateToolRequest(name,input,true);});
 const opts=await options();expect(opts.permissionMode).toBe('acceptEdits');
 const callback=opts.hooks.PreToolUse[0].hooks[0];
 const denied=await callback({hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{file_path:'Workflows/flow.json',content:'{"connector":"shared_dropbox"}'}},'tool-1',{});
 expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');expect(calls[0]).toMatchObject({actor:'developer-1',source:'sdk-hook'});
 expect(await callback({hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{file_path:'Workflows/flow.json'}},'tool-2',{})).toEqual({});
 expect(await opts.canUseTool('Bash',{command:'pac copilot publish'},{})).toMatchObject({behavior:'deny'});
 expect(calls.at(-1).source).toBe('sdk-permission');
});
it('revokes SDK hook and permission grants when the task ends during governance evaluation', async () => {
 let active=true; let complete!: () => void;
 setToolGovernanceGate(()=>new Promise(resolve=>{complete=()=>resolve({status:'allowed',reason:'Synthetic gate passed'});}));
 const opts=await options(()=>active?null:'Task revoked');
 const pending=opts.canUseTool('Read',{},{});
 for(let i=0;i<20&&!complete;i++)await Promise.resolve();
 active=false; complete();
 expect(await pending).toMatchObject({behavior:'deny',message:'Task revoked'});
 const result=await opts.hooks.PreToolUse[0].hooks[0]({hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}},'tool-4',{});
 expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
});
it('keeps governance failures closed in both SDK dispatch paths',async()=>{
 setToolGovernanceGate(async()=>{throw new Error('secret failure');});const opts=await options();
 expect(await opts.canUseTool('Write',{},{})).toMatchObject({behavior:'deny'});
 const result=await opts.hooks.PreToolUse[0].hooks[0]({hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}},'tool-3',{});
 expect(result.hookSpecificOutput.permissionDecision).toBe('deny');expect(JSON.stringify(result)).not.toContain('secret failure');
 expect((await governTool('Read',{}, {actor:'dev',runtime:'sdk',source:'sdk-hook'})).status).toBe('unavailable');
});
