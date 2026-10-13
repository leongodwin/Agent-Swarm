import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {expect,it,vi} from 'vitest';
vi.mock('./config.ts',async original=>{
  const real=await original<typeof import('./config.ts')>();const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-native-cleanup-'));
  return {...real,HOME_DIR:root};
});
vi.mock('./clis.ts',async original=>({...await original<typeof import('./clis.ts')>(),commandFor:()=>({file:process.execPath,args:['-e',"console.log('fixture-ready');setInterval(()=>{},1000)",'--']})}));
import {HOME_DIR} from './config.ts';
import {reconnectClis,startCliSession,runtimeCleanupView,releaseClis} from './cliRunner.ts';
import {keeperPid,terminalsAvailable} from './ptyClient.ts';
import type {AgentTerminal} from './terminal.ts';
it.skipIf(!terminalsAvailable)('confirms native fixture-root exit through the real keeper before releasing quarantine',async()=>{
  await reconnectClis(()=>null);const host=keeperPid();let output='';
  const term={cols:80,rows:24,note:vi.fn(),bind:vi.fn(),write:(text:string)=>{output+=text;},screen:()=>output} as unknown as AgentTerminal;
  let handle:ReturnType<typeof startCliSession>|undefined;
  try{
    handle=startCliSession({cwd:HOME_DIR,prompt:'fixture',systemAppend:'',model:'openai/gpt-fixture',effort:'low',browserTesting:false,additionalDirectories:[],role:'dev',cli:'opencode',agentId:'owned-native-fixture',terminal:term,authorizeTool:()=>null},{log:vi.fn(),tool:vi.fn(),sessionId:vi.fn(),browserUrl:vi.fn(),screenshot:vi.fn(),finished:vi.fn()});
    await vi.waitFor(()=>expect(output).toContain('fixture-ready'),{timeout:10000});
    handle.stop();expect(runtimeCleanupView().records).toHaveLength(1);
    expect(runtimeCleanupView().records[0].id).toMatch(/^[a-f0-9]{64}$/);
    await vi.waitFor(()=>expect(runtimeCleanupView().records).toEqual([]),{timeout:10000});
    expect(JSON.parse(await fs.readFile(path.join(HOME_DIR,'runtime-cleanup.json'),'utf8')).records).toEqual([]);
  }finally{handle?.stop();await releaseClis(false);if(host>0)try{process.kill(host);}catch{}await fs.rm(HOME_DIR,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
},25000);
