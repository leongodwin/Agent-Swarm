import crypto from 'node:crypto';
import {z} from 'zod';
import type {DeliveryRelease,DeliveryPreflightRetry} from '../shared/delivery.ts';

const limit=6;
const delay=(failures:number)=>Math.min(60*60_000,2*60_000*2**(failures-1));
export function preflightContext(release:DeliveryRelease|undefined,environmentUrl:string):string{
  return crypto.createHash('sha256').update(JSON.stringify({environmentUrl,releaseId:release?.id,planHash:release?.planHash,approvedAt:release?.approvedAt,architectureReview:release?.architectureReview})).digest('hex');
}
export function nextPreflightRetry(previous:DeliveryPreflightRetry|undefined,context:string,now=Date.now()):DeliveryPreflightRetry{
  const failures=Math.min(limit,(previous?.context===context?previous.failures:0)+1);
  return {context,failures,lastFailureAt:new Date(now).toISOString(),nextAttemptAt:failures===limit?null:new Date(now+delay(failures)).toISOString()};
}
export function preflightDeferred(retry:DeliveryPreflightRetry|undefined,context:string,now=Date.now()):boolean{
  return !!retry&&retry.context===context&&(retry.nextAttemptAt===null||Date.parse(retry.nextAttemptAt)>now);
}
export const preflightRetrySchema=z.strictObject({context:z.string().regex(/^[a-f0-9]{64}$/),failures:z.number().int().min(1).max(limit),lastFailureAt:z.iso.datetime(),nextAttemptAt:z.iso.datetime().nullable()}).refine(row=>row.failures===limit?row.nextAttemptAt===null:row.nextAttemptAt!==null&&Date.parse(row.nextAttemptAt)-Date.parse(row.lastFailureAt)===delay(row.failures),'Invalid preflight retry schedule');
