import {expect,it} from 'vitest';
import {deliveryRecordContentSchema} from '../shared/deliveryRecord.ts';
import {phaseRecordFixture} from './testFixtures/phaseRecord.ts';
function content(){
 const c:any=phaseRecordFixture().content;c.applicationSpec.components[0].id='digest-flow';
 for(const check of c.applicationSpec.checks)check.componentIds=check.componentIds.map((id:string)=>id==='flow'?'digest-flow':id);
 for(const task of c.taskPlan.tasks)task.componentIds=task.componentIds.map((id:string)=>id==='flow'?'digest-flow':id);
 c.taskPlan.tasks[0].resources.push('standalone_flow');c.contracts.push({id:'standalone-connector-probe-authority',owner:'dev',description:'Synthetic standalone-only proposal; no real approval or tenant authority.',requirementIds:['base']});
 c.standaloneProbe={kind:'outlook-folder-metadata-standalone-v1',taskIssue:1,flowComponentId:'digest-flow',flowResource:'standalone_flow',authoringOrderContractId:'standalone-connector-probe-authority',resourcePolicy:'new-flow-with-quarantined-original',historyPolicy:'existing-tenant-history-and-protected-windows-leaf',businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false};return c;
}
it('admits only a prospective owner-bound standalone selection without granting business authority',()=>{
 const c=deliveryRecordContentSchema.parse(content());expect(c.standaloneProbe).toMatchObject({businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false});expect(c.connectorProbe).toBeUndefined();
});
it.each([
 (c:any)=>{c.standaloneProbe.sendAllowed=true;},(c:any)=>{c.standaloneProbe.solutionResource='old_solution';},
 (c:any)=>{c.standaloneProbe.flowResource='foreign';},(c:any)=>{c.contracts=c.contracts.filter((x:any)=>x.id!=='standalone-connector-probe-authority');},
 (c:any)=>{c.applicationSpec.components[0].platform='other';},(c:any)=>{c.standaloneProbe.taskIssue=99;},
 (c:any)=>{c.connectorProbe={kind:'outlook-folder-metadata-probe-v1',taskIssue:1,flowComponentId:'digest-flow',solutionResource:'flow',authoringOrderContractId:'connector-metadata-probe-authority',resourcePolicy:'same-eventual-owned-flow',historyPolicy:'existing-tenant-history-and-protected-windows-leaf',businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false};},
])('refuses broadened authority, foreign resources or original-protocol rebinding',mutate=>{
 const c=content();mutate(c);expect(()=>deliveryRecordContentSchema.parse(c)).toThrow();
});
