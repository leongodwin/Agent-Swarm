import {z} from 'zod';
import {deliveryRecordSchema,type DeliveryRecord} from '../shared/deliveryRecord.ts';

const formerContract=z.strictObject({adapter:z.literal('native-rejected-request-v1'),operation:z.literal('create-request'),assertions:z.tuple([z.literal('authenticated-403'),z.literal('retained-bounded-observations')]),observationWindowMs:z.number().int().min(1000).max(60000),pollIntervalMs:z.number().int().min(100).max(5000)}).refine(v=>v.pollIntervalMs<=v.observationWindowMs);

// Storage compatibility only: validate old rejected/unreviewed planning bytes
// against their former shape without migrating signed content or task hashes.
export const historicalDeliveryRecordSchema=z.unknown().transform((raw,ctx):DeliveryRecord=>{
 const current=deliveryRecordSchema.safeParse(raw);if(current.success)return current.data;
 const copy=structuredClone(raw) as DeliveryRecord;let legacy=false;
 try{
  if(copy.designReview?.decision==='approved'||copy.sliceReceipt||copy.taskReviews?.some(r=>r.decision==='approved')||copy.taskAcceptances?.length)throw Error('Legacy functional contract cannot retain executable approval');
  for(const qa of copy.content.taskPlan?.integrationQa??[])for(const row of qa.cases){
   const value=row.functionalAssertion as unknown;
   if(value&&typeof value==='object'&&'pollIntervalMs' in value){const old=formerContract.parse(value);legacy=true;const {pollIntervalMs:_poll,...rest}=old;row.functionalAssertion={...rest,observationMode:'pre-and-post'};}
  }
  if(!legacy)throw Error('Not a supported historical contract');
  deliveryRecordSchema.parse(copy);
  return structuredClone(raw) as DeliveryRecord;
 }catch{ctx.addIssue({code:'custom',message:'Invalid delivery record or unsupported historical functional contract'});return z.NEVER;}
});
