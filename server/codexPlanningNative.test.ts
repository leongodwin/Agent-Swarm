import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {SessionOptions,SessionResult} from './agentRunner.ts';
const fixture=vi.hoisted(()=>({script:''}));
// Execute a run-owned Node fixture through the actual spawn/pipe/close path.
// This tests transport and cleanup, not a model provider or synthesis latency.
vi.mock('./clis.ts',()=>({commandFor:()=>({file:process.execPath,args:['-e',fixture.script,'--']})}));
import {startCodexPlanning} from './codexPlanning.ts';
const options:SessionOptions={cwd:process.cwd(),prompt:'Synthetic transport fixture',systemAppend:'No model or tools',model:'',effort:'medium',browserTesting:false,additionalDirectories:[],role:'dev',noTools:true,outputSchema:{type:'object'}};
function start(){let resolve!:(value:SessionResult)=>void;const result=new Promise<SessionResult>(done=>{resolve=done;}),finished=vi.fn(resolve);const handle=startCodexPlanning(options,{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished});return {result,finished,handle};}
it('preserves a native subprocess JSON stream split inside Unicode characters',async()=>{
  const expected={title:'£ dépenses — 東京 😀'};
  const line=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(expected)}})+'\n';
  fixture.script=`process.stdin.resume();process.stdin.on('end',()=>{const bytes=Buffer.from(${JSON.stringify(line)});let i=0;const timer=setInterval(()=>{if(i===bytes.length){clearInterval(timer);process.exit(0);}else{const chunk=bytes.subarray(i,i+1);i++;process.stdout.write(chunk);}},2);});`;
  const run=start();try{expect(await run.result).toMatchObject({ok:true,structured:expected});expect(run.finished).toHaveBeenCalledOnce();}finally{run.handle.stop();}
});
it('stops an owned native child after invalid UTF-8 and returns one failed completion',async()=>{
  fixture.script="process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(Buffer.from([255]));setInterval(()=>{},1000);});";
  const run=start();try{expect(await run.result).toMatchObject({ok:false,errors:['Codex planning emitted invalid UTF-8']});expect(run.finished).toHaveBeenCalledOnce();}finally{run.handle.stop();}
});
it('stops ordinary native descendants as well as their planning launcher',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-planning-tree-test-')),heartbeat=path.join(root,'heartbeat.txt');
  // The leaf continually changes a run-owned file. A launcher-only stop leaves
  // that observable activity running, even after its stdout pipe has closed.
  const leaf=`const fs=require('node:fs');const timer=setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),25);setTimeout(()=>{clearInterval(timer);process.exit(0)},15000);`;
  fixture.script=`process.stdin.resume();process.stdin.on('end',()=>{require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);});`;
  const run=start();try{
    await vi.waitFor(async()=>expect(await fs.readFile(heartbeat,'utf8')).toMatch(/^\d+$/),{timeout:5000});
    run.handle.stop();expect(await run.result).toMatchObject({ok:false,cleanupVerified:true,errors:['Cancelled']});
    const stopped=await fs.readFile(heartbeat,'utf8');await new Promise(resolve=>setTimeout(resolve,200));expect(await fs.readFile(heartbeat,'utf8')).toBe(stopped);expect(run.finished).toHaveBeenCalledOnce();
  }finally{run.handle.stop();await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
},10000);
