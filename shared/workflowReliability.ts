export interface WorkflowReliability {
  status:'observed'|'unavailable';scope:'github-actions-run-creation-window';repo:string;observedAt:string;
  window:{from:string;to:string};complete:boolean;targetPercent:99.5;reason:string;
  completed:number|null;successful:number|null;unsuccessful:number|null;active:number|null;rerunAttempts:number|null;
  successPercent:number|null;observedMeetsTarget:boolean|null;evidenceSha256?:string;
  failures:{runId:number;attempt:number;name:string;conclusion:string;url:string;headSha:string}[];
}
