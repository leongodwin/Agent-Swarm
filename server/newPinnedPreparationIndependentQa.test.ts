import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {artifactPath,pinnedGitArgs,nativeEnvironment,type LocalPreparation} from './pinnedPreparationContracts.ts';
import {readPinnedBlob,digest,verifyLocalPreparation} from './pinnedPreparation.ts';
import {initializeNativeEpoch,journalNativeCommand,inspectNativeCommands,nativeRecoveryEligible} from './nativeCommandJournal.ts';
const exec=promisify(execFile);
it('admits only the exact pinned Git and provider prerequisite read shapes',()=>{
 const git={executable:'git',args:pinnedGitArgs('blob','a'.repeat(40),'docs/one.md')};
 const gh={executable:'gh',args:['issue','view','37','--repo','leongodwin/Expnese-App2','--json','state']};
 const pac={executable:'pac',args:['org','who','--environment','https://approved.crm4.dynamics.com']};
 for(const command of [git,gh,pac])expect(nativeRecoveryEligible(command)).toBe(true);
 for(const command of [{...git,args:[...git.args,'--filters']},{...git,args:['fetch','origin','main']},{...gh,args:[...gh.args,'--web']},{...gh,args:['api','repos/leongodwin/Expnese-App2/issues/37','--method','POST']},{...pac,args:[...pac.args,'--select']},{...pac,args:['org','who','--environment','https://user:secret@approved.crm4.dynamics.com']}])expect(nativeRecoveryEligible(command)).toBe(false);
});
it.each(['../escape','a/../b','/absolute','C:/drive','a\\b','file:stream','a//b','a/./b','CON','nested/NUL.txt','name.','name ','a\u0000b'])('refuses unsafe materialized path %j',value=>{expect(artifactPath.safeParse(value).success).toBe(false);});
it('reads committed raw bytes without invoking repository filters/hooks or inherited Git overrides',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-git-independent-'));
 try{
  const git=async(args:string[])=>exec('git',args,{cwd:root,windowsHide:true});
  await git(['init']);await fs.writeFile(path.join(root,'doc.txt'),'committed raw document');await git(['add','doc.txt']);
  await git(['-c','user.name=QA','-c','user.email=qa@example.test','commit','-m','fixture']);
  const head=(await git(['rev-parse','HEAD'])).stdout.trim();
  const marker=path.join(root,'malicious-marker');
  await git(['config','core.fsmonitor',`echo malicious > "${marker}"`]);
  await git(['config','filter.evil.smudge',`echo malicious > "${marker}"`]);
  await fs.writeFile(path.join(root,'.gitattributes'),'*.txt filter=evil');
  const command=async(args:string[])=>{const env=nativeEnvironment({...process.env,GIT_DIR:path.join(root,'not-a-repo'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'malicious'},args,'git');expect(Object.keys(env).some(k=>/^GIT_CONFIG_(?:COUNT|KEY_|VALUE_)/.test(k))).toBe(false);return (await exec('git',args,{cwd:root,env,windowsHide:true})).stdout;};
  expect(await readPinnedBlob(command,head,'doc.txt')).toBe('committed raw document');expect(await fs.stat(marker).catch(()=>undefined)).toBeUndefined();
 }finally{await fs.rm(root,{recursive:true,force:true});}
},15000);
it.each(['output','manifest','alias'])('refuses changed local preparation %s evidence',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-local-independent-'));
 try{
  const files=['cubefarm.delivery.json','one.md','two.md','three.md','package.zip'];for(const name of files)await fs.writeFile(path.join(root,name),name);
  const plan:LocalPreparation={kind:'pinned-artifact-v1',sourceCommit:'a'.repeat(40),manifestSha256:digest(files[0]),checkout:root,files:files.map(name=>({path:name,sha256:digest(name)}))};
  await verifyLocalPreparation(plan);
  if(mode==='output')await fs.appendFile(path.join(root,'one.md'),'changed');
  if(mode==='manifest')plan.manifestSha256='b'.repeat(64);
  if(mode==='alias')plan.files.push({...plan.files[1],path:'ONE.md'});
  await expect(verifyLocalPreparation(plan)).rejects.toThrow();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('never certifies an arbitrary completed build command mixed into a native epoch',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-mixed-independent-')),lease=Buffer.from('owned mixed fixture'),leaseHash=digest(lease);
 try{
  await initializeNativeEpoch(root,leaseHash);
  await journalNativeCommand(root,leaseHash,{executable:'node',args:['arbitrary-build.js']},root,'run',async()=>{},async context=>{await fs.writeFile(context.proof,JSON.stringify({schemaVersion:1,id:context.id,intentSha256:context.intentSha256,mechanism:'windows-job-object-v1',scope:'inherited-process-tree',activeProcesses:0,breakawayAllowed:false,nativeTreeQuiescenceVerified:true}));});
  expect((await inspectNativeCommands(root,lease)).nativeTreeQuiescenceVerified).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
