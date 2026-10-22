import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {HttpError} from './httpError.ts';
import crypto from 'node:crypto';
import {taskAuthorityHash} from './taskScope.ts';
import {ownershipRecoveryScopeMatches} from '../shared/deliveryRecord.ts';
export interface OriginalTaskQa {prNumber:number;status:string;issueNumber:number|null;passedSha:string|null;qaAgentId:string|null;commentUrl:string|null;summary:string|null;checks:{result:string}[];taskAuthorityHash?:string}
export function assertOriginalTaskQa(source:DeliveryRecord,receipt:NonNullable<DeliveryRecord['taskAcceptances']>[number],issue:number,qa:OriginalTaskQa|undefined) {
  const hash=qa?crypto.createHash('sha256').update(JSON.stringify({pr:qa.prNumber,head:qa.passedSha,reviewer:qa.qaAgentId,summary:qa.summary,checks:qa.checks,commentUrl:qa.commentUrl})).digest('hex'):null;
  if(!qa||qa.status!=='passed'||qa.issueNumber!==issue||qa.prNumber!==receipt.prNumber||qa.passedSha!==receipt.headSha||qa.qaAgentId!==receipt.reviewer||!qa.commentUrl||!qa.checks.length||qa.checks.some(c=>c.result!=='pass')||hash!==receipt.evidenceHash||qa.taskAuthorityHash!==taskAuthorityHash(source,issue))throw new HttpError(409,'Original commit-bound independent QA evidence no longer matches');
}

/** Only discovery evidence can be reconsidered. Execution contracts, target,
 * ownership, task graph and all requirements must remain identical. The source
 * pin may advance only to this task's exact independently accepted merge; the
 * normal reconciliation still revalidates original QA and live merged-PR identity. */
export function assertEvidenceOnlyRevision(source:DeliveryRecord,current:DeliveryRecord,issue?:number,at=Date.now()) {
  const {findings:before,...oldScope}=source.content,{findings:after,...newScope}=current.content;
  if(oldScope.sourceCommit!==newScope.sourceCommit){const accepted=source.taskAcceptances?.find(r=>r.issue===issue);if(issue===undefined||!accepted||source.designReview?.decision!=='approved'||source.taskReviews?.find(r=>r.issue===issue)?.decision!=='approved'||!accepted.mergeCommitSha||newScope.sourceCommit!==accepted.mergeCommitSha)throw new HttpError(409,'Reconciliation requires unchanged source or this task exact independently accepted merge');newScope.sourceCommit=oldScope.sourceCommit;}
  if(source.repoId!==current.repoId||source.id!==current.id||source.revision>=current.revision||JSON.stringify(oldScope)!==JSON.stringify(newScope))throw new HttpError(409,'Reconciliation requires unchanged requirements, source, target and task contracts');
  if(before.some(f=>!after.some(next=>next.id===f.id))||new Set(after.map(f=>f.id)).size!==after.length)throw new HttpError(409,'Reconciliation cannot remove discovery decisions');
  const added=after.filter(f=>!before.some(old=>old.id===f.id));
  const dependencies=new Set<number>();const visit=(n:number)=>{if(dependencies.has(n))return;dependencies.add(n);for(const dep of source.content.taskPlan?.tasks.find(t=>t.issue===n)?.dependsOn??[])visit(dep);};if(issue!==undefined)visit(issue);
  for(const finding of added){
    const scope=finding.scope,task=current.content.taskPlan?.tasks.find(t=>t.issue===scope?.taskIssue),components=task?.componentIds.map(id=>current.content.applicationSpec?.components.find(c=>c.id===id));
    if(issue===undefined||!source.content.taskPlan?.tasks.some(t=>t.issue===issue)||!scope||!['canvas-source-sync','canvas-ownership-recovery'].includes(scope.kind)||dependencies.has(scope.taskIssue)||finding.area!=='authoring'||finding.status!=='observed'||finding.conclusion!=='ready'||!task||finding.owner!==task.owner||!components?.length||components.some(c=>!c||c.platform!=='canvas'||c.owner!==finding.owner)||!Number.isFinite(at)||!finding.evidence.some(e=>Date.parse(e.observedAt)<=at&&Date.parse(e.expiresAt)>at))throw new HttpError(409,'New discovery decisions require resolved, fresh Canvas-only prerequisite evidence outside the accepted task dependencies');
    if(scope.kind==='canvas-ownership-recovery'){
      if(!ownershipRecoveryScopeMatches(current.content.environmentUrl,task,scope,finding.evidence,at))throw new HttpError(409,'Ownership recovery requires exact task-bound, fresh original-token release evidence');
      const resource=`canvas_${scope.appId.toLowerCase()}`;
      if(current.content.taskPlan?.tasks.some(t=>dependencies.has(t.issue)&&t.resources.some(r=>r.toLowerCase()===resource)))throw new HttpError(409,'Ownership recovery affects an accepted task resource or dependency');
    }
  }
  const historical=before.flatMap(f=>f.evidence);
  for(const finding of before){
    const next=after.find(f=>f.id===finding.id);
    if(!next||['area','owner','status','conclusion','critical'].some(key=>finding[key as keyof typeof finding]!==next[key as keyof typeof next])||JSON.stringify(finding.scope)!==JSON.stringify(next.scope))throw new HttpError(409,'Reconciliation cannot change a discovery decision or its owner');
  }
  for(const finding of after)for(const evidence of finding.evidence)if(historical.some(old=>old.sha256===evidence.sha256)&&!historical.some(old=>old.sha256===evidence.sha256&&old.observedAt===evidence.observedAt&&old.expiresAt===evidence.expiresAt))throw new HttpError(409,'Historical evidence timestamps are immutable; capture a new observation');
}
