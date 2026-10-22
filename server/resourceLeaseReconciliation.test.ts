import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {acquireResourceLease} from './resourceLease.ts';

const resource='deployment:https://reconciliation.invalid';
const leaseFile=(root:string)=>path.join(root,`${crypto.createHash('sha256').update(resource).digest('hex')}.json`);
async function fixture(fn:(root:string)=>Promise<void>){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-resource-reconciliation-'));
  try{await fn(root);}finally{vi.restoreAllMocks();await fs.rm(root,{recursive:true,force:true});}
}

it('honors an existing reconciliation guard even when its lease file is absent',async()=>fixture(async root=>{
  const file=leaseFile(root),guard=`${file}.reaping`;
  await fs.mkdir(guard);await fs.writeFile(path.join(guard,'owner'),'reconciler');
  await expect(acquireResourceLease(root,resource,'new owner')).rejects.toThrow(/progress|recovery|guard/i);
  await expect(fs.lstat(file)).rejects.toMatchObject({code:'ENOENT'});
  expect(await fs.readFile(path.join(guard,'owner'),'utf8')).toBe('reconciler');
}));

it('allows exactly one simultaneous fresh acquisition and preserves its complete identity',async()=>fixture(async root=>{
  const results=await Promise.allSettled(Array.from({length:12},(_,i)=>acquireResourceLease(root,resource,`owner-${i}`)));
  const winners=results.filter(result=>result.status==='fulfilled');
  expect(winners).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(11);
  const winner=winners[0];if(winner.status!=='fulfilled')throw new Error('Missing winning lease');
  const bytes=await fs.readFile(leaseFile(root),'utf8'),record=JSON.parse(bytes);
  expect(record).toMatchObject({resource,pid:process.pid,token:winner.value.token});
  await winner.value.assertOwned();expect(await fs.readFile(leaseFile(root),'utf8')).toBe(bytes);
  await winner.value.release();expect(await fs.readdir(root)).toEqual([]);
}));

it('refuses a symbolic ownership record before following its target',async()=>fixture(async root=>{
  const held=await acquireResourceLease(root,resource,'owner'),file=leaseFile(root),bytes=await fs.readFile(file,'utf8');
  // Model the lstat result directly: Windows file symlink creation requires an
  // unrelated administrator privilege; the contract under test is refusal to read it.
  const original=fs.lstat.bind(fs),open=vi.spyOn(fs,'open');
  vi.spyOn(fs,'lstat').mockImplementation((async(value:Parameters<typeof fs.lstat>[0],...args:unknown[])=>{
    const stat=await original(value,...args as []);
    if(String(value)===file)return new Proxy(stat,{get(target,key){if(key==='isSymbolicLink')return()=>true;if(key==='isFile')return()=>false;return Reflect.get(target,key);}});
    return stat;
  }) as typeof fs.lstat);
  await expect(held.assertOwned()).rejects.toThrow(/ownership lost/i);
  await expect(held.release()).rejects.toThrow(/ownership lost/i);
  expect(open.mock.calls.filter(([value])=>String(value)===file)).toEqual([]);
  vi.restoreAllMocks();expect(await fs.readFile(file,'utf8')).toBe(bytes);
  await expect(fs.lstat(`${file}.reaping`)).rejects.toMatchObject({code:'ENOENT'});
}));

it('never removes another recovery guard after refusing an interrupted ownership record',async()=>fixture(async root=>{
  const held=await acquireResourceLease(root,resource,'owner'),file=leaseFile(root),bytes=await fs.readFile(file,'utf8');
  await fs.mkdir(`${file}.reaping`);await fs.writeFile(path.join(`${file}.reaping`,'owner'),'foreign-recovery');
  await expect(held.release()).rejects.toThrow(/progress|recovery|guard/i);
  await expect(acquireResourceLease(root,resource,'replacement',{reclaimDeadOwner:false})).rejects.toThrow();
  expect(await fs.readFile(file,'utf8')).toBe(bytes);
  expect(await fs.readFile(path.join(`${file}.reaping`,'owner'),'utf8')).toBe('foreign-recovery');
}));
