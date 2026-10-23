import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {StandaloneProbeReview,standaloneProbeControlsSchema,standaloneProbeReviewRequest} from './standaloneProbeReview.ts';
import {connectorProbeDigest} from './connectorMetadataProbe.ts';
import {standaloneProbePlanSchema} from './standaloneMetadataProbe.ts';
import {verifyStandaloneQuarantine} from './standaloneProbeQuarantine.ts';
import {inspectStandaloneProbeAdapter,connectStandaloneProbeAdapter} from './standaloneProbeAdapter.ts';
import {standaloneHostReviewSources} from './standaloneHostReview.ts';
import {standaloneNativeReviewSources} from './standaloneNativeReview.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {executeStandaloneProbe} from './standaloneProbeExecution.ts';
import {prepareStandaloneProbeResources,inspectStandaloneProbeResource} from './standaloneProbeResources.ts';
import {type FlowAdapter} from './flowAdapter.ts';
import {privateReportMetadata} from './privateReportMetadata.ts';
import {deliveryCommands} from './delivery.ts';
import {verifyTenantSnapshot} from './tenantDlp.ts';
import {evaluateStandardPolicies} from './standardPolicy.ts';
import {standaloneIntegrationGate} from './standaloneIntegrationGate.ts';
import type {PlatformIdentity} from './platformAuth.ts';

