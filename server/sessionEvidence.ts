import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {usageSourceMatches} from './nativeUsage.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';

const text=z.string().max(500);
const eventSchema=z.object({kind:z.enum(['start','tool','result','finish','usage']),tool:text.optional(),callId:text.optional(),
  readiness:z.enum(['ready','blocked','not-required','discovery-only']).optional(),skillIds:z.array(text).max(16).optional(),probeIds:z.array(text).max(16).optional(),
  contractSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),skillBindings:z.array(z.object({id:text,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(16).optional(),
  outcome:z.enum(['allowed','blocked','success','failure','unknown','interrupted']).optional(),reason:z.enum(['governance','preflight','runtime','audit']).optional(),
  inputSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),resultSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  usageCoverage:z.enum(['complete','partial','unknown']).optional(),usageScope:z.literal('attempt').optional(),usageSource:z.enum(['opencode-message-v1','codex-response-v1','gemini-session-v1','unavailable']).optional(),
  inputTokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),outputTokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),costUsd:z.number().finite().nonnegative().nullable().optional(),
}).strict();
export type SessionEvidenceEvent=z.infer<typeof eventSchema>;
const entrySchema=eventSchema.extend({schemaVersion:z.literal(1),attemptId:z.uuid(),sequence:z.number().int().positive(),at:z.iso.datetime(),
  agentId:text,runtime:text,role:text,sourceRevision:z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),taskSha256:z.string().regex(/^[a-f0-9]{64}$/),resumed:z.boolean(),taskKey:text.optional(),coordinatorAttemptId:z.uuid().optional(),
}).strict().refine(row=>!['codex-response-v1','gemini-session-v1'].includes(row.usageSource??'')||row.costUsd==null,{message:'Native usage source has no verified USD contract'});

