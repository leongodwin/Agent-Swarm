import crypto from 'node:crypto';
import {z} from 'zod';

const request=z.strictObject({type:z.literal('office:reload'),action:z.enum(['status','prepare','commit','cancel','ready']),requestId:z.uuid(),pid:z.number().int().positive()});
const stateSchema=z.strictObject({phase:z.enum(['idle','prepared','restarting','ready','failed']),sourcePid:z.number().int().positive().nullable(),targetPid:z.number().int().positive().nullable(),operationId:z.uuid().nullable(),requestedAt:z.number().int().nonnegative().nullable(),updatedAt:z.number().int().nonnegative(),reason:z.string().max(300).optional()});
const response=z.strictObject({type:z.literal('office:reload-result'),requestId:z.uuid(),ok:z.boolean(),state:stateSchema,reason:z.string().max(300).optional()});
const event=z.strictObject({type:z.literal('office:reload-state'),state:stateSchema});
const send=(peer,value,failed=()=>{})=>{
  try{if(!peer.connected)throw new Error('Disconnected');peer.send(value,error=>{if(error)failed();});}catch{failed();}
};

/** Parent-only state: requests are bound to the actual child handle and native PID. */
export class LauncherReloadController {
  state={phase:'idle',sourcePid:null,targetPid:null,operationId:null,requestedAt:null,updatedAt:Date.now()};
  reservation=null;
  constructor(options){this.options=options;}
  owns(peer){return this.reservation?.peer===peer;}
  change(patch){this.state={...this.state,...patch,updatedAt:Date.now()};send(this.options.current()??{}, {type:'office:reload-state',state:this.state});}
  fail(reason){this.change({phase:'failed',reason});try{this.options.report(reason);}catch{}}
  clear(){if(this.reservation)clearTimeout(this.reservation.timer);this.reservation=null;}
  handle(peer,input){
    if(!input||input.type!=='office:reload')return false;
    const parsed=request.safeParse(input);if(!parsed.success)return true;
    const msg=parsed.data;
    const reply=(ok,reason)=>send(peer,{type:'office:reload-result',requestId:msg.requestId,ok,state:this.state,...(reason?{reason}:{})});
    if(peer!==this.options.current()||msg.pid!==peer.pid){reply(false,'Reload request does not own the current server');return true;}
    if(msg.action==='status'){reply(true);return true;}
    if(msg.action==='ready'){
      if(this.state.phase==='restarting'&&this.state.targetPid===peer.pid){this.change({phase:'ready',reason:undefined});this.clear();}
      return true;
    }
    if(msg.action==='prepare'){
      if(this.options.busy()||this.reservation){reply(false,'Launcher is updating, stopping or already reloading');return true;}
      this.state={phase:'prepared',sourcePid:peer.pid,targetPid:null,operationId:msg.requestId,requestedAt:Date.now(),updatedAt:Date.now()};
      const timer=setTimeout(()=>{if(this.reservation?.id===msg.requestId){this.fail('Prepared reload expired without a commit; server remains running');this.clear();}},this.options.prepareMs??5000);timer.unref?.();
      this.reservation={peer,id:msg.requestId,timer};reply(true);return true;
    }
    if(!this.reservation||this.reservation.peer!==peer||this.reservation.id!==msg.requestId){reply(false,'Reload reservation is missing or changed');return true;}
    if(msg.action==='cancel'){
      if(this.state.phase==='prepared'){this.clear();this.change({phase:'idle',sourcePid:null,targetPid:null,operationId:null,requestedAt:null,reason:undefined});}reply(true);return true;
    }
    if(msg.action==='commit'){
      if(this.state.phase!=='prepared'||this.options.busy()){reply(false,'Launcher cannot commit this reload');if(this.state.phase==='prepared'){this.fail('Reload was refused before shutdown; server remains running');this.clear();}return true;}
      clearTimeout(this.reservation.timer);this.change({phase:'restarting',reason:undefined});reply(true);
      void Promise.resolve().then(()=>this.options.restart(peer)).then(next=>{
        if(!next||!Number.isInteger(next.pid)||next.pid<=0)throw new Error('No replacement');
        this.change({targetPid:next.pid});
        if(this.reservation){
          this.reservation.timer=setTimeout(()=>{
            if(this.state.phase==='restarting'&&this.state.targetPid===next.pid){
              const reason='Replacement listener readiness is still unverified; continue observing the same native server';
              this.change({reason});try{this.options.report(reason);}catch{}
            }
          },this.options.readyMs??30000);this.reservation.timer.unref?.();
        }
      }).catch(()=>{this.fail('Server reload failed; no replacement readiness is verified');this.clear();});
    }
    return true;
  }
  exited(peer,code){
    if(this.state.phase==='restarting'&&(peer.pid===this.state.targetPid||(this.owns(peer)&&code!==0))){this.fail('Server exited during reload; replacement readiness is unverified');this.clear();}
  }
  close(){this.clear();}
}

