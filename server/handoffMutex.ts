import {spawn} from 'node:child_process';
import path from 'node:path';

/** Windows kernel file-share exclusion. The handle belongs to a tiny host that
 * exits on office pipe EOF; process death releases it without stale lock reaping. */
export async function withHandoffMutex<T>(root:string,work:(assertOwned:()=>void)=>Promise<T>):Promise<T>{
 if(process.platform!=='win32')throw new Error('Durable handoff requires Windows kernel exclusion');
 const script=`$ErrorActionPreference='Stop';[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false);$p=[Console]::ReadLine();try{$f=[IO.File]::Open($p,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);[Console]::WriteLine('READY');[Console]::Out.Flush();[Console]::ReadLine() | Out-Null;$f.Dispose()}catch{exit 1}`;
 const child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Handoff mutex startup timed out'));},15000);let output='';const finish=(error?:Error)=>{clearTimeout(timer);error?reject(error):resolve();};child.once('error',error=>finish(error));child.once('close',()=>finish(new Error('Handoff mutex unavailable')));child.stdin.on('error',()=>finish(new Error('Handoff mutex pipe failed')));child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output==='READY\r\n'||output==='READY\n')finish();else if(output.length>100)finish(new Error('Invalid handoff mutex acknowledgement'));});child.stdin.write(path.join(root,'delivery-handoff.mutex')+'\n');});
  return await work(()=>{if(child.exitCode!==null||child.signalCode!==null)throw new Error('Handoff kernel exclusion lost');});
 }finally{child.stdin.end();await exited;}
}
