import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it,vi} from 'vitest';

it('recovers a hard-killed real built demo server through the unchanged production launcher entry',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-full-launcher-qa-'));
 const probe=net.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 let output='';
 const launcher=spawn(process.execPath,['scripts/office.mjs','--demo','--no-open'],{cwd:path.resolve('.'),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,CI:'1',SWARM_HOME:home,SWARM_LEASE_ROOT:path.join(home,'leases'),SWARM_PORT:String(port)}});
 launcher.stdout.on('data',chunk=>{output+=chunk;});launcher.stderr.on('data',chunk=>{output+=chunk;});
 const closed=new Promise<void>((resolve,reject)=>{launcher.once('error',reject);launcher.once('close',()=>resolve());});
 let stage='boot';
 const read=async()=>{
  const url=`http://127.0.0.1:${port}`;
  let route='/api/session';
  try{
   // A killed server cannot service a connection cached by this test's HTTP client.
   // Every observation must contact the current listener through a fresh connection.
   const auth=await fetch(url+route,{headers:{Connection:'close'},signal:AbortSignal.timeout(1500)});
   const cookie=auth.headers.get('set-cookie')?.split(';')[0];expect(cookie).toBeTruthy();
   expect(await auth.json()).toEqual({ok:true});
   route='/api/runtime';
   const response=await fetch(url+route,{headers:{Cookie:cookie!,Connection:'close'},signal:AbortSignal.timeout(1500)});expect(response.ok).toBe(true);
   return await response.json();
  }catch(error){throw new Error(`${stage} ${route} observation failed`,{cause:error});}
 };
 try{
  let before:any;await vi.waitFor(async()=>{before=await read();expect(before.demo).toBe(true);expect(before.reload.supported).toBe(true);},{timeout:30000,interval:150});
  expect(before.pid).toBeGreaterThan(0);expect(before.pid).not.toBe(launcher.pid);expect(before.parentPid).toBe(launcher.pid);
  // Kill only the server PID: a recursive process-tree kill would destroy the keeper too.
  if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(before.pid),'/F'],{windowsHide:true});
  else process.kill(before.pid,'SIGKILL');
  stage='replacement';
  let after:any;await vi.waitFor(async()=>{after=await read();expect(after.pid).not.toBe(before.pid);expect(after.demo).toBe(true);expect(after.reload.supported).toBe(true);},{timeout:30000,interval:150});
  expect(after.parentPid).toBe(launcher.pid);expect(launcher.exitCode).toBeNull();expect(launcher.signalCode).toBeNull();
  expect(output).not.toContain('already running:');
 }catch(error){throw new Error(`Real built demo launcher crash acceptance failed: ${output}`,{cause:error});}
 finally{
  if(launcher.exitCode===null&&launcher.signalCode===null&&launcher.pid){
   if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(launcher.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
   else try{process.kill(-launcher.pid,'SIGTERM');}catch{}
  }
  await closed;await fs.rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
},75000);
