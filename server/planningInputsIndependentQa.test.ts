import {withSyntheticIntegration} from './testFixtures/taskIntegration.ts';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {DeliveryRecords} from './deliveryRecords.ts';
import {deliveryRecordHandler} from './deliveryRecordTools.ts';
import {discoveryAreas,discoveryBlockers,recordReference,recordPhase,type DeliveryRecordContent} from '../shared/deliveryRecord.ts';
import {saveHldArtifact,hldAbsenceGuard} from './hldArtifacts.ts';
import {generateHldContent} from '../shared/hld.ts';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const hash='a'.repeat(64),head='b'.repeat(40),repo='synthetic/repo',context={brief:'Synthetic planning QA',environmentUrl:'https://synthetic.crm4.dynamics.com'},notes='Independent inspection found missing planning inputs. This rejection grants no design, implementation, deployment or runtime authority.';
function content(modern=true):DeliveryRecordContent{return{brief:context.brief,outcome:'Submit a synthetic item',successMeasure:'The item persists',users:['Tester'],scope:['Synthetic item'],exclusions:[],owner:'dev',qaOwner:'qa',sourceCommit:head,environmentUrl:context.environmentUrl,requirements:[{id:'r1',description:'Persist item',acceptance:'Persists after reload'}],contracts:[{id:'item',owner:'dev',description:'Synthetic item schema',requirementIds:['r1']}],tasks:[{issue:1,stage:'discovery',requirementIds:['r1']},{issue:2,stage:'design',requirementIds:['r1']},{issue:3,stage:'slice',requirementIds:['r1']}],slice:{description:'Save one item',requirementIds:['r1'],acceptanceCriteria:['Persists after reload']},findings:discoveryAreas.map(area=>({id:area,area,statement:'Synthetic independently testable observation',status:'observed',conclusion:'ready',critical:true,owner:'dev',remedy:'Refresh evidence',evidence:[{reference:'synthetic/'+area,sha256:hash,observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()}]})),...(modern?{applicationSpec:{schemaVersion:1,journeys:[{id:'save',actor:'Tester',outcome:'Save item',requirementIds:['r1'],scenarios:[{id:'persist',kind:'happy',given:'A valid item',when:'Saved',then:'Persists after reload'}]}],decisions:[],assumptions:[],components:[{id:'app',platform:'canvas',owner:'dev',requirementIds:['r1'],contractIds:['item'],findingIds:['repository'],dependsOn:[]}],securityBoundaries:[{id:'own',actor:'Tester',allowed:'Read own item',denied:'Read other items',requirementIds:['r1'],findingIds:['security']}],checks:[{id:'runtime',kind:'runtime',requirementIds:['r1'],componentIds:['app'],scenarioIds:['persist'],expectedEvidence:'Authenticated readback'}]}}:{})};}
async function fixture(modern=true){const root=await fs.mkdtemp(path.join(os.tmpdir(),'planning-inputs-independent-'));roots.push(root);const records=new DeliveryRecords(root);await records.init();const data=content(modern),record=await records.save(repo,0,data,'ceo');const deps={repo:()=>({...context,checkoutPath:root}),agents:()=>[],delivery:()=>({} as any),assertOpen:()=>{}};const handler=(id='qa',role:'qa'|'dev'|'ceo'|'manager'='qa',project=repo)=>deliveryRecordHandler(records,deps,{id,role,repoId:project,reviewOnly:role==='qa'});const input=(missingInputs=['architecture','task-contracts'])=>({repo_id:repo,action:'reject_inputs' as const,expected_revision:record.revision,payload_json:JSON.stringify({reference:recordReference(record),notes,missingInputs})});return{root,records,data,record,handler,input};}
it('persists a negative-only missing-input review without invented architecture identities',async()=>{
 const f=await fixture();await f.handler()(f.input());const current=f.records.current(repo)!;expect(current.revision).toBe(f.record.revision);expect(current.sha256).toBe(f.record.sha256);expect(current.inputReview).toMatchObject({decision:'rejected',reviewer:'qa',missingInputs:['architecture','task-contracts'],notes});expect(current.designReview).toBeUndefined();expect(recordPhase(current)).not.toBe('implementation');
 const reopened=new DeliveryRecords(f.root);await reopened.init();expect(reopened.current(repo)?.inputReview).toEqual(current.inputReview);expect(()=>reopened.assertWork(repo,3,context)).toThrow();
});
it.each(['developer','manager','wrong-qa','foreign-project','stale-reference','stale-revision','approval-field','duplicate-missing'])('refuses %s rejection authority or scope',async mode=>{
 const f=await fixture(),input=f.input();let handler=f.handler();if(mode==='developer')handler=f.handler('dev','dev');if(mode==='manager')handler=f.handler('manager','manager');if(mode==='wrong-qa')handler=f.handler('other');if(mode==='foreign-project')handler=f.handler('qa','qa','foreign/repo');
 if(mode==='stale-reference'){const payload=JSON.parse(input.payload_json);payload.reference.sha256='f'.repeat(64);input.payload_json=JSON.stringify(payload);}if(mode==='stale-revision')input.expected_revision=0;if(mode==='approval-field'){const payload=JSON.parse(input.payload_json);payload.decision='approved';input.payload_json=JSON.stringify(payload);}if(mode==='duplicate-missing')input.payload_json=JSON.stringify({reference:recordReference(f.record),notes,missingInputs:['architecture','architecture']});
 await expect(handler(input)).rejects.toThrow();expect(f.records.current(repo)?.inputReview).toBeUndefined();
});
it('does not invent missing modern task contracts for a legacy record',async()=>{const f=await fixture(false);await expect(f.handler()(f.input(['task-contracts']))).rejects.toThrow();expect(f.records.current(repo)?.inputReview).toBeUndefined();});
it('refuses false architecture absence when a real local artifact exists',async()=>{const f=await fixture(),input={solutionName:'Synthetic item',problemContext:context.brief,components:[]};await saveHldArtifact(f.root,input,generateHldContent(input),()=>{},repo);await expect(f.handler()(f.input(['architecture']))).rejects.toThrow();expect(f.records.current(repo)?.inputReview).toBeUndefined();});
it('treats unreadable architecture as an error rather than proof of absence',async()=>{const f=await fixture(),folder=path.join(f.root,'docs/architecture/drafts');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'current.json'),'{broken');await expect(f.handler()(f.input(['architecture']))).rejects.toThrow();expect(f.records.current(repo)?.inputReview).toBeUndefined();});
it('permits read-only design investigation while modern authoring, approval and release remain blocked',async()=>{
 const f=await fixture();for(const finding of f.data.findings)finding.status='unresolved';await f.records.save(repo,1,f.data,'ceo');expect(()=>f.records.assertWork(repo,2,context)).not.toThrow();expect(()=>f.records.assertWork(repo,1,context)).not.toThrow();expect(()=>f.records.assertWork(repo,3,context)).toThrow();
 const current=f.records.current(repo)!;expect(discoveryBlockers(current).some(x=>/task.*contract/i.test(x))).toBe(true);await expect(f.records.review(repo,recordReference(current),{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:hash,decision:'approved',notes},'qa',context)).rejects.toThrow();
 expect(()=>f.records.assertRelease(repo,{owner:'dev',qaOwner:'qa',deliveryRecord:{...recordReference(current),purpose:'slice'},requiredIssues:[3],acceptanceCriteria:['Persists after reload']} as any,context)).toThrow();
});
it('preserves legacy design approval compatibility without requiring a modern task plan',async()=>{const f=await fixture(false);expect(discoveryBlockers(f.record)).toEqual([]);await expect(f.records.review(repo,recordReference(f.record),{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:hash,decision:'approved',notes},'qa',context)).resolves.toMatchObject({designReview:{decision:'approved'}});});
it('does not claim task contracts are missing once a valid plan exists',async()=>{
 const f=await fixture();f.data.taskPlan={schemaVersion:1,tasks:[{issue:3,owner:'dev',componentIds:['app'],dependsOn:[],resources:['synthetic-resource'],inputs:['Synthetic requirements'],outputs:['Synthetic result'],checkIds:['runtime'],stopConditions:['Missing effective access']} ]};withSyntheticIntegration(f.data);await f.records.save(repo,1,f.data,'ceo');const current=f.records.current(repo)!;
 await expect(f.handler()({...f.input(['task-contracts']),expected_revision:2,payload_json:JSON.stringify({reference:recordReference(current),notes,missingInputs:['task-contracts']})})).rejects.toThrow('not missing');expect(f.records.current(repo)?.inputReview).toBeUndefined();
});
it('clears prior design approval without creating a replacement approval when inputs are rejected',async()=>{
 const f=await fixture(false);await f.records.review(repo,recordReference(f.record),{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:hash,decision:'approved',notes},'qa',context);await f.handler()(f.input(['architecture']));const current=f.records.current(repo)!;expect(current.inputReview?.decision).toBe('rejected');expect(current.designReview).toBeUndefined();expect(current.taskReviews).toEqual([]);expect(current.taskAcceptances).toEqual([]);expect(()=>f.records.assertWork(repo,3,context)).toThrow();
});
it('keeps an accepted slice immutable when missing-input rejection is requested',async()=>{
 const f=await fixture(false);await f.records.review(repo,recordReference(f.record),{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:hash,decision:'approved',notes},'qa',context);
 // Synthetic persisted accepted-slice fixture: no deployment or acceptance is performed.
 const file=path.join(f.root,'delivery-records.json'),state=JSON.parse(await fs.readFile(file,'utf8'));state.records[0].sliceReceipt={releaseId:'11111111-1111-4111-8111-111111111111',runId:'22222222-2222-4222-8222-222222222222',evidenceHash:hash,head,acceptedAt:new Date().toISOString()};await fs.writeFile(file,JSON.stringify(state));const restored=new DeliveryRecords(f.root);await restored.init();
 const handler=deliveryRecordHandler(restored,{repo:()=>({...context,checkoutPath:f.root}),agents:()=>[],delivery:()=>({} as any),assertOpen:()=>{}},{id:'qa',role:'qa',repoId:repo,reviewOnly:true});await expect(handler(f.input(['architecture']))).rejects.toThrow('immutable');expect(restored.current(repo)?.sliceReceipt).toEqual(state.records[0].sliceReceipt);expect(restored.current(repo)?.inputReview).toBeUndefined();
});
it('does not publish an architecture-absence rejection after an artifact appears while the store is queued',async()=>{
 const f=await fixture(false),rename=fs.rename.bind(fs);let release!:()=>void,entered!:()=>void,queued!:()=>void,held=false;
 const publication=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;}),rejectionQueued=new Promise<void>(resolve=>{queued=resolve;});
 vi.spyOn(fs,'rename').mockImplementation(async(...args)=>{if(String(args[1])===path.join(f.root,'delivery-records.json')&&!held){held=true;entered();await publication;}return rename(...args);});
 const original=f.records.rejectInputs.bind(f.records);vi.spyOn(f.records,'rejectInputs').mockImplementation((...args)=>{queued();return original(...args);});
 const pendingReview=f.records.review(repo,recordReference(f.record),{docId:'HLD-11111111-1111-4111-8111-111111111111',artifactSha256:hash,decision:'approved',notes},'qa',context);await started;
 const rejection=f.handler()(f.input(['architecture']));const denied=expect(rejection).rejects.toThrow();
 try{await rejectionQueued;const input={solutionName:'Synthetic concurrent draft',problemContext:context.brief,components:[]};await saveHldArtifact(f.root,input,generateHldContent(input),()=>{},repo);}finally{release();await pendingReview;}
 await denied;expect(f.records.current(repo)?.inputReview).toBeUndefined();
});
it.each(['pointer-arrival','file-parent','linked-parent'])('rechecks %s while guarding architecture absence',async mode=>{
 const f=await fixture(),check=hldAbsenceGuard(f.root,()=>{});expect(check).not.toThrow();
 if(mode==='pointer-arrival'){await fs.mkdir(path.join(f.root,'docs/architecture/drafts'),{recursive:true});await fs.writeFile(path.join(f.root,'docs/architecture/drafts/current.json'),'{}');}
 if(mode==='file-parent')await fs.writeFile(path.join(f.root,'docs'),'not a directory');
 if(mode==='linked-parent'){const other=path.join(f.root,'other');await fs.mkdir(other);await fs.symlink(other,path.join(f.root,'docs'),'junction');}
 expect(check).toThrow();
});
it('refuses a different checkout directory replacing the same canonical path',async()=>{
 const f=await fixture(),checkout=path.join(f.root,'checkout');await fs.mkdir(checkout);const check=hldAbsenceGuard(checkout,()=>{});await fs.rename(checkout,path.join(f.root,'original-checkout'));await fs.mkdir(checkout);expect(check).toThrow();
});
it('compares checkout inode identities exactly above Number precision',async()=>{
 const f=await fixture(),original=9007199254740992n,successor=9007199254740993n;expect(Number(original)).toBe(Number(successor));
 const stat=syncFs.statSync.bind(syncFs),lstat=syncFs.lstatSync.bind(syncFs);let replaced=false;
 vi.spyOn(syncFs,'statSync').mockImplementation(((file:any,options:any)=>{const value=stat(file,options);return String(file)===f.root&&options?.bigint?Object.assign(value,{ino:original,dev:1n}):value;}) as typeof syncFs.statSync);
 vi.spyOn(syncFs,'lstatSync').mockImplementation(((file:any,options:any)=>{const value=lstat(file,options);return String(file)===f.root&&options?.bigint?Object.assign(value,{ino:replaced?successor:original,dev:1n}):value;}) as typeof syncFs.lstatSync);
 const check=hldAbsenceGuard(f.root,()=>{});expect(check).not.toThrow();replaced=true;expect(check).toThrow('checkout changed');
});
