import fs from 'node:fs';
import crypto from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {reconcileCanvasPlanning,type CanvasPlanningTarget} from './planningCanvasEvidence.ts';
import {deliveryRecordContentSchema,discoveryBlockers,type DeliveryRecord} from '../shared/deliveryRecord.ts';

const content=deliveryRecordContentSchema.parse(JSON.parse(fs.readFileSync(new URL('./fixtures/cloudasset-approval-content.json',import.meta.url),'utf8')));
const target:CanvasPlanningTarget={appId:'14e6980e-734e-4b43-a220-f5ff393095e5',environmentId:'Default-5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c',account:'leon@graspai.co.uk',connectionId:'shared-sharepointonl-54d3d00b',site:'https://mydevnet.sharepoint.com/sites/GraspAI',resourceIds:['a08957e8-bf46-466e-b1cb-93dfdfeb9347','2ff4739d-7ab4-48fb-a5de-c7766a6cd026','c14f4bd2-f9f7-46e7-a7b1-bb57a80dc622']};
const stamps=['2026-10-18T13:08:07.272Z','2026-10-18T13:17:55.594Z','2026-10-18T13:18:00.153Z'];
const now=Date.parse(stamps[2])+1000;
function fixture(){
 const names=['Artifacts','Projects','Run Logs'];
 return [
  {scope:'canvas-source-sync-diagnostic-only',observedAt:stamps[0],target:{environmentId:target.environmentId,appId:target.appId,account:target.account},status:'source-sync-observed',sourceSyncObserved:true,cleanupVerified:true,authoringApproved:false,runtimeVerified:false,files:[{name:'App.pa.yaml',bytes:46,sha256:'a'.repeat(64)}]},
  {scope:'existing-source-association-only',observedAt:stamps[1],appId:target.appId,environmentId:target.environmentId,account:target.account,connectionId:target.connectionId,site:target.site,selectedIds:[...target.resourceIds],excludedId:'0197e042-91a4-4356-841e-7c804b79df22',published:false,savedStatus:'All changes are saved.',pickerResources:target.resourceIds.map((Name,i)=>({Name,DisplayName:names[i]}))},
  {scope:'live-native-data-source-schema-only',observedAt:stamps[2],schemas:names.map(name=>({status:'fulfilled',value:{content:[{type:'text',text:`Data Source: ${name}\r\nKind: Connected\r\n\r\nColumns (1):\r\n - ID: Number\r\n`}]}}))},
 ] as any[];
}
const captured=(rows:any[])=>rows.map((row,i)=>({reference:`evidence/canvas-${i}.json`,bytes:Buffer.from(JSON.stringify(row))}));
describe('independent Canvas planning evidence reconciliation',()=>{
 it('changes only the contradicted prerequisite finding and binds original bytes/times without granting approvals',()=>{
  const before=structuredClone(content),artifacts=captured(fixture()),result=reconcileCanvasPlanning(content,target,artifacts,now);
  expect(content).toEqual(before);
  expect(result.findings.filter(f=>f.id!=='canvas-session')).toEqual(content.findings.filter(f=>f.id!=='canvas-session'));
  const finding=result.findings.find(f=>f.id==='canvas-session')!;
  expect(finding.conclusion).toBe('ready');
  expect(finding.statement).toContain('source-authoring prerequisite only');
  expect(finding.statement).toContain('Compilation, App checker, export, licensing, runtime and deployment remain unverified');
  expect(finding.remedy).toContain('independent design/task approval');
  for(let i=0;i<3;i++)expect(finding.evidence[i]).toEqual({reference:artifacts[i].reference,sha256:crypto.createHash('sha256').update(artifacts[i].bytes).digest('hex'),observedAt:stamps[i],expiresAt:new Date(Date.parse(stamps[i])+7200000).toISOString()});
  const expected=structuredClone(before);
  const answer=expected.applicationSpec!.decisions.find(d=>d.id==='supported-delivery')!;
  answer.answer=answer.answer!.replace('Current Canvas editor is not joined and production native attempt/complete coverage are unsupported.','The dedicated saved Canvas editor is joined and source/schema preparation is observed; production native attempt/complete coverage remain unsupported.');
  const task=expected.taskPlan!.tasks.find(t=>t.issue===7)!;
  task.inputs=task.inputs.map(input=>input.replace('No blank or expense app session.',`Use saved dedicated app ${target.appId}, including its blank responsive baseline; no unrelated, unbound or expense app session.`));
  const {findings:beforeFindings,...beforeOther}=expected,{findings:afterFindings,...afterOther}=result;
  expect(afterOther).toEqual(beforeOther);
  const blockers=discoveryBlockers({content:result} as DeliveryRecord,now).join(' ');
  for(const id of ['runner-adapters','flow-contracts','target-and-licensing'])expect(blockers).toContain(id);
  expect(result.applicationSpec!.assumptions.find(a=>a.id==='runner-support')!.status).toBe('unverified');
 });
 it('corrects only the exact stale decision/task clauses and retains unsupported native capabilities and authoring gates',()=>{
  const result=reconcileCanvasPlanning(content,target,captured(fixture()),now);
  const decision=result.applicationSpec!.decisions.find(d=>d.id==='supported-delivery')!;
  expect(decision.answer).toContain('dedicated saved Canvas editor is joined');
  expect(decision.answer).toContain('production native attempt/complete coverage remain unsupported');
  expect(decision.answer).toContain('infrastructure implementation and real independent evidence remain blocked');
  const task=result.taskPlan!.tasks.find(t=>t.issue===7)!;
  expect(task.inputs.join(' ')).toContain(`saved dedicated app ${target.appId}, including its blank responsive baseline`);
  expect(task.stopConditions).toEqual(content.taskPlan!.tasks.find(t=>t.issue===7)!.stopConditions);
  expect(task.outputs).toEqual(content.taskPlan!.tasks.find(t=>t.issue===7)!.outputs);
  expect(result.taskPlan!.integrationQa).toEqual(content.taskPlan!.integrationQa);
 });
 it('never replaces similar prose in unrelated decisions or tasks',()=>{
  const altered=structuredClone(content),decision=altered.applicationSpec!.decisions.find(d=>d.id!=='supported-delivery')!;
  decision.answer+=' Current Canvas editor is not joined and production native attempt/complete coverage are unsupported.';
  const task=altered.taskPlan!.tasks.find(t=>t.issue!==7)!;task.inputs.push('No blank or expense app session.');
  const result=reconcileCanvasPlanning(altered,target,captured(fixture()),now);
  expect(result.applicationSpec!.decisions.find(d=>d.id===decision.id)).toEqual(decision);
  expect(result.taskPlan!.tasks.find(t=>t.issue===task.issue)).toEqual(task);
 });
 it('rebinds only task5 current-source contract input while retaining historical hashes and lineage',()=>{
  const altered=structuredClone(content),current='ca3a5559ffaf59ee6c2accd0d357334959cf2cd0';
  altered.sourceCommit=current;
  const original=altered.taskPlan!.tasks.find(t=>t.issue===5)!,historicalInput=`Historical schema bootstrap approval at source ${content.sourceCommit}; schema plan ${'5abd1e7c88d94d9224c656ff37eb243a95b8f00e04c56312a58b760183d5ccfc'}`;
  original.inputs.push(historicalInput);
  const result=reconcileCanvasPlanning(altered,target,captured(fixture()),now),task=result.taskPlan!.tasks.find(t=>t.issue===5)!;
  const prefix='Pinned cubefarm.sharepoint.json, cubefarm.authoring.json and docs/delivery/AUTHORING-CONTRACT.md at current source ';
  expect(task.inputs.filter(i=>i.startsWith(prefix))).toEqual([prefix+current]);
  expect(task.inputs.filter(i=>!i.startsWith(prefix))).toEqual(original.inputs.filter(i=>!i.startsWith(prefix)));
  expect(task.inputs).toContain(historicalInput);
  const {inputs:beforeInputs,...beforeTask}=original,{inputs:afterInputs,...afterTask}=task;
  expect(afterTask).toEqual(beforeTask);
  expect(result.findings.filter(f=>f.id!=='canvas-session')).toEqual(altered.findings.filter(f=>f.id!=='canvas-session'));
  expect(result.requirements).toEqual(altered.requirements);expect(result.contracts).toEqual(altered.contracts);
 });
 it('does not rebind a similar source statement belonging to another task or historical sentence',()=>{
  const altered=structuredClone(content),old=content.sourceCommit!;
  altered.sourceCommit='f'.repeat(40);
  const original=`Pinned cubefarm.sharepoint.json, cubefarm.authoring.json and docs/delivery/AUTHORING-CONTRACT.md at current source ${old}`;
  const other=altered.taskPlan!.tasks.find(t=>t.issue!==5&&t.issue!==7)!;other.inputs.push(original);
  const task5=altered.taskPlan!.tasks.find(t=>t.issue===5)!;task5.inputs.push(original+' (historical observation)');
  const result=reconcileCanvasPlanning(altered,target,captured(fixture()),now);
  expect(result.taskPlan!.tasks.find(t=>t.issue===other.issue)).toEqual(other);
  expect(result.taskPlan!.tasks.find(t=>t.issue===5)!.inputs).toContain(original+' (historical observation)');
 });
 it.each(['appId','environmentId','account','connectionId','site'] as const)('rejects mismatched UI %s',key=>{
  const rows=fixture();rows[1][key]='different';expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it('rejects substitution of the protected Documents library',()=>{
  const rows=fixture();rows[1].selectedIds[0]=rows[1].excludedId;expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it.each([0,1,2])('rejects stale artifact %i without freshening its observation',index=>{
  const rows=fixture();rows[index].observedAt='2026-10-18T11:00:00.000Z';expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow(/expired/);
 });
 it.each([0,1,2])('rejects future-dated artifact %i',index=>{
  const rows=fixture();rows[index].observedAt=new Date(now+1).toISOString();expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow(/future/);
 });
 it.each([0,1,2])('rejects a missing or repurposed receipt scope %i',index=>{
  const rows=fixture();rows[index].scope='unrelated-operation';expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it('rejects failed schema rows concealed by a multi-source response',()=>{
  const rows=fixture(),schemas=rows[2].schemas;
  schemas[0].value.content.push(...schemas[1].value.content,...schemas[2].value.content);
  schemas[1]={status:'rejected',reason:'native error'};schemas[2]={status:'rejected',reason:'native error'};
  expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it('rejects duplicate YAML identities even with individually valid digests',()=>{
  const rows=fixture();rows[0].files.push({...rows[0].files[0]});expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it('rejects conflicting resource-picker identities rather than silently accepting the first',()=>{
  const rows=fixture();rows[1].pickerResources.push({Name:target.resourceIds[0],DisplayName:'Different library'});expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
 it.each(['authoringApproved','runtimeVerified'])('rejects an inflated %s claim',key=>{
  const rows=fixture();rows[0][key]=true;expect(()=>reconcileCanvasPlanning(content,target,captured(rows),now)).toThrow();
 });
});
