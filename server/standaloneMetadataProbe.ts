import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {connectorProbePlanSchema,connectorProbeDigest,CONNECTOR_PROBE_KIND,CONNECTOR_PROBE_URI,CONNECTOR_PROBE_MISSING_URI} from './connectorMetadataProbe.ts';
import {dataverseGuid} from './targetOperations.ts';
import {STANDALONE_ADAPTER_VERSION} from './standaloneFlowAgentBuild.ts';
import {flowDefinitionForPreflight} from './flowAdapter.ts';

export const STANDALONE_PROBE_KIND='outlook-folder-metadata-standalone-v1' as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),guid=dataverseGuid;
const {publisher:_publisher,solution:_solution,connection,flow:_flow,...base}=connectorProbePlanSchema.shape;
export const standaloneProbePlanSchema=z.strictObject({...base,kind:z.literal(STANDALONE_PROBE_KIND),
 adapter:base.adapter.safeExtend({name:z.literal('flowagent-mcp'),version:z.literal(STANDALONE_ADAPTER_VERSION)}),
 ownerObjectId:dataverseGuid,
 connection:z.strictObject({connector:connection.shape.connector,connectionId:connection.shape.connectionId}),
 flow:z.strictObject({componentKey:z.literal('digest-flow'),name:z.literal('AS-Recruitment-Standalone-Digest')}),
 quarantine:z.strictObject({flowId:guid,solutionId:guid,publisherId:guid,referenceId:guid,indexSha256:hash,leaseSha256:hash,holdPreserved:z.literal(true),membershipSettlementVerified:z.literal(false),replayAuthorized:z.literal(false)}),
}).superRefine((p,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(p.owner===p.qaOwner)fail('Independent standalone probe reviewer required');
 if(p.historyPolicy.recordId!==p.record.id||p.historyPolicy.recordSha256!==p.record.sha256||p.historyPolicy.ownerId.toLowerCase()!==p.target.userId.toLowerCase())fail('Exact record/history owner required');
 const u=new URL(p.target.environmentUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+)\.crm[0-9]*\.dynamics\.com$/i.test(u.hostname))fail('Canonical Dataverse target URL required');
 if(new Set([p.quarantine.flowId,p.quarantine.solutionId,p.quarantine.publisherId,p.quarantine.referenceId].map(x=>x.toLowerCase())).size!==4)fail('Distinct original quarantine identities required');
});
export type StandaloneProbePlan=z.infer<typeof standaloneProbePlanSchema>;

/** Fixed metadata-only builder. No solution/reference fields or caller URI/code. */
export function buildStandaloneMetadataProbe(raw:StandaloneProbePlan){
 const p=standaloneProbePlanSchema.parse(raw);
 const http=(Uri:string,runAfter:Record<string,string[]>)=>({type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_office365',operationId:'HttpRequest',connectionName:'shared_office365'},parameters:{Method:'GET',Uri,CustomHeader1:'Prefer: outlook.body-content-type="text"'},retryPolicy:{type:'none'}},runAfter});
 const definition={$schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{$authentication:{defaultValue:{},type:'SecureObject'},$connections:{defaultValue:{},type:'Object'}},
  triggers:{manual:{type:'Request',kind:'Button',inputs:{schema:{type:'object',additionalProperties:false,required:['kind','correlationId'],properties:{kind:{type:'string',enum:[STANDALONE_PROBE_KIND]},correlationId:{type:'string',format:'uuid'}}}}}},
  actions:{Probe_input_guard:{type:'If',expression:{not:{equals:["@triggerBody()?['kind']",STANDALONE_PROBE_KIND]}},actions:{Reject_probe_input:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'PROBE_INPUT_UNSUPPORTED',message:'Probe input is unsupported'}}}},else:{actions:{}},runAfter:{}},
   Probe_context:{type:'Compose',inputs:{kind:STANDALONE_PROBE_KIND,probeId:p.probeId,correlationId:"@triggerBody()?['correlationId']"},runAfter:{Probe_input_guard:['Succeeded']}},
   Metadata_http:http(CONNECTOR_PROBE_URI,{Probe_context:['Succeeded']}),
   Validate_folder_metadata:{type:'ParseJson',inputs:{content:"@body('Metadata_http')",schema:{type:'object',required:['totalItemCount','unreadItemCount'],properties:{totalItemCount:{type:'integer',minimum:0},unreadItemCount:{type:'integer',minimum:0}}}},runAfter:{Metadata_http:['Succeeded']}},
   Missing_folder_http:http(CONNECTOR_PROBE_MISSING_URI,{Validate_folder_metadata:['Succeeded']})}};
 const connectionRefs={shared_office365:{id:'/providers/Microsoft.PowerApps/apis/shared_office365',connectionName:p.connection.connectionId,source:'Embedded'}};
 return {definition,connectionRefs,definitionSha256:connectorProbeDigest(definition),connectionRefsSha256:connectorProbeDigest(connectionRefs)};
}

