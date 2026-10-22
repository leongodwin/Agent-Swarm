import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {AgentTerminal} from './terminal.ts';
import type {SessionOptions} from './agentRunner.ts';
const mock=vi.hoisted(()=>({token:'',write:vi.fn(),spawn:vi.fn(),exit:undefined as ((code:number)=>void)|undefined,trust:vi.fn(),command:vi.fn(),screen:'',transport:vi.fn(),close:vi.fn()}));
vi.mock('./config.ts',async original=>{const base=await original<typeof import('./config.ts')>(),fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');return {...base,HOME_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'cf-runtime-cli-'))};});
vi.mock('./clis.ts',async original=>({...await original<typeof import('./clis.ts')>(),commandFor:mock.command,codexThread:vi.fn(async()=>{})}));
vi.mock('./codexHookTrust.ts',()=>({prepareCodexHooks:mock.trust}));
vi.mock('./geminiBridge.ts',async original=>({...await original<typeof import('./geminiBridge.ts')>(),verifyGeminiProfile:vi.fn(async()=>null)}));
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js',()=>({StreamableHTTPServerTransport:class {close=mock.close;handleRequest=mock.transport;}}));
vi.mock('./ptyClient.ts',()=>({terminalsAvailable:true,keeperHookUrl:()=>null,keeperPid:()=>0,keeperInstance:()=>null,hooksReady:vi.fn(),leaveKeeper:vi.fn(),startKeeper:vi.fn(async()=>[]),discardPty:vi.fn(),adoptPty:vi.fn(),spawnPty:mock.spawn}));
import {HOME_DIR} from './config.ts';
import {handleHook,handleMcp,releaseClis,setOfficeUrl,startCliSession,runtimeCleanupView,reconnectClis,officeProcesses} from './cliRunner.ts';
import {setToolGovernanceGate} from './toolGovernance.ts';
import {readSessionAttempts,SessionEvidence} from './sessionEvidence.ts';
import type {OfficeTools} from './ceo.ts';
import {startKeeper,adoptPty,discardPty} from './ptyClient.ts';
import {CODEX_HOOK_SOURCE} from './clis.ts';
import {GEMINI_HOOK_SOURCE} from './geminiBridge.ts';
import {verifyGeminiProfile} from './geminiBridge.ts';
import {CodexModelNotAdvertisedError} from './codexModelMetadata.ts';
import * as skillRegistry from './skillRegistry.ts';
import {workerMcpBindings} from './workerMcp.ts';
const callbacks=()=>({log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn(),usageWarning:vi.fn(),limited:vi.fn(),turn:vi.fn()});
it('withholds Gemini prompt and readiness until concurrent owning identity checkpoints persist',async()=>{
 const run=await session({cli:'gemini',model:'gemini-synthetic'}),bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
 let persist!:()=>void;run.cb.sessionId.mockImplementation(()=>new Promise<void>(resolve=>{persist=resolve;}));
 const start=handleHook(run.token,{hook_event_name:'SessionStart',session_id:'checkpoint-root',bridgeSha256});
 for(let i=0;i<10;i++)await Promise.resolve();expect(run.cb.sessionId).toHaveBeenCalledOnce();
 const repeated=handleHook(run.token,{hook_event_name:'SessionStart',session_id:'checkpoint-root',bridgeSha256});
 mock.screen='Type your message';await vi.advanceTimersByTimeAsync(1000);
 expect(mock.write).not.toHaveBeenCalled();
 expect(mock.spawn.mock.results[0].value.setMeta).not.toHaveBeenCalledWith(expect.objectContaining({governanceReady:true}));
 persist();await Promise.all([start,repeated]);await vi.advanceTimersByTimeAsync(1000);
 expect(mock.write).toHaveBeenCalledWith(expect.stringContaining('Synthetic runtime task'));run.handle.stop();
});
it.each(['reject','cancel'])('denies Gemini execution after an identity checkpoint %s',async mode=>{
 const run=await session({cli:'gemini',model:'gemini-synthetic'}),bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
 let resolve!:()=>void,reject!:(error:Error)=>void;run.cb.sessionId.mockImplementation(()=>new Promise<void>((yes,no)=>{resolve=yes;reject=no;}));
 const pending=handleHook(run.token,{hook_event_name:'SessionStart',session_id:'checkpoint-root',bridgeSha256});
 for(let i=0;i<10;i++)await Promise.resolve();
 if(mode==='reject')reject(new Error('Synthetic disk failure'));else{run.handle.stop();resolve();}
 expect(await pending).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 mock.screen='Type your message';await vi.advanceTimersByTimeAsync(1000);run.handle.send('must remain withheld');
 expect(mock.write).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledOnce();
 if(mode==='reject')expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,failureCategory:'audit'}));
});
it.each([undefined,null,123])('rejects a Gemini startup without a verified root ID while checkpointing: %s',async session_id=>{
 const run=await session({cli:'gemini',model:'gemini-synthetic'}),bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
 let persist!:()=>void;run.cb.sessionId.mockImplementation(()=>new Promise<void>(resolve=>{persist=resolve;}));
 const pending=handleHook(run.token,{hook_event_name:'SessionStart',session_id:'checkpoint-root',bridgeSha256});
 for(let i=0;i<10;i++)await Promise.resolve();
 expect(await handleHook(run.token,{hook_event_name:'SessionStart',session_id,bridgeSha256})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 mock.screen='Type your message';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).not.toHaveBeenCalled();
 persist();await pending;run.handle.stop();
});
it('cannot promote Gemini root readiness from a child startup during a pending root checkpoint',async()=>{
 const run=await session({cli:'gemini',model:'gemini-synthetic'}),bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
 let persist!:()=>void;run.cb.sessionId.mockImplementation(()=>new Promise<void>(resolve=>{persist=resolve;}));
 const pending=handleHook(run.token,{hook_event_name:'SessionStart',session_id:'checkpoint-root',bridgeSha256});
 for(let i=0;i<10;i++)await Promise.resolve();
 await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'child-checkpoint',agent_id:'child',bridgeSha256});
 mock.screen='Type your message';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).not.toHaveBeenCalled();
 expect(run.cb.sessionId).toHaveBeenCalledExactlyOnceWith('checkpoint-root');
 expect(mock.spawn.mock.results[0].value.setMeta).not.toHaveBeenCalledWith(expect.objectContaining({governanceReady:true}));
 persist();await pending;await vi.advanceTimersByTimeAsync(1000);
 expect(mock.write).toHaveBeenCalledWith(expect.stringContaining('Synthetic runtime task'));run.handle.stop();
});
const terminal=()=>({cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>mock.screen,onInput:null,releaseIdle:null}) as unknown as AgentTerminal;
async function session(extra:Partial<SessionOptions>={}){const cb=callbacks(),term=terminal(),options:SessionOptions={cwd:HOME_DIR,prompt:'Synthetic runtime task',systemAppend:'Synthetic guidance',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:term,authorizeTool:()=>null,...extra};const handle=startCliSession(options,cb);for(let i=0;i<40;i++)await Promise.resolve();return {cb,term,handle,token:mock.token};}
beforeEach(()=>{vi.useFakeTimers();mock.screen='';vi.mocked(startKeeper).mockReset().mockResolvedValue([]);vi.mocked(adoptPty).mockReset();vi.mocked(discardPty).mockClear();mock.write.mockReset();mock.spawn.mockReset();mock.trust.mockReset().mockResolvedValue({verified:5,hashes:[]});mock.command.mockReset().mockReturnValue({file:'synthetic-cli',args:[]});mock.transport.mockReset();mock.close.mockReset();setOfficeUrl('http://127.0.0.1:0');setToolGovernanceGate(async()=>({status:'allowed',reason:'Synthetic policy'}));mock.spawn.mockImplementation((_file,_args,_options,meta:{token:string})=>{mock.token=meta.token;let closed=false;const handlers:((code:number)=>void)[]=[];mock.exit=code=>{closed=true;for(const cb of handlers.splice(0))cb(code);};return {pid:0,get verifiedExit(){return closed;},write:mock.write,resize:vi.fn(),kill:()=>mock.exit?.(0),setMeta:vi.fn(),onData:vi.fn(),onExit:(cb:(code:number)=>void)=>closed?queueMicrotask(()=>cb(0)):handlers.push(cb)};});});
afterEach(async()=>{mock.exit?.(0);await releaseClis(false);vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();setToolGovernanceGate(async()=>({status:'unavailable',reason:'Not initialized'}));});
afterAll(()=>fs.rmSync(HOME_DIR,{recursive:true,force:true,maxRetries:10}));

