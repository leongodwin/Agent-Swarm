import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {nativeTreeProofSchema,type NativeTreeContext} from './nativeTree.ts';
import {readBoundedJson} from './boundedJson.ts';
import {isTrackedImportCommand,readTrackedImportCommand,trackedImportSchema,trackedImportCommand,verifyTrackedImport} from './trackedImport.ts';
import {isPinnedGitArgs,localPreparationSchema,type LocalPreparation} from './pinnedPreparationContracts.ts';
import {materializePinnedPreparation,verifyLocalPreparation} from './pinnedPreparation.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),leaseSha256:digest,commandSha256:digest,cwdSha256:digest,runId:z.string().min(1).max(1000).optional(),startedAt:z.iso.datetime(),recoveryEligible:z.boolean().optional(),readOnly:z.boolean().optional(),trackedImport:trackedImportSchema.optional(),localPreparation:localPreparationSchema.optional()});
const resultSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),intentSha256:digest,returnedAt:z.iso.datetime(),outcome:z.enum(['returned','rejected']),nativeTreeQuiescenceVerified:z.literal(false)});
const localProofSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),intentSha256:digest,scope:z.literal('runner-owned-local-files'),completedAt:z.iso.datetime(),planSha256:digest});
export function nativeRecoveryEligible(command:{executable:string;args:string[]}){
 const exe=path.basename(command.executable).toLowerCase().replace(/\.(exe|cmd)$/,''),args=command.args;
 if(exe==='az')return args.length===8&&args[0]==='account'&&args[1]==='get-access-token'&&args[2]==='--resource'&&(args[3]==='https://graph.microsoft.com'||/^https:\/\/[a-z0-9-]+[.]sharepoint[.]com$/.test(args[3]))&&args[4]==='--tenant'&&z.uuid().safeParse(args[5]).success&&args[6]==='--output'&&args[7]==='json';
 if(exe==='git')return isPinnedGitArgs(args)||args.length===2&&(args[0]==='rev-parse'&&/^(?:origin\/[^\s-][^\s]*|HEAD)$/.test(args[1])||args[0]==='show'&&/^[a-f0-9]{40,64}:[^\r\n]+$/.test(args[1]));
 if(exe==='gh')return args.length===7&&args[0]==='issue'&&args[1]==='view'&&/^[1-9]\d{0,8}$/.test(args[2])&&args[3]==='--repo'&&/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(args[4])&&args[5]==='--json'&&args[6]==='state';
 if(exe==='dataverse'){
  if(isTrackedImportCommand(command))return true;
  if(args.join(' ')==='auth who')return true;
  if(args[0]!=='api'||args[1]!=='request'||args.length!==10)return false;
  const flags=new Map<string,string>();for(let i=2;i<args.length;i+=2){if(!['--target','--environment','--method','--path'].includes(args[i])||flags.has(args[i]))return false;flags.set(args[i],args[i+1]);}
  return flags.get('--method')==='GET'&&flags.get('--target')==='dataverse'&&/^https:\/\//.test(flags.get('--environment')??'')&&/^\/api\/data\/v9\.2\//.test(flags.get('--path')??'');
 }
 return /^pac(?:\.launcher)?$/.test(exe)&&(args[0]==='solution'&&['list','import'].includes(args[1])||args.length===4&&args[0]==='org'&&args[1]==='who'&&args[2]==='--environment'&&/^https:\/\/[a-zA-Z0-9.-]+\/?$/.test(args[3]));
}
export function nativeReadOnly(command:{executable:string;args:string[]}){return nativeRecoveryEligible(command)&&!isTrackedImportCommand(command)&&!(/^pac(?:[.]launcher)?(?:[.]exe|[.]cmd)?$/i.test(path.basename(command.executable))&&command.args[0]==='solution'&&command.args[1]==='import');}
const hash=(bytes:string)=>crypto.createHash('sha256').update(bytes).digest('hex');
async function regularDirectory(directory:string){await fs.mkdir(directory,{recursive:true});if(!(await fs.lstat(directory)).isDirectory())throw new Error('Native journal must be a regular directory');}
async function durable(file:string,value:unknown){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}}

/** Persist intent before dispatch. A returned root is diagnostic evidence only:
 * it cannot certify descendant termination or authorize delivery takeover. */
