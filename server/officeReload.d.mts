export interface ReloadState {supported?:boolean;phase:'idle'|'prepared'|'restarting'|'ready'|'failed';sourcePid?:number|null;targetPid?:number|null;operationId?:string|null;requestedAt?:number|null;updatedAt?:number;reason?:string}
export interface ReloadHandle {operationId:string;commit():Promise<'accepted'|'refused'|'unknown'>;cancel():void}
export interface ReloadPeer {pid?:number;connected?:boolean;send?(value:unknown,callback?:(error?:Error|null)=>void):unknown;on(event:string,listener:(value:unknown)=>void):unknown;removeListener(event:string,listener:(value:unknown)=>void):unknown}
export class OfficeReloadRequester {
  constructor(peer?:ReloadPeer,timeoutMs?:number);
  view():ReloadState;
  probe():Promise<void>;
  ready():void;
  prepare():Promise<ReloadHandle>;
  close():void;
}
export class LauncherReloadController {
  constructor(options:{current:()=>ReloadPeer|undefined|null;busy:()=>boolean;restart:(peer:ReloadPeer)=>Promise<ReloadPeer|undefined>;report:(reason:string)=>void;prepareMs?:number;readyMs?:number});
  state:ReloadState;
  owns(peer:ReloadPeer):boolean;
  handle(peer:ReloadPeer,input:unknown):boolean;
  exited(peer:ReloadPeer,code:number|string|null):void;
  close():void;
}
