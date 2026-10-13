import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';

const identitySchema=z.object({tenantId:z.uuid(),caller:z.email().max(254)}).strict();
const requestSchema=z.discriminatedUnion('action',[
  z.object({type:z.literal('office:policy'),action:z.literal('read'),ownerId:z.uuid(),requestId:z.uuid(),identity:identitySchema}).strict(),
  z.object({type:z.literal('office:policy'),action:z.literal('release'),ownerId:z.uuid(),keepWarm:z.boolean()}).strict(),
]);

/** Native authentication remains only in the PowerShell process, with bounded read/close commands. */
export function nativePolicyReader(readerPath) {
  return (identity,result,ended,requestId)=>{
    if(process.platform!=='win32')throw new Error('Policy discovery requires Windows PowerShell');
    const child=spawn('powershell.exe',['-NoProfile','-File',readerPath,'-TenantId',identity.tenantId,'-ExpectedUser',identity.caller,'-RequestId',requestId],{windowsHide:true,stdio:'pipe'});
    const lines=createInterface({input:child.stdout});let bytes=0,stopped=false;
    const finish=()=>{if(stopped)return;stopped=true;lines.close();ended();};
    child.stdout.on('data',buffer=>{bytes+=buffer.length;if(bytes>8*1024*1024){finish();child.kill();}});
    child.stderr.on('data',()=>{});
    lines.on('line',line=>{
      if(!line.startsWith('SWARM_DLP '))return;
      bytes=0;
      try {const envelope=z.object({requestId:z.uuid(),result:z.unknown()}).strict().parse(JSON.parse(line.slice(10)));result(envelope.result,envelope.requestId);}
      catch {finish();child.kill();}
    });
    child.stdin.on('error',finish);child.once('error',finish);child.once('close',finish);
    return {pid:child.pid,refresh(id){if(stopped)throw new Error('Policy reader ended');child.stdin.write(JSON.stringify({command:'refresh',requestId:id})+'\n');},stop(){if(stopped)return;finish();child.stdin.end('close\n');child.kill();}};
  };
}

/** One authenticated account per launcher. No sockets, token files, tenant writes or arbitrary commands. */
export class PolicyReaderHost {
  constructor(readerPath,start=nativePolicyReader(readerPath),idleMs=30*60_000) {this.readerPath=readerPath;this.start=start;this.idleMs=idleMs;this.slot=undefined;}
  send(owner,event,extra={}) {if(owner?.client.connected!==false)try {owner?.client.send({type:'office:policy',ownerId:owner.ownerId,requestId:owner.requestId,event,...extra},()=>{});}catch {/* An exiting office cannot receive evidence. */}}
  handle(client,input) {
    const parsed=requestSchema.safeParse(input);if(!parsed.success)return false;
    const message=parsed.data;
    if(client.connected===false)return true;
    if(message.action==='release') {
      const slot=this.slot;if(!slot)return true;
      if(slot.queued?.client===client&&slot.queued.ownerId===message.ownerId)slot.queued=undefined;
      if(slot.owner?.client===client&&slot.owner.ownerId===message.ownerId) {
        if(!message.keepWarm)this.clear();else {slot.owner=undefined;this.expire(slot);}
      }
      return true;
    }
    const owner={client,ownerId:message.ownerId,requestId:message.requestId,identity:message.identity};
    let revision;
    try {revision=createHash('sha256').update(readFileSync(this.readerPath)).digest('hex');}
    catch {this.clear();this.send(owner,'ended');return true;}
    const key=JSON.stringify([message.identity.tenantId.toLowerCase(),message.identity.caller.toLowerCase()]);
    let slot=this.slot;
    const claimed=slot?.owner??slot?.queued;
    if(claimed&&(claimed.client!==client||claimed.ownerId!==message.ownerId)) {this.send(owner,'ended');return true;}
    if(slot&&(slot.key!==key||slot.revision!==revision)) {this.clear();slot=undefined;}
    if(slot?.busy) {
      if(slot.owner||slot.queued){this.send(owner,'ended');return true;}
      slot.queued=owner;return true;
    }
    if(slot) {this.read(slot,owner);return true;}
    slot={key,revision,owner,busy:owner.requestId,busyUntil:Date.now()+10*60_000,reader:undefined,timer:undefined,queued:undefined};this.slot=slot;this.expire(slot);
    try {
      const reader=this.start(message.identity,(result,id)=>this.result(slot,result,id),()=>this.ended(slot),message.requestId);
      if(this.slot===slot){slot.reader=reader;this.send(owner,'ready',{pid:reader.pid});}else reader.stop();
    } catch {this.ended(slot);}
    return true;
  }
  read(slot,owner) {
    slot.owner=owner;slot.busy=owner.requestId;slot.busyUntil=Date.now()+10*60_000;this.expire(slot);
    try {slot.reader.refresh(owner.requestId);this.send(owner,'ready',{pid:slot.reader.pid});}catch {this.clear();}
  }
  result(slot,result,id) {
    if(this.slot!==slot||slot.busy!==id)return;
    const owner=slot.owner;slot.busy=undefined;
    if(owner?.requestId===id)this.send(owner,'result',{result});
    this.expire(slot);
    const queued=slot.queued;slot.queued=undefined;if(queued)this.read(slot,queued);
  }
  expire(slot) {clearTimeout(slot.timer);slot.timer=setTimeout(()=>{if(this.slot===slot)this.clear();},slot.busy?Math.max(0,slot.busyUntil-Date.now()):this.idleMs);slot.timer.unref?.();}
  ended(slot) {
    if(this.slot!==slot)return;this.slot=undefined;clearTimeout(slot.timer);this.send(slot.owner,'ended');this.send(slot.queued,'ended');
  }
  disconnect(client,keepWarm=false) {
    const slot=this.slot;if(!slot)return;
    if(slot.queued?.client===client)slot.queued=undefined;
    if(slot.owner?.client!==client)return;
    if(keepWarm){slot.owner=undefined;this.expire(slot);}else this.clear();
  }
  clear() {const slot=this.slot;if(!slot)return;this.ended(slot);slot.reader?.stop();}
}
