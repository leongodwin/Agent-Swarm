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

const sources=['server/connectorMetadataProbe.ts','server/connectorProbeReview.ts','server/connectorProbeRuntime.ts','shared/connectorProbeScope.ts'];
const configuration=z.strictObject({schemaVersion:z.literal(1),plan:connectorProbePlanSchema,controls:connectorProbeControlsSchema});
const sha=(bytes:string|Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Review-only composition. No tenant executor or generic command hook exists.
 * Configuration cannot supply executable code or an arbitrary flow definition. */
export function connectorProbeRuntime(context:{home:string;configurationRoot:string;record():DeliveryRecord;configurationFingerprint():string;guard():void}){
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
 return{service,inspect:()=>service.view(guard),handle:async(payload:unknown,actor:{id:string;role:string})=>{const input=connectorProbeReviewRequest.parse(payload);if(input.action==='inspect')return service.view(guard);if(input.action==='read')return service.read(input.kind,input.key,input.expectedSha256,input.startCharacter,input.maxCharacters,guard);const{action,...review}=input;return service.review(review,actor,guard);}};
}
