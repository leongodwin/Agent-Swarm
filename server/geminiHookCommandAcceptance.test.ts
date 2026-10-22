import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./exec.ts',()=>({run:vi.fn(async()=>'{"secure":true}')}));
import {run} from './exec.ts';
import {GEMINI_HOOK_SOURCE,geminiSettings,geminiHookCommand,verifyGeminiProfile} from './geminiBridge.ts';
const roots:string[]=[],servers:http.Server[]=[];
afterEach(async()=>{vi.clearAllMocks();for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
it.each([true,false])('executes quoted native hook through the platform shell and preserves denial: %s',async allow=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gemini shell's "));roots.push(root);const hook=path.join(root,"bridge's file.cjs");await fs.writeFile(hook,GEMINI_HOOK_SOURCE);
 const received:unknown[]=[];const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;received.push(JSON.parse(text));res.setHeader('content-type','application/json');res.end(JSON.stringify({hookSpecificOutput:{permissionDecision:allow?'allow':'deny'}}));});servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const payload={hook_event_name:'BeforeTool',tool_name:'write_file',session_id:'synthetic-shell',tool_input:{content:"literal '$HOME'; $(bad)"}};
 const command=geminiHookCommand(process.execPath,hook)+' BeforeTool';
 const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{const windows=process.platform==='win32';const child=spawn(windows?'powershell.exe':'bash',windows?['-NoProfile','-NonInteractive','-Command',command+'; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }']:['-c',command],{env:{...process.env,CUBEFARM_HOOK_URL:`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`},windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.end(JSON.stringify(payload));});
 expect(result.code,result.stderr).toBe(allow?0:2);expect(JSON.parse(result.stdout)).toMatchObject({decision:allow?'allow':'deny'});expect(received).toEqual([expect.objectContaining({hook_event_name:'PreToolUse',session_id:'synthetic-shell',tool_input:payload.tool_input})]);
});
it.each(['enabled','notification','missing'] as const)('rejects protected update drift before calling native security validator: %s',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-updates-'));roots.push(root);const hook=path.join(root,'gemini-hook.cjs'),profile=path.join(root,'settings.json');await fs.writeFile(hook,GEMINI_HOOK_SOURCE);
 const config:any=geminiSettings(geminiHookCommand(process.execPath,hook),{office:{httpUrl:'${CUBEFARM_OFFICE_URL}'}});if(mode==='enabled')config.general.enableAutoUpdate=true;if(mode==='notification')config.general.enableAutoUpdateNotification=true;if(mode==='missing')delete config.general;
 await fs.writeFile(profile,JSON.stringify(config));expect(await verifyGeminiProfile({file:process.execPath,args:[path.join(root,'gemini.js')]},false,profile)).toContain('automatic updates must be disabled');expect(run).not.toHaveBeenCalled();
});
