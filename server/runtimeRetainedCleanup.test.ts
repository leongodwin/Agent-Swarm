import fs from 'node:fs';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {HeldPty} from './ptyProtocol.ts';
const mock=vi.hoisted(()=>({held:[] as HeldPty[],instance:'11111111-1111-4111-8111-111111111111',adopt:vi.fn(),discard:vi.fn(),archive:vi.fn()}));
vi.mock('./config.ts',async original=>{const base=await original<typeof import('./config.ts')>(),fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');return {...base,HOME_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'cf-retained-cleanup-'))};});
vi.mock('./clis.ts',async original=>({...await original<typeof import('./clis.ts')>(),codexThread:mock.archive}));
vi.mock('./ptyClient.ts',()=>({terminalsAvailable:true,keeperHookUrl:()=>null,keeperPid:()=>0,keeperInstance:()=>mock.instance,hooksReady:vi.fn(),leaveKeeper:vi.fn(),startKeeper:async()=>mock.held,discardPty:mock.discard,adoptPty:mock.adopt,spawnPty:vi.fn()}));
let home='';
beforeEach(async()=>{vi.resetModules();mock.held=[];mock.instance='11111111-1111-4111-8111-111111111111';mock.discard.mockReset();mock.adopt.mockReset();mock.archive.mockReset().mockResolvedValue(undefined);home=(await import('./config.ts')).HOME_DIR;fs.mkdirSync(home,{recursive:true});mock.adopt.mockImplementation((held:HeldPty)=>{let exited=false;const handlers:(()=>void)[]=[];return {pid:held.pid,get verifiedExit(){return exited;},write:vi.fn(),resize:vi.fn(),setMeta:vi.fn(),onData:vi.fn(),onExit:(callback:()=>void)=>handlers.push(callback),kill:vi.fn(()=>{exited=true;for(const callback of handlers)callback();})};});});
afterEach(()=>{vi.restoreAllMocks();fs.rmSync(home,{recursive:true,force:true,maxRetries:10});});
function saved(instance:string|null=mock.instance){fs.writeFileSync(path.join(home,'runtime-cleanup.json'),JSON.stringify({schemaVersion:1,records:[{id:'synthetic-cleanup',agentId:'ada',cli:'codex',pid:77,keeperInstance:instance,requestedAt:1,state:'stopping'}]}));}
const held=(exit:number|null=null):HeldPty=>({id:'synthetic-cleanup',pid:77,exit,meta:{token:'synthetic-cleanup',agentId:'ada',cli:'codex',dir:path.join(home,'sessions','synthetic'),resumeId:'checkpoint'}});

it.each([null,'22222222-2222-4222-8222-222222222222'])('never infers native cleanup completion from a different keeper identity: %s',async instance=>{
  saved(instance);const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(runtime.runtimeCleanupView().records).toEqual([expect.objectContaining({state:'unverified'})]);expect(mock.adopt).not.toHaveBeenCalled();expect(mock.discard).not.toHaveBeenCalled();
});
it('confirms a previously stopped root only when its exact keeper instance has no matching terminal',async()=>{
  saved();const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(runtime.runtimeCleanupView().records).toEqual([]);expect(mock.adopt).not.toHaveBeenCalled();
});
it('confirms and discards a matching retained terminal whose native exit was observed',async()=>{
  saved();mock.held=[held(9)];const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(runtime.runtimeCleanupView().records).toEqual([]);expect(mock.discard).toHaveBeenCalledExactlyOnceWith(mock.held[0]);expect(mock.adopt).not.toHaveBeenCalled();
});
it('retries termination of a matching live quarantined root and clears capacity only after confirmed native exit',async()=>{
  saved();mock.held=[held()];const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(mock.adopt).toHaveBeenCalledExactlyOnceWith(mock.held[0]);expect(mock.adopt.mock.results[0].value.kill).toHaveBeenCalledOnce();expect(runtime.runtimeCleanupView().records).toEqual([]);expect(mock.discard).not.toHaveBeenCalled();
});
it('preserves quarantine when multiple retained terminals claim the same cleanup identity',async()=>{
  saved();mock.held=[held(0),held(1)];const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(runtime.runtimeCleanupView().records).toEqual([expect.objectContaining({state:'unverified'})]);expect(mock.discard).toHaveBeenCalledTimes(2);
});
it('discards exited Codex checkpoints and archives their saved thread without adopting another process',async()=>{
  mock.held=[held(0)];const runtime=await import('./cliRunner.ts');expect(await runtime.reconnectClis(()=>null)).toEqual([]);expect(mock.discard).toHaveBeenCalledExactlyOnceWith(mock.held[0]);expect(mock.archive).toHaveBeenCalledExactlyOnceWith('archive','checkpoint');expect(mock.adopt).not.toHaveBeenCalled();
});
