import {withSyntheticIntegration} from './testFixtures/taskIntegration.ts';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {taskInputManifest,taskInputPrompt,readTaskInput,taskPlanningBlockers,TASK_CONTEXT_BYTES} from './taskInputs.ts';
import {taskScope} from '../shared/taskPlan.ts';
import {taskScopeHash,taskAuthorityHash} from './taskScope.ts';
import {DeliveryRecords} from './deliveryRecords.ts';
import {deliveryRecordHandler} from './deliveryRecordTools.ts';
import {HldSynthesisService} from './hldSynthesis.ts';
import type {DeliveryRecord,DeliveryRecordContent} from '../shared/deliveryRecord.ts';
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
function fixture():DeliveryRecord{
 const requirementIds=['base'],evidence=[{reference:'synthetic/reference',sha256:'a'.repeat(64),observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()}];
 const content:DeliveryRecordContent={brief:'Synthetic bounded task inputs',outcome:'Complete one synthetic journey',successMeasure:'Observable retained outcome',users:['Tester'],scope:['Base journey'],exclusions:['Other journey'],owner:'devA',qaOwner:'qa',sourceCommit:'b'.repeat(40),environmentUrl:'https://synthetic.crm4.dynamics.com',requirements:['base','other'].map(id=>({id,description:id,acceptance:'Retained result'})),contracts:[{id:'base-contract',owner:'devA',description:'Base schema contract',requirementIds},{id:'other-contract',owner:'devA',description:'Other contract',requirementIds:['other']}],findings:Array.from({length:30},(_,i)=>({id:`e${i}`,area:'repository',statement:'Retained source detail '+String(i)+'x'.repeat(3000),status:'observed',critical:true,conclusion:'ready',owner:'devA',remedy:'Read the exact evidence',evidence})),tasks:[{issue:5,stage:'slice',requirementIds},{issue:6,stage:'slice',requirementIds},{issue:7,stage:'implementation',requirementIds:['other']}],slice:{description:'One base journey',requirementIds,acceptanceCriteria:['Retained result']},applicationSpec:{schemaVersion:1,journeys:[{id:'base-journey',actor:'Tester',outcome:'Retained result',requirementIds,scenarios:[{id:'base-scenario',kind:'happy',given:'Valid input',when:'Submitted',then:'Retained'}]},{id:'other-journey',actor:'Tester',outcome:'Other result',requirementIds:['other'],scenarios:[{id:'other-scenario',kind:'happy',given:'Other input',when:'Submitted',then:'Other result'}]}],decisions:[],assumptions:[],securityBoundaries:[{id:'base-security',actor:'Tester',allowed:'Own data',denied:'Other data',requirementIds,findingIds:['e0']}],components:[{id:'data',platform:'other',owner:'devA',requirementIds,contractIds:['base-contract'],findingIds:['e0'],dependsOn:[]},{id:'app',platform:'canvas',owner:'devB',requirementIds,contractIds:['base-contract'],findingIds:['e1'],dependsOn:['data']},{id:'other',platform:'other',owner:'devA',requirementIds:['other'],contractIds:['other-contract'],findingIds:['e2'],dependsOn:[]}],checks:[{id:'base-check',kind:'runtime',requirementIds,componentIds:['data','app'],scenarioIds:['base-scenario'],expectedEvidence:'Real retained outcome'},{id:'other-check',kind:'runtime',requirementIds:['other'],componentIds:['other'],scenarioIds:['other-scenario'],expectedEvidence:'Other outcome'}]},taskPlan:{schemaVersion:1,tasks:[{issue:5,owner:'devA',componentIds:['data'],dependsOn:[],resources:['base-data'],inputs:['Reviewed requirements'],outputs:['Data contract'],checkIds:['base-check'],stopConditions:['Missing required evidence']},{issue:6,owner:'devB',componentIds:['app'],dependsOn:[5],resources:['base-app'],inputs:['Accepted task5'],outputs:['Connected app'],checkIds:['base-check'],stopConditions:['Missing accepted dependency']},{issue:7,owner:'devA',componentIds:['other'],dependsOn:[],resources:['other'],inputs:['Accepted first slice'],outputs:['Other result'],checkIds:['other-check'],stopConditions:['Missing slice acceptance']} ]}};
 withSyntheticIntegration(content);return{schemaVersion:1,id:'11111111-1111-4111-8111-111111111111',repoId:'synthetic/repo',revision:1,sha256:'a'.repeat(64),updatedAt:new Date().toISOString(),updatedBy:'ceo',previousSha256:null,content};
}
it('indexes a full scope above87KiB without truncating source or weakening its authority hash',()=>{
 const record=fixture(),before=JSON.stringify(record),full=taskScope(record.content,6),manifest=taskInputManifest(record,6);expect(Buffer.byteLength(JSON.stringify(full))).toBeGreaterThan(87000);expect(Buffer.byteLength(JSON.stringify(manifest))).toBeLessThan(TASK_CONTEXT_BYTES);expect(JSON.stringify(record)).toBe(before);expect(manifest.taskHash).toBe(hash(full));expect(manifest.taskHash).toBe(taskScopeHash(record,6));expect(manifest.criticalFindings).toHaveLength(30);expect(manifest.inputIndex.filter(x=>x.section==='finding')).toHaveLength(30);
});
it('packs an oversized repeated-label index losslessly while retaining literal API/source checks',()=>{
 const record=fixture();record.content.findings=Array.from({length:110},(_,i)=>({...record.content.findings[0],id:'e'+i,statement:'Exact original source '+i}));
 const before=JSON.stringify(record),manifest=taskInputManifest(record,6),prompt=JSON.parse(taskInputPrompt(record,6));
 expect(prompt.taskInputs.projection).toBe('exact-task-input-index-v2');
 const {projection,inputIndexEncoding,inputIndexRows,...rest}=prompt.taskInputs;
 const expanded={...rest,inputIndex:inputIndexRows.map(([section,id,bytes,sha256]:[string,string,number,string])=>({section,id,bytes,sha256}))};
 expect(expanded).toEqual(manifest);expect(prompt.taskInputs.criticalFindings).toEqual(manifest.criticalFindings);
 expect(prompt.taskAuthorityHash).toBe(taskAuthorityHash(record,6));expect(JSON.stringify(record)).toBe(before);
 expect(Buffer.byteLength(taskInputPrompt(record,6))).toBeLessThanOrEqual(TASK_CONTEXT_BYTES);
 for(const row of expanded.inputIndex){const result=readTaskInput(record,6,row.section,row.id);expect(result.bytes).toBe(row.bytes);expect(result.sha256).toBe(row.sha256);}
 record.content.taskPlan!.tasks[1].inputs=['x'.repeat(TASK_CONTEXT_BYTES)];
 expect(()=>taskInputPrompt(record,6)).toThrow('24 KiB');
});

