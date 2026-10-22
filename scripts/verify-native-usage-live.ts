import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
if(!process.argv.includes('--live'))throw new Error('Requires explicit --live: authenticated synthetic model usage');
const priorPath=path.resolve('output/native-usage-live.json');
const prior=process.argv.includes('--continue')?JSON.parse(fs.readFileSync(priorPath,'utf8')):null;
const root:string=prior?.root??fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cubefarm-usage-live-'));
if(path.dirname(root)!==fs.realpathSync(os.tmpdir())||!path.basename(root).startsWith('cubefarm-usage-live-'))throw new Error('Unexpected verification root');
const nativeHome=path.join(root,'codex'),officeHome=path.join(root,'office'),cwd=path.join(root,'synthetic');
for(const dir of [root,nativeHome,officeHome,cwd]){fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(dir).toLowerCase()!==path.resolve(dir).toLowerCase())throw new Error('Verification directories must be canonical without symlink redirection');}
const authSource=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'auth.json');
const copiedAuth=path.join(nativeHome,'auth.json');
process.once('exit',()=>{fs.rmSync(copiedAuth,{force:true});});
if(fs.existsSync(authSource))fs.copyFileSync(authSource,copiedAuth);
fs.writeFileSync(path.join(nativeHome,'config.toml'),'model_reasoning_effort="low"\n[features]\nhooks=true\n');
process.env.CODEX_HOME=nativeHome;process.env.SWARM_HOME=officeHome;process.env.SWARM_PORT='0';
const {AgentTerminal}=await import('../server/terminal.ts');
class VerificationTerminal extends AgentTerminal {nativeSink:import('../server/terminal.ts').TerminalSink|null=null;override bind(sink:import('../server/terminal.ts').TerminalSink|null){super.bind(sink);this.nativeSink=sink;}escape(){this.nativeSink?.write('\x1b');this.onInput?.('\x1b');}}
const runner=await import('../server/cliRunner.ts');
const {readSessionAttempts}=await import('../server/sessionEvidence.ts');
const {verifyGeminiProfile}=await import('../server/geminiBridge.ts');
const {commandFor}=await import('../server/clis.ts');
const {setToolGovernanceGate}=await import('../server/toolGovernance.ts');
setToolGovernanceGate(async()=>({status:'blocked',reason:'Synthetic live verification prohibits tools'}));
const attempts:Record<string,unknown>[]=prior?.attempts??[],hooks:Record<string,unknown>[]=prior?.hooks??[];let interrupt:(()=>void)|undefined;
const server=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024*1024)throw new Error();}const body=JSON.parse(raw);hooks.push({at:new Date().toISOString(),event:body.hook_event_name,sessionId:body.session_id,turnId:body.turn_id,hasTranscript:typeof body.transcript_path==='string'&&body.transcript_path.length>0});const result=await runner.handleHook(req.url?.split('/').at(-1)??'',body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));if(body.hook_event_name==='UserPromptSubmit')interrupt?.();}catch{res.writeHead(400);res.end('{}');}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));runner.setOfficeUrl(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
let resume:string|undefined=attempts.findLast(row=>typeof row.sessionId==='string')?.sessionId as string|undefined;
async function run(name:string,prompt:string,stop=false){
 for(let i=0;i<60&&runner.runtimeCleanupView().records.length;i++)await new Promise(resolve=>setTimeout(resolve,250));
 if(runner.runtimeCleanupView().records.length)throw new Error('Native cleanup remained quarantined after bounded wait');
 const term=new VerificationTerminal(),started=Date.now();let sessionId:string|null=null;let timer:NodeJS.Timeout|undefined;
 const result=await new Promise<import('../server/agentRunner.ts').SessionResult>(resolve=>{
  const handle=runner.startCliSession({cwd,prompt,systemAppend:'Synthetic verification only. Never use tools, read files, delegate, or modify anything.',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:term,agentId:'usage-verifier',coordinatorAttemptId:crypto.randomUUID(),resumeSessionId:name==='resume'?resume:undefined,authorizeTool:async()=>null},{log:()=>{},tool:()=>{},sessionId:id=>{sessionId=id;},browserUrl:()=>{},screenshot:()=>{},finished:resolve});
  timer=setTimeout(()=>handle.stop(),75000);if(stop)interrupt=()=>{interrupt=undefined;setTimeout(()=>name==='native-escape'?term.escape():handle.stop(),1000);};
 });clearTimeout(timer);interrupt=undefined;await new Promise(resolve=>setTimeout(resolve,300));
 const evidence=readSessionAttempts(officeHome).find(row=>row.id===result.sessionEvidenceId),finish=evidence?.rows?.at(-1);
 if(sessionId)resume=sessionId;
 const expected=name==='resume'?'CUBEFARM_RESUME_OK':'CUBEFARM_USAGE_OK';const text=result.text.trim();
 const row={name,taskKey:'synthetic-output-contract',retryOf:name==='retry'?attempts.findLast(row=>row.name==='semantic-failure')?.evidenceId:null,expectedOutput:expected,syntheticOutput:/^CUBEFARM_[A-Z_]+$/.test(text)?text:null,taskAccepted:result.ok&&text===expected,ok:result.ok,interrupted:result.interrupted??false,errors:result.errors,elapsedMs:Date.now()-started,sessionId,evidenceId:result.sessionEvidenceId,finish};attempts.push(row);console.log(JSON.stringify({name,ok:result.ok,errors:result.errors,usageCoverage:finish?.usageCoverage,inputTokens:finish?.inputTokens}));term.dispose();return result.ok;
}
const reportPath=path.resolve('output/native-usage-live.json');
let cleanup='not-run';
try{
 const geminiBlocker=await verifyGeminiProfile(commandFor('gemini'));
 attempts.push({runtime:'gemini',status:geminiBlocker?'blocked':'ready',reason:geminiBlocker});
 if(process.argv.includes('--only-interruption')){if(!attempts.some(row=>row.name==='native-escape'&&row.interrupted===true))await run('native-escape','Generate a list of 1000 synthetic words in your response. Do not use tools.',true);}
 else {const success=prior?.attempts.some((row:Record<string,unknown>)=>row.name==='success'&&row.ok===true)??await run('success','Reply exactly CUBEFARM_USAGE_OK. Do not use tools.');
 if(success){if(!attempts.some(row=>row.name==='semantic-failure'&&row.ok===true))await run('semantic-failure','Reply exactly CUBEFARM_EXPECTED_FAIL. Do not use tools.');if(!attempts.some(row=>row.name==='retry'&&row.ok===true))await run('retry','Reply exactly CUBEFARM_USAGE_OK. Do not use tools.');if(!attempts.some(row=>row.name==='resume'&&row.ok===true))await run('resume','Reply exactly CUBEFARM_RESUME_OK. Do not use tools.');if(!attempts.some(row=>row.name==='interruption'))await run('interruption','Generate a long list of 1000 synthetic words in your response. Do not use tools.',true);}}
}catch(error){attempts.push({status:'blocked',reason:error instanceof Error?error.message:'Live verification failed'});process.exitCode=1;}finally{
 try{await runner.releaseClis(false);cleanup='verified';}catch{cleanup='unverified';}
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 fs.rmSync(path.join(nativeHome,'auth.json'),{force:true});
 fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify({at:new Date().toISOString(),root,scope:'authenticated synthetic native runner; no real office or tenant',attempts,hooks,cleanup},null,2));console.log(JSON.stringify({reportPath,cleanup}));
}
process.exitCode=attempts.some(a=>a.ok===false||a.status==='blocked')||cleanup!=='verified'?1:0;
