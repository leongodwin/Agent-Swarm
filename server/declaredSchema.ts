import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {deliveryManifest,deliveryCommands,type DeliveryDependencies} from './delivery.ts';
import {platformIdentitySchema} from './platformAuth.ts';
import {currentOrganizationResource,verifyDataverseIdentity} from './dataverseIdentity.ts';
import {verifyMigrationCompatibility} from './deploymentAdapters.ts';
import {baseAttribute,verifyColumns} from './columnContracts.ts';
import {governancePhase,manifestDigest,type LifecycleRequest} from './lifecycleGovernance.ts';
import {targetBindingSchema,type Request} from './targetOperations.ts';
import {verifyTableStructure} from './tableStructure.ts';
import {verifyResourceSchemaReferences} from './resourceSchema.ts';
import type {SchemaDiagnostic} from '../shared/healthEvidence.ts';

const schemaDiagnostic=z.strictObject({
  stage:z.enum(['contract','initial-identity','resource-contracts','migration','columns','structure','final-identity','evidence','complete']),
  failure:z.enum(['none','validation','provider','cancelled','limit']),
  elapsedMs:z.number().int().nonnegative(),nativeCommands:z.number().int().nonnegative(),metadataReads:z.number().int().nonnegative(),responseBytes:z.number().int().nonnegative(),
});
const remediation:Record<SchemaDiagnostic['stage'],string>={
  contract:'Provide valid, unambiguous table/column contracts and the approved target identity.',
  'initial-identity':'Verify the Dataverse profile and native organization/user match the approved target.',
  'resource-contracts':'Resolve package table references and include every explicit referenced column in the approved contracts.',
  migration:'Review incompatible declared columns, relationships or keys and provide a reviewed migration where required.',
  columns:'Compare fresh target column metadata with the approved types, requiredness and constraints.',
  structure:'Compare fresh target relationship and alternate-key metadata with the approved structure contracts.',
  'final-identity':'Recheck the Dataverse profile and native organization/user; identity changed or could not be verified after metadata reads.',
  evidence:'Check that the scoped observation meets the evidence contract.',
  complete:'Declared checks completed; comprehensive schema and effective-security verification remain required.',
};
export const declaredSchemaObservation=z.strictObject({
  scope:z.literal('declared-target-schema'),complete:z.literal(false),status:z.enum(['observed','unavailable']),
  phase:governancePhase,sourceCommit:z.string(),releaseId:z.string(),environmentUrl:z.url(),
  manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),identity:platformIdentitySchema.optional(),binding:targetBindingSchema.optional(),
  checkedAt:z.iso.datetime(),reason:z.string().min(1).max(1000),
  tables:z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).max(100),
  observations:z.array(z.strictObject({resource:z.string().max(4000),value:z.unknown()})).max(300),
  diagnostic:schemaDiagnostic.optional(),
}).superRefine((value,ctx)=>{
  if(value.status==='observed'&&(!value.identity||!value.binding||!value.observations.length))ctx.addIssue({code:'custom',message:'Observed declared schema requires identity-bound metadata evidence'});
  if(value.status==='unavailable'&&(value.identity||value.binding||value.tables.length||value.observations.length))ctx.addIssue({code:'custom',message:'Unavailable schema cannot retain partial metadata or verified identity'});
  if(value.diagnostic&&((value.status==='observed')!==(value.diagnostic.stage==='complete'&&value.diagnostic.failure==='none')||(value.status==='unavailable'&&(value.diagnostic.failure==='none'||value.diagnostic.stage==='complete'))))ctx.addIssue({code:'custom',message:'Schema diagnostic differs from the observation status'});
});
export type DeclaredSchemaObservation=z.infer<typeof declaredSchemaObservation>;
export type DeclaredSchemaObserver=(request:LifecycleRequest)=>Promise<DeclaredSchemaObservation>;

