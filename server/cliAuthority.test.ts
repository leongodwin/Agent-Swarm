import fs from 'node:fs/promises';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { AgentTerminal } from './terminal.ts';
import type { SessionOptions } from './agentRunner.ts';
const native = vi.hoisted(() => ({autoExit:true,token: '', kill: vi.fn(),write:vi.fn(),args:[] as string[],data:undefined as undefined|((data:string)=>void),exit:undefined as undefined|((code:number)=>void)}));
vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  return {...real, HOME_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'cli-authority-'))};
});
vi.mock('./clis.ts', async importOriginal => ({...await importOriginal<typeof import('./clis.ts')>(), commandFor: () => ({file:'synthetic-cli',args:[]})}));
vi.mock('./codexHookTrust.ts',()=>({prepareCodexHooks:vi.fn(async()=>({verified:5,hashes:[]}))}));
vi.mock('./geminiBridge.ts',async original=>({...await original<typeof import('./geminiBridge.ts')>(),verifyGeminiProfile:vi.fn(async()=>null)}));
vi.mock('./ptyClient.ts', () => ({
  terminalsAvailable: true, keeperHookUrl: () => 'http://127.0.0.1:1', keeperPid: () => 0,keeperInstance:()=> '11111111-1111-4111-8111-111111111111',
  hooksReady: vi.fn(), leaveKeeper: vi.fn(), discardPty: vi.fn(), adoptPty: vi.fn(), startKeeper: vi.fn(),
  spawnPty: (_file: string, _args: string[], _options: unknown, meta: {token: string}) => {
    native.token=meta.token;native.args=_args;
    let closed=false;const handlers:((code:number)=>void)[]=[];
    native.exit=code=>{closed=true;for(const handler of handlers.splice(0))handler(code);};
    return {pid:0,get verifiedExit(){return closed;},write:native.write,resize:vi.fn(),kill:()=>{native.kill();if(native.autoExit)native.exit?.(0);},setMeta:vi.fn(),onData:(handler:(data:string)=>void)=>{native.data=handler;},onExit:(handler:(code:number)=>void)=>{if(closed)queueMicrotask(()=>handler(0));else handlers.push(handler);}};
  },
}));
import { HOME_DIR } from './config.ts';
import { handleHook, releaseClis, startCliSession as startRealCliSession,reconnectClis,runtimeCleanupView } from './cliRunner.ts';
import {startKeeper,discardPty,adoptPty} from './ptyClient.ts';
import { setToolGovernanceGate } from './toolGovernance.ts';
import {OPENCODE_PLUGIN_SOURCE} from './clis.ts';
import {GEMINI_HOOK_SOURCE,verifyGeminiProfile} from './geminiBridge.ts';
import {prepareCodexHooks} from './codexHookTrust.ts';
import crypto from 'node:crypto';

afterEach(async () => {native.exit?.(0);native.autoExit=true;await releaseClis(false); vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs(); setToolGovernanceGate(async()=>({status:'unavailable',reason:'Not initialized'})); });
afterAll(async () => fs.rm(HOME_DIR,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
async function startCliSession(...args:Parameters<typeof startRealCliSession>){const handle=startRealCliSession(...args);for(let i=0;i<25;i++)await Promise.resolve();return handle;}
async function session(authorize: () => string | null) {
  vi.useFakeTimers();
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
  return await startCliSession({cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',agentId:'synthetic-worker',cli:'codex',terminal:term,keepAlive:true,authorizeTool:authorize} satisfies SessionOptions,
    {log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()});
}
it.each([undefined,'old-plugin-hash','stopping'])('retires an unsafe retained OpenCode terminal: %s',async state=>{
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
  const held={id:'synthetic-held',pid:0,exit:null,meta:{agentId:'synthetic-worker',cli:'opencode',token:'synthetic-token',dir:HOME_DIR,resumeId:'synthetic-checkpoint',busy:false,governanceSha256:state==='stopping'?crypto.createHash('sha256').update(OPENCODE_PLUGIN_SOURCE).digest('hex'):state,stopping:state==='stopping'}};
  vi.mocked(startKeeper).mockResolvedValue([held as any]);vi.mocked(discardPty).mockClear();vi.mocked(adoptPty).mockClear();
  let exited=false;const listeners:((code:number)=>void)[]=[];const kill=vi.fn(()=>{exited=true;listeners.forEach(callback=>callback(0));});
  vi.mocked(adoptPty).mockReturnValueOnce({pid:0,get verifiedExit(){return exited;},write:vi.fn(),resize:vi.fn(),setMeta:vi.fn(),kill,onData:vi.fn(),onExit:callback=>{listeners.push(callback);}});
  expect(await reconnectClis(()=>term)).toEqual([]);expect(kill).toHaveBeenCalledOnce();expect(adoptPty).toHaveBeenCalledExactlyOnceWith(held);expect(term.bind).not.toHaveBeenCalled();expect(runtimeCleanupView().records).toEqual([]);
});
it('quarantines cancelled native work past the former five-second timeout until confirmed exit',async()=>{
  const handle=await session(()=>null);native.autoExit=false;handle.stop();
  expect(runtimeCleanupView().records).toHaveLength(1);await vi.advanceTimersByTimeAsync(6000);expect(runtimeCleanupView().records).toHaveLength(1);
  await expect(session(()=>null)).rejects.toThrow('quarantined');
  native.exit?.(0);for(let i=0;i<25;i++)await Promise.resolve();expect(runtimeCleanupView().records).toEqual([]);
});
it.each([false,true])('reports capacity failure for a %s retained Codex task and keeps developer work resumable',async reattach=>{
  vi.useFakeTimers();
  let screen='';
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>screen} as unknown as AgentTerminal;
  const options:SessionOptions={cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',agentId:'synthetic-capacity-worker',cli:'codex',terminal:term,keepAlive:true,authorizeTool:()=>null};
  const callbacks={log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()};
  if(reattach){
    await startCliSession(options,callbacks);
    await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'synthetic result'});
    await vi.advanceTimersByTimeAsync(3000);callbacks.finished.mockClear();
  }
  const handle=await (reattach?startCliSession({...options,reattach:true},callbacks):startCliSession(options,callbacks));
  screen='■ Selected model is at capacity. Please try a different model.\n› Ask Codex to do anything';
  await vi.advanceTimersByTimeAsync(1000);expect(callbacks.finished).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);expect(callbacks.finished).toHaveBeenCalledOnce();
  expect(callbacks.finished.mock.calls[0][0]).toMatchObject({ok:false,text:'',errors:[expect.stringContaining('model is at capacity')]});
  const calls=callbacks.finished.mock.calls.length;await vi.advanceTimersByTimeAsync(5000);expect(callbacks.finished).toHaveBeenCalledTimes(calls);
  handle.stop();
});

