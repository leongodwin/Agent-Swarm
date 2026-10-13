export interface AuxiliarySessionLease {running():void;stopping():void;release():void;}
export interface SessionUsage {
  blockedReason?:string;
  limit:number;used:number;agentSessions:number;freeSlots:number|null;
  auxiliary:{jobId:string;repoId:string;kind:'architecture';state:'reserved'|'running'|'stopping';reservedAt:number}[];
}
