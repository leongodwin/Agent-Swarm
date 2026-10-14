import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {deliveryCommands} from './delivery.ts';
const run=(script:string,signal=new AbortController().signal)=>deliveryCommands.run({executable:process.execPath,args:['-e',script]},process.cwd(),{},signal);
it('preserves native UTF-8 code points split across subprocess writes',async()=>{
  const expected='GBP £ — 東京 😀';const script=`const data=Buffer.from(${JSON.stringify(expected)});let index=0;const timer=setInterval(()=>{if(index===data.length){clearInterval(timer);}else{const chunk=data.subarray(index,index+1);index++;process.stdout.write(chunk);}},2);`;
  expect(await run(script)).toBe(expected);
});
it.each(['stdout','stderr'])('rejects malformed native %s bytes rather than accepting replacement characters',async stream=>{
  await expect(run(`process.${stream}.write(Buffer.from([255]));setInterval(()=>{},1000);`)).rejects.toThrow('invalid UTF-8');
});
it('rejects a truncated UTF-8 tail even when the native process exits successfully',async()=>{
  await expect(run('process.stdout.write(Buffer.from([226,130]));')).rejects.toThrow('invalid UTF-8');
});
it('bounds combined native output in bytes, including multibyte characters',async()=>{
  const script=`let count=0;const data=Buffer.from('東'.repeat(1024*1024));const timer=setInterval(()=>{(count%2?process.stderr:process.stdout).write(data);if(++count===3){clearInterval(timer);setInterval(()=>{},1000);}},10);`;
  await expect(run(script)).rejects.toThrow('exceeded its limit');
},15000);
it('stops ordinary native descendants when the delivery root is cancelled',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-delivery-tree-')),heartbeat=path.join(root,'heartbeat.txt'),controller=new AbortController();
  const leaf=`const fs=require('node:fs');const timer=setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),25);setTimeout(()=>{clearInterval(timer);process.exit(0)},15000);`;
  const script=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);`;
  const result=run(script,controller.signal).then(()=>null,error=>error);
  try{await vi.waitFor(async()=>expect(await fs.readFile(heartbeat,'utf8')).toMatch(/^\d+$/),{timeout:5000});controller.abort();expect((await result)?.message).toContain('Delivery cancelled');const stopped=await fs.readFile(heartbeat,'utf8');await new Promise(resolve=>setTimeout(resolve,200));expect(await fs.readFile(heartbeat,'utf8')).toBe(stopped);}
  finally{controller.abort();await result;await fs.rm(root,{recursive:true,force:true});}
},15000);
