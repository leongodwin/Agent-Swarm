import {connectorProbeFixturePlan} from './connectorProbe.ts';
import {standaloneProbePlanSchema,STANDALONE_PROBE_KIND} from '../standaloneMetadataProbe.ts';
export function standaloneProbeFixturePlan(){
 const {publisher:_publisher,solution:_solution,connection,flow:_flow,...base}=connectorProbeFixturePlan();
 return standaloneProbePlanSchema.parse({...base,kind:STANDALONE_PROBE_KIND,connection:{connector:connection.connector,connectionId:connection.connectionId},flow:{componentKey:'digest-flow',name:'AS-Recruitment-Standalone-Digest'},
  quarantine:{flowId:'7c616699-07cf-f111-a05c-000d3ada7729',solutionId:'b2938b8c-07cf-f111-a05c-000d3ada7729',publisherId:'af938b8c-07cf-f111-a05c-000d3ada7729',referenceId:'f577bd92-07cf-f111-a05c-000d3ada7729',indexSha256:'a'.repeat(64),leaseSha256:'b'.repeat(64),holdPreserved:true,membershipSettlementVerified:false,replayAuthorized:false}});
}
