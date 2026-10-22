import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {expect,it} from 'vitest';
import {inspectDeliveryRecovery,recoverEmptyDelivery} from './deliveryRecovery.ts';
import {journalNativeCommand} from './nativeCommandJournal.ts';
it.each(['returned','unresolved','corrupt'])('keeps empty-cloud-history recovery blocked by %s native command evidence',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-empty-recovery-'));
 try{
  const lease=JSON.stringify({schemaVersion:1,pid:2147483647,token:crypto.randomUUID(),acquiredAt:new Date().toISOString()});
  await fs.writeFile(path.join(root,'delivery.lock'),lease);const state=JSON.stringify({schemaVersion:1,policy:null,runs:[],releases:[],blockers:[],revision:0});await fs.writeFile(path.join(root,'delivery.json'),state);
  const before=await inspectDeliveryRecovery(root);expect(before.canRecover).toBe(true);
  const hash=crypto.createHash('sha256').update(lease).digest('hex');
  await journalNativeCommand(root,hash,{executable:'synthetic',args:[]},root,undefined,async()=>{if(mode==='unresolved')throw new Error('ownership changed');},async()=>{}).catch(()=>{});
  if(mode==='corrupt')await fs.writeFile(path.join(root,'delivery-native',hash,'unexpected'),'{}');
  const after=await inspectDeliveryRecovery(root);expect(after.canRecover).toBe(false);expect(after.reason).toContain('Native command');
  await expect(recoverEmptyDelivery(root,before.snapshotSha256!)).rejects.toThrow('independent reconciliation');expect(await fs.readFile(path.join(root,'delivery.lock'),'utf8')).toBe(lease);expect(await fs.readFile(path.join(root,'delivery.json'),'utf8')).toBe(state);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