it('denies an actual CLI hook when task authority is revoked during asynchronous governance', async () => {
  let active=true;let finish!:()=>void;
  setToolGovernanceGate(()=>new Promise(resolve=>{finish=()=>resolve({status:'allowed',reason:'synthetic'});}));
  const handle=await session(()=>active?null:'Task revoked');
  const pending=handleHook(native.token,{hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}});
  for(let i=0;i<20&&!finish;i++)await Promise.resolve();
  active=false;finish();
  expect(await pending).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  handle.stop();
});

it('carries an OpenCode pre-tool request through live session authority and denies cancellation before returning a grant',async()=>{
  let active=true,complete!:()=>void;
  setToolGovernanceGate(()=>new Promise(resolve=>{complete=()=>resolve({status:'allowed',reason:'Synthetic scan'});}));
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
  const handle=await startCliSession({cwd:HOME_DIR,prompt:'Synthetic',systemAppend:'',model:'openai/gpt-synthetic',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'opencode',terminal:term,authorizeTool:()=>active?null:'Task cancelled'},
    {log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()});
  vi.stubEnv('CUBEFARM_NOTIFY_URL','http://127.0.0.1:4499/api/hooks/synthetic');
  vi.stubGlobal('fetch',vi.fn(async(_url,request)=>({ok:true,json:()=>handleHook(native.token,JSON.parse(request.body))})));
  const factory=new Function(`return (${OPENCODE_PLUGIN_SOURCE.replace('export default async function','async function')});`)();const plugin=await factory({});
  const denied=expect(plugin['tool.execute.before']({tool:'write',callID:'synthetic-tool',sessionID:'root'},{args:{filePath:'Workflows/expense.json',content:'shared_commondataserviceforapps'}})).rejects.toThrow('execution denied');
  for(let i=0;i<50&&!complete;i++)await Promise.resolve();expect(complete).toBeTypeOf('function');active=false;complete();await denied;handle.stop();
});

