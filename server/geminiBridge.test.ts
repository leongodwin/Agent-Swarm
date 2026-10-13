import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {afterEach,expect,it} from 'vitest';
import {GEMINI_HOOK_SOURCE,geminiSettings} from './geminiBridge.ts';
import {evaluateToolRequest} from './toolGovernance.ts';
import {hookDecision} from '../shared/hookDecision.ts';
const roots:string[]=[],servers:http.Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function endpoint(reply?:(body:any)=>unknown,status=200){
 const bodies:any[]=[];const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);bodies.push(body);res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(reply?reply(body):hookDecision(evaluateToolRequest(body.tool_name,body.tool_input,true))));});servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${(server.address() as any).port}`,bodies};
}
async function invoke(url:string,payload:unknown,event='BeforeTool',raw?:string){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-gemini-hook-'));roots.push(root);const file=path.join(root,'hook.cjs');await fs.writeFile(file,GEMINI_HOOK_SOURCE);
 return new Promise<{code:number|null;json:any}>(resolve=>{const child=spawn(process.execPath,[file,event,url],{windowsHide:true});let output='';child.stdout.on('data',chunk=>output+=chunk);child.once('close',code=>resolve({code,json:JSON.parse(output)}));child.stdin.end(raw??JSON.stringify(payload));});
}
it.each(['write_file','replace','run_shell_command'])('denies a native Gemini %s with a forbidden connector',async tool=>{
 const target=await endpoint();const args={file_path:'Workflows/expense.json',content:'shared_dropbox',new_string:'shared_dropbox',command:'echo shared_dropbox'};
 expect(await invoke(target.url,{hook_event_name:'BeforeTool',tool_name:tool,tool_input:args})).toMatchObject({code:2,json:{decision:'deny'}});
 expect(target.bodies[0]).toMatchObject({hook_event_name:'PreToolUse',tool_input:args});
});
it.each(['invalid-json','wrong-event','missing-decision','http-error','remote-url'])('fails closed before execution: %s',async failure=>{
 const target=await endpoint(()=>({}),failure==='http-error'?503:200);const payload={hook_event_name:failure==='wrong-event'?'AfterTool':'BeforeTool',tool_name:'write_file',tool_input:{content:'safe'}};
 expect(await invoke(failure==='remote-url'?'https://example.test':target.url,payload,'BeforeTool',failure==='invalid-json'?'not json':undefined)).toMatchObject({code:2,json:{decision:'deny'}});
});
it('admits a verified native request and preserves paused MCP operations',async()=>{
 const target=await endpoint();expect(await invoke(target.url,{hook_event_name:'BeforeTool',tool_name:'write_file',tool_input:{file_path:'Workflows/expense.json',content:'shared_commondataserviceforapps'}})).toEqual({code:0,json:{decision:'allow'}});
 expect(await invoke(target.url,{hook_event_name:'BeforeTool',tool_name:'mcp_office_copilot_studio_publish',tool_input:{}})).toMatchObject({code:2,json:{decision:'deny'}});
});
it('maps turn completion and leaves observational failures nonblocking',async()=>{
 const target=await endpoint(()=>({}));const body={hook_event_name:'AfterAgent',session_id:'synthetic-session',prompt_response:'Synthetic response'};
 expect(await invoke(target.url,body,'AfterAgent')).toEqual({code:0,json:{}});expect(target.bodies[0]).toMatchObject({hook_event_name:'TurnComplete',session_id:body.session_id,last_assistant_message:body.prompt_response});
 expect(await invoke('https://example.test',body,'AfterAgent')).toEqual({code:0,json:{}});
});
it('generates required settings with native event identity and scoped MCP endpoints',()=>{
 const config=geminiSettings('node "hook.cjs"',{office:{httpUrl:'http://localhost/scoped'}});expect(config.hooksConfig).toEqual({enabled:true,disabled:[]});expect(config.hooks.BeforeTool[0].hooks[0]).toMatchObject({command:'node "hook.cjs" BeforeTool',timeout:20000});expect(config.mcpServers.office).toEqual({httpUrl:'http://localhost/scoped'});
});