export async function journalNativeCommand<T>(root:string,leaseSha256:string,command:{executable:string;args:string[]},cwd:string,runId:string|undefined,assertOwned:()=>Promise<void>,run:(context:NativeTreeContext)=>Promise<T>):Promise<T>{
  const parent=path.join(root,'delivery-native');await regularDirectory(parent);
  const directory=path.join(parent,digest.parse(leaseSha256));await regularDirectory(directory);
  const trackedImport=isTrackedImportCommand(command)?await readTrackedImportCommand(command):undefined;
  const intent=intentSchema.parse({schemaVersion:1,id:crypto.randomUUID(),leaseSha256,commandSha256:hash(JSON.stringify(command)),cwdSha256:hash(path.resolve(cwd)),...(runId?{runId}:{}),startedAt:new Date().toISOString(),recoveryEligible:nativeRecoveryEligible(command),readOnly:nativeReadOnly(command),...(trackedImport?{trackedImport}:{})});
  await durable(path.join(directory,`${intent.id}.intent.json`),intent);
  await assertOwned();
  let outcome:'returned'|'rejected'='rejected';
  try{const result=await run({id:intent.id,intentSha256:hash(JSON.stringify(intent)),proof:path.join(directory,`${intent.id}.tree.json`)});outcome='returned';return result;}
  finally{await durable(path.join(directory,`${intent.id}.result.json`),{schemaVersion:1,id:intent.id,intentSha256:hash(JSON.stringify(intent)),returnedAt:new Date().toISOString(),outcome,nativeTreeQuiescenceVerified:false});}
}

export async function initializeNativeEpoch(root:string,leaseSha256:string){const parent=path.join(root,'delivery-native');await regularDirectory(parent);const directory=path.join(parent,digest.parse(leaseSha256));await regularDirectory(directory);await durable(path.join(directory,'epoch.json'),{schemaVersion:1,leaseSha256,journalRequired:true});}

/** Closed runner-owned filesystem/ZIP work, not a callback that can execute a
 * script. Its receipt is explicitly not a Windows native-tree proof. */
export async function journalPinnedPreparation(root:string,leaseSha256:string,runId:string,plan:LocalPreparation,buffers:Map<string,Buffer>,assertOwned:()=>Promise<void>){
 localPreparationSchema.parse(plan);const directory=path.join(root,'delivery-native',digest.parse(leaseSha256));await regularDirectory(directory);
 const command={executable:'cubefarm-pinned-artifact-v1',args:[hash(JSON.stringify(plan))]};
 const intent=intentSchema.parse({schemaVersion:1,id:crypto.randomUUID(),leaseSha256,runId,commandSha256:hash(JSON.stringify(command)),cwdSha256:hash(plan.checkout),startedAt:new Date().toISOString(),recoveryEligible:true,localPreparation:plan});
 await durable(path.join(directory,intent.id+'.intent.json'),intent);await assertOwned();
 const inventory=await materializePinnedPreparation(plan,buffers);await assertOwned();
 await durable(path.join(directory,intent.id+'.local.json'),{schemaVersion:1,id:intent.id,intentSha256:hash(JSON.stringify(intent)),scope:'runner-owned-local-files',completedAt:new Date().toISOString(),planSha256:hash(JSON.stringify(plan))});
 await durable(path.join(directory,intent.id+'.result.json'),{schemaVersion:1,id:intent.id,intentSha256:hash(JSON.stringify(intent)),returnedAt:new Date().toISOString(),outcome:'returned',nativeTreeQuiescenceVerified:false});
 return inventory;
}

