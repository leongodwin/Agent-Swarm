import fs from 'node:fs/promises';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { AgentTerminal } from './terminal.ts';
import type { SessionOptions } from './agentRunner.ts';
const native = vi.hoisted(() => ({token: '', kill: vi.fn()}));
vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  return {...real, HOME_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'cli-authority-'))};
});
vi.mock('./clis.ts', async importOriginal => ({...await importOriginal<typeof import('./clis.ts')>(), commandFor: () => ({file:'synthetic-cli',args:[]})}));
vi.mock('./ptyClient.ts', () => ({
  terminalsAvailable: true, keeperHookUrl: () => 'http://127.0.0.1:1', keeperPid: () => 0,
  hooksReady: vi.fn(), leaveKeeper: vi.fn(), discardPty: vi.fn(), adoptPty: vi.fn(), startKeeper: vi.fn(),
  spawnPty: (_file: string, _args: string[], _options: unknown, meta: {token: string}) => {
    native.token=meta.token;
    return {pid:0,write:vi.fn(),resize:vi.fn(),kill:native.kill,setMeta:vi.fn(),onData:vi.fn(),onExit:vi.fn()};
  },
}));
import { HOME_DIR } from './config.ts';
import { handleHook, releaseClis, startCliSession } from './cliRunner.ts';
import { setToolGovernanceGate } from './toolGovernance.ts';

afterEach(async () => { await releaseClis(false); vi.useRealTimers(); setToolGovernanceGate(async()=>({status:'unavailable',reason:'Not initialized'})); });
afterAll(async () => fs.rm(HOME_DIR,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
function session(authorize: () => string | null) {
  vi.useFakeTimers();
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>''} as unknown as AgentTerminal;
  return startCliSession({cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',agentId:'synthetic-worker',cli:'claude',terminal:term,keepAlive:true,authorizeTool:authorize} satisfies SessionOptions,
    {log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()});
}
it.each([false,true])('reports capacity failure for a %s retained Codex task and keeps developer work resumable',async reattach=>{
  vi.useFakeTimers();
  let screen='';
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:vi.fn(),screen:()=>screen} as unknown as AgentTerminal;
  const options:SessionOptions={cwd:HOME_DIR,prompt:'synthetic',systemAppend:'',model:'',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',agentId:'synthetic-capacity-worker',cli:'codex',terminal:term,keepAlive:true,authorizeTool:()=>null};
  const callbacks={log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()};
  if(reattach){
    startCliSession(options,callbacks);
    await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'synthetic result'});
    await vi.advanceTimersByTimeAsync(3000);callbacks.finished.mockClear();
  }
  const handle=reattach?startCliSession({...options,reattach:true},callbacks):startCliSession(options,callbacks);
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
  const handle=session(()=>active?null:'Task revoked');
  const pending=handleHook(native.token,{hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}});
  for(let i=0;i<20&&!finish;i++)await Promise.resolve();
  active=false;finish();
  expect(await pending).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  handle.stop();
});

it('denies pre-tool execution from an idle CLI even when request-local governance would allow it', async () => {
  setToolGovernanceGate(async()=>({status:'allowed',reason:'synthetic'}));
  session(()=>null);
  await handleHook(native.token,{hook_event_name:'Stop',last_assistant_message:'synthetic result'});
  await vi.advanceTimersByTimeAsync(3000);
  const denied=await handleHook(native.token,{hook_event_name:'PreToolUse',tool_name:'Read',tool_input:{}});
  expect(denied).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}});
  expect(JSON.stringify(denied)).toContain('No active admitted task');
});
