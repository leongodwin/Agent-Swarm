export interface RecoveryPeer {pid?:number}
export interface RecoveryOptions {
 current():RecoveryPeer|null|undefined;
 busy():boolean;
 restart(peer:RecoveryPeer):unknown;
 report(message:string):void;
 exhausted():void;
 now?:()=>number;
 setTimer?:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 clearTimer?:(timer:ReturnType<typeof setTimeout>)=>void;
 limit?:number;
 windowMs?:number;
 delayMs?:number;
}
export class LauncherCrashRecovery {
 constructor(options:RecoveryOptions);
 exited(peer:RecoveryPeer,how:number|string|null):boolean;
 cancel():void;
 close():void;
}
