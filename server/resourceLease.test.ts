import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { acquireResourceLease } from './resourceLease.ts';

it('excludes concurrent owners, preserves live owners regardless of age, and checks tokens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    const first = await acquireResourceLease(root, 'resource', 'first');
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('owned by first');
    const file = path.join(root, (await fs.readdir(root))[0]);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    const original={...record};record.acquiredAt = '2000-01-01T00:00:00.000Z'; await fs.writeFile(file, JSON.stringify(record));
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('owned by first');
    await fs.writeFile(file,JSON.stringify(original));
    await first.release();
    const second = await acquireResourceLease(root, 'resource', 'second');
    record.token = 'replacement'; await fs.writeFile(file, JSON.stringify(record));
    await expect(second.assertOwned()).rejects.toThrow('ownership lost');
    await expect(second.release()).rejects.toThrow('ownership lost');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).token).toBe('replacement');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('fails closed for damaged records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    await acquireResourceLease(root, 'resource', 'first');
    await fs.writeFile(path.join(root, (await fs.readdir(root))[0]), '{}');
    await expect(acquireResourceLease(root, 'resource', 'second')).rejects.toThrow('Invalid resource lease');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('serializes dead-owner recovery and keeps deployment recovery manual', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-leases-'));
  try {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
    const deadPid = child.pid!;
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
    await acquireResourceLease(root, 'resource', 'old owner');
    const file = path.join(root, (await fs.readdir(root))[0]);
    const record = JSON.parse(await fs.readFile(file, 'utf8')); record.pid = deadPid;
    await fs.writeFile(file, JSON.stringify(record));
    await expect(acquireResourceLease(root, 'resource', 'deployment', { reclaimDeadOwner: false })).rejects.toThrow('verify no platform operation');
    const results = await Promise.allSettled([acquireResourceLease(root, 'resource', 'first'), acquireResourceLease(root, 'resource', 'second')]);
    const acquired = results.filter((r) => r.status === 'fulfilled');
    expect(acquired).toHaveLength(1);
    await acquired[0].value.assertOwned(); await acquired[0].value.release();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it.each(['owner','pid','acquiredAt','token'] as const)('rejects matching-token %s drift and never resurrects observed ownership',async field=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-lease-identity-'));
  try{
    const lease=await acquireResourceLease(root,'resource','owner');const file=path.join(root,(await fs.readdir(root))[0]);const original=JSON.parse(await fs.readFile(file,'utf8'));
    const changed={...original,[field]:field==='pid'?original.pid+1:field==='token'?'22222222-2222-4222-8222-222222222222':field==='acquiredAt'?'2000-01-01T00:00:00.000Z':'replacement'};
    await fs.writeFile(file,JSON.stringify(changed));await expect(lease.assertOwned()).rejects.toThrow('ownership lost');
    await fs.writeFile(file,JSON.stringify(original));await expect(lease.assertOwned()).rejects.toThrow('ownership lost');await expect(lease.release()).rejects.toThrow('ownership lost');
    expect(JSON.parse(await fs.readFile(file,'utf8'))).toEqual(original);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
it.each(['oversized','extra-field','directory','missing'] as const)('quarantines %s ownership evidence instead of authorizing a command',async fault=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-lease-corrupt-'));
  try{
    const lease=await acquireResourceLease(root,'resource','owner');const file=path.join(root,(await fs.readdir(root))[0]);
    if(fault==='oversized')await fs.writeFile(file,' '.repeat(16*1024+1));
    if(fault==='extra-field'){const value=JSON.parse(await fs.readFile(file,'utf8'));await fs.writeFile(file,JSON.stringify({...value,extra:true}));}
    if(fault==='missing'||fault==='directory'){await fs.unlink(file);if(fault==='directory')await fs.mkdir(file);}
    await expect(lease.assertOwned()).rejects.toThrow('ownership lost');await expect(lease.release()).rejects.toThrow('ownership lost');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('shares release completion among concurrent callers and preserves a recovery guard',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-lease-release-'));
  try{
    const lease=await acquireResourceLease(root,'resource','owner');await Promise.all([lease.release(),lease.release()]);expect(await fs.readdir(root)).toEqual([]);
    const held=await acquireResourceLease(root,'resource','next');const file=path.join(root,(await fs.readdir(root))[0]);await fs.mkdir(file+'.reaping');
    await expect(held.release()).rejects.toThrow('already in progress');expect(await fs.readFile(file,'utf8')).toContain('next');expect((await fs.stat(file+'.reaping')).isDirectory()).toBe(true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('rejects an oversized UTF-8 identity before leaving an unreadable ownership file',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'swarm-lease-size-'));
  try{await expect(acquireResourceLease(root,'界'.repeat(8192),'owner')).rejects.toThrow('bounded evidence size');expect(await fs.readdir(root)).toEqual([]);}
  finally{await fs.rm(root,{recursive:true,force:true});}
});
