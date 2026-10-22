import {usageSourceMatches} from './nativeUsage.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {HttpError} from './httpError.ts';
import {readSessionAttempts} from './sessionEvidence.ts';
import type {EfficiencyReport} from '../shared/efficiency.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),when=z.iso.datetime(),id=z.uuid(),text=z.string().min(1).max(240);
export const attemptContextSchema=z.strictObject({repoId:text,agentId:text,role:z.enum(['dev','qa']),runtime:z.enum(['codex','gemini','opencode']),task:z.enum(['issue','fix','qa','review']),issue:z.number().int().positive().nullable(),scopeHash:hash,admissionHash:hash});
export type AttemptContext=z.infer<typeof attemptContextSchema>;
const eventSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('collection'),collectionId:id,at:when}),
 z.strictObject({kind:z.literal('reserve'),id,at:when,context:attemptContextSchema,automatic:z.boolean()}),
 z.strictObject({kind:z.literal('launch'),id,at:when}),
 z.strictObject({kind:z.literal('finish'),id,at:when,outcome:z.enum(['reported-success','failure','blocked','interrupted']),sessionEvidenceId:id.optional()}),
 z.strictObject({kind:z.literal('accept'),id:hash,at:when,repoId:text,issue:z.number().int().positive(),scopeHash:hash,prNumber:z.number().int().positive(),headSha:z.string().regex(/^[a-f0-9]{40,64}$/),reviewer:text,evidenceHash:hash}),
]);
type Event=z.infer<typeof eventSchema>;
type Attempt=Extract<Event,{kind:'reserve'}>&{launch?:Extract<Event,{kind:'launch'}>;finish?:Extract<Event,{kind:'finish'}>};
const MAX_BYTES=8*1024*1024,MAX_EVENTS=10000,CAP=3;
export const ledgerKey=(c:AttemptContext)=>JSON.stringify([c.repoId,c.issue,c.role,c.scopeHash,c.admissionHash]);
/** Bounded append-only metadata. Exhaustion/corruption preserves bytes and holds new reservations. */
export class ExecutionLedger {
 private events:Event[]=[];private acceptanceIds=new Set<string>();private attempts=new Map<string,Attempt>();private ready=false;private bytes=0;
 private file:string;private digest:string|null=null;
 private intact(){if(!this.ready)return false;try{const stat=fs.lstatSync(this.file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==this.bytes||this.digest!==crypto.createHash('sha256').update(fs.readFileSync(this.file)).digest('hex'))throw new Error();return true;}catch{this.ready=false;return false;}}
 constructor(private home:string){this.file=path.join(home,'execution-ledger.jsonl');}
 init(){
  try{
   if(fs.existsSync(this.file)){const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw new Error();const bytes=fs.readFileSync(this.file);this.bytes=bytes.length;this.digest=crypto.createHash('sha256').update(bytes).digest('hex');const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!raw.endsWith('\n'))throw new Error();const lines=raw.trimEnd().split('\n');if(lines.length>MAX_EVENTS)throw new Error();for(const [index,line]of lines.entries()){const row=parseUnambiguousJson(line,{maxBytes:8192,maxDepth:10,maxSyntaxTokens:500});const parsed=z.strictObject({sequence:z.number().int().positive(),event:eventSchema}).parse(row);if(parsed.sequence!==index+1)throw new Error();this.apply(parsed.event);}}
   else{fs.mkdirSync(this.home,{recursive:true});this.ready=true;this.append({kind:'collection',collectionId:crypto.randomUUID(),at:new Date().toISOString()});}
   if(this.events[0]?.kind!=='collection')throw new Error();this.ready=true;
   // Office restart is an interruption, never a reconstructed success or zero-token attempt.
   for(const row of this.attempts.values())if(!row.finish)this.finish(row.id,'interrupted');
  }catch{this.ready=false;}
 }
 private apply(event:Event){
  if(event.kind==='collection'){if(this.events.length)throw new Error('Duplicate collection');}
  else if(!this.events.length)throw new Error('Missing collection');
  else if(event.kind==='reserve'){if(this.attempts.has(event.id))throw new Error('Duplicate attempt');this.attempts.set(event.id,{...event});}
  else if(event.kind==='launch'||event.kind==='finish'){const attempt=this.attempts.get(event.id);if(!attempt||attempt.finish||event.kind==='launch'&&attempt.launch||Date.parse(event.at)<Date.parse(attempt.at))throw new Error('Invalid attempt transition');if(event.kind==='launch')attempt.launch=event;else{if(event.sessionEvidenceId&&!attempt.launch)throw new Error('Session without launch');attempt.finish=event;}}
  else if(event.kind==='accept'){if(this.acceptanceIds.has(event.id))throw new Error('Duplicate acceptance');this.acceptanceIds.add(event.id);}
  this.events.push(event);
 }
 private append(event:Event){
  if(this.events.length&&!this.intact()||!this.ready)throw new HttpError(409,'Execution telemetry unavailable; preserve its ledger and repair storage before retrying');
  try{const checked=eventSchema.parse(event),line=JSON.stringify({sequence:this.events.length+1,event:checked})+'\n';if(this.events.length>=MAX_EVENTS||this.bytes+Buffer.byteLength(line)>MAX_BYTES)throw new Error('Retention full');
   const stat=fs.existsSync(this.file)?fs.lstatSync(this.file):null;if(this.events.length&&(!stat||!stat.isFile()||stat.isSymbolicLink()||stat.size!==this.bytes))throw new Error('Ledger changed');
   const fd=fs.openSync(this.file,'a',0o600);try{fs.writeFileSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.bytes+=Buffer.byteLength(line);this.digest=crypto.createHash('sha256').update(fs.readFileSync(this.file)).digest('hex');this.apply(checked);
  }catch{this.ready=false;throw new HttpError(409,'Execution telemetry cannot be persisted; preserve/export history and repair storage');}
 }
 blocked(context:AttemptContext){if(!this.intact())return 'Execution telemetry unavailable; repair its retained history';const count=[...this.attempts.values()].filter(a=>ledgerKey(a.context)===ledgerKey(context)).length;return count>=CAP?'Automatic execution budget reached for this unchanged scope/configuration; inspect evidence and use an explicit manual retry or repair the context':null;}
 reserve(context:AttemptContext,automatic=false){const parsed=attemptContextSchema.parse(context);if(automatic){const blocker=this.blocked(parsed);if(blocker)throw new HttpError(409,blocker);}const id=crypto.randomUUID();this.append({kind:'reserve',id,at:new Date().toISOString(),context:parsed,automatic});return id;}
 launch(id:string){const row=this.attempts.get(id);if(!row||row.finish)throw new HttpError(409,'Attempt no longer owns execution');if(!row.launch)this.append({kind:'launch',id,at:new Date().toISOString()});}
 finish(id:string,outcome:Extract<Event,{kind:'finish'}>['outcome'],sessionEvidenceId?:string){if(!this.attempts.get(id)||this.attempts.get(id)!.finish)return;if(sessionEvidenceId&&!this.attempts.get(id)!.launch)throw new HttpError(409,'Session without launch');this.append({kind:'finish',id,at:new Date().toISOString(),outcome,...(sessionEvidenceId?{sessionEvidenceId}:{})});}
 accept(value:Omit<Extract<Event,{kind:'accept'}>,'kind'|'id'|'at'>){const id=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');if(this.acceptanceIds.has(id))return;this.append({kind:'accept',id,at:new Date().toISOString(),...value});}
 export(){if(!this.intact())throw new HttpError(409,'Execution ledger unavailable; preserve raw bytes for recovery');return structuredClone(this.events);}
 exportFor(repoId:string){const events=this.export(),ids=new Set(events.filter(e=>e.kind==='reserve'&&e.context.repoId===repoId).map(e=>e.kind==='reserve'?e.id:''));return events.filter(e=>e.kind==='collection'||e.kind==='reserve'&&e.context.repoId===repoId||e.kind==='accept'&&e.repoId===repoId||(e.kind==='launch'||e.kind==='finish')&&ids.has(e.id));}
 report(repoId:string,current:(receipt:Extract<Event,{kind:'accept'}>)=>boolean,now=Date.now()):EfficiencyReport{
  this.intact();
  const from=now-30*86400000,collection=this.events[0],rows=[...this.attempts.values()].filter(a=>a.context.repoId===repoId&&Date.parse(a.at)>=from&&Date.parse(a.at)<=now);
  const report:EfficiencyReport={availability:this.ready?'ready':'unavailable',scope:'retained-coordinator-attempts',observedAt:new Date(now).toISOString(),collectionStartedAt:collection?.kind==='collection'?collection.at:null,window:{from:new Date(from).toISOString(),to:new Date(now).toISOString()},completeWindow:false,counts:{reserved:rows.length,launched:rows.filter(a=>a.launch).length,reportedSuccess:0,failure:0,blocked:0,interrupted:0,incomplete:0,sessionEvidenceMissing:0,sessionEvidenceUnreadable:0,acceptedHistorical:0,acceptedCurrent:0,acceptedMeasured:0,acceptedUnknownUsage:0},usage:{inputTokens:null,outputTokens:null,costUsd:null,measuredAttempts:0,unknownAttempts:0,tokensPerAcceptedTask:null,costPerAcceptedTask:null},retryHolds:[],recent:[],reason:'Retained coordinator attempts only; model completion is not independent acceptance. Unknown usage is not zero.',limitations:['No all-time completeness or token savings claim. Archive/deletion starts a new retained collection.','CEO/synthesis jobs and rejected requests before reservation are outside this ledger.','Accepted outcomes are independently reviewed merged tasks, not deployed applications.','Usage is provider-reported work, not a billing invoice; missing runtimes remain unknown.','Native root-session receipts do not prove complete delegated, ancillary or failed-before-receipt provider work.']};
  if(!this.ready){report.reason='Execution ledger is unavailable; partial counts cannot authorize work or establish efficiency';return report;}
  let sessions:ReturnType<typeof readSessionAttempts>;try{sessions=readSessionAttempts(this.home);}catch{report.availability='unavailable';report.reason='Session usage evidence is unavailable; preserve its files before recovery';return report;}
  const usages=new Map<string,{input:number;output:number;cost:number|null}>();
  for(const a of rows){if(!a.finish)report.counts.incomplete++;else if(a.finish.outcome==='reported-success')report.counts.reportedSuccess++;else report.counts[a.finish.outcome]++;
   const session=a.finish?.sessionEvidenceId?sessions.find(s=>s.id===a.finish!.sessionEvidenceId):undefined;
   if(a.launch&&!session)report.counts.sessionEvidenceMissing++;
   if(session?.unreadable)report.counts.sessionEvidenceUnreadable++;
   const end=session?.rows?.at(-1),first=session?.rows?.[0];
   if(a.finish&&!a.launch){usages.set(a.id,{input:0,output:0,cost:0});report.usage.measuredAttempts++;}
   else if(a.finish&&session&&!session.unreadable&&first?.kind==='start'&&Date.parse(first.at)>=Date.parse(a.launch!.at)&&Date.parse(end?.at??'')<=Date.parse(a.finish.at)&&first.role===a.context.role&&first.agentId===a.context.agentId&&first.runtime===a.context.runtime&&first.coordinatorAttemptId===a.id&&end?.kind==='finish'&&end.outcome===(a.finish.outcome==='reported-success'?'success':a.finish.outcome==='interrupted'?'interrupted':'failure')&&usageSourceMatches(a.context.runtime,end.usageSource)&&end.usageCoverage==='complete'&&end.usageScope==='attempt'&&end.inputTokens!=null&&end.outputTokens!=null){usages.set(a.id,{input:end.inputTokens,output:end.outputTokens,cost:end.costUsd??null});report.usage.measuredAttempts++;}
   else report.usage.unknownAttempts++;
   report.recent.push({id:a.id,issue:a.context.issue,role:a.context.role,runtime:a.context.runtime,status:a.finish?.outcome??'incomplete',launched:!!a.launch,usage:usages.has(a.id)?'measured':'unknown'});
  }
  if(usages.size){const input=[...usages.values()].reduce((n,u)=>n+u.input,0),output=[...usages.values()].reduce((n,u)=>n+u.output,0);report.usage.inputTokens=Number.isSafeInteger(input)?input:null;report.usage.outputTokens=Number.isSafeInteger(output)?output:null;if([...usages.values()].every(u=>u.cost!==null)){const total=[...usages.values()].reduce((n,u)=>n+u.cost!,0);report.usage.costUsd=Number.isFinite(total)?total:null;}}
  const accepted=this.events.filter((e):e is Extract<Event,{kind:'accept'}>=>e.kind==='accept'&&e.repoId===repoId&&Date.parse(e.at)>=from&&Date.parse(e.at)<=now);report.counts.acceptedHistorical=accepted.length;
  let tokenTotal=0,costTotal=0,costComplete=true;const scopes=new Set<string>();
  for(const receipt of accepted){let valid=false;try{valid=current(receipt);}catch{report.availability='unavailable';report.reason='Current acceptance authority is unavailable; efficiency ratios are withheld';return report;}if(!valid)continue;const key=`${receipt.issue}:${receipt.scopeHash}`;if(scopes.has(key))continue;scopes.add(key);report.counts.acceptedCurrent++;
   const attempts=[...this.attempts.values()].filter(a=>a.context.repoId===repoId&&a.context.issue===receipt.issue&&a.context.scopeHash===receipt.scopeHash&&Date.parse(a.at)<=Date.parse(receipt.at));
   if(!attempts.length||attempts.some(a=>!a.finish||!usages.has(a.id))){report.counts.acceptedUnknownUsage++;continue;}
   report.counts.acceptedMeasured++;for(const a of attempts){const usage=usages.get(a.id)!;tokenTotal+=usage.input+usage.output;if(usage.cost===null)costComplete=false;else costTotal+=usage.cost;}
  }
  if(report.counts.acceptedMeasured){if(Number.isSafeInteger(tokenTotal))report.usage.tokensPerAcceptedTask=tokenTotal/report.counts.acceptedMeasured;if(costComplete&&Number.isFinite(costTotal))report.usage.costPerAcceptedTask=costTotal/report.counts.acceptedMeasured;}
  const keys=new Set<string>();for(const a of rows){const key=ledgerKey(a.context);if(keys.has(key))continue;keys.add(key);const count=[...this.attempts.values()].filter(r=>ledgerKey(r.context)===key).length;if(count>=CAP)report.retryHolds.push({issue:a.context.issue,role:a.context.role,attempts:count});}
  report.recent=report.recent.slice(-20).reverse();report.completeWindow=!!report.collectionStartedAt&&Date.parse(report.collectionStartedAt)<=from;return report;
 }
}
