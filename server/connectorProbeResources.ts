import {z} from 'zod';
import type {FlowAdapter} from './flowAdapter.ts';
import {verifyPlatformAuthentication,type Command} from './platformAuth.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {buildConnectorMetadataProbe,connectorProbeDigest,type ConnectorProbePlan} from './connectorMetadataProbe.ts';
import {dataverseGuid} from './targetOperations.ts';

/** Fixed managed-CLI orchestration, not a generic Dataverse write tool. Only
 * new same-plan publisher/solution/reference/flow creation and membership are
 * possible. Any existing name or partial prior operation refuses adoption. */
export async function prepareConnectorProbeResources(plan:ConnectorProbePlan,deps:{command:Command;flow:FlowAdapter;admit():Promise<void>;journal(stage:string,metadata:Record<string,unknown>):Promise<void>;guard():void}){
 const command:Command=async(executable,args)=>{await deps.admit();deps.guard();const value=await deps.command(executable,args);deps.guard();return value;};
 const environment=plan.target.environmentUrl,marker='AgentSwarmProbe:'+plan.probeId+':'+plan.record.sha256;
 const request=async(method:string,route:string,body?:unknown)=>{
  deps.guard();const text=await command('dataverse',['api','request','--target','dataverse','--path','/api/data/v9.2/'+route,'--method',method,'--environment',environment,...body===undefined?[]:['--body',JSON.stringify(body)]]);
  return text.trim()?parseUnambiguousJson(text,{maxBytes:256000}):{};
 };
 const flow=async(tool:string,args:Record<string,unknown>)=>{await deps.admit();deps.guard();const r=await deps.flow.call(tool,args);deps.guard();return r;};
 await verifyPlatformAuthentication(command,request,environment,{organizationId:plan.target.organizationId,userId:plan.target.userId},plan.identity,()=>flow('whoami',{}));
 const rows=async(route:string)=>z.object({value:z.array(z.record(z.string(),z.unknown())).max(3),'@odata.nextLink':z.never().optional()}).parse(await request('GET',route)).value;
 for(const [table,field,value] of [['publishers','uniquename',plan.publisher.uniqueName],['solutions','uniquename',plan.solution.uniqueName],['connectionreferences','connectionreferencelogicalname',plan.connection.logicalName],['workflows','name',plan.flow.name]]){
  if((await rows(table+'?$filter='+encodeURIComponent(field+" eq '"+value.replace(/'/g,"''")+"'")+'&$top=2')).length)throw Error('Dedicated probe name already exists; no adoption or retry');
 }
 const create=async(table:string,body:Record<string,unknown>,solution?:string)=>{
  await deps.journal('create-'+table+'-intent',{table,payloadSha256:connectorProbeDigest(body),solution:solution??null});
  const raw=await command('dataverse',['data','create','--table',table,'--data',JSON.stringify(body),'--environment',environment,'--json',...solution?['--solution-unique-name',solution]:[]]);
  const result=z.object({id:dataverseGuid,table:z.literal(table)}).parse(parseUnambiguousJson(raw,{maxBytes:16384}));await deps.journal('created-'+table,{table,id:result.id,payloadSha256:connectorProbeDigest(body)});return result.id;
 };
 const publisherId=await create('publishers',{uniquename:plan.publisher.uniqueName,friendlyname:plan.publisher.displayName,customizationprefix:plan.publisher.prefix,description:marker});
 z.object({publisherid:z.literal(publisherId),uniquename:z.literal(plan.publisher.uniqueName),friendlyname:z.literal(plan.publisher.displayName),customizationprefix:z.literal(plan.publisher.prefix),description:z.literal(marker),_createdby_value:z.literal(plan.target.userId)}).parse(await request('GET',`publishers(${publisherId})?$select=publisherid,uniquename,friendlyname,customizationprefix,description,_createdby_value`));
 const solutionId=await create('solutions',{uniquename:plan.solution.uniqueName,friendlyname:plan.solution.displayName,version:plan.solution.version,description:marker,'publisherid@odata.bind':`publishers(${publisherId})`});
 z.object({solutionid:z.literal(solutionId),uniquename:z.literal(plan.solution.uniqueName),version:z.literal(plan.solution.version),ismanaged:z.literal(false),_publisherid_value:z.literal(publisherId),description:z.literal(marker),_createdby_value:z.literal(plan.target.userId)}).parse(await request('GET',`solutions(${solutionId})?$select=solutionid,uniquename,version,ismanaged,_publisherid_value,description,_createdby_value`));
 const connector='/providers/Microsoft.PowerApps/apis/shared_office365';
 const referenceId=await create('connectionreferences',{connectionreferencelogicalname:plan.connection.logicalName,connectionreferencedisplayname:plan.flow.name+' Outlook',connectionid:plan.connection.connectionId,connectorid:connector,description:marker,'ownerid@odata.bind':`systemusers(${plan.target.userId})`},plan.solution.uniqueName);
 z.object({connectionreferenceid:z.literal(referenceId),connectionreferencelogicalname:z.literal(plan.connection.logicalName),connectionid:z.literal(plan.connection.connectionId),connectorid:z.literal(connector),statecode:z.literal(0),ismanaged:z.literal(false),_ownerid_value:z.literal(plan.target.userId)}).parse(await request('GET',`connectionreferences(${referenceId})?$select=connectionreferenceid,connectionreferencelogicalname,connectionid,connectorid,statecode,ismanaged,_ownerid_value`));
 const built=buildConnectorMetadataProbe(plan);
 z.object({overall:z.literal('ready')}).parse(await flow('preflight_flow',{env:plan.identity.environmentId,definition:built.definition,connectionReferences:built.connectionRefs}));
 await deps.journal('create-flow-intent',{name:plan.flow.name,definitionSha256:built.definitionSha256,connectionRefsSha256:built.connectionRefsSha256,publisherId,solutionId,referenceId});
 const created=z.object({name:dataverseGuid,displayName:z.literal(plan.flow.name),state:z.literal('Stopped')}).parse(await flow('create_flow',{env:plan.identity.environmentId,name:plan.flow.name,definition:built.definition,connectionRefs:built.connectionRefs,state:'Stopped',allowDuplicate:false}));
 await deps.journal('created-flow',{flowId:created.name,publisherId,solutionId,referenceId});
 const context=z.object({workflowId:dataverseGuid,isManaged:z.literal(false),ownerId:z.literal(plan.target.userId),category:z.literal(5),warning:z.null().optional()}).parse(await flow('get_flow_context',{env:plan.identity.environmentId,flow:created.name}));
 z.object({workflowid:z.literal(context.workflowId),category:z.literal(5),type:z.literal(1),_ownerid_value:z.literal(plan.target.userId)}).parse(await request('GET',`workflows(${context.workflowId})?$select=workflowid,category,type,_ownerid_value`));
 const membership={ComponentId:context.workflowId,ComponentType:29,SolutionUniqueName:plan.solution.uniqueName,AddRequiredComponents:false,DoNotIncludeSubcomponents:true,IncludedComponentSettingsValues:[]};
 await deps.journal('add-membership-intent',{...membership,solutionId});await request('POST','AddSolutionComponent',membership);
 const members=await rows('solutioncomponents?$select=objectid,componenttype&$filter='+encodeURIComponent(`_solutionid_value eq ${solutionId} and (objectid eq ${context.workflowId} or objectid eq ${referenceId})`)+'&$top=3');
 if(members.filter(r=>r.objectid===context.workflowId&&r.componenttype===29).length!==1||members.filter(r=>r.objectid===referenceId).length!==1||members.length!==2)throw Error('Exact same-resource solution membership absent or ambiguous');
 await deps.journal('same-resources-verified',{flowId:created.name,workflowId:context.workflowId,solutionId,publisherId,referenceId,membershipSha256:connectorProbeDigest(members)});
 return{flowId:created.name,workflowId:context.workflowId,solutionId};
}
