import {z} from 'zod';
import type {FlowAdapter} from './flowAdapter.ts';
import {verifyPlatformAuthentication,type Command} from './platformAuth.ts';
import {dataverseGuid,type Request} from './targetOperations.ts';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {buildStandaloneMetadataProbe,assertOriginalQuarantinedDefinition,type StandaloneProbePlan} from './standaloneMetadataProbe.ts';
import {assertStandaloneFlowOwnership} from './standaloneFlowOwnership.ts';
import type {verifyStandaloneQuarantine} from './standaloneProbeQuarantine.ts';
type Dependencies={command:Command;flow:FlowAdapter;admit():Promise<void>;journal(stage:string,metadata:Record<string,unknown>):Promise<void>;guard():void};
function readers(plan:StandaloneProbePlan,deps:Dependencies){
 const command:Command=async(executable,args)=>{await deps.admit();deps.guard();const result=await deps.command(executable,args);deps.guard();return result;};
 const request:Request=async(method,route,body)=>{if(method!=='GET'||body!==undefined)throw Error('Standalone management is read-only; creation uses the fixed native flow tool');const result=await command('dataverse',['api','request','--target','dataverse','--path','/api/data/v9.2/'+route,'--method','GET','--environment',plan.target.environmentUrl]);return parseUnambiguousJson(result,{maxBytes:256000});};
 const flow=async(tool:string,args:Record<string,unknown>)=>{await deps.admit();deps.guard();const result=await deps.flow.call(tool,args);deps.guard();return result;};
 return {command,request,flow};
}
/** Current ownership and absence of a named solution, never inferred from creator.
 * A classic flow may have no Dataverse workflow row. Active/Default are platform
 * layers, not a newly provisioned application solution. */
export async function inspectStandaloneProbeResource(plan:StandaloneProbePlan,flowId:string,deps:Dependencies){
 if([plan.quarantine.flowId,plan.quarantine.solutionId,plan.quarantine.publisherId,plan.quarantine.referenceId].some(id=>id.toLowerCase()===flowId.toLowerCase()))throw Error('Replacement overlaps original quarantine');
 const {flow,request}=readers(plan,deps),args={env:plan.identity.environmentId,flow:dataverseGuid.parse(flowId)};
 const ownership=assertStandaloneFlowOwnership(plan,flowId,await flow('read_standalone_flow_owners',args));
 const context=z.object({flowId:z.literal(flowId),displayName:z.literal(plan.flow.name),workflowId:dataverseGuid.nullable(),inSolution:z.boolean(),isManaged:z.literal(false),workflowIsManaged:z.literal(false),isCustomizable:z.literal(true),connectionReferenceLogicalNames:z.array(z.string()).length(0),category:z.number().nullable(),ownerId:dataverseGuid.nullable(),warning:z.string().nullable()}).parse(await flow('get_flow_context',args));
 if(context.workflowId&&[plan.quarantine.flowId,plan.quarantine.solutionId,plan.quarantine.publisherId,plan.quarantine.referenceId].some(id=>id.toLowerCase()===context.workflowId!.toLowerCase()))throw Error('Replacement workflow alias overlaps original quarantine');
 if(context.warning==='workflow-not-found'&&context.workflowId===null&&!context.inSolution)return {flowId,ownership,nativeContext:context,context:'classic-non-solution' as const};
 if(context.warning!==null||!context.workflowId)throw Error('Standalone context is unresolved');
 z.object({category:z.literal(5),ownerId:z.literal(plan.target.userId)}).parse(context);
 const rows=z.object({value:z.array(z.object({objectid:z.literal(context.workflowId),componenttype:z.literal(29),_solutionid_value:dataverseGuid})).max(2),'@odata.nextLink':z.never().optional()}).parse(await request('GET','solutioncomponents?$select=objectid,componenttype,_solutionid_value&$filter='+encodeURIComponent(`objectid eq ${context.workflowId} and componenttype eq 29`)+'&$top=3')).value;
 const platformLayers=[];for(const row of rows){platformLayers.push(z.object({solutionid:z.literal(row._solutionid_value),uniquename:z.enum(['Active','Default']),ismanaged:z.literal(false)}).parse(await request('GET',`solutions(${row._solutionid_value})?$select=solutionid,uniquename,ismanaged`)));}
 return {flowId,workflowId:context.workflowId,ownership,nativeContext:context,platformLayers,context:'platform-layer-only' as const};
}
/** Only one new stopped flow may be created. No publisher, solution, reference,
 * adoption, connection mutation or original-resource lifecycle call exists. */
export async function prepareStandaloneProbeResources(plan:StandaloneProbePlan,deps:Dependencies,quarantine:Awaited<ReturnType<typeof verifyStandaloneQuarantine>>){
 const {command,request,flow}=readers(plan,deps);
 await verifyPlatformAuthentication(command,request,plan.target.environmentUrl,{organizationId:plan.target.organizationId,userId:plan.target.userId},plan.identity,()=>flow('whoami',{}));
 z.object({systemuserid:z.literal(plan.target.userId),azureactivedirectoryobjectid:z.literal(plan.ownerObjectId),isdisabled:z.literal(false),applicationid:z.null()}).parse(await request('GET',`systemusers(${plan.target.userId})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled,applicationid`));
 const old={env:plan.identity.environmentId,flow:plan.quarantine.flowId};
 assertStandaloneFlowOwnership(plan,old.flow,await flow('read_standalone_flow_owners',old));
 if(await flow('get_flow',{...old,path:'properties.state'})!=='Stopped')throw Error('Original quarantined flow is not stopped');
 z.array(z.unknown()).length(0).parse(await flow('get_run_history',{...old,top:100}));
 const originalDefinition=z.record(z.string(),z.unknown()).parse(await flow('get_flow',{...old,path:'properties.definition'}));assertOriginalQuarantinedDefinition(plan,quarantine.originalProbeId,originalDefinition);
 const inventory=z.array(z.object({name:dataverseGuid,displayName:z.string().min(1)})).max(49).parse(await flow('list_flows',{env:plan.identity.environmentId,top:50}));
 if(inventory.some(item=>item.displayName.toLowerCase()===plan.flow.name.toLowerCase()))throw Error('Standalone flow name already exists; no adoption or duplicate override');
 const built=buildStandaloneMetadataProbe(plan);
 z.object({overall:z.literal('ready')}).parse(await flow('preflight_flow',{env:plan.identity.environmentId,definition:built.definition,connectionReferences:built.connectionRefs}));
 await deps.journal('create-standalone-flow-intent',{name:plan.flow.name,definitionSha256:built.definitionSha256,connectionRefsSha256:built.connectionRefsSha256,oldFlowId:old.flow,originalHoldPreserved:true,state:'Stopped',allowDuplicate:false});
 const created=z.object({name:dataverseGuid,displayName:z.literal(plan.flow.name),state:z.literal('Stopped')}).parse(await flow('create_standalone_flow',{env:plan.identity.environmentId,name:plan.flow.name,definition:built.definition,connectionRefs:built.connectionRefs,state:'Stopped',allowDuplicate:false}));
 await deps.journal('created-standalone-flow',{flowId:created.name,oldFlowId:old.flow,originalHoldPreserved:true});
 const observed=await inspectStandaloneProbeResource(plan,created.name,deps);
 if(await flow('get_flow',{env:plan.identity.environmentId,flow:created.name,path:'properties.state'})!=='Stopped')throw Error('Replacement stopped-state readback differs');
 await deps.journal('standalone-resources-verified',observed);
 return {flowId:created.name,...('workflowId'in observed?{workflowId:observed.workflowId}:{})};
}

