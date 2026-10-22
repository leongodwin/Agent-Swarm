import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {workerPreflightSchema,WorkerPreflight} from './workerPreflight.ts';
import {discoverSkills,pinSkillGuidance,type SkillCatalogue} from './skillRegistry.ts';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

/** Operator publication after independent review of exact bytes and real native
 * contracts. This is not a cryptographic QA approval or a readiness observation. */
export async function installWorkerPreflight(checkout:string,content:string,reviewedSha256:string,options:{catalogue?:()=>SkillCatalogue;guard?:()=>void}={}){
 const guard=options.guard??(()=>{}),catalogue=options.catalogue??discoverSkills;
 guard();const sha256=crypto.createHash('sha256').update(content).digest('hex');
 if(!/^[a-f0-9]{64}$/.test(reviewedSha256)||reviewedSha256!==sha256)throw new Error('Worker contract differs from independently reviewed bytes');
 if(Buffer.byteLength(content)>32768)throw new Error('Worker contract exceeds32KiB');
 const plan=workerPreflightSchema.parse(parseUnambiguousJson(content,{maxBytes:32768,maxDepth:32,maxSyntaxTokens:10000}));
 const guidance=pinSkillGuidance(plan.skills,catalogue);const verify=()=>{guard();const error=guidance();if(error)throw new Error(error);};verify();
 const root=path.resolve(checkout),rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await fs.realpath(root)!==root)throw new Error('Worker checkout must be an existing canonical directory');
 const directory=path.join(root,'.cubefarm'),file=path.join(directory,'worker-preflight.json');
 await fs.mkdir(directory).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const check=async()=>{verify();const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('Worker contract directory must not be linked');};
 await check();
 // Hard-link publication is atomic and never overwrites an existing target.
 // Both names are in the same checked directory on the same filesystem.
 let publishedIdentity:{ino:bigint;dev:bigint}|undefined;
 const verifyPublished=async()=>{await check();const stat=await fs.lstat(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.ino!==publishedIdentity?.ino||stat.dev!==publishedIdentity.dev)throw new Error('Published worker contract identity changed; retain and inspect');const bytes=await readBoundedBytes(file,32768);if(!bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==sha256)throw new Error('Published worker contract bytes changed; retain and inspect');await check();};
 const temporary=path.join(directory,`.worker-preflight-${crypto.randomUUID()}.tmp`);
 try{
  const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(content);await handle.sync();publishedIdentity=await handle.stat({bigint:true});}finally{await handle.close();}
  await check();await fs.link(temporary,file);
  try{await verifyPublished();}catch(error){throw new Error('Worker contract was published but final authority verification failed; retain and inspect the installed file before retry: '+(error instanceof Error?error.message:'authority unavailable'));}
 }finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 // This does not run/seed probes; every actual session starts without readings.
 const gate=new WorkerPreflight(root,catalogue,undefined,'codex',plan.mode);const invalid=gate.configurationBlocker();if(invalid)throw new Error('Worker contract was published but final configuration verification failed; retain and inspect: '+invalid);
 await verifyPublished();
 return {file,sha256,scope:plan.scope,installed:true,readiness:'requires-fresh-worker-observations',limits:['Reviewed hash is an operator publication check, not proof of independent reviewer identity','No platform, task, runtime or release approval is granted']};
}
