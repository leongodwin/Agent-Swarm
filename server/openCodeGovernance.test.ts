import {afterEach,expect,it,vi} from 'vitest';
import {OPENCODE_PLUGIN_SOURCE} from './clis.ts';
import {evaluateToolRequest} from './toolGovernance.ts';
import {hookDecision} from '../shared/hookDecision.ts';

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function plugin(messages:(options?:any)=>Promise<any>=async()=>({data:[]})){
  const factory=new Function(`return (${OPENCODE_PLUGIN_SOURCE.replace('export default async function','async function')});`)();
  return factory({client:{session:{messages}}});
}
function completedMessages(user='msg_user') {return [{info:{id:user,sessionID:'root',role:'user',time:{created:10}},parts:[]},{info:{id:'msg_assistant',sessionID:'root',role:'assistant',parentID:user,time:{created:11,completed:12}},parts:[{type:'text',text:'Verified synthetic answer',sessionID:'root',messageID:'msg_assistant'}]}];}
function captureOutcomes(){endpoint();vi.stubEnv('CUBEFARM_OPENCODE_SESSION_ID','root');const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true};}));return bodies;}
async function observeUser(hooks:any,id='msg_user'){await hooks.event({event:{type:'message.updated',properties:{info:{sessionID:'root',id,role:'user'}}}});}
it('verifies the latest completed assistant belongs to the latest user before reporting success',async()=>{
  const bodies=captureOutcomes(),hooks=await plugin(async()=>({data:completedMessages()}));await observeUser(hooks);await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});
  expect(bodies.at(-1)).toMatchObject({hook_event_name:'TurnComplete',failed:false,last_assistant_message:'Verified synthetic answer'});
});
it.each(['wrong-parent','wrong-session','pending','reversed-time','wrong-part','empty','oversized','provider-error','invalid-error','duplicate','unordered','unavailable'] as const)('does not report successful idle completion from %s reply evidence',async mode=>{
  const bodies=captureOutcomes(),messages:any[]=completedMessages();
  if(mode==='wrong-parent')messages[1].info.parentID='msg_older';if(mode==='wrong-session')messages[1].info.sessionID='another';if(mode==='pending')delete messages[1].info.time.completed;if(mode==='reversed-time')messages[1].info.time.completed=1;if(mode==='wrong-part')messages[1].parts[0].messageID='another';if(mode==='empty')messages[1].parts=[];if(mode==='oversized')messages[1].parts[0].text='x'.repeat(256*1024+1);if(mode==='provider-error')messages[1].info.error={name:'APIError',data:{message:'Provider rate limited',statusCode:429,isRetryable:true}};
  if(mode==='invalid-error')messages[1].info.error=false;if(mode==='duplicate')messages.push(messages[1]);if(mode==='unordered')messages.reverse();
  const hooks=await plugin(async()=>{if(mode==='unavailable')throw new Error('offline');return {data:messages};});await observeUser(hooks);await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});
  expect(bodies.at(-1)).toMatchObject({hook_event_name:'TurnComplete',failed:true});expect(bodies.at(-1)).not.toHaveProperty('last_assistant_message');
  if(mode==='provider-error')expect(bodies.at(-1).native_error.data.statusCode).toBe(429);
});
it('carries a lost error notification into idle completion and clears it only for a new user message',async()=>{
  const bodies=captureOutcomes();vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const body=JSON.parse(options.body);bodies.push(body);if(body.hook_event_name==='TurnError')throw new Error('lost notification');return {ok:true};}));let user='msg_user';const hooks=await plugin(async()=>({data:completedMessages(user)}));
  const updated=()=>hooks.event({event:{type:'message.updated',properties:{info:{sessionID:'root',id:user,role:'user'}}}});
  await updated();await hooks.event({event:{type:'session.error',properties:{sessionID:'root',error:{name:'ProviderAuthError',data:{message:'Authentication unavailable'}}}}});await updated();await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});expect(bodies.at(-1)).toMatchObject({failed:true,error:'Authentication unavailable'});
  user='msg_next';await updated();await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});expect(bodies.at(-1)).toMatchObject({failed:false});
});
it('discards an old idle observation when a new user message arrives during its API read',async()=>{
  const bodies=captureOutcomes();let resolve!:(value:any)=>void;const read=vi.fn(()=>new Promise<any>(done=>{resolve=done;})),hooks=await plugin(read);
  await observeUser(hooks);
  const idle=hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});for(let i=0;i<20&&!resolve;i++)await Promise.resolve();expect(read).toHaveBeenCalledOnce();
  await hooks.event({event:{type:'message.updated',properties:{info:{sessionID:'root',id:'msg_next',role:'user'}}}});resolve({data:completedMessages()});await idle;expect(bodies.filter(row=>row.hook_event_name==='TurnComplete')).toEqual([]);
});
it('bounds a stalled native message read and never publishes its late result as successful completion',async()=>{
  vi.useFakeTimers();const bodies=captureOutcomes();let resolve!:(value:any)=>void,signal:AbortSignal|undefined;const hooks=await plugin(options=>{signal=options?.signal;return new Promise<any>(done=>{resolve=done;});});
  await observeUser(hooks);
  const idle=hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});for(let i=0;i<20&&!resolve;i++)await Promise.resolve();
  await vi.advanceTimersByTimeAsync(3001);await idle;expect(signal?.aborted).toBe(true);expect(bodies.at(-1)).toMatchObject({failed:true});resolve({data:completedMessages()});await Promise.resolve();expect(bodies.filter(row=>row.failed===false)).toEqual([]);
});
it('does not reuse a retained reply before observing the current user prompt',async()=>{
  const bodies=captureOutcomes(),read=vi.fn(async()=>({data:completedMessages()})),hooks=await plugin(read);await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});expect(read).not.toHaveBeenCalled();expect(bodies.at(-1)).toMatchObject({failed:true});
});
function endpoint(){vi.stubEnv('CUBEFARM_NOTIFY_URL','http://127.0.0.1:4499/api/hooks/synthetic');}
it('announces the root before forwarding bounded native failures, excluding child and unbound sessions',async()=>{
  endpoint();vi.stubEnv('CUBEFARM_OPENCODE_SESSION_ID','');const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true};}));
  const hooks=await plugin(),error={name:'APIError',data:{statusCode:429,isRetryable:true,message:'x'.repeat(2000),responseBody:'secret',responseHeaders:{Authorization:'secret'}}};
  await hooks.event({event:{type:'session.error',properties:{sessionID:'unknown',error}}});expect(bodies).toEqual([]);
  await hooks.event({event:{type:'session.created',properties:{info:{id:'child',parentID:'root'}}}});expect(bodies).toEqual([]);
  await hooks.event({event:{type:'session.created',properties:{info:{id:'root'}}}});
  await hooks.event({event:{type:'session.error',properties:{sessionID:'child',error}}});
  await hooks.event({event:{type:'session.error',properties:{sessionID:'root',error}}});
  expect(bodies).toHaveLength(2);expect(bodies[0]).toMatchObject({hook_event_name:'OpenCodeSessionStart',session_id:'root'});
  expect(bodies[1]).toMatchObject({hook_event_name:'TurnError',session_id:'root',native_error:{name:'APIError',data:{statusCode:429,isRetryable:true}}});expect(bodies[1].error).toHaveLength(1000);expect(JSON.stringify(bodies)).not.toContain('secret');
});
it('keeps a resumed root pinned when another root is created',async()=>{
  endpoint();vi.stubEnv('CUBEFARM_OPENCODE_SESSION_ID','retained');const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true};}));const hooks=await plugin();
  await hooks.event({event:{type:'session.created',properties:{info:{id:'unrelated'}}}});expect(bodies).toEqual([]);
  await hooks.event({event:{type:'session.idle',properties:{sessionID:'retained'}}});expect(bodies.map(row=>row.hook_event_name)).toEqual(['OpenCodeSessionStart','TurnComplete']);expect(bodies.every(row=>row.session_id==='retained')).toBe(true);
});
it.each([undefined,'https://example.test/hooks','http://user:password@localhost/hooks','http://example.test/hooks'])('refuses plugin initialization with an unsafe endpoint %s',async url=>{
  if(url===undefined)vi.stubEnv('CUBEFARM_NOTIFY_URL',undefined);else vi.stubEnv('CUBEFARM_NOTIFY_URL',url);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(plugin()).rejects.toThrow('execution denied');expect(fetch).not.toHaveBeenCalled();
});
it.each(['write','edit','multiedit','apply_patch','bash'])('blocks a forbidden connector before an OpenCode %s executes',async tool=>{
  endpoint();let request:any;
  const fetch=vi.fn(async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>hookDecision(evaluateToolRequest(request.tool_name,request.tool_input,true))};});vi.stubGlobal('fetch',fetch);
  const args={filePath:'Workflows/approval.json',content:'shared_dropbox',newString:'shared_dropbox',edits:[{newString:'shared_dropbox'}],patchText:'*** Begin Patch\n*** Add File: Workflows/approval.json\n+shared_dropbox\n*** End Patch',command:'echo shared_dropbox'};
  const hooks=await plugin();await expect(hooks['tool.execute.before']({tool,sessionID:'root',callID:'call-1'},{args})).rejects.toThrow('execution denied');expect(fetch).toHaveBeenCalledOnce();expect(request.tool_use_id).toBe('call-1');
});
it.each(['offline','http-error','missing-decision','blocked'])('fails closed on %s governance before execution',async mode=>{
  endpoint();vi.stubGlobal('fetch',vi.fn(async()=>{if(mode==='offline')throw new Error('network');return {ok:mode!=='http-error',json:async()=>mode==='blocked'?{hookSpecificOutput:{permissionDecision:'deny'}}:{}};}));
  const hooks=await plugin();await expect(hooks['tool.execute.before']({tool:'bash'},{args:{command:'git status'}})).rejects.toThrow('execution denied');
});
it('forwards normalized writes without mutating native arguments and admits only an explicit server grant',async()=>{
  endpoint();const fetch=vi.fn(async(_url:unknown,_options:any)=>({ok:true,json:async()=>({hookSpecificOutput:{permissionDecision:'allow'}})}));vi.stubGlobal('fetch',fetch);const hooks=await plugin();const args={filePath:'Workflows/approved.json',content:'shared_commondataserviceforapps'};
  await expect(hooks['tool.execute.before']({tool:'write',sessionID:'root',callID:'tool-1'},{args})).resolves.toBeUndefined();
  const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body).toMatchObject({hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{file_path:args.filePath,content:args.content}});expect(args).not.toHaveProperty('file_path');
});
it('retains the Copilot pause for native MCP tool names and reports bounded tool outcomes',async()=>{
  endpoint();const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const body=JSON.parse(options.body);bodies.push(body);return {ok:true,json:async()=>hookDecision(evaluateToolRequest(body.tool_name,body.tool_input??{},true))};}));const hooks=await plugin();
  await expect(hooks['tool.execute.before']({tool:'office_copilot_studio_publish'},{args:{}})).rejects.toThrow('execution denied');
  await hooks['tool.execute.after']({tool:'write',callID:'tool-1',args:{}},{output:'x'.repeat(20000)});expect(bodies[1]).toMatchObject({hook_event_name:'PostToolUse',tool_name:'Write',tool_use_id:'tool-1'});expect(bodies[1].tool_response.content[0].text).toHaveLength(20000);
  await hooks['tool.execute.after']({tool:'write',callID:'oversized',args:{}},{output:'x'.repeat(800*1024)});expect(bodies[2]).toMatchObject({hook_event_name:'PostToolUseFailure',tool_response:{isError:true}});expect(JSON.stringify(bodies[2])).not.toContain('xxxx');
});

it.each([false,true])('collects per-current-prompt native message work, including failures (%s)',async failed=>{
 const bodies=captureOutcomes(),messages:any[]=completedMessages();messages[1].info.tokens={input:10,output:4,reasoning:2,cache:{read:3,write:1}};messages[1].info.cost=0.2;
 if(failed)messages[1].info.error={name:'APIError',data:{message:'Synthetic failure',statusCode:500,isRetryable:true}};
 const hooks=await plugin(async()=>({data:messages}));await observeUser(hooks);await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});
 expect(bodies.at(-1)).toMatchObject({failed,usage:{schemaVersion:1,source:'opencode-message-v1',sampleId:'msg_user',inputTokens:14,outputTokens:6,costUsd:0.2}});
});
it('keeps native usage unknown when its message counters are missing',async()=>{const bodies=captureOutcomes(),hooks=await plugin(async()=>({data:completedMessages()}));await observeUser(hooks);await hooks.event({event:{type:'session.idle',properties:{sessionID:'root'}}});expect(bodies.at(-1)).not.toHaveProperty('usage');});
