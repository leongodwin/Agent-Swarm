import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {DeliveryService} from './delivery.ts';

it('holds a real hard-crashed delivery owner until explicit hash-bound empty-history recovery in maintenance',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cubefarm-delivery-crash-qa-'));
 const module=new URL('./deliveryLease.ts',import.meta.url).href;
 const source=`const {acquireDeliveryLease}=await import(${JSON.stringify(module)});await acquireDeliveryLease(process.argv[1]);console.log('LEASE_READY');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
 let service:DeliveryService|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Isolated lease owner startup timed out')),10000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('LEASE_READY')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  const lease=await fs.readFile(path.join(root,'delivery.lock'),'utf8');expect(JSON.parse(lease).pid).toBe(child.pid);
  const state=JSON.stringify({schemaVersion:1,policy:null,runs:[],releases:[],blockers:[],revision:0,attemptHistory:{version:1,startedAt:new Date().toISOString(),legacyRunIds:[],attempts:[]}});
  await fs.writeFile(path.join(root,'delivery.json'),state);
  if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(child.pid),'/F'],{windowsHide:true});else child.kill('SIGKILL');
  await closed;
  service=new DeliveryService(root,false);await service.init({allowUnavailable:true});
  expect(service.available).toBe(false);expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);
  const inspection=await service.recoveryInspection();expect(inspection).toMatchObject({owner:'absent',history:'empty',canRecover:true});
  await expect(service.recoverStartup(inspection.snapshotSha256!)).rejects.toThrow('maintenance');
  service.setDraining(true);await service.recoverStartup(inspection.snapshotSha256!);
  expect(service.available).toBe(true);expect(service.isDraining).toBe(true);
  const archived=await fs.readdir(path.join(root,'delivery-recovery'));
  expect(await fs.readFile(path.join(root,'delivery-recovery',archived.find(name=>name.endsWith('.lock.json'))!),'utf8')).toBe(lease);
  const receipt=JSON.parse(await fs.readFile(path.join(root,'delivery-recovery',archived.find(name=>!name.endsWith('.lock.json'))!),'utf8'));
  expect(receipt).toMatchObject({scope:'no-cloud-operation-history',remoteOutcomeVerified:false,runs:0,releases:0,attempts:0});
 }finally{
  await service?.close();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
  await fs.rm(root,{recursive:true,force:true});
 }
},25000);
