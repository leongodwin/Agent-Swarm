import crypto from 'node:crypto';
import {z} from 'zod';
import {ghJson} from './exec.ts';
import type {WorkflowReliability} from '../shared/workflowReliability.ts';
export type WorkflowReader=(resource:string)=>Promise<unknown>;
const name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/).max(200).refine(value=>!['.','..'].includes(value.split('/')[1]));
const repoSchema=z.object({id:z.number().int().positive(),full_name:name});
const runSchema=z.object({id:z.number().int().positive(),workflow_id:z.number().int().positive(),run_attempt:z.number().int().min(1).max(50),head_sha:z.string().regex(/^[a-f0-9]{40}$/i),
  name:z.string().max(400).nullable(),status:z.enum(['completed','queued','in_progress','waiting','pending','requested']),conclusion:z.enum(['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure']).nullable(),
  created_at:z.iso.datetime({offset:true}),updated_at:z.iso.datetime({offset:true}),repository:repoSchema,
}).superRefine((run,ctx)=>{if((run.status==='completed')!==(run.conclusion!==null))ctx.addIssue({code:'custom',message:'Outcome/status mismatch'});if(Date.parse(run.updated_at)<Date.parse(run.created_at))ctx.addIssue({code:'custom',message:'Run chronology is inconsistent'});});
const pageSchema=z.object({total_count:z.number().int().nonnegative().max(999),workflow_runs:z.array(runSchema).max(100)});
type Run=z.infer<typeof runSchema>;
const fingerprint=(runs:Run[])=>crypto.createHash('sha256').update(JSON.stringify(runs.slice().sort((a,b)=>a.id-b.id))).digest('hex');
const note='All attempts of workflow runs created in this window, across workflows/branches, including workflows beyond CI tests. Other CI providers and tenant integration runs are not included; this observation does not prove future reliability or release readiness.';

/** Read-only, bounded history. A successful rerun does not erase a failed attempt. */
export async function observeWorkflowReliability(repo:string,read:WorkflowReader,now=Date.now()):Promise<WorkflowReliability>{
  const window={from:new Date(now-30*86400000).toISOString(),to:new Date(now).toISOString()};
  const base:WorkflowReliability={status:'unavailable',scope:'github-actions-run-creation-window',repo,observedAt:new Date(now).toISOString(),window,complete:false,targetPercent:99.5,reason:'GitHub Actions history is unavailable or incomplete; repository access, stable pagination and every attempt are required',completed:null,successful:null,unsuccessful:null,active:null,rerunAttempts:null,successPercent:null,observedMeetsTarget:null,failures:[]};
  try{
    name.parse(repo);const pinned=repoSchema.parse(await read(`repos/${repo}`));if(pinned.full_name.toLowerCase()!==repo.toLowerCase())throw new Error('Repository mismatch');
    const identity=z.object({id:z.number().int().positive()}).parse(await read('user'));
    const query=`created=${encodeURIComponent(window.from+'..'+window.to)}&per_page=100`;
    const inventory=async()=>{
      const runs:Run[]=[];let total:number|undefined;
      for(let page=1;page<=10;page++){
        const value=pageSchema.parse(await read(`repos/${repo}/actions/runs?${query}&page=${page}`));
        if(total===undefined)total=value.total_count;else if(total!==value.total_count)throw new Error('Pagination changed');
        if(value.workflow_runs.some(run=>run.repository.id!==pinned.id||run.repository.full_name.toLowerCase()!==repo.toLowerCase()||Date.parse(run.created_at)<now-30*86400000||Date.parse(run.created_at)>now))throw new Error('Run scope differs');
        runs.push(...value.workflow_runs);if(new Set(runs.map(run=>run.id)).size!==runs.length||runs.length>total)throw new Error('Ambiguous history');
        if(runs.length===total)return runs;
        if(value.workflow_runs.length<100)throw new Error('Incomplete pagination');
      }
      throw new Error('History limit');
    };
    const before=await inventory();if(before.reduce((sum,run)=>sum+run.run_attempt,0)>2000)throw new Error('Attempt limit');
    const attempts:Run[]=[];
    const older=before.flatMap(latest=>{attempts.push(latest);return Array.from({length:latest.run_attempt-1},(_,index)=>({latest,attempt:index+1}));});
    let cursor=0,failed=false;
    const workers=await Promise.allSettled(Array.from({length:Math.min(4,older.length)},async()=>{
      while(!failed&&cursor<older.length){
        const {latest,attempt}=older[cursor++];
        let actual:Run;try{actual=runSchema.parse(await read(`repos/${repo}/actions/runs/${latest.id}/attempts/${attempt}`));}catch(error){failed=true;throw error;}
        if(actual.id!==latest.id||actual.workflow_id!==latest.workflow_id||actual.run_attempt!==attempt||actual.head_sha!==latest.head_sha||actual.repository.id!==pinned.id||actual.repository.full_name.toLowerCase()!==repo.toLowerCase()||attempt<latest.run_attempt&&actual.status!=='completed'){failed=true;throw new Error('Attempt binding differs');}
        attempts.push(actual);
      }
    }));
    if(workers.some(worker=>worker.status==='rejected'))throw new Error('Attempt history unavailable');
    const after=await inventory(),afterRepo=repoSchema.parse(await read(`repos/${repo}`)),afterIdentity=z.object({id:z.number().int().positive()}).parse(await read('user'));
    if(fingerprint(before)!==fingerprint(after)||afterRepo.id!==pinned.id||afterRepo.full_name.toLowerCase()!==repo.toLowerCase()||identity.id!==afterIdentity.id)throw new Error('History/identity changed');
    attempts.sort((a,b)=>b.id-a.id||a.run_attempt-b.run_attempt);
    const completed=attempts.filter(run=>run.status==='completed'),successful=completed.filter(run=>run.conclusion==='success').length;
    return {...base,status:'observed',complete:true,observedAt:new Date().toISOString(),reason:note,completed:completed.length,successful,unsuccessful:completed.length-successful,active:attempts.length-completed.length,rerunAttempts:attempts.length-before.length,
      successPercent:completed.length?successful/completed.length*100:null,observedMeetsTarget:completed.length?successful*10000>=completed.length*9950:null,evidenceSha256:fingerprint(attempts),
      failures:completed.filter(run=>run.conclusion!=='success').slice(0,10).map(run=>({runId:run.id,attempt:run.run_attempt,name:run.name??'Unnamed workflow',conclusion:run.conclusion!,headSha:run.head_sha,url:`https://github.com/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}`}))};
  }catch{return base;}
}

