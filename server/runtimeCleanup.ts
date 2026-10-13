import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
export const cleanupRecord=z.strictObject({id:z.string().min(1).max(200),agentId:z.string().max(200),cli:z.string().max(100),pid:z.number().int().nonnegative(),keeperInstance:z.uuid().nullable(),requestedAt:z.number().int().nonnegative(),state:z.enum(['stopping','unverified'])});
export type CleanupRecord=z.infer<typeof cleanupRecord>;
export interface CleanupView {records:CleanupRecord[];unavailableReason?:string}
const saved=z.strictObject({schemaVersion:z.literal(1),records:z.array(cleanupRecord).max(500)}).refine(value=>new Set(value.records.map(row=>row.id)).size===value.records.length);
/** Durable quarantine: elapsed time and transport loss cannot acknowledge native exit. */
export class RuntimeCleanupStore {
  private records=new Map<string,CleanupRecord>();private unavailableReason:string|undefined;
  constructor(private file:string,private changed:()=>void=()=>{}){
    try{if(fs.statSync(file).size>1024*1024)throw new Error('oversized');for(const record of saved.parse(JSON.parse(fs.readFileSync(file,'utf8'))).records)this.records.set(record.id,{...record,state:'unverified'});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.unavailableReason='Runtime cleanup evidence is unreadable; capacity is quarantined';}
  }
  view():CleanupView{return {records:[...this.records.values()].map(row=>({...row})),...(this.unavailableReason?{unavailableReason:this.unavailableReason}:{})};}
  private persist(records:Map<string,CleanupRecord>):boolean{
    if(this.unavailableReason)return false;
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(saved.parse({schemaVersion:1,records:[...records.values()]})),{mode:0o600});fs.renameSync(temporary,this.file);return true;}
    catch{this.unavailableReason='Runtime cleanup evidence could not be saved; capacity is quarantined';try{fs.unlinkSync(temporary);}catch{}return false;}
  }
  begin(record:CleanupRecord){this.records.set(record.id,cleanupRecord.parse(record));this.persist(this.records);this.changed();}
  unverified(id:string){const record=this.records.get(id);if(record){record.state='unverified';this.persist(this.records);this.changed();}}
  confirmed(id:string){if(!this.records.has(id))return;const next=new Map(this.records);next.delete(id);if(this.persist(next))this.records=next;this.changed();}
}
