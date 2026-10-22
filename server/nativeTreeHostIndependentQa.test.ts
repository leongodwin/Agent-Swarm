import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {inspectNativeCommands} from './nativeCommandJournal.ts';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>Promise<boolean>,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await sleep(40);}throw new Error('Owned native fixture did not reach its checkpoint');}
const exists=async(file:string)=>Boolean(await fs.stat(file).catch(()=>undefined));

it.skipIf(process.platform!=='win32').each(['parent-eof','host-crash'])('independent native job proof: %s stops detached descendants',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-tree-independent-'));
 const ready=path.join(root,'ready'),beat=path.join(root,'beat'),proof=path.join(root,'proof.json');
 const childFile=path.join(root,'child.cjs'),rootFile=path.join(root,'root.cjs');
 await fs.writeFile(childFile,`const fs=require('node:fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(beat)},String(Date.now())),20);`);
 await fs.writeFile(rootFile,`const fs=require('node:fs');require('node:child_process').spawn(process.execPath,[${JSON.stringify(childFile)}],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},100);`);
 const host=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('server/nativeTreeHost.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stderr='';host.stderr.on('data',chunk=>stderr+=chunk.toString());host.stdout.resume();
 const closed=new Promise<number|null>((resolve,reject)=>{host.once('error',reject);host.once('close',resolve);});
 host.stdin.write(JSON.stringify({id:crypto.randomUUID(),intentSha256:'a'.repeat(64),exe:process.execPath,commandLine:`"${process.execPath}" "${rootFile}"`,cwd:root,proof})+'\n');
 try{
  await until(async()=>await exists(ready)&&await exists(beat));
  if(mode==='parent-eof')host.stdin.end();else host.kill('SIGKILL');
  const code=await Promise.race([closed,sleep(8000).then(()=>{throw new Error('Supervisor did not terminate after loss of parent control pipe: '+stderr);})]);
  if(mode==='parent-eof')expect(typeof code).toBe('number');
  const before=await fs.readFile(beat,'utf8');await sleep(180);expect(await fs.readFile(beat,'utf8')).toBe(before);
  if(mode==='parent-eof')expect(JSON.parse(await fs.readFile(proof,'utf8'))).toMatchObject({nativeTreeQuiescenceVerified:true,activeProcesses:0,mechanism:'windows-job-object-v1',breakawayAllowed:false});
  else expect(await exists(proof)).toBe(false);
 }finally{
  host.stdin.destroy();host.kill('SIGKILL');await closed.catch(()=>{});await sleep(60);await fs.rm(root,{recursive:true,force:true});
 }
},30000);
it.skipIf(process.platform!=='win32')('publishes attributable tree proof after actual journal-owner process death',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-owner-crash-')),beat=path.join(root,'beat'),native=path.join(root,'native.cjs'),driver=path.join(root,'driver.mjs'),leaseFile=path.join(root,'lease.json');
 await fs.writeFile(native,`require('node:fs').writeFileSync(${JSON.stringify(path.join(root,'ready'))},'ready');setInterval(()=>require('node:fs').writeFileSync(${JSON.stringify(beat)},String(Date.now())),20);`);
 const journalUrl=pathToFileURL(path.resolve('server/nativeCommandJournal.ts')).href,treeUrl=pathToFileURL(path.resolve('server/nativeTree.ts')).href;
 await fs.writeFile(driver,`import fs from 'node:fs/promises';import crypto from 'node:crypto';import {initializeNativeEpoch,journalNativeCommand} from ${JSON.stringify(journalUrl)};import {runNativeTree} from ${JSON.stringify(treeUrl)};const root=${JSON.stringify(root)};const lease=JSON.stringify({schemaVersion:1,pid:process.pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});await fs.writeFile(${JSON.stringify(leaseFile)},lease);const hash=crypto.createHash('sha256').update(lease).digest('hex');await initializeNativeEpoch(root,hash);await journalNativeCommand(root,hash,{executable:'git',args:['rev-parse','HEAD']},root,undefined,async()=>{},context=>runNativeTree(process.execPath,[${JSON.stringify(native)}],root,{},new AbortController().signal,context));`);
 const child=spawn(process.execPath,['--experimental-transform-types',driver],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data.toString());const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
 try{
  await until(async()=>{if(child.exitCode!==null)throw new Error('Native driver exited early: '+stderr);return Boolean((await fs.readFile(beat,'utf8').catch(()=>'' )).length);});
  child.kill('SIGKILL');await closed;const lease=await fs.readFile(leaseFile);
  const journalDirectory=path.join(root,'delivery-native',crypto.createHash('sha256').update(lease).digest('hex'));
  try{await until(async()=>{
   try{return Boolean((await inspectNativeCommands(root,lease)).nativeTreeQuiescenceVerified);}
   catch(error){
    // Inspection must fail closed while the surviving host flushes its proof.
    // Retry only that exact transient inventory, never malformed evidence.
    if(!(error instanceof Error)||error.message!=='Unknown native journal entry')throw error;
    const names=await fs.readdir(journalDirectory);
    if(names.some(name=>/^[a-f0-9-]{36}\.tree\.json\.pending$/.test(name))&&names.every(name=>name==='epoch.json'||/^[a-f0-9-]{36}\.(?:intent|result|tree)\.json$/.test(name)||/^[a-f0-9-]{36}\.tree\.json\.pending$/.test(name)))return false;
    // The atomic rename may finish between the failed inventory read and this
    // inspection. Revalidate the now-final evidence; corruption still throws.
    if(names.some(name=>/^[a-f0-9-]{36}\.tree\.json$/.test(name))&&names.every(name=>name==='epoch.json'||/^[a-f0-9-]{36}\.(?:intent|result|tree)\.json$/.test(name)))return Boolean((await inspectNativeCommands(root,lease)).nativeTreeQuiescenceVerified);
    throw error;
   }
  });}catch(error){const first=await fs.readFile(beat,'utf8');await sleep(200);const last=await fs.readFile(beat,'utf8');await fs.writeFile(path.join(root,'failure.txt'),`${String(error)}; inspection=${JSON.stringify(await inspectNativeCommands(root,lease))}; heartbeat=${first}/${last}; stderr=${stderr}`);throw new Error(`Retained diagnostic root=${root}; ${await fs.readFile(path.join(root,'failure.txt'),'utf8')}`);}
  expect(await inspectNativeCommands(root,lease)).toMatchObject({commands:1,unresolved:1,completeEpoch:true,nativeTreeQuiescenceVerified:true});
  const before=await fs.readFile(beat,'utf8');await sleep(180);expect(await fs.readFile(beat,'utf8')).toBe(before);
 }finally{child.kill('SIGKILL');await closed;await sleep(100);if(!await exists(path.join(root,'failure.txt')))await fs.rm(root,{recursive:true,force:true});}
},30000);
