import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGeminiLiveRuntime} from './geminiLiveRuntime.ts';
if(!process.argv.includes('--live'))throw new Error('Requires explicit --live: authenticated synthetic restart verification');
const root=path.resolve(process.argv[2]),stage=process.argv[3];
if(!['before','after','cleanup'].includes(stage)||!path.basename(root).startsWith('cubefarm-restart-live-')||fs.lstatSync(root).isSymbolicLink())throw new Error('Unexpected verification scope');
process.env.SWARM_HOME=path.join(root,'office');process.env.SWARM_PORT='0';
const {AgentTerminal}=await import('../server/terminal.ts');
const {startKeeper,keeperPid,keeperInstance}=await import('../server/ptyClient.ts');
const {readSessionAttempts}=await import('../server/sessionEvidence.ts');
const checkpointFile=path.join(root,'handoff.json');
const checkpoint=stage!=='before'&&fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):null;
const term=new AgentTerminal();term.resize(200,40);let sessionId:string|null=null;let handingOff=false;
const runtime=await createGeminiLiveRuntime(process.env.SWARM_HOME,{port:checkpoint?.port});
const cwd=path.join(root,'synthetic');fs.mkdirSync(cwd,{recursive:true});
const task={cwd,prompt:'Reply exactly CUBEFARM_RESTART_OK. Do not use tools.',systemAppend:'Synthetic verification only. Never read files, use tools, delegate or modify anything.',model:'',effort:'low' as const,browserTesting:false,additionalDirectories:[],role:'dev' as const,cli:'gemini' as const,terminal:term,agentId:'restart-verifier',authorizeTool:async()=>null};
const deadline=setTimeout(()=>{void runtime.close().catch(()=>undefined).finally(()=>process.exit(2));},90000);
async function nativePids(){
 const cached=runtime.runner.officeProcesses().pids.filter(pid=>pid!==keeperPid()&&pid>0);if(cached.length)return cached;
 if(process.platform!=='win32')throw new Error('Native PID not advertised before restart');
 const command=`@(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${keeperPid()} -and $_.Name -eq 'node.exe' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
 const result=await promisify(execFile)('pwsh',['-NoProfile','-Command',command],{windowsHide:true,timeout:10000});const parsed=JSON.parse(result.stdout);return (Array.isArray(parsed)?parsed:[parsed]).filter(pid=>Number.isSafeInteger(pid)&&pid>0);
}
try{
 if(stage==='cleanup'){await runtime.runner.reconnectClis(agent=>agent==='restart-verifier'?term:null);await runtime.close();clearTimeout(deadline);term.dispose();fs.writeFileSync(path.join(root,'emergency-cleanup.json'),JSON.stringify({cleanup:'verified'}));process.exit(0);}
 if(stage==='before'){
  const hooks:Record<string,unknown>[]=[];
  await startKeeper(process.env.SWARM_HOME,async(token,body)=>{
   const b=body as Record<string,unknown>;hooks.push({event:b.hook_event_name,sessionId:b.session_id,transcriptPath:b.transcript_path,at:new Date().toISOString()});
   const answer=await runtime.runner.handleHook(token,body);
   if(b.hook_event_name==='UserPromptSubmit'&&!handingOff){handingOff=true;setTimeout(()=>{void (async()=>{
    const pids=await nativePids();if(!sessionId||pids.length!==1)throw new Error('Native handoff identity is unverified');
    const transcript=hooks.findLast(row=>row.event==='UserPromptSubmit')?.transcriptPath;if(typeof transcript!=='string')throw new Error('Owning native transcript missing');const nativeRows=fs.readFileSync(transcript,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));const nativeResponsesBefore=nativeRows.filter(row=>row.type==='gemini').length;
    fs.writeFileSync(checkpointFile,JSON.stringify({nativeResponsesBefore,serverPid:process.pid,keeperPid:keeperPid(),keeperInstance:keeperInstance(),nativePid:pids[0],sessionId,port:runtime.port,hooks,at:new Date().toISOString()},null,2));
    clearTimeout(deadline);await runtime.close(true);term.dispose();process.exit(0);
   })().catch(async error=>{fs.writeFileSync(path.join(root,'before-error.json'),JSON.stringify({error:error.message}));await runtime.close().catch(()=>undefined);process.exit(1);});},50);}
   return answer;
  });
  if(!keeperPid()||!keeperInstance())throw new Error('Native keeper unavailable; restart evidence denied');runtime.runner.hooksReady();
  runtime.startSession(task,{log:()=>{},tool:()=>{},sessionId:id=>{sessionId=id;},browserUrl:()=>{},screenshot:()=>{},finished:result=>{if(!handingOff){fs.writeFileSync(path.join(root,'premature.json'),JSON.stringify({ok:result.ok,errors:result.errors}));process.exitCode=1;}}});
 }else{
  const held=await runtime.runner.reconnectClis(agent=>agent==='restart-verifier'?term:null);
  const adopted=held.find(row=>row.agentId==='restart-verifier');
  if(!adopted?.busy||adopted.resumeId!==checkpoint.sessionId)throw new Error('Busy retained native session not recovered');
  const actual={serverPid:process.pid,keeperPid:keeperPid(),keeperInstance:keeperInstance(),nativePids:runtime.runner.officeProcesses().pids.filter(pid=>pid!==keeperPid()),sessionId:adopted.resumeId,at:new Date().toISOString()};
  const resultPromise=new Promise<import('../server/agentRunner.ts').SessionResult>(resolve=>{runtime.startSession({...task,reattach:true,resumeSessionId:adopted.resumeId!},{log:()=>{},tool:()=>{},sessionId:id=>{sessionId=id;},browserUrl:()=>{},screenshot:()=>{},finished:resolve});});
  for(let i=0;i<200&&runtime.runner.runtimeCleanupView().readiness.length;i++)await new Promise(resolve=>setTimeout(resolve,25));
  if(runtime.runner.runtimeCleanupView().readiness.length)throw new Error('Adoption readiness did not settle');
  runtime.runner.hooksReady();const result=await resultPromise;
  const receipt=readSessionAttempts(process.env.SWARM_HOME).find(row=>row.id===result.sessionEvidenceId)?.rows?.at(-1);
  await runtime.close();clearTimeout(deadline);term.dispose();
  fs.writeFileSync(path.join(root,'adopted.json'),JSON.stringify({...actual,finalSessionId:sessionId,ok:result.ok,errors:result.errors,finish:receipt,cleanup:'verified'},null,2));process.exit(result.ok?0:1);
 }
}catch(error){clearTimeout(deadline);await runtime.close().catch(()=>undefined);fs.writeFileSync(path.join(root,stage+'-error.json'),JSON.stringify({error:error instanceof Error?error.message:String(error)}));process.exit(1);}
