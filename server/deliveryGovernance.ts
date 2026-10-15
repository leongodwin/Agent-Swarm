import { deliveryManifest,containedFile } from './delivery.ts';
import { unavailableGovernance,type LifecycleCheck,type LifecycleRequest } from './lifecycleGovernance.ts';
import {manifestDigest} from './lifecycleGovernance.ts';
import { evaluateStandardPolicies } from './standardPolicy.ts';
import { inspectSolutionPackage } from './packageInventory.ts';
import { atomicWrite } from './atomicFile.ts';
import path from 'node:path';
import crypto from 'node:crypto';
import {declaredSchemaObservation,type DeclaredSchemaObserver} from './declaredSchema.ts';
import {comparePackageSchema} from './packageSchema.ts';
import {advancedPolicyObservation,type AdvancedPolicyObserver} from './advancedPolicy.ts';
import {compareAdvancedConnectorConstraints} from './advancedConstraints.ts';
import type {PackageResource} from './packageInventory.ts';
import {connectorCatalogueObservation,type ConnectorCatalogueObserver} from './connectorCatalogue.ts';
import type {ManualGovernance} from './manualGovernance.ts';
import type {PackageInventory} from './packageInventory.ts';
import fs from 'node:fs/promises';

/** Declaration-level standard checks may deny, but cannot authorize a release.
 * A full provider must also independently extract package resources and evaluate
 * advanced/action/endpoint policies and comprehensive source/target schemas. */
