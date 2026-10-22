import {prepareTaskReconciliationReview} from './taskReconciliationReview.ts';
import {ExecutionAdmission,type ExecutionAttempt} from './executionAdmission.ts';
import {platformDiscoveryBinding} from './platformDiscovery.ts';
import {BrowserHandoff,browserCoordinatorAction,browserTargetConfiguration} from './browserHandoff.ts';
import {connectFlowAdapter} from './flowAdapter.ts';
import {ExecutionLedger} from './executionLedger.ts';
import {reconcileLauncherDelivery} from './launcherDeliveryRecovery.ts';
import {evidenceHash} from './sessionEvidence.ts';
import { createOfficeHttpApp } from './officeHttp.ts';
import {currentEnvironment} from '../shared/tenancy.ts';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import {MAX_OFFICE_WS_PAYLOAD} from './webSocketLimits.ts';
import { DEMO, PORT, STATE_FILE, WORKSPACE_ROOT } from './config.ts';
import { realBackend } from './backend.ts';
import { setOfficeUrl,runtimeCleanupView,onRuntimeCleanupChanged,nativeRuntimeView } from './cliRunner.ts';
import { createDemoBackend } from './demo.ts';
import { underLauncher } from './officeUpdate.ts';
import { HttpError, Swarm } from './swarm.ts';
import {selectSynthesisSkills} from './synthesisSkills.ts';
import { FeatureStore } from './features.ts';
import { CapabilityService, capabilityBlocker, capabilityDecisions } from './capabilityChecks.ts';
import {sharepointOffice} from './sharepointOffice.ts';
import {schemaBootstrapRuntime,schemaBootstrapConfigurationRoot} from './schemaBootstrapRuntime.ts';
import {canvasPackagingRuntime} from './canvasPackagingRuntime.ts';
import {packagingReviewRequest} from './canvasPackaging.ts';
import {schemaBootstrapReviewRequest} from './schemaBootstrap.ts';
import {connectSharepointSchemaWriter} from './sharepointSchemaWriter.ts';
import {PlatformDiscovery,platformDiscoveryBudget} from './platformDiscovery.ts';
import { DeliveryService,deliveryCommands } from './delivery.ts';
import {readPinnedBlob} from './pinnedPreparation.ts';
import {readDeliverySource,deliverySourceRequest} from './deliverySourceRead.ts';
import {discoveryEvidenceRoots,deliveryEvidenceFindingIds} from './deliveryEvidenceRead.ts';
import { createDeliveryQaTools, createEngineeringTools } from './ceo.ts';
import { releasePlanSchema } from './releasePlan.ts';
import { HOME_DIR, RESOURCE_LEASE_ROOT, SHAREPOINT_LEASE_ROOT } from './config.ts';
import { CanvasOwnership } from './canvasOwnership.ts';
import { ToolGovernanceService, setToolGovernanceGate } from './toolGovernance.ts';
import { TenantDlpService, policyReaderMode } from './tenantDlp.ts';
import { createDeliveryGovernance } from './deliveryGovernance.ts';
import { OfficeShutdown } from './officeShutdown.ts';
import {OfficeReloadRequester} from './officeReload.mjs';
import { parseBody } from './requestSchemas.ts';
import { OfficeMaintenance } from './officeMaintenance.ts';
import {createDeclaredSchemaObserver} from './declaredSchema.ts';
import {createAdvancedPolicyObserver} from './advancedPolicy.ts';
import {createConnectorCatalogueObserver} from './connectorCatalogue.ts';
import {HldSynthesisService} from './hldSynthesis.ts';
import {discoverSkills} from './skillRegistry.ts';
import {DeliveryRecords} from './deliveryRecords.ts';
import {deliveryRecordHandler} from './deliveryRecordTools.ts';
import {inspectRepository} from './repositoryDiscovery.ts';
import {recordReference,recordPhase} from '../shared/deliveryRecord.ts';
import {taskAuthorityHash,workerTaskFingerprint} from './taskScope.ts';
import {taskInputPrompt,TASK_CONTEXT_BYTES} from './taskInputs.ts';
import {taskScope} from '../shared/taskPlan.ts';
import {mergedTaskEvidence,verifyTaskInputs} from './taskExecution.ts';
import {ManualGovernance} from './manualGovernance.ts';
import {assertMonitoringContract} from './monitoringContract.ts';

