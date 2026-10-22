import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {prepareTrackedImport,recordTrackedImportIntent} from './trackedImport.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
it.each(['save-failure','lost-owner-after-save','wrong-target','wrong-package'])('refuses tracked dispatch preparation for %s',async fault=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tracked-persistence-independent-'));
 try{
  const zip=path.join(root,'solution.zip');await fs.writeFile(zip,'bounded package');
  const digest=crypto.createHash('sha256').update('bounded package').digest('hex');
  const tracked=await prepareTrackedImport(zip,root,'https://approved.crm4.dynamics.com',digest);
  const run={id:'independent-run',environmentUrl:fault==='wrong-target'?'https://different.crm4.dynamics.com':tracked.environmentUrl,recovery:{packageSha256:fault==='wrong-package'?'0'.repeat(64):digest}} as DeliveryRun;
  const state=path.join(root,'delivery.json');let saved=false;
  const save=vi.fn(async()=>{if(fault==='save-failure')throw new Error('durable save failed');await fs.writeFile(state,JSON.stringify(run));saved=true;});
  const ownership=vi.fn(async()=>{if(fault==='lost-owner-after-save'&&saved)throw new Error('ownership lost');});
  await expect(recordTrackedImportIntent(run,tracked,state,save,ownership)).rejects.toThrow();
  if(fault==='wrong-target'||fault==='wrong-package'){expect(save).not.toHaveBeenCalled();expect(run.operations).toBeUndefined();}
  if(fault==='save-failure'||fault==='lost-owner-after-save'){
   expect(run.operations).toHaveLength(1);expect(run.operations![0]).toMatchObject({platformJobId:tracked.platformJobId,status:'intent'});
   await expect(recordTrackedImportIntent(run,tracked,state,async()=>{},async()=>{})).rejects.toThrow('never replay');
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
