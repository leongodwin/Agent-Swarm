import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomicFile.ts';
const exec = promisify(execFile);

/** Read committed inventory only. No installs, hooks, model execution or tenant writes. */
export async function inspectRepository(checkoutPath:string,evidenceRoot:string,guard:()=>void=()=>{}) {
  const git=async(args:string[])=>{guard();const {stdout}=await exec('git',args,{cwd:checkoutPath,windowsHide:true,timeout:15_000,maxBuffer:1024*1024,encoding:'utf8'});guard();return stdout;};
  const head=(await git(['rev-parse','HEAD'])).trim();
  if(!/^[a-f0-9]{40,64}$/.test(head))throw new Error('Repository discovery did not resolve a source commit');
  const files=(await git(['ls-tree','-r','--name-only',head])).split('\n').filter(Boolean);
  const changed=(await git(['status','--porcelain','--untracked-files=no'])).split('\n').filter(Boolean);
  if((await git(['rev-parse','HEAD'])).trim()!==head)throw new Error('Repository changed during discovery; retry');
  const observedAt=new Date().toISOString();
  const observation={schemaVersion:1,kind:'committed-repository-inventory',sourceCommit:head,observedAt,trackedFileCount:files.length,trackedFiles:files.slice(0,1000),inventoryTruncated:files.length>1000,trackedWorkingChanges:changed.slice(0,100),limitations:['Inventory only; source semantics, user needs, tenant capabilities and deployment feasibility require further discovery.','Uncommitted changes are not part of the pinned source.']};
  const bytes=JSON.stringify(observation,null,2),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const reference=path.join(evidenceRoot,`${hash}.json`);
  await atomicWrite(reference,bytes,()=>{guard();return true;});
  return {observation,evidence:{reference,sha256:hash,observedAt,expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()}};
}
