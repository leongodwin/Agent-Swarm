import crypto from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {atomicWrite} from './atomicFile.ts';
import {readBoundedJson} from './boundedJson.ts';
import {verifyTarget,targetBindingSchema,type Request} from './targetOperations.ts';
import {PlatformCommandError} from './platformCommandError.ts';

const logical=z.string().regex(/^[_a-z][a-z0-9_]{0,100}$/);
const scalar=z.union([z.string().max(1000),z.number().finite(),z.boolean(),z.null()]);
export const backendJourneySchema=z.strictObject({entitySet:logical,idField:logical,nameField:logical,maxNameLength:z.number().int().min(60).max(500),values:z.record(logical,scalar),createValues:z.record(logical,scalar).optional(),concurrency:z.strictObject({revisionField:logical,expectedRevisionField:logical}).optional(),
  childEntitySet:logical,childLookup:logical,childIdField:logical,
  validationErrorCodes:z.array(z.literal('0x80073001')).length(1),
}).superRefine((plan,ctx)=>{if(plan.idField===plan.nameField||[plan.values,plan.createValues??{}].some(values=>Object.hasOwn(values,plan.idField)||Object.hasOwn(values,plan.nameField)||Object.keys(values).length>20)||plan.concurrency&&[plan.idField,plan.nameField,...Object.keys(plan.values)].some(field=>field===plan.concurrency!.revisionField||field===plan.concurrency!.expectedRevisionField))ctx.addIssue({code:'custom',message:'Journey values cannot override the runner-owned identity or marker'});});
export type BackendJourney=z.infer<typeof backendJourneySchema>;
const journalSchema=z.strictObject({runId:z.string().min(1),sourceCommit:z.string(),contractSha256:z.string(),resultSha256:z.string().optional(),id:z.uuid(),marker:z.string(),phase:z.enum(['intent','created','validated','restored','cleaned'])});
function facts(value:unknown,fields:string[]){if(!value||typeof value!=='object')throw new Error('Pilot record response is unavailable');return Object.fromEntries(fields.map(field=>[field,(value as Record<string,unknown>)[field]]));}
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** App-owned transaction evidence. Only a new client-generated GUID may be
 * mutated. Every write rechecks the target; restoration uses ETags and audit retention must
 * refuse foreign ownership, unexpected children or an ambiguous prior intent. */
