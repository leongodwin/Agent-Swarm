import { deliveryManifest,containedFile } from './delivery.ts';
import { unavailableGovernance,type LifecycleCheck } from './lifecycleGovernance.ts';
import { evaluateStandardPolicies } from './standardPolicy.ts';
import { inspectSolutionPackage } from './packageInventory.ts';
import { atomicWrite } from './atomicFile.ts';
import path from 'node:path';

/** Declaration-level standard checks may deny, but cannot authorize a release.
 * A full provider must also independently extract package resources and evaluate
 * advanced/action/endpoint policies and comprehensive source/target schemas. */
export function createDeliveryGovernance(source:{observation(identity:{tenantId:string;caller:string}):unknown;ensureObservation?(identity:{tenantId:string;caller:string},options:{signal?:AbortSignal;force:boolean;timeoutMs:number}):Promise<unknown>}):LifecycleCheck {
  return async request=>{
    const manifest=deliveryManifest.parse(request.manifest);
    let packageInventoryFile:string|undefined;
    let resources:{id:string;complete:true;connectors:string[]}[]|undefined;
    let packageIssues:string[]=[];
    if(request.packageSha256) {
      const inventory=await inspectSolutionPackage(await containedFile(request.checkout,manifest.solutionZip),request.signal);
      if(request.evidenceDirectory){packageInventoryFile=`package-inventory-${inventory.packageSha256||request.packageSha256}.json`;await atomicWrite(path.join(request.evidenceDirectory,packageInventoryFile),JSON.stringify(inventory,null,2));}
      const base={...unavailableGovernance(request),artifactSha256:inventory.packageSha256||request.packageSha256,packageInventoryFile};
      if(!inventory.archiveComplete||inventory.packageSha256!==request.packageSha256)return {...base,reasons:['Package integrity or the independently bound package digest could not be verified']};
      if(inventory.solution?.name!==manifest.solutionUniqueName||inventory.solution.version!==manifest.solutionVersion)return {...base,status:'blocked',reasons:['Actual package solution identity/version differs from the approved manifest']};
      for(const component of inventory.components.filter(component=>[1,29,300].includes(component.type))) {
        const found=manifest.targetComponents.some(declared=>component.type===1?declared.kind==='dataverse-table'&&declared.logicalName.toLowerCase()===component.name?.toLowerCase():component.type===29?declared.kind==='cloud-flow'&&declared.logicalName.toLowerCase()===component.id:declared.kind==='canvas'&&declared.logicalName.toLowerCase()===component.name?.toLowerCase());
        if(!found)return {...base,status:'blocked',reasons:[`Package root component type ${component.type} lacks its exact approved component declaration`]};
      }
      resources=inventory.resources.filter(resource=>resource.complete).map(resource=>({id:resource.id,complete:true,connectors:resource.connectors}));
      if(!inventory.resourceInventoryComplete)packageIssues=inventory.issues.slice(0,15).map(issue=>issue.slice(0,1000));
      if(!resources.length)return {...base,reasons:['No fully inspectable app/flow resource connector inventory is available',...packageIssues]};
      for(const reference of inventory.connections)if(!manifest.postDeployActions.some(action=>action.type==='connection-reference-check'&&manifest.targetComponents.some(component=>component.key===action.component&&component.logicalName.toLowerCase()===reference.name)&&action.connectorId.replace(/^\/providers\/Microsoft.PowerApps\/apis\//i,'').toLowerCase()===reference.connector))return {...base,status:'blocked',reasons:[`Package connection reference ${reference.name} lacks its exact approved connector/binding declaration`]};
    }
    const unavailable=(reasons:string[])=>({...unavailableGovernance(request,reasons),artifactSha256:request.packageSha256,packageInventoryFile});
    if(!manifest.platformIdentity)return unavailable(['The release lacks a pinned platform identity for tenant policy and schema governance']);
    const identity={tenantId:manifest.platformIdentity.tenantId,caller:manifest.platformIdentity.username};
    let snapshot:unknown;
    try{snapshot=source.ensureObservation?await source.ensureObservation(identity,{signal:request.signal,force:true,timeoutMs:45_000}):await source.observation(identity);}
    catch{return unavailable(['Refresh the authenticated policy inventory for the exact approved tenant and account before governed delivery']);}
    const declared=manifest.postDeployActions.filter(action=>action.type==='connection-reference-check').map(action=>({id:`reference:${action.component}`,complete:true,connectors:[action.connectorId]}));
    if(!(resources??declared).length)return unavailable(['No independently complete app/flow connector inventory is available; advanced policy and comprehensive schema evidence are also required']);
    const standard=evaluateStandardPolicies(snapshot,identity,manifest.platformIdentity.environmentId,resources??declared);
    const reasons=standard.status==='clear'?[resources?'Inspectable package resources passed standard classification; advanced policies, remaining opaque resources and comprehensive schemas are unverified':'Declared reference IDs passed standard classification; full package resource inventory, advanced policies and comprehensive schemas remain unverified']:standard.reasons.slice(0,20).map(reason=>reason.slice(0,1000));
    return {...unavailableGovernance(request,[...reasons,...packageIssues].slice(0,30)),status:standard.status==='blocked'?'blocked':'unavailable',policySha256:standard.policySha256,artifactSha256:request.packageSha256,packageInventoryFile};
  };
}