it.each(['authoring','discovery'] as const)('launches native tools through the %s worker pipeline without bypassing authority',async mode=>{
 const root=path.join(HOME_DIR,`native-pipeline-fixture-${mode}`),plugin=path.join(root,'power-automate','1.0.0'),folder=path.join(plugin,'skills','build-flow');
 fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(plugin,'server'));fs.mkdirSync(path.join(root,'.cubefarm'));
 const content='Synthetic pinned workflow guidance',sha256=crypto.createHash('sha256').update(content).digest('hex'),file=path.join(folder,'SKILL.md');fs.writeFileSync(file,content);
 fs.writeFileSync(path.join(plugin,'server','mcp.mjs'),'// Synthetic entry, never executed');fs.writeFileSync(path.join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{flowagent:{command:'node',args:[]}}}));
 const skill:skillRegistry.InstalledSkill={id:'power-automate:build-flow',name:'build-flow',platform:'power-automate',file,source:'plugin',activation:'configured',version:'1.0.0',sha256,description:'Synthetic test guidance',toolStatus:'unverified'};
 vi.spyOn(skillRegistry,'discoverSkills').mockReturnValue({fingerprint:'fixture',warnings:[],skills:[skill]});
 const proposed=workerMcpBindings([skill])[0];if(proposed.status==='unavailable')throw Error('Missing fixture binding');const {status:_,...binding}=proposed;
 const probe={id:'caller-target',tool:'mcp__flowagent__whoami',nativeNames:{opencode:'flowagent_whoami'},readOnly:true,input:{},assertions:[{kind:'identity',pointer:['username'],equals:'maker@example.test'},{kind:'target',pointer:['environmentId'],equals:'dedicated-test'}]};
 const plan={schemaVersion:1,scope:'Synthetic isolated pipeline test',maxAgeSeconds:60,skills:[{id:skill.id,sha256}],mcpServers:[binding],probes:[probe]};
 if(mode==='discovery'){fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs','worker-preflight.candidate.json'),JSON.stringify(plan));}
 else fs.writeFileSync(path.join(root,'.cubefarm','worker-preflight.json'),JSON.stringify(plan));
 const server={tool:vi.fn(),connect:vi.fn(),close:vi.fn()};
 let authority:string|null=null;const run=await session({cwd:root,workerPreflight:true,workerPreflightMode:mode,cli:'opencode',model:'openai/gpt-synthetic',authorizeTool:()=>authority,repoId:'synthetic/repo',taskEvidenceKey:'synthetic/repo:dev:1',office:{serve:()=>server} as unknown as OfficeTools});
 await handleMcp(run.token,{body:{}} as never,{on:vi.fn()} as never);
 const inspect=server.tool.mock.calls.find(call=>call[0]==='worker_preflight_status')![3];
 expect(JSON.parse((await inspect()).content[0].text).observation.preflight.nativeChecksSatisfied).toBe(false);
 const env=mock.spawn.mock.calls[0][2].env;expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp.flowagent.command).toEqual([process.execPath,path.join(plugin,'server','mcp.mjs')]);
 const pre=(id:string,name:string,input={})=>handleHook(run.token,{hook_event_name:'PreToolUse',tool_use_id:id,tool_name:name,tool_input:input});
 const post=(id:string,name:string,value:unknown)=>handleHook(run.token,{hook_event_name:'PostToolUse',tool_use_id:id,tool_name:name,tool_response:{content:[{type:'text',text:JSON.stringify(value)}]}});
 expect(await pre('blocked','flowagent_publish_flow')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 expect(await pre('skill','mcp__office__read_skill',{id:skill.id,sha256})).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}});await post('skill','mcp__office__read_skill',{id:skill.id,sha256,content});
 if(mode==='discovery'){
  expect(await pre('unapproved-read','flowagent_whoami')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(await pre('unapproved-write','flowagent_publish_flow')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(await pre('unapproved-shell','Bash')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});run.handle.stop();return;
 }
 expect(await pre('probe','flowagent_whoami')).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}});await post('probe','flowagent_whoami',{username:'maker@example.test',environmentId:'wrong-target'});
 expect(await pre('wrong-target','flowagent_publish_flow')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
 await pre('probe2','flowagent_whoami');await post('probe2','flowagent_whoami',{username:'maker@example.test',environmentId:'dedicated-test'});
 expect(await pre('ready','flowagent_publish_flow')).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}});
 const retained=JSON.parse((await inspect()).content[0].text);expect(retained.observation).toMatchObject({repoId:'synthetic/repo',taskKey:'synthetic/repo:dev:1',preflight:{nativeChecksSatisfied:true,authoringAuthorityGranted:false}});
 expect(retained.observation.preflight.probes[0].proof.callId).toBe('probe2');expect(fs.existsSync(retained.evidence.reference)).toBe(true);
 authority='Task ownership changed';expect(await pre('lost-task','flowagent_publish_flow')).toMatchObject({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'Task ownership changed'}});
 expect((await inspect()).isError).toBe(true);
 run.handle.stop();
 expect((await inspect()).isError).toBe(true);
 const report=readSessionAttempts(HOME_DIR).find(entry=>entry.rows?.some(row=>row.kind==='result'&&row.callId==='probe2'));
 expect(report?.rows).toContainEqual(expect.objectContaining({kind:'result',callId:'probe2',readiness:'ready',probeIds:['caller-target']}));
});