/** Fresh metadata only. Passing declared columns never proves complete schema governance. */
export function createDeclaredSchemaObserver(commands:Pick<DeliveryDependencies,'run'>=deliveryCommands):DeclaredSchemaObserver {
  return async input=>{
    const started=performance.now();let stage:SchemaDiagnostic['stage']='contract',failure:SchemaDiagnostic['failure']='validation',nativeCommands=0,metadataReads=0,bytes=0;
    const diagnostic=():SchemaDiagnostic=>({stage,failure,elapsedMs:Math.max(0,Math.round(performance.now()-started)),nativeCommands,metadataReads,responseBytes:bytes});
    const base={scope:'declared-target-schema' as const,complete:false as const,phase:input.phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest)};
    const unavailable=(reason:string):DeclaredSchemaObservation=>({...base,status:'unavailable',checkedAt:new Date().toISOString(),reason:`Declared schema check failed at ${stage} (${failure}). ${reason}`,tables:[],observations:[],diagnostic:diagnostic()});
    try{
      const manifest=deliveryManifest.parse(input.manifest),identity=manifest.platformIdentity,binding=manifest.targetBinding;
      const url=new URL(input.environmentUrl);
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^[-a-z0-9]+\.crm\d*\.dynamics\.com$/.test(url.hostname))return unavailable('Schema discovery requires an approved public-cloud Dataverse environment URL');
      if(!identity||!binding)return unavailable('Schema discovery requires the approved platform identity and organization/user binding');
      const tables=manifest.targetComponents.filter(component=>component.kind==='dataverse-table').map(table=>({...table,logicalName:table.logicalName.toLowerCase()}));
      if(!tables.length)return unavailable('No declared Dataverse table contracts are available; resource-derived schema coverage remains unverified');
      if(tables.some(table=>!/^[_a-z][_a-z0-9]*$/.test(table.logicalName)))return unavailable('Schema contracts require valid Dataverse table logical names');
      const actions=manifest.postDeployActions.filter(action=>action.type==='schema-check');
      if(tables.length>100||new Set(tables.map(table=>table.logicalName.toLowerCase())).size!==tables.length||tables.some(table=>actions.filter(action=>action.component===table.key).length!==1))return unavailable('Every declared Dataverse table requires exactly one unambiguous approved column contract');
      const signal=input.signal??new AbortController().signal;
      const command=async(executable:string,args:string[])=>{
        signal.throwIfAborted();nativeCommands++;let output:string;
        try{output=await commands.run({executable,args},input.checkout,{},signal);}catch{failure='provider';throw new Error('Schema provider command failed');}
        signal.throwIfAborted();return output;
      };
      const observations:DeclaredSchemaObservation['observations']=[];
      const request:Request=async(method,resource)=>{
        if(method!=='GET'||!(resource==='WhoAmI'||resource===currentOrganizationResource||resource.startsWith('EntityDefinitions')))throw new Error('Schema observer accepts metadata and fixed identity reads only');
        if(resource.length>4000){failure='limit';throw new Error('Schema request exceeded its bound');}
        const output=await command('dataverse',['api','request','--target','dataverse','--environment',url.origin,'--method','GET','--path',`/api/data/v9.2/${resource}`]);
        bytes+=Buffer.byteLength(output);if(bytes>8*1024*1024){failure='limit';throw new Error('Schema observation exceeded its byte bound');}
        let value:unknown;try{value=parseUnambiguousJson(output,{maxBytes:8*1024*1024});}catch{failure='provider';throw new Error('Schema provider response is malformed or ambiguous');}
        if(resource!=='WhoAmI'&&resource!==currentOrganizationResource)observations.push({resource,value});
        if(resource!=='WhoAmI'&&resource!==currentOrganizationResource)metadataReads++;
        if(observations.length>300){failure='limit';throw new Error('Schema observation exceeded its bound');}
        return value;
      };
      stage='initial-identity';
      await verifyDataverseIdentity(command,request,url.origin,binding,identity);
      stage='resource-contracts';
      await verifyResourceSchemaReferences(input.resourceSchemaReferences??[],tables,actions,request);
      if(['build','test','import'].includes(input.phase)){stage='migration';await verifyMigrationCompatibility(actions,tables,request);}
      else for(const table of tables){
        stage='columns';
        const action=actions.find(action=>action.component===table.key)!;
        const observed=z.object({value:z.array(baseAttribute).max(4999),'@odata.nextLink':z.never().optional()}).parse(await request('GET',`EntityDefinitions(LogicalName='${table.logicalName}')/Attributes?$select=LogicalName,MetadataId,AttributeType,AttributeTypeName,RequiredLevel`));
        await verifyColumns(action.columns,table.logicalName,observed.value,request);
        if(action.structure){stage='structure';await verifyTableStructure(action.structure,table.logicalName,request);}
      }
      stage='final-identity';
      await verifyDataverseIdentity(command,request,url.origin,binding,identity);
      signal.throwIfAborted();
      stage='evidence';
      const observedDiagnostic={...diagnostic(),stage:'complete' as const,failure:'none' as const};
      return declaredSchemaObservation.parse({...base,status:'observed',checkedAt:new Date().toISOString(),identity,binding,tables:tables.map(table=>table.logicalName),observations,
        diagnostic:observedDiagnostic,
        reason:['build','test','import'].includes(input.phase)?'Declared target migration compatibility passed identity-bound checks; final columns and comprehensive schema remain unverified':'Declared target columns and any declared structure contracts passed identity-bound checks; complete source/package schemas, undeclared relationships/keys and effective security remain unverified'});
    }catch{
      const observedFailure=input.signal?.aborted?'cancelled':diagnostic().failure;failure=observedFailure;
      const next=observedFailure==='provider'?'Restore the supported Dataverse CLI connection and retry this read-only check.':observedFailure==='cancelled'?'The check was cancelled; retry after the owning lifecycle permits new work.':observedFailure==='limit'?'Reduce the scoped observation or use a separately reviewed bounded adapter.':remediation[stage];
      return unavailable(`${next} No schema compliance is certified.`);
    }
  };
}
