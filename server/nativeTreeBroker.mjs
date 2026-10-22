// Detached Node keeps the native proof host outside the office's libuv
// kill-on-parent-exit job. PowerShell itself needs normal console startup.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function bridgeNativeTree(control,launch,finish){
let input='',host,ended=false,started=false;
control.setEncoding('utf8');
control.on('data',chunk=>{
 if(started)return;
 input+=chunk;if(input.length>1024*1024){finish(1);control.destroy();return;}
 const newline=input.indexOf('\n');if(newline<0)return;started=true;
 let payload;try{payload=JSON.parse(input.slice(0,newline));}catch{finish(1);control.destroy();return;}
 host=launch();
 host.stdin.on('error',()=>{});
 host.once('error',()=>{finish(1);control.destroy();});
 host.once('close',code=>{finish(code??1);control.destroy();});
 host.stdin.write(JSON.stringify(payload)+'\n');if(ended)host.stdin.end();
});
control.on('end',()=>{ended=true;if(host)host.stdin.end();});
control.on('error',()=>{ended=true;if(host)host.stdin.end();});

}
if(process.argv[1]===fileURLToPath(import.meta.url))bridgeNativeTree(process.stdin,()=>spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./nativeTreeHost.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','inherit','inherit']}),code=>{process.exitCode=code;});