it('fails closed for missing routes and malformed hook envelopes and returns a session-ended MCP error',async()=>{
  expect(await handleHook('missing',{hook_event_name:'PreToolUse'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});for(const body of [null,[],false,'string'])expect(await handleHook('missing',body)).toEqual({});
  const res={status:vi.fn().mockReturnThis(),json:vi.fn()};await handleMcp('missing',{} as never,res as never);expect(res.status).toHaveBeenCalledWith(404);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({error:{code:-32001,message:'This session has ended.'}}));
});

describe('tool result observations',()=>{
  it.each([
    ['plain response','plain response'],[{stdout:'output',stderr:'diagnostic'},'output'],[{file:{content:'nested file content'}},'nested file content'],[{filenames:['a.ts','b.ts']},'a.ts'],[{content:[{type:'text',text:'structured content'},{type:'image',data:'AA==',mimeType:'image/png'}]},'structured content'],[[{type:'text',text:'array response'},{type:'image',source:{type:'base64',data:'AA=='}}],'array response'],[null,''],
  ])('normalizes observed output without treating it as authorisation: %j',async(response,text)=>{
    const run=await session();await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'mcp__fixture__inspect',tool_use_id:'read',tool_input:{file_path:path.join(HOME_DIR,'fixture.txt')}});await handleHook(run.token,{hook_event_name:'PostToolUse',tool_use_id:'read',tool_response:response});
    if(text)expect(JSON.stringify(run.cb.log.mock.calls)).toContain(text);expect(run.cb.tool).toHaveBeenLastCalledWith(null);run.handle.stop();
  });

  it('records subagent results without adding user-visible root task activity and logs failed tools precisely',async()=>{
    const run=await session();const before=run.cb.log.mock.calls.length;await handleHook(run.token,{hook_event_name:'PreToolUse',agent_id:'child',tool_name:'Read',tool_use_id:'child-read',tool_input:{}});await handleHook(run.token,{hook_event_name:'PostToolUse',agent_id:'child',tool_name:'Read',tool_use_id:'child-read',tool_response:{stdout:'subagent secret fixture'}});expect(run.cb.log.mock.calls.length).toBe(before);
    await handleHook(run.token,{hook_event_name:'PostToolUseFailure',tool_name:'Read',tool_use_id:'unknown',tool_response:{stderr:'failed file'},error:'specific synthetic failure\nsecond line'});expect(JSON.stringify(run.cb.log.mock.calls)).toContain('specific synthetic failure');run.handle.stop();
  });

  it('reports browser navigation from input and result evidence, preserving governance denial',async()=>{
    const run=await session();await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'mcp__playwright__browser_navigate',tool_use_id:'navigate',tool_input:{url:'http://synthetic.invalid/first'}});await handleHook(run.token,{hook_event_name:'PostToolUse',tool_use_id:'navigate',tool_response:'Page URL: http://synthetic.invalid/second'});expect(run.cb.browserUrl.mock.calls).toEqual([['http://synthetic.invalid/first'],['http://synthetic.invalid/second']]);
    setToolGovernanceGate(async()=>({status:'blocked',reason:'Synthetic tool denied'}));expect(await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'Edit',tool_use_id:'edit'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'Synthetic tool denied'}});run.handle.stop();
  });
});

it('deduplicates usage warnings, keeps invalid status costs out, and carries the observed reset into rate-limit failure',async()=>{
  const run=await session();await handleHook(run.token,{hook_event_name:'StatusLine',cost:{total_cost_usd:2},rate_limits:{daily:{used_percentage:95,resets_at:123},invalid:{used_percentage:'bad'}}});await handleHook(run.token,{hook_event_name:'StatusLine',cost:{total_cost_usd:-1},rate_limits:{daily:{used_percentage:99}}});expect(run.cb.usageWarning).toHaveBeenCalledExactlyOnceWith({resetsAt:123000,rateLimitType:'daily',utilization:.95});
  await handleHook(run.token,{hook_event_name:'StatusLine',rate_limits:{daily:{used_percentage:100,resets_at:456}}});await handleHook(run.token,{hook_event_name:'StopFailure',error:'rate_limit',error_details:'synthetic quota exhausted'});expect(run.cb.limited).toHaveBeenCalledExactlyOnceWith(456000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,costUsd:2,errors:['Codex stopped: rate limit (synthetic quota exhausted)']}));
});

it('buffers follow-up paste safely, distinguishes terminal prompts, and suppresses subagent prompt reports',async()=>{
  const run=await session();mock.screen='› ';run.handle.send('first\r\nsecond\x1b[200~');expect(mock.write).toHaveBeenCalledWith('\x1b[200~first\nsecond\x1b[201~');await vi.advanceTimersByTimeAsync(500);expect(mock.write).not.toHaveBeenCalledWith('\r');mock.screen='› first\nsecond';await vi.advanceTimersByTimeAsync(150);expect(mock.write).toHaveBeenLastCalledWith('\r');
  await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'first\nsecond'});await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'Manager typed new work\nmore'});await handleHook(run.token,{hook_event_name:'UserPromptSubmit',agent_id:'child',prompt:'child prompt'});await handleHook(run.token,{hook_event_name:'Notification',notification_type:'permission_prompt'});expect(JSON.stringify(run.cb.log.mock.calls)).toContain('Typed in the terminal: Manager typed new work');expect(JSON.stringify(run.cb.log.mock.calls)).not.toContain('child prompt');expect(JSON.stringify(run.cb.log.mock.calls)).toContain('waiting for a permission answer');run.handle.stop();
});

it('keeps side-thread completions from ending Codex work and accepts only the owning prompt then thread',async()=>{
  const run=await session();await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'side',input:'Title the conversation',last_assistant_message:'side output'});await vi.advanceTimersByTimeAsync(3500);expect(run.cb.finished).not.toHaveBeenCalled();
  await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'root',input:'Synthetic runtime task',last_assistant_message:'line\n'.repeat(35)});await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'side',input:'Synthetic runtime task',last_assistant_message:'wrong owner'});await vi.advanceTimersByTimeAsync(3000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:true,text:'line\n'.repeat(35).trim(),turns:1}));expect(JSON.stringify(run.cb.log.mock.calls)).toContain('more lines');expect(run.cb.sessionId).toHaveBeenCalledExactlyOnceWith('root');
});

it('rejects overlapping Codex sends while its earlier paste is awaiting acknowledgement',async()=>{
  const run=await session();mock.screen='› ';run.handle.send('first task');run.handle.send('second task');
  expect(mock.write).toHaveBeenCalledWith('\x1b[200~first task\x1b[201~');expect(mock.write).not.toHaveBeenCalledWith('\x1b[200~second task\x1b[201~');
  expect(JSON.stringify(run.cb.log.mock.calls)).toContain('overlapping message was not pasted');
  mock.screen='› first task';await vi.advanceTimersByTimeAsync(150);expect(mock.write).toHaveBeenLastCalledWith('\r');run.handle.stop();
});

