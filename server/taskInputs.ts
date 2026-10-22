import crypto from 'node:crypto';
import {recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {taskScope} from '../shared/taskPlan.ts';
import {taskScopeHash,taskAuthorityHash} from './taskScope.ts';
import {HttpError} from './httpError.ts';

export const TASK_CONTEXT_BYTES=24*1024;
type RecordInput=Pick<DeliveryRecord,'content'|'id'|'revision'|'sha256'>;
export type TaskInputSection='global'|'task'|'requirement'|'contract'|'finding'|'component'|'journey'|'decision'|'assumption'|'security'|'check'|'slice'|'integration';
function entries(record:RecordInput,issue:number){
 const scope=taskScope(record.content,issue);if(!scope)throw new HttpError(409,'Task execution contract is missing');
 const rows:{section:TaskInputSection;id:string;value:unknown}[]=[{section:'global',id:'global',value:scope.global}];
 const groups=[['task','tasks'],['requirement','requirements'],['contract','contracts'],['finding','findings'],['component','components'],['journey','journeys'],['decision','decisions'],['assumption','assumptions'],['security','securityBoundaries'],['check','checks']] as const;
 for(const [section,key]of groups)for(const value of scope[key])rows.push({section,id:String('id'in value?value.id:value.issue),value});
 // Stage links carry requirement scope independently of execution contracts.
 for(const value of scope.stages)rows.push({section:'task',id:`stage-${value.issue}`,value});
 for(const value of record.content.taskPlan?.integrationQa??[])rows.push({section:'integration',id:value.id,value});
 if(scope.slice)rows.push({section:'slice',id:'slice',value:scope.slice});
 return{scope,rows:rows.map(row=>{const bytes=Buffer.from(JSON.stringify(row.value));return{...row,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};})};
}
/** Bounded input manifest, not a truncated or independently authoritative scope.
 * Full taskScopeHash still binds every source byte and dependency. */
export function taskInputManifest(record:RecordInput,issue:number){
 const {scope,rows}=entries(record,issue);
 return{schemaVersion:1,reference:recordReference(record as DeliveryRecord),issue,taskHash:taskScopeHash(record,issue),task:scope.task,
  context:{outcome:scope.global.outcome,environmentUrl:scope.global.environmentUrl,sourceCommit:scope.global.sourceCommit,owner:scope.global.owner,qaOwner:scope.global.qaOwner},
  criticalFindings:scope.findings.filter(f=>f.critical).map(({id,area,owner,status,conclusion})=>({id,area,owner,status,conclusion})),
  inputIndex:rows.map(({section,id,bytes,sha256})=>({section,id,bytes,sha256})),
  retrieval:'Use delivery_record action task_input with {reference,issue,taskHash,section,id}. Read relevant full inputs before authoring; hash references are not proof of their contents. Missing or oversized inputs require owner repair. No evidence has been truncated.'};
}
export function readTaskInput(record:RecordInput,issue:number,section:TaskInputSection,id:string){
 const row=entries(record,issue).rows.find(row=>row.section===section&&row.id===id);if(!row)throw new HttpError(403,'Input is outside this task dependency scope');
 const result={reference:recordReference(record as DeliveryRecord),issue,taskHash:taskScopeHash(record,issue),...row};
 if(Buffer.byteLength(JSON.stringify(result))>TASK_CONTEXT_BYTES)throw new HttpError(409,'Task input exceeds 24 KiB; owner must split its source contract before authoring');
 return structuredClone(result);
}
export function taskInputPrompt(record:RecordInput,issue:number){
 for(const row of entries(record,issue).rows){
  const envelope={reference:recordReference(record as DeliveryRecord),issue,taskHash:taskScopeHash(record,issue),...row};
  if(Buffer.byteLength(JSON.stringify(envelope))>TASK_CONTEXT_BYTES)throw new HttpError(409,`Task input ${row.section}/${row.id} exceeds 24 KiB; owner must split its source contract`);
 }
 return JSON.stringify({taskInputs:taskInputManifest(record,issue),taskAuthorityHash:taskAuthorityHash(record as DeliveryRecord,issue),instruction:'Work only within this task contract. For delivery_record action task_input, copy reference, issue and taskHash from taskInputs exactly. taskAuthorityHash is the server approval fingerprint, NOT the input retrieval hash; never submit it as taskHash. Retrieve relevant complete inputs; no input has been truncated. Stop on missing, changed or oversized inputs and declared stop conditions. Read applicable skills and verify MCP capabilities before authoring. Dependencies require accepted merged artifacts, not merely closed issues. Report checks with actual evidence.'});
}
/** Admission-only checks preserve historical records for audit and correction. */
export function taskPlanningBlockers(record:RecordInput):string[]{
 const errors:string[]=[];
 if(record.content.taskPlan&&record.content.taskPlan.schemaVersion!==2)errors.push('Migrate legacy task contracts to version 2 with independent integration QA before new admission');
 for(const task of record.content.taskPlan?.tasks??[]){
  const linked=record.content.tasks.find(t=>t.issue===task.issue);
  if(linked?.stage==='slice'&&linked.requirementIds.some(id=>!record.content.slice.requirementIds.includes(id)))errors.push(`Task #${task.issue}: slice task exceeds the declared first journey`);
  try{if(Buffer.byteLength(taskInputPrompt(record,task.issue))>TASK_CONTEXT_BYTES)errors.push(`Task #${task.issue}: task context exceeds 24 KiB; split the task contract`);}
  catch(error){if(!(error instanceof HttpError))throw error;errors.push(`Task #${task.issue}: ${error.message}`);}
 }
 return errors;
}
