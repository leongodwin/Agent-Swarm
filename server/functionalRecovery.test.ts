import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it,expect,afterEach} from 'vitest';
import {functionalFixture} from './testFixtures/functionalShowcase.ts';
import {createFunctionalRecovery,functionalRecoveryEvidence} from './functionalRecovery.ts';
import type {SharepointRequest} from './sharepointProvisioning.ts';
import type {FlowAdapter} from './flowAdapter.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'functional-recovery-'));roots.push(root);const f=functionalFixture(),captureRoot=path.join(root,'captures'),items=new Map<string,any>(),runs=new Map<string,any>(),versions=new Map<string,any[]>(),evidence=root;let drift=false,wall=Date.now()-10000;
 f.context.startedAt=new Date(wall-1000).toISOString();const stamp=(n:number)=>new Date(n).toISOString();const time=()=>{wall+=50;const t={startTime:stamp(wall),endTime:stamp(wall+10)};wall+=20;return t;};
 const definition=()=>({triggers:{OnNew:{type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',operationId:'GetOnUpdatedItems'},parameters:{dataset:f.target.siteUrl,table:drift?f.flowId:f.target.listId}}}}});
 const graph:SharepointRequest=async(method,url)=>{if(method!=='GET')throw Error('Observer attempted mutation');const id=/\/items\/([0-9]+)\?/.exec(url)?.[1],version=/\/items\/([0-9]+)\/versions(?:\/([0-9.]+))?\?/.exec(url);if(version){const values=versions.get(version[1])??[];return structuredClone(version[2]?values.find(v=>v.id===version[2]):{value:values.map(({fields:_fields,...meta})=>meta)});}return structuredClone(id?items.get(id):{value:[...items.values()]});};
 const flow:FlowAdapter={close:async()=>{},call:async(tool,args)=>{if(tool==='get_flow')return definition();if(tool==='get_run_history')return [...runs].map(([name,row])=>({name,status:'Succeeded',...row.time}));const row=runs.get(String(args.run));if(!row)throw Error('Unknown run');if(tool==='get_run_details')return{name:args.run,id:`/providers/Microsoft.ProcessSimple/environments/${f.environmentId}/flows/${f.flowId}/runs/${args.run}`,properties:{status:'Succeeded',...row.time,...(row.trigger?{trigger:row.trigger}:{})}};if(tool==='get_run_actions')return row.actions;if(tool==='get_run_action_content')return{action:args.action,which:'outputs',...(args.action===row.action?{content:{body:row.fields}}:{skipped:'Skipped'})};throw Error('Unexpected native operation');}};
 const state=(viewport:number,phase:'failed'|'recovered')=>{const id=String(viewport),run=`run-${phase}-${viewport}`,t=time(),fields={Title:'protected synthetic label',RequestLabel:f.config.recovery.failureLabel,RequestCorrelation:f.context.runId,ProbeStatus:phase==='failed'?'Failed':'Processed',AttemptCount:phase==='failed'?1:2,FlowRunId:run,ReceiptCorrelation:phase==='failed'?'':f.context.runId,ErrorDetail:f.config.recovery.failureLabel+'|'+f.config.recovery.controlledFailureAction+'|run-failed-'+viewport};items.set(id,{id,eTag:phase==='failed'?'version1':'version2',fields});runs.set(run,{time:t,action:phase==='failed'?f.config.recovery.failureAction:f.config.recovery.recoveryAction,fields:{...fields,ID:Number(id)},actions:[{name:f.config.recovery.controlledFailureAction,status:'Failed',startTime:t.startTime,endTime:t.startTime},{name:f.config.recovery.failureAction,status:'Succeeded',startTime:t.startTime,endTime:t.endTime}]});return items.get(id);};
 let tick=0;const observer=()=>createFunctionalRecovery({config:f.config,context:f.context,evidence,captureRoot,leaseSha256:f.leaseSha256,procedureSha256:'f'.repeat(64),flow,flowId:f.flowId,environmentId:f.environmentId,graph,guard:async()=>{},clock:{now:()=>tick+=30001,wait:async()=>{},wallNow:()=>++wall}});
 const duplicate=(viewport:number,guard=false)=>{const id=String(viewport+10000),original='run-original-'+viewport,t=time(),fields={Title:'protected duplicate label',RequestLabel:f.config.duplicate.label,RequestCorrelation:f.context.runId,ProbeStatus:'Processed',AttemptCount:1,FlowRunId:original,ReceiptCorrelation:f.context.runId,ErrorDetail:''};items.set(id,{id,eTag:guard?'duplicate3':'duplicate1',fields});
 const trigger={name:f.config.recovery.triggerName,status:'Succeeded',startTime:stamp(Date.parse(t.startTime)-2),endTime:stamp(Date.parse(t.startTime)-1),outputs:{body:{...fields,ID:Number(id),ProbeStatus:'New',VersionNumber:'2.0'}}};
 const previous=versions.get(id)??[];versions.set(id,guard?[...previous,{id:'2.0',lastModifiedDateTime:stamp(Date.parse(t.startTime)-3),fields:{...fields,ProbeStatus:'New'}},{id:'3.0',lastModifiedDateTime:stamp(Date.parse(t.endTime)-1),fields}]:[{id:'1.0',lastModifiedDateTime:stamp(Date.parse(t.endTime)-1),fields}]);
 runs.set(guard?'run-duplicate-'+viewport:original,{time:t,...(guard?{trigger}:{}),action:guard?f.config.duplicate.action:f.config.recovery.recoveryAction,fields:{...fields,ID:Number(id)}});return items.get(id);};
 return{...f,root,evidence,captureRoot,items,runs,versions,state,duplicate,observer,setDrift:()=>{drift=true;}};
}
it('observes native first failure and same-item second-attempt recovery in both viewports, then verifies the sealed import',async()=>{
 const f=await fixture(),o=await f.observer();for(const width of [1440,390]){f.duplicate(width);await o.scenarioCompleted('Success',width);await o.scenarioStarted('Duplicate',width);f.duplicate(width,true);await o.scenarioCompleted('Duplicate',width);f.state(width,'failed');await o.scenarioCompleted('Failure',width);f.state(width,'recovered');await o.scenarioCompleted('Recovery',width);}expect(await o.finish()).toBe('functional-request-recovery.json');
 const read=(n:string)=>fs.readFile(path.join(f.evidence,n));expect(await functionalRecoveryEvidence(f.config,f.context,'f'.repeat(64),read,f.captureRoot,f.leaseSha256)).toContain('functional-request-recovery.json');const result=JSON.parse((await read('functional-request-recovery.json')).toString());expect(result).toMatchObject({recovered:true,protectedRequestFieldsPreserved:true,solutionRollbackVerified:false,completeHistoricalAbsenceVerified:false});
 await expect(functionalRecoveryEvidence(f.config,{...f.context,sourceCommit:'a'.repeat(40)},'f'.repeat(64),read,f.captureRoot,f.leaseSha256)).rejects.toThrow('context');
});
it.each(['label','title','correlation','count','run','status','version','diagnostic'])('refuses changed %s without publishing a recovery receipt',async mode=>{
 const f=await fixture(),o=await f.observer();f.state(1440,'failed');await o.scenarioCompleted('Failure',1440);const row=f.state(1440,'recovered');if(mode==='label')row.fields.RequestLabel='different';if(mode==='title')row.fields.Title='different';if(mode==='correlation')row.fields.RequestCorrelation=f.flowId;if(mode==='count')row.fields.AttemptCount=1;if(mode==='run')row.fields.FlowRunId='run-failed-1440';if(mode==='status')row.fields.ProbeStatus='New';if(mode==='version')row.eTag='version1';if(mode==='diagnostic')row.fields.ErrorDetail='changed diagnostic';
 await expect(o.scenarioCompleted('Recovery',1440)).rejects.toThrow();await expect(fs.stat(path.join(f.evidence,'functional-request-recovery.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects preexisting correlation, unmatched recovery, missing viewport and trigger drift',async()=>{
 const f=await fixture();f.state(1440,'failed');await expect(f.observer()).rejects.toThrow('already exists');f.items.clear();const o=await f.observer();await expect(o.scenarioCompleted('Recovery',1440)).rejects.toThrow('no independently');await expect(o.finish()).rejects.toThrow('Both');f.state(1440,'failed');f.setDrift();await expect(o.scenarioCompleted('Failure',1440)).rejects.toThrow('trigger list');
});
it('rejects missing terminal provider run or duplicate failure instead of trusting persisted Failed',async()=>{
 const f=await fixture(),o=await f.observer();f.state(1440,'failed');f.runs.clear();await expect(o.scenarioCompleted('Failure',1440)).rejects.toThrow('No fresh successful');f.state(1440,'failed');await o.scenarioCompleted('Failure',1440);await expect(o.scenarioCompleted('Failure',1440)).rejects.toThrow('repeated');
});
it.each(['count','receipt','protected-label','run-id','version','diagnostic'])('refuses a duplicate guard that changes %s',async mode=>{
 const f=await fixture(),o=await f.observer();f.duplicate(1440);await o.scenarioCompleted('Success',1440);await o.scenarioStarted('Duplicate',1440);const row=f.duplicate(1440,true);if(mode==='count')row.fields.AttemptCount=2;if(mode==='receipt')row.fields.ReceiptCorrelation='foreign';if(mode==='protected-label')row.fields.RequestLabel='other';if(mode==='run-id')row.fields.FlowRunId='new-effect';if(mode==='version')row.eTag='duplicate1';if(mode==='diagnostic')row.fields.ErrorDetail='changed diagnostic';await expect(o.scenarioCompleted('Duplicate',1440)).rejects.toThrow();
});
it('requires an observed executed duplicate guard, not only an unchanged Processed row',async()=>{
 const f=await fixture(),o=await f.observer();f.duplicate(1440);await o.scenarioCompleted('Success',1440);await o.scenarioStarted('Duplicate',1440);await expect(o.scenarioCompleted('Duplicate',1440)).rejects.toThrow();
});
it.each(['missing','wrong','wrong-run','wrong-action'])('refuses %s failure diagnostic before admitting a retry baseline',async mode=>{
 const f=await fixture(),o=await f.observer(),row=f.state(1440,'failed');
 row.fields.ErrorDetail=mode==='missing'?'':mode==='wrong'?'unrelated failure':mode==='wrong-run'?f.config.recovery.failureLabel+'|'+f.config.recovery.controlledFailureAction+'|other-run':f.config.recovery.failureLabel+'|other-action|'+row.fields.FlowRunId;
 await expect(o.scenarioCompleted('Failure',1440)).rejects.toThrow('diagnostic');await expect(o.scenarioCompleted('Recovery',1440)).rejects.toThrow('no independently');
});
it.each(['missing','skipped','succeeded','wrong-action','ambiguous','late-failure','missing-persistence'])('refuses %s controlled failure despite a persisted Failed row and Succeeded handling run',async mode=>{
 const f=await fixture(),o=await f.observer();f.state(1440,'failed');const run=f.runs.get('run-failed-1440'),failed=run.actions[0];
 if(mode==='missing')run.actions.shift();if(mode==='skipped')failed.status='Skipped';if(mode==='succeeded')failed.status='Succeeded';if(mode==='wrong-action')failed.name='UnrelatedAction';if(mode==='ambiguous')run.actions.push({...failed});if(mode==='late-failure')failed.endTime=new Date(Date.now()+1000).toISOString();if(mode==='missing-persistence')run.actions.pop();
 await expect(o.scenarioCompleted('Failure',1440)).rejects.toThrow();await expect(o.scenarioCompleted('Recovery',1440)).rejects.toThrow('no independently');
});
it('ignores unrelated skipped branches without timestamps while proving the exact failed and persistence actions',async()=>{
 const f=await fixture(),o=await f.observer();f.state(1440,'failed');f.runs.get('run-failed-1440').actions.push({name:'UnrelatedSkippedBranch',status:'Skipped'});await expect(o.scenarioCompleted('Failure',1440)).resolves.toBeUndefined();
});
it.each([1440,390])('rejects an earlier matching guard despite a new signal and changed final version at %s',async width=>{
 const f=await fixture(),o=await f.observer();f.duplicate(width);await o.scenarioCompleted('Success',width);await o.scenarioStarted('Duplicate',width);f.duplicate(width,true);
 const guard=f.runs.get('run-duplicate-'+width),original=f.runs.get('run-original-'+width);guard.time={...original.time};guard.trigger.startTime=original.time.startTime;guard.trigger.endTime=original.time.startTime;
 await expect(o.scenarioCompleted('Duplicate',width)).rejects.toThrow('No fresh successful');
 await expect(fs.stat(path.join(f.evidence,'functional-request-recovery.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each([1440,390])('rejects the wrong inline signal version at %s',async width=>{
 const f=await fixture(),o=await f.observer();f.duplicate(width);await o.scenarioCompleted('Success',width);await o.scenarioStarted('Duplicate',width);f.duplicate(width,true);f.runs.get('run-duplicate-'+width).trigger.outputs.body.VersionNumber='wrong';
 await expect(o.scenarioCompleted('Duplicate',width)).rejects.toThrow('trigger output correlation');
});
it('requires one start callback with an unchanged baseline before duplicate completion',async()=>{
 const f=await fixture(),o=await f.observer();await expect(o.scenarioStarted('Duplicate',1440)).rejects.toThrow('missing baseline');f.duplicate(1440);await o.scenarioCompleted('Success',1440);
 await expect(o.scenarioCompleted('Duplicate',1440)).rejects.toThrow('start was not');await o.scenarioStarted('Duplicate',1440);await expect(o.scenarioStarted('Duplicate',1440)).rejects.toThrow('repeated');f.duplicate(1440,true);await o.scenarioCompleted('Duplicate',1440);await expect(o.scenarioCompleted('Duplicate',1440)).rejects.toThrow('no native success baseline');
});
it('rejects drift of the success baseline before the browser signal',async()=>{
 const f=await fixture(),o=await f.observer();f.duplicate(1440);await o.scenarioCompleted('Success',1440);f.items.get('11440').fields.ErrorDetail='foreign change';await expect(o.scenarioStarted('Duplicate',1440)).rejects.toThrow('baseline changed');
});
it.each(['old-guard','wrong-trigger-version','wrong-signal-version','wrong-start','missing-signal'] as const)('revalidates %s on sealed evidence import',async mode=>{
 const f=await fixture(),o=await f.observer();for(const width of [1440,390]){f.duplicate(width);await o.scenarioCompleted('Success',width);await o.scenarioStarted('Duplicate',width);f.duplicate(width,true);await o.scenarioCompleted('Duplicate',width);f.state(width,'failed');await o.scenarioCompleted('Failure',width);f.state(width,'recovered');await o.scenarioCompleted('Recovery',width);}await o.finish();
 const file=path.join(f.evidence,'functional-request-recovery.json'),r=JSON.parse(await fs.readFile(file,'utf8')),p=r.duplicates[0];
 if(mode==='old-guard')p.afterRun.startTime=p.beforeRun.startTime;if(mode==='wrong-trigger-version')p.afterRun.sharepointTriggerEvidence.binding.version='wrong';if(mode==='wrong-signal-version')p.signal.version=p.signal.baseline.version;if(mode==='wrong-start')p.signal.scenarioStartedAt=p.afterRun.endTime;if(mode==='missing-signal')delete p.signal;
 await fs.writeFile(file,JSON.stringify(r));await expect(functionalRecoveryEvidence(f.config,f.context,'f'.repeat(64),n=>fs.readFile(path.join(f.evidence,n)),f.captureRoot,f.leaseSha256)).rejects.toThrow();
});
