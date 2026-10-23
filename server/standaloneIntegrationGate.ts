import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {verifyStandaloneBuildIdentity} from './standaloneBuildIdentity.ts';

const exec=promisify(execFile),sha=z.string().regex(/^[a-f0-9]{40}$/);
const repository='leongodwin/Agent-Swarm';
export const standaloneRequiredChecks=['check (ubuntu-latest)','check (windows-latest)','check (macos-latest)','backend branch coverage','e2e (shard 1/3)','e2e (shard 2/3)','e2e (shard 3/3)'] as const;
/** Strict verifier shared with offline tests; input never comes from a caller's
 * configuration file or approval. Production reads authenticated GitHub below. */
export function verifyStandaloneIntegration(head:string,remote:unknown,checks:unknown){
 sha.parse(head);
 const ref=z.object({ref:z.literal('refs/heads/main'),object:z.object({type:z.literal('commit'),sha})}).parse(remote);
 if(ref.object.sha!==head)throw Error('Standalone execution requires the running source on current main');
 const result=z.object({total_count:z.number().int().min(7).max(100),check_runs:z.array(z.object({id:z.number().int().positive(),name:z.string(),head_sha:sha,status:z.literal('completed'),conclusion:z.literal('success'),app:z.object({slug:z.literal('github-actions')}),details_url:z.string().url()})).max(100)}).parse(checks);
 if(result.total_count!==result.check_runs.length||new Set(result.check_runs.map(c=>c.id)).size!==result.check_runs.length||result.check_runs.some(c=>c.head_sha!==head||new URL(c.details_url).hostname!=='github.com'||!c.details_url.startsWith('https://github.com/'+repository+'/actions/runs/')))throw Error('Incomplete or foreign exact-main checks');
 for(const name of standaloneRequiredChecks)if(result.check_runs.filter(c=>c.name===name).length!==1)throw Error('Every exact-main required check must pass');
 return{repository,main:head,checks:result.check_runs.map(({id,name})=>({id,name})),observedAt:new Date().toISOString()};
}

/** Normal-host admission, with no operator-authored CI receipt. Reads only the
 * fixed source repository, current main and exact-commit GitHub Actions checks.
 * Credentials use existing GitHub CLI authentication and are never logged. */
export function standaloneIntegrationGate(){
 const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
 let cached:ReturnType<typeof verifyStandaloneIntegration>|undefined;
 const local=async(args:string[])=>{try{return(await exec('git',args,{cwd:root,windowsHide:true,timeout:10000,maxBuffer:256000})).stdout.trim();}catch{throw Error('Standalone source integration evidence unavailable');}};
 return async()=>{
  const head=sha.parse(await local(['rev-parse','HEAD'])),origin=await local(['remote','get-url','origin']);
  if(!['https://github.com/'+repository+'.git','https://github.com/'+repository,'git@github.com:'+repository+'.git'].includes(origin)||await local(['status','--porcelain','--untracked-files=normal']))throw Error('Clean fixed source checkout required for standalone execution');
  verifyStandaloneBuildIdentity(head);
  if(cached?.main===head&&Date.now()-Date.parse(cached.observedAt)<30000)return cached;
  let token:string;try{token=(await exec('gh',['auth','token','--hostname','github.com'],{cwd:root,windowsHide:true,timeout:10000,maxBuffer:64000})).stdout.trim();}catch{throw Error('Existing GitHub authentication required for integration admission');}
  if(!token||/[\r\n]/.test(token))throw Error('Existing GitHub authentication unavailable');
  const read=async(suffix:string)=>{
   try{const response=await fetch('https://api.github.com/repos/'+repository+suffix,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const text=await response.text();if(Buffer.byteLength(text)>256000)throw Error();return JSON.parse(text) as unknown;}catch{throw Error('Fresh authenticated main/CI evidence unavailable');}
  };
  const remote=await read('/git/ref/heads/main'),checks=await read('/commits/'+head+'/check-runs?filter=latest&per_page=100');
  if(await local(['rev-parse','HEAD'])!==head||await local(['status','--porcelain','--untracked-files=normal']))throw Error('Source changed during integration admission');
  cached=verifyStandaloneIntegration(head,remote,checks);return cached;
 };
}
