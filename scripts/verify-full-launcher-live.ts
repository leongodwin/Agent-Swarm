import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fullLauncherPassed,launcherUpdatePassed} from './fullLauncherChecks.ts';
import {stopVerificationKeeper} from './launcherLiveSupport.ts';
import {reconciledLauncherPassed} from './reconciliationChecks.ts';
if(!process.argv.includes('--live'))throw new Error('Requires explicit --live: authenticated full launcher verification');
const updatesOnly=process.argv.includes('--updates-only');
const reconcile=process.argv.includes('--reconcile-empty');
if(updatesOnly&&reconcile)throw new Error('Choose either explicit updater recovery or reconciled native adoption');
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cubefarm-launcher-live-')),checkout=path.join(root,'checkout'),home=path.join(root,'home');
fs.mkdirSync(home);fs.mkdirSync(checkout);for(const folder of ['scripts','server','bin'])fs.mkdirSync(path.join(checkout,folder));
const entries=['scripts/office.mjs','scripts/officeSteps.mjs','scripts/officeRecovery.mjs','server/policyReaderHost.mjs','server/officeReload.mjs','bin/cubefarm.js','package.json'];
for(const entry of entries)fs.copyFileSync(path.resolve(entry),path.join(checkout,entry));
for(const file of ['package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','playwright.config.ts','README.md'])fs.copyFileSync(path.resolve(file),path.join(checkout,file));
for(const folder of ['client','shared','docs'])fs.cpSync(path.resolve(folder),path.join(checkout,folder),{recursive:true});
// Full source is needed by the real updater's build and rollback commands.
for(const folder of ['server','scripts','bin'])fs.cpSync(path.resolve(folder),path.join(checkout,folder),{recursive:true});
for(const folder of ['dist','dist-server'])fs.cpSync(path.resolve(folder),path.join(checkout,folder),{recursive:true});
fs.symlinkSync(path.resolve('node_modules'),path.join(checkout,'node_modules'),process.platform==='win32'?'junction':'dir');
const digest=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const productionBytes=entries.concat('dist-server/index.js','dist-server/ptyHost.js').map(entry=>({entry,sourceSha256:digest(path.resolve(entry)),copiedSha256:digest(path.join(checkout,entry))}));
fs.writeFileSync(path.join(checkout,'.gitignore'),'node_modules/\ndist/\ndist-server/\n');
fs.mkdirSync(path.join(root,'empty-hooks'));
const git=async(cwd:string,args:string[])=>String((await promisify(execFile)('git',['-c','core.hooksPath='+path.join(root,'empty-hooks'),'-c','commit.gpgSign=false',...args],{cwd,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})).stdout).trim();
const identity=['-c','user.name=Synthetic verification','-c','user.email=synthetic@example.test'];
const origin=path.join(root,'origin.git'),editor=path.join(root,'editor');
await git(root,['init','--bare','--initial-branch=main',origin]);await git(checkout,['init','--initial-branch=main']);await git(checkout,['add','.']);await git(checkout,[...identity,'commit','-m','Synthetic current source snapshot']);await git(checkout,['remote','add','origin',origin]);await git(checkout,['push','-u','origin','main']);await git(checkout,['remote','set-head','origin','main']);await git(root,['clone',origin,editor]);
fs.writeFileSync(path.join(home,'state.json'),JSON.stringify({version:2,settings:{runtime:'terminal',ceoHeartbeatMin:0,autoUpdate:false,setupDone:true,companyName:'Synthetic verification'},repos:[]}));
// Intentionally fail closed for every native tool; the no-tools chat remains a runtime-only probe.
fs.writeFileSync(path.join(home,'tool-governance.json'),'synthetic-unavailable-audit');
const listener=net.createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as net.AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
if([4317,5317].includes(port))throw new Error('Reserved live office port');
const launcher=spawn(process.execPath,[path.join(checkout,'scripts/office.mjs'),'--no-open'],{cwd:checkout,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,CI:'1',SWARM_HOME:home,SWARM_LEASE_ROOT:path.join(home,'leases'),SWARM_PORT:String(port),SWARM_RECOVER_EMPTY_DELIVERY:reconcile?'1':'',SWARM_CRASHED_DELIVERY_OWNER:''}});
let output='';launcher.stdout.on('data',chunk=>{output+=chunk;});launcher.stderr.on('data',chunk=>{output+=chunk;});const closed=new Promise<void>(resolve=>launcher.once('close',()=>resolve()));
const url=`http://127.0.0.1:${port}`,proof:Record<string,any>={root,home,launcherPid:launcher.pid,productionBytes};let error:string|undefined;
async function api(route:string,method='GET',body?:unknown){
 const session=await fetch(url+'/api/session',{headers:{Connection:'close'},signal:AbortSignal.timeout(2000)});const cookie=session.headers.get('set-cookie')?.split(';')[0];await session.json();if(!cookie)throw new Error('Local browser authentication unavailable');
 const response=await fetch(url+route,{method,headers:{Cookie:cookie,'Content-Type':'application/json',Connection:'close'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error(`${route} returned ${response.status}`);return await response.json();
}
async function waitFor<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,timeout=90000):Promise<T>{
 let lastError='No observation';const end=Date.now()+timeout;while(Date.now()<end){if(launcher.exitCode!==null||launcher.signalCode!==null)throw new Error('Owning launcher exited');try{const value=await read();if(accept(value))return value;}catch(caught){lastError=caught instanceof Error?caught.message:'Observation unavailable';}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Bounded full-launcher observation expired: '+lastError.slice(0,300));
}
function nativeSnapshot(sessionId:string){
 const cwd=path.join(home,'ceo'),registry=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.gemini','projects.json'),'utf8'));const normalize=(text:string)=>text.toLowerCase().replaceAll('\\','/');
 const entry=Object.entries(registry.projects).find(([key])=>normalize(key)===normalize(cwd));if(!entry||typeof entry[1]!=='string'||!/^[-a-z0-9_]+$/.test(entry[1]))throw new Error('Scoped native project missing');
 const folder=path.join(os.homedir(),'.gemini','tmp',entry[1],'chats');const files=fs.readdirSync(folder).filter(file=>file.endsWith('.jsonl')&&file.includes(sessionId.slice(0,8)));if(files.length!==1)throw new Error('Owning native transcript ambiguous');
 const file=path.join(folder,files[0]),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw new Error('Unsafe native transcript');const bytes=fs.readFileSync(file),rows=bytes.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));if(rows[0].sessionId!==sessionId||rows[0].projectHash!==crypto.createHash('sha256').update(cwd).digest('hex'))throw new Error('Native identity mismatch');
 return {file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),rows};
}
try{
 const boot=await waitFor(()=>api('/api/runtime'),r=>r.parentPid===launcher.pid&&!r.demo&&r.homeDir===home&&r.reload.supported);proof.boot=boot;console.log(JSON.stringify({stage:'boot',pid:boot.pid}));
 const state=await api('/api/state');if(state.repos.length)throw new Error('Unexpected connected repository');
 await api('/api/office/drain','POST',{expectedPid:boot.pid,draining:true});proof.reloadAccepted=await api('/api/office/reload','POST',{expectedPid:boot.pid});
 proof.reloaded=await waitFor(()=>api('/api/runtime'),r=>r.pid!==boot.pid&&r.parentPid===launcher.pid&&r.reload.phase==='ready'&&r.draining===true);
 console.log(JSON.stringify({stage:'controlled-reload',pid:proof.reloaded.pid}));
 await api('/api/office/drain','POST',{expectedPid:proof.reloaded.pid,draining:false});
 if(!updatesOnly){
 await api('/api/agents/ceo','PATCH',{cli:'gemini',model:'',effort:'low'});
 const marker='CUBEFARM_LAUNCHER_CRASH_OK';await api('/api/ceo/message','POST',{text:`Synthetic verification only. Reply exactly ${marker}. Do not use tools, inspect files, delegate or modify anything.`});
 const busy=await waitFor(async()=>{
  const saved=JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),ceo=saved.agents.find((a:any)=>a.id==='ceo');if(ceo?.status!=='working'||!ceo.sessionId||ceo.sessionCli!=='gemini'||saved.ceo.job?.kind!=='chat')throw new Error(saved.ceo.blockedReason||ceo?.lastError||'Durable busy task not ready');
  const native=nativeSnapshot(ceo.sessionId);if(!native.rows.some((row:any)=>row.type==='user'&&JSON.stringify(row.content).includes(marker))||native.rows.some((row:any)=>row.type==='gemini'))throw new Error('Native task is not at the crash boundary');
  return {ceo,job:saved.ceo.job,nativeSha256:native.sha256};
 },()=>true);proof.busy={sessionId:busy.ceo.sessionId,sessionCli:busy.ceo.sessionCli,status:busy.ceo.status,jobKind:busy.job.kind,nativeSha256:busy.nativeSha256};
 console.log(JSON.stringify({stage:'durable-busy-native',sessionId:busy.ceo.sessionId}));
 proof.beforeCrash=await api('/api/runtime');if(proof.beforeCrash.parentPid!==launcher.pid||proof.beforeCrash.nativeRuntime.nativePids.length!==1)throw new Error('Native process ownership unverified');
 const leaseBytes=fs.readFileSync(path.join(home,'delivery.lock')),historyBytes=fs.readFileSync(path.join(home,'delivery.json'));
 const priorLeaseSha256=crypto.createHash('sha256').update(leaseBytes).digest('hex'),priorHistorySha256=crypto.createHash('sha256').update(historyBytes).digest('hex'),snapshotSha256=crypto.createHash('sha256').update(leaseBytes).update('\0').update(historyBytes).digest('hex');
 if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(proof.beforeCrash.pid),'/F'],{windowsHide:true});else process.kill(proof.beforeCrash.pid,'SIGKILL');
 proof.forcedExit={method:process.platform==='win32'?'taskkill-server-only':'SIGKILL-server',targetPid:proof.beforeCrash.pid};
 proof.afterCrash=await waitFor(()=>api('/api/runtime'),r=>r.pid!==proof.beforeCrash.pid&&r.parentPid===launcher.pid&&r.reload.supported);
 const done=await waitFor(()=>api('/api/state'),s=>s.agents.some((a:any)=>a.id==='ceo'&&a.status==='error')||s.agents.some((a:any)=>a.id==='ceo'&&a.status==='done')&&s.ceo.job===null);
 const completedCeo=done.agents.find((a:any)=>a.id==='ceo');if(completedCeo.status==='error')throw new Error(completedCeo.lastError||'Crash adoption was blocked');
 const durableDone=await waitFor(async()=>JSON.parse(fs.readFileSync(path.join(home,'state.json'),'utf8')),s=>s.agents.some((a:any)=>a.id==='ceo'&&a.status==='done')&&s.ceo.job===null);
 const durableCeo=durableDone.agents.find((a:any)=>a.id==='ceo');
 proof.done={status:durableCeo.status,job:durableDone.ceo.job,sessionId:durableCeo.sessionId};
 if(reconcile){const archive=path.join(home,'delivery-recovery'),files=fs.readdirSync(archive),markers=files.filter(file=>file.endsWith('.lock.json')),receipts=files.filter(file=>file.endsWith('.json')&&!file.endsWith('.lock.json'));if(markers.length!==1||receipts.length!==1)throw new Error('Ambiguous recovery archive');proof.reconciliation={operatorOptIn:true,priorLeaseSha256,priorHistorySha256,snapshotSha256,archivedLeaseSha256:digest(path.join(archive,markers[0])),afterHistorySha256:digest(path.join(home,'delivery.json')),receipt:JSON.parse(fs.readFileSync(path.join(archive,receipts[0]),'utf8'))};}
 console.log(JSON.stringify({stage:'crash-adoption-complete',pid:proof.afterCrash.pid}));
 const native=nativeSnapshot(busy.ceo.sessionId);const responses=native.rows.filter((row:any)=>row.type==='gemini');const users=native.rows.filter((row:any)=>row.type==='user');proof.native={sessionId:busy.ceo.sessionId,sha256:native.sha256,responseCount:responses.length,taskPrompts:users.filter((row:any)=>JSON.stringify(row.content).includes(marker)).length,exactMarker:responses.at(-1)?.content?.trim()===marker,projectHashMatches:true,userMessages:users.length,contextMessages:users.filter((row:any)=>JSON.stringify(row.content).includes('<session_context>')&&!JSON.stringify(row.content).includes(marker)).length,unknownUserMessages:users.filter((row:any)=>!JSON.stringify(row.content).includes(marker)&&!JSON.stringify(row.content).includes('<session_context>')).length,tokens:responses.at(-1)?.tokens};
 const {readSessionAttempts}=await import('../server/sessionEvidence.ts');const attempts=readSessionAttempts(home).filter(row=>row.rows?.[0]?.agentId==='ceo');proof.attempts=attempts.map(row=>({id:row.id,first:row.rows?.[0],finish:row.rows?.at(-1)}));
 const nativePid=proof.beforeCrash.nativeRuntime.nativePids[0];await waitFor(async()=>{try{process.kill(nativePid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}},absent=>absent);
 proof.completedNativeExit={pid:nativePid,absent:true,observedAt:new Date().toISOString()};
 }else{
  proof.beforeCrash=await api('/api/runtime');
  if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(proof.beforeCrash.pid),'/F'],{windowsHide:true});else process.kill(proof.beforeCrash.pid,'SIGKILL');
  proof.afterCrash=await waitFor(()=>api('/api/runtime'),r=>r.pid!==proof.beforeCrash.pid&&r.parentPid===launcher.pid&&r.reload.supported);
  proof.blockedDelivery=await api('/api/delivery');proof.recoveryInspection=await api('/api/delivery/recovery');
  if(proof.blockedDelivery.availability!=='unavailable'||proof.recoveryInspection.canRecover!==true||proof.recoveryInspection.owner!=='absent'||proof.recoveryInspection.history!=='empty')throw new Error('Expected isolated empty-history recovery boundary was not verified');
  await api('/api/office/drain','POST',{expectedPid:proof.afterCrash.pid,draining:true});
  proof.recoveredDelivery=await api('/api/delivery/recovery','POST',{snapshotSha256:proof.recoveryInspection.snapshotSha256});
  if(proof.recoveredDelivery.availability!=='ready')throw new Error('Explicit empty-history recovery failed');
  console.log(JSON.stringify({stage:'explicit-empty-history-recovery',pid:proof.afterCrash.pid}));
 }
 await api('/api/office/drain','POST',{expectedPid:proof.afterCrash.pid,draining:true});
 async function updateProbe(before:any){
  let update:any;const started=Date.now();const observer=setInterval(()=>{try{const value=JSON.parse(fs.readFileSync(path.join(home,'last-update.json'),'utf8'));if(value.at>=started)update=value;}catch{}},20);
  try{launcher.stdin.write('u\n');const after=await waitFor(()=>api('/api/runtime'),r=>r.pid!==before.pid&&r.parentPid===launcher.pid&&r.reload.supported&&r.draining===true,150000);if(!update)throw new Error('Updater result was not captured');return {before,after,update,head:await git(checkout,['rev-parse','HEAD'])};}finally{clearInterval(observer);}
 }
 const from=await git(checkout,['rev-parse','HEAD']);fs.appendFileSync(path.join(editor,'README.md'),'\nSynthetic local updater verification.\n');await git(editor,['add','README.md']);await git(editor,[...identity,'commit','-m','Synthetic local successful update']);const to=await git(editor,['rev-parse','HEAD']);await git(editor,['push','origin','main']);
 const success=await updateProbe(await api('/api/runtime'));console.log(JSON.stringify({stage:'successful-local-update',pid:success.after.pid}));
 const buildScript=path.join(editor,'scripts','build-server.mjs');fs.writeFileSync(buildScript,"throw new Error('Synthetic reviewed update build failure');\n"+fs.readFileSync(buildScript,'utf8'));await git(editor,['add','scripts/build-server.mjs']);await git(editor,[...identity,'commit','-m','Synthetic local rejected build']);const failedTarget=await git(editor,['rev-parse','HEAD']);await git(editor,['push','origin','main']);
 const rollback=await updateProbe(success.after);console.log(JSON.stringify({stage:'failed-update-rollback',pid:rollback.after.pid}));
 proof.updateChain={localOnly:true,originPath:origin,success:{...success,from,to},rollback:{...rollback,from:to,failedTarget,rollbackObserved:output.includes('Rolling back to '+to.slice(0,7))}};
 proof.maintenance=JSON.parse(fs.readFileSync(path.join(home,'maintenance.json'),'utf8'));
}catch(caught){error=caught instanceof Error?caught.message:String(caught);try{const state=await api('/api/state'),agent=state.agents.find((a:any)=>a.id==='ceo');proof.blockedAgent=agent?{status:agent.status,sessionId:agent.sessionId,sessionCli:agent.sessionCli,lastError:agent.lastError}:null;proof.blockedDelivery=await api('/api/delivery');proof.recoveryInspection=await api('/api/delivery/recovery');}catch{}}
finally{
 fs.writeFileSync(path.join(root,'launcher.log'),output);
 try{const current=await api('/api/runtime');await api('/api/office/drain','POST',{expectedPid:current.pid,draining:true});}catch{}
 try{await stopVerificationKeeper(home,proof.beforeCrash?.nativeRuntime.keeperInstance);proof.cleanup='verified';}catch(caught){error??=caught instanceof Error?caught.message:String(caught);proof.cleanup='unverified';}
 if(launcher.exitCode===null&&launcher.signalCode===null&&launcher.pid){if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(launcher.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});else try{process.kill(-launcher.pid,'SIGTERM');}catch{}}
 let exitTimer:NodeJS.Timeout|undefined;try{await Promise.race([closed,new Promise<never>((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('Launcher process exit remains unverified')),15000);})]);proof.launcherExited=true;}catch(caught){proof.launcherExited=false;error??=caught instanceof Error?caught.message:String(caught);}finally{clearTimeout(exitTimer);}
}
const passed=updatesOnly?error===undefined&&proof.cleanup==='verified'&&proof.launcherExited===true&&proof.recoveryInspection?.canRecover===true&&proof.recoveredDelivery?.availability==='ready'&&proof.updateChain?.success?.before?.pid===proof.afterCrash?.pid&&launcherUpdatePassed(proof.updateChain,proof.launcherPid,proof.home,0):reconcile?reconciledLauncherPassed(proof,error):fullLauncherPassed(proof,error)&&proof.completedNativeExit?.absent===true&&proof.completedNativeExit.pid===proof.beforeCrash?.nativeRuntime?.nativePids?.[0]&&launcherUpdatePassed(proof.updateChain,proof.launcherPid,proof.home,0);
fs.mkdirSync('output',{recursive:true});fs.writeFileSync(updatesOnly?'output/full-launcher-updates-live.json':reconcile?'output/reconciled-adoption-live.json':'output/full-launcher-live.json',JSON.stringify({scope:updatesOnly?'no-native-tasks-explicit-empty-history-recovery':reconcile?'operator-opt-in-empty-history-authenticated-adoption':'authenticated-native-crash-adoption',proof,error,passed},null,2));console.log(JSON.stringify({root,passed,error}));process.exitCode=passed?0:1;