/** Append-only bounded metadata, never raw prompts, arguments, result bodies or credentials. */
export class SessionEvidence {
  readonly id=crypto.randomUUID();
  private file:string;
  private bytes=0;
  private sequence=0;
  private failed=false;
  constructor(home:string,private context:{agentId:string;runtime:string;role:string;sourceRevision:string|null;taskSha256:string;resumed:boolean;taskKey?:string;coordinatorAttemptId?:string}){
    this.file=path.join(home,'session-evidence',`${this.id}.jsonl`);
  }
  record(event:SessionEvidenceEvent):boolean{
    if(this.failed)return false;
    try{
      const entry=entrySchema.parse({schemaVersion:1,attemptId:this.id,sequence:++this.sequence,at:new Date().toISOString(),...this.context,...eventSchema.parse(event)});
      const line=JSON.stringify(entry)+'\n';const size=Buffer.byteLength(line);
      if(this.bytes+size>8*1024*1024)throw new Error('Evidence limit');
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      const fd=fs.openSync(this.file,'a',0o600);
      try{fs.writeFileSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      this.bytes+=size;return true;
    }catch{this.failed=true;return false;}
  }
}
/** Read bounded metadata without following archived/symlinked files or trusting mutable row identity. */
export function readSessionAttempts(home:string){
 const directory=path.join(home,'session-evidence');if(!fs.existsSync(directory))return [];
 if(fs.lstatSync(directory).isSymbolicLink()||!fs.lstatSync(directory).isDirectory())throw new Error('Session evidence directory unavailable');
 const files=fs.readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.jsonl$/.test(name));if(files.length>10000)throw new Error('Session evidence retention limit');
 return files.map(file=>{const id=file.slice(0,-6);try{const target=path.join(directory,file),stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8*1024*1024)throw new Error();const raw=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(target));if(!raw.endsWith('\n'))throw new Error();const rows=raw.trimEnd().split('\n').map(line=>entrySchema.parse(parseUnambiguousJson(line,{maxBytes:32768,maxDepth:16,maxSyntaxTokens:5000})));const first=rows[0];
  const identity=(r:typeof first)=>JSON.stringify([r.agentId,r.runtime,r.role,r.sourceRevision,r.taskSha256,r.resumed,r.taskKey,r.coordinatorAttemptId]);
  if(rows.some(r=>r.kind==='finish'&&!['success','failure','interrupted'].includes(r.outcome??''))||first?.kind!=='start'||rows.filter(r=>r.kind==='start').length!==1||rows.some((r,i)=>i>0&&Date.parse(r.at)<Date.parse(rows[i-1].at))||rows.some((r,i)=>r.attemptId!==id||r.sequence!==i+1||identity(r)!==identity(first)||i<rows.length-1&&r.kind==='finish')||rows.filter(r=>r.kind==='finish').length>1)throw new Error();
  return {id,rows,unreadable:false};
 }catch{return {id,rows:undefined,unreadable:true};}});
}
export function summarizeSessionEvidence(home:string){
  const report={attempts:0,success:0,failure:0,interrupted:0,incomplete:0,unreadable:0,blockedToolCalls:0,unknownTokenUsage:0,observedCostUsd:null as number|null,costMeasuredAttempts:0};
  const costs:number[]=[];
  for(const attempt of readSessionAttempts(home)){
    report.attempts++;
    if(attempt.unreadable||!attempt.rows){report.unreadable++;report.unknownTokenUsage++;continue;}
    const rows=attempt.rows,end=rows.at(-1)?.kind==='finish'?rows.at(-1):undefined;
    report.blockedToolCalls+=rows.filter(row=>row.kind==='tool'&&row.outcome==='blocked').length;
    if(!end)report.incomplete++;else if(end.outcome==='success')report.success++;else if(end.outcome==='interrupted')report.interrupted++;else report.failure++;
    const measured=usageSourceMatches(rows[0].runtime,end?.usageSource)&&end?.usageCoverage==='complete'&&end.usageScope==='attempt'&&end.inputTokens!=null&&end.outputTokens!=null;
    if(!measured)report.unknownTokenUsage++;
    if(measured&&end?.costUsd!=null){costs.push(end.costUsd);report.costMeasuredAttempts++;}
  }
  const cost=costs.reduce((a,b)=>a+b,0);if(costs.length&&Number.isFinite(cost))report.observedCostUsd=cost;
  return report;
}
export function evidenceHash(value:unknown):string{
  let serialized:string;try{serialized=JSON.stringify(value)??'null';}catch{serialized='uninspectable';}
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/** Read Git's recorded HEAD without spawning a process on every task admission. Dirty-tree status is not inferred. */
export function evidenceRevision(cwd:string):string|null{
  const read=(file:string)=>{if(fs.statSync(file).size>1024*1024)throw new Error('Oversized Git metadata');return fs.readFileSync(file,'utf8').trim();};
  try{
    let git=path.join(cwd,'.git');
    if(fs.statSync(git).isFile()){const link=read(git).match(/^gitdir: (.+)$/);if(!link)return null;git=path.resolve(cwd,link[1]);}
    const head=read(path.join(git,'HEAD'));if(/^[a-f0-9]{40,64}$/.test(head))return head;
    const ref=head.match(/^ref: (refs\/[\w./-]+)$/)?.[1];if(!ref||ref.split('/').some(part=>part==='..'||part==='.'||!part))return null;
    const common=fs.existsSync(path.join(git,'commondir'))?path.resolve(git,read(path.join(git,'commondir'))):git;
    for(const base of [git,common]){
      const file=path.join(base,ref);if(fs.existsSync(file)){const value=read(file);return /^[a-f0-9]{40,64}$/.test(value)?value:null;}
    }
    const packed=read(path.join(common,'packed-refs')).split('\n').find(line=>line.split(' ')[1]===ref)?.split(' ')[0];
    return packed&&/^[a-f0-9]{40,64}$/.test(packed)?packed:null;
  }catch{return null;}
}