/** Reuse gh authentication; pin the public API host and never execute a write. */
export class WorkflowReliabilityService {
  private cache=new Map<string,{at:number;value:WorkflowReliability}>();private pending=new Map<string,Promise<WorkflowReliability>>();
  constructor(private read:WorkflowReader=resource=>ghJson(['api','--hostname','github.com','--method','GET',resource],{timeoutMs:8000}),private clock=Date.now){}
  observe(repo:string){
    name.parse(repo);const started=this.clock(),key=repo.toLowerCase(),cached=this.cache.get(key);if(cached&&started-cached.at>=0&&started-cached.at<60000)return Promise.resolve(structuredClone(cached.value));
    const existing=this.pending.get(key);if(existing)return existing.then(value=>structuredClone(value));
    let calls=0,budgetLost=false;
    const checkBudget=()=>{const elapsed=this.clock()-started;if(budgetLost||elapsed<0||elapsed>=50000){budgetLost=true;throw new Error('History observation budget expired');}};
    const bounded=async(resource:string)=>{checkBudget();if(++calls>2040)throw new Error('History read limit exceeded');const value=await this.read(resource);checkBudget();return value;};
    const work=observeWorkflowReliability(repo,bounded,started).then(value=>{
      const finished=this.clock();if(finished-started<0||finished-started>=50000)budgetLost=true;
      if(budgetLost)return {...value,status:'unavailable' as const,complete:false,completed:null,successful:null,unsuccessful:null,active:null,rerunAttempts:null,successPercent:null,observedMeetsTarget:null,evidenceSha256:undefined,failures:[],reason:'GitHub Actions history exceeded its observation budget or the clock changed; no partial statistics were accepted'};
      if(this.cache.size>=100)this.cache.clear();if(value.status==='observed'){value.observedAt=new Date(finished).toISOString();this.cache.set(key,{at:finished,value});}return value;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,work);return work.then(value=>structuredClone(value));
  }
}