const backend = DEMO ? createDemoBackend() : realBackend;
const runtimeStartedAt = new Date().toISOString();
const maintenance=new OfficeMaintenance(path.join(HOME_DIR,backend.demo?'demo-maintenance.json':'maintenance.json'));
await maintenance.init();
const canvasOwnership = new CanvasOwnership(RESOURCE_LEASE_ROOT);
const swarm = new Swarm(backend);
const executionLedger=new ExecutionLedger(backend.demo?path.join(HOME_DIR,'demo-efficiency'):HOME_DIR);
executionLedger.init();
if(!backend.demo)swarm.executionLedger=executionLedger;
swarm.runtimeCleanup=runtimeCleanupView;
onRuntimeCleanupChanged(()=>swarm.runtimeCleanupChanged());
if(maintenance.draining)swarm.setDraining(true);
swarm.taskPaused = (title) => !delivery.available||!!delivery.view().policy?.copilotPaused && /\bcopilot\b|\bpva\b/i.test(title);
const features = new FeatureStore(path.join(HOME_DIR, backend.demo ? 'demo-features.json' : 'features.json'), backend.demo, process.env.TEAMS_INCOMING_WEBHOOK_URL);
await features.init();
const delivery = new DeliveryService(HOME_DIR, backend.demo, undefined, RESOURCE_LEASE_ROOT);
await delivery.init({allowUnavailable:true});
if(!backend.demo)try{await reconcileLauncherDelivery(HOME_DIR,delivery,{enabled:process.env.SWARM_RECOVER_EMPTY_DELIVERY==='1',launcher:underLauncher(),crashedOwnerPid:process.env.SWARM_CRASHED_DELIVERY_OWNER});}catch{console.warn('Launcher delivery reconciliation held; inspect the preserved ownership and operation history');}
delivery.validateMonitoring=(repoId,plan,manifest,environmentUrl)=>{const config=capabilities.configuration(repoId);if(!config||new URL(config.environmentUrl).origin!==new URL(environmentUrl).origin)throw new HttpError(409,'Configure registered capability probes for the approved target before creating a release');assertMonitoringContract(plan,manifest,config.checks);};
const deliveryRecords = new DeliveryRecords(path.join(HOME_DIR,backend.demo?'demo-planning':'planning'));
try{await deliveryRecords.init();}catch{console.warn('Delivery records unavailable; preserve planning/delivery-records.json and inspect it before recovery');}
const recordContext=(repoId:string)=>{
  const repo=swarm.snapshot().repos.find(repo=>repo.id===repoId);
  if(!repo)throw new HttpError(404,'Repository is not connected');
  return {brief:repo.mission,environmentUrl:repo.targetTenancy?.environmentUrl??delivery.view().policy?.environmentUrl,tenantId:repo.targetTenancy?.tenantId,checkoutPath:repo.checkoutPath,executionEvidenceVersion:1 as const};
};
const bootstrapFor=(repoId:string,outerGuard:()=>void=()=>{})=>{
 const context=recordContext(repoId),record=deliveryRecords.current(repoId),config=capabilities.configuration(repoId);
 if(!record||!config||backend.demo)throw new HttpError(409,'Schema bootstrap requires a current authenticated project record and configuration');
 deliveryRecords.assertContext(record,context);
 const profile=backend.tenancy.activity().profileMutation?.fingerprint,configuration=capabilities.configurationFingerprint([repoId]);
 const configurationRoot=schemaBootstrapConfigurationRoot(HOME_DIR,repoId);
 const guard=()=>{outerGuard();if(officeShutdown.closed||deliveryRecords.current(repoId)?.sha256!==record.sha256||JSON.stringify(context)!==JSON.stringify(recordContext(repoId))||configuration!==capabilities.configurationFingerprint([repoId])||backend.tenancy.activity().profileMutation?.status!=='clear'||backend.tenancy.activity().profileMutation?.fingerprint!==profile)throw new HttpError(409,'Schema bootstrap record, target, authentication or configuration changed');};
 const scopedGuard=()=>{guard();if(schemaBootstrapConfigurationRoot(HOME_DIR,repoId)!==configurationRoot)throw new HttpError(409,'Project bootstrap configuration scope changed');};
 return schemaBootstrapRuntime({root:HOME_DIR,configurationRoot,leaseRoot:SHAREPOINT_LEASE_ROOT,repoId,checkoutPath:context.checkoutPath,guard:scopedGuard,record:()=>deliveryRecords.current(repoId)!,config:()=>capabilities.configuration(repoId)!});
};
const packagingFor=(repoId:string,outerGuard:()=>void=()=>{})=>{
 const context=recordContext(repoId),record=deliveryRecords.current(repoId),config=capabilities.configuration(repoId);
 if(!record||!config||backend.demo)throw new HttpError(409,'Canvas packaging requires a pinned authenticated project');
 deliveryRecords.assertContext(record,context);const fingerprint=capabilities.configurationFingerprint([repoId]),profile=backend.tenancy.activity().profileMutation?.fingerprint;
 const guard=()=>{outerGuard();if(officeShutdown.closed||swarm.isDraining||deliveryRecords.current(repoId)?.sha256!==record.sha256||JSON.stringify(context)!==JSON.stringify(recordContext(repoId))||capabilities.configurationFingerprint([repoId])!==fingerprint||backend.tenancy.activity().profileMutation?.status!=='clear'||backend.tenancy.activity().profileMutation?.fingerprint!==profile)throw new HttpError(409,'Canvas packaging record, target or profile changed');};
 return canvasPackagingRuntime({root:HOME_DIR,leaseRoot:RESOURCE_LEASE_ROOT,cwd:context.checkoutPath,record:()=>deliveryRecords.current(repoId)!,config:()=>capabilities.configuration(repoId)!,guard});
};
const browserHandoff=new BrowserHandoff(path.join(HOME_DIR,'planning','browser-handoffs'),repoId=>{recordDependencies.assertOpen();const record=deliveryRecords.current(repoId);if(record)deliveryRecords.assertContext(record,recordContext(repoId));return record??undefined;},(repoId,issue)=>{deliveryRecords.assertWork(repoId,issue,recordContext(repoId));},(repoId,url,environmentUrl)=>{
 const file=path.join(HOME_DIR,'tools','browser','coordinator-targets.json');if(!fs.existsSync(file))return false;const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>20000||fs.realpathSync(file)!==path.resolve(file))throw new HttpError(409,'Invalid browser coordinator target configuration');return browserTargetConfiguration.parse(JSON.parse(fs.readFileSync(file,'utf8'))).some(t=>t.repoId===repoId&&t.environmentUrl===environmentUrl&&t.url===url);
});
swarm.browserTaskHold=(repoId,actor,issue,since)=>browserHandoff.holdsTask(repoId,actor,issue,since);
const coordinatorBrowser=async(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void)=>{
 guard();if((payload as {action?:string})?.action==='request'){const agent=swarm.snapshot().agents.find(a=>a.id===actor.id&&a.repoId===repoId);if(!['dev','qa'].includes(actor.role)||!agent||agent.issueNumber!==(payload as {issue?:number}).issue)throw new HttpError(403,'Only the current task author may request browser work');return browserHandoff.request(repoId,actor.id,payload,guard,actor.role as 'dev'|'qa');}
 const input=browserCoordinatorAction.parse(payload);if(input.action==='inspect'){if(!['dev','qa','manager'].includes(actor.role))throw new HttpError(403,'Browser evidence requires project role');const rows=await browserHandoff.list(repoId);guard();return rows.filter(r=>actor.role!=='dev'||r.actor===actor.id);}
 if(actor.role!=='manager')throw new HttpError(403,'Only the authenticated coordinator may fulfill browser work');return input.action==='claim'?browserHandoff.claim(repoId,input.id,guard):browserHandoff.complete(repoId,input.id,input.result,guard);
};
const recordDependencies={acceptedReports:(repoId:string,record:import('../shared/deliveryRecord.ts').DeliveryRecord,guard:()=>void)=>{if(!record.sliceReceipt)throw new HttpError(409,'Accept a slice before selecting its report');return delivery.acceptedHeadlessReports(repoId,record.id,record.content.qaOwner,record.content.environmentUrl??"",record.sliceReceipt,guard);},browserHandoff:coordinatorBrowser,verifyAcceptedTask:(repoId:string,issue:number,source:import('../shared/deliveryRecord.ts').DeliveryRecord,receipt:NonNullable<import('../shared/deliveryRecord.ts').DeliveryRecord['taskAcceptances']>[number],originalQa?:import('./taskReconciliation.ts').OriginalTaskQa)=>swarm.verifyAcceptedTask(repoId,issue,source,receipt,originalQa),canvasPackaging:async(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void)=>{const data=packagingReviewRequest.parse(payload),service=packagingFor(repoId,guard);if(data.action==='inspect')return service.packaging.inspect(guard);if(data.action==='inspect-recovery')return service.recovery.inspect(guard);const {action,...review}=data;return action==='review-recovery'?service.recovery.review(review,actor,guard):service.packaging.review(review,actor,guard);},schemaBootstrap:async(repoId:string,payload:unknown,actor:{id:string;role:string},guard:()=>void)=>{const data=schemaBootstrapReviewRequest.parse(payload);const runner=bootstrapFor(repoId,guard);if(data.action==='inspect')return runner.inspect();const{action,...review}=data;return runner.review(review,actor);},verifySliceAcceptance:(id:string)=>delivery.verifySliceAcceptance(id),repo:recordContext,agents:()=>swarm.snapshot().agents,delivery:(repoId:string)=>delivery.view(repoId),get synthesis(){return synthesis;},inspectRepository:(checkoutPath:string,guard:()=>void)=>inspectRepository(checkoutPath,path.join(HOME_DIR,'planning','evidence'),guard),assertOpen:()=>{if(officeShutdown.closed||swarm.isDraining)throw new HttpError(503,'Office maintenance/shutdown pauses record changes');if(backend.demo)throw new HttpError(409,'Demo cannot change or certify delivery records');}};
const sourceReaderFor=(agentId:string,repoId:string)=>async(input:unknown)=>{
  const context=recordContext(repoId),session=swarm.planningSessionGuard(agentId),sourceCommit=deliveryRecords.current(repoId)?.content.sourceCommit??null;
  const agent=swarm.snapshot().agents.find(agent=>agent.id===agentId&&agent.repoId===repoId);if(!agent||!['dev','qa'].includes(agent.role))throw new HttpError(403,'Source reads require an active project worker');
  const issue=agent.issueNumber,scope=issue?swarm.deliveryTaskFingerprint(repoId,issue):null,signal=AbortSignal.timeout(15_000);
  const guard=()=>{recordDependencies.assertOpen();session();signal.throwIfAborted();if(JSON.stringify(context)!==JSON.stringify(recordContext(repoId))||sourceCommit!==(deliveryRecords.current(repoId)?.content.sourceCommit??null)||issue&&scope!==swarm.deliveryTaskFingerprint(repoId,issue))throw new HttpError(409,'Source scope changed; use the current admitted context');};
  const request=deliverySourceRequest.parse(input);
  return readDeliverySource(request,{repoId,sourceCommit,guard,evidence:request.kind==='discovery-evidence'?{home:HOME_DIR,repoId,guard,record:()=>deliveryRecords.current(repoId),findingIds:deliveryEvidenceFindingIds(deliveryRecords.current(repoId),issue,agent.role==='qa'?'qa':'dev')}:undefined,read:file=>readPinnedBlob(async args=>{guard();const output=await deliveryCommands.run({executable:'git',args},context.checkoutPath,{},signal);guard();return output;},sourceCommit!,file)});
};
swarm.coordinatorEvidenceRead=async(input,session,repoIds)=>{
 const request=deliverySourceRequest.parse(input);session();if(request.kind!=='discovery-evidence')throw new HttpError(403,'Coordinator receipt reader requires an exact discovery reference');
 const matches=repoIds.map(repoId=>deliveryRecords.current(repoId)).filter(record=>record?.id===request.reference.id);
 if(matches.length!==1||!matches[0])throw new HttpError(403,'Discovery record is outside the coordinator project scope');
 const record=matches[0],repoId=record.repoId,context=recordContext(repoId);
 const guard=()=>{recordDependencies.assertOpen();session();const current=deliveryRecords.current(repoId);if(!current||JSON.stringify(recordContext(repoId))!==JSON.stringify(context))throw new HttpError(409,'Coordinator discovery target changed');deliveryRecords.assertContext(current,context);};
 guard();return readDeliverySource(request,{repoId,sourceCommit:record.content.sourceCommit,guard,evidence:{home:HOME_DIR,repoId,record:()=>deliveryRecords.current(repoId),guard},read:async()=>{throw new HttpError(403,'Coordinator repository reads are not admitted');}});
};
const recordHandler=(id:string,role:'ceo'|'dev'|'qa'|'manager',repoId?:string):import('./ceo.ts').RecordToolHandler=>async input=>{
  const agent=role==='manager'?undefined:swarm.snapshot().agents.find(agent=>role==='ceo'?agent.role==='ceo':agent.id===id&&agent.repoId===repoId);
  const assertSession=agent?swarm.planningSessionGuard(agent.id):undefined;
  const assertOpen=()=>{
    recordDependencies.assertOpen();if(role==='manager')return;
    if(!assertSession)throw new HttpError(403,'Planning session is unavailable');assertSession();
  };
  return deliveryRecordHandler(deliveryRecords,{...recordDependencies,assertOpen},{id,role,repoId,reviewOnly:role==='qa'&&agent?.task==='qa'&&agent.prNumber===null})(input);
};
swarm.deliveryRecordTool=recordHandler('ceo','ceo');
swarm.deliveryRecordContext=repoId=>{
  if(backend.demo)return '';
  try{const record=deliveryRecords.current(repoId);return JSON.stringify({deliveryRecord:record?recordReference(record):null,phase:record?recordPhase(record):'not-started',instruction:'For taskPlan authoring use the supplied bounded task context; use delivery_record read for discovery/design or when broader evidence is needed. Use the current requirements, discovery and contracts. Discovery/design tasks must not author or deploy the solution. Record findings with action finding; report unresolved assumptions honestly.'});}catch{return 'Delivery records unavailable; implementation must wait for recovery';}
};
swarm.deliveryWorkGate=(repoId,issue)=>deliveryRecords.assertWork(repoId,issue,recordContext(repoId));
swarm.deliveryTaskStage=(repoId,issue)=>backend.demo?undefined:deliveryRecords.current(repoId)?.content.tasks.find(task=>task.issue===issue)?.stage;
swarm.deliveryTaskFingerprint=(repoId,issue)=>{if(backend.demo)return '';try{const record=deliveryRecords.current(repoId);return record?workerTaskFingerprint(record,issue):'missing';}catch{return 'unavailable';}};
swarm.deliveryTaskContract=(repoId,issue)=>{if(backend.demo)return null;const record=deliveryRecords.current(repoId),task=record?.content.taskPlan?.tasks.find(t=>t.issue===issue);return task&&record?{owner:task.owner,qaOwner:record.content.qaOwner,components:task.componentIds,resources:task.resources}:null;};
swarm.deliveryTaskContext=(repoId,issue)=>{if(backend.demo)return '';const record=deliveryRecords.current(repoId);if(!record)return '';const scope=taskScope(record.content,issue);if(!scope)return '';const context=taskInputPrompt(record,issue);if(Buffer.byteLength(context)>TASK_CONTEXT_BYTES)throw new HttpError(409,'Task context is too large; split the task');return context;};
swarm.deliveryTaskInputs=(repoId,issue)=>{if(backend.demo)return [];const record=deliveryRecords.current(repoId);if(!record)return [];return taskScope(record.content,issue)?.tasks.filter(t=>t.issue!==issue).map(t=>{const acceptance=record.taskAcceptances?.find(a=>a.issue===t.issue);if(!acceptance)throw new HttpError(409,`Dependency #${t.issue} lacks merged evidence`);return acceptance.mergeCommitSha;})??[];};
swarm.verifyTaskInputs=verifyTaskInputs;
swarm.deliveryTaskComplete=async(repoId,issue,evidence)=>{
  recordDependencies.assertOpen();const record=deliveryRecords.current(repoId),repo=swarm.snapshot().repos.find(r=>r.id===repoId);
  if(!record||!repo||!record.content.taskPlan?.tasks.some(t=>t.issue===issue))throw new HttpError(409,'Task contract is unavailable');
  const guard=()=>{recordDependencies.assertOpen();const current=deliveryRecords.current(repoId);if(!current||taskAuthorityHash(current,issue)!==evidence.taskAuthorityHash||current.content.qaOwner!==evidence.reviewer)throw new HttpError(409,'Task scope or independent QA changed before acceptance');};guard();
  const pr=await backend.prDetails(repo.fullName,evidence.prNumber);guard();
  const merged=mergedTaskEvidence(pr,issue,evidence.headSha,repo.defaultBranch);
  await deliveryRecords.acceptTask(repoId,recordReference(deliveryRecords.current(repoId)!),issue,{...merged,evidenceHash:evidence.evidenceHash},evidence.reviewer,recordContext(repoId),guard);
  executionLedger.accept({repoId,issue,scopeHash:evidenceHash(evidence.taskAuthorityHash),prNumber:evidence.prNumber,headSha:evidence.headSha,reviewer:evidence.reviewer,evidenceHash:evidence.evidenceHash});
};