/** Only observed connector presentation fields may differ. Binding stays exact. */
export function assertStandaloneProbeReadback(plan:StandaloneProbePlan,rawDefinition:Record<string,unknown>,rawRefs:unknown){
 const expected=buildStandaloneMetadataProbe(plan),definition=flowDefinitionForPreflight(rawDefinition);
 if(Object.hasOwn(definition,'metadata')){z.strictObject({templateId:z.literal('fa2c7b91-3e04-4d8a-b6f1-a9e5c8d20147')}).parse(definition.metadata);delete definition.metadata;}
 const ref=z.strictObject({id:z.literal('/providers/Microsoft.PowerApps/apis/shared_office365'),connectionName:z.literal(plan.connection.connectionId),source:z.literal('Embedded'),displayName:z.literal('Office 365 Outlook').optional(),iconUri:z.string().regex(/^https:\/\/static\.powerapps\.com\/resource\/ppcr\/releases\/[A-Za-z0-9./_-]+\/office365\/icon\.png$/).optional(),brandColor:z.literal('#0078D4').optional(),tier:z.literal('Standard').optional(),apiName:z.literal('office365').optional(),isProcessSimpleApiReferenceConversionAlreadyDone:z.literal(false).optional()});
 z.strictObject({shared_office365:ref}).parse(rawRefs);
 if(!isDeepStrictEqual(definition,expected.definition))throw Error('Standalone probe definition differs');
 return {definitionSha256:expected.definitionSha256,connectionRefsSha256:expected.connectionRefsSha256,rawConnectionRefsSha256:connectorProbeDigest(rawRefs),businessAuthorityGranted:false,messageRoutesPresent:false,sendActionPresent:false};
}

/** Check the original fixed counter definition without ever changing it. */
export function assertOriginalQuarantinedDefinition(plan:StandaloneProbePlan,originalProbeId:string,rawDefinition:Record<string,unknown>){
 const base=buildStandaloneMetadataProbe(plan).definition,definition=flowDefinitionForPreflight(rawDefinition),manual=base.triggers.manual;
 const expected={...base,triggers:{...base.triggers,manual:{...manual,inputs:{...manual.inputs,schema:{...manual.inputs.schema,properties:{...manual.inputs.schema.properties,kind:{...manual.inputs.schema.properties.kind,enum:[CONNECTOR_PROBE_KIND]}}}}}},actions:{...base.actions,
  Probe_input_guard:{...base.actions.Probe_input_guard,expression:{not:{equals:[base.actions.Probe_input_guard.expression.not.equals[0],CONNECTOR_PROBE_KIND]}}},
  Probe_context:{...base.actions.Probe_context,inputs:{...base.actions.Probe_context.inputs,kind:CONNECTOR_PROBE_KIND,probeId:z.uuid().parse(originalProbeId)}}}};
 if(Object.hasOwn(definition,'metadata')){z.strictObject({templateId:z.literal('fa2c7b91-3e04-4d8a-b6f1-a9e5c8d20147')}).parse(definition.metadata);delete definition.metadata;}
 if(!isDeepStrictEqual(definition,expected))throw Error('Original quarantined metadata definition changed');
 return {originalDefinitionSha256:connectorProbeDigest(rawDefinition),originalHoldPreserved:true,providerMembershipSettlementVerified:false,replayAuthorized:false};
}

