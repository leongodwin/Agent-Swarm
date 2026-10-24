import {z} from 'zod';
import {parseUnambiguousJson} from './unambiguousJson.ts';
import {environmentFeatureGuidSchema,environmentFeaturePlanSchema,environmentFeatureDigest,type EnvironmentFeaturePlan,type EnvironmentFeaturePreflight} from './environmentFeatureChange.ts';
import type {Command} from './identityContracts.ts';

const guid=environmentFeatureGuidSchema,row=z.object({organizationid:guid,enableflowsinsolutionbydefault:z.boolean(),'@odata.etag':z.string()}),privilege='prvWriteOrganization';
const requestId=(response:Response)=>{const parsed=guid.safeParse(response.headers.get('x-ms-service-request-id'));return parsed.success?{requestId:parsed.data}:{};};
async function boundedJson(response:Response){
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')||!response.body)throw Error('Native administrative JSON response required');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>65536)throw Error('Administrative metadata exceeds its bound');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return parseUnambiguousJson(new TextDecoder('utf8',{fatal:true}).decode(bytes),{maxBytes:65536});
}
/** Fixed native administrative transport. It never creates flows, resolves
 * connection references, retries writes, follows redirects, or returns tokens,
 * arbitrary response bodies or session headers. It is not an execution route. */
