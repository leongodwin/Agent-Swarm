import crypto from 'node:crypto';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {taskScope} from '../shared/taskPlan.ts';
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function taskScopeHash(record:Pick<DeliveryRecord,'content'>,issue:number){const scope=taskScope(record.content,issue);return scope?hash(scope):null;}
export function taskAuthorityHash(record:DeliveryRecord,issue:number){
  const scope=taskScope(record.content,issue);if(!scope)return record.sha256;
  return hash({scopeHash:taskScopeHash(record,issue),review:record.taskReviews?.find(r=>r.issue===issue)??null,
    prerequisites:scope.tasks.filter(t=>t.issue!==issue).map(t=>record.taskAcceptances?.find(a=>a.issue===t.issue)??null)});
}

/** Read-only planning observations do not change the worker's instructions.
 * Design still pins source; authoring/QA retain their full approved authority. */
export function workerTaskFingerprint(record:DeliveryRecord,issue:number){
  const stage=record.content.tasks.find(task=>task.issue===issue)?.stage;
  if(stage==='discovery'){
    const {findings:_findings,sourceCommit:_source,...scope}=record.content;
    return JSON.stringify([record.id,scope]);
  }
  if(stage==='design'){
    const {findings:_findings,...scope}=record.content;
    return JSON.stringify([record.id,scope]);
  }
  return taskAuthorityHash(record,issue);
}
