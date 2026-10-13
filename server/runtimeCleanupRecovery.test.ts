import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({home:'',instance:'22222222-2222-4222-8222-222222222222',held:[] as any[],kill:vi.fn()}));
vi.mock('./config.ts',async original=>{
  const real=await original<typeof import('./config.ts')>();fixture.home=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-cleanup-recovery-'));
  await fs.writeFile(path.join(fixture.home,'runtime-cleanup.json'),JSON.stringify({schemaVersion:1,records:[{id:'pending-task',agentId:'stopped-agent',cli:'opencode',pid:123,keeperInstance:'11111111-1111-4111-8111-111111111111',requestedAt:1,state:'stopping'}]}));
  return {...real,HOME_DIR:fixture.home};
});
vi.mock('./ptyClient.ts',()=>({terminalsAvailable:true,keeperPid:()=>1234,keeperInstance:()=>fixture.instance,keeperHookUrl:()=>null,leaveKeeper:vi.fn(),hooksReady:vi.fn(),discardPty:vi.fn(),spawnPty:vi.fn(),startKeeper:vi.fn(async()=>fixture.held),adoptPty:()=>{
  let verified=false;const callbacks:(()=>void)[]=[];return {pid:123,get verifiedExit(){return verified;},onExit:(callback:()=>void)=>{callbacks.push(callback);},kill:()=>{fixture.kill();verified=true;callbacks.forEach(callback=>callback());}};
}}));
afterEach(async()=>{if(fixture.home)await fs.rm(fixture.home,{recursive:true,force:true});fixture.instance='22222222-2222-4222-8222-222222222222';fixture.held=[];fixture.kill.mockClear();vi.resetModules();});
it.each(['absent','live'] as const)('does not retire persisted cleanup on another keeper, then verifies its %s owned root',async mode=>{
  const config=await import('./config.ts');await fs.mkdir(config.HOME_DIR,{recursive:true});
  await fs.writeFile(path.join(config.HOME_DIR,'runtime-cleanup.json'),JSON.stringify({schemaVersion:1,records:[{id:'pending-task',agentId:'stopped-agent',cli:'opencode',pid:123,keeperInstance:'11111111-1111-4111-8111-111111111111',requestedAt:1,state:'stopping'}]}));
  const runner=await import('./cliRunner.ts');expect(runner.runtimeCleanupView().records).toHaveLength(1);
  await runner.reconnectClis(()=>null);expect(runner.runtimeCleanupView().records[0].state).toBe('unverified');expect(fixture.kill).not.toHaveBeenCalled();
  fixture.instance='11111111-1111-4111-8111-111111111111';
  if(mode==='live')fixture.held=[{id:'native-root',pid:123,exit:null,meta:{token:'pending-task',agentId:'stopped-agent',cli:'opencode'}}];
  expect(await runner.reconnectClis(()=>null)).toEqual([]);expect(runner.runtimeCleanupView().records).toEqual([]);
  expect(fixture.kill).toHaveBeenCalledTimes(mode==='live'?1:0);
  expect(JSON.parse(await fs.readFile(path.join(fixture.home,'runtime-cleanup.json'),'utf8')).records).toEqual([]);
});
