import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {expect,it} from 'vitest';
import {TenancyMutationStore} from './tenancyMutation.ts';import {createTenancyService} from './tenancy.ts';
it('retains durable quarantine after the process that issued an intent has exited',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tenancy-crash-intent-')),file=path.join(root,'tenancy-mutation.json');
  try{
    const source=`import {TenancyMutationStore} from ${JSON.stringify(pathToFileURL(path.resolve('server/tenancyMutation.ts')).href)};new TenancyMutationStore(process.argv[1]).begin('sign-in');`;
    await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','--eval',source,file],{windowsHide:true,timeout:10000,env:{SystemRoot:process.env.SystemRoot??process.env.SYSTEMROOT??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''}});
    const bytes=await fs.readFile(file,'utf8'),store=new TenancyMutationStore(file);expect(store.view()).toMatchObject({status:'pending',quarantined:true});
    const service=createTenancyService(false,{run:async()=>{throw new Error('No native query allowed during quarantine');},start:()=>{throw new Error('No authentication launch allowed during quarantine');}},root);
    expect(service.activity()).toMatchObject({busy:true,authenticationRequests:0,profileMutation:{status:'pending',quarantined:true}});expect(await service.info()).toMatchObject({status:'disconnected',isReal:false});await expect(service.shutdown()).rejects.toThrow('requires reconciliation');expect(await fs.readFile(file,'utf8')).toBe(bytes);
  }finally{await fs.rm(root,{recursive:true,force:true});}
},15000);
