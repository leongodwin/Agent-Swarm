import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {artifactPath,isPinnedGitArgs,nativeEnvironment,pinnedGitArgs} from './pinnedPreparationContracts.ts';
import {readPinnedBlob} from './pinnedPreparation.ts';
import {readDeliverySource} from './deliverySourceRead.ts';

const file='.cubefarm/worker-preflight.json',head='a'.repeat(40);
it.each(['.env','.git/config','.cubefarm/secret.json','.cubefarm/../worker-preflight.json','.cubefarm/worker-preflight.json/../secret','.cubefarm/worker-preflight.json:secret'])('keeps hidden or escaped source %s outside the fixed preflight read exception',name=>{
 expect(()=>pinnedGitArgs('blob',head,name)).toThrow();
});
it('keeps the preflight inspection exception out of deployment artifact paths',()=>{
 expect(artifactPath.safeParse(file).success).toBe(false);
 for(const kind of ['entry','blob'] as const){const args=pinnedGitArgs(kind,head,file);expect(isPinnedGitArgs(args)).toBe(true);expect(nativeEnvironment({GIT_CONFIG_COUNT:'1'},args,'git').GIT_CONFIG_COUNT).toBeUndefined();}
});
it('reads the exact committed preflight through the normal named reader, preserving the working file and source boundaries',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cf-preflight-read-')),run=promisify(execFile),content='{"schemaVersion":1,"scope":"Synthetic committed read fixture"}\n';
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
 const git=async(args:string[])=>(await run('git',args,{cwd:root,env:nativeEnvironment(env,args,'git')})).stdout;
 try{
  await git(['init']);await git(['config','user.name','Synthetic fixture']);await git(['config','user.email','fixture@example.test']);await git(['config','core.autocrlf','false']);
  await fs.mkdir(path.join(root,'.cubefarm'));await fs.writeFile(path.join(root,file),content);await git(['add','--',file]);await git(['-c','commit.gpgsign=false','commit','-m','Synthetic fixture']);
  const commit=(await git(['rev-parse','HEAD'])).trim();await fs.writeFile(path.join(root,file),'Uncommitted bytes must not be substituted');
  const result=await readDeliverySource({kind:'repository-file',file,expectedSha256:crypto.createHash('sha256').update(content).digest('hex')},{repoId:'synthetic/probe',sourceCommit:commit,guard:()=>{},read:name=>readPinnedBlob(git,commit,name)});
  expect(result).toMatchObject({scope:'committed-repository-source',sourceCommit:commit,content});expect(await fs.readFile(path.join(root,file),'utf8')).toBe('Uncommitted bytes must not be substituted');
 }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cf-preflight-read-'))throw Error('Temporary fixture escaped its root');await fs.rm(root,{recursive:true,force:true});}
});
