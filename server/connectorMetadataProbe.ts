import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {recordReferenceSchema} from '../shared/deliveryRecord.ts';
import {platformIdentitySchema} from './platformAuth.ts';
import {dataverseGuid} from './targetOperations.ts';
import {flowDefinitionForPreflight} from './flowAdapter.ts';

export const CONNECTOR_PROBE_KIND='outlook-folder-metadata-probe-v1' as const;
export const CONNECTOR_PROBE_URI='https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount';
// This literal attempts a folder-only failure path. Its status is observed,
// never predicted: an unexpected success supplies no negative-channel proof.
export const CONNECTOR_PROBE_MISSING_URI='https://graph.microsoft.com/v1.0/me/mailFolders/AS-E2E-Contract-Probe-Invalid-Folder-20261023?$select=totalItemCount,unreadItemCount';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const identifier=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,79}$/);
export const connectorProbePlanSchema=z.strictObject({
 schemaVersion:z.literal(1),kind:z.literal(CONNECTOR_PROBE_KIND),probeId:z.uuid(),record:recordReferenceSchema,
 sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),implementationSha256:hash,configurationSha256:hash,
 adapter:z.strictObject({name:z.string().min(1).max(100),version:z.string().min(1).max(100),entrySha256:hash}),
 issue:z.number().int().positive(),owner:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),qaOwner:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),taskHash:hash,
 identity:platformIdentitySchema,target:z.strictObject({environmentUrl:z.url(),organizationId:dataverseGuid,userId:dataverseGuid}),
 connection:z.strictObject({connector:z.literal('shared_office365'),connectionId:z.string().regex(/^shared-office365-[A-Za-z0-9_-]{1,160}$/),logicalName:identifier}),
 publisher:z.strictObject({uniqueName:identifier,displayName:z.string().min(1).max(100),prefix:z.string().regex(/^[a-z][a-z0-9]{1,7}$/).refine(p=>p!=='new')}),
 solution:z.strictObject({uniqueName:identifier,displayName:z.string().min(1).max(100),version:z.literal('1.0.0.0')}),
 flow:z.strictObject({componentKey:z.literal('digest-flow'),name:z.string().regex(/^AS-[A-Za-z0-9 _-]{3,76}$/)}),
 historyPolicy:z.strictObject({kind:z.literal('existing-tenant-run-history-v1'),recordId:z.uuid(),recordSha256:hash,ownerId:dataverseGuid}),
 limits:z.strictObject({maxTaskDurationMs:z.literal(120000),maxReleaseDurationMs:z.literal(3600000),stopNewWorkAfterMs:z.literal(90000),maxNativeCalls:z.literal(64),maxOutputBytes:z.literal(256000),hostTriggerCalls:z.literal(1)}),
}).superRefine((p,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(p.owner===p.qaOwner)fail('Independent probe reviewer required');
 if(p.historyPolicy.recordId!==p.record.id||p.historyPolicy.recordSha256!==p.record.sha256||p.historyPolicy.ownerId.toLowerCase()!==p.target.userId.toLowerCase())fail('Exact record and existing history owner binding required');
 const u=new URL(p.target.environmentUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^([a-z0-9-]+)\.crm[0-9]*\.dynamics\.com$/i.test(u.hostname))fail('Canonical Dataverse target URL required');
 if(!p.connection.logicalName.startsWith(p.publisher.prefix+'_'))fail('Dedicated publisher-prefixed connection reference required');
});
export type ConnectorProbePlan=z.infer<typeof connectorProbePlanSchema>;
export const connectorProbeDigest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Fixed builder only. It accepts no custom definition, URI, connector, script,
 * message selector, recipient, retry controller or shell command. Currently
 * unwired: a separate exact independent probe grant is required before use. */
export function buildConnectorMetadataProbe(raw:ConnectorProbePlan){
 const p=connectorProbePlanSchema.parse(raw);
 const http=(Uri:string,runAfter:Record<string,string[]>)=>({type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_office365',operationId:'HttpRequest',connectionName:'shared_office365'},parameters:{Method:'GET',Uri,CustomHeader1:'Prefer: outlook.body-content-type="text"'},retryPolicy:{type:'none'}},runAfter});
 const definition={
  $schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',
  metadata:{templateId:'fa2c7b91-3e04-4d8a-b6f1-a9e5c8d20147'},
  parameters:{$authentication:{defaultValue:{},type:'SecureObject'},$connections:{defaultValue:{},type:'Object'}},
  triggers:{manual:{type:'Request',kind:'Button',inputs:{schema:{type:'object',additionalProperties:false,required:['kind','correlationId'],properties:{kind:{type:'string',enum:[CONNECTOR_PROBE_KIND]},correlationId:{type:'string',format:'uuid'}}}}}},
  actions:{
   Probe_input_guard:{type:'If',expression:{not:{equals:["@triggerBody()?['kind']",CONNECTOR_PROBE_KIND]}},actions:{Reject_probe_input:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'PROBE_INPUT_UNSUPPORTED',message:'Probe input is unsupported'}}}},else:{actions:{}},runAfter:{}},
   Probe_context:{type:'Compose',inputs:{kind:CONNECTOR_PROBE_KIND,probeId:p.probeId,correlationId:"@triggerBody()?['correlationId']"},runAfter:{Probe_input_guard:['Succeeded']}},
   Metadata_http:http(CONNECTOR_PROBE_URI,{Probe_context:['Succeeded']}),
   Validate_folder_metadata:{type:'ParseJson',inputs:{content:"@body('Metadata_http')",schema:{type:'object',required:['totalItemCount','unreadItemCount'],properties:{totalItemCount:{type:'integer',minimum:0},unreadItemCount:{type:'integer',minimum:0}}}},runAfter:{Metadata_http:['Succeeded']}},
   Missing_folder_http:http(CONNECTOR_PROBE_MISSING_URI,{Validate_folder_metadata:['Succeeded']}),
  },
 };
 const connectionRefs={shared_office365:{id:'/providers/Microsoft.PowerApps/apis/shared_office365',connectionName:p.connection.connectionId,connectionReferenceLogicalName:p.connection.logicalName,source:'Embedded'}};
 return{definition,connectionRefs,definitionSha256:connectorProbeDigest(definition),connectionRefsSha256:connectorProbeDigest(connectionRefs)};
}

export function assertConnectorProbeReadback(plan:ConnectorProbePlan,rawDefinition:Record<string,unknown>,rawRefs:unknown){
 const expected=buildConnectorMetadataProbe(plan),definition=flowDefinitionForPreflight(rawDefinition);
 if(!isDeepStrictEqual(definition,expected.definition)||!isDeepStrictEqual(rawRefs,expected.connectionRefs))throw Error('CONNECTOR_PROBE_READBACK_DIFFERS');
 return{definitionSha256:expected.definitionSha256,connectionRefsSha256:expected.connectionRefsSha256,businessAuthorityGranted:false,messageRoutesPresent:false,sendActionPresent:false};
}
