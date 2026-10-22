/** Real Swarm scheduler/process-persistence acceptance driver. External work is explicitly synthetic. */
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type {Backend} from '../server/backend.ts';
import type {SessionCallbacks, SessionOptions} from '../server/agentRunner.ts';
import {schedulerNativeAttemptMeasured} from './schedulerRetryChecks.ts';

const [flag, rootArg, phaseArg] = process.argv.slice(2);
const live=flag==='--live';
const phase = Number(phaseArg), root = path.resolve(rootArg || '.');
if ((!live&&flag !== '--synthetic') || ![1,2,3,4].includes(phase) ||
    !path.basename(root).startsWith('cubefarm-scheduler-retry-') || process.env.SWARM_HOME !== root) {
  throw new Error('Requires --synthetic or explicit --live, an isolated cubefarm-scheduler-retry-* SWARM_HOME and phase 1..4');
}
const stat = await fs.lstat(root);
if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('Unsafe fixture root');
// Advance the process test clock to skip scheduler cooldown; lifecycle and disk operations remain real.
const nativeNow = Date.now;
Date.now = () => nativeNow() + phase * 180_000;
process.env.SWARM_PORT='0';
const {Swarm} = await import('../server/swarm.ts');
const {ExecutionLedger} = await import('../server/executionLedger.ts');
const hooks:Record<string,unknown>[]=[];
const runtime=live?await (await import('./geminiLiveRuntime.ts')).createGeminiLiveRuntime(root,{onHook:(_token,body)=>hooks.push({...body,observedAt:new Date().toISOString()})}):null;
const nativeResults:Record<string,unknown>[]=[];
const repoId = 'synthetic/scheduler-retry';
const stateFile = path.join(root, 'state.json');
if (phase === 1) {
  try { await fs.access(stateFile); throw new Error('Refusing to overwrite an existing fixture state'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.writeFile(stateFile, JSON.stringify({version:2,settings:{runtime:'terminal',ceoHeartbeatMin:0,autoUpdate:false},repos:[{
    id:repoId,fullName:repoId,defaultBranch:'main',floor:1,color:'#000',description:'Synthetic scheduler acceptance',url:'',
    autoAssign:true,autoMerge:false,browserTesting:false,addedAt:1,
  }]}));
}
const launches: {id:string|undefined;agentId:string|undefined;pid:number;phase:number}[] = [];
const nothing = async () => {};
const backend = {
  demo:false,terminals:live,user:async()=> 'synthetic-user',reconnectClis:async()=>[],hooksReady:()=>{runtime?.runner.hooksReady();},detectClis:async()=>[],releaseClis:nothing,
  setLocalPath:()=>{},ensureClone:nothing,releaseDesk:nothing,removeDesk:nothing,
  listIssues:async()=>[{number:1,title:'Synthetic automatic retry acceptance',body:'Test only',url:'https://example.test/issues/1',labels:[],assignees:[]}],
  listPulls:async()=>[],syncMain:async()=>null,prForBranch:async()=>null,issueState:async()=> 'OPEN',
  mainDir:()=>root,deskDir:()=>root,prepareDesk:async()=>root,
  startSession:(options:SessionOptions,callbacks:SessionCallbacks)=>{
    const launch={id:options.coordinatorAttemptId,agentId:options.agentId,pid:process.pid,phase};launches.push(launch);
    // Append from the actual external executor boundary, not from reservation/report assertions.
    appendFileSync(path.join(root,'executor-launches.jsonl'),JSON.stringify(launch)+'\n');
    if(runtime){
      const startedAt=new Date().toISOString();let sessionId:string|null=null;
      return runtime.startSession({...options,cli:'gemini',model:'',workerPreflight:true,workerPreflightMode:'discovery',prompt:'Reply exactly CUBEFARM_SCHEDULER_REJECT. Do not use tools.',
        systemAppend:'Synthetic scheduler acceptance only. Never use tools, read files, delegate, modify files or create a pull request.',keepAlive:false},
      {...callbacks,sessionId:id=>{sessionId=id;callbacks.sessionId(id);},finished:async result=>{
        const {parseUnambiguousJson}=await import('../server/unambiguousJson.ts');
        const {readSessionAttempts}=await import('../server/sessionEvidence.ts');
        let marker:string|null=null,nativeEvidenceError=false;
        const transcript=hooks.findLast(hook=>hook.hook_event_name==='UserPromptSubmit'&&hook.session_id===sessionId&&typeof hook.observedAt==='string'&&hook.observedAt>=startedAt)?.transcript_path;
        try{if(typeof transcript==='string'){
          const st=await fs.lstat(transcript);
          if(st.isFile()&&!st.isSymbolicLink()&&st.size<=16*1024*1024){
            const rows=(await fs.readFile(transcript,'utf8')).trimEnd().split('\n').map(line=>parseUnambiguousJson(line) as Record<string,unknown>);
            if(rows[0]?.sessionId===sessionId&&rows[0]?.projectHash===crypto.createHash('sha256').update(root).digest('hex')){
              for(const row of rows)if(row.type==='gemini'&&typeof row.timestamp==='string'&&row.timestamp>=startedAt&&typeof row.content==='string')marker=row.content.trim();
            }
          }
        }}catch{nativeEvidenceError=true;}
        let evidence:ReturnType<typeof readSessionAttempts>[number]|undefined;
        try{evidence=readSessionAttempts(root).find(row=>row.id===result.sessionEvidenceId);}catch{nativeEvidenceError=true;}
        const finish=evidence?.rows?.at(-1);
        const measured=schedulerNativeAttemptMeasured({nativeOk:result.ok,marker,coordinatorAttemptId:options.coordinatorAttemptId,agentId:options.agentId,start:evidence?.rows?.[0],finish});
        nativeResults.push({coordinatorAttemptId:options.coordinatorAttemptId,agentId:options.agentId,sessionId,evidenceId:result.sessionEvidenceId,nativeOk:result.ok,marker:marker==='CUBEFARM_SCHEDULER_REJECT'?marker:null,nativeEvidenceError,measured,start:evidence?.rows?.[0],finish});
        // The native response is genuine; the test's semantic acceptance rejects this fixed marker.
        await callbacks.finished({...result,ok:false,text:'Synthetic semantic acceptance rejected the marker',errors:[measured?'Synthetic semantic rejection':'Native evidence incomplete; live acceptance blocked']});
      }});
    }
    const timer=setTimeout(()=>void callbacks.finished({ok:false,text:'Synthetic executor failure',costUsd:0,turns:0,errors:['Synthetic executor failure']}),40);
    return {stop:()=>clearTimeout(timer),send:()=>{}};
  },
  previews:{hasDefault:async()=>false,start:()=>{throw new Error('Unexpected preview');}},
  office:{head:async()=>null,takeLastUpdate:async()=>null,isOwnFolder:()=>false},
} as unknown as Backend;
const ledger=new ExecutionLedger(root);ledger.init();
const swarm=new Swarm(backend);swarm.executionLedger=ledger;swarm.capabilityPreflight=async()=>null;
try {
  await swarm.init();
  if(phase===1)swarm.hireAgent(repoId,{name:'Synthetic retry worker',...(live?{cli:'gemini' as const}:{})});
  // This is the production scheduler entry point used by its interval, not assign() or a preseeded ledger.
  const scheduler=swarm as unknown as {schedule:()=>void};
  const deadline=nativeNow()+(live&&phase<4?90000:5000);
  do {
    scheduler.schedule();
    await new Promise(resolve=>setTimeout(resolve,80));
    const agent=swarm.snapshot().agents.find(row=>row.name==='Synthetic retry worker');
    if(phase<4&&launches.length&&agent?.status==='error')break;
    if(phase===4&&nativeNow()>deadline-3500)break;
  } while(nativeNow()<deadline);
  const events=ledger.export();
  const reserved=events.filter(event=>event.kind==='reserve');
  const launched=events.filter(event=>event.kind==='launch');
  const report={phase,pid:process.pid,executor:live?'authenticated Gemini with synthetic semantic rejection':'synthetic',scheduler:'real Swarm.schedule',clock:'process test-clock advance to skip scheduler cooldown',launches,nativeResults,
    reserved:reserved.length,reservationIds:reserved.map(event=>event.id),launched:launched.length,allAutomatic:reserved.every(event=>event.automatic),
    retryHold:reserved.length?ledger.blocked(reserved[0].context):null,
    outcomes:events.filter(event=>event.kind==='finish').map(event=>event.outcome),finishIds:events.filter(event=>event.kind==='finish').map(event=>event.id),
    scopeKeys:reserved.map(event=>JSON.stringify(event.context)),agents:swarm.snapshot().agents.map(row=>({id:row.id,status:row.status,lastError:row.lastError})),
  };
  await fs.writeFile(path.join(root,`phase-${phase}.json`),JSON.stringify(report,null,2));
  if(launches.length!==(phase<4?1:0)||reserved.length!==Math.min(phase,3)||launched.length!==Math.min(phase,3)||!report.allAutomatic||live&&phase<4&&!nativeResults.some(row=>row.measured===true))throw new Error('Scheduler retry acceptance failed: '+JSON.stringify(report));
} finally {
  await swarm.shutdown(true);
  await runtime?.close();
  const reportFile=path.join(root,`phase-${phase}.json`);
  try{const report=JSON.parse(await fs.readFile(reportFile,'utf8'));await fs.writeFile(reportFile,JSON.stringify({...report,cleanup:'verified'},null,2));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
if(live)process.exit(0); // Dedicated helper, only after native cleanup and server shutdown both succeeded.