it.each([false,true])('withholds the Gemini task and input until an actual bridge acknowledgement: %s',async attested=>{
  vi.useFakeTimers();setToolGovernanceGate(async()=>({status:'allowed',reason:'Synthetic scan'}));
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=> 'Type your message',appCursor:false} as unknown as AgentTerminal;
  const callback={log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()};
  native.write.mockClear();const handle=await startCliSession({cwd:HOME_DIR,prompt:'Synthetic confidential task',systemAppend:'Synthetic office instructions',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'gemini',terminal:term,authorizeTool:()=>null},callback);
  for(let i=0;i<20&&!(term.bind as any).mock.calls.length;i++)await Promise.resolve();
  const input=(term.bind as any).mock.calls[0][0];
  expect(native.args.join(' ')).not.toContain('Synthetic confidential task');
  // The startup callback must deny an old bridge and an unacknowledged pre-tool request.
  expect(JSON.stringify(await handleHook(native.token,{hook_event_name:'SessionStart',session_id:'synthetic-session'}))).toContain('deny');
  if(attested){
    const sha=crypto.createHash('sha256').update(GEMINI_HOOK_SOURCE).digest('hex');
    await handleHook(native.token,{hook_event_name:'SessionStart',session_id:'synthetic-session',bridgeSha256:sha});
    await vi.advanceTimersByTimeAsync(1200);expect(native.write.mock.calls.flat().join(' ')).toContain('Synthetic confidential task');expect(callback.sessionId).toHaveBeenCalledWith('synthetic-session');expect(callback.finished).not.toHaveBeenCalled();
  }else{
    input.write('Unverified typed task');handle.send('Unverified follow-up');await vi.advanceTimersByTimeAsync(90000);
    expect(native.write).not.toHaveBeenCalled();expect(callback.finished).toHaveBeenCalledOnce();expect(callback.finished.mock.calls[0][0]).toMatchObject({ok:false,errors:[expect.stringContaining('no task was sent')]});
  }
  handle.stop();
});
it('does not spawn Gemini when its required protected profile is unavailable',async()=>{
  vi.mocked(verifyGeminiProfile).mockResolvedValueOnce('Synthetic protected profile is unavailable');native.write.mockClear();
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
  const finished=vi.fn();await startCliSession({cwd:HOME_DIR,prompt:'Confidential synthetic task',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'gemini',terminal:term,authorizeTool:()=>null},{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished});
  for(let i=0;i<30&&!finished.mock.calls.length;i++)await Promise.resolve();expect(finished).toHaveBeenCalledOnce();expect(term.bind).not.toHaveBeenCalled();expect(native.write).not.toHaveBeenCalled();expect(finished.mock.calls[0][0]).toMatchObject({ok:false,errors:['Synthetic protected profile is unavailable']});
});
it('does not treat a long-lived zero exit as proof of successful Codex work',async()=>{
  vi.useFakeTimers();const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;const finished=vi.fn();
  await startCliSession({cwd:HOME_DIR,prompt:'Synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:term,authorizeTool:()=>null},{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished});
  await vi.advanceTimersByTimeAsync(21000);native.exit!(0);expect(finished).toHaveBeenCalledOnce();expect(finished.mock.calls[0][0]).toMatchObject({ok:false,text:'',errors:[expect.stringContaining('before finishing')]});
});
it('does not spawn Codex or send its task when native trust validation fails',async()=>{
 vi.mocked(prepareCodexHooks).mockRejectedValueOnce(new Error('Native trust unavailable'));native.write.mockClear();const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;const finished=vi.fn();
 await startCliSession({cwd:HOME_DIR,prompt:'Confidential task',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'codex',terminal:term,authorizeTool:()=>null},{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished});
 expect(term.bind).not.toHaveBeenCalled();expect(native.write).not.toHaveBeenCalled();expect(finished.mock.calls[0][0]).toMatchObject({ok:false,errors:[expect.stringContaining('no task was sent')]});
});

it('rejects a disallowed CLI before spawning a terminal process',()=>{
 const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
 expect(()=>startRealCliSession({cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'ceo',cli:'copilot',terminal:term},{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()})).toThrow('Only Codex');
});

it.each(['idle','changing','active','follow-up','completion'] as const)('reconciles retained idle Codex conservatively: %s',async mode=>{
  vi.useFakeTimers();native.kill.mockClear();
  let screen='';
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>screen} as unknown as AgentTerminal;
  const options:SessionOptions={cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'qa',agentId:'synthetic-recovery',cli:'codex',terminal:term,keepAlive:true,authorizeTool:()=>null};
  const callbacks={log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()};
  await startCliSession(options,callbacks);
  await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'previous result'});
  await vi.advanceTimersByTimeAsync(3000);callbacks.finished.mockClear();
  const handle=await startCliSession({...options,keepAlive:false,reattach:true},callbacks);
  screen='Worked for 19m 44s • 12:06\n› Ask Codex to do anything';
  await vi.advanceTimersByTimeAsync(1000);expect(callbacks.finished).not.toHaveBeenCalled();
  if(mode==='active')screen+='\nWorking (1s)';
  if(mode==='follow-up')handle.send('authorized synthetic follow-up');
  if(mode==='completion')await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'actual recovered result'});
  if(mode==='changing'){
    for(let i=0;i<4;i++){screen+=' ';await vi.advanceTimersByTimeAsync(1000);}
  }else await vi.advanceTimersByTimeAsync(3000);
  if(mode==='idle'){
    expect(callbacks.finished).toHaveBeenCalledOnce();
    expect(callbacks.finished.mock.calls[0][0]).toMatchObject({ok:false,text:'',errors:[expect.stringContaining('outcome is unverified')]});
    expect(native.kill).not.toHaveBeenCalled();
    const denied=await handleHook(native.token,{hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}});
    expect(JSON.stringify(denied)).toContain('No active admitted task');
  }else if(mode==='completion')expect(callbacks.finished.mock.calls[0][0]).toMatchObject({ok:true,text:'actual recovered result'});
  else expect(callbacks.finished).not.toHaveBeenCalled();
  handle.stop();
});

it('denies pre-tool execution from an idle CLI even when request-local governance would allow it', async () => {
  setToolGovernanceGate(async()=>({status:'allowed',reason:'synthetic'}));
  await session(()=>null);
  await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'synthetic result'});
  await vi.advanceTimersByTimeAsync(3000);
  const denied=await handleHook(native.token,{hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}});
  expect(denied).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(JSON.stringify(denied)).toContain('No active admitted task');
});
