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
import { setOfficeUrl,runtimeCleanupView,onRuntimeCleanupChanged } from './cliRunner.ts';
import { createDemoBackend } from './demo.ts';
import { underLauncher } from './officeUpdate.ts';
import { HttpError, Swarm } from './swarm.ts';
import {selectSynthesisSkills} from './synthesisSkills.ts';
import { FeatureStore } from './features.ts';
import { CapabilityService, capabilityBlocker } from './capabilityChecks.ts';
import { DeliveryService } from './delivery.ts';
import { createDeliveryQaTools, createEngineeringTools } from './ceo.ts';
import { releasePlanSchema } from './releasePlan.ts';
import { HOME_DIR, RESOURCE_LEASE_ROOT } from './config.ts';
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
import {ManualGovernance} from './manualGovernance.ts';

const backend = DEMO ? createDemoBackend() : realBackend;
const runtimeStartedAt = new Date().toISOString();
const maintenance=new OfficeMaintenance(path.join(HOME_DIR,backend.demo?'demo-maintenance.json':'maintenance.json'));
await maintenance.init();
const canvasOwnership = new CanvasOwnership(RESOURCE_LEASE_ROOT);
const swarm = new Swarm(backend);
swarm.runtimeCleanup=runtimeCleanupView;
onRuntimeCleanupChanged(()=>swarm.runtimeCleanupChanged());
if(maintenance.draining)swarm.setDraining(true);
swarm.taskPaused = (title) => !delivery.available||!!delivery.view().policy?.copilotPaused && /\bcopilot\b|\bpva\b/i.test(title);
const features = new FeatureStore(path.join(HOME_DIR, backend.demo ? 'demo-features.json' : 'features.json'), backend.demo, process.env.TEAMS_INCOMING_WEBHOOK_URL);
await features.init();
const delivery = new DeliveryService(HOME_DIR, backend.demo, undefined, RESOURCE_LEASE_ROOT);
await delivery.init({allowUnavailable:true});
const deliveryRecords = new DeliveryRecords(path.join(HOME_DIR,backend.demo?'demo-planning':'planning'));
try{await deliveryRecords.init();}catch{console.warn('Delivery records unavailable; preserve planning/delivery-records.json and inspect it before recovery');}
const recordContext=(repoId:string)=>{
  const repo=swarm.snapshot().repos.find(repo=>repo.id===repoId);
  if(!repo)throw new HttpError(404,'Repository is not connected');
  return {brief:repo.mission,environmentUrl:repo.targetTenancy?.environmentUrl??delivery.view().policy?.environmentUrl,tenantId:repo.targetTenancy?.tenantId,checkoutPath:repo.checkoutPath};
};
const recordDependencies={repo:recordContext,agents:()=>swarm.snapshot().agents,delivery:(repoId:string)=>delivery.view(repoId),get synthesis(){return synthesis;},inspectRepository:(checkoutPath:string,guard:()=>void)=>inspectRepository(checkoutPath,path.join(HOME_DIR,'planning','evidence'),guard),assertOpen:()=>{if(officeShutdown.closed||swarm.isDraining)throw new HttpError(503,'Office maintenance/shutdown pauses record changes');if(backend.demo)throw new HttpError(409,'Demo cannot change or certify delivery records');}};
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
  try{const record=deliveryRecords.current(repoId);return JSON.stringify({deliveryRecord:record?recordReference(record):null,phase:record?recordPhase(record):'not-started',instruction:'Call delivery_record action read before work. Use the current requirements, discovery and contracts. Discovery/design tasks must not author or deploy the solution. Record findings with action finding; report unresolved assumptions honestly.'});}catch{return 'Delivery records unavailable; implementation must wait for recovery';}
};
swarm.deliveryWorkGate=(repoId,issue)=>deliveryRecords.assertWork(repoId,issue,recordContext(repoId));
swarm.deliveryTaskStage=(repoId,issue)=>backend.demo?undefined:deliveryRecords.current(repoId)?.content.tasks.find(task=>task.issue===issue)?.stage;
swarm.deliveryTaskFingerprint=(repoId,issue)=>{if(backend.demo)return '';try{const record=deliveryRecords.current(repoId);if(!record)return 'missing';const task=record.content.tasks.find(task=>task.issue===issue);if(task?.stage!=='discovery')return record.sha256;const {findings:_findings,sourceCommit:_source,...scope}=record.content;return JSON.stringify([record.id,scope]);}catch{return 'unavailable';}};
delivery.checkDeliveryRecord=(repo,plan)=>{const record=deliveryRecords.assertRelease(repo.id,plan,recordContext(repo.id));if(record.content.environmentUrl?.replace(/\/$/,'').toLowerCase()!==delivery.view().policy?.environmentUrl.replace(/\/$/,'').toLowerCase())throw new HttpError(409,'Shared record target differs from the authorised deployment target');};
swarm.requestRecordReview=async repoId=>{const record=deliveryRecords.current(repoId);if(!record)throw new HttpError(409,'Create a shared delivery record before requesting review');deliveryRecords.assertContext(record,recordContext(repoId));return swarm.reviewDeliveryRelease(record.content.qaOwner,repoId,`delivery record ${record.revision}`,true);};
if(maintenance.draining)delivery.setDraining(true);
const toolGovernance = new ToolGovernanceService(path.join(HOME_DIR, backend.demo ? 'demo-governance' : 'governance'), () => (!delivery.available||!!delivery.view().policy?.copilotPaused));
await toolGovernance.init();
const tenantDlp = new TenantDlpService(path.join(HOME_DIR, backend.demo ? 'demo-governance' : 'governance'));
await tenantDlp.init();
const manualSourceFiles=['index.ts','manualGovernance.ts','deliveryGovernance.ts','lifecycleGovernance.ts','delivery.ts','backendJourney.ts','apiVerification.ts','packageInventory.ts','platformCommandError.ts','columnContracts.ts','tableStructure.ts','platformAuth.ts','identityContracts.ts','operationReconciliation.ts','deliveryRecords.ts','deliveryRecordTools.ts','releasePlan.ts','targetOperations.ts','ceo.ts','swarm.ts','../shared/governanceProfile.ts','../shared/deliveryRecord.ts','../shared/delivery.ts'].map(file=>fileURLToPath(new URL(file,import.meta.url)));
const manualRuntimeFiles=manualSourceFiles.every(file=>fs.existsSync(file))?manualSourceFiles:[fileURLToPath(import.meta.url)];
const manualRuntimeEvidence=manualRuntimeFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const manualGovernance=new ManualGovernance(HOME_DIR,id=>delivery.view().releases.find(release=>release.id===id),()=>{if(officeShutdown.closed||swarm.isDraining||backend.demo)throw new HttpError(409,'Manual governance is paused or unavailable');},{sha256:crypto.createHash('sha256').update(JSON.stringify(manualRuntimeEvidence)).digest('hex'),evidence:manualRuntimeEvidence});
try{await manualGovernance.init();}catch{console.warn('Manual governance storage unavailable; preserve its history before recovery');}
delivery.checkGovernance=createDeliveryGovernance(tenantDlp,createDeclaredSchemaObserver(),createAdvancedPolicyObserver(),createConnectorCatalogueObserver(),manualGovernance);
setToolGovernanceGate((name, input, checkpoint) => toolGovernance.check(name, input, checkpoint));
const capabilities = new CapabilityService(HOME_DIR, backend.demo);
await capabilities.init();
swarm.capabilityStatus = () => JSON.stringify(capabilities.view());
swarm.engineeringTools = (authorize,agentId,repoId) => createEngineeringTools(swarm.capabilityStatus, {
  async acquire(app, owner) {
    if (backend.demo) throw new HttpError(409, 'Demo cannot acquire tenant authoring ownership');
    const tenancy = await backend.tenancy.info(); const target = currentEnvironment(tenancy);
    if (!target || tenancy.status !== 'connected') throw new HttpError(409, 'Connect the authoring environment first');
    return canvasOwnership.acquire(target.url, app, owner);
  }, release: (token) => canvasOwnership.release(token),
}, authorize,agentId&&repoId?recordHandler(agentId,'dev',repoId):undefined);
swarm.capabilityFingerprint = () => JSON.stringify(capabilities.view().results.map((r) => [r.repoId, r.status, r.configHash, r.checks]));
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
},recordHandler(agentId,'qa',repoId),{read:()=>JSON.stringify(manualGovernance.view(repoId)),review:async(id,input)=>{const guard=swarm.planningSessionGuard(agentId);guard();const result=await manualGovernance.review(repoId,id,agentId,input,guard);guard();return JSON.stringify(result);}});
swarm.requestDeliveryReview = async (id) => {
  const release = delivery.view().releases.find((r) => r.id === id);
  if (!release) throw new HttpError(404, 'Release not found');
  if (release.approvedAt && !delivery.view().runs.some((r) => r.releaseId === id && r.phase === 'reviewing')&&!manualGovernance.view(release.repoId).some(row=>row.releaseId===id&&!row.review&&Date.parse(row.expiresAt)>Date.now())) return 'Release plan approved; visual review becomes available after verification';
  return swarm.reviewDeliveryRelease(release.plan.qaOwner, release.repoId, id);
};
const synthesis=new HldSynthesisService(path.join(HOME_DIR,backend.demo?'demo-architecture':'architecture'),{
  reserve:(repoId,jobId)=>swarm.reserveArchitectureSession(repoId,jobId),
  assertOpen(){if(backend.demo)throw new HttpError(409,'Demo cannot synthesize with a live model');if(officeShutdown.closed)throw new HttpError(503,'Office is shutting down');if(!delivery.available)throw new HttpError(409,'Delivery initialization is unavailable; inspect recovery before architecture execution');if(swarm.isDraining)throw new HttpError(409,'Office maintenance pauses new architecture jobs');},
  context(repoId,input){const repo=swarm.snapshot().repos.find(item=>item.id===repoId);if(!repo?.checkoutPath)throw new HttpError(404,'Architecture project checkout is unavailable');const discoveryRecord=deliveryRecords.current(repoId);if(!discoveryRecord)throw new HttpError(409,'Create the shared discovery record before synthesis');deliveryRecords.assertContext(discoveryRecord,recordContext(repoId));const catalogue=discoverSkills(),copilotPaused=(!delivery.available||!!delivery.view().policy?.copilotPaused);return {discoveryRecord,evidenceRoots:[path.join(HOME_DIR,'planning','evidence')],checkoutPath:repo.checkoutPath,fingerprint:JSON.stringify([repo.id,repo.localPath,repo.targetTenancy,repo.mission,discoveryRecord.sha256,catalogue.fingerprint,copilotPaused]),copilotPaused,skills:selectSynthesisSkills(catalogue,`${repo.mission} ${repo.summary}`,input,copilotPaused).map(({id,name,platform,sha256,version,description,toolStatus})=>({id,name,platform,sha256,version,description,toolStatus}))};},
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

const {app,browserAuth,closeAdmission}=createOfficeHttpApp({manualGovernance,deliveryRecords,managerRecordTool:recordHandler('manager','manager'),officeReload,synthesis:synthesisUnavailableReason?undefined:synthesis,synthesisUnavailableReason,backend,swarm,features,capabilities,delivery,toolGovernance,tenantDlp,canvasOwnership,homeDir:HOME_DIR,runtimeStartedAt,policyReaderMode,changeDrain:(value,apply)=>maintenance.change(value,apply),requestHandoff:()=>{void shutdown('restart');}});
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
  console.log(`\n  🏢 cubefarm on http://localhost:${PORT}${DEMO ? '  (DEMO MODE: fake GitHub + fake agents)' : ''}`);
  console.log(`     state: ${STATE_FILE}`);
  console.log(`     workspaces: ${WORKSPACE_ROOT}\n`);
});