it('cancels runtime admission before native trust settles and never launches a stopped task',async()=>{
  let resolve!:(value:unknown)=>void;mock.trust.mockImplementation(()=>new Promise(yes=>{resolve=yes;}));const run=await session();expect(mock.spawn).not.toHaveBeenCalled();expect(runtimeCleanupView().readiness).toEqual([expect.objectContaining({state:'checking'})]);run.handle.stop();expect(runtimeCleanupView().readiness).toEqual([expect.objectContaining({state:'cancelled'})]);resolve({verified:5,hashes:[]});for(let i=0;i<30;i++)await Promise.resolve();expect(mock.spawn).not.toHaveBeenCalled();expect(runtimeCleanupView().readiness).toEqual([]);expect(run.cb.finished).toHaveBeenCalledOnce();
});

it('denies launch on native command unavailability and on native spawn failure without fabricating success',async()=>{
  mock.command.mockReturnValue(null);const missing=await session();await vi.advanceTimersByTimeAsync(1);expect(missing.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:[expect.stringContaining("isn't installed")]}));expect(mock.spawn).not.toHaveBeenCalled();
  mock.command.mockReturnValue({file:'fixture',args:[]});mock.spawn.mockImplementation(()=>{throw new Error('synthetic spawn fault');});const failed=await session();await vi.advanceTimersByTimeAsync(1);expect(failed.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['Could not start Codex: synthetic spawn fault']}));
});

it('withholds success if finish evidence persistence fails and still isolates a failed finished callback',async()=>{
  const run=await session();vi.spyOn(SessionEvidence.prototype,'record').mockImplementation(event=>event.kind!=='finish');run.cb.finished.mockImplementation(()=>{throw new Error('synthetic consumer fault');});vi.spyOn(console,'warn').mockImplementation(()=>{});await handleHook(run.token,{hook_event_name:'Stop',last_assistant_message:'Claimed result'});await vi.advanceTimersByTimeAsync(3000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:[expect.stringContaining('could not be persisted')]}));expect(runtimeCleanupView().records).toEqual([]);
});

it('separates provider failures and wrong-session usage from verified OpenCode attempt measurements',async()=>{
  const run=await session({cli:'opencode',model:'openai/gpt-synthetic'});await handleHook(run.token,{hook_event_name:'OpenCodeSessionStart',session_id:'root'});const usage={schemaVersion:1,source:'opencode-message-v1',sampleId:'current-prompt',inputTokens:8,outputTokens:3,costUsd:.25};await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'child',failed:false,last_assistant_message:'ignored',usage});await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'root',failed:true,error:'synthetic provider fault',usage});expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['OpenCode: synthetic provider fault']}));const report=readSessionAttempts(HOME_DIR).find(entry=>entry.id===run.cb.finished.mock.calls[0][0].sessionEvidenceId);expect(report?.rows?.at(-1)).toMatchObject({kind:'finish',inputTokens:8,outputTokens:3,costUsd:.25,usageCoverage:'complete'});
});

it('rejects unverifiable OpenCode completion and records malformed native usage as unknown',async()=>{
  const run=await session({cli:'opencode',model:'openai/gpt-synthetic'});await handleHook(run.token,{hook_event_name:'OpenCodeSessionStart',session_id:'root'});await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'root',failed:false,last_assistant_message:'',usage:{inputTokens:0}});expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['OpenCode completion did not include a verified outcome']}));const report=readSessionAttempts(HOME_DIR).find(entry=>entry.id===run.cb.finished.mock.calls[0][0].sessionEvidenceId);expect(report?.rows?.at(-1)).toMatchObject({kind:'finish',inputTokens:null,outputTokens:null,costUsd:null,usageCoverage:'unknown'});
});

it('serves session-scoped MCP requests and closes both transport and tools when the response closes',async()=>{
  const toolServer={connect:vi.fn(async()=>{}),close:vi.fn()},office={serve:()=>toolServer} as unknown as OfficeTools,run=await session({office});const close:((...args:unknown[])=>void)[]=[];const res={on:vi.fn((_name:string,cb:(...args:unknown[])=>void)=>close.push(cb))},req={body:{jsonrpc:'2.0',id:1,method:'tools/list'}};await handleMcp(run.token,req as never,res as never);expect(toolServer.connect).toHaveBeenCalledOnce();expect(mock.transport).toHaveBeenCalledWith(req,res,req.body);close[0]();expect(mock.close).toHaveBeenCalledOnce();expect(toolServer.close).toHaveBeenCalledOnce();run.handle.stop();
});

it('keeps an admitted completed terminal idle but denies new tools until a checked follow-up owns it',async()=>{
  const run=await session({keepAlive:true});await handleHook(run.token,{hook_event_name:'Stop',last_assistant_message:'done'});await vi.advanceTimersByTimeAsync(3000);
  expect(await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'Edit'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});expect(await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'New manager request'})).toMatchObject({decision:'block'});expect(await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:''})).toEqual({});
  run.term.onIdlePrompt=()=>true;expect(await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'Accepted checked request'})).toEqual({});expect(await handleHook(run.token,{hook_event_name:'StatusLine'})).toEqual({statusLine:'🏢 Agent Swarm'});expect(officeProcesses().markers).toEqual([path.join(HOME_DIR,'sessions'),path.join(HOME_DIR,'bin')]);expect(run.term.releaseIdle).toBeTypeOf('function');await run.term.releaseIdle?.();
});

