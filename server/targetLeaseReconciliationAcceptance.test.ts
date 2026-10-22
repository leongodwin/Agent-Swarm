import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {expect,it} from 'vitest';
import {inspectRetainedTargetLeases} from './targetLeaseReconciliation.ts';
import {acquireResourceLease} from './resourceLease.ts';

const resource='deployment:https://target-recovery.invalid';
const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
let deadPid:Promise<number>|undefined;
const dead=()=>deadPid??=new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true});child.once('error',reject);child.once('close',()=>resolve(child.pid!));});
async function fixture(fn:(root:string)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-target-reconciliation-'));
 try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}
}
async function seed(root:string,identity=resource,overrides:object={}){
 const file=path.join(root,sha(identity)+'.json'),bytes=JSON.stringify({resource:identity,owner:'retained-run',pid:await dead(),token:crypto.randomUUID(),acquiredAt:new Date().toISOString(),...overrides});
 await fs.writeFile(file,bytes);return {file,bytes};
}

it('observes exact target ownership under guard without releasing a lease or granting resumption',async()=>fixture(async root=>{
 const {file,bytes}=await seed(root),inspection=await inspectRetainedTargetLeases(root,await dead(),['retained-run']);
 try{
  expect(inspection.summary).toMatchObject({scope:'target-lease-observations',resourceLeasesReleased:false,resumptionAuthorized:false});
  expect(inspection.summary.leases).toEqual([{recordSha256:sha(bytes),attribution:'recorded-local-owner',resourceKind:'deployment'}]);
  await expect(acquireResourceLease(root,resource,'replacement')).rejects.toThrow(/progress|recovery/i);
  await inspection.assertUnchanged();expect(await fs.readFile(file,'utf8')).toBe(bytes);
 }finally{await inspection.release();}
 expect(await fs.readFile(file,'utf8')).toBe(bytes);await expect(fs.stat(file+'.reaping')).rejects.toMatchObject({code:'ENOENT'});
}));

it.each([{pid:process.pid},{owner:'other-run'}])('refuses foreign, live or unlinked ownership before acquiring guards: %j',async overrides=>fixture(async root=>{
 const {file,bytes}=await seed(root,resource,overrides);
 await expect(inspectRetainedTargetLeases(root,await dead(),['retained-run'])).rejects.toThrow();
 expect(await fs.readFile(file,'utf8')).toBe(bytes);expect(await fs.readdir(root)).toEqual([path.basename(file)]);
}));

it('refuses a live owner without poisoning its legitimate release capability',async()=>fixture(async root=>{
 const lease=await acquireResourceLease(root,resource,'retained-run');
 await expect(inspectRetainedTargetLeases(root,process.pid,['retained-run'])).rejects.toThrow();
 await lease.assertOwned();await lease.release();expect(await fs.readdir(root)).toEqual([]);
}));

it('recognizes the real Canvas authoring resource prefix',async()=>fixture(async root=>{
 await seed(root,'canvas-authoring:https://target-recovery.invalid:11111111-1111-4111-8111-111111111111');
 const inspection=await inspectRetainedTargetLeases(root,await dead(),['retained-run']);
 try{expect(inspection.summary.leases[0].resourceKind).toBe('canvas');}finally{await inspection.release();}
}));

it('detects matching-token identity drift and leaves the changed ownership intact',async()=>fixture(async root=>{
 const {file,bytes}=await seed(root),inspection=await inspectRetainedTargetLeases(root,await dead(),['retained-run']);
 const changed=JSON.stringify({...JSON.parse(bytes),owner:'new-owner'});await fs.writeFile(file,changed);
 try{await expect(inspection.assertUnchanged()).rejects.toThrow(/ownership changed/i);}finally{await inspection.release();}
 expect(await fs.readFile(file,'utf8')).toBe(changed);
}));

it('detects new unrelated leases acquired while observations are outstanding',async()=>fixture(async root=>{
 const {file,bytes}=await seed(root),inspection=await inspectRetainedTargetLeases(root,await dead(),['retained-run']);
 const newLease=await acquireResourceLease(root,'deployment:https://other-target.invalid','foreign-owner');
 try{await expect(inspection.assertUnchanged()).rejects.toThrow(/inventory changed/i);expect(await fs.readFile(file,'utf8')).toBe(bytes);await newLease.assertOwned();}
 finally{await inspection.release();await newLease.release();}
}));

it('preserves a foreign reconciliation guard and all ownership bytes on refusal',async()=>fixture(async root=>{
 const {file,bytes}=await seed(root);await fs.mkdir(file+'.reaping');await fs.writeFile(path.join(file+'.reaping','owner'),'foreign');
 await expect(inspectRetainedTargetLeases(root,await dead(),['retained-run'])).rejects.toThrow();
 expect(await fs.readFile(file,'utf8')).toBe(bytes);expect(await fs.readFile(path.join(file+'.reaping','owner'),'utf8')).toBe('foreign');
}));

it('rejects mismatched resource filenames without removing the original lease',async()=>fixture(async root=>{
 const {file}=await seed(root),bytes=JSON.stringify({resource:'deployment:https://wrong.invalid',owner:'retained-run',pid:await dead(),token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});
 await fs.writeFile(file,bytes);await expect(inspectRetainedTargetLeases(root,await dead(),['retained-run'])).rejects.toThrow(/filename mismatch/i);
 expect(await fs.readFile(file,'utf8')).toBe(bytes);expect(await fs.readdir(root)).toEqual([path.basename(file)]);
}));
