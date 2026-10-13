import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {acquireDeliveryLease} from './deliveryLease.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function root(){const home=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-lease-'));roots.push(home);return home;}
it('excludes another owner and releases once for concurrent callers without removing a successor',async()=>{
  const home=await root(),file=path.join(home,'delivery.lock');const lease=await acquireDeliveryLease(home);
  await expect(acquireDeliveryLease(home)).rejects.toThrow('Another delivery process');await lease.assertOwned();
  const first=lease.release(),second=lease.release();expect(second).toBe(first);await first;
  const successor=await acquireDeliveryLease(home);const saved=await fs.readFile(file,'utf8');await lease.release();expect(await fs.readFile(file,'utf8')).toBe(saved);
  await expect(lease.assertOwned()).rejects.toThrow('ownership lost');await successor.release();
});
it.each([process.pid,2147483647])('preserves a legacy PID %s lease without automatic takeover',async pid=>{
  const home=await root(),file=path.join(home,'delivery.lock');const raw=JSON.stringify({pid,token:crypto.randomUUID()});await fs.writeFile(file,raw);
  await expect(acquireDeliveryLease(home)).rejects.toThrow(pid===process.pid?'Another delivery process':'Interrupted delivery lease');
  expect(await fs.readFile(file,'utf8')).toBe(raw);
});
it.each(['{','null','[]','{"pid":0,"token":"invalid"}','{"pid":"123","token":"invalid"}'])('preserves malformed lease %s',async raw=>{
  const home=await root(),file=path.join(home,'delivery.lock');await fs.writeFile(file,raw);
  await expect(acquireDeliveryLease(home)).rejects.toThrow('lease is missing or invalid');expect(await fs.readFile(file,'utf8')).toBe(raw);
});
it('refuses to release a different generation and preserves its marker',async()=>{
  const home=await root(),file=path.join(home,'delivery.lock');const lease=await acquireDeliveryLease(home);
  const changed=JSON.parse(await fs.readFile(file,'utf8'));changed.token=crypto.randomUUID();const raw=JSON.stringify(changed);await fs.writeFile(file,raw);
  await expect(lease.assertOwned()).rejects.toThrow('ownership lost');await expect(lease.release()).rejects.toThrow('ownership lost');
  expect(await fs.readFile(file,'utf8')).toBe(raw);expect(await fs.stat(`${file}.reaping`).then(()=>true,()=>false)).toBe(false);
});
it('does not clear an existing release/recovery guard',async()=>{
  const home=await root(),file=path.join(home,'delivery.lock');const lease=await acquireDeliveryLease(home);const raw=await fs.readFile(file,'utf8');await fs.mkdir(`${file}.reaping`);
  await expect(lease.release()).rejects.toThrow('already in progress');expect(await fs.readFile(file,'utf8')).toBe(raw);expect((await fs.stat(`${file}.reaping`)).isDirectory()).toBe(true);
});