it('expires an idle retained CLI and does not accept a reattach after its process was lost',async()=>{
  const run=await session({keepAlive:true});await handleHook(run.token,{hook_event_name:'Stop',last_assistant_message:'done'});await vi.advanceTimersByTimeAsync(3000+30*60000);expect(run.term.releaseIdle).toBeNull();expect(await handleHook(run.token,{hook_event_name:'PreToolUse'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  const missing=await session({reattach:true});await vi.advanceTimersByTimeAsync(1);expect(missing.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['Codex stopped while the office restarted.']}));
});

it('recovers only verified retained terminals and preserves their resume, resize and input bindings',async()=>{
  const term=terminal(),meta={agentId:'ada',cli:'codex' as const,token:'synthetic-retained',dir:path.join(HOME_DIR,'sessions','retained'),resumeId:'root',busy:true,governanceSha256:crypto.createHash('sha256').update(CODEX_HOOK_SOURCE).digest('hex'),governanceReady:true};
  vi.mocked(startKeeper).mockResolvedValue([{id:'retained',pid:99,meta,exit:null}]);vi.mocked(adoptPty).mockImplementation(()=>mock.spawn('fixture',[],{},meta));
  expect(await reconnectClis(id=>id==='ada'?term:null)).toEqual([{agentId:'ada',cli:'codex',resumeId:'root',busy:true}]);const p=vi.mocked(adoptPty).mock.results[0].value;await vi.advanceTimersByTimeAsync(500);expect(p.resize).toHaveBeenCalledWith(79,24);expect(p.resize).toHaveBeenCalledWith(80,24);expect(term.bind).toHaveBeenCalledWith(expect.objectContaining({write:expect.any(Function),resize:expect.any(Function)}));
  const bound=vi.mocked(term.bind).mock.calls.at(-1)![0]!;bound.write('checked input');bound.resize(90,30);expect(mock.write).toHaveBeenCalledWith('checked input');expect(p.resize).toHaveBeenCalledWith(90,30);
});

it('cleans up retained terminals with missing ownership, obsolete governance, or a completed process',async()=>{
  const meta={agentId:'ada',cli:'codex' as const,token:'invalid-retained',dir:path.join(HOME_DIR,'sessions','retained'),resumeId:'root',busy:false,governanceSha256:'obsolete',governanceReady:true};vi.mocked(startKeeper).mockResolvedValue([{id:'done',pid:0,meta:null,exit:0},{id:'no-owner',pid:0,meta:null,exit:null},{id:'obsolete',pid:0,meta,exit:null}]);
  vi.mocked(adoptPty).mockImplementation(h=>{let closed=false;const callbacks:((code:number)=>void)[]=[];return {pid:h.pid,get verifiedExit(){return closed;},write:vi.fn(),resize:vi.fn(),setMeta:vi.fn(),onData:vi.fn(),onExit:cb=>{callbacks.push(cb);},kill:()=>{closed=true;for(const cb of callbacks)cb(0);}};});expect(await reconnectClis(()=>terminal())).toEqual([]);expect(discardPty).toHaveBeenCalledWith(expect.objectContaining({id:'done'}));expect(adoptPty).toHaveBeenCalledTimes(2);expect(runtimeCleanupView().records).toEqual([]);
});

it('withholds Gemini prompts until verified bridge startup and idle terminal readiness',async()=>{
  const run=await session({cli:'gemini',model:'gemini-synthetic'}),sha=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');expect(mock.write).not.toHaveBeenCalled();expect(await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'Edit',bridgeSha256:'wrong'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(await handleHook(run.token,{hook_event_name:'PreToolUse',session_id:'gemini-root',tool_name:'Edit',bridgeSha256:sha})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'Coding runtime governance startup is unverified'}});await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'gemini-root',bridgeSha256:sha});mock.screen='Type your message';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).toHaveBeenCalledWith(expect.stringContaining('Synthetic runtime task'));await handleHook(run.token,{hook_event_name:'Stop',session_id:'gemini-root',bridgeSha256:sha,last_assistant_message:'Verified synthetic bridge result'});await vi.advanceTimersByTimeAsync(3000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:true}));
});

it('times out Gemini governance startup without sending the task',async()=>{
  const run=await session({cli:'gemini',model:'gemini-synthetic'});await vi.advanceTimersByTimeAsync(90000);expect(mock.write).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:[expect.stringContaining('no task was sent')]}));
});

it('reports terminal interruption only after native screen evidence changes',async()=>{
  const run=await session({keepAlive:true});await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'Synthetic runtime task'});run.term.onInput?.('ordinary input');run.term.onInput?.('\x1b');await vi.advanceTimersByTimeAsync(800);expect(run.cb.finished).not.toHaveBeenCalled();mock.screen='Turn interrupted';await vi.advanceTimersByTimeAsync(1000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,interrupted:true}));
});

it('stores long prompts in session files and removes inherited provider-session environment overrides',async()=>{
  vi.stubEnv('ANTHROPIC_API_KEY','synthetic-secret');vi.stubEnv('CLAUDECODE','1');vi.stubEnv('CODEX_THREAD_ID','unrelated-thread');vi.stubEnv('OPENCODE_CONFIG_CONTENT','untrusted-inherited');vi.stubEnv('NO_COLOR','1');const prompt='Synthetic task requirements.\n'.repeat(400),run=await session({prompt,outputSchema:{type:'object',properties:{ok:{type:'boolean'}}},label:'Synthetic label'});const spawn=mock.spawn.mock.calls[0],env=spawn[2].env,meta=spawn[3];expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');expect(env).not.toHaveProperty('CLAUDECODE');expect(env).not.toHaveProperty('CODEX_THREAD_ID');expect(env).not.toHaveProperty('NO_COLOR');expect(env).not.toHaveProperty('OPENCODE_CONFIG_CONTENT');expect(fs.readFileSync(path.join(meta.dir,'task.md'),'utf8')).toContain(prompt);expect(spawn[1].join(' ')).not.toContain('Your task is in');expect(spawn[1].join(' ')).not.toContain(prompt);run.handle.stop();
});

it('shows login and setup blockers once without treating a waiting screen as completion',async()=>{
  const run=await session();mock.screen='Not logged in';await vi.advanceTimersByTimeAsync(2000);mock.screen='Settings Error';await vi.advanceTimersByTimeAsync(6000);expect(JSON.stringify(run.cb.log.mock.calls).match(/needs you to sign in/g)).toHaveLength(1);expect(JSON.stringify(run.cb.log.mock.calls).match(/waiting on a setup screen/g)).toHaveLength(1);expect(run.cb.finished).not.toHaveBeenCalled();run.handle.stop();
});

it('rejects duplicate runtime admission while native trust is still checking and preserves the first task',async()=>{
  let resolve!:(value:unknown)=>void;mock.trust.mockImplementation(()=>new Promise(yes=>{resolve=yes;}));const term=terminal(),cb=callbacks(),options:SessionOptions={cwd:HOME_DIR,prompt:'First task',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:term,authorizeTool:()=>null},handle=startCliSession(options,cb);for(let i=0;i<20;i++)await Promise.resolve();expect(()=>startCliSession({...options,prompt:'Competing task'},callbacks())).toThrow('admission is already being checked');resolve({verified:5});for(let i=0;i<40;i++)await Promise.resolve();expect(mock.spawn).toHaveBeenCalledOnce();expect(cb.finished).not.toHaveBeenCalled();handle.stop();
});

it.each(['typed','reattach'] as const)('adopts a retained Codex conversation in %s mode only after renewed trust',async mode=>{
  const first=await session({keepAlive:true});await handleHook(first.token,{hook_event_name:'TurnComplete',session_id:'root',input:'Synthetic runtime task',last_assistant_message:'Prior completion'});await vi.advanceTimersByTimeAsync(3000);const cb=callbacks();mock.write.mockClear();const handle=startCliSession({cwd:HOME_DIR,prompt:'Follow-up',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:first.term,authorizeTool:()=>null,resumeSessionId:'root',...(mode==='typed'?{typed:true}:{reattach:true})},cb);for(let i=0;i<40;i++)await Promise.resolve();expect(mock.trust).toHaveBeenCalledTimes(2);expect(mock.spawn).toHaveBeenCalledOnce();expect(mock.write).not.toHaveBeenCalled();expect(cb.sessionId).toHaveBeenCalledWith('root');mock.screen='› ';handle.send('checked follow-up');expect(mock.write).toHaveBeenCalledWith(expect.stringContaining('checked follow-up'));handle.stop();
});

it('denies a retained provider mismatch or competing active owner before altering a live session',async()=>{
  const run=await session({keepAlive:true}),base:SessionOptions={cwd:HOME_DIR,prompt:'Follow-up',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:run.term,authorizeTool:()=>null};expect(()=>startCliSession({...base,reattach:true},callbacks())).toThrow('active task owner');expect(()=>startCliSession({...base,cli:'gemini',model:'gemini-synthetic',reattach:true},callbacks())).toThrow('provider differs');expect(mock.spawn).toHaveBeenCalledOnce();run.handle.stop();
});