export function createEnvironmentFeatureClient(command:Command,plan:EnvironmentFeaturePlan,signal:AbortSignal,guard:()=>void){
 let bearer:string|undefined,expires=0;const observations:{step:string;status:200;observedAt:string;value:unknown}[]=[];
 const selected=environmentFeaturePlanSchema.parse(plan),selectedSha256=environmentFeatureDigest(selected),target=Object.freeze({...selected.target}),origin=new URL(target.environmentUrl).origin;
 const samePlan=(value:EnvironmentFeaturePlan)=>{if(environmentFeatureDigest(environmentFeaturePlanSchema.parse(value))!==selectedSha256)throw Error('Administrative transport plan differs');};
 const record=(step:string,value:unknown)=>{observations.push({step,status:200,observedAt:new Date().toISOString(),value});};
 const ready=()=>{signal.throwIfAborted();guard();if(!bearer||expires<=Date.now())throw Error('Native administrative authentication unavailable');};
 const get=async(resource:string,admit:()=>Promise<void>)=>{await admit();ready();const response=await fetch(origin+'/api/data/v9.2/'+resource,{method:'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+bearer,Accept:'application/json','OData-Version':'4.0','OData-MaxVersion':'4.0'}});if(response.status!==200){await response.body?.cancel().catch(()=>{});throw Error('Native administrative metadata returned HTTP'+response.status);}const data=await boundedJson(response);ready();return{data,response};};
 const currentRow=async(admit:()=>Promise<void>)=>{const {data,response}=await get(`organizations(${target.organizationId})?$select=organizationid,enableflowsinsolutionbydefault`,admit),value=row.parse(data),header=response.headers.get('etag');if(header!==null&&header!==value['@odata.etag'])throw Error('Administrative row ETags differ');record('organization-setting',value);return{organizationId:value.organizationid,value:value.enableflowsinsolutionbydefault,etag:value['@odata.etag']};};
 return{
  observations:()=>structuredClone(observations),
  async preflight(_plan:EnvironmentFeaturePlan,_signal:AbortSignal,admit:()=>Promise<void>):Promise<EnvironmentFeaturePreflight>{
   samePlan(_plan);if(_signal!==signal)throw Error('Administrative transport signal differs');signal.throwIfAborted();guard();await admit();
   // The existing delegated Azure CLI cache is used silently. No login,
   // consent, profile selection or token persistence is performed here.
   try{
    const output=await command('az',['account','get-access-token','--resource',origin,'--tenant',target.tenantId,'--output','json']),token=z.object({accessToken:z.string().min(1).max(32768)}).parse(parseUnambiguousJson(output,{maxBytes:65536})).accessToken,parts=token.split('.');if(parts.length!==3)throw Error('Token form');
    const claims=z.object({tid:guid,oid:guid,aud:z.string(),exp:z.number().int(),scp:z.string(),upn:z.string().optional(),preferred_username:z.string().optional()}).parse(parseUnambiguousJson(Buffer.from(parts[1],'base64url').toString('utf8'),{maxBytes:32768}));
    if(claims.tid.toLowerCase()!==target.tenantId||claims.oid.toLowerCase()!==target.aadObjectId||(claims.upn??claims.preferred_username??'').toLowerCase()!==target.username.toLowerCase()||new URL(claims.aud).origin!==origin||!claims.scp.split(' ').includes('user_impersonation')||claims.exp*1000<=Date.now()+120000)throw Error('Token binding');
    bearer=token;expires=claims.exp*1000;
   }catch{throw Error('Existing delegated administrative token does not match the selected target/account');}
   ready();
   const who=z.object({OrganizationId:guid,UserId:guid}).parse((await get('WhoAmI',admit)).data);if(who.OrganizationId.toLowerCase()!==target.organizationId||who.UserId.toLowerCase()!==target.userId)throw Error('Native administrative account differs');record('whoami',who);
   const detail=z.object({Detail:z.object({OrganizationId:guid,EnvironmentId:guid,TenantId:guid,State:z.literal('Enabled')})}).parse((await get("RetrieveCurrentOrganization(AccessType=@p1)?@p1=Microsoft.Dynamics.CRM.EndpointAccessType'Default'",admit)).data).Detail;if(detail.OrganizationId.toLowerCase()!==target.organizationId||detail.EnvironmentId.toLowerCase()!==target.environmentId||detail.TenantId.toLowerCase()!==target.tenantId)throw Error('Native administrative environment differs');record('organization-identity',detail);
   const user=z.object({systemuserid:guid,azureactivedirectoryobjectid:guid,domainname:z.string(),isdisabled:z.literal(false),applicationid:z.null()}).parse((await get(`systemusers(${target.userId})?$select=systemuserid,azureactivedirectoryobjectid,domainname,isdisabled,applicationid`,admit)).data);if(user.systemuserid.toLowerCase()!==target.userId||user.azureactivedirectoryobjectid.toLowerCase()!==target.aadObjectId||user.domainname.toLowerCase()!==target.username.toLowerCase())throw Error('Native administrative user differs');record('user-identity',user);
   const table=z.object({LogicalName:z.literal('organization'),IsOptimisticConcurrencyEnabled:z.literal(true)}).parse((await get("EntityDefinitions(LogicalName='organization')?$select=LogicalName,IsOptimisticConcurrencyEnabled",admit)).data);record('concurrency',table);
   const attribute=z.object({LogicalName:z.literal('enableflowsinsolutionbydefault'),IsValidForRead:z.literal(true),IsValidForUpdate:z.literal(true)}).parse((await get("EntityDefinitions(LogicalName='organization')/Attributes(LogicalName='enableflowsinsolutionbydefault')?$select=LogicalName,IsValidForRead,IsValidForUpdate",admit)).data);record('attribute',attribute);
   const privileges=z.object({RolePrivileges:z.array(z.object({PrivilegeName:z.literal(privilege),PrivilegeId:guid,Depth:z.string()})).min(1).max(100)}).parse((await get(`systemusers(${target.userId})/Microsoft.Dynamics.CRM.RetrieveUserPrivilegeByPrivilegeName(PrivilegeName='${privilege}')`,admit)).data);if(!privileges.RolePrivileges.some(value=>value.Depth==='Global'))throw Error('Native global organization-write privilege required');record('organization-write-privilege',privileges);
   const current=await currentRow(admit);return{...target,attributeUpdateable:true,optimisticConcurrency:true,canUpdateOrganization:true,row:current};
  },
  async patch(_plan:EnvironmentFeaturePlan,request:{path:string;body:{enableflowsinsolutionbydefault:false};ifMatch:string}){
   samePlan(_plan);ready();if(request.path!==`/api/data/v9.2/organizations(${target.organizationId})`||Object.keys(request.body).length!==1||request.body.enableflowsinsolutionbydefault!==false||!/^(?:W\/)?"[\x21\x23-\x7E]{1,256}"$/.test(request.ifMatch))throw Error('Fixed conditional administrative update required');
   const response=await fetch(origin+request.path,{method:'PATCH',redirect:'error',signal,headers:{Authorization:'Bearer '+bearer,Accept:'application/json','Content-Type':'application/json','OData-Version':'4.0','OData-MaxVersion':'4.0','If-Match':request.ifMatch},body:'{"enableflowsinsolutionbydefault":false}'});
   // Return the actual acknowledgement even after an in-flight guard change;
   // the engine retains it before admitting any subsequent work.
   const result={status:response.status,...requestId(response)};await response.body?.cancel().catch(()=>{});return result;
  },
  async read(){return currentRow(async()=>{});},
 };
}
