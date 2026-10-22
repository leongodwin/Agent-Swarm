/** Bounded parent-owned recovery. Never restart after clean exit, intentional stop or another owner's launch. */
export class LauncherCrashRecovery {
  constructor(options) {this.options=options;this.recent=[];this.pending=null;this.closed=false;}
  exited(peer,how) {
    const current=this.options.current();
    if(this.closed||this.options.busy()||!Number.isSafeInteger(peer?.pid)||peer.pid<=0||current&&current!==peer||!(Number.isInteger(how)&&how!==0||typeof how==='string'&&/^SIG[A-Z]+$/.test(how)))return false;
    if(this.pending)return true;
    const now=(this.options.now??Date.now)(),windowMs=this.options.windowMs??300000;
    this.recent=this.recent.filter(at=>now-at<windowMs);
    if(this.recent.length>=(this.options.limit??3)){this.options.report('Server crash recovery budget exhausted; preserve its state and inspect the failure before restarting');this.options.exhausted();return true;}
    this.recent.push(now);
    this.options.report(`Server crashed (${how}); recovering through the owning launcher (${this.recent.length}/${this.options.limit??3})`);
    this.pending=(this.options.setTimer??setTimeout)(()=>{
      this.pending=null;
      if(this.closed||this.options.busy()||this.options.current())return;
      try{this.options.restart(peer);}catch{this.options.report('Server crash recovery could not start a replacement');this.options.exhausted();}
    },this.options.delayMs??500);
    return true;
  }
  cancel(){if(this.pending!==null)(this.options.clearTimer??clearTimeout)(this.pending);this.pending=null;}
  close(){this.closed=true;this.cancel();}
}
