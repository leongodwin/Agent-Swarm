import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {claimHeadlessRun,reconcileHeadlessRunBarrier} from './headlessRunBarrier.ts';
it.skipIf(process.platform!=='win32')('uses real Windows kernel exclusion for competing original-run finalizers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'headless-kernel-'));
 try{
  const scope={flow:'isolated-synthetic'},intent={nonce:'original'};await claimHeadlessRun(root,scope,intent);let observed=0;
  const observe=async()=>{observed++;await new Promise(resolve=>setTimeout(resolve,50));return{providerRun:'synthetic-terminal-observation'};};
  const attempts=await Promise.allSettled([reconcileHeadlessRunBarrier(root,scope,observe,async()=>{}),reconcileHeadlessRunBarrier(root,scope,observe,async()=>{})]);
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(observed).toBe(1);
  const files=await fs.readdir(root);expect(files.filter(f=>f.endsWith('.terminal.json'))).toHaveLength(1);expect(files.some(f=>f.endsWith('.pending.json'))).toBe(false);
  await claimHeadlessRun(root,scope,{nonce:'new-invocation'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);
