import {connectorProbeFixturePlan,connectorProbeFixtureRecord} from './connectorProbe.ts';
import {standaloneProbePlanSchema,STANDALONE_PROBE_KIND} from '../standaloneMetadataProbe.ts';
import {STANDALONE_ADAPTER_VERSION} from '../standaloneFlowAgentBuild.ts';
export function standaloneProbeFixturePlan(){
 const {publisher:_publisher,solution:_solution,connection,flow:_flow,...base}=connectorProbeFixturePlan();
 return standaloneProbePlanSchema.parse({...base,kind:STANDALONE_PROBE_KIND,ownerObjectId:'33333333-3333-4333-8333-333333333333',adapter:{...base.adapter,name:'flowagent-mcp',version:STANDALONE_ADAPTER_VERSION},connection:{connector:connection.connector,connectionId:connection.connectionId},flow:{componentKey:'digest-flow',name:'AS-Recruitment-Standalone-Digest'},
  quarantine:{flowId:'7c616699-07cf-f111-a05c-000d3ada7729',solutionId:'b2938b8c-07cf-f111-a05c-000d3ada7729',publisherId:'af938b8c-07cf-f111-a05c-000d3ada7729',referenceId:'f577bd92-07cf-f111-a05c-000d3ada7729',indexSha256:'a'.repeat(64),leaseSha256:'b'.repeat(64),holdPreserved:true,membershipSettlementVerified:false,replayAuthorized:false}});
}

export function standaloneProbeFixtureRecord(p:ReturnType<typeof standaloneProbeFixturePlan>):any{
 const record=connectorProbeFixtureRecord(connectorProbeFixturePlan());
 delete record.content.connectorProbe;
 record.content.standaloneProbe={kind:p.kind,taskIssue:p.issue,flowComponentId:'digest-flow',flowResource:'standalone_flow',authoringOrderContractId:'standalone-connector-probe-authority',resourcePolicy:'new-flow-with-quarantined-original',historyPolicy:'existing-tenant-history-and-protected-windows-leaf',businessAuthorityGranted:false,messageAccessAllowed:false,sendAllowed:false};
 record.content.contracts[0].id='standalone-connector-probe-authority';
 record.content.taskPlan.tasks[0].resources=['standalone_flow'];
 return record;
}
