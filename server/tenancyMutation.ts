import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {z} from 'zod';
const record=z.strictObject({id:z.uuid(),owner:z.uuid(),ownerPid:z.number().int().positive(),action:z.enum(['sign-in','profile-selection']),startedAt:z.iso.datetime()});
const state=z.strictObject({schemaVersion:z.literal(1),active:record.nullable(),lastAcknowledgement:z.strictObject({id:z.uuid(),action:z.enum(['sign-in','profile-selection']),at:z.iso.datetime(),scope:z.enum(['native-authentication-terminal','profile-command-settled'])}).optional()});
import type {TenancyMutationView} from '../shared/tenancy.ts';
const digest=(bytes:Buffer|string)=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Intent precedes profile mutation. An old PID disappearing cannot establish
 * native exit or authorize another mutation. No automatic stale-owner recovery. */
export class TenancyMutationStore {
  private owner=crypto.randomUUID();private owned=new Map<string,string>();private seen=false;private failure=false;
  constructor(private file:string){}
  private read(){
    let fd:number;try{if(!fs.lstatSync(this.file).isFile())throw new Error('Nonregular authentication evidence');fd=fs.openSync(this.file,'r');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!this.seen)return {value:{schemaVersion:1 as const,active:null},fingerprint:null};throw error;}
    try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size>16384)throw new Error('Authentication evidence bound');const bytes=Buffer.alloc(before.size+1);let size=0;while(size<bytes.length){const count=fs.readSync(fd,bytes,size,bytes.length-size,size);if(!count)break;size+=count;}const after=fs.fstatSync(fd),current=fs.statSync(this.file);if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.ino!==before.ino||current.dev!==before.dev||current.size!==before.size||current.mtimeMs!==before.mtimeMs)throw new Error('Authentication evidence changed');const raw=bytes.subarray(0,size);const value=state.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));this.seen=true;return {value,fingerprint:digest(raw)};}finally{fs.closeSync(fd);}
  }
  private guarded<T>(fn:()=>T):T{
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const guard=this.file+'.guard';fs.mkdirSync(guard);
    try{return fn();}finally{fs.rmdirSync(guard);}
  }
  private write(value:z.infer<typeof state>){const temp=this.file+'.'+crypto.randomUUID()+'.tmp',bytes=JSON.stringify(value);let fd:number|undefined;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,this.file);this.seen=true;return digest(bytes);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}}
  view():TenancyMutationView{
    if(this.failure)return {status:'unavailable',quarantined:true,fingerprint:null,reason:'Authentication ownership evidence is invalid or changed. Preserve it and reconcile before starting work.'};
    try{return this.guarded(()=>{const {value,fingerprint}=this.read();if(!value.active)return {status:'clear' as const,quarantined:false,fingerprint};const owned=value.active.owner===this.owner&&this.owned.get(value.active.id)===fingerprint;return {status:'pending' as const,quarantined:!owned,fingerprint,action:value.active.action,startedAt:value.active.startedAt,...(!owned?{reason:'An earlier or different authentication owner has an unresolved profile mutation. Native outcome reconciliation is required; elapsed time or an absent PID does not clear it.'}:{})};});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')this.failure=true;return {status:'unavailable',quarantined:true,fingerprint:null,reason:'Authentication ownership evidence is unavailable or being written. New work remains held.'};}
  }
  begin(action:'sign-in'|'profile-selection'){
    if(this.failure)throw new Error('Authentication ownership evidence is unavailable');
    z.enum(['sign-in','profile-selection']).parse(action);
    return this.guarded(()=>{const {value}=this.read();if(value.active)throw new Error('Authentication profile mutation is unresolved');const active={id:crypto.randomUUID(),owner:this.owner,ownerPid:process.pid,action,startedAt:new Date().toISOString()};try{const fingerprint=this.write({...value,active});this.owned.set(active.id,fingerprint);return active.id;}catch(error){this.failure=true;throw error;}});
  }
  acknowledge(id:string,scope:'native-authentication-terminal'|'profile-command-settled'){
    if(this.failure)throw new Error('Authentication ownership evidence is unavailable');
    return this.guarded(()=>{const {value,fingerprint}=this.read();if(!value.active||value.active.id!==id||value.active.owner!==this.owner||this.owned.get(id)!==fingerprint||scope!==(value.active.action==='sign-in'?'native-authentication-terminal':'profile-command-settled')){this.failure=true;throw new Error('Authentication profile mutation ownership changed');}try{this.write({schemaVersion:1,active:null,lastAcknowledgement:{id,action:value.active.action,at:new Date().toISOString(),scope}});this.owned.delete(id);}catch(error){this.failure=true;throw error;}});
  }
}
