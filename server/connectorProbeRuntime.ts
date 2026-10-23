import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {z} from 'zod';
import {readBoundedBytes} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {ConnectorProbeReview,connectorProbeControlsSchema,connectorProbeReviewRequest} from './connectorProbeReview.ts';
import {connectorProbeDigest,connectorProbePlanSchema} from './connectorMetadataProbe.ts';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {executeConnectorProbe} from './connectorProbeExecution.ts';
import {prepareConnectorProbeResources} from './connectorProbeResources.ts';
import {connectFlowAdapter,type FlowAdapter} from './flowAdapter.ts';
import {privateReportMetadata} from './privateReportMetadata.ts';
import {deliveryCommands} from './delivery.ts';

const sources=['server/connectorMetadataProbe.ts','server/connectorProbeReview.ts','server/connectorProbeRuntime.ts','server/connectorProbeExecution.ts','server/connectorProbeResources.ts','server/flowAdapter.ts','server/privateReportMetadata.ts','server/platformAuth.ts','server/dataverseIdentity.ts','server/resourceLease.ts','shared/connectorProbeScope.ts'];
const configuration=z.strictObject({schemaVersion:z.literal(1),plan:connectorProbePlanSchema,controls:connectorProbeControlsSchema});
const sha=(bytes:string|Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Normal-host composition. Execution requires fresh exact independent probe
 * approval. Configuration supplies neither code nor an arbitrary definition. */
export function connectorProbeRuntime(context:{home:string;configurationRoot:string;cwd?:string;leaseRoot?:string;record():DeliveryRecord;configurationFingerprint():string;guard():void}){
 const guard=context.guard;
 const service=new ConnectorProbeReview(context.home,async()=>{
  guard();const file=path.join(context.configurationRoot,'connector-probe-contract.json'),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(file)!==path.resolve(file))throw Error('Canonical connector probe configuration required');
  const bytes=await readBoundedBytes(file,32768);if(!bytes)throw Error('Bounded connector probe configuration required');
  const input=configuration.parse(parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),{maxBytes:32768}));
  const implementationSources=await Promise.all(sources.map(async name=>{const file=fileURLToPath(new URL('../'+name,import.meta.url)),bytes=await readBoundedBytes(file,128*1024);if(!bytes)throw Error('Pinned connector probe implementation absent');return{file:name,sha256:sha(bytes),text:new TextDecoder('utf8',{fatal:true}).decode(bytes)};}));
  const configurationSha256=connectorProbeDigest({contractSha256:sha(bytes),capabilities:context.configurationFingerprint()});
  guard();return{record:context.record(),plan:{...input.plan,configurationSha256,implementationSha256:connectorProbeDigest(implementationSources)},configurationSha256,controls:input.controls,implementationSources};
 });
 return{service,inspect:()=>service.view(guard),execute:async(expected:string)=>{
  guard();if(!context.cwd||!context.leaseRoot)throw Error('Normal host connector-probe execution context required');
  const cwd=context.cwd,signal=AbortSignal.timeout(120000),run=async(executable:string,args:string[])=>{signal.throwIfAborted();guard();const result=await deliveryCommands.run({executable,args},cwd,{},signal);guard();return result;};let adapter:FlowAdapter|undefined;
  return executeConnectorProbe(expected,{home:context.home,leaseRoot:context.leaseRoot,releaseStartedAt:Date.now(),authority:hash=>service.authority(hash,guard),guard,
   privateLeaf:async(plan,admit)=>{await admit();const metadata=await privateReportMetadata(plan.record.id,cwd,signal,guard);if(metadata.status!=='observed'||!('protectedOwnerOnly' in metadata)||!metadata.protectedOwnerOnly||!metadata.leaf)throw Error('Protected Windows probe capture unavailable');return metadata.leaf;},
   connect:async(_plan,nativeSignal)=>{adapter=await connectFlowAdapter(cwd,nativeSignal);return adapter;},
   prepareSameResources:async(plan,admit,journal)=>{if(!adapter)throw Error('Pinned adapter required');return prepareConnectorProbeResources(plan,{command:run,flow:adapter,admit,journal,guard});},
  });
 },handle:async(payload:unknown,actor:{id:string;role:string})=>{const input=connectorProbeReviewRequest.parse(payload);if(input.action==='inspect')return service.view(guard);if(input.action==='read')return service.read(input.kind,input.key,input.expectedSha256,input.startCharacter,input.maxCharacters,guard);const{action,...review}=input;return service.review(review,actor,guard);}};
}