delivery.checkDeliveryRecord=(repo,plan)=>{const record=deliveryRecords.assertRelease(repo.id,plan,recordContext(repo.id));if(record.content.environmentUrl?.replace(/\/$/,'').toLowerCase()!==delivery.view().policy?.environmentUrl.replace(/\/$/,'').toLowerCase())throw new HttpError(409,'Shared record target differs from the authorised deployment target');};
delivery.acceptedHeadlessSlice=(repoId,plan)=>{const record=deliveryRecords.assertRelease(repoId,plan,recordContext(repoId));if(plan.deliveryRecord?.purpose!=='expansion'||!record.sliceReceipt)throw new HttpError(409,'An independently accepted slice report is required');return{runId:record.sliceReceipt.runId,evidenceHash:record.sliceReceipt.evidenceHash};};
swarm.requestRecordReview=async repoId=>{const record=deliveryRecords.current(repoId);if(!record)throw new HttpError(409,'Create a shared delivery record before requesting review');deliveryRecords.assertContext(record,recordContext(repoId));return swarm.reviewDeliveryRelease(record.content.qaOwner,repoId,`delivery record ${record.revision}`,true);};
if(maintenance.draining)delivery.setDraining(true);
const toolGovernance = new ToolGovernanceService(path.join(HOME_DIR, backend.demo ? 'demo-governance' : 'governance'), () => (!delivery.available||!!delivery.view().policy?.copilotPaused));
await toolGovernance.init();
const tenantDlp = new TenantDlpService(path.join(HOME_DIR, backend.demo ? 'demo-governance' : 'governance'));
await tenantDlp.init();
const manualSourceFiles=['index.ts','sharepointWriteReadiness.ts','deliveryPermissions.ts','resourcePermissions.ts','userEntitlements.ts','delegatedEvidenceReader.ts','standardDlpEvidence.ts','callerLicensing.ts','platformDiscovery.ts','deliveryEvidenceRead.ts','deliverySourceRead.ts','synthesisEvidence.ts','flowAdapter.ts','headlessFlowVerification.ts','headlessAcceptedReport.ts','aiPromptMetadata.ts','privateReportMetadata.ts','repositoryAccessMetadata.ts','sharepointRestAuth.ts','sharepointProvisioning.ts','sharepointGraph.ts','sharepointOffice.ts','monitoringContract.ts','manualGovernance.ts','deliveryGovernance.ts','lifecycleGovernance.ts','delivery.ts','backendJourney.ts','apiVerification.ts','packageInventory.ts','platformCommandError.ts','columnContracts.ts','tableStructure.ts','platformAuth.ts','identityContracts.ts','operationReconciliation.ts','deliveryRecords.ts','deliveryRecordTools.ts','firstSlice.ts','qualityEvidence.ts','taskScope.ts','taskIntegration.ts','nativeDeniedAccess.ts','productionNativeQa.ts','nativeClaimReconciliation.ts','nativeClaimSession.ts','nativeHistory.ts','nativeHistoryCapture.ts','nativeClaimTermination.ts','providerImportHistory.ts','sharepointProviderHistory.ts','taskInputs.ts','taskExecution.ts','executionLedger.ts','nativeUsage.ts','sessionEvidence.ts','releasePlan.ts','targetOperations.ts','ceo.ts','swarm.ts','../shared/governanceProfile.ts','../shared/deliveryRecord.ts','../shared/firstSlice.ts','../shared/qualityEvidence.ts','../shared/taskPlan.ts','../shared/nativeQa.ts','../shared/applicationSpec.ts','../shared/delivery.ts'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
manualSourceFiles.push(...['sharepointSchemaWriter.ts','sharepointResourceApproval.ts','executionAdmission.ts','../shared/executionEvidence.ts'].map(file=>fileURLToPath(new URL(file,import.meta.url))));
const manualRuntimeFiles=[...new Set([fileURLToPath(import.meta.url),...(manualSourceFiles.every(file=>fs.existsSync(file))?manualSourceFiles:[])])];
const manualRuntimeEvidence=manualRuntimeFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const manualGovernance=new ManualGovernance(HOME_DIR,id=>delivery.view().releases.find(release=>release.id===id),()=>{if(officeShutdown.closed||swarm.isDraining||backend.demo)throw new HttpError(409,'Manual governance is paused or unavailable');},{sha256:crypto.createHash('sha256').update(JSON.stringify(manualRuntimeEvidence)).digest('hex'),evidence:manualRuntimeEvidence});
try{await manualGovernance.init();}catch{console.warn('Manual governance storage unavailable; preserve its history before recovery');}
delivery.checkGovernance=createDeliveryGovernance(tenantDlp,createDeclaredSchemaObserver(),createAdvancedPolicyObserver(),createConnectorCatalogueObserver(),manualGovernance);
setToolGovernanceGate((name, input, checkpoint) => toolGovernance.check(name, input, checkpoint));
const capabilities = new CapabilityService(HOME_DIR, backend.demo);
await capabilities.init();
const platformDiscovery=new PlatformDiscovery(HOME_DIR,{run:deliveryCommands.run,connect:connectFlowAdapter,dlpObservation:identity=>tenantDlp.observation(identity)});
const executionAdmission=new ExecutionAdmission(HOME_DIR,{
 configuration(record){
  const config=capabilities.configuration(record.repoId);if(!config)throw Error('Execution configuration is missing');
  const identity=platformDiscoveryBinding(config);
  if(identity.environmentUrl!==record.content.environmentUrl?.replace(/\/$/,''))throw Error('Execution identity target differs');
  for(const api of ['shared_office365','shared_commondataserviceforapps']){
   const checks=config.checks.filter(c=>c.probe.kind==='pac-connection'&&c.probe.api===api&&c.probe.account?.toLowerCase()===identity.username.toLowerCase()&&c.probe.environmentUrl.replace(/\/$/,'')===identity.environmentUrl&&c.probe.connectionId);
   if(checks.length!==1)throw Error('Execution requires exact reviewed Outlook and Dataverse connections');
  }
  return{sha256:crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'),identity:{...identity,authenticationFingerprint:backend.tenancy.activity().profileMutation?.fingerprint}};
 },
 async observe(probe,record,attempt,guard){
  const config=capabilities.configuration(record.repoId),context=recordContext(record.repoId);if(!config)throw Error('Execution configuration missing');guard();
  if(probe==='project-readiness'){
   const result=await capabilities.check(record.repoId,context.checkoutPath,context.environmentUrl,'git',true);guard();
   const details={repoId:result.repoId,configHash:result.configHash,checkedAt:result.checkedAt,expiresAt:result.expiresAt,checks:result.checks.map(c=>({id:c.id,category:c.category,passed:c.passed}))};
   return{passed:result.status==='ready'&&result.repoId===record.repoId&&result.checks.length>0&&result.checks.every(c=>c.passed),observedAt:result.checkedAt,expiresAt:result.expiresAt,sourceSha256:crypto.createHash('sha256').update(JSON.stringify(details)).digest('hex'),details};
  }
  const issue=attempt.issue??record.content.taskPlan?.tasks[0]?.issue;if(!issue)throw Error('Execution probe requires a bound task');
  const input={kind:probe==='headless-authoring-rights'?'headless-authoring-rights':'private-report-metadata'};
  const result=await platformDiscovery.inspect(config,context.checkoutPath,input,guard,AbortSignal.timeout(45_000),record.repoId,schemaBootstrapConfigurationRoot(HOME_DIR,record.repoId),{record,issue});guard();
  const data=result.observation.data as Record<string,unknown>;
  return{passed:data.status==='observed'&&(probe==='headless-authoring-rights'?data.requiredGlobalPrivilegesPresent===true:data.protectedOwnerOnly===true),observedAt:result.evidence.observedAt,expiresAt:result.evidence.expiresAt,sourceSha256:result.evidence.sha256,sourceReference:result.evidence.reference};
 }
});
const checkPhaseExecution=async(repoId:string,attempt:ExecutionAttempt,outerGuard:()=>void)=>{
 const record=deliveryRecords.current(repoId);if(!record||!record.content.findings.some(f=>f.executionEvidence))return;
 const approvalState=(r:typeof record|undefined)=>JSON.stringify([r?.designReview,r?.taskReviews,r?.taskAcceptances,r?.sliceReceipt]);
 const approvals=approvalState(record),config=capabilities.configurationFingerprint([repoId]),context=JSON.stringify(recordContext(repoId)),profile=backend.tenancy.activity().profileMutation?.fingerprint;
 const guard=()=>{outerGuard();const current=deliveryRecords.current(repoId);if(officeShutdown.closed||swarm.isDraining||current?.sha256!==record.sha256||approvalState(current)!==approvals||JSON.stringify(recordContext(repoId))!==context||capabilities.configurationFingerprint([repoId])!==config||backend.tenancy.activity().profileMutation?.status!=='clear'||backend.tenancy.activity().profileMutation?.fingerprint!==profile)throw Error('Phase execution context changed');};
 guard();await executionAdmission.check(record,attempt,guard);guard();
};
swarm.executionEvidenceCheck=(repoId,issue,actor,attemptId,guard)=>checkPhaseExecution(repoId,{phase:'authoring',issue,actor,attemptId},guard);
delivery.checkExecutionEvidence=async(repoId,plan,runId,phase,guard)=>{
 const record=deliveryRecords.current(repoId);if(!record?.content.findings.some(f=>f.executionEvidence))return;
 if(!plan.verification.headlessFlow)throw Error('Execution evidence requires the supported headless adapter');
 const owned=()=>{guard();deliveryRecords.assertRelease(repoId,plan,recordContext(repoId));};
 await checkPhaseExecution(repoId,{phase,actor:'delivery-runner',attemptId:runId},owned);
};
const platformMetadataFor=(agentId:string,repoId:string,role:'dev'|'qa')=>async(input:unknown)=>{
 const config=capabilities.configuration(repoId);if(!config)throw new HttpError(409,'Configure the reviewed platform target before discovery');
 const context=recordContext(repoId),fingerprint=capabilities.configurationFingerprint([repoId]),session=swarm.planningSessionGuard(agentId),authentication=backend.tenancy.activity().profileMutation?.fingerprint;
 const agent=swarm.snapshot().agents.find(a=>a.id===agentId&&a.repoId===repoId&&(role==='dev'?a.role==='dev':a.role==='qa'||a.task==='qa'));if(!agent)throw new HttpError(403,'Discovery requires the bound project worker role');
 const task=agent.issueNumber,scope=task?swarm.deliveryTaskFingerprint(repoId,task):null,recordSha=deliveryRecords.current(repoId)?.sha256,configurationRoot=schemaBootstrapConfigurationRoot(HOME_DIR,repoId);
 const guard=()=>{recordDependencies.assertOpen();session();const profile=backend.tenancy.activity().profileMutation;if(profile?.status!=='clear'||profile.fingerprint!==authentication)throw new HttpError(409,'Authentication profile ownership changed or is unresolved; discovery is paused');if(fingerprint!==capabilities.configurationFingerprint([repoId])||JSON.stringify(context)!==JSON.stringify(recordContext(repoId))||task&&scope!==swarm.deliveryTaskFingerprint(repoId,task)||role==='qa'&&recordSha!==deliveryRecords.current(repoId)?.sha256)throw new HttpError(409,'Discovery scope/configuration changed; use a newly admitted task');if(schemaBootstrapConfigurationRoot(HOME_DIR,repoId)!==configurationRoot)throw new HttpError(409,'Project discovery configuration scope changed');};
 const discoveryRecord=deliveryRecords.current(repoId);if(['delivery-permissions','delivery-authoring-prerequisites'].includes((input as {kind?:string})?.kind??'')&&(!task||!discoveryRecord||!discoveryRecord.content.taskPlan?.tasks.some(t=>t.issue===task&&(role==='qa'||t.owner===agentId))))throw new HttpError(403,'Delivery permissions require the assigned task owner');
 return platformDiscovery.inspect(config,context.checkoutPath,input,guard,AbortSignal.timeout(platformDiscoveryBudget(input)),repoId,configurationRoot,discoveryRecord&&(task||role==='qa'&&discoveryRecord.content.qaOwner===agentId)?{record:discoveryRecord,...(task?{issue:task}:{}),independentReview:role==='qa'&&discoveryRecord.content.qaOwner===agentId}:undefined);
};
swarm.capabilityStatus = () => JSON.stringify({...capabilities.view(),executionAdmission:executionAdmission.view()});
swarm.engineeringTools = (authorize,agentId,repoId) => createEngineeringTools(swarm.capabilityStatus, {
  async acquire(app, owner) {
    if (backend.demo) throw new HttpError(409, 'Demo cannot acquire tenant authoring ownership');
    const tenancy = await backend.tenancy.info(); const target = currentEnvironment(tenancy);
    if (!target || tenancy.status !== 'connected') throw new HttpError(409, 'Connect the authoring environment first');
    return canvasOwnership.acquire(target.url, app, owner);
  }, release: (token) => canvasOwnership.release(token),
}, authorize,agentId&&repoId?recordHandler(agentId,'dev',repoId):undefined,agentId&&repoId?platformMetadataFor(agentId,repoId,'dev'):undefined,agentId&&repoId?sourceReaderFor(agentId,repoId):undefined,agentId&&repoId?async input=>{
 const config=capabilities.configuration(repoId);if(!config)throw new HttpError(409,'Configure the reviewed platform target before SharePoint access');
 const context=recordContext(repoId),fingerprint=capabilities.configurationFingerprint([repoId]),session=swarm.planningSessionGuard(agentId),profileFingerprint=backend.tenancy.activity().profileMutation?.fingerprint;
 const agent=swarm.snapshot().agents.find(a=>a.id===agentId&&a.repoId===repoId&&a.role==='dev');if(!agent)throw new HttpError(403,'SharePoint access requires an active project developer');
 const issue=agent.issueNumber,scope=issue?swarm.deliveryTaskFingerprint(repoId,issue):null,source=deliveryRecords.current(repoId)?.content.sourceCommit,signal=AbortSignal.timeout(90_000);
 const configurationRoot=schemaBootstrapConfigurationRoot(HOME_DIR,repoId);
 const guard=()=>{recordDependencies.assertOpen();session();signal.throwIfAborted();const profile=backend.tenancy.activity().profileMutation;if(profile?.status!=='clear'||profile.fingerprint!==profileFingerprint||fingerprint!==capabilities.configurationFingerprint([repoId])||JSON.stringify(context)!==JSON.stringify(recordContext(repoId))||source!==deliveryRecords.current(repoId)?.content.sourceCommit||issue&&scope!==swarm.deliveryTaskFingerprint(repoId,issue))throw new HttpError(409,'SharePoint authority/configuration changed');};
 const scopedGuard=()=>{guard();if(schemaBootstrapConfigurationRoot(HOME_DIR,repoId)!==configurationRoot)throw new HttpError(409,'Project SharePoint configuration scope changed');};
 return sharepointOffice(input,{root:HOME_DIR,configurationRoot,leaseRoot:SHAREPOINT_LEASE_ROOT,repoId,actor:agentId,issue:issue??undefined,config,guard:scopedGuard,record:()=>deliveryRecords.current(repoId)??undefined,assertWork:()=>{scopedGuard();deliveryRecords.assertWork(repoId,issue!,recordContext(repoId));},readPlan:()=>{if(!source)throw new HttpError(409,'Pin the SharePoint plan source before provisioning');return readPinnedBlob(async args=>{scopedGuard();const result=await deliveryCommands.run({executable:'git',args},context.checkoutPath,{},signal);scopedGuard();return result;},source,'cubefarm.sharepoint.json');},connect:binding=>connectSharepointSchemaWriter(configurationRoot,binding,context.checkoutPath,signal,scopedGuard)});
}:undefined);
swarm.capabilityFingerprint = () => JSON.stringify(capabilities.view().results.map((r) => [r.repoId, r.status, r.configHash, capabilityDecisions(r.checks)]));
swarm.workerAdmissionContext = repoIds => JSON.stringify([capabilities.configurationFingerprint(repoIds), delivery.view().policy,delivery.available,backend.tenancy.activity().profileMutation]);
swarm.capabilityPreflight = async (repoId, cli) => {
  if(backend.tenancy.activity().profileMutation?.status!=='clear')return 'Authentication profile ownership is unresolved; reconcile it before starting agent work';
  if(!delivery.available)return 'Delivery initialization is unavailable; inspect recovery before starting agent work';
  const repo = swarm.snapshot().repos.find((r) => r.id === repoId);
  if (!repo) return 'Project not connected';
  const result = await capabilities.check(repoId, repo.checkoutPath, repo.targetTenancy?.environmentUrl ?? (fs.existsSync(path.join(repo.checkoutPath, 'cubefarm.delivery.json')) ? delivery.view().policy?.environmentUrl : undefined), cli);
  return capabilityBlocker(result);
};
delivery.checkCapabilities = async (repoId, cwd, environment, force) => {if(backend.tenancy.activity().profileMutation?.status!=='clear')return {status:'blocked',checks:[{id:'authentication-ownership',category:'authentication',passed:false,remedy:'Inspect and reconcile durable authentication ownership before deployment'}]};return capabilities.check(repoId,cwd,environment,'git',force);};
swarm.ceoPreflight = async (repoIds,cli) => {
  if(backend.tenancy.activity().profileMutation?.status!=='clear')return 'Authentication profile ownership is unresolved; reconcile it before starting agent work';
  if(!delivery.available)return 'Delivery initialization is unavailable; inspect recovery before starting agent work';
  const host = capabilityBlocker(await capabilities.check('__office__', HOME_DIR, undefined, cli));
  if (host) return `Office runtime: ${host}`;
  const results = await Promise.all(repoIds.map(async id => {
    const blocker = await swarm.capabilityPreflight(id, cli);
    return blocker ? `${id}: ${blocker}` : null;
  }));
  return results.filter(Boolean).join('; ') || null;
};
swarm.deliveryStatus = () => JSON.stringify({ ...delivery.view(), projects: swarm.snapshot().repos.map((repo) => ({ repo: repo.fullName, manifest: fs.existsSync(path.join(repo.checkoutPath, 'cubefarm.delivery.json')) ? 'present in checkout; release validates committed copy' : 'missing: plan real build, test, deployment and live verification scripts' })) });
// Sessions the office picks back up while it starts need the address their CLIs call back on before it listens.
if (PORT) setOfficeUrl(`http://127.0.0.1:${PORT}`);
swarm.deliveryRevision = () => delivery.view().revision;
swarm.createDeliveryRelease = async (repoId, input) => {
  const plan = parseBody(releasePlanSchema, input);
  const snapshot = swarm.snapshot();
  const repo = snapshot.repos.find((r) => r.id === repoId);
  if (!repo) throw new HttpError(404, 'Repository is not connected');
  if (!snapshot.agents.some((a) => a.id === plan.owner && a.repoId === repoId && a.role === 'dev') || !snapshot.agents.some((a) => a.id === plan.qaOwner && a.repoId === repoId && a.role === 'qa')) throw new HttpError(400, 'Assign a developer and a separate QA agent from this project');
  return JSON.stringify(await delivery.createRelease(repo, plan));
};
swarm.deliveryQaTools = (agentId, repoId, authorize) => createDeliveryQaTools(() => JSON.stringify(delivery.view(repoId)), async (id, hash) => {
  if (!delivery.view(repoId).releases.some((r) => r.id === id)) throw new HttpError(403, 'Release belongs to another project');
  return JSON.stringify(await delivery.approveRelease(id, agentId, hash));
}, async (id, review) => {
  if (!delivery.view(repoId).runs.some((r) => r.id === id)) throw new HttpError(403, 'Run belongs to another project');
  return JSON.stringify(await delivery.approveVisual(id, agentId, review));
}, authorize,async(id,hash,review)=>{
  if(!delivery.view(repoId).releases.some(r=>r.id===id))throw new HttpError(403,'Architecture belongs to another project');
  return JSON.stringify(await delivery.reviewArchitecture(id,agentId,hash,review));
},recordHandler(agentId,'qa',repoId),{read:()=>JSON.stringify(manualGovernance.view(repoId)),review:async(id,input)=>{const guard=swarm.planningSessionGuard(agentId);guard();const result=await manualGovernance.review(repoId,id,agentId,input,guard);guard();return JSON.stringify(result);}},sourceReaderFor(agentId,repoId),async input=>{const guard=swarm.planningSessionGuard(agentId),session=swarm.snapshot(),repo=session.repos.find(r=>r.id===repoId);if(!repo)throw new HttpError(404,'Project unavailable');const owned=()=>{guard();if(!swarm.snapshot().agents.some(a=>a.id===agentId&&a.repoId===repoId&&a.role==='qa'))throw new HttpError(403,'Assigned QA session required');};owned();return delivery.reconcileNativeClaim(repo,agentId,input,owned);},{capabilities:()=>{const view=capabilities.view();return JSON.stringify({...view,results:view.results.filter(r=>r.repoId===repoId),configuredProjects:view.configuredProjects.filter(id=>id===repoId)});},discovery:platformMetadataFor(agentId,repoId,'qa')});
swarm.requestDeliveryReview = async (id) => {
  const release = delivery.view().releases.find((r) => r.id === id);
  if (!release) throw new HttpError(404, 'Release not found');
  if(release.plan.deliveryRecord?.purpose==='slice'&&delivery.view().runs.some(run=>run.releaseId===id&&run.phase==='complete')&&!deliveryRecords.current(release.repoId)?.sliceReceipt)return swarm.reviewDeliveryRelease(release.plan.qaOwner,release.repoId,id,false,true);
  if (release.approvedAt && !delivery.view().runs.some((r) => r.releaseId === id && r.phase === 'reviewing')&&!manualGovernance.view(release.repoId).some(row=>row.releaseId===id&&!row.review&&Date.parse(row.expiresAt)>Date.now())) return 'Release plan approved; visual review becomes available after verification';
  return swarm.reviewDeliveryRelease(release.plan.qaOwner, release.repoId, id);
};
const synthesis=new HldSynthesisService(path.join(HOME_DIR,backend.demo?'demo-architecture':'architecture'),{
  reserve:(repoId,jobId)=>swarm.reserveArchitectureSession(repoId,jobId),
  assertOpen(){if(backend.demo)throw new HttpError(409,'Demo cannot synthesize with a live model');if(officeShutdown.closed)throw new HttpError(503,'Office is shutting down');if(!delivery.available)throw new HttpError(409,'Delivery initialization is unavailable; inspect recovery before architecture execution');if(swarm.isDraining)throw new HttpError(409,'Office maintenance pauses new architecture jobs');},
  context(repoId,input){const repo=swarm.snapshot().repos.find(item=>item.id===repoId);if(!repo?.checkoutPath)throw new HttpError(404,'Architecture project checkout is unavailable');const discoveryRecord=deliveryRecords.current(repoId);if(!discoveryRecord)throw new HttpError(409,'Create the shared discovery record before synthesis');deliveryRecords.assertContext(discoveryRecord,recordContext(repoId));const catalogue=discoverSkills(),copilotPaused=(!delivery.available||!!delivery.view().policy?.copilotPaused);return {discoveryRecord,evidenceRoots:discoveryEvidenceRoots(HOME_DIR),checkoutPath:repo.checkoutPath,fingerprint:JSON.stringify([repo.id,repo.localPath,repo.targetTenancy,repo.mission,discoveryRecord.sha256,catalogue.fingerprint,copilotPaused]),copilotPaused,skills:selectSynthesisSkills(catalogue,`${repo.mission} ${repo.summary}`,input,copilotPaused).map(({id,name,platform,sha256,version,description,toolStatus})=>({id,name,platform,sha256,version,description,toolStatus}))};},
  admission:repoId=>swarm.capabilityPreflight(repoId,'codex'),start:(options,callbacks)=>backend.startSession(options,callbacks),
});
let synthesisUnavailableReason:string|undefined;
try{await synthesis.init();}catch(error){synthesisUnavailableReason=error instanceof Error?error.message:'Architecture synthesis is unavailable';console.warn(synthesisUnavailableReason);await synthesis.close();}
// Install shutdown before retained-session admission, which can await native
// authentication/readiness. Every service closes its admission barrier at once.
let deliveryTimer: NodeJS.Timeout | undefined;
let closeHttpAdmission: (() => void) | undefined;
const officeReload=underLauncher()?new OfficeReloadRequester():undefined;
void officeReload?.probe();
const officeShutdown = new OfficeShutdown([
  { name: 'launcher reload', close:()=>officeReload?.close() },
  { name: 'HTTP admission', close: () => closeHttpAdmission?.() },
  { name: 'architecture synthesis', close:()=>synthesis.close() },
  { name: 'delivery records', close:()=>deliveryRecords.close() },
  { name: 'manual governance', close:()=>manualGovernance.close() },
  { name: 'maintenance', close: () => maintenance.close() },
  { name: 'swarm', close: restart => swarm.shutdown(restart) },
  { name: 'tenancy', close: () => backend.tenancy.shutdown() },
  { name: 'scheduler', close: () => clearInterval(deliveryTimer) },
  { name: 'policy reader', close: restart => tenantDlp.close(restart) },
  { name: 'capabilities', close: () => capabilities.close() },
  { name: 'delivery', close: () => delivery.close() },
]);
let shutdownWork: Promise<void> | undefined;
const shutdown = (signal: string): Promise<void> => {
  if (shutdownWork) return shutdownWork;
  console.log(`\n  ${signal}: stopping office services…`);
  const force = setTimeout(() => {
    console.error('Office cleanup exceeded 15 seconds; forcing exit');
    process.exit(1);
  }, 15_000);
  shutdownWork = officeShutdown.close(signal === 'restart')
    .then(() => signal === 'startup failure' ? 1 : 0, err => { console.error(err); return 1; })
    .then(code => { clearTimeout(force); process.exit(code); });
  return shutdownWork;
};
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGHUP', () => { void shutdown('SIGHUP'); });
if (underLauncher()) {
  process.on('message', msg => {
    const m = msg as { type?: unknown; restart?: unknown } | null;
    if (m?.type === 'office:shutdown') void shutdown(m.restart === false ? 'stop' : 'restart');
  });
}
swarm.restoreArchitectureCleanup(synthesis.pendingCleanup(),synthesisUnavailableReason);
try { await swarm.init(); }
catch (error) { console.error('Office startup failed:', error); await shutdown('startup failure'); }
if (officeShutdown.closed) await shutdown('stop');
delivery.onChange = () => { if (swarm.snapshot().repos.length) swarm.requestReview(); };
capabilities.onChange = delivery.onChange;

const {app,browserAuth,closeAdmission}=createOfficeHttpApp({requestTaskReconciliationReview:async(repoId,input)=>{recordDependencies.assertOpen();const prepared=prepareTaskReconciliationReview(deliveryRecords,repoId,input,recordContext(repoId));return swarm.reviewDeliveryRelease(prepared.reviewer,repoId,`task ${input.issue} reconciliation`,true,false,false,false,prepared.request);},canvasPackaging:async(repoId,action,body)=>{const service=packagingFor(repoId,recordDependencies.assertOpen);if(action==='reconcile')return service.recovery.reconcile();if(action==='recover')return service.recovery.execute((body as {proposalSha256:string}).proposalSha256);return action==='inspect'?service.packaging.inspect():service.packaging.execute((body as {proposalSha256:string}).proposalSha256);},requestCanvasPackagingReview:async repoId=>{recordDependencies.assertOpen();const record=deliveryRecords.current(repoId);if(!record)throw new HttpError(409,'Canvas packaging record required');return swarm.reviewDeliveryRelease(record.content.qaOwner,repoId,'same-app packaging preparation',true,false,false,true);},schemaBootstrap:async(repoId,action,body)=>{const runner=bootstrapFor(repoId,action==='execute'?recordDependencies.assertOpen:undefined);return action==='inspect'?runner.inspect():runner.execute((body as {planSha256:string}).planSha256);},requestSchemaBootstrapReview:async repoId=>{recordDependencies.assertOpen();const record=deliveryRecords.current(repoId);if(!record)throw new HttpError(409,'Schema record required');return swarm.reviewDeliveryRelease(record.content.qaOwner,repoId,'schema bootstrap',true,false,true);},nativeRuntime:nativeRuntimeView,executionLedger,executionReport:repoId=>executionLedger.report(repoId,receipt=>{const record=deliveryRecords.current(repoId);if(!record)return false;deliveryRecords.assertContext(record,recordContext(repoId));return evidenceHash(taskAuthorityHash(record,receipt.issue))===receipt.scopeHash&&!!record.taskAcceptances?.some(a=>a.issue===receipt.issue&&a.prNumber===receipt.prNumber&&a.headSha===receipt.headSha&&a.reviewer===receipt.reviewer&&a.evidenceHash===receipt.evidenceHash);}),manualGovernance,deliveryRecords,managerRecordTool:recordHandler('manager','manager'),officeReload,synthesis:synthesisUnavailableReason?undefined:synthesis,synthesisUnavailableReason,backend,swarm,features,capabilities,delivery,toolGovernance,tenantDlp,canvasOwnership,homeDir:HOME_DIR,runtimeStartedAt,policyReaderMode,changeDrain:(value,apply)=>maintenance.change(value,apply),requestHandoff:()=>{void shutdown('restart');}});
closeHttpAdmission=closeAdmission;
deliveryTimer = setInterval(() => { void delivery.tick(swarm.snapshot().repos).catch((err) => console.warn('delivery scheduler:', err.message)); }, 30_000);
deliveryTimer.unref();

const server = http.createServer(app);
// Two sockets: /ws carries the office's state to every tab, /ws/term?agent=<id> one agent's terminal to whoever opened it.
const wss = new WebSocketServer({ noServer: true,maxPayload:MAX_OFFICE_WS_PAYLOAD });
const terms = new WebSocketServer({ noServer: true,maxPayload:MAX_OFFICE_WS_PAYLOAD });
wss.on('connection', (ws) => swarm.addClient(ws));
terms.on('connection', (ws, req) => swarm.attachTerminal(new URL(req.url ?? '', 'http://localhost').searchParams.get('agent') ?? '', ws));
server.on('upgrade', (req, socket, head) => {
  if (officeShutdown.closed || !browserAuth.websocket(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return void socket.destroy(); }
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  const target = pathname === '/ws' ? wss : pathname === '/ws/term' ? terms : null;
  if (!target) return void socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

server.once('error', error => { console.error('Office listener failed:', error); void shutdown('startup failure'); });
server.listen(PORT, '127.0.0.1', () => {
  officeReload?.ready();
  setOfficeUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  console.log(`\n  🏢 Agent Swarm on http://localhost:${PORT}${DEMO ? '  (DEMO MODE: fake GitHub + fake agents)' : ''}`);
  console.log(`     state: ${STATE_FILE}`);
  console.log(`     workspaces: ${WORKSPACE_ROOT}\n`);
});
