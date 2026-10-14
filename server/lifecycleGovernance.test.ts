import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import { afterEach,expect,it,vi } from 'vitest';
import { manifestDigest,requireLifecycleGovernance,unavailableGovernance,type LifecycleRequest,type LifecycleResult } from './lifecycleGovernance.ts';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-lifecycle-gate-'));roots.push(root);return root;}
const request:LifecycleRequest={phase:'import',sourceCommit:'a'.repeat(40),environmentUrl:'https://test.crm4.dynamics.com',releaseId:'release-1',checkout:'unused',manifest:{solution:'Expenses'}};
const proof=():LifecycleResult=>({...unavailableGovernance(request),status:'clear',artifactSha256:'a'.repeat(64),policySha256:'b'.repeat(64),schemaSha256:'c'.repeat(64),reasons:['Independent complete governance evidence']});
it.each(['missing-pointer','wrong-archive','missing-content-digest'])('denies clear governance with %s inventory evidence instead of saving a passing receipt',async fault=>{
  const root=await fixture(),value=proof();
  if(fault==='missing-pointer')value.packageInventorySha256='d'.repeat(64);
  else{value.packageInventoryFile=`package-inventory-${(fault==='wrong-archive'?'d':'a').repeat(64)}.json`;if(fault==='wrong-archive')value.packageInventorySha256='e'.repeat(64);}
  await expect(requireLifecycleGovernance(async()=>value,request,root,0)).rejects.toThrow('unavailable');expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).status).toBe('unavailable');
});
it('persists a bound complete decision before permitting a stage',async()=>{const root=await fixture();const file=await requireLifecycleGovernance(async()=>proof(),request,root,0);expect(file).toBe('governance-0-import.json');expect(JSON.parse(await fs.readFile(path.join(root,file),'utf8'))).toMatchObject({status:'clear',manifestSha256:manifestDigest(request.manifest)});});
it('isolates provider manifest mutations and rejects a matching hash for the altered input',async()=>{
  const root=await fixture(),input={...request,manifest:{solution:'Expenses'}};
  await expect(requireLifecycleGovernance(async supplied=>{(supplied.manifest as any).solution='Different';return {...proof(),manifestSha256:manifestDigest(supplied.manifest)};},input,root,0)).rejects.toThrow('unavailable');
  expect(input.manifest).toEqual({solution:'Expenses'});expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8'))).toMatchObject({status:'unavailable',manifestSha256:manifestDigest(request.manifest)});
});
it('includes input capture in the stage budget and does not admit a provider after capture expiry',async()=>{
  const root=await fixture();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);const clone=structuredClone;
  vi.spyOn(globalThis,'structuredClone').mockImplementation((value,options)=>{const result=clone(value,options);elapsed=60000;return result;});const provider=vi.fn(async()=>proof());
  await expect(requireLifecycleGovernance(provider,request,root,0)).rejects.toThrow('unavailable');expect(provider).not.toHaveBeenCalled();
});
it.each(['phase','sourceCommit','environmentUrl','releaseId','checkout','manifest','packageSha256','evidenceDirectory','resourceSchemaReferences','signal'])('rejects caller %s drift while a provider is pending and preserves the original audit scope',async field=>{
  const root=await fixture(),input:LifecycleRequest={...request,manifest:{solution:'Expenses'},resourceSchemaReferences:[{resource:'flow',entitySet:'exp_reports',columns:['exp_name']}]};let complete!:(value:LifecycleResult)=>void;
  const pending=requireLifecycleGovernance(async()=>new Promise(resolve=>{complete=resolve;}),input,root,0);const denied=expect(pending).rejects.toThrow('unavailable');await Promise.resolve();
  if(field==='manifest')(input.manifest as any).solution='Different';else if(field==='resourceSchemaReferences')input.resourceSchemaReferences![0].columns.push('secret');else if(field==='signal')input.signal=new AbortController().signal;else (input as any)[field]=field==='phase'?'test':'changed';
  complete(proof());await denied;const saved=JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8'));expect(saved).toMatchObject({status:'unavailable',phase:request.phase,environmentUrl:request.environmentUrl,sourceCommit:request.sourceCommit,releaseId:request.releaseId,manifestSha256:manifestDigest(request.manifest)});
});
it('rejects provider schema-reference changes even when the returned manifest hash is unchanged',async()=>{
  const root=await fixture(),input={...request,resourceSchemaReferences:[{resource:'flow',entitySet:'exp_reports',columns:['exp_name']}]};
  await expect(requireLifecycleGovernance(async supplied=>{supplied.resourceSchemaReferences![0].columns.length=0;return proof();},input,root,0)).rejects.toThrow('unavailable');expect(input.resourceSchemaReferences[0].columns).toEqual(['exp_name']);
});
it('rejects scope drift during audit commit and replaces the clear receipt in its original location',async()=>{
  const root=await fixture(),input={...request,manifest:{solution:'Expenses'}},rename=fs.rename.bind(fs);let first=true;
  vi.spyOn(fs,'rename').mockImplementation(async(...args:Parameters<typeof fs.rename>)=>{await rename(...args);if(first){first=false;input.manifest.solution='Different';input.phase='test';}});
  await expect(requireLifecycleGovernance(async()=>proof(),input,root,0)).rejects.toThrow('unavailable');expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8'))).toMatchObject({status:'unavailable',phase:'import',manifestSha256:manifestDigest(request.manifest)});expect(await fs.readdir(root)).toEqual(['governance-0-import.json']);
});
it.each(['elapsed','rollback'])('rejects a settled provider when its %s budget is invalid even before the timer fires',async mode=>{
  const root=await fixture();vi.useFakeTimers();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);const start=Date.now();
  await expect(requireLifecycleGovernance(async()=>{if(mode==='elapsed')elapsed=60000;else vi.setSystemTime(start-1);return proof();},request,root,0)).rejects.toThrow('unavailable');
  expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).status).toBe('unavailable');
});
it.each(['expiry','elapsed','cancelled'])('does not permit execution when %s occurs during the audit commit',async mode=>{
  const root=await fixture(),controller=new AbortController();vi.useFakeTimers();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  const rename=fs.rename.bind(fs);let first=true;
  vi.spyOn(fs,'rename').mockImplementation(async(...args:Parameters<typeof fs.rename>)=>{await rename(...args);if(first){first=false;if(mode==='expiry')vi.setSystemTime(Date.now()+61000);else if(mode==='elapsed')elapsed=60000;else controller.abort();}});
  await expect(requireLifecycleGovernance(async()=>proof(),{...request,signal:controller.signal},root,0)).rejects.toThrow('unavailable');
  const receipt=JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8'));expect(receipt.status).toBe('unavailable');expect(receipt.reasons[0]).toContain('persisting its audit');
});
it('prevents a clear audit rename when authority expires during its temporary file write',async()=>{
  const root=await fixture();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  const write=fs.writeFile.bind(fs),rename=vi.spyOn(fs,'rename');let first=true;
  vi.spyOn(fs,'writeFile').mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{await write(...args);if(first){first=false;elapsed=60000;}});
  await expect(requireLifecycleGovernance(async()=>proof(),request,root,0)).rejects.toThrow('unavailable');
  expect(rename).toHaveBeenCalledTimes(1);expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).status).toBe('unavailable');
});
it('blocks absent providers, thrown exceptions and explicit violations while saving the decision',async()=>{const root=await fixture();for(const [index,check] of [undefined,async()=>{throw new Error('secret provider detail');},async()=>({...proof(),status:'blocked' as const,reasons:['Prohibited connector']})].entries()){await expect(requireLifecycleGovernance(check,request,root,index)).rejects.toThrow('Lifecycle governance');const value=JSON.parse(await fs.readFile(path.join(root,`governance-${index}-import.json`),'utf8'));expect(value.status).not.toBe('clear');expect(JSON.stringify(value)).not.toContain('secret provider detail');}});
it('invalidates missing hashes, stale decisions and changes to every execution binding',async()=>{const root=await fixture();const candidates=[{...proof(),artifactSha256:undefined},{...proof(),policySha256:undefined},{...proof(),schemaSha256:undefined},{...proof(),manifestSha256:'d'.repeat(64)},{...proof(),sourceCommit:'b'.repeat(40)},{...proof(),phase:'test' as const},{...proof(),environmentUrl:'https://other.crm4.dynamics.com'},{...proof(),releaseId:'other'},{...proof(),checkedAt:new Date(Date.now()-61000).toISOString()},{...proof(),checkedAt:new Date(Date.now()+31000).toISOString()}];for(const [index,candidate] of candidates.entries())await expect(requireLifecycleGovernance(async()=>candidate,request,root,index)).rejects.toThrow('unavailable');});
it('refuses execution if its audit cannot be written',async()=>{const root=await fixture();await fs.mkdir(path.join(root,'governance-0-import.json'));await expect(requireLifecycleGovernance(async()=>proof(),request,root,0)).rejects.toThrow();});
it('binds a clear import decision to the independently hashed package bytes',async()=>{const root=await fixture();await expect(requireLifecycleGovernance(async()=>proof(),{...request,packageSha256:'e'.repeat(64)},root,0)).rejects.toThrow('unavailable');await expect(requireLifecycleGovernance(async()=>proof(),{...request,packageSha256:'a'.repeat(64)},root,1)).resolves.toBe('governance-1-import.json');});
it('revokes a timed-out provider while retaining ownership until it settles, and rejects late clear results',async()=>{
  const root=await fixture();vi.useFakeTimers();let providerSignal!:AbortSignal,complete!:(value:LifecycleResult)=>void;const notice=vi.fn();let settled=false;
  const pending=requireLifecycleGovernance(async input=>{providerSignal=input.signal!;return new Promise(resolve=>{complete=resolve;});},request,root,0,undefined,notice);
  const rejected=pending.catch(error=>{settled=true;return error;});await vi.advanceTimersByTimeAsync(60000);expect(providerSignal.aborted).toBe(true);expect(settled).toBe(false);expect(notice).toHaveBeenCalledExactlyOnceWith('deadline');
  complete(proof());expect(await rejected).toBeInstanceOf(Error);expect(settled).toBe(true);expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).status).toBe('unavailable');
});
it('keeps an explicitly cancelled provider pending until cleanup settles',async()=>{
  const root=await fixture();
  const controller=new AbortController();let complete!:(value:LifecycleResult)=>void;
  const cancelled=requireLifecycleGovernance(async()=>new Promise(resolve=>{complete=resolve;}),{...request,signal:controller.signal},root,1);
  let settled=false;const denied=cancelled.catch(error=>{settled=true;return error;});await Promise.resolve();controller.abort();await Promise.resolve();expect(settled).toBe(false);complete(proof());expect(await denied).toBeInstanceOf(Error);
  expect(JSON.parse(await fs.readFile(path.join(root,'governance-1-import.json'),'utf8')).status).toBe('unavailable');
  await expect(requireLifecycleGovernance(async()=>proof(),{...request,signal:controller.signal},root,2)).rejects.toThrow('unavailable');
});
it('retains a cancelled native provider through its acknowledged process close',async()=>{
  const root=await fixture(),script=path.join(root,'provider.mjs'),controller=new AbortController(),notice=vi.fn();
  await fs.writeFile(script,`process.send('ready');process.on('message',message=>{if(message==='cancel')process.send('cleanup-pending');if(message==='release'){process.disconnect();process.exit(0);}});`);
  let child:ChildProcess|undefined,ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});let settled=false;
  const pending=requireLifecycleGovernance(async input=>{
    child=fork(script,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});const closed=once(child,'close');
    await once(child,'message');input.signal!.addEventListener('abort',()=>child!.send('cancel'),{once:true});ready();
    const [code]=await closed;if(code!==0)throw new Error('Native fixture failed');return proof();
  },{...request,signal:controller.signal},root,0,undefined,notice).catch(error=>{settled=true;return error;});
  try{
    await started;const cleanup=once(child!,'message');controller.abort();const [message]=await cleanup;expect(message).toBe('cleanup-pending');expect(child!.exitCode).toBeNull();expect(process.kill(child!.pid!,0)).toBe(true);expect(settled).toBe(false);
    expect(notice).toHaveBeenCalledExactlyOnceWith('cancelled');child!.send('release');expect(await pending).toBeInstanceOf(Error);expect(child!.exitCode).toBe(0);expect(settled).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).status).toBe('unavailable');
  }finally{if(child?.exitCode===null)child.kill();await pending;}
});
it('ignores a cancellation-report failure as authority and still waits for the provider',async()=>{
  const root=await fixture(),controller=new AbortController();let complete!:(value:LifecycleResult)=>void,settled=false;
  const pending=requireLifecycleGovernance(async()=>new Promise(resolve=>{complete=resolve;}),{...request,signal:controller.signal},root,0,undefined,async()=>{throw new Error('private reporting failure');}).catch(error=>{settled=true;return error;});
  await Promise.resolve();controller.abort();await Promise.resolve();expect(settled).toBe(false);complete(proof());expect(await pending).toBeInstanceOf(Error);
  expect(await fs.readFile(path.join(root,'governance-0-import.json'),'utf8')).not.toContain('private');
});
