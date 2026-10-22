import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {SchemaBootstrap,executeSchemaBootstrap,sharepointHashBytes,bootstrapEvidenceSchema} from './schemaBootstrap.ts';
import {sharepointHash} from './sharepointProvisioning.ts';
import {readBoundedJson,readBoundedBytes} from './boundedJson.ts';
import {readPinnedBlob} from './pinnedPreparation.ts';
import {deliveryCommands} from './delivery.ts';
import {platformDiscoveryBinding} from './platformDiscovery.ts';
import {connectSharepointSchemaWriter} from './sharepointSchemaWriter.ts';
import {assertWriteTargetApproval} from './sharepointResourceApproval.ts';
import {assertDedicatedWriteTargets} from './sharepointWriteReadiness.ts';
import {sharepointPlan} from './sharepointProvisioning.ts';
import {schemaReconciliationSpec} from './sharepointReconciliation.ts';
import {schemaContinuationSpec} from './schemaContinuation.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import type {CapabilityConfig} from './capabilityChecks.ts';

const codeFiles=['deliveryRecords.ts','schemaContinuation.ts','sharepointReconciliation.ts','schemaBootstrap.ts','schemaBootstrapRuntime.ts','sharepointProvisioning.ts','sharepointHistory.ts','sharepointSchemaWriter.ts','sharepointRestAuth.ts','sharepointGraph.ts','sharepointResourceApproval.ts','sharepointWriteReadiness.ts','resourceLease.ts','deliveryRecordTools.ts','officeHttp.ts','index.ts'];
/** New projects need their own approvals, not replacement of another app's files.
 * An existing incomplete/invalid scoped directory never falls back to legacy. */
export function schemaBootstrapConfigurationRoot(home:string,repoId:string){
 const directory=path.join(home,'planning','project-configuration',sharepointHash(repoId));
 for(const current of [path.join(home,'planning'),path.dirname(directory),directory]){
  try{const stat=syncFs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||syncFs.realpathSync(current)!==path.resolve(current))throw Error('Unsafe project bootstrap configuration');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return home;throw error;}
 }
 return directory;
}
export async function bootstrapConfigurationHashes(root:string){
 return Promise.all(['graph-schema-writer.json','write-target-proposal.json','write-target-approval.json','schema-bootstrap-contract.json','resource-access-config.json'].map(async name=>{
  const file=path.join(root,name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(file)!==path.resolve(file))throw Error('Bootstrap configuration path differs');
  const bytes=await readBoundedBytes(file,16*1024);if(!bytes)throw Error('Bootstrap configuration absent or oversized');return[name,sharepointHashBytes(bytes)];
 }));
}
export function schemaBootstrapRuntime(context:{root:string;configurationRoot?:string;leaseRoot:string;repoId:string;checkoutPath:string;guard():void;record():DeliveryRecord;config():CapabilityConfig}){
 const configurationRoot=context.configurationRoot??context.root;
 const signal=AbortSignal.timeout(120000),guard=()=>{signal.throwIfAborted();context.guard();};
 // Cache only exact committed blobs inside this single bounded request. Mutable
 // authority/config/evidence/code is still rechecked on every authorization.
 const blobs=new Map<string,Promise<string>>();
 const committed=(commit:string,file:string)=>{guard();const key=commit+':'+file;let result=blobs.get(key);if(!result){result=readPinnedBlob(async args=>{guard();const out=await deliveryCommands.run({executable:'git',args},context.checkoutPath,{},signal);guard();return out;},commit,file);blobs.set(key,result);}return result;};
 const service=new SchemaBootstrap(context.root,async()=>{
  guard();const record=context.record(),config=context.config();
    const spec=z.strictObject({schemaVersion:z.literal(1),issue:z.number().int().positive(),evidence:bootstrapEvidenceSchema}).parse(await readBoundedJson(path.join(configurationRoot,'schema-bootstrap-contract.json'),16384));
  if(!record.content.sourceCommit)throw Error('Pinned schema source required');
  const blob=(file:string)=>committed(record.content.sourceCommit!,file);
  const plan=JSON.parse(await blob('cubefarm.sharepoint.json')),design=await blob('docs/delivery/SCHEMA-BOOTSTRAP.md');
  const hashes=await Promise.all(codeFiles.map(async file=>[file,sharepointHashBytes(await fs.readFile(fileURLToPath(new URL(file,import.meta.url))))]));
  const files=await bootstrapConfigurationHashes(configurationRoot);
  const rawReconciliation=await readBoundedJson(path.join(configurationRoot,'schema-bootstrap-reconciliation.json'),96*1024),reconciliation=rawReconciliation===undefined?undefined:schemaReconciliationSpec.parse(rawReconciliation);
  if(reconciliation){const original=await committed(reconciliation.originalSourceCommit,'cubefarm.sharepoint.json');if(sharepointHash(JSON.parse(original))!==sharepointHash(reconciliation.originalPlan))throw Error('Original reconciliation plan differs from pinned source');}
  const rawContinuation=await readBoundedJson(path.join(configurationRoot,'schema-bootstrap-continuation.json'),256*1024),continuation=rawContinuation===undefined?undefined:schemaContinuationSpec.parse(rawContinuation);
  if(reconciliation&&continuation)throw Error('Conflicting schema migration and continuation contracts');
  const parsed=sharepointPlan.parse(plan);await assertDedicatedWriteTargets(configurationRoot,context.repoId,parsed,guard);
  const operator=await assertWriteTargetApproval(configurationRoot,context.repoId,parsed,sharepointHash(parsed),guard,continuation?['continue-applied-schema','create-schema']:reconciliation?['reconcile-owned-schema','create-schema']:['create-schema']);await operator.owned();
  const writer=z.object({clientId:z.uuid(),subject:z.uuid(),tenantId:z.uuid(),username:z.email()}).parse(await readBoundedJson(path.join(configurationRoot,'graph-schema-writer.json'),16384));
  guard();return{record,issue:spec.issue,plan,design,historyScope:path.resolve(configurationRoot)===path.resolve(context.root)?'legacy-site' as const:'project' as const,codeSha256:sharepointHash(hashes),configurationSha256:sharepointHash({config,files}),configurationEvidence:{writer,operatorApproval:operator.approval,fileDigests:files},evidence:spec.evidence,reconciliation,continuation};
 });
 return {service,inspect:()=>service.view(guard),review:(input:unknown,actor:{id:string;role:string})=>service.review(input,actor,guard),execute:async(expected:string)=>executeSchemaBootstrap(service,expected,{root:context.root,configurationRoot,leaseRoot:context.leaseRoot,repoId:context.repoId,binding:platformDiscoveryBinding(context.config()),guard,connect:()=>connectSharepointSchemaWriter(configurationRoot,platformDiscoveryBinding(context.config()),context.checkoutPath,signal,guard)})};
}