export async function verifyBackendJourney(plan:BackendJourney,binding:z.infer<typeof targetBindingSchema>,request:Request,directory:string,signal:AbortSignal,context:{runId:string;sourceCommit:string},kind:'journey'|'recovery'='journey'){
  const file=`independent-${kind}.json`,journalFile=path.join(directory,`independent-${kind}-journal.json`),events:string[]=[];
  const prior=await readBoundedJson(journalFile,16384);
  let journal=journalSchema.parse(prior??{...context,contractSha256:digest(plan),id:crypto.randomUUID(),marker:`SYNTHETIC P0 ${context.runId} ${kind==='recovery'?'R':'J'}`,phase:'intent'});
  if(journal.runId!==context.runId||journal.sourceCommit!==context.sourceCommit||journal.contractSha256!==digest(plan))throw new Error('Pilot transaction journal belongs to another run or contract');
  if(journal.marker.length>plan.maxNameLength)throw new Error('Pilot marker exceeds the approved name constraint');
  const fields=[plan.idField,plan.nameField,...Object.keys(plan.values),'_ownerid_value'],select=[...fields,'versionnumber',...(plan.concurrency?[plan.concurrency.revisionField]:[])].join(','),resource=`${plan.entitySet}(${journal.id})`;
  const guard=async()=>{signal.throwIfAborted();await verifyTarget(request,binding);signal.throwIfAborted();};
  const save=async(phase:typeof journal.phase,resultSha256?:string)=>{journal={...journal,phase,...(resultSha256?{resultSha256}:{})};await atomicWrite(journalFile,JSON.stringify(journal,null,2));};
  const write=async(method:'POST'|'PATCH'|'DELETE',target:string,body?:object,etag?:string)=>{await guard();return request(method,target,body,etag?{'If-Match':etag}:undefined);};
  const read=async()=>{await guard();return request('GET',`${resource}?$select=${select}`) as Promise<Record<string,unknown>>;};
  const owns=(row:Record<string,unknown>)=>{if(row[plan.idField]!==journal.id||row[plan.nameField]!==journal.marker||row._ownerid_value!==binding.userId)throw new Error('Pilot record ownership or marker changed; leave it for reconciliation');};
  const etag=(row:Record<string,unknown>)=>{const value=row['@odata.etag'];if(typeof value!=='string'||!/^W\/"\d+"$/.test(value))throw new Error('Pilot record lacks a usable concurrency token');return value;};
  const edit=(row:Record<string,unknown>,name:string)=>{if(!plan.concurrency)return {[plan.nameField]:name};const revision=row[plan.concurrency.revisionField];if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new Error('Pilot service revision is unavailable');return {[plan.nameField]:name,[plan.concurrency.expectedRevisionField]:revision};};
  try{
    await guard();
    if(prior!==undefined){
      if(journal.phase==='cleaned'&&journal.resultSha256){const result=await readBoundedJson(path.join(directory,file),128*1024);if(result&&digest(result)===journal.resultSha256)return {file,result:result as {scope:string;performedAt:string;restored:true;dataPreserved:true;protectedRecords:{table:string;id:string;beforeSha256:string;afterSha256:string}[]}};}
      throw new Error('A prior pilot transaction exists; reconcile its journal before retrying this stage');
    }
    const existing=z.object({value:z.array(z.unknown()),'@odata.nextLink':z.never().optional()}).parse(await request('GET',`${plan.entitySet}?$select=${plan.idField}&$filter=${plan.idField} eq ${journal.id}`));
    if(existing.value.length)throw new Error('Pilot GUID already exists; no write is authorised');
    await save('intent');await write('POST',plan.entitySet,{...(plan.createValues??plan.values),[plan.idField]:journal.id,[plan.nameField]:journal.marker});await save('created');events.push('Created a new uniquely identified pilot-owned draft');
    const baseline=await read();owns(baseline);
    for(const [field,value] of Object.entries(plan.values))if(baseline[field]!==value)throw new Error(`Persisted pilot value differs: ${field}`);
    const persisted=await read();owns(persisted);if(digest(facts(persisted,fields))!==digest(facts(baseline,fields)))throw new Error('Pilot draft did not survive the independent fresh read');events.push('Fresh authenticated read preserved the submitted values');
    let rejected=false,errorCode:string|undefined;
    try{await write('PATCH',resource,edit(persisted,'X'.repeat(plan.maxNameLength+1)),etag(persisted));}
    catch(error){if(error instanceof PlatformCommandError&&error.platformErrorCode&&plan.validationErrorCodes.includes(error.platformErrorCode as '0x80073001')){rejected=true;errorCode=error.platformErrorCode;}else throw error;}
    if(!rejected)throw new Error('Server accepted an overlength pilot name; validation contract failed');
    const afterInvalid=await read();owns(afterInvalid);if(digest(facts(afterInvalid,fields))!==digest(facts(baseline,fields))||etag(afterInvalid)!==etag(persisted)||afterInvalid.versionnumber!==persisted.versionnumber||plan.concurrency&&afterInvalid[plan.concurrency.revisionField]!==persisted[plan.concurrency.revisionField])throw new Error('Rejected write changed the pilot record');await save('validated');events.push(`Server rejected the overlength write (${errorCode}) and preserved business state and version`);
    const changedName=`RECOVERY ${journal.marker}`.slice(0,plan.maxNameLength);
    await write('PATCH',resource,edit(afterInvalid,changedName),etag(afterInvalid));const changed=await read();if(changed[plan.idField]!==journal.id||changed[plan.nameField]!==changedName||changed._ownerid_value!==binding.userId||digest(facts(changed,fields.filter(field=>field!==plan.nameField)))!==digest(facts(baseline,fields.filter(field=>field!==plan.nameField))))throw new Error('Recovery rehearsal record changed ownership or value');
    await write('PATCH',resource,edit(changed,journal.marker),etag(changed));const restored=await read();owns(restored);const beforeSha256=digest(facts(baseline,fields)),afterSha256=digest(facts(restored,fields));if(beforeSha256!==afterSha256)throw new Error('Pilot record recovery did not restore business values');await save('restored');events.push('Restored the pilot-owned business values using guarded writes; service revision/audit fields may advance');
    await guard();const children=z.object({value:z.array(z.unknown()),'@odata.nextLink':z.never().optional()}).parse(await request('GET',`${plan.childEntitySet}?$select=${plan.childIdField}&$filter=${plan.childLookup} eq ${journal.id}`));if(children.value.length)throw new Error('Unexpected dependent records; automatic pilot cleanup refused');
    // Retain the owned synthetic row as audit evidence. A separate child query
    // cannot authorise a cascading parent delete atomically. No DELETE is issued.
    const retained=await read();owns(retained);if(digest(facts(retained,fields))!==beforeSha256)throw new Error('Retained audit record differs from the restored baseline');
    events.push('Retained only the owned synthetic report for audit; no record deletion was attempted');
    const result={schemaVersion:1,scope:'pilot-owned-development-records',method:'runner-owned-dataverse-transaction',...context,binding,performedAt:new Date().toISOString(),restored:true,dataPreserved:true,cleanup:'retained-for-audit',validationErrorCode:errorCode,protectedRecords:[{table:plan.entitySet,id:journal.id,beforeSha256,afterSha256}],events,limitations:['Development-only; no solution rollback or employee/approver isolation certification. Pre-existing records were not mutated.']};
    await atomicWrite(path.join(directory,file),JSON.stringify(result,null,2));await save('cleaned',digest(result));return {file,result};
  }catch(error){await atomicWrite(path.join(directory,`independent-${kind}-failure.json`),JSON.stringify({schemaVersion:1,...context,id:journal.id,phase:journal.phase,events,failed:true,remedy:'Inspect the exact pilot GUID and its journal. Never retry an ambiguous write or delete records using marker search alone.'},null,2));throw error;}
}
