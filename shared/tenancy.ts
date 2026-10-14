export interface TenancyEnvironment { index?: number; name: string; url: string; user: string; active: boolean }
export interface TenancyActivity {scope:'process-local-tenancy-work';closed:boolean;profileSelection:boolean;authenticationRequests:number;awaitingNativeExit:number;nativeCommands:number;busy:boolean}
export interface TenancyInfo { authenticationBusy?:boolean;tenantName: string; tenantDomain: string; tenantId: string; user: string; environments: TenancyEnvironment[]; isReal: boolean; status?: 'connected' | 'disconnected' | 'stale' | 'demo' }
export interface TenancyLoginInput { environmentUrl?: string; tenantId?: string; applicationId?: string; clientSecret?: string; name?: string; interactive?: boolean; authMethod?: 'interactive' | 'device-code' }
export interface TenancyLogin { id: string; status: 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled'; phase?:'authenticating'|'verifying';nativeCleanup?:'awaiting-exit'|'exited';message: string; ok: boolean;observation?:{scope:'pac-profile-and-organization';checkedAt:string;profileIndex:number;environmentUrl:string;organizationId:string;userId:string;username:string;environmentId:string} }

/** Retained discovery rows are display history, not current target authority. */
export function currentEnvironment(info:TenancyInfo|null|undefined,allowDemo=false):TenancyEnvironment|undefined {
  if(!info||!(info.status==='connected'&&info.isReal===true||allowDemo&&info.status==='demo'&&info.isReal===false)||!Array.isArray(info.environments))return undefined;
  const active=info.environments.filter(environment=>environment.active===true);if(active.length!==1)return undefined;
  const target=active[0];
  try{const url=new URL(target.url);if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)return undefined;}
  catch{return undefined;}
  return target;
}
