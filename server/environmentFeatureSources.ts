import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {readBoundedBytes} from './boundedJson.ts';
import {exactReviewCapsule} from './nativeReviewCapsule.ts';
import {standaloneHostReviewSources} from './standaloneHostReview.ts';
export const environmentFeatureSourceGroups=[
 ['server/environmentFeatureChange.ts','server/environmentFeatureClient.ts','server/environmentFeatureReview.ts','server/environmentFeaturePreservation.ts','server/environmentFeatureReconciliation.ts','server/environmentFeatureRuntime.ts','server/environmentFeatureSources.ts','server/environmentFeaturePrompt.ts'],
 ['shared/environmentFeatureScope.ts','shared/deliveryRecord.ts','shared/applicationSpec.ts','shared/taskPlan.ts','shared/executionEvidence.ts','shared/governanceProfile.ts'],
 ['server/resourceLease.ts','server/boundedJson.ts','server/unambiguousJson.ts','server/atomicFile.ts','server/identityContracts.ts'],
 ['server/tenantDlp.ts','server/standardPolicy.ts','server/standaloneIntegrationGate.ts','server/standaloneBuildIdentity.ts','scripts/build-server.mjs'],
 ['server/standaloneHostReview.ts','server/nativeReviewCapsule.ts','docs/delivery/ENVIRONMENT-FEATURE-CONTROL.md'],
] as const;
const sha=(value:string|Uint8Array)=>crypto.createHash('sha256').update(value).digest('hex');
/** Complete fixed administrative modules plus exact host/auth/command callsites.
 * Each source is freshly read; no unrelated SDK or business implementation is
 * represented as reviewed merely because its containing file hash is bound. */
export async function environmentFeatureSources(){
 const read=async(file:string)=>{const name=fileURLToPath(new URL('../'+file,import.meta.url)),stat=await fs.lstat(name),bytes=await readBoundedBytes(name,128*1024);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!bytes)throw Error('Canonical complete administrative source required');return{file,sha256:sha(bytes),text:new TextDecoder('utf8',{fatal:true}).decode(bytes)};};
 const sources=await Promise.all(environmentFeatureSourceGroups.map(async(group,index)=>{const entries=await Promise.all(group.map(read)),text=exactReviewCapsule(entries);if(Buffer.byteLength(text)>128*1024)throw Error('Administrative source capsule exceeds its existing bound');return{file:`docs/ENVIRONMENT-FEATURE-SOURCES-${index+1}.md`,sha256:sha(text),text};}));
 const host=await standaloneHostReviewSources();if(!['environmentFeatureFor','environment-feature','environment_feature','environmentFeatureReviewPrompt'].every(token=>host.text.includes(token)))throw Error('Complete administrative host wiring required before review');sources.push(host);return sources;
}
