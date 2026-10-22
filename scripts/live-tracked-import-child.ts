/** Thin live adapter around production identity, intent persistence and native
 * dispatch. Python owns timing, interruption and remote observations. The local
 * release metadata is an explicit integration contract, not a pipeline release. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {z} from 'zod';
import {acquireDeliveryLease} from '../server/deliveryLease.ts';
import {acquireResourceLease} from '../server/resourceLease.ts';
import {journalNativeCommand} from '../server/nativeCommandJournal.ts';
import {runNativeTree} from '../server/nativeTree.ts';
import {resolveTenancyCommand} from '../server/tenancy.ts';
import {verifyDataverseIdentity} from '../server/dataverseIdentity.ts';
import {retainedTargetSchema} from '../server/retainedCloudRecovery.ts';
import {prepareTrackedImport,recordTrackedImportIntent,trackedImportCommand,verifyTrackedImport} from '../server/trackedImport.ts';
import {atomicWrite} from '../server/atomicFile.ts';
import {validateDeliveryState,type DeliveryStoredState} from '../server/deliveryState.ts';
import type {DeliveryRun,DeliveryRelease} from '../shared/delivery.ts';
import {releasePlanSchema} from '../server/releasePlan.ts';
const input=z.strictObject({root:z.string(),packageFile:z.string(),packageSha256:z.string().regex(/^[a-f0-9]{64}$/),target:retainedTargetSchema,head:z.string().regex(/^[a-f0-9]{40}$/)}).parse(JSON.parse(await fs.readFile(process.argv[2],'utf8')));
if(!path.isAbsolute(input.root)||input.target.environmentUrl!=='https://org68dad46d.crm4.dynamics.com')throw new Error('Only approved Development target and owned absolute root are permitted');
await promisify(execFile)('python',[path.resolve('scripts/validate-empty-probe.py'),input.packageFile,input.packageSha256],{timeout:10000,windowsHide:true});
await fs.mkdir(input.root,{recursive:true});const lease=await acquireDeliveryLease(input.root),runId=crypto.randomUUID(),signal=new AbortController().signal;
const resources=path.join(input.root,'resource-leases'),targetLease=await acquireResourceLease(resources,'deployment:'+input.target.environmentUrl,runId,{reclaimDeadOwner:false});
const assertOwned=async()=>{await lease.assertOwned();await targetLease.assertOwned();};
const command=async(executable:string,args:string[])=>{await assertOwned();const native=resolveTenancyCommand(executable);return journalNativeCommand(input.root,lease.identitySha256,{executable,args},process.cwd(),runId,assertOwned,context=>runNativeTree(native.file,[...native.args,...args],process.cwd(),{},signal,{...context,errorOutput:path.join(input.root,context.id+'.provider-error.json')}));};
const request=async(_method:string,resource:string)=>JSON.parse(await command('dataverse',['api','request','--target','dataverse','--environment',input.target.environmentUrl,'--method','GET','--path','/api/data/v9.2/'+resource]));
const identityReceipt=await verifyDataverseIdentity(command,request,input.target.environmentUrl,input.target.binding,input.target.identity);
await atomicWrite(path.join(input.root,'identity-receipt.json'),JSON.stringify(identityReceipt));
const now=new Date().toISOString(),environmentUrl=input.target.environmentUrl;
const plan=releasePlanSchema.parse({acceptanceProfile:'functional-development',name:'Authorized empty probe recovery integration contract',owner:'probe-operator',qaOwner:'independent-probe-qa',requiredIssues:[1],components:['Empty probe only'],acceptanceCriteria:['Native caller crash preserves exact cloud request attribution'],quality:{maxTaskDurationMs:60000,maxSeriousAccessibilityIssues:0},monitoring:{intervalMinutes:5,criticalProbeIds:['identity']},verification:{baseUrl:environmentUrl,identities:[],scenarios:[],api:{binding:input.target.binding,checks:['journey','authorization','persistence','error-handling'].map(category=>({name:'Integration read '+category,criterion:0,category,resource:'WhoAmI',assertions:[{pointer:['OrganizationId'],equals:input.target.binding.organizationId}]}))}}});
const release:DeliveryRelease={id:crypto.randomUUID(),repoId:'integration/CubeFarmResumeProbe',head:input.head,environmentUrl,plan,planHash:crypto.createHash('sha256').update(JSON.stringify({plan,head:input.head,environmentUrl})).digest('hex'),createdAt:now,approvedAt:now,approvedBy:plan.qaOwner};
await atomicWrite(path.join(input.root,'harness-contract.json'),JSON.stringify({scope:'user-authorized-empty-probe-integration-only',constructedReleaseMetadata:true,normalPipelineRelease:false,approvalMeaning:'Previously user-authorized disposable probe and independently reviewed harness scope; not app/release QA approval',sourceWorkingTreeMayBeDirty:true,packageSha256:input.packageSha256}));
const run:DeliveryRun={id:runId,repoId:release.repoId,releaseId:release.id,head:input.head,environmentUrl,phase:'deploying',startedAt:now,appUrls:[],evidence:[],log:[],solution:'CubeFarmResumeProbe',checkpoint:'prepared',nativeLeaseSha256:lease.identitySha256,recovery:{inventoryFile:'integration-inventory.json',runbook:'integration-runbook.md',drillReport:'integration-only.json',packageSha256:input.packageSha256}};
const state:DeliveryStoredState={schemaVersion:1,policy:{enabled:true,environmentUrl,approvedAt:now},runs:[run],releases:[release],blockers:[],revision:1};
const stateFile=path.join(input.root,'delivery.json'),save=async()=>{validateDeliveryState(state);await atomicWrite(stateFile,JSON.stringify(state));};
const tracked=await prepareTrackedImport(input.packageFile,path.join(input.root,'delivery-runs',runId,'evidence'),environmentUrl,input.packageSha256,signal);
await recordTrackedImportIntent(run,tracked,stateFile,save,assertOwned);
await atomicWrite(path.join(input.root,'ready.json'),JSON.stringify({runId,platformJobId:tracked.platformJobId,command:trackedImportCommand(tracked),statePersistedBeforeDispatch:true}));
await verifyTrackedImport(tracked);const native=trackedImportCommand(tracked);
try{const output=await command(native.executable,native.args);await atomicWrite(path.join(input.root,'native-return.json'),JSON.stringify({returned:true,outputSha256:crypto.createHash('sha256').update(output).digest('hex')}));}catch(error){await atomicWrite(path.join(input.root,'native-error.json'),JSON.stringify({message:error instanceof Error?error.message:String(error),outcome:'unknown-no-replay'}));throw error;}
// Preserve both leases and the pre-dispatch checkpoint for explicit read-only
// reconciliation. No inferred completion or deployment approval is recorded.
