import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {expect,it} from 'vitest';

it.each(['missing-approval','wrong-target','extra-flags','wrong-hash'])('refuses %s before acquiring a lease or dispatching PAC',async fault=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'live-import-guard-'));
 const root=path.join(directory,'journal'),file=path.join(directory,'request.json'),packageFile=path.join(directory,'probe.zip');
 await fs.writeFile(packageFile,'not a deployable package');
 const target='https://org68dad46d.crm4.dynamics.com';
 const approval={packageSha256:crypto.createHash('sha256').update('not a deployable package').digest('hex'),solutionUniqueName:'CubeFarmResumeProbe'};
 const args=['solution','import','--path',packageFile,'--environment',fault==='wrong-target'?'https://unapproved.invalid':target];
 if(fault==='extra-flags')args.push('--force-overwrite');
 if(fault==='wrong-hash')approval.packageSha256='0'.repeat(64);
 await fs.writeFile(file,JSON.stringify({root,runId:crypto.randomUUID(),id:crypto.randomUUID(),environmentUrl:target,...(fault==='missing-approval'?{}:{importApproval:approval}),command:{executable:'pac',args}}));
 try{
  const child=spawn(process.execPath,['--import','tsx','scripts/live-native-provider-probe.ts',file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk.toString());
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  expect(code).not.toBe(0);expect(stderr).toMatch(/Live import requires/);
  expect(await fs.stat(root).catch(()=>undefined)).toBeUndefined();
 }finally{await fs.rm(directory,{recursive:true,force:true});}
},20000);