export function createDeliveryGovernance(source:{observation(identity:{tenantId:string;caller:string}):unknown;ensureObservation?(identity:{tenantId:string;caller:string},options:{signal?:AbortSignal;force:boolean;timeoutMs:number}):Promise<unknown>},observeSchema?:DeclaredSchemaObserver,observeAdvanced?:AdvancedPolicyObserver,observeCatalogue?:ConnectorCatalogueObserver,manual?:Pick<ManualGovernance,'observe'>):LifecycleCheck {
  return async request=>{
    const manifest=deliveryManifest.parse(request.manifest);
    let packageInventoryFile:string|undefined;
    let packageInventorySha256:string|undefined;
    let resources:{id:string;complete:boolean;connectors:string[]}[]|undefined;
    let packageIssues:string[]=[];
    let resourceSchemaReferences:LifecycleRequest['resourceSchemaReferences'];
    let advancedResources:PackageResource[]|undefined;
    let inventory:PackageInventory|undefined,manualTables=false;
    if(request.packageSha256) {
      inventory=await inspectSolutionPackage(await containedFile(request.checkout,manifest.solutionZip),request.signal);
      // This route admits only independently inspected references to existing
      // tables, with no metadata payload, roles or executable subcomponents.
      manualTables=!!manual&&manifest.manualDevelopmentGovernance===true&&request.acceptanceProfile==='functional-development'&&inventory.tables.length>0&&inventory.tables.every(table=>table.referenceOnly)&&inventory.components.every(component=>component.type===1&&component.behavior==='2')&&!inventory.relationships.length&&!inventory.resources.length&&!inventory.connections.length&&inventory.files.every(file=>file.path.toLowerCase().endsWith('.xml'))&&!inventory.issues.length;
      if(request.evidenceDirectory){const content=JSON.stringify(inventory,null,2);packageInventoryFile=`package-inventory-${inventory.packageSha256||request.packageSha256}.json`;await atomicWrite(path.join(request.evidenceDirectory,packageInventoryFile),content);packageInventorySha256=crypto.createHash('sha256').update(content).digest('hex');}
      const base={...unavailableGovernance(request),artifactSha256:inventory.packageSha256||request.packageSha256,packageInventoryFile,packageInventorySha256};
      if(!inventory.archiveComplete||inventory.packageSha256!==request.packageSha256)return {...base,reasons:['Package integrity or the independently bound package digest could not be verified']};
      if(inventory.solution?.name!==manifest.solutionUniqueName||inventory.solution.version!==manifest.solutionVersion)return {...base,status:'blocked',reasons:['Actual package solution identity/version differs from the approved manifest']};
      for(const component of inventory.components.filter(component=>[1,29,300].includes(component.type))) {
        const found=manifest.targetComponents.some(declared=>component.type===1?declared.kind==='dataverse-table'&&declared.logicalName.toLowerCase()===component.name?.toLowerCase():component.type===29?declared.kind==='cloud-flow'&&declared.logicalName.toLowerCase()===component.id:declared.kind==='canvas'&&declared.logicalName.toLowerCase()===component.name?.toLowerCase());
        if(!found)return {...base,status:'blocked',reasons:[`Package root component type ${component.type} lacks its exact approved component declaration`]};
      }
      const packageSchema=comparePackageSchema(inventory,manifest);
      resourceSchemaReferences=inventory.resources.flatMap(resource=>resource.schemaReferences??[]);
      advancedResources=inventory.resources;
      if(packageSchema.status==='blocked')return {...base,status:'blocked',reasons:packageSchema.reasons};
      packageIssues.push(...packageSchema.reasons);
      resources=inventory.resources.map(resource=>({id:resource.id,complete:resource.complete,connectors:resource.connectors}));
      if(!inventory.resourceInventoryComplete)packageIssues.push(...inventory.issues.slice(0,15).map(issue=>issue.slice(0,1000)));
      if(!resources.length&&!manualTables)return {...base,reasons:['No fully inspectable app/flow resource connector inventory is available',...packageIssues]};
      if(manualTables)resources=inventory.tables.map(table=>({id:`table:${table.name}`,complete:true,connectors:[]}));
      for(const reference of inventory.connections)if(!manifest.postDeployActions.some(action=>action.type==='connection-reference-check'&&manifest.targetComponents.some(component=>component.key===action.component&&component.logicalName.toLowerCase()===reference.name)&&action.connectorId.replace(/^\/providers\/Microsoft.PowerApps\/apis\//i,'').toLowerCase()===reference.connector))return {...base,status:'blocked',reasons:[`Package connection reference ${reference.name} lacks its exact approved connector/binding declaration`]};
    }
    const unavailable=(reasons:string[])=>({...unavailableGovernance(request,reasons),artifactSha256:request.packageSha256,packageInventoryFile,packageInventorySha256});
    if(!manifest.platformIdentity)return unavailable(['The release lacks a pinned platform identity for tenant policy and schema governance']);
    const platformIdentity=manifest.platformIdentity;
    const identity={tenantId:platformIdentity.tenantId,caller:platformIdentity.username};
    let declaredSchemaFile:string|undefined;
    let advancedPolicyFile:string|undefined;
    let connectorCatalogueFile:string|undefined,catalogueReason='Fresh scope-bound connector catalogue metadata is unavailable';
    const catalogueWork=async()=>{if(observeCatalogue&&advancedResources)try{
      const connectors=[...new Set(advancedResources.flatMap(resource=>resource.connectors))].sort();if(!connectors.length)return;
      const value=connectorCatalogueObservation.parse(await observeCatalogue({...identity,environmentId:platformIdentity.environmentId,connectors,checkout:request.checkout,signal:request.signal})),age=Date.now()-Date.parse(value.checkedAt);
      if(request.signal?.aborted||value.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||value.caller.toLowerCase()!==identity.caller.toLowerCase()||value.environmentId.toLowerCase()!==platformIdentity.environmentId.toLowerCase()||JSON.stringify(value.requested.slice().sort())!==JSON.stringify(connectors)||age>60_000||age < -30_000)throw new Error('Catalogue context differs');
      catalogueReason=value.reason;
      if(request.evidenceDirectory){const content=JSON.stringify({schemaVersion:1,scope:'package-connector-catalogue-observation',phase:request.phase,sourceCommit:request.sourceCommit,releaseId:request.releaseId,environmentUrl:request.environmentUrl,manifestSha256:manifestDigest(request.manifest),packageSha256:request.packageSha256,observation:value},null,2),file=`connector-catalogue-${crypto.createHash('sha256').update(content).digest('hex')}.json`;await atomicWrite(path.join(request.evidenceDirectory,file),content);connectorCatalogueFile=file;}
    }catch{catalogueReason='Connector catalogue metadata could not be bound to this stage or persisted';}};
    let advancedReason='Fresh environment rule assignment inventory and effective advanced enforcement mode are unavailable';
    let advancedConflict=false;let advancedReasons:string[]=[];
    let advancedValue:ReturnType<typeof advancedPolicyObservation.parse>|undefined;
    let schemaValue:ReturnType<typeof declaredSchemaObservation.parse>|undefined;
    const advancedWork=async()=>{if(observeAdvanced)try{
      const value=advancedPolicyObservation.parse(await observeAdvanced({...identity,environmentId:platformIdentity.environmentId,checkout:request.checkout,signal:request.signal}));
      const age=Date.now()-Date.parse(value.checkedAt);
      if(request.signal?.aborted||value.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||value.caller.toLowerCase()!==identity.caller.toLowerCase()||value.environmentId.toLowerCase()!==platformIdentity.environmentId.toLowerCase()||age>60_000||age < -30_000)throw new Error('Advanced policy context differs');
      advancedReason=value.reason;
      advancedValue=value;
      if(advancedResources){const comparison=compareAdvancedConnectorConstraints(value,{...identity,environmentId:platformIdentity.environmentId},advancedResources);advancedConflict=comparison.status==='conflict';advancedReasons=comparison.reasons;}
      if(request.evidenceDirectory){const content=JSON.stringify(value,null,2),file=`advanced-policy-${crypto.createHash('sha256').update(content).digest('hex')}.json`;await atomicWrite(path.join(request.evidenceDirectory,file),content);advancedPolicyFile=file;}
    }catch{advancedReason='Advanced policy observation could not be bound to this stage or persisted';}};
    let schemaReason='Fresh identity-bound declared target schema evidence is unavailable';
    const schemaWork=async()=>{if(observeSchema)try{
      const schema=declaredSchemaObservation.parse(await observeSchema({...request,resourceSchemaReferences}));
      const age=Date.now()-Date.parse(schema.checkedAt);
      if(request.signal?.aborted||schema.phase!==request.phase||schema.sourceCommit!==request.sourceCommit||schema.releaseId!==request.releaseId||schema.environmentUrl!==request.environmentUrl||schema.manifestSha256!==manifestDigest(request.manifest)||age>60_000||age < -30_000||(schema.status==='observed'&&(schema.identity?.tenantId.toLowerCase()!==identity.tenantId.toLowerCase()||schema.identity?.username.toLowerCase()!==identity.caller.toLowerCase()||schema.identity?.environmentId.toLowerCase()!==platformIdentity.environmentId.toLowerCase()||schema.binding?.organizationId.toLowerCase()!==manifest.targetBinding?.organizationId.toLowerCase()||schema.binding?.userId.toLowerCase()!==manifest.targetBinding?.userId.toLowerCase())))throw new Error('Schema context differs');
      schemaReason=schema.reason;
      schemaValue=schema;
      if(request.evidenceDirectory){const content=JSON.stringify(schema,null,2),file=`declared-schema-${crypto.createHash('sha256').update(content).digest('hex')}.json`;await atomicWrite(path.join(request.evidenceDirectory,file),content);declaredSchemaFile=file;}
    }catch{schemaReason='Declared schema evidence could not be bound to this stage or persisted';}};
    let snapshot:unknown;
    const [,policy]=await Promise.allSettled([schemaWork(),Promise.resolve().then(()=>source.ensureObservation?source.ensureObservation(identity,{signal:request.signal,force:true,timeoutMs:45_000}):source.observation(identity)),advancedWork(),catalogueWork()]);
    if(policy.status==='rejected'&&!manualTables)return {...unavailable([...advancedReasons.slice(0,26),'Refresh the authenticated policy inventory for the exact approved tenant and account before governed delivery',schemaReason,advancedReason,catalogueReason]),status:advancedConflict?'blocked':'unavailable',declaredSchemaFile,advancedPolicyFile,connectorCatalogueFile};
    snapshot=policy.status==='fulfilled'?policy.value:{scope:'unavailable-standard-policy-observation',reason:'Authenticated policy inventory could not be read. Manual review must establish non-applicability to this reference-only package; no tenant policy certification is inferred.'};
    const declared=manifest.postDeployActions.filter(action=>action.type==='connection-reference-check').map(action=>({id:`reference:${action.component}`,complete:true,connectors:[action.connectorId]}));
    if(!(resources??declared).length)return {...unavailable(['No independently complete app/flow connector inventory is available; advanced policy and comprehensive schema evidence are also required',schemaReason,advancedReason,catalogueReason]),declaredSchemaFile,advancedPolicyFile,connectorCatalogueFile};
    const standard=evaluateStandardPolicies(snapshot,identity,manifest.platformIdentity.environmentId,resources??declared);
    if(manualTables&&manual&&inventory&&request.evidenceDirectory&&standard.status!=='blocked'&&!advancedConflict&&schemaValue?.status==='observed'&&packageInventorySha256&&declaredSchemaFile){
      const directory=request.evidenceDirectory,policyContent=JSON.stringify(snapshot,null,2),policyFile=`manual-policy-${crypto.createHash('sha256').update(policyContent).digest('hex')}.json`;
      await atomicWrite(path.join(directory,policyFile),policyContent);
      const schemaFacts={identity:schemaValue.identity,binding:schemaValue.binding,tables:schemaValue.tables,observations:schemaValue.observations};
      const schemaSha256=crypto.createHash('sha256').update(JSON.stringify(schemaFacts)).digest('hex');
      const applicability={scope:'reference-only-table-package',connectorResources:0,schemaPayloads:0,roles:0,executables:0,policyObservation:standard.status,advancedObservation:advancedValue?.status??'unavailable',limitation:'Policy observations do not certify tenant-wide enforcement. Independent QA must decide applicability to this unchanged-metadata reference package.'};
      const applicabilityFile=`manual-applicability-${crypto.createHash('sha256').update(JSON.stringify(applicability)).digest('hex')}.json`;await atomicWrite(path.join(directory,applicabilityFile),JSON.stringify(applicability,null,2));
      const files=[path.join(directory,packageInventoryFile!),path.join(directory,declaredSchemaFile),...(advancedPolicyFile?[path.join(directory,advancedPolicyFile)]:[]),path.join(directory,policyFile),path.join(directory,applicabilityFile),await containedFile(request.checkout,manifest.solutionZip)];
      const evidence=await Promise.all(files.map(async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
      const approved=await manual.observe(request,{artifactSha256:request.packageSha256!,policySha256:crypto.createHash('sha256').update(JSON.stringify({applicability,policySha256:standard.policySha256??null})).digest('hex'),schemaSha256,inventorySha256:packageInventorySha256,advancedSha256:advancedValue?.observationSha256??crypto.createHash('sha256').update(JSON.stringify({status:advancedValue?.status??'unavailable'})).digest('hex')},evidence);
      if(approved)return {...approved,packageInventoryFile,packageInventorySha256,declaredSchemaFile,advancedPolicyFile};
      return {...unavailable(['A scoped manual development assessment is ready. Assigned independent QA must inspect its package, policy, schema/permissions, licence baseline and data/recovery evidence before this stage can proceed']),packageInventoryFile,packageInventorySha256,declaredSchemaFile,advancedPolicyFile};
    }
    const reasons=standard.status==='clear'?[resources?'Inspectable package resources passed standard classification; advanced policies, remaining opaque resources and comprehensive schemas are unverified':'Declared reference IDs passed standard classification; full package resource inventory, advanced policies and comprehensive schemas remain unverified']:standard.reasons.slice(0,20).map(reason=>reason.slice(0,1000));
    const ordered=standard.status==='blocked'?[...reasons,...advancedReasons,...packageIssues]:[...advancedReasons,...reasons,...packageIssues];
    return {...unavailableGovernance(request,[...ordered.slice(0,27),schemaReason,advancedReason,catalogueReason]),status:advancedConflict||standard.status==='blocked'?'blocked':'unavailable',policySha256:standard.policySha256,artifactSha256:request.packageSha256,packageInventoryFile,packageInventorySha256,declaredSchemaFile,advancedPolicyFile,connectorCatalogueFile};
  };
}
