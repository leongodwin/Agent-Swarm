import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {deliveryRecordContentSchema,discoveryBlockers,type DeliveryRecord} from '../shared/deliveryRecord.ts';
import {historicalDeliveryRecordSchema} from './historicalDeliveryRecord.ts';
import {DeliveryRecords} from './deliveryRecords.ts';
import {functionalFixture} from './testFixtures/functionalShowcase.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
function fixture(){
 const content=deliveryRecordContentSchema.parse({brief:'Functional probe',outcome:'Reject write',successMeasure:'Actual rejection',users:['Leon'],scope:['Probe'],exclusions:[],owner:'author',qaOwner:'qa',sourceCommit:'a'.repeat(40),environmentUrl:null,requirements:[{id:'r',description:'Reject write',acceptance:'Actual rejection'}],findings:[],contracts:[],tasks:[{issue:5,stage:'slice',requirementIds:['r']}],slice:{description:'Probe',requirementIds:['r'],acceptanceCriteria:['Actual rejection']},applicationSpec:{schemaVersion:1,journeys:[{id:'j',actor:'Leon',outcome:'Reject write',requirementIds:['r'],scenarios:[{id:'denied',kind:'denied',given:'Restricted client',when:'Write',then:'403'}]}],decisions:[],assumptions:[],components:[{id:'data',platform:'sharepoint',owner:'author',requirementIds:['r'],contractIds:[],dependsOn:[],findingIds:[]}],securityBoundaries:[{id:'boundary',actor:'Leon',allowed:'Read',denied:'Write',requirementIds:['r'],findingIds:[]}],checks:[{id:'runtime',kind:'access',requirementIds:['r'],componentIds:['data'],scenarioIds:['denied'],expectedEvidence:'Actual 403'},{id:'local',kind:'package',requirementIds:['r'],componentIds:['data'],scenarioIds:[],expectedEvidence:'Local checks'}]},taskPlan:{schemaVersion:2,tasks:[{issue:5,owner:'author',componentIds:['data'],dependsOn:[],resources:[],inputs:['Schema'],outputs:['Flow'],checkIds:['local'],stopConditions:['Unknown target']}],integrationQa:[{id:'qa',owner:'qa',purpose:'slice',runner:'delivery',dependsOn:[5],checkIds:['runtime','local'],cases:[{checkId:'runtime',scenarioId:'denied',testName:'Rejected',criterion:'Actual rejection',functionalAssertion:functionalFixture().config.rejection.contract}],maxTaskDurationMs:30000,stopConditions:['Unknown outcome']}]}});
 const row={schemaVersion:1,id:crypto.randomUUID(),repoId:'test/probe',revision:1,previousSha256:null,content,updatedAt:new Date().toISOString(),updatedBy:'author'};
 const old=structuredClone(row) as any,contract=old.content.taskPlan.integrationQa[0].cases[0].functionalAssertion;delete contract.observationMode;contract.pollIntervalMs=1000;
 const digest=({id,repoId,revision,previousSha256,content}:any)=>crypto.createHash('sha256').update(JSON.stringify({id,repoId,revision,previousSha256,content})).digest('hex');
 return {current:content,legacy:{...old,sha256:digest(old)} as DeliveryRecord};
}
it('retains old record bytes and hashes, permits strict supersession and restart, and refuses a new legacy save or approval',async()=>{
 const {legacy,current}=fixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'functional-history-'));roots.push(root);const file=path.join(root,'delivery-records.json'),bytes=JSON.stringify({schemaVersion:1,records:[legacy]});await fs.writeFile(file,bytes);
 const records=new DeliveryRecords(root);await records.init();expect(records.current(legacy.repoId)).toEqual(legacy);expect(await fs.readFile(file,'utf8')).toBe(bytes);
 expect(discoveryBlockers(legacy).join(' ')).toContain('Historical planning contract');
 await expect(records.review(legacy.repoId,legacy,{artifactSha256:'b'.repeat(64),docId:'HLD-11111111-1111-4111-8111-111111111111',decision:'approved',notes:'A synthetic independent approval attempt must never approve an obsolete functional polling contract retained in history.'},'qa',{brief:legacy.content.brief})).rejects.toThrow('Historical planning contract');
 await expect(records.save(legacy.repoId,1,legacy.content,'author')).rejects.toThrow();expect(await fs.readFile(file,'utf8')).toBe(bytes);
 await records.save(legacy.repoId,1,current,'author');await records.close();const reopened=new DeliveryRecords(root);await reopened.init();expect(reopened.view(legacy.repoId)[1]).toEqual(legacy);expect(JSON.stringify(reopened.view(legacy.repoId)[1])).toBe(JSON.stringify(legacy));await reopened.close();
});
it.each(['unknown','over-window','wrong-assertion','approved'])('refuses unsupported historical shape: %s',mode=>{const {legacy}=fixture(),row=legacy as any,c=row.content.taskPlan.integrationQa[0].cases[0].functionalAssertion;if(mode==='unknown')c.extra=true;if(mode==='over-window')c.pollIntervalMs=2000;if(mode==='wrong-assertion')c.assertions=['authenticated-403'];if(mode==='approved')row.designReview={decision:'approved'};expect(historicalDeliveryRecordSchema.safeParse(row).success).toBe(false);});
it('does not use compatibility to accept a changed signed record',async()=>{const {legacy}=fixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'functional-history-'));roots.push(root);legacy.content.outcome='Changed';await fs.writeFile(path.join(root,'delivery-records.json'),JSON.stringify({schemaVersion:1,records:[legacy]}));await expect(new DeliveryRecords(root).init()).rejects.toThrow('inconsistent');});
