import {discoveryBlockers,recordReference,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import type {DeliveryPolicy} from '../shared/delivery.ts';
import {taskPlanningBlockers} from './taskInputs.ts';

/** Diagnostics only: never issue approval or replace release admission. */
export function planningReadiness(record:DeliveryRecord|null,policy:DeliveryPolicy|null,scopeError?:string,now=Date.now()){
 const blockers=record?[...discoveryBlockers(record,now),...taskPlanningBlockers(record)]:['Create the shared discovery record'];
 if(scopeError)blockers.unshift(scopeError);
 const rejected=record?.designReview?.decision==='rejected'||!!record?.inputReview;
 const architectureStatus=rejected?'rejected':record?.designReview?.decision==='approved'?'approved':'unreviewed';
 const targetMatches=!!record?.content.environmentUrl&&!!policy&&record.content.environmentUrl.replace(/\/$/,'').toLowerCase()===policy.environmentUrl.replace(/\/$/,'').toLowerCase();
 return {scope:'planning-diagnostics-only',record:record?recordReference(record):null,architectureStatus,discoveryBlockers:blockers,
  nextAction:blockers.length?'repair-discovery':architectureStatus!=='approved'?'synthesize-current-design-and-request-independent-review':'prepare-and-independently-review-release',
  rejectionNotes:record?.designReview?.decision==='rejected'?record.designReview.notes:record?.inputReview?.notes??null,
  deliveryPolicy:!policy?.enabled?'disabled':!targetMatches?'target-mismatch':'enabled-for-record-target',
  limits:['Capability readiness does not establish design or delivery readiness','Enabling delivery cannot resolve a rejected design or approve a release','Fresh source, task, package, target and runtime gates still apply']};
}
