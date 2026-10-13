import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
export const cleanupRecord=z.strictObject({id:z.string().min(1).max(200),agentId:z.string().max(200),cli:z.string().max(100),pid:z.number().int().nonnegative(),keeperInstance:z.uuid().nullable(),requestedAt:z.number().int().nonnegative(),state:z.enum(['stopping','unverified'])});
export type CleanupRecord=z.infer<typeof cleanupRecord>;
export interface CleanupView {records:CleanupRecord[];unavailableReason?:string}
const saved=z.strictObject({schemaVersion:z.literal(1),records:z.array(cleanupRecord).max(500)}).refine(value=>new Set(value.records.map(row=>row.id)).size===value.records.length);
const lockRecord=z.strictObject({pid:z.number().int().positive(),token:z.uuid()});
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
    if(!before.isFile()||before.size>maximum)throw new Error('Invalid evidence file');
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
    catch{this.unavailableReason='Runtime cleanup evidence is unreadable or changed identity; capacity is quarantined';}
  }
  view():CleanupView{
    let busy:string|undefined;
    // Serialize readers too: a writer may be about to publish a new quarantine.
    if(!this.unavailableReason){
      try{const release=this.acquire();try{this.refresh();}finally{release();}}
      catch{busy='Runtime cleanup writer is unavailable; capacity is quarantined';}
    }
    const reason=this.unavailableReason??busy;
    return {records:[...this.records.values()].map(row=>({...row})),...(reason?{unavailableReason:reason}:{})};
  }
  private acquire():()=>void{
    const file=this.file+'.lock',guard=file+'.reaping',owner={pid:process.pid,token:crypto.randomUUID()};
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    // The lock is ephemeral coordination; durable cleanup records are flushed separately.
    const create=()=>{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(owner));}finally{fs.closeSync(fd);}};
    // Bound event-loop blocking; contention never acknowledges a native exit.
    const deadline=performance.now()+250;
    for(;;){
      try{create();break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      let value:unknown;
      try{value=readJson(file,4096);}catch(error){if(performance.now()>=deadline)throw error;Atomics.wait(pause,0,0,5);continue;}
      if(value===undefined){if(performance.now()>=deadline)throw new Error('Cleanup writer unavailable');continue;}
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
      if(performance.now()>=deadline)throw new Error('Cleanup writer unavailable');
      Atomics.wait(pause,0,0,5);
    }
    return ()=>{const current=lockRecord.parse(readJson(file,4096));if(current.token!==owner.token||current.pid!==owner.pid)throw new Error('Cleanup writer ownership lost');fs.unlinkSync(file);};
  }
  private mutate(change:(records:Map<string,CleanupRecord>)=>void):boolean{
    if(this.unavailableReason)return false;
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';let release:(()=>void)|undefined;let success=false;
    try{
      release=this.acquire();const next=this.read();
      for(const row of next.values()){const known=this.identities.get(row.id);if(known&&!sameRoot(known,row))throw new Error('Runtime identity collision');}
      for(const row of this.pending.values())next.set(row.id,{...row});
      change(next);
      const fd=fs.openSync(temporary,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(saved.parse({schemaVersion:1,records:[...next.values()]})));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,this.file);this.seenFile=true;this.pending.clear();this.accept(next);success=true;
    }catch{this.unavailableReason='Runtime cleanup evidence could not be saved or reconciled; capacity is quarantined';}
    finally{
      try{release?.();}catch{this.unavailableReason='Runtime cleanup writer ownership is unverified; capacity is quarantined';success=false;}
      try{fs.unlinkSync(temporary);}catch{}
    }
    return success;
  }
  begin(record:CleanupRecord){
    const row=cleanupRecord.parse(record),known=this.identities.get(row.id);
    if(known&&!sameRoot(known,row)){this.unavailableReason='Runtime cleanup identity conflict; capacity is quarantined';this.changed();return;}
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
