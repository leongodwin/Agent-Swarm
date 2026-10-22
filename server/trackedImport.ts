import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {stablePackageDigest} from './deliveryPackage.ts';
import {identityRoot} from './identityContracts.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import type {DeliveryRun} from '../shared/delivery.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const trackedImportSchema=z.strictObject({transport:z.literal('dataverse-importsolution-v1'),environmentUrl:z.string(),platformJobId:z.uuid(),requestFile:z.string(),requestSha256:digest,packageSha256:digest});
export type TrackedImport=z.infer<typeof trackedImportSchema>;
const sha=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
export function trackedImportCommand(value:TrackedImport){return {executable:'dataverse',args:['api','request','--target','dataverse','--environment',value.environmentUrl,'--method','POST','--path','/api/data/v9.2/ImportSolution','--body-file',value.requestFile]};}
export function isTrackedImportCommand(command:{executable:string;args:string[]}){
 const a=command.args;
 return command.executable==='dataverse'&&a.length===12&&a[0]==='api'&&a[1]==='request'&&a[2]==='--target'&&a[3]==='dataverse'&&a[4]==='--environment'&&a[6]==='--method'&&a[7]==='POST'&&a[8]==='--path'&&a[9]==='/api/data/v9.2/ImportSolution'&&a[10]==='--body-file'&&path.isAbsolute(a[11])&&/^tracked-import-[a-f0-9-]{36}-[a-f0-9]{64}\.json$/.test(path.basename(a[11]));
}
export async function verifyTrackedImport(value:TrackedImport){
 trackedImportSchema.parse(value);identityRoot(value.environmentUrl);
 if(!path.isAbsolute(value.requestFile)||path.basename(value.requestFile)!==`tracked-import-${value.platformJobId}-${value.requestSha256}.json`)throw new Error('Tracked import path binding differs');
 const stat=await fs.lstat(value.requestFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Tracked import request is not a bounded regular file');
 const bytes=await fs.readFile(value.requestFile);if(sha(bytes)!==value.requestSha256)throw new Error('Tracked import request changed');
 const body=z.strictObject({ImportJobId:z.uuid(),CustomizationFile:z.string().min(1),OverwriteUnmanagedCustomizations:z.literal(false),PublishWorkflows:z.literal(false)}).parse(parseUnambiguousJson(bytes.toString('utf8'),{maxBytes:64*1024*1024}));
 const file=Buffer.from(body.CustomizationFile,'base64');
 if(body.ImportJobId!==value.platformJobId||file.length===0||file.length>47*1024*1024||file.toString('base64')!==body.CustomizationFile||sha(file)!==value.packageSha256)throw new Error('Tracked import job/package binding differs');
 return value;
}
export async function readTrackedImportCommand(command:{executable:string;args:string[]}){
 if(!isTrackedImportCommand(command))throw new Error('Unsupported tracked import command');
 const match=/^tracked-import-([a-f0-9-]{36})-([a-f0-9]{64})\.json$/.exec(path.basename(command.args[11]))!;
 // Read only to discover the embedded package digest; verification below checks
 // the named full-body digest before accepting this value or issuing a request.
 const file=command.args[11],stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Invalid tracked import body');
 const bytes=await fs.readFile(file);if(sha(bytes)!==match[2])throw new Error('Tracked import request changed');
 const body=parseUnambiguousJson(bytes.toString('utf8'),{maxBytes:64*1024*1024}) as {CustomizationFile:string};
 return verifyTrackedImport({transport:'dataverse-importsolution-v1',environmentUrl:command.args[5],platformJobId:match[1],requestFile:file,requestSha256:match[2],packageSha256:sha(Buffer.from(body.CustomizationFile,'base64'))});
}
export async function prepareTrackedImport(packageFile:string,evidence:string,environmentUrl:string,expectedPackageSha256:string,signal?:AbortSignal){
 identityRoot(environmentUrl);signal?.throwIfAborted();
 if(await stablePackageDigest(packageFile,signal)!==expectedPackageSha256)throw new Error('Tracked import package differs from approved digest');
 const bytes=await fs.readFile(packageFile);if(sha(bytes)!==expectedPackageSha256)throw new Error('Tracked import package changed');
 if(bytes.length>47*1024*1024)throw new Error('Tracked import package exceeds its 47 MiB request limit');
 const platformJobId=crypto.randomUUID(),body=JSON.stringify({ImportJobId:platformJobId,CustomizationFile:bytes.toString('base64'),OverwriteUnmanagedCustomizations:false,PublishWorkflows:false});
 const requestSha256=sha(body),requestFile=path.join(path.resolve(evidence),`tracked-import-${platformJobId}-${requestSha256}.json`);
 await fs.mkdir(evidence,{recursive:true});const handle=await fs.open(requestFile,'wx',0o600);try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
 const value:TrackedImport={transport:'dataverse-importsolution-v1',environmentUrl,platformJobId,requestFile,requestSha256,packageSha256:expectedPackageSha256};
 await verifyTrackedImport(value);return value;
}
/** Crash durability for the state snapshot containing the preallocated job ID.
 * No native provider dispatch is allowed until this barrier and ownership pass. */
export async function flushImportState(file:string,assertOwned:()=>Promise<void>){
 await assertOwned();const handle=await fs.open(file,'r+');try{await handle.sync();}finally{await handle.close();}await assertOwned();
}
export async function recordTrackedImportIntent(run:DeliveryRun,tracked:TrackedImport,stateFile:string,save:()=>Promise<void>,assertOwned:()=>Promise<void>){
 await assertOwned();await verifyTrackedImport(tracked);
 if(run.environmentUrl!==tracked.environmentUrl||run.recovery?.packageSha256!==tracked.packageSha256||run.operations?.some(item=>item.id==='solution-import'))throw new Error('Tracked import differs from run or already has an outcome; never replay');
 const operation:NonNullable<DeliveryRun['operations']>[number]={id:'solution-import',kind:'import',status:'intent',commandSha256:sha(JSON.stringify(trackedImportCommand(tracked))),startedAt:new Date().toISOString(),platformJobId:tracked.platformJobId,trackedImport:tracked};
 run.checkpoint='import-started';(run.operations??=[]).push(operation);
 await save();await flushImportState(stateFile,assertOwned);return operation;
}