/** Acknowledged two-phase IPC. Losing the parent never shuts down the server. */
export class OfficeReloadRequester {
  pending=new Map();reservation=null;closed=false;
  snapshot={supported:false,phase:'idle',reason:'Owning launcher reload support has not been verified'};
  constructor(peer=process,timeoutMs=2000){
    this.peer=peer;this.timeoutMs=timeoutMs;
    this.message=input=>{
      const broadcast=event.safeParse(input);if(broadcast.success){this.snapshot={supported:true,...broadcast.data.state};return;}
      const parsed=response.safeParse(input);if(!parsed.success)return;
      const value=parsed.data,entry=this.pending.get(value.requestId);if(!entry)return;
      this.snapshot={supported:true,...value.state,...(value.reason?{reason:value.reason}:{})};entry.finish(value.ok?undefined:Object.assign(new Error(value.reason??'Launcher rejected reload'),{refused:true}),value);
    };
    this.disconnect=()=>{this.snapshot={...this.snapshot,supported:false,reason:'Owning launcher disconnected; reload is unavailable'};for(const entry of [...this.pending.values()])entry.finish(new Error(this.snapshot.reason));};
    peer.on('message',this.message);peer.on('disconnect',this.disconnect);
  }
  view(){return {...this.snapshot};}
  exchange(action,id=crypto.randomUUID()){
    return new Promise((resolve,reject)=>{
      if(this.closed||!this.peer.connected||typeof this.peer.send!=='function'){this.snapshot={...this.snapshot,supported:false,reason:this.closed?'Office reload lifecycle closed':'Owning launcher is unavailable'};reject(new Error(this.snapshot.reason));return;}
      const finish=(error,value)=>{const item=this.pending.get(id);if(!item)return;clearTimeout(item.timer);this.pending.delete(id);if(error)reject(error);else resolve(value);};
      const timer=setTimeout(()=>{this.snapshot={...this.snapshot,supported:false,reason:'Owning launcher did not acknowledge reload support; server remains running'};finish(new Error(this.snapshot.reason));},this.timeoutMs);
      this.pending.set(id,{finish,timer});send(this.peer,{type:'office:reload',action,requestId:id,pid:this.peer.pid},()=>{if(this.pending.has(id)){this.snapshot={...this.snapshot,supported:false,reason:'Owning launcher transport failed; server readiness is unverified'};finish(new Error(this.snapshot.reason));}});
    });
  }
  async probe(){try{await this.exchange('status');}catch{}}
  ready(){send(this.peer,{type:'office:reload',action:'ready',requestId:crypto.randomUUID(),pid:this.peer.pid});}
  async prepare(){
    if(this.reservation)throw new Error('A reload is already prepared');
    // Reserve before awaiting, preventing two HTTP callers sharing an office.
    const id=crypto.randomUUID();this.reservation=id;
    try{await this.exchange('prepare',id);}catch(error){if(this.reservation===id)this.reservation=null;throw error;}
    let consumed=false;
    return {operationId:id,commit:()=>{
      if(consumed)return Promise.resolve('unknown');consumed=true;
      return this.exchange('commit',id).then(()=>'accepted').catch(error=>{this.snapshot={...this.snapshot,phase:'failed',reason:'Reload commit was not acknowledged; inspect the current server before retrying'};return error.refused?'refused':'unknown';}).finally(()=>{if(this.reservation===id)this.reservation=null;});
    },cancel:()=>{
      if(consumed)return;consumed=true;
      void this.exchange('cancel',id).catch(()=>{}).finally(()=>{if(this.reservation===id)this.reservation=null;});
    }};
  }
  close(){
    if(this.closed)return;this.closed=true;
    if(this.reservation)send(this.peer,{type:'office:reload',action:'cancel',requestId:this.reservation,pid:this.peer.pid});
    this.peer.removeListener('message',this.message);this.peer.removeListener('disconnect',this.disconnect);
    for(const entry of [...this.pending.values()])entry.finish(new Error('Office reload lifecycle closed'));
  }
}
