import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {DeliveryRun,DeliveryRelease} from '../shared/delivery.ts';
import type {HeadlessFlow} from './headlessFlowVerification.ts';
import {privateReportMetadata} from './privateReportMetadata.ts';
import {readBoundedText} from './boundedJson.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

export interface AcceptedHeadlessReport {
  sliceRunId:string;checkName:string;providerRunId:string;recordId:string;
  flowId:string;definitionSha256:string;reportSha256:string;report:string;
}
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Reads one selected report from a completed, independently accepted slice.
 * No caller-supplied path, capture enumeration, report logging or tenant call. */
export async function loadAcceptedHeadlessReport(
  plan:Pick<HeadlessFlow,'flowId'|'identity'|'definitionSha256'|'privateReport'|'dispatchReport'>,context:{repoId:string;environmentUrl:string;qaOwner:string},
  accepted:{runId:string;evidenceHash:string},source:DeliveryRun,release:DeliveryRelease,
  home:string,signal:AbortSignal,guard:()=>Promise<void>,metadata=privateReportMetadata,
):Promise<AcceptedHeadlessReport>{
  const check=async()=>{signal.throwIfAborted();await guard();signal.throwIfAborted();};
  await check();
  try{
    const ref=plan.dispatchReport,prior=release.plan.verification.headlessFlow;
    if(!ref||!plan.privateReport||!prior?.privateReport||prior.allowDispatch||prior.checks.filter(c=>c.name===ref.checkName).length!==1||!prior.checks.some(c=>c.name===ref.checkName&&c.mode==='dry-run'&&c.expectedStatus==='Succeeded')||
      accepted.runId!==ref.sliceRunId||source.id!==ref.sliceRunId||source.phase!=='complete'||source.repoId!==context.repoId||release.repoId!==context.repoId||
      source.releaseId!==release.id||source.head!==release.head||release.plan.deliveryRecord?.purpose!=='slice'||release.plan.deliveryRecord.id!==plan.privateReport.recordId||source.evidenceHash!==accepted.evidenceHash||
      source.visualReview?.reviewer!==context.qaOwner||source.visualReview.evidenceHash!==accepted.evidenceHash||
      source.environmentUrl.replace(/\/$/,'')!==context.environmentUrl.replace(/\/$/,'')||release.environmentUrl.replace(/\/$/,'')!==context.environmentUrl.replace(/\/$/,'')||
      prior.flowId!==plan.flowId||prior.definitionSha256!==plan.definitionSha256||digest(prior.identity)!==digest(plan.identity)||
      prior.privateReport.recordId!==plan.privateReport.recordId||prior.privateReport.action!==plan.privateReport.action)throw Error();
    if(release.plan.qualityEvidence&&(!source.qualityReview||source.qualityReview.reviewer!==context.qaOwner||source.qualityReview.evidenceHash!==accepted.evidenceHash))throw Error();
    const index=prior.checks.findIndex(c=>c.name===ref.checkName),file='headless-'+index+'-receipt.json';
    if(!source.evidence.includes(file))throw Error();
    const evidence=path.join(home,'delivery-runs',source.id,'evidence');
    const {containedFile}=await import('./delivery.ts');
    const receipt=z.object({intent:z.object({flowId:z.literal(plan.flowId),definitionSha256:z.literal(plan.definitionSha256),nonce:z.uuid(),check:z.object({name:z.literal(ref.checkName),mode:z.literal('dry-run')})}),runId:z.string().min(1),privateReportSha256:z.literal(ref.reportSha256)}).parse(parseUnambiguousJson(await readBoundedText(await containedFile(evidence,file),65536)??'',{maxBytes:65536}));
    await check();
    const observe=async()=>{await check();const value=await metadata(plan.privateReport!.recordId,evidence,signal,()=>signal.throwIfAborted());await check();if(value.status!=='observed'||!('protectedOwnerOnly' in value)||!value.protectedOwnerOnly||!value.leaf)throw Error();return value.leaf;};
    const leaf=await observe(),capture=path.join(leaf,receipt.intent.nonce+'.report.json');
    const stat=await fs.lstat(capture);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>300000||path.resolve(await fs.realpath(capture))!==path.resolve(capture))throw Error();
    const bytes=await fs.readFile(capture);if(bytes.length>300000)throw Error();
    const stored=z.object({schemaVersion:z.literal(1),recordId:z.literal(plan.privateReport.recordId),flowId:z.literal(plan.flowId),runId:z.literal(receipt.runId),owner:z.literal(plan.identity.username),report:z.string().min(1)}).parse(parseUnambiguousJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:300000}));
    if(!stored.report.trim()||Buffer.from(stored.report,'utf8').toString('utf8')!==stored.report||Buffer.byteLength(JSON.stringify(stored.report))>256000||digest(stored.report)!==ref.reportSha256||await observe()!==leaf)throw Error();
    await check();
    return{sliceRunId:source.id,checkName:ref.checkName,providerRunId:receipt.runId,recordId:plan.privateReport.recordId,flowId:plan.flowId,definitionSha256:plan.definitionSha256,reportSha256:ref.reportSha256,report:stored.report};
  }catch{await check();throw Error('The selected independently accepted private report is unavailable or its binding changed; dispatch is held');}
}