it.each(['metadata','trust'] as const)('holds a retained follow-up when refreshed native %s fails',async failure=>{
  const first=await session({keepAlive:true});await handleHook(first.token,{hook_event_name:'TurnComplete',session_id:'root',input:'Synthetic runtime task',last_assistant_message:'Prior completion'});await vi.advanceTimersByTimeAsync(3000);mock.trust.mockRejectedValue(failure==='metadata'?new CodexModelNotAdvertisedError('gpt-not-listed'):new Error('synthetic trust failure'));const cb=callbacks(),handle=startCliSession({cwd:HOME_DIR,prompt:'Follow-up',systemAppend:'',model:failure==='metadata'?'gpt-not-listed':'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:first.term,authorizeTool:()=>null,resumeSessionId:'root'},cb);for(let i=0;i<40;i++)await Promise.resolve();expect(cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,...(failure==='metadata'?{configurationError:{kind:'unverified-model',cli:'codex',model:'gpt-not-listed'}}:{errors:[expect.stringContaining('follow-up denied')]})}));expect(mock.spawn).toHaveBeenCalledOnce();handle.stop();
});

it('holds a Gemini profile validation exception without dispatching any native task',async()=>{
  vi.mocked(verifyGeminiProfile).mockRejectedValueOnce(new Error('synthetic protected-profile failure'));const run=await session({cli:'gemini',model:'gemini-synthetic'});expect(mock.spawn).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['Gemini protected-profile validation failed; execution denied']}));
});

it('keeps a specific protected Gemini profile blocker actionable without falling through to launch',async()=>{
  vi.mocked(verifyGeminiProfile).mockResolvedValueOnce('Synthetic system hook settings missing');const run=await session({cli:'gemini',model:'gemini-synthetic'});expect(mock.spawn).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['Synthetic system hook settings missing']}));
});

it('does not send an early Gemini follow-up before governance readiness and never sends after stop',async()=>{
  const run=await session({cli:'gemini',model:'gemini-synthetic'});run.handle.send('premature');expect(mock.write).not.toHaveBeenCalled();run.handle.stop();run.handle.send('obsolete');expect(mock.write).not.toHaveBeenCalled();
});

async function retainedGemini(){
  const run=await session({cli:'gemini',model:'gemini-synthetic',keepAlive:true});
  const bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
  await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'retained-gemini',bridgeSha256});
  await handleHook(run.token,{hook_event_name:'Stop',session_id:'retained-gemini',last_assistant_message:'Prior completion',bridgeSha256});
  await vi.advanceTimersByTimeAsync(3000);
  expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:true}));
  mock.write.mockClear();return run;
}
function adoptGemini(term:AgentTerminal){const cb=callbacks(),handle=startCliSession({cwd:HOME_DIR,prompt:'Recovered task',systemAppend:'',model:'gemini-synthetic',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'gemini',terminal:term,authorizeTool:()=>null,resumeSessionId:'retained-gemini',reattach:true},cb);return{cb,handle};}

it('revalidates a retained Gemini protected profile before restoring input ownership',async()=>{
  const first=await retainedGemini();const before=vi.mocked(verifyGeminiProfile).mock.calls.length;
  let resolve!:(value:null)=>void;vi.mocked(verifyGeminiProfile).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  const next=adoptGemini(first.term);for(let i=0;i<30;i++)await Promise.resolve();
  next.handle.send('premature input');expect(mock.write).not.toHaveBeenCalled();
  const bound=vi.mocked(first.term.bind).mock.calls.at(-1)![0]!;bound.write('direct terminal input');const earlyWrites=mock.write.mock.calls.length;
  const earlyTool=await handleHook(first.token,{hook_event_name:'PreToolUse',tool_name:'Edit',bridgeSha256:crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex')});
  expect(verifyGeminiProfile).toHaveBeenCalledTimes(before+1);expect(next.cb.sessionId).not.toHaveBeenCalled();
  resolve(null);for(let i=0;i<40;i++)await Promise.resolve();
  expect(earlyWrites).toBe(0);expect(earlyTool).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(next.cb.sessionId).toHaveBeenCalledWith('retained-gemini');expect(mock.spawn).toHaveBeenCalledOnce();
  next.handle.send('validated input');expect(mock.write).toHaveBeenCalledWith(expect.stringContaining('validated input'));next.handle.stop();
});

it.each(['drift','unavailable','cancelled'] as const)('withholds retained Gemini ownership when renewed profile validation is %s',async failure=>{
  const first=await retainedGemini();let resolve!:(value:string|null)=>void;
  if(failure==='unavailable'){mock.command.mockReturnValue(null);vi.mocked(verifyGeminiProfile).mockResolvedValueOnce('Gemini CLI unavailable');}
  else vi.mocked(verifyGeminiProfile).mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
  const next=adoptGemini(first.term);for(let i=0;i<30;i++)await Promise.resolve();
  next.handle.send('premature input');expect(mock.write).not.toHaveBeenCalled();
  if(failure==='cancelled'){next.handle.stop();resolve(null);}else if(failure==='drift')resolve('Protected profile changed');
  for(let i=0;i<40;i++)await Promise.resolve();
  vi.mocked(first.term.bind).mock.calls.at(-1)![0]!.write('direct input after failed admission');
  next.handle.send('obsolete input');expect(mock.write).not.toHaveBeenCalled();expect(next.cb.sessionId).not.toHaveBeenCalled();
  expect(next.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false}));expect(mock.spawn).toHaveBeenCalledOnce();next.handle.stop();
});

it('persists a verified root Gemini session identity in keeper metadata before the first completion',async()=>{
  const run=await session({cli:'gemini',model:'gemini-synthetic'}),proc=mock.spawn.mock.results[0].value;
  const bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');proc.setMeta.mockClear();
  await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'wrong-bridge',bridgeSha256:'invalid'});
  await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'child-session',agent_id:'child',bridgeSha256});
  expect(run.cb.sessionId).not.toHaveBeenCalled();
  await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'busy-root',bridgeSha256});
  expect(run.cb.sessionId).toHaveBeenCalledWith('busy-root');expect(proc.setMeta).toHaveBeenLastCalledWith(expect.objectContaining({resumeId:'busy-root',busy:true}));
  proc.setMeta.mockClear();
  for(const id of ['', 'x'.repeat(257), 'foreign-root']){
    const answer=await handleHook(run.token,{hook_event_name:'SessionStart',session_id:id,bridgeSha256});
    expect(answer).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  }
  expect(run.cb.sessionId).toHaveBeenCalledExactlyOnceWith('busy-root');
  expect(proc.setMeta.mock.calls.every(([meta]:[{resumeId:string}])=>meta.resumeId==='busy-root')).toBe(true);
  expect(await handleHook(run.token,{hook_event_name:'SessionStart',session_id:'busy-root',bridgeSha256})).toEqual({});
  expect(run.cb.finished).not.toHaveBeenCalled();run.handle.stop();
});