it('returns every indexed input as complete exact hashed bytes with unchanged record/task binding',()=>{
 const record=fixture(),manifest=taskInputManifest(record,6);for(const row of manifest.inputIndex){const result=readTaskInput(record,6,row.section,row.id);expect(result.sha256).toBe(hash(result.value));expect(result.sha256).toBe(row.sha256);expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(result.value)));expect(result.taskHash).toBe(manifest.taskHash);expect(result.reference).toEqual(manifest.reference);}
 expect(readTaskInput(record,6,'finding','e29').value).toEqual(record.content.findings[29]);expect(readTaskInput(record,6,'global','global').value).toEqual(taskScope(record.content,6)!.global);
});
it('includes dependency inputs but refuses unrelated task/component/contract/journey/check inputs',()=>{
 const record=fixture();expect(readTaskInput(record,6,'task','5').value).toEqual(record.content.taskPlan!.tasks[0]);expect(readTaskInput(record,6,'task','stage-5').value).toEqual(record.content.tasks[0]);
 for(const [section,id]of [['task','7'],['component','other'],['contract','other-contract'],['journey','other-journey'],['check','other-check']] as const)expect(()=>readTaskInput(record,6,section,id)).toThrow('outside');
 expect(()=>taskInputManifest(record,99)).toThrow('missing');
});
it('retains canonical full-scope authority when a referenced finding changes',()=>{
 const record=fixture(),before=taskInputManifest(record,6);record.content.findings[29].statement+=' changed';const after=taskInputManifest(record,6);expect(after.taskHash).not.toBe(before.taskHash);expect(after.inputIndex.find(x=>x.id==='e29')!.sha256).not.toBe(before.inputIndex.find(x=>x.id==='e29')!.sha256);expect(after.taskHash).toBe(hash(taskScope(record.content,6)));
});
it('blocks a modern slice task containing expansion-only requirements',()=>{const record=fixture();record.content.tasks[0].requirementIds=[...record.content.tasks[0].requirementIds,'other'];expect(taskPlanningBlockers(record).join(' ')).toContain('slice task exceeds');});
it('blocks oversized selected task contracts and indivisible source inputs rather than silently truncating',()=>{
 const record=fixture();record.content.taskPlan!.tasks[1].inputs=Array.from({length:20},(_,i)=>String(i)+'x'.repeat(1990));expect(taskPlanningBlockers(record).join(' ')).toContain('24 KiB');expect(()=>readTaskInput(record,6,'task','6')).toThrow('24 KiB');
});
it('blocks save admission for invalid modern slice scope while preserving its existing record',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'task-input-independent-'));roots.push(root);const records=new DeliveryRecords(root);await records.init();const data=fixture().content;await records.save('synthetic/repo',0,data,'ceo');data.tasks[0].requirementIds=[...data.tasks[0].requirementIds,'other'];await expect(records.save('synthetic/repo',1,data,'ceo')).rejects.toThrow('slice task exceeds');expect(records.current('synthetic/repo')?.revision).toBe(1);
});
async function stored(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'task-input-handler-independent-'));roots.push(root);const records=new DeliveryRecords(root);await records.init();const record=await records.save('synthetic/repo',0,fixture().content,'ceo');const deps={repo:()=>({brief:record.content.brief,environmentUrl:record.content.environmentUrl!,checkoutPath:root}),agents:()=>[],delivery:()=>({} as any),assertOpen:()=>{}};const input={repo_id:'synthetic/repo',action:'task_input' as const,payload_json:JSON.stringify({reference:{id:record.id,revision:record.revision,sha256:record.sha256},issue:6,taskHash:taskScopeHash(record,6),section:'task',id:'5'})};return{records,record,input,handler:(id:string,role:'dev'|'qa'|'ceo'|'manager',repoId='synthetic/repo')=>deliveryRecordHandler(records,deps,{id,role,repoId,reviewOnly:role==='qa'})};}
it.each([['devB','dev'],['qa','qa'],['coordinator','ceo']] as const)('allows %s to retrieve exact dependency inputs without changing approvals',async(id,role)=>{const f=await stored();const value=JSON.parse(await f.handler(id,role)(f.input));expect(value.value.issue).toBe(5);expect(value.taskHash).toBe(taskScopeHash(f.record,6));expect(f.records.current('synthetic/repo')?.designReview).toBeUndefined();expect(f.records.current('synthetic/repo')?.revision).toBe(1);});
it('hands the real worker prompt retrieval hash to the real task-input handler without confusing approval authority',async()=>{
 const f=await stored(),before=JSON.stringify(f.records.current('synthetic/repo')),prompt=JSON.parse(taskInputPrompt(f.record,6)),manifest=prompt.taskInputs;
 expect(prompt).not.toHaveProperty('taskHash');expect(prompt.taskAuthorityHash).toBe(taskAuthorityHash(f.record,6));expect(manifest.taskHash).toBe(taskScopeHash(f.record,6));expect(prompt.taskAuthorityHash).not.toBe(manifest.taskHash);
 expect(prompt.instruction).toContain('never submit it as taskHash');
 const request={reference:manifest.reference,issue:manifest.issue,taskHash:manifest.taskHash,section:'task',id:'6'};
 const value=JSON.parse(await f.handler('devB','dev')({...f.input,payload_json:JSON.stringify(request)}));expect(value.value.issue).toBe(6);
 await expect(f.handler('devB','dev')({...f.input,payload_json:JSON.stringify({...request,taskHash:prompt.taskAuthorityHash})})).rejects.toThrow('scope changed');
 expect(JSON.stringify(f.records.current('synthetic/repo'))).toBe(before);
});
it.each(['other-owner','wrong-qa','manager','foreign-project','stale-reference','stale-hash','out-of-scope','unknown-field'])('refuses %s task input access',async mode=>{
 const f=await stored();let handler=f.handler('devB','dev');if(mode==='other-owner')handler=f.handler('devA','dev');if(mode==='wrong-qa')handler=f.handler('other','qa');if(mode==='manager')handler=f.handler('manager','manager');if(mode==='foreign-project')handler=f.handler('devB','dev','foreign/repo');
 const payload=JSON.parse(f.input.payload_json);if(mode==='stale-reference')payload.reference.revision=0;if(mode==='stale-hash')payload.taskHash='f'.repeat(64);if(mode==='out-of-scope')payload.id='7';if(mode==='unknown-field')payload.command='arbitrary';
 await expect(handler({...f.input,payload_json:JSON.stringify(payload)})).rejects.toThrow();expect(f.records.current('synthetic/repo')?.revision).toBe(1);
});
it('rejects stale references even when a new revision preserves the task scope hash',async()=>{const f=await stored();await f.records.save('synthetic/repo',1,f.record.content,'ceo');expect(taskScopeHash(f.records.current('synthetic/repo')!,6)).toBe(taskScopeHash(f.record,6));await expect(f.handler('devB','dev')(f.input)).rejects.toThrow('changed');});
it('applies the24KiB limit to the complete injected prompt rather than only its manifest',()=>{
 const record=fixture();record.content.findings=[];const task=record.content.taskPlan!.tasks[1];let size=0;
 for(let n=1;n<=24000;n+=25){task.inputs=Array.from({length:Math.ceil(n/1900)},(_,i)=>'x'.repeat(Math.min(1900,n-i*1900)));const bytes=Buffer.byteLength(JSON.stringify(taskInputManifest(record,6)));if(bytes>TASK_CONTEXT_BYTES-150&&bytes<TASK_CONTEXT_BYTES){size=bytes;break;}}
 expect(size).toBeGreaterThan(0);expect(size).toBeLessThan(TASK_CONTEXT_BYTES);expect(Buffer.byteLength(taskInputPrompt(record,6))).toBeGreaterThan(TASK_CONTEXT_BYTES);expect(taskPlanningBlockers(record).join(' ')).toContain('24 KiB');
});
it.each(['slice-outside','oversized-task'])('rejects %s planning before architecture capacity, admission or model usage',async mode=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'task-input-synthesis-independent-'));roots.push(root);const record=fixture();
 if(mode==='slice-outside')record.content.tasks[0].requirementIds=[...record.content.tasks[0].requirementIds,'other'];else record.content.taskPlan!.tasks[0].inputs=Array(20).fill('x'.repeat(2000));
 const reserve=vi.fn(()=>{throw Error('Unexpected capacity reservation');}),start=vi.fn(()=>{throw Error('Unexpected model launch');}),admission=vi.fn(async()=>null);
 const service=new HldSynthesisService(root,{assertOpen:()=>{},context:()=>({checkoutPath:root,fingerprint:'synthetic',copilotPaused:true,skills:[],discoveryRecord:record}),reserve,start,admission});await service.init();const before=await fs.readFile(path.join(root,'architecture-synthesis.json'),'utf8');
 try{await expect(service.start(record.repoId,{solutionName:'Synthetic planning',problemContext:'Synthetic admission boundaries',components:[]})).rejects.toThrow(mode==='slice-outside'?'slice task exceeds':'24 KiB');expect(reserve).not.toHaveBeenCalled();expect(admission).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();expect(service.view(record.repoId)).toEqual([]);expect(await fs.readFile(path.join(root,'architecture-synthesis.json'),'utf8')).toBe(before);}finally{await service.close();}
});
