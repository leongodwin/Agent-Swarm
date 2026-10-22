import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseUnambiguousJson} from './unambiguousJson.ts';

type Runtime='codex'|'gemini';
type Row=Record<string,any>;
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=500;
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
function read(file:string){
 if(!path.isAbsolute(file)||file.length>4096)throw new Error();
 const resolved=path.resolve(file);let cursor=path.parse(resolved).root;
 for(const part of resolved.slice(cursor.length).split(path.sep)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw new Error();}
 const before=fs.lstatSync(file);if(!before.isFile()||before.size>16*1024*1024)throw new Error();
 const fd=fs.openSync(file,'r');let bytes:Buffer;
 try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.dev!==before.dev||stat.ino!==before.ino||stat.size!==before.size)throw new Error();bytes=Buffer.alloc(stat.size);if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw new Error();const after=fs.fstatSync(fd);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error();}finally{fs.closeSync(fd);}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const json=file.endsWith('.json');
 if(!json&&!raw.endsWith('\n'))throw new Error();
 const parse=(s:string)=>parseUnambiguousJson(s,{maxBytes:16*1024*1024,maxDepth:64,maxSyntaxTokens:500000}) as Row;
 const rows=json?[parse(raw)]:raw.trimEnd().split('\n').map(parse);
 if(rows.length>20000||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new Error();
 return {raw,rows,json};
}
function gemini(rows:Row[],json:boolean,session:string){
 const meta={...rows[0]};
 if(meta.sessionId!==session||!id(meta.projectHash)||meta.kind&&meta.kind!=='main')throw new Error();
 const messages:Row[]=json?meta.messages:rows.slice(1);if(!Array.isArray(messages))throw new Error();
 const byId=new Map<string,Row>();
 for(const row of messages){
  if(row.$patch){
   if(Object.keys(row).length!==1||typeof row.$patch!=='object'||Array.isArray(row.$patch))throw new Error();
   const patch=row.$patch,updates='updates' in patch?patch.updates:[patch];
   if('updates' in patch&&Object.keys(patch).length!==1||!Array.isArray(updates)||updates.length>1000)throw new Error();
   // Resume may rewrite displayed content; billing identity and counters must remain untouched.
   for(const update of updates)if(!update||typeof update!=='object'||!id(update.id)||!byId.has(update.id)||!('content' in update)||Object.keys(update).some(key=>!['id','content'].includes(key)))throw new Error();
   continue;
  }
  if(row.$set){
   if(Object.keys(row).length!==1||!row.$set||typeof row.$set!=='object'||Array.isArray(row.$set)||'messages' in row.$set)throw new Error();
   for(const key of ['sessionId','projectHash','kind'])if(key in row.$set&&row.$set[key]!==meta[key])throw new Error();
   continue;
  }
  // Rewinds and patches can remove billed observations. Do not invent replay semantics.
  if(!id(row.id)||!id(row.type)||Object.keys(row).some(k=>k.startsWith('$')))throw new Error();
  const previous=byId.get(row.id);if(previous&&previous.type!==row.type)throw new Error();
  if(previous?.tokens&&row.tokens&&JSON.stringify(previous.tokens)!==JSON.stringify(row.tokens))throw new Error();
  byId.set(row.id,row);
 }
 return {project:meta.projectHash,byId};
}
/** Versioned native records only. No terminal scraping, global history search, prices or cumulative token_count fallback. */
export class NativeTranscriptUsage {
 private file='';private session='';private turns=new Set<string>();private baseline='';private baselineLength=0;private json=false;
 private oldMessages=new Map<string,string>();private pinnedMessages=new Map<string,string>();private project='';private invalid=false;private started=false;private latestTurn='';private oldTurns=new Set<string>();private baselineRows=0;private geminiBoundary=new Set<string>();private prompts=0;
 constructor(private runtime:Runtime,private cwd:string,private currentAttempt=true){}
 prompt(body:Record<string,unknown>){
  if(!this.currentAttempt)return;
  try{
   if(typeof body.cwd!=='string'||!samePath(body.cwd,this.cwd)||!id(body.session_id)||typeof body.transcript_path!=='string')throw new Error();
   if(++this.prompts>1000)throw new Error();
   if(this.started){
    if(this.file!==body.transcript_path||this.session!==body.session_id)throw new Error();
    if(this.runtime==='gemini'){const data=read(this.file),parsed=gemini(data.rows,data.json,this.session);if(parsed.project!==this.project||![...parsed.byId].some(([key,row])=>!this.geminiBoundary.has(key)&&row.type==='gemini'&&row.tokens))throw new Error();for(const [key,signature] of this.pinnedMessages){const row=parsed.byId.get(key);if(!row||JSON.stringify([row.type,row.tokens??null])!==signature)throw new Error();}for(const [key,row] of parsed.byId)this.pinnedMessages.set(key,JSON.stringify([row.type,row.tokens??null]));this.geminiBoundary=new Set(parsed.byId.keys());}
   }
   else{
    const data=read(body.transcript_path);this.file=body.transcript_path;this.session=body.session_id;this.json=data.json;
    this.baseline=hash(data.raw);this.baselineLength=data.raw.length;this.baselineRows=data.rows.length;
    if(this.runtime==='gemini'){
     const parsed=gemini(data.rows,data.json,this.session);this.project=parsed.project;if(this.project!==hash(this.cwd))throw new Error();
     for(const [key,row] of parsed.byId)this.oldMessages.set(key,JSON.stringify([row.type,row.tokens??null]));this.pinnedMessages=new Map(this.oldMessages);this.geminiBoundary=new Set(parsed.byId.keys());
    }else{
     if(data.json||data.rows[0].type!=='session_meta'||data.rows[0].payload?.id!==this.session||data.rows[0].payload?.source!=='cli'||!samePath(data.rows[0].payload?.cwd??'',this.cwd))throw new Error();
     for(const row of data.rows)if(row.type==='token_usage_record'&&id(row.payload?.turn_id))this.oldTurns.add(row.payload.turn_id);
    }
    this.started=true;
   }
   if(this.runtime==='codex'){if(!id(body.turn_id)||this.oldTurns.has(body.turn_id)||this.turns.size>=1000&&!this.turns.has(body.turn_id))throw new Error();this.turns.add(body.turn_id);this.latestTurn=body.turn_id;}
  }catch{this.invalid=true;}
 }
 incomplete(){this.invalid=true;}
 completed(body:Record<string,unknown>){return body.session_id===this.session&&(this.runtime==='gemini'||body.turn_id===this.latestTurn);}
 snapshot(expectedSession:string|null,terminalObserved:boolean){
  let input=0,output=0,samples=0;let valid=this.currentAttempt&&this.started&&!this.invalid&&this.session===expectedSession;
  try{
   if(!valid)throw new Error();const data=read(this.file);
   if(data.json!==this.json||!data.json&&hash(data.raw.slice(0,this.baselineLength))!==this.baseline)throw new Error();
   if(this.runtime==='codex'){
    const meta=data.rows[0];if(meta.type!=='session_meta'||meta.payload?.id!==this.session||meta.payload?.source!=='cli'||!samePath(meta.payload?.cwd??'',this.cwd))throw new Error();
    const seen=new Map<string,string>();const covered=new Set<string>();let nativeSession='';
    for(const row of data.rows.slice(this.baselineRows)){if(row.type!=='token_usage_record')continue;const p=row.payload;
     if(!p||!this.turns.has(p.turn_id))throw new Error();
     if(p.thread_id!==this.session||p.root_turn_id!==p.turn_id||p.session_id!==this.session||!id(p.response_id))throw new Error();
     if(nativeSession&&nativeSession!==p.session_id)throw new Error();nativeSession=p.session_id;
     const u=p.usage;if(!u||!['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'].every(k=>count(u[k]))||!count(u.cache_write_input_tokens??0)||u.cached_input_tokens>u.input_tokens||u.reasoning_output_tokens>u.output_tokens||u.total_tokens!==u.input_tokens+u.output_tokens)throw new Error();
     const signature=JSON.stringify([p.turn_id,p.session_id,u]);const prior=seen.get(p.response_id);if(prior){if(prior!==signature)throw new Error();continue;}
     if(seen.size>=1000)throw new Error();seen.set(p.response_id,signature);covered.add(p.turn_id);samples++;input+=u.input_tokens;output+=u.output_tokens;
    }
    if(covered.size!==this.turns.size)throw new Error();
   }else{
    const parsed=gemini(data.rows,data.json,this.session);if(parsed.project!==this.project||![...parsed.byId].some(([key,row])=>!this.geminiBoundary.has(key)&&row.type==='gemini'))throw new Error();
    for(const [key,signature] of this.pinnedMessages){const row=parsed.byId.get(key);if(!row||JSON.stringify([row.type,row.tokens??null])!==signature)throw new Error();}
    for(const [key,row] of parsed.byId){if(this.oldMessages.has(key))continue;if(row.type==='error')throw new Error();if(row.type!=='gemini')continue;
     const t=row.tokens;if(!t||!['input','output','cached','total'].every(k=>count(t[k]))||!count(t.thoughts??0)||!count(t.tool??0)||t.cached>t.input||t.total!==t.input+(t.tool??0)+t.output+(t.thoughts??0))throw new Error();
     input+=t.input+(t.tool??0);output+=t.output+(t.thoughts??0);samples++;
    }
   }
   valid=terminalObserved&&samples>0&&Number.isSafeInteger(input)&&Number.isSafeInteger(output);
  }catch{valid=false;}
  return {inputTokens:valid?input:null,outputTokens:valid?output:null,costUsd:null,usageCoverage:valid?'complete' as const:this.started?'partial' as const:'unknown' as const,usageScope:'attempt' as const,usageSource:this.runtime==='codex'?'codex-response-v1' as const:'gemini-session-v1' as const};
 }
}