it.each(['unknown','mismatch'] as const)('fails closed when Gemini bridge version is %s, including session-start hooks',async variant=>{
  const run=await session({cli:'gemini',model:'gemini-synthetic'}),body={hook_event_name:'SessionStart',session_id:'synthetic',...(variant==='mismatch'?{bridgeSha256:'incorrect'}:{})};expect(await handleHook(run.token,body)).toMatchObject({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'Gemini governance bridge is unverified'}});expect(run.cb.sessionId).not.toHaveBeenCalled();run.handle.stop();
});

it('keeps repeated OpenCode session starts pinned to the first owning session and ignores other session errors',async()=>{
  const run=await session({cli:'opencode',model:'openai/gpt-synthetic'});await handleHook(run.token,{hook_event_name:'OpenCodeSessionStart',session_id:'root'});await handleHook(run.token,{hook_event_name:'OpenCodeSessionStart',session_id:'different'});await handleHook(run.token,{hook_event_name:'OpenCodeSessionStart',session_id:''});await handleHook(run.token,{hook_event_name:'TurnError',session_id:'different',native_error:{name:'APIError',data:{statusCode:429}},error:'wrong owning task'});expect(run.cb.sessionId).toHaveBeenCalledExactlyOnceWith('root');expect(run.cb.finished).not.toHaveBeenCalled();await handleHook(run.token,{hook_event_name:'TurnError',session_id:'root',error:'Owning provider error'});await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:'root',failed:false,last_assistant_message:'A response after error',usage:{schemaVersion:1,source:'opencode-message-v1',sampleId:'root',inputTokens:2,outputTokens:3,costUsd:null}});await vi.advanceTimersByTimeAsync(3000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['OpenCode: Owning provider error']}));
});

it('denies further tools immediately if evidence storage fails during a tool request',async()=>{
  const run=await session();vi.spyOn(SessionEvidence.prototype,'record').mockReturnValue(false);expect(await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'Edit',tool_use_id:'missing-audit',tool_input:{file_path:'synthetic.ts'}})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'Session evidence storage unavailable; execution denied'}});run.handle.stop();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false}));
});

it('contains exceptions raised by a hook observer and returns fail-closed tool governance',async()=>{
  const run=await session();run.cb.log.mockImplementation(()=>{throw new Error('Synthetic consumer exception');});vi.spyOn(console,'warn').mockImplementation(()=>{});expect(await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'Read'})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});run.handle.stop();
});

it('prepares an office-local SDK path for child environments while preserving inherited PATH for this process',async()=>{
  const directory=path.join(HOME_DIR,'tools','dotnet');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,process.platform==='win32'?'dotnet.exe':'dotnet'),'synthetic SDK');const original=process.env.PATH;const run=await session();expect(mock.spawn.mock.calls[0][2].env.DOTNET_ROOT).toBe(directory);const childEnv=mock.spawn.mock.calls[0][2].env,pathKey=Object.keys(childEnv).find(key=>key.toUpperCase()==='PATH')!;expect(childEnv[pathKey].split(path.delimiter)[0]).toBe(directory);expect(process.env.PATH).toBe(original);run.handle.stop();fs.rmSync(directory,{recursive:true,force:true});
});

it('returns preparation failure before spawning when a session instruction file cannot be saved',async()=>{
  const original=fs.writeFileSync;vi.spyOn(fs,'writeFileSync').mockImplementation(((...args:Parameters<typeof fs.writeFileSync>)=>{if(String(args[0]).endsWith('instructions.md'))throw new Error('synthetic write failure');return original(...args);}) as typeof fs.writeFileSync);const run=await session();await vi.advanceTimersByTimeAsync(1);expect(mock.spawn).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:['Could not prepare Codex: synthetic write failure']}));
});

it('moves known folder-trust prompts deliberately and does not mistake them for completion',async()=>{
  const run=await session();mock.screen='Quick safety check\n❯ No, exit';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).toHaveBeenCalledWith('\x1b[B');mock.screen='Quick safety check\n❯ Yes, I trust this folder';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).toHaveBeenCalledWith('\r');expect(run.cb.finished).not.toHaveBeenCalled();run.handle.stop();
});

it('collects verified browser-file evidence once and preserves a final screenshot written just before completion',async()=>{
  const run=await session({browserTesting:true}),directory=path.join(mock.spawn.mock.calls[0][3].dir,'browser');fs.mkdirSync(directory,{recursive:true});const png=Buffer.from([137,80,78,71,13,10,26,10]),first=path.join(directory,'page-1.png');fs.writeFileSync(first,png);fs.utimesSync(first,new Date(Date.now()-5000),new Date(Date.now()-5000));fs.writeFileSync(path.join(directory,'page-invalid.jpg'),'not an image');await vi.advanceTimersByTimeAsync(4000);expect(run.cb.screenshot).toHaveBeenCalledExactlyOnceWith(png,'image/png');const jpeg=Buffer.from([255,216,1,2,255,217]);fs.writeFileSync(path.join(directory,'page-2.jpg'),jpeg);run.handle.stop();expect(run.cb.screenshot).toHaveBeenCalledTimes(2);expect(run.cb.screenshot).toHaveBeenLastCalledWith(jpeg,'image/jpeg');
});

it('captures an explicit browser screenshot result only from a bounded file inside the worktree',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]),file=path.join(HOME_DIR,'explicit-screenshot.png');fs.writeFileSync(file,png);const run=await session();await handleHook(run.token,{hook_event_name:'PreToolUse',tool_name:'mcp__playwright__browser_take_screenshot',tool_use_id:'shot',tool_input:{}});await handleHook(run.token,{hook_event_name:'PostToolUse',tool_use_id:'shot',tool_response:'[screenshot](explicit-screenshot.png)'});expect(run.cb.screenshot).toHaveBeenCalledExactlyOnceWith(png,'image/png');run.handle.stop();fs.rmSync(file,{force:true});
});

it('isolates an evidence consumer failure while stopping a browser-enabled session',async()=>{
  const run=await session({browserTesting:true}),directory=path.join(mock.spawn.mock.calls[0][3].dir,'browser');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'page.png'),Buffer.from([137,80,78,71,13,10,26,10]));run.cb.screenshot.mockImplementation(()=>{throw new Error('synthetic image consumer unavailable');});expect(()=>run.handle.stop()).not.toThrow();expect(run.cb.finished).toHaveBeenCalledOnce();
});

it('does not declare interruption when Escape produces no native interruption observation',async()=>{
  const run=await session();run.term.onInput?.('\x1b');await vi.advanceTimersByTimeAsync(4000);expect(run.cb.finished).not.toHaveBeenCalled();await handleHook(run.token,{hook_event_name:'UserPromptSubmit',prompt:'Synthetic runtime task'});run.term.onInput?.('\x1b');await vi.advanceTimersByTimeAsync(5000);expect(run.cb.finished).not.toHaveBeenCalled();run.handle.stop();
});

