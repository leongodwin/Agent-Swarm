import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {WorkerPreflight} from './workerPreflight.ts';

/** Producer-owned receipt. No caller-supplied observations or authority claims. */
export async function retainWorkerPreflightReceipt(home:string,context:{repoId:string;agentId:string;runtime:string;attemptId:string;taskKey:string;sourceRevision:string|null},status:ReturnType<WorkerPreflight['inspection']>,guard:()=>Promise<void>){
  await guard();
  if(!/^[\w.-]+\/[\w.-]+$/.test(context.repoId)||!context.taskKey.startsWith(context.repoId+':'))throw Error('Invalid task binding');
  const observedAt=new Date().toISOString(),expiry=status.nativeChecksSatisfied?Math.min(...status.probes.map(p=>Date.parse(p.expiresAt!))):Date.now()+60_000;
  if(!Number.isFinite(expiry)||expiry<=Date.now())throw Error('Expired preflight');
  const observation={schemaVersion:1,scope:'worker-session-preflight',...context,observedAt,expiresAt:new Date(expiry).toISOString(),preflight:status};
  const bytes=Buffer.from(JSON.stringify(observation)+'\n');if(bytes.length>65536)throw Error('Oversized receipt');
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),directory=path.join(home,'planning','evidence');
  // No asynchronous boundary between path validation and exclusive creation.
  // Validate parents before creating children so redirects cannot create stores elsewhere.
  const checkedDirectory=(file:string)=>{const stat=fs.lstatSync(file);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file))throw Error('Unsafe evidence directory');};
  const ensureDirectory=(file:string)=>{if(!fs.existsSync(file))fs.mkdirSync(file);checkedDirectory(file);};
  const reference=path.join(directory,sha256+'.json');await guard();
  checkedDirectory(home);ensureDirectory(path.join(home,'planning'));ensureDirectory(directory);
  try{const fd=fs.openSync(reference,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(reference);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==bytes.length||fs.realpathSync(reference)!==reference||!fs.readFileSync(reference).equals(bytes))throw Error('Receipt collision or unsafe file');
  await guard();
  checkedDirectory(home);checkedDirectory(path.join(home,'planning'));checkedDirectory(directory);
  if(fs.realpathSync(reference)!==reference||!fs.readFileSync(reference).equals(bytes))throw Error('Receipt changed');
  return {observation,evidence:{reference,sha256,observedAt,expiresAt:observation.expiresAt}};
}
