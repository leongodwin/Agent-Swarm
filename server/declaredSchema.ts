import {z} from 'zod';
import {deliveryManifest,deliveryCommands,type DeliveryDependencies} from './delivery.ts';
import {verifyPlatformAuthentication,platformIdentitySchema} from './platformAuth.ts';
import {verifyMigrationCompatibility} from './deploymentAdapters.ts';
import {baseAttribute,verifyColumns} from './columnContracts.ts';
import {governancePhase,manifestDigest,type LifecycleRequest} from './lifecycleGovernance.ts';
import {targetBindingSchema,type Request} from './targetOperations.ts';
import {verifyTableStructure} from './tableStructure.ts';

export const declaredSchemaObservation=z.strictObject({
  scope:z.literal('declared-target-schema'),complete:z.literal(false),status:z.enum(['observed','unavailable']),
  phase:governancePhase,sourceCommit:z.string(),releaseId:z.string(),environmentUrl:z.url(),
  manifestSha256:z.string().regex(/^[a-f0-9]{64}$/),identity:platformIdentitySchema.optional(),binding:targetBindingSchema.optional(),
  checkedAt:z.iso.datetime(),reason:z.string().min(1).max(1000),
  tables:z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).max(100),
  observations:z.array(z.strictObject({resource:z.string().max(4000),value:z.unknown()})).max(300),
}).superRefine((value,ctx)=>{if(value.status==='observed'&&(!value.identity||!value.binding||!value.observations.length))ctx.addIssue({code:'custom',message:'Observed declared schema requires identity-bound metadata evidence'});});
export type DeclaredSchemaObservation=z.infer<typeof declaredSchemaObservation>;
export type DeclaredSchemaObserver=(request:LifecycleRequest)=>Promise<DeclaredSchemaObservation>;

/** Fresh metadata only. Passing declared columns never proves complete schema governance. */
export function createDeclaredSchemaObserver(commands:Pick<DeliveryDependencies,'run'>=deliveryCommands):DeclaredSchemaObserver {
  return async input=>{
    const base={scope:'declared-target-schema' as const,complete:false as const,phase:input.phase,sourceCommit:input.sourceCommit,releaseId:input.releaseId,environmentUrl:input.environmentUrl,manifestSha256:manifestDigest(input.manifest)};
    const unavailable=(reason:string):DeclaredSchemaObservation=>({...base,status:'unavailable',checkedAt:new Date().toISOString(),reason,tables:[],observations:[]});
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
        signal.throwIfAborted();const output=await commands.run({executable,args},input.checkout,{},signal);signal.throwIfAborted();return output;
      };
      const observations:DeclaredSchemaObservation['observations']=[];
      let bytes=0;
      const request:Request=async(method,resource)=>{
        if(method!=='GET'||!(resource==='WhoAmI'||resource.startsWith('EntityDefinitions')))throw new Error('Schema observer accepts metadata reads only');
        const output=await command('dataverse',['api','request','--target','dataverse','--environment',url.origin,'--method','GET','--path',`/api/data/v9.2/${resource}`]);
        bytes+=Buffer.byteLength(output);if(bytes>8*1024*1024)throw new Error('Schema observation exceeded its byte bound');
        const value:unknown=JSON.parse(output);
        if(resource!=='WhoAmI')observations.push({resource,value});
        if(observations.length>300)throw new Error('Schema observation exceeded its bound');
        return value;
      };
      await verifyPlatformAuthentication(command,request,url.origin,binding,identity);
      if(['build','test','import'].includes(input.phase))await verifyMigrationCompatibility(actions,tables,request);
      else for(const table of tables){
        const action=actions.find(action=>action.component===table.key)!;
        const observed=z.object({value:z.array(baseAttribute).max(4999),'@odata.nextLink':z.never().optional()}).parse(await request('GET',`EntityDefinitions(LogicalName='${table.logicalName}')/Attributes?$select=LogicalName,MetadataId,AttributeType,AttributeTypeName,RequiredLevel`));
        await verifyColumns(action.columns,table.logicalName,observed.value,request);
        if(action.structure)await verifyTableStructure(action.structure,table.logicalName,request);
      }
      await verifyPlatformAuthentication(command,request,url.origin,binding,identity);
      signal.throwIfAborted();
      return declaredSchemaObservation.parse({...base,status:'observed',checkedAt:new Date().toISOString(),identity,binding,tables:tables.map(table=>table.logicalName),observations,
        reason:['build','test','import'].includes(input.phase)?'Declared target migration compatibility passed identity-bound checks; final columns and comprehensive schema remain unverified':'Declared target columns and any declared structure contracts passed identity-bound checks; complete source/package schemas, undeclared relationships/keys and effective security remain unverified'});
    }catch{return unavailable('Declared schema discovery or contract validation failed; no schema compliance is certified');}
  };
}