const sourceGroups=[
 ['server/standaloneMetadataProbe.ts','server/connectorMetadataProbe.ts','shared/standaloneProbeScope.ts','shared/connectorProbeScope.ts'],
 ['server/standaloneProbeReview.ts','server/standaloneProbeRuntime.ts','server/standaloneProbeQuarantine.ts','server/standaloneHostReview.ts','server/standaloneNativeReview.ts'],
 ['server/standaloneProbeExecution.ts','server/standaloneProbeResources.ts','server/standaloneFlowOwnership.ts'],
 ['server/standaloneProbeAdapter.ts','server/standaloneFlowAgentBuild.ts','server/flowAdapter.ts'],
 ['server/privateReportMetadata.ts','server/platformAuth.ts','server/dataverseIdentity.ts','server/resourceLease.ts'],
 ['server/tenantDlp.ts','server/standardPolicy.ts','server/standaloneIntegrationGate.ts','server/standaloneBuildIdentity.ts','scripts/build-server.mjs'],
 ['server/flowCleanup.ts','server/flowEnvironment.ts','server/pinnedPreparationContracts.ts','server/tenancy.ts','server/clis.ts','server/platformCommandError.ts','server/unambiguousJson.ts','server/boundedJson.ts','server/config.ts','server/atomicFile.ts'],
];
const configuration=z.strictObject({schemaVersion:z.literal(1),plan:standaloneProbePlanSchema,controls:standaloneProbeControlsSchema});
const sha=(bytes:string|Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Normal-host composition. Execution requires fresh exact independent probe
 * approval. Configuration supplies neither code nor an arbitrary definition. */
export function standaloneProbeRuntime(context:{home:string;configurationRoot:string;cwd?:string;leaseRoot?:string;policyObservation?:(identity:PlatformIdentity)=>unknown;record():DeliveryRecord;configurationFingerprint():string;guard():void}){
 const guard=context.guard;
 const integrated=standaloneIntegrationGate();
 const service=new StandaloneProbeReview(context.home,async()=>{
  guard();const file=path.join(context.configurationRoot,'standalone-probe-contract.json'),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Canonical connector probe configuration required');
  const bytes=await readBoundedBytes(file,32768);if(!bytes)throw Error('Bounded connector probe configuration required');
  const input=configuration.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),{maxBytes:32768}));
  const readSource=async(name:string)=>{const file=fileURLToPath(new URL('../'+name,import.meta.url)),bytes=await readBoundedBytes(file,128*1024);if(!bytes)throw Error('Pinned connector probe implementation absent');return{file:name,sha256:sha(bytes),text:new TextDecoder('utf8',{fatal:true}).decode(bytes)};};
  const implementationSources=await Promise.all(sourceGroups.map(async(group,index)=>{
   const entries=await Promise.all(group.map(readSource));if(entries.length===1)return entries[0];
   const text='# Complete exact standalone source capsule\n\nEvery entry retains its complete original UTF8 source and SHA256. Read all entries; this logical key is not a physical Markdown file.\n\n'+JSON.stringify({schemaVersion:1,sources:entries});
   return {file:`docs/STANDALONE-PROBE-SOURCES-${index+1}.md`,sha256:sha(text),text};
  }));
  implementationSources.push(await standaloneHostReviewSources());
  implementationSources.push(...await standaloneNativeReviewSources(context.home,input.plan.adapter.entrySha256));
  await verifyStandaloneQuarantine(input.plan,context.home,context.record().repoId);
  await inspectStandaloneProbeAdapter(context.home,input.plan.adapter.entrySha256);
  const identity={tenantId:input.plan.identity.tenantId,caller:input.plan.identity.username},rawPolicy=context.policyObservation?.(input.plan.identity),policy=rawPolicy===undefined?null:verifyTenantSnapshot(rawPolicy,identity),evaluation=policy?evaluateStandardPolicies(policy,identity,input.plan.identity.environmentId,[{id:'digest-flow',complete:true,connectors:['shared_office365']}]):null;
  if(context.policyObservation&&!policy)throw Error('Current live standard policy required');
  if(evaluation&&evaluation.status!=='clear')throw Error('Current standard policy does not admit the fixed probe');
  // Approval binds the exact evaluated policy content. Authentic rereads of
  // unchanged content may refresh the live 15-minute observation, never its
  // original documentary receipt or review expiry. Every authority check
  // re-runs the existing freshness, identity and classification checks.
  const configurationSha256=connectorProbeDigest({contractSha256:sha(bytes),capabilities:context.configurationFingerprint(),standardPolicy:policy?{tenantId:policy.tenantId,caller:policy.caller,moduleVersion:policy.moduleVersion,policySha256:evaluation!.policySha256}:null});
  const configurationEvidence=policy?{standardPolicy:{tenantId:policy.tenantId,caller:policy.caller,moduleVersion:policy.moduleVersion,policySha256:evaluation!.policySha256!,policies:policy.policies,maxAgeMs:900000 as const,classification:'clear' as const,complianceVerified:false as const}}:undefined;
  guard();return{record:context.record(),plan:{...input.plan,configurationSha256,implementationSha256:connectorProbeDigest(implementationSources)},configurationSha256,configurationEvidence,controls:input.controls,implementationSources};
 });
 return{service,inspect:()=>service.view(guard),execute:async(expected:string)=>{
  guard();if(!context.cwd||!context.leaseRoot||!context.policyObservation)throw Error('Normal host connector-probe execution context required');
  const cwd=context.cwd,signal=AbortSignal.timeout(115000),run=async(executable:string,args:string[])=>{signal.throwIfAborted();guard();const result=await deliveryCommands.run({executable,args},cwd,{},signal);guard();return result;};let adapter:FlowAdapter|undefined;
  // Exact-main CI is an additional machine gate, never a substitute for QA.
  await integrated();guard();
  return executeStandaloneProbe(expected,{home:context.home,leaseRoot:context.leaseRoot,releaseStartedAt:Date.now(),authority:async hash=>{await integrated();guard();return service.authority(hash,guard);},guard,
   privateLeaf:async(plan,admit)=>{await admit();const metadata=await privateReportMetadata(plan.record.id,cwd,signal,guard);if(metadata.status!=='observed'||!('protectedOwnerOnly' in metadata)||!metadata.protectedOwnerOnly||!metadata.leaf)throw Error('Protected Windows probe capture unavailable');return metadata.leaf;},
   connect:async(plan,nativeSignal,admit,captureNativeFailure)=>{adapter=await connectStandaloneProbeAdapter(context.home,cwd,plan,nativeSignal,admit,captureNativeFailure);return adapter;},
   prepareStandaloneResources:async(plan,admit,journal,quarantine)=>{if(!adapter)throw Error('Pinned adapter required');return prepareStandaloneProbeResources(plan,{command:run,flow:adapter,admit,journal,guard},quarantine);},
   verifyStandaloneResources:async(plan,flowId,admit)=>{if(!adapter)throw Error('Pinned adapter required');return inspectStandaloneProbeResource(plan,flowId,{command:run,flow:adapter,admit,journal:async()=>{throw Error('Inspection cannot journal or mutate resources');},guard});},
  });
 },handle:async(payload:unknown,actor:{id:string;role:string})=>{const input=standaloneProbeReviewRequest.parse(payload);if(input.action==='inspect')return service.view(guard);if(input.action==='read')return service.read(input.kind,input.key,input.expectedSha256,input.startCharacter,input.maxCharacters,guard);const{action,...review}=input;return service.review(review,actor,guard);}};
}