it('reports a native zero exit without a completed response as unverified failure',async()=>{
  const run=await session();mock.exit?.(0);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,text:'',errors:['Codex exited before finishing.']}));
});

it('rejects new admission during a pending shutdown and refuses conflicting shutdown modes',async()=>{
  let resolve!:(value:unknown)=>void;mock.trust.mockImplementation(()=>new Promise(yes=>{resolve=yes;}));await session();const stopping=releaseClis(true);expect(()=>startCliSession({cwd:HOME_DIR,prompt:'Blocked',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:terminal()},callbacks())).toThrow('shutdown is in progress');await expect(releaseClis(false)).rejects.toThrow('different runtime shutdown mode');expect(releaseClis(true)).toBe(stopping);resolve({verified:5});await stopping;expect(runtimeCleanupView().readiness).toEqual([]);expect(mock.spawn).not.toHaveBeenCalled();
});



it.each(['codex','gemini'] as const)('persists correlated %s native usage through the real CLI hook and terminal completion boundary',async cli=>{
 const sessionId=crypto.randomUUID(),turn=crypto.randomUUID(),cwd=fs.realpathSync(HOME_DIR),file=path.join(cwd,`usage-${cli}.jsonl`),run=await session({cli,resumeSessionId:sessionId,cwd});
 const bridgeSha256=crypto.createHash('sha256').update(cli==='codex'?CODEX_HOOK_SOURCE:GEMINI_HOOK_SOURCE).digest('hex');
 const meta=cli==='codex'?{type:'session_meta',payload:{id:sessionId,session_id:sessionId,cwd,source:'cli'}}:{sessionId,projectHash:crypto.createHash('sha256').update(cwd).digest('hex'),kind:'main'};
 fs.writeFileSync(file,JSON.stringify(meta)+'\n');await handleHook(run.token,{hook_event_name:'UserPromptSubmit',session_id:sessionId,turn_id:turn,transcript_path:file,cwd,bridgeSha256,prompt:'Synthetic runtime task'});
 const row=cli==='codex'?{type:'token_usage_record',payload:{thread_id:sessionId,session_id:sessionId,turn_id:turn,root_turn_id:turn,response_id:'synthetic-response',usage:{input_tokens:50,cached_input_tokens:10,output_tokens:8,reasoning_output_tokens:2,total_tokens:58}}}:{id:'synthetic-message',type:'gemini',tokens:{input:50,output:8,cached:10,thoughts:2,tool:1,total:61}};
 fs.appendFileSync(file,JSON.stringify(row)+'\n');await handleHook(run.token,{hook_event_name:'TurnComplete',session_id:sessionId,turn_id:turn,bridgeSha256,last_assistant_message:'Synthetic complete',input:'Synthetic runtime task'});await vi.advanceTimersByTimeAsync(3000);
 expect(run.cb.finished).toHaveBeenCalledOnce();const end=readSessionAttempts(HOME_DIR).find(entry=>entry.id===run.cb.finished.mock.calls[0][0].sessionEvidenceId)?.rows?.at(-1);
 expect(end).toMatchObject({kind:'finish',usageCoverage:'complete',inputTokens:cli==='codex'?50:51,outputTokens:cli==='codex'?8:10,costUsd:null,usageSource:cli==='codex'?'codex-response-v1':'gemini-session-v1'});
 expect(JSON.stringify(end)).not.toContain(file);expect(JSON.stringify(end)).not.toContain('synthetic-response');
});

it.each([{platform:'win32',cli:'gemini',stripped:true},{platform:'win32',cli:'codex',stripped:false},{platform:'linux',cli:'gemini',stripped:false}] as const)('isolates Windows PowerShell module lookup for $platform/$cli without changing other runtimes',async({platform,cli,stripped})=>{
 vi.spyOn(process,'platform','get').mockReturnValue(platform);vi.stubEnv('PSModulePath','synthetic-powershell-core-modules');
 const run=await session({cli});expect(mock.spawn).toHaveBeenCalledOnce();const env=mock.spawn.mock.calls[0][2].env as Record<string,string>;
 expect(Object.keys(env).some(key=>key.toUpperCase()==='PSMODULEPATH')).toBe(!stripped);expect(process.env.PSModulePath).toBe('synthetic-powershell-core-modules');run.handle.stop();
});

it.each(['ℹ User cancelled the request.','ℹ Request cancelled.'])('classifies new native Gemini cancellation %s after Escape and ignores old notices',async notice=>{
 const run=await session({cli:'gemini'}),bridgeSha256=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');await handleHook(run.token,{hook_event_name:'UserPromptSubmit',session_id:'synthetic-root',bridgeSha256,prompt:'Synthetic runtime task'});
 mock.screen=notice;run.term.onInput?.('\x1b');await vi.advanceTimersByTimeAsync(800);expect(run.cb.finished).not.toHaveBeenCalled();
 mock.screen+='\n'+notice;await vi.advanceTimersByTimeAsync(1000);expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,interrupted:true,errors:['Interrupted in the terminal']}));
});

it('submits a long initial Codex task once through acknowledged paste after native readiness without file tools',async()=>{
 const prompt='Exact quoted "task" £ 😀\n'.repeat(500),run=await session({role:'ceo',prompt});
 expect(mock.spawn.mock.calls[0][1]).not.toContain(prompt);expect(mock.write).not.toHaveBeenCalled();
 mock.screen='Starting MCP servers (1/11)\n› Ask Codex to do anything';await vi.advanceTimersByTimeAsync(1000);expect(mock.write).not.toHaveBeenCalled();
 mock.screen='› Ask Codex to do anything\n  GPT-Synthetic · office';await vi.advanceTimersByTimeAsync(1000);
 expect(mock.write).toHaveBeenCalledOnce();expect(mock.write).toHaveBeenCalledWith('\x1b[200~'+prompt+'\x1b[201~');
 mock.screen='› [Pasted Content '+Array.from(prompt).length+' chars]\n  GPT-Synthetic · office';await vi.advanceTimersByTimeAsync(150);
 expect(mock.write.mock.calls.filter(([text])=>text==='\r')).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(3000);expect(mock.write.mock.calls.filter(([text])=>text.startsWith('\x1b[200~'))).toHaveLength(1);run.handle.stop();
});
it('does not submit a deferred initial task when native readiness never appears',async()=>{
 const run=await session({role:'ceo',prompt:'Task '.repeat(2000)});mock.screen='Not logged in\n› Ask Codex to do anything';await vi.advanceTimersByTimeAsync(90000);
 expect(mock.write).not.toHaveBeenCalled();expect(run.cb.finished).toHaveBeenCalledWith(expect.objectContaining({ok:false,errors:[expect.stringContaining('no task was sent')]}));
});
it('cancels deferred initial input when its task is stopped',async()=>{
 const run=await session({role:'ceo',prompt:'Task '.repeat(2000)});run.handle.stop();mock.screen='› Ask Codex to do anything';await vi.advanceTimersByTimeAsync(90000);expect(mock.write).not.toHaveBeenCalled();
});
