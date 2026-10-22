// Single-command adapter for bounded Python-orchestrated live verification. No auth
// implementation or fixture substitution: dispatch exactly the journaled CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stablePackageDigest} from '../server/deliveryPackage.ts';
import {z} from 'zod';
import {acquireDeliveryLease} from '../server/deliveryLease.ts';
import {journalNativeCommand,inspectNativeCommands,nativeRecoveryEligible} from '../server/nativeCommandJournal.ts';
import {runNativeTree} from '../server/nativeTree.ts';
import {resolveTenancyCommand} from '../server/tenancy.ts';
import {pacReportedError} from '../server/delivery.ts';
const hash=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const raw=await fs.readFile(process.argv[2],'utf8');
const request=z.strictObject({root:z.string(),runId:z.uuid(),id:z.uuid(),environmentUrl:z.url(),importApproval:z.strictObject({packageSha256:z.string().regex(/^[a-f0-9]{64}$/),solutionUniqueName:z.literal('CubeFarmResumeProbe')}).optional(),command:z.strictObject({executable:z.enum(['pac','dataverse']),args:z.array(z.string()).max(20)})}).parse(JSON.parse(raw));
const {root,command}=request;
if(!path.isAbsolute(root)||!nativeRecoveryEligible(command))throw new Error('Unsupported live probe identity or command');
if(command.executable==='dataverse'&&command.args.includes('POST'))throw new Error('This probe does not authorize Dataverse writes');
if(command.executable==='pac'&&(command.args[0]!=='solution'||command.args[1]!=='list')){
 const expected=['solution','import','--path',command.args[3],'--environment','https://org68dad46d.crm4.dynamics.com'];
 if(!request.importApproval||JSON.stringify(command.args)!==JSON.stringify(expected)||request.environmentUrl!==expected[5]||!path.isAbsolute(command.args[3])||await stablePackageDigest(command.args[3])!==request.importApproval.packageSha256)throw new Error('Live import requires the approved target and exact probe package hash');
 await promisify(execFile)('python',[path.resolve('scripts/validate-empty-probe.py'),command.args[3],request.importApproval.packageSha256],{timeout:10000,windowsHide:true});
}
if(command.args.includes('--environment')&&command.args[command.args.indexOf('--environment')+1]!==request.environmentUrl)throw new Error('Probe target differs from declared environment');
await fs.mkdir(root,{recursive:true});
const lease=await acquireDeliveryLease(root),leaseBytes=await fs.readFile(path.join(root,'delivery.lock'));
await fs.writeFile(path.join(root,request.id+'.lease.json'),leaseBytes,{flag:'wx'});
const resolved=resolveTenancyCommand(command.executable),startedAt=new Date().toISOString();
let outcome='rejected',output='',failure='';
try{
 if(request.importApproval&&await stablePackageDigest(command.args[3])!==request.importApproval.packageSha256)throw new Error('Probe changed at import boundary');
 output=await journalNativeCommand(root,lease.identitySha256,command,process.cwd(),request.runId,()=>lease.assertOwned(),context=>runNativeTree(resolved.file,[...resolved.args,...command.args],process.cwd(),{},new AbortController().signal,context));
 if(pacReportedError(command.executable,output))throw new Error('PAC reported a provider error despite successful process exit');
 outcome='returned';
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
 const outputFile=path.join(root,request.id+'.response.txt');await fs.writeFile(outputFile,output||failure,{flag:'wx'});
 const inspection=await inspectNativeCommands(root,leaseBytes);
 await fs.writeFile(path.join(root,request.id+'.result.json'),JSON.stringify({scope:request.importApproval?'authenticated-disposable-solution-import':'authenticated-read-only-native-probe',id:request.id,runId:request.runId,startedAt,endedAt:new Date().toISOString(),environmentUrl:request.environmentUrl,commandSha256:hash(JSON.stringify(command)),resolvedExecutable:resolved.file,dispatchSha256:hash(JSON.stringify({file:resolved.file,args:[...resolved.args,...command.args]})),outcome,responseSha256:hash(output||failure),native:inspection}),{flag:'wx'});
 await lease.release();
}
