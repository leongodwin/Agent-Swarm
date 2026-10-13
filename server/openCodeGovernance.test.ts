import {afterEach,expect,it,vi} from 'vitest';
import {OPENCODE_PLUGIN_SOURCE} from './clis.ts';
import {evaluateToolRequest} from './toolGovernance.ts';
import {hookDecision} from '../shared/hookDecision.ts';

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function plugin(){
  const factory=new Function(`return (${OPENCODE_PLUGIN_SOURCE.replace('export default async function','async function')});`)();
  return factory({client:{session:{messages:async()=>({data:[]})}}});
}
function endpoint(){vi.stubEnv('CUBEFARM_NOTIFY_URL','http://127.0.0.1:4499/api/hooks/synthetic');}
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
  await hooks['tool.execute.after']({tool:'write',callID:'tool-1',args:{}},{output:'x'.repeat(20000)});expect(bodies[1]).toMatchObject({hook_event_name:'PostToolUse',tool_name:'Write',tool_use_id:'tool-1'});expect(bodies[1].tool_response.content[0].text).toHaveLength(16000);
});
