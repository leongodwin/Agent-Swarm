import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { CODEX_HOOK_SOURCE } from './clis.ts';
import { hookDecision } from '../shared/hookDecision.ts';
const roots:string[]=[];const servers:http.Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))));await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function transport(answer:unknown,status=200,delayMs=0){
 const server=http.createServer((req,res)=>{req.resume();setTimeout(()=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(answer));},delayMs);});servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port+'/api/hooks/test';
}
async function invoke(url:string,event='PreToolUse',approveGoverned=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-hook-relay-'));roots.push(root);const file=path.join(root,'hook.cjs');await fs.writeFile(file,CODEX_HOOK_SOURCE);
 return new Promise<{code:number|null;out:any}>((resolve,reject)=>{const child=spawn(process.execPath,[file,url,...approveGoverned?['--approve-governed']:[]],{windowsHide:true,env:{...process.env,CUBEFARM_HOOK_URL:'https://unapproved.example'}});let text='';child.stdout.on('data',b=>text+=b);child.once('error',reject);child.once('close',code=>resolve({code,out:JSON.parse(text)}));child.stdin.end(JSON.stringify({hook_event_name:event,tool_name:'Write',tool_input:{content:'synthetic'}}));});
}
it('relays a denial instead of discarding the server governance decision',async()=>{
 const answer=hookDecision({status:'blocked',reason:'Paused platform'});expect(await invoke(await transport(answer))).toEqual({code:0,out:answer});
});
it('allows only an explicit verified pre-tool reply and rejects absent decisions or HTTP failure',async()=>{
 const answer=hookDecision({status:'allowed',reason:'Request-local safeguards passed'});const url=await transport(answer);
 expect((await invoke(url)).out).toEqual({});expect((await invoke(url,'PreToolUse',true)).out).toEqual(answer);
 for(const url of [await transport({}),await transport({},503),'https://unapproved.example']){const result=await invoke(url);expect(result.code).toBe(0);expect(result.out.hookSpecificOutput.permissionDecision).toBe('deny');}
 expect((await invoke(await transport({}))).out.hookSpecificOutput.permissionDecisionReason).toContain('at decision;');
});
it('does not block observational hooks when the office is unavailable',async()=>{expect(await invoke('https://unapproved.example','PostToolUse')).toEqual({code:0,out:{}});});
it('waits for a persisted governance response beyond the former five-second timeout',async()=>{
 const answer=hookDecision({status:'blocked',reason:'Independent review test denial'});
 expect(await invoke(await transport(answer,200,5500))).toEqual({code:0,out:answer});
},15000);
