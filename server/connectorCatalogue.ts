import {z} from 'zod';
import crypto from 'node:crypto';
import {deliveryCommands,type DeliveryDependencies} from './delivery.ts';
import {platformIdentitySchema} from './identityContracts.ts';

const connector=z.string().regex(/^shared_[a-z0-9_]{1,180}$/),environment=platformIdentitySchema.shape.environmentId;
const identity=z.strictObject({tenantId:z.uuid(),caller:z.email(),environmentId:environment});
const requestSchema=identity.extend({connectors:z.array(connector).min(1).max(10)}).superRefine((value,ctx)=>{if(new Set(value.connectors).size!==value.connectors.length)ctx.addIssue({code:'custom',message:'Requested connector IDs must be unique'});});
const entry=z.strictObject({id:z.string().regex(/^\/providers\/Microsoft\.PowerApps\/apis\/shared_[a-z0-9_]+$/i),name:connector,type:z.string().regex(/^Microsoft\.PowerApps\/apis$/i),isCustomApi:z.boolean(),capabilities:z.array(z.string().min(1).max(200)).max(100)});
const response=z.object({id:entry.shape.id,name:connector,type:entry.shape.type,properties:z.object({isCustomApi:z.boolean(),capabilities:entry.shape.capabilities}),nextLink:z.never().optional(),'@odata.nextLink':z.never().optional()});
export const connectorCatalogueObservation=identity.extend({scope:z.literal('requested-connector-catalogue'),accountScope:z.literal('azure-cli-profile'),complete:z.literal(false),complianceVerified:z.literal(false),operationIdsVerified:z.literal(false),status:z.enum(['observed','unavailable']),checkedAt:z.iso.datetime(),requested:z.array(connector).min(1).max(10),entries:z.array(entry).max(10),observationSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),failure:z.enum(['none','identity','metadata','provider','delegated-permissions','limit','cancelled']),elapsedMs:z.number().int().nonnegative(),nativeCommands:z.number().int().nonnegative(),reason:z.string().min(1).max(1000)}).superRefine((value,ctx)=>{
  const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
  if(new Set(value.requested).size!==value.requested.length)invalid('Requested connectors are ambiguous');
  if(value.status==='unavailable'){if(value.entries.length||value.observationSha256||value.failure==='none')invalid('Unavailable catalogue cannot retain successful facts');return;}
  if(value.failure!=='none'||value.entries.length!==value.requested.length||new Set(value.entries.map(row=>row.name)).size!==value.entries.length||value.entries.some(row=>!value.requested.includes(row.name)||row.id.toLowerCase()!==`/providers/microsoft.powerapps/apis/${row.name}`))invalid('Observed catalogue must match every requested exact connector identity');
  if(value.observationSha256!==crypto.createHash('sha256').update(JSON.stringify(value.entries)).digest('hex'))invalid('Observed catalogue facts differ from their digest');
});
export type ConnectorCatalogueObservation=z.infer<typeof connectorCatalogueObservation>;
export interface ConnectorCatalogueRequest {tenantId:string;caller:string;environmentId:string;connectors:string[];checkout:string;signal?:AbortSignal}
export type ConnectorCatalogueObserver=(request:ConnectorCatalogueRequest)=>Promise<ConnectorCatalogueObservation>;

/** Fixed metadata GETs only. A catalogue response is not an operation inventory or effective policy authorization. */
export function createConnectorCatalogueObserver(commands:Pick<DeliveryDependencies,'run'>=deliveryCommands):ConnectorCatalogueObserver{
  return async input=>{
    const requested=requestSchema.parse({tenantId:input.tenantId,caller:input.caller,environmentId:input.environmentId,connectors:input.connectors}),started=performance.now(),signal=input.signal??new AbortController().signal;
    const base={tenantId:requested.tenantId,caller:requested.caller,environmentId:requested.environmentId,scope:'requested-connector-catalogue' as const,accountScope:'azure-cli-profile' as const,complete:false as const,complianceVerified:false as const,operationIdsVerified:false as const,requested:requested.connectors.slice().sort()};
    let bytes=0,nativeCommands=0;const fault:{value:ConnectorCatalogueObservation['failure']}={value:'identity'};
    const command=async(args:string[])=>{
      signal.throwIfAborted();nativeCommands++;let text:string;
      try{text=await commands.run({executable:'az',args},input.checkout,{},signal);}catch(error){fault.value=args[0]==='rest'&&error instanceof Error&&/\bInsufficientDelegatedPermissions\b/.test(error.message)?'delegated-permissions':'provider';throw new Error('Catalogue provider failed');}
      signal.throwIfAborted();bytes+=Buffer.byteLength(text);if(Buffer.byteLength(text)>2*1024*1024||bytes>8*1024*1024){fault.value='limit';throw new Error('Catalogue response bound exceeded');}
      try{return JSON.parse(text);}catch{fault.value='provider';throw new Error('Catalogue provider response is malformed');}
    };
    const account=async()=>{fault.value='identity';const profile=z.object({tenantId:z.uuid(),user:z.object({name:z.email(),type:z.literal('user')})}).parse(await command(['account','show','--output','json','--only-show-errors']));if(profile.tenantId.toLowerCase()!==requested.tenantId.toLowerCase()||profile.user.name.toLowerCase()!==requested.caller.toLowerCase())throw new Error('Catalogue account differs');};
    const pass=async()=>{
      fault.value='metadata';const rows=[];
      for(const name of base.requested){
        const url=`https://api.powerplatform.com/connectivity/environments/${requested.environmentId}/connectors/${name}?$filter=${encodeURIComponent(`environment eq '${requested.environmentId}'`)}&api-version=2024-10-01`;
        const value=response.parse(await command(['rest','--method','get','--url',url,'--resource','https://api.powerplatform.com','--output','json','--only-show-errors']));
        if(value.name!==name||value.id.toLowerCase()!==`/providers/microsoft.powerapps/apis/${name}`)throw new Error('Catalogue connector identity differs');
        rows.push(entry.parse({id:value.id,name:value.name,type:value.type,isCustomApi:value.properties.isCustomApi,capabilities:value.properties.capabilities}));
      }
      return rows;
    };
    try{
      await account();const before=await pass(),after=await pass();await account();signal.throwIfAborted();fault.value='metadata';
      if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Catalogue facts changed');
      return connectorCatalogueObservation.parse({...base,status:'observed',checkedAt:new Date().toISOString(),entries:after,observationSha256:crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex'),failure:'none',elapsedMs:Math.round(performance.now()-started),nativeCommands,reason:'Repeated requested connector metadata reads agree with the observed Azure CLI profile; operation IDs, certification, effective policies and comprehensive schema/security remain unverified'});
    }catch{
      if(signal.aborted)fault.value='cancelled';
      const reason=fault.value==='delegated-permissions'?'The supported catalogue API denied this client. Microsoft reported missing Connectivity.Connectors.Read / PowerApps.Apps.Manage delegated permissions. An administrator must choose a supported, least-privilege approved client; this reader grants no permissions.':fault.value==='cancelled'?'Catalogue observation was cancelled; no metadata is certified.':'Requested connector metadata or Azure CLI identity could not be verified; no catalogue or policy compliance is certified.';
      return connectorCatalogueObservation.parse({...base,status:'unavailable',checkedAt:new Date().toISOString(),entries:[],failure:fault.value,elapsedMs:Math.round(performance.now()-started),nativeCommands,reason});
    }
  };
}
