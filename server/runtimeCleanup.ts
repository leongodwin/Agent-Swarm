import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {CleanupFailureCode} from '../shared/sessionUsage.ts';
export const cleanupRecord=z.strictObject({id:z.string().min(1).max(200),agentId:z.string().max(200),cli:z.string().max(100),pid:z.number().int().nonnegative(),keeperInstance:z.uuid().nullable(),requestedAt:z.number().int().nonnegative(),state:z.enum(['stopping','unverified'])});
export type CleanupRecord=z.infer<typeof cleanupRecord>;
export interface CleanupView {records:CleanupRecord[];unavailableReason?:string;failureCode?:CleanupFailureCode;failureSystemCode?:string}
const systemCode=(error:unknown)=>{
  const value=error as {code?:string;name?:string};
  return ['ENOENT','EACCES','EPERM','EEXIST','ENOTEMPTY','EBUSY','ENOTDIR','CLEANUP_BUSY','CLEANUP_EVIDENCE'].includes(value?.code??'')?value.code:value?.name==='ZodError'?'INVALID_SHAPE':value?.name==='SyntaxError'?'INVALID_JSON':'MUTEX_STATE';
};
const saved=z.strictObject({schemaVersion:z.literal(1),records:z.array(cleanupRecord).max(500)}).refine(value=>new Set(value.records.map(row=>row.id)).size===value.records.length);
const lockRecord=z.strictObject({pid:z.number().int().positive(),token:z.uuid()});
const queueRecord=lockRecord.extend({sequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
const pause=new Int32Array(new SharedArrayBuffer(4));
const sameRoot=(a:CleanupRecord,b:CleanupRecord)=>a.id===b.id&&a.agentId===b.agentId&&a.cli===b.cli&&a.pid===b.pid&&a.keeperInstance===b.keeperInstance&&a.requestedAt===b.requestedAt;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const absent=(pid:number)=>{try{process.kill(pid,0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}};

/** Bounded synchronous reads are needed before termination or task admission. */
function readJson(file:string,maximum:number):unknown|undefined {
  let fd:number;
  try{fd=fs.openSync(file,'r');}catch(error){if(missing(error))return undefined;throw error;}
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size>maximum)throw Object.assign(new Error('Invalid evidence file'),{code:'CLEANUP_EVIDENCE'});
    const buffer=Buffer.alloc(before.size+1);let length=0;
    while(length<buffer.length){const count=fs.readSync(fd,buffer,length,buffer.length-length,length);if(!count)break;length+=count;}
    const after=fs.fstatSync(fd);
    if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('Evidence changed during read');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)));
  }finally{fs.closeSync(fd);}
}
/** Durable quarantine: elapsed time and transport loss cannot acknowledge native exit. */
export class RuntimeCleanupStore {
  private records=new Map<string,CleanupRecord>();
  private identities=new Map<string,CleanupRecord>();
  private pending=new Map<string,CleanupRecord>();
  private unavailableReason:string|undefined;
  private failureCode:CleanupView['failureCode'];
  private failureSystemCode:string|undefined;
  private seenFile=false;
  constructor(private file:string,private changed:()=>void=()=>{}){this.view();}
  private read():Map<string,CleanupRecord>{
    const value=readJson(this.file,1024*1024);
    if(value===undefined){if(this.seenFile)throw new Error('Evidence disappeared');return new Map();}
    this.seenFile=true;
    return new Map(saved.parse(value).records.map(row=>[row.id,row]));
  }
  private accept(records:Map<string,CleanupRecord>){
    for(const record of records.values()){
      const known=this.identities.get(record.id);
      if(known&&!sameRoot(known,record))throw new Error('Runtime identity collision');
      this.identities.set(record.id,{...record});
      if(!this.records.has(record.id)||this.records.get(record.id)?.state==='unverified')record.state='unverified';
    }
    for(const row of this.pending.values())records.set(row.id,{...row});
    this.records=records;
  }
  private refresh(){
    if(this.unavailableReason)return;
    try{this.accept(this.read());}
    catch(error){this.failureSystemCode=systemCode(error);this.failureCode='evidence';this.unavailableReason='Runtime cleanup evidence is unreadable or changed identity; capacity is quarantined';}
  }
  view():CleanupView{
    let busy:string|undefined,busyCode:CleanupView['failureCode'],busySystemCode:string|undefined;
    // Serialize readers too: a writer may be about to publish a new quarantine.
    if(!this.unavailableReason){
      try{const release=this.acquire();try{this.refresh();}finally{release();}}
      catch(error){const code=(error as {code?:unknown}).code;busySystemCode=systemCode(error);busyCode=code==='CLEANUP_BUSY'?'contention':code==='CLEANUP_EVIDENCE'?'evidence':'io';busy='Runtime cleanup writer is unavailable; capacity is quarantined';}
    }
    const reason=this.unavailableReason??busy;
    const failureSystemCode=this.failureSystemCode??busySystemCode;
    return {records:[...this.records.values()].map(row=>({...row})),...(reason?{unavailableReason:reason,failureCode:this.failureCode??busyCode,...(failureSystemCode?{failureSystemCode}:{})}:{})};
  }
  private exclusive(file:string,deadline:number):()=>void{
    const guard=file+'.reaping',owner={pid:process.pid,token:crypto.randomUUID()};
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    // The lock is ephemeral coordination; durable cleanup records are flushed separately.
    const create=()=>{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));}finally{fs.closeSync(fd);}};
    // Bound event-loop blocking; contention never acknowledges a native exit.
    for(;;){
      try{create();break;}catch(error){
        const code=(error as NodeJS.ErrnoException).code;
        // Windows can keep an unlinked coordination file delete-pending while
        // another reader closes it. Retry exclusive creation, never grant ownership
        // or remove another owner's evidence because of a permission error.
        if(['EPERM','EACCES','EBUSY'].includes(code??'')&&performance.now()<deadline){Atomics.wait(pause,0,0,5);continue;}
        if(code!=='EEXIST')throw error;
      }
      let value:unknown;
      try{value=readJson(file,4096);}catch(error){if(performance.now()>=deadline)throw error instanceof SyntaxError?Object.assign(new Error('Invalid cleanup writer evidence'),{code:'CLEANUP_EVIDENCE'}):error;Atomics.wait(pause,0,0,5);continue;}
      if(value===undefined){if(performance.now()>=deadline)throw Object.assign(new Error('Cleanup writer unavailable'),{code:'CLEANUP_BUSY'});continue;}
      const previous=lockRecord.safeParse(value);
      if(previous.success&&absent(previous.data.pid)){
        // Serialize reclaimers and reread. An incomplete or live owner's lock is never removed.
        fs.mkdirSync(guard);
        try{
          const current=readJson(file,4096);
          if(current!==undefined){const parsed=lockRecord.parse(current);if(parsed.token!==previous.data.token||!absent(parsed.pid))throw new Error('Lock owner changed');fs.unlinkSync(file);}
          create();
        }finally{fs.rmdirSync(guard);}
        break;
      }
      if(performance.now()>=deadline)throw Object.assign(new Error('Cleanup writer unavailable'),{code:previous.success?'CLEANUP_BUSY':'CLEANUP_EVIDENCE'});
      Atomics.wait(pause,0,0,5);
    }
    return ()=>{const current=lockRecord.parse(readJson(file,4096));if(current.token!==owner.token||current.pid!==owner.pid)throw new Error('Cleanup writer ownership lost');fs.unlinkSync(file);};
  }
  private acquire():()=>void{
    const file=this.file+'.lock',queue=file+'.queue',allocator=file+'.queue-lock';
    const deadline=performance.now()+250;
    type Ticket=z.infer<typeof queueRecord>;
    const invalid=()=>Object.assign(new Error('Cleanup queue evidence is invalid'),{code:'CLEANUP_EVIDENCE'});
    // Queue allocation/inspection is short; the main transaction never holds this gate.
    // Sequence allocation includes the active owner's ticket, so bursts cannot overtake waiters.
    const entries=():Ticket[]=>{
      const files=fs.readdirSync(queue);if(files.length>64)throw invalid();
      const rows:Ticket[]=[];
      for(const name of files){
        if(!/^[a-f0-9-]{36}\.json$/i.test(name))throw invalid();
        let value:unknown;try{value=readJson(path.join(queue,name),4096);}catch(error){if(error instanceof SyntaxError)throw invalid();throw error;}
        if(value===undefined)continue; // a released ticket disappeared during an unlocked observation
        const parsed=queueRecord.safeParse(value);if(!parsed.success)throw invalid();const ticket=parsed.data;if(name!==ticket.token+'.json')throw invalid();
        rows.push(ticket);
      }
      if(new Set(rows.map(row=>row.sequence)).size!==rows.length)throw invalid();
      return rows.sort((a,b)=>a.sequence-b.sequence);
    };
    const liveQueue=()=>{
      const rows=entries();
      // Only a dead head prevents progress. Avoid repeated native PID inspection
      // of every waiting writer while the active transaction is flushing.
      while(rows[0]&&rows[0].pid!==process.pid&&absent(rows[0].pid))fs.unlinkSync(path.join(queue,rows.shift()!.token+'.json'));
      return rows;
    };
    let ticket:Ticket|undefined;
    const allocate=this.exclusive(allocator,deadline);
    try{
      fs.mkdirSync(queue,{recursive:true});const rows=liveQueue();
      // The allocator gate makes this shortcut atomic with ticket publication.
      // An arriving waiter joins the queue while this owner holds the main lock;
      // the owner releases directly, then must join behind that waiting ticket.
      if(!rows.length&&!fs.existsSync(file)){
        const release=this.exclusive(file,deadline);
        return release;
      }
      if(rows.length>=64)throw Object.assign(new Error('Cleanup writer queue is full'),{code:'CLEANUP_BUSY'});
      ticket=queueRecord.parse({pid:process.pid,token:crypto.randomUUID(),sequence:Math.max(-1,...rows.map(row=>row.sequence))+1});
      const temporary=this.file+'.'+ticket.token+'.ticket.tmp';
      try{fs.writeFileSync(temporary,JSON.stringify(ticket),{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(queue,ticket.token+'.json'));}
      finally{try{fs.unlinkSync(temporary);}catch{}}
    }finally{allocate();}
    const mine=ticket;
    const ticketFile=path.join(queue,mine.token+'.json');
    const assertTicket=()=>{const current=queueRecord.parse(readJson(ticketFile,4096));if(current.token!==mine.token||current.pid!==mine.pid||current.sequence!==mine.sequence)throw invalid();};
    // Keep the empty directory: deleting/recreating it causes Windows delete-pending
    // races with directory observers. Empty coordination storage is not quarantine.
    const remove=()=>{assertTicket();fs.unlinkSync(ticketFile);};
    try{
      for(;;){
        assertTicket();const head=entries()[0];let release:(()=>void)|undefined;
        // Poll immutable tickets outside the allocation gate. Waiting readers must
        // not delay the active writer's release, especially with slow disk flushes.
        if(head?.token===mine.token||(head&&head.pid!==process.pid&&absent(head.pid))){
          const gate=this.exclusive(allocator,deadline);
          try{assertTicket();if(liveQueue()[0]?.token===mine.token)release=this.exclusive(file,deadline);}
          finally{gate();}
        }
        if(release)return ()=>{
          const gate=this.exclusive(allocator,performance.now()+250);
          try{assertTicket();release!();remove();}finally{gate();}
        };
        if(performance.now()>=deadline)throw Object.assign(new Error('Cleanup writer unavailable'),{code:'CLEANUP_BUSY'});
        Atomics.wait(pause,0,0,5);
      }
    }catch(error){
      // Only remove our identity-bound ticket. Ambiguous evidence remains quarantined.
      try{const gate=this.exclusive(allocator,deadline);try{remove();}finally{gate();}}catch{}
      throw error;
    }
  }
  private mutate(change:(records:Map<string,CleanupRecord>)=>void):boolean{
    if(this.unavailableReason)return false;
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';let release:(()=>void)|undefined;let success=false;let stage:'acquire'|'reconcile'|'persist'='acquire';
    try{
      release=this.acquire();stage='reconcile';const next=this.read();
      for(const row of next.values()){const known=this.identities.get(row.id);if(known&&!sameRoot(known,row))throw new Error('Runtime identity collision');}
      for(const row of this.pending.values())next.set(row.id,{...row});
      change(next);
      stage='persist';const fd=fs.openSync(temporary,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(saved.parse({schemaVersion:1,records:[...next.values()]})));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,this.file);this.seenFile=true;this.pending.clear();this.accept(next);success=true;
    }catch(error){this.failureSystemCode=systemCode(error);const code=(error as {code?:unknown}).code;this.failureCode=code==='CLEANUP_BUSY'?'contention':code==='CLEANUP_EVIDENCE'||stage==='reconcile'?'evidence':'io';this.unavailableReason='Runtime cleanup evidence could not be saved or reconciled; capacity is quarantined';}
    finally{
      try{release?.();}catch{this.failureCode='ownership';this.unavailableReason='Runtime cleanup writer ownership is unverified; capacity is quarantined';success=false;}
      try{fs.unlinkSync(temporary);}catch{}
    }
    return success;
  }
  begin(record:CleanupRecord){
    const row=cleanupRecord.parse(record),known=this.identities.get(row.id);
    if(known&&!sameRoot(known,row)){this.failureCode='identity';this.unavailableReason='Runtime cleanup identity conflict; capacity is quarantined';this.changed();return;}
    this.identities.set(row.id,{...row});this.records.set(row.id,{...row});
    // Do not recreate a root that another office has already acknowledged.
    this.mutate(next=>{if(known&&!next.has(row.id))throw new Error('Stale runtime registration');next.set(row.id,{...row});});
    if(this.unavailableReason)this.pending.set(row.id,{...row});this.changed();
  }
  unverified(id:string){const record=this.records.get(id);if(record){record.state='unverified';this.mutate(next=>{const current=next.get(id);if(current)current.state='unverified';});this.changed();}}
  confirmed(id:string){
    const expected=this.records.get(id);if(!expected)return;
    this.mutate(next=>{const current=next.get(id);if(current&&!sameRoot(expected,current))throw new Error('Runtime identity changed');next.delete(id);});this.changed();
  }
}
