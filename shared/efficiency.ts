export interface EfficiencyReport {
  availability:'ready'|'unavailable';scope:'retained-coordinator-attempts';observedAt:string;collectionStartedAt:string|null;window:{from:string;to:string};completeWindow:boolean;
  counts:{reserved:number;launched:number;reportedSuccess:number;failure:number;blocked:number;interrupted:number;incomplete:number;sessionEvidenceMissing:number;sessionEvidenceUnreadable:number;acceptedHistorical:number;acceptedCurrent:number;acceptedMeasured:number;acceptedUnknownUsage:number};
  usage:{inputTokens:number|null;outputTokens:number|null;costUsd:number|null;measuredAttempts:number;unknownAttempts:number;tokensPerAcceptedTask:number|null;costPerAcceptedTask:number|null};
  retryHolds:{issue:number|null;role:string;attempts:number}[];recent:{id:string;issue:number|null;role:string;runtime:string;status:string;launched:boolean;usage:'measured'|'unknown'}[];
  reason:string;limitations:string[];
}