export async function inspectNativeCommands(root:string,leaseBytes:Buffer){return inspectNativeEpoch(root,hash(leaseBytes.toString('utf8')));}
/** Server-owned exact epoch lookup; never derive termination from PID liveness. */
export async function inspectNativeEpoch(root:string,leaseSha256:string){
  digest.parse(leaseSha256);
  const parent=path.join(root,'delivery-native');
  const parentStat=await fs.lstat(parent).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(parentStat&&!parentStat.isDirectory())throw new Error('Native journal parent is not a regular directory');
  const directory=path.join(parent,leaseSha256);
  const stat=await fs.lstat(directory).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(!stat)return {coverage:'legacy-or-missing' as const,commands:0,unresolved:0,nativeTreeQuiescenceVerified:false as const};
  if(!stat.isDirectory())throw new Error('Native journal is not a regular directory');
  const inventory=(await fs.readdir(directory)).sort();
  let completeEpoch=false;
  if(inventory.includes('epoch.json')){const file=path.join(directory,'epoch.json');if(!(await fs.lstat(file)).isFile())throw new Error('Nonregular native epoch');const epoch=z.strictObject({schemaVersion:z.literal(1),leaseSha256:digest,journalRequired:z.literal(true)}).parse(await readBoundedJson(file,16384));if(epoch.leaseSha256!==leaseSha256)throw new Error('Native epoch ownership mismatch');completeEpoch=true;}
  const names=inventory.filter(name=>name!=='epoch.json');if(names.length>20000)throw new Error('Native journal exceeds inspection bound');
  const fingerprints:string[]=[];
  const proofs=new Map<string,z.infer<typeof nativeTreeProofSchema>>();
  const localProofs=new Map<string,z.infer<typeof localProofSchema>>();
  const intents=new Map<string,z.infer<typeof intentSchema>>(),results=new Map<string,z.infer<typeof resultSchema>>();
  for(const name of names){
    if(!/^[a-f0-9-]{36}\.(intent|result|tree|local)\.json$/.test(name))throw new Error('Unknown native journal entry');
    const file=path.join(directory,name);if(!(await fs.lstat(file)).isFile())throw new Error('Nonregular native journal entry');
    const raw=await readBoundedJson(file,16384);fingerprints.push(hash(JSON.stringify(raw)));
    if(name.endsWith('.intent.json')){const intent=intentSchema.parse(raw);if(name!==`${intent.id}.intent.json`||intent.leaseSha256!==leaseSha256)throw new Error('Native intent ownership mismatch');if(intent.trackedImport){await verifyTrackedImport(intent.trackedImport);if(hash(JSON.stringify(trackedImportCommand(intent.trackedImport)))!==intent.commandSha256)throw new Error('Native tracked import command mismatch');}intents.set(intent.id,intent);}
    else if(name.endsWith('.tree.json')){const proof=nativeTreeProofSchema.parse(raw);if(name!==`${proof.id}.tree.json`)throw new Error('Native tree proof identity mismatch');proofs.set(proof.id,proof);}
    else if(name.endsWith('.local.json')){const proof=localProofSchema.parse(raw);if(name!==`${proof.id}.local.json`)throw new Error('Local preparation proof identity mismatch');localProofs.set(proof.id,proof);}
    else{const result=resultSchema.parse(raw);if(name!==`${result.id}.result.json`)throw new Error('Native result identity mismatch');results.set(result.id,result);}
  }
  for(const proof of proofs.values()){const intent=intents.get(proof.id);if(!intent||proof.intentSha256!==hash(JSON.stringify(intent)))throw new Error('Native tree proof ownership mismatch');}
  for(const proof of localProofs.values()){const intent=intents.get(proof.id);if(!intent?.localPreparation||proof.intentSha256!==hash(JSON.stringify(intent))||proof.planSha256!==hash(JSON.stringify(intent.localPreparation))||proof.completedAt<intent.startedAt||intent.commandSha256!==hash(JSON.stringify({executable:'cubefarm-pinned-artifact-v1',args:[proof.planSha256]})))throw new Error('Local preparation proof ownership mismatch');await verifyLocalPreparation(intent.localPreparation);}
  for(const result of results.values()){const intent=intents.get(result.id);if(!intent||result.intentSha256!==hash(JSON.stringify(intent))||result.returnedAt<intent.startedAt)throw new Error('Unattributable native command result');}
  return {commandBindings:[...intents.values()].map(intent=>({runId:intent.runId,readOnly:intent.readOnly===true,commandSha256:intent.commandSha256,...(intent.localPreparation?{localPreparation:intent.localPreparation}:{})})),journalSha256:hash(JSON.stringify([completeEpoch,inventory,fingerprints])),coverage:'intent-observations-only' as const,commands:intents.size,unresolved:intents.size-results.size,completeEpoch,nativeTreeQuiescenceVerified:completeEpoch&&intents.size>0&&proofs.size+localProofs.size===intents.size&&[...intents.values()].every(intent=>intent.recoveryEligible===true&&(intent.localPreparation?localProofs.has(intent.id)&&!proofs.has(intent.id):proofs.has(intent.id)&&!localProofs.has(intent.id)))};
}
