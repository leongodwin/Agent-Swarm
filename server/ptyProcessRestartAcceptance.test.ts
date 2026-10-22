import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';
import {encode,hostSocket} from './ptyProtocol.ts';

// Unlike disconnect/reconnect in one test process, these workers have disjoint
// module state and OS process identities. No provider or personal history used.
it('adopts a surviving native process after its first office process has exited', {timeout:60000}, async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cf-process-restart-'));
  const entry=path.join(home,'office.mjs'),firstFile=path.join(home,'first.json'),secondFile=path.join(home,'second.json');
  const client=pathToFileURL(path.resolve('server/ptyClient.ts')).href;
  fs.writeFileSync(entry,`
import fs from 'node:fs';
import {startKeeper,spawnPty,adoptPty,hooksReady,leaveKeeper,keeperPid,keeperInstance,keeperHookUrl} from ${JSON.stringify(client)};
const [mode,home,file]=process.argv.slice(2);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const limit=async fn=>{for(let n=0;n<200;n++){if(fn())return;await wait(50);}throw Error('native condition timed out');};
const calls=[];const held=await startKeeper(home,(token,body)=>{calls.push({token,body});return {verifiedBy:'replacement-office'};});
if(mode==='first'){
 const url=keeperHookUrl()+'/api/hooks/synthetic-token';
 const script="console.log('native-ready '+process.pid);process.stdin.resume();let b='';process.stdin.on('data',d=>{b+=d;if(b.includes('GO')){b='';fetch("+JSON.stringify(url)+",{method:'POST',body:JSON.stringify({hook_event_name:'Stop',marker:'survived'})}).then(r=>r.json()).then(answer=>{console.log('native-answer '+JSON.stringify(answer));setTimeout(()=>process.exit(0),100);});}});";
 const env=Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined));
 const p=spawnPty(process.execPath,['-e',script],{cols:100,rows:24,cwd:home,env},{agentId:'synthetic-restart',busy:true});
 let seen='';p.onData(d=>seen+=d);await limit(()=>/native-ready (\\d+)/.test(seen)&&p.pid>0);
 const nativePid=Number(seen.match(/native-ready (\\d+)/)[1]);
 if(p.pid!==nativePid)throw Error('remote native PID did not refresh before office exit');
 fs.writeFileSync(file,JSON.stringify({officePid:process.pid,nativePid,keeperPid:keeperPid(),keeperInstance:keeperInstance()}));
 leaveKeeper();process.exit(0);
}else{
 if(held.length!==1||held[0].exit!==null)throw Error('expected exactly one live retained terminal');
 const p=adoptPty(held[0]);let seen='';p.onData(d=>seen+=d);const exited=new Promise(r=>p.onExit(r));
 p.write('GO\\r');await wait(300);if(calls.length)throw Error('hook escaped readiness barrier');
 hooksReady();const code=await exited;
 fs.writeFileSync(file,JSON.stringify({officePid:process.pid,nativePid:p.pid,keeperPid:keeperPid(),keeperInstance:keeperInstance(),calls,code,verifiedExit:p.verifiedExit,seen}));
 leaveKeeper();process.exit(0);
}
`);
  const run=(mode:string)=>new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',entry,mode,home,mode==='first'?firstFile:secondFile],{cwd:process.cwd(),windowsHide:true,env:{...process.env,SWARM_HOME:home}});
    let diagnostic='';child.stderr.on('data',d=>diagnostic+=String(d));
    const timer=setTimeout(()=>{child.kill();reject(new Error(`${mode} worker timed out: ${diagnostic}`));},25000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`${mode} worker exited ${code}: ${diagnostic}`));});
  });
  try{
    await run('first');const first=JSON.parse(fs.readFileSync(firstFile,'utf8'));
    expect(()=>process.kill(first.officePid,0)).toThrow();
    process.kill(first.nativePid,0);
    await run('second');const second=JSON.parse(fs.readFileSync(secondFile,'utf8'));
    expect(second.officePid).not.toBe(first.officePid);
    expect(second.nativePid).toBe(first.nativePid);
    expect(second.keeperPid).toBe(first.keeperPid);
    expect(second.keeperInstance).toBe(first.keeperInstance);
    expect(second.keeperInstance).toMatch(/^[a-f0-9-]{36}$/);
    expect(second.calls).toEqual([{token:'synthetic-token',body:{hook_event_name:'Stop',marker:'survived'}}]);
    expect(second.seen).toContain('replacement-office');expect(second.code).toBe(0);expect(second.verifiedExit).toBe(true);
  }finally{
    // Authenticated shutdown addresses only this test's freshly generated home.
    if(fs.existsSync(path.join(home,'pty.secret')))await new Promise<void>(resolve=>{
      const socket=net.connect(hostSocket(home));const timer=setTimeout(()=>{socket.destroy();resolve();},1000);
      socket.on('connect',()=>{socket.write(encode({op:'hello',secret:fs.readFileSync(path.join(home,'pty.secret'),'utf8').trim(),version:2}));socket.end(encode({op:'shutdown'}));});
      socket.on('error',()=>{clearTimeout(timer);resolve();});socket.on('close',()=>{clearTimeout(timer);resolve();});
    });
    fs.rmSync(home,{recursive:true,force:true,maxRetries:5});
  }
});
