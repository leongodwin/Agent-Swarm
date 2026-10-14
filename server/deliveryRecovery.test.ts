import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {inspectDeliveryRecovery,recoverEmptyDelivery} from './deliveryRecovery.ts';
import {DeliveryService} from './delivery.ts';import {acquireDeliveryLease} from './deliveryLease.ts';
const roots:string[]=[],services:DeliveryService[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-recovery-'));roots.push(root);const lease=JSON.stringify({schemaVersion:1,pid:2147483647,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});const state=JSON.stringify({schemaVersion:1,policy:{environmentUrl:'https://synthetic.crm4.dynamics.com',enabled:true,approvedAt:new Date().toISOString(),copilotPaused:true},runs:[],releases:[],blockers:[],revision:0,attemptHistory:{version:1,startedAt:new Date().toISOString(),legacyRunIds:[],attempts:[]}});await fs.writeFile(path.join(root,'delivery.lock'),lease);await fs.writeFile(path.join(root,'delivery.json'),state);return {root,lease,state};}
it('preserves an interrupted marker and validated empty history without dispatching cloud operations',async()=>{
  const {root,lease,state}=await fixture(),inspection=await inspectDeliveryRecovery(root);
  expect(inspection).toMatchObject({owner:'absent',history:'empty',canRecover:true});expect(JSON.stringify(inspection)).not.toContain(JSON.parse(lease).token);
  await recoverEmptyDelivery(root,inspection.snapshotSha256!);
  expect(await fs.readFile(path.join(root,'delivery.json'),'utf8')).toBe(state);expect(await fs.stat(path.join(root,'delivery.lock')).catch(()=>undefined)).toBeUndefined();
  const files=await fs.readdir(path.join(root,'delivery-recovery'));expect(files).toHaveLength(2);expect(await fs.readFile(path.join(root,'delivery-recovery',files.find(file=>file.endsWith('.lock.json'))!),'utf8')).toBe(lease);
  const audit=JSON.parse(await fs.readFile(path.join(root,'delivery-recovery',files.find(file=>!file.endsWith('.lock.json'))!),'utf8'));expect(audit.remoteOutcomeVerified).toBe(false);
  const next=await acquireDeliveryLease(root);await next.release();
});
it.each(['pid','token','runs','escaped-runs','releases','blockers','attempts'] as const)('refuses ambiguous recovery %s evidence even when the final value looks recoverable',async field=>{
 const {root,lease,state}=await fixture(),prior=await inspectDeliveryRecovery(root);
 let marker=lease,history=state;
 if(field==='pid')marker=`{"pid":${process.pid},${lease.slice(1)}`;
 else if(field==='token')marker=`{"token":"private-owner-token",${lease.slice(1)}`;
 else if(field==='attempts')history=state.replace('"attempts":[]','"attempts":[{"unknown":"private-cloud-operation"}],"attempts":[]');
 else history=`{"${field==='escaped-runs'?'\\u0072uns':field}":[{"unknown":"private-cloud-operation"}],${state.slice(1)}`;
 await fs.writeFile(path.join(root,'delivery.lock'),marker);await fs.writeFile(path.join(root,'delivery.json'),history);
 const view=await inspectDeliveryRecovery(root);expect(view.canRecover).toBe(false);expect(view.snapshotSha256).toBeUndefined();expect(JSON.stringify(view)).not.toContain('private-');
 expect(['pid','token'].includes(field)?view.owner:view.history).toBe('invalid');
 const forged=crypto.createHash('sha256').update(marker).update('\0').update(history).digest('hex');
 for(const digest of [prior.snapshotSha256!,forged])await expect(recoverEmptyDelivery(root,digest)).rejects.toThrow('changed or requires independent reconciliation');
 expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(marker);expect(await fs.readFile(path.join(root,'delivery.json'),'utf8')).toBe(history);expect(await fs.stat(path.join(root,'delivery-recovery')).catch(()=>undefined)).toBeUndefined();
});
it.each(['live','legacy','malformed-lease','missing-lease','invalid-state','missing-state','retained'] as const)('refuses %s recovery and preserves remaining bytes',async mode=>{
  const {root}=await fixture(),file=path.join(root,'delivery.lock'),state=path.join(root,'delivery.json');
  if(mode==='live'){const lease=JSON.parse(await fs.readFile(file,'utf8'));lease.pid=process.pid;await fs.writeFile(file,JSON.stringify(lease));}
  if(mode==='legacy')await fs.writeFile(file,JSON.stringify({pid:2147483647,token:crypto.randomUUID()}));
  if(mode==='malformed-lease')await fs.writeFile(file,'{');if(mode==='missing-lease')await fs.unlink(file);
  if(mode==='invalid-state')await fs.writeFile(state,'{');if(mode==='missing-state')await fs.unlink(state);
  if(mode==='retained'){const history=JSON.parse(await fs.readFile(state,'utf8'));history.runs=[{id:'legacy',repoId:'synthetic/repo',head:'legacy',environmentUrl:'https://synthetic.crm4.dynamics.com',phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:[],log:[],operations:[{id:'import',kind:'import',status:'unknown',commandSha256:'a'.repeat(64),startedAt:new Date().toISOString()}]}];history.attemptHistory.legacyRunIds=['legacy'];await fs.writeFile(state,JSON.stringify(history));}
  const before=await fs.readFile(file).catch(()=>undefined),saved=await fs.readFile(state).catch(()=>undefined),view=await inspectDeliveryRecovery(root);expect(view.canRecover).toBe(false);
  await expect(recoverEmptyDelivery(root,'a'.repeat(64))).rejects.toThrow('reconciliation');expect(await fs.readFile(file).catch(()=>undefined)).toEqual(before);expect(await fs.readFile(state).catch(()=>undefined)).toEqual(saved);
});
it.each(['lease','state'] as const)('rejects a changed %s generation after inspection',async mode=>{
  const {root}=await fixture(),view=await inspectDeliveryRecovery(root),file=path.join(root,mode==='lease'?'delivery.lock':'delivery.json');await fs.appendFile(file,' ');const changed=await fs.readFile(file);await expect(recoverEmptyDelivery(root,view.snapshotSha256!)).rejects.toThrow('changed');expect(await fs.readFile(file)).toEqual(changed);
});
it('excludes acquiring an owner while recovery holds the shared filesystem guard',async()=>{
  const {root}=await fixture();await fs.mkdir(path.join(root,'delivery.lock.reaping'));await expect(acquireDeliveryLease(root)).rejects.toThrow('already in progress');await expect(recoverEmptyDelivery(root,'a'.repeat(64))).rejects.toThrow('already in progress');expect((await fs.stat(path.join(root,'delivery.lock.reaping'))).isDirectory()).toBe(true);
});
it('rejects a successor that changes during archive preparation',async()=>{
  const {root}=await fixture(),view=await inspectDeliveryRecovery(root),mkdir=fs.mkdir;let successor='';
  vi.spyOn(fs,'mkdir').mockImplementation(async(...args:Parameters<typeof fs.mkdir>)=>{const result=await mkdir(...args);if(String(args[0])===path.join(root,'delivery-recovery')){successor=JSON.stringify({schemaVersion:1,pid:process.pid,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});await fs.writeFile(path.join(root,'delivery.lock'),successor);}return result;});
  await expect(recoverEmptyDelivery(root,view.snapshotSha256!)).rejects.toThrow('changed');expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(successor);
});
it('keeps the workspace status available while mutating delivery calls remain closed, then recovers in maintenance',async()=>{
  const {root}=await fixture(),service=new DeliveryService(root,false);services.push(service);await service.init({allowUnavailable:true});expect(service.available).toBe(false);expect(service.view()).toMatchObject({availability:'unavailable',policy:null,runs:[],running:false});
  await expect(service.configure('https://synthetic.crm4.dynamics.com',true)).rejects.toThrow('not ready');await expect(service.pauseCopilot(false)).rejects.toThrow('not ready');
  const view=await service.recoveryInspection();await expect(service.recoverStartup(view.snapshotSha256!)).rejects.toThrow('maintenance');service.setDraining(true);
  await service.recoverStartup(view.snapshotSha256!);expect(service.available).toBe(true);expect(service.isDraining).toBe(true);expect(service.view()).toMatchObject({availability:'ready',policy:{copilotPaused:true},running:false});await expect(service.recoveryInspection()).rejects.toThrow('not available');
});
it('cannot reopen a service explicitly closed during recovery',async()=>{
  const {root,lease}=await fixture(),service=new DeliveryService(root,false);services.push(service);await service.init({allowUnavailable:true});service.setDraining(true);const view=await service.recoveryInspection();
  const mkdir=fs.mkdir;let close:Promise<void>|undefined;vi.spyOn(fs,'mkdir').mockImplementation(async(...args:Parameters<typeof fs.mkdir>)=>{const result=await mkdir(...args);if(String(args[0])===path.join(root,'delivery-recovery'))close=service.close();return result;});
  await expect(service.recoverStartup(view.snapshotSha256!)).rejects.toThrow('closed');await close;expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);expect(service.available).toBe(false);
});
