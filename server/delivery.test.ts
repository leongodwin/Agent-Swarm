import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryService, deliveryManifest, containedFile, installedSolution, pacReportedError, importJobId, type DeliveryDependencies } from './delivery.ts';
import type { RepoView } from '../shared/types.ts';
import { manifestDigest } from './lifecycleGovernance.ts';

const directories: string[] = [];
it('recognizes PAC import failures printed to stdout even when its exit code is zero', () => {
  expect(pacReportedError('pac', 'Solution Importing...\nError: Cannot start another [Import]')).toBe(true);
  expect(pacReportedError('pac.launcher.exe', 'Error: Another [Uninstall] is running')).toBe(true);
  expect(pacReportedError('pac', 'Sorry, the app encountered a non-recoverable error and will need to terminate. Session Id: test, Exception Type: System.ArgumentException')).toBe(true);
  expect(pacReportedError('pac', 'Solution Import successful.')).toBe(false);
  expect(pacReportedError('node', 'Error: expected test fixture')).toBe(false);
});
it('extracts only explicitly labelled import job IDs', () => {
  const id = 'ef7c69b1-ec62-43b1-b22c-30ede86185ac';
  expect(importJobId(`Import Job ID: ${id}`)).toBe(id);
  expect(importJobId(`Organization: ${id}`)).toBeUndefined();
});
const services: DeliveryService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }); });
const sha = 'a'.repeat(40), target = 'https://development.crm4.dynamics.com';
const categories = ['journey', 'authorization', 'persistence', 'error-handling', 'journey', 'journey'];
const states = ['loading', 'empty', 'success', 'failure', 'validation', 'recovery'];
const plan = { name: 'Expenses release', owner: 'ada', qaOwner: 'sherlock', requiredIssues: [1], components: ['Expenses'], acceptanceCriteria: ['Users can create and view expenses'],
  quality: { maxTaskDurationMs: 30000, maxSeriousAccessibilityIssues: 0 }, monitoring: { intervalMinutes: 15, criticalProbeIds: ['critical-flow'] },
  verification: { baseUrl: 'https://expenses.example.test', identities: ['employee', 'manager'].map((id) => ({ id, expectedUser: `${id}@example.test`, userSelector: '#user' })),
    scenarios: categories.map((category, i) => ({ name: `${category} ${i}`, category, identity: i === 1 ? 'manager' : 'employee', criterion: 0, states: [states[i]],
      steps: [{ action: 'press', selector: '#result', key: 'Tab' }, ...(category === 'persistence' ? [{ action: 'reload' }] : []), { action: 'text', selector: '#result', contains: 'Expected outcome' }] })) } };
const manifest = { schemaVersion: 1, solutionUniqueName: 'Expenses', solutionVersion: '1.0.0.1', solutionZip: 'release.zip', hasUi: true,
  recovery: { runbook: 'operations.md', rehearsalReport: 'recovery.json' }, documentation: ['README.md', 'architecture.md', 'operations.md'],
  build: [{ executable: 'build', args: [] }], test: [{ executable: 'test', args: [] }], verify: [{ executable: 'verify', args: [] }] };
it('requires an approved binding check for each declared connection reference', () => {
  const connection = { key: 'dataverse', kind: 'connection-reference', logicalName: 'exp_dataverse' };
  const targetBinding = { organizationId: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111' };
  const typed = { ...manifest, targetBinding, targetComponents: [connection] };
  expect(deliveryManifest.safeParse(typed).success).toBe(false);
  const check = { id: 'dataverse-binding', type: 'connection-reference-check', component: 'dataverse', connectionId: 'shared-dataverse-real', connectorId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' };
  expect(deliveryManifest.safeParse({ ...typed, postDeployActions: [check] }).success).toBe(true);
  expect(deliveryManifest.safeParse({ ...typed, postDeployActions: [{ ...check, component: 'unmapped' }] }).success).toBe(false);
  expect(deliveryManifest.safeParse({ ...typed, postDeployActions: [{ ...check, connectionId: ' ' }] }).success).toBe(false);
});
async function fixture(fail?: 'test' | 'inventory' | 'evidence' | 'target' | 'independent') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-delivery-')); directories.push(root);
  await fs.mkdir(path.join(root, 'delivery-identities'));
  for (const id of ['employee', 'manager']) await fs.writeFile(path.join(root, 'delivery-identities', `${id}.json`), JSON.stringify({ cookies: [], origins: [] }));
  const calls: string[] = [];
  const deps: DeliveryDependencies = {
    async governance(request) {return {status:'clear',phase:request.phase,sourceCommit:request.sourceCommit,environmentUrl:request.environmentUrl,releaseId:request.releaseId,manifestSha256:manifestDigest(request.manifest),checkedAt:new Date().toISOString(),artifactSha256:request.packageSha256??'a'.repeat(64),policySha256:'b'.repeat(64),schemaSha256:'c'.repeat(64),reasons:['Isolated injected test governance evidence']};},
    async verify(_plan, _root, evidence) { calls.push('independent'); if (fail === 'independent') throw new Error('Independent authorization check failed'); await fs.writeFile(path.join(evidence, 'independent-verification.json'), 'browser results'); return ['independent-verification.json']; },
    async run(command, cwd, env) {
      calls.push([command.executable, ...command.args].join(' '));
      if (command.executable === 'gh') return JSON.stringify({ state: 'CLOSED' });
      if (command.executable === 'git') {
        if (command.args[0] === 'rev-parse') return sha;
        if (command.args[0] === 'show') return JSON.stringify(manifest);
        if (command.args[0] === 'worktree') {
          const checkout = command.args[3]; await fs.mkdir(checkout, { recursive: true });
          await fs.writeFile(path.join(checkout, 'cubefarm.delivery.json'), JSON.stringify(manifest));
          for (const name of manifest.documentation) await fs.writeFile(path.join(checkout, name), 'Actual project documentation');
        }
      }
      if (command.executable === 'build') {
        await fs.writeFile(path.join(cwd, 'release.zip'), 'PK build artifact');
        await fs.writeFile(path.join(cwd, 'recovery.json'), JSON.stringify({ sourceCommit: sha, performedAt: new Date().toISOString(), environmentUrl: 'https://rehearsal.crm4.dynamics.com', procedureSha256: crypto.createHash('sha256').update('Actual project documentation').digest('hex'), restored: true, dataPreserved: true, protectedRecords: [{ table: 'expenses', id: 'record-1', beforeSha256: 'b'.repeat(64), afterSha256: 'b'.repeat(64) }], evidence: ['operations.md'] }));
      }
      if (command.executable === 'test' && fail === 'test') throw new Error('Integration tests failed');
      if (command.executable === 'pac' && command.args[1] === 'list') return JSON.stringify([{ SolutionUniqueName: 'Expenses', VersionNumber: fail === 'inventory' ? '0.0.0.0' : '1.0.0.1' }]);
      if (command.executable === 'verify') {
        const report = { environmentUrl: fail === 'target' ? 'https://other.crm4.dynamics.com' : target, sourceCommit: sha, solutionUniqueName: 'Expenses', solutionVersion: '1.0.0.1', verifiedAt: new Date().toISOString(), authenticatedUser: 'tester@company.test',
          appUrls: ['https://apps.powerapps.com/play/test-app'], security: 'passed', persistence: 'passed',
          tests: ['journey', 'authorization', 'persistence', 'error-handling'].map((category) => ({ name: `Live ${category} test`, category, passed: true, evidence: 'results.json' })),
          ui: { desktop: 'desktop.png', mobile: 'mobile.png', trace: 'trace.zip', accessibility: 'passed', designReview: 'passed' } };
        for (const file of ['results.json', 'desktop.png', 'mobile.png', 'trace.zip']) if (fail !== 'evidence') await fs.writeFile(path.join(env.SWARM_DELIVERY_EVIDENCE, file), 'fixture evidence');
        await fs.writeFile(env.SWARM_DELIVERY_REPORT, JSON.stringify(report));
      }
      return '';
    },
  };
  const service = new DeliveryService(root, false, deps); services.push(service); await service.init();
  service.checkCapabilities = async () => ({ status: 'ready', configHash: 'config-v1', checks: [{ id: 'critical-flow', category: 'workflow', passed: true, remedy: 'Repair critical flow' }] });
  await service.configure(target, true);
  const repo = { id: 'owner/repo', checkoutPath: root, defaultBranch: 'main', cloneStatus: 'ready', issues: [], pulls: [] } as unknown as RepoView;
  const release = await service.createRelease(repo, plan); await service.approveRelease(release.id, 'sherlock', release.planHash);
  return { service, repo, calls, root, deps, release };
}
const storedRun={id:'synthetic-run',repoId:'synthetic/repo',head:'historical-commit',environmentUrl:target,phase:'blocked',startedAt:new Date().toISOString(),appUrls:[],evidence:[],log:[]};
const storedBase={policy:null,runs:[],releases:[],blockers:[],revision:0};
const badStates: [string,string][]=[
  ['broken JSON','{'],['null','null'],['array','[]'],['missing policy','{"runs":[]}'],
  ['future version',JSON.stringify({...storedBase,schemaVersion:2})],
  ['negative revision',JSON.stringify({...storedBase,revision:-1})],
  ['extra control',JSON.stringify({...storedBase,autoApprove:true})],
  ['string enabled',JSON.stringify({...storedBase,policy:{enabled:'false',environmentUrl:target,approvedAt:new Date().toISOString()}})],
  ['credential-bearing target',JSON.stringify({...storedBase,policy:{enabled:true,environmentUrl:'https://user:secret@target.crm4.dynamics.com',approvedAt:new Date().toISOString()}})],
  ['unknown phase',JSON.stringify({...storedBase,runs:[{...storedRun,phase:'trusted'}]})],
  ['escaping run directory',JSON.stringify({...storedBase,runs:[{...storedRun,id:'../../outside'}]})],
  ['escaping evidence',JSON.stringify({...storedBase,runs:[{...storedRun,evidence:['../outside.txt']}]})],
  ['duplicate runs',JSON.stringify({...storedBase,runs:[storedRun,storedRun]})],
  ['duplicate evidence',JSON.stringify({...storedBase,runs:[{...storedRun,evidence:['proof.txt','proof.txt']}]})],
  ['missing predecessor',JSON.stringify({...storedBase,runs:[{...storedRun,previousRunId:'missing'}]})],
  ['self predecessor',JSON.stringify({...storedBase,runs:[{...storedRun,previousRunId:storedRun.id}]})],
  ['orphan release',JSON.stringify({...storedBase,runs:[{...storedRun,releaseId:'missing'}]})],
  ['duplicate operations',JSON.stringify({...storedBase,runs:[{...storedRun,operations:Array(2).fill({id:'typed:activate',kind:'post-deploy',status:'verified',commandSha256:'a'.repeat(64),startedAt:new Date().toISOString()})}]})],
];
it.each(badStates)('preserves %s delivery state and rejects later writes after failed startup',async(_name,raw)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-invalid-'));directories.push(root);
  const file=path.join(root,'delivery.json');await fs.writeFile(file,raw);
  const execute=vi.fn<DeliveryDependencies['run']>(async()=>{throw new Error('Unexpected external execution');});
  const service=new DeliveryService(root,false,{run:execute});services.push(service);
  await expect(service.init()).rejects.toThrow('preserve and repair');
  expect(()=>service.view()).toThrow('unavailable');await expect(service.configure(target,true)).rejects.toThrow('not ready');
  await service.close();expect(await fs.readFile(file,'utf8')).toBe(raw);expect(execute).not.toHaveBeenCalled();
  expect(await fs.stat(path.join(root,'delivery.lock')).then(()=>true,()=>false)).toBe(false);
  await fs.writeFile(file,JSON.stringify(storedBase));const repaired=new DeliveryService(root,false,{run:execute});services.push(repaired);await repaired.init();expect(repaired.view().runs).toEqual([]);
});
it('preserves an oversized delivery file without loading or resetting it',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-oversized-'));directories.push(root);
  const file=path.join(root,'delivery.json');const handle=await fs.open(file,'w');await handle.truncate(16*1024*1024+1);await handle.close();
  const service=new DeliveryService(root,false);services.push(service);await expect(service.init()).rejects.toThrow('preserve and repair');await service.close();
  expect((await fs.stat(file)).size).toBe(16*1024*1024+1);
});
it('migrates unversioned empty state without losing the selected target or Copilot pause',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-legacy-'));directories.push(root);
  const policy={enabled:false,environmentUrl:target,approvedAt:new Date().toISOString(),copilotPaused:true};const file=path.join(root,'delivery.json');
  await fs.writeFile(file,JSON.stringify({policy,runs:[]}));const service=new DeliveryService(root,false);services.push(service);await service.init();
  expect(service.view().policy).toEqual(policy);expect(JSON.parse(await fs.readFile(file,'utf8'))).toMatchObject({schemaVersion:1,policy,runs:[],releases:[],blockers:[],revision:0});
});
it.each(['target','plan','approval','run mapping','completion'] as const)('rejects a corrupted saved %s without altering its release hash or file',async corruption=>{
  const {service,root,deps,repo}=await fixture();await service.start(repo);await service.waitForIdle();await service.close();
  const file=path.join(root,'delivery.json');const saved=JSON.parse(await fs.readFile(file,'utf8'));
  if(corruption==='target')saved.releases[0].environmentUrl='https://other.crm4.dynamics.com';
  if(corruption==='plan')saved.releases[0].plan.name='Changed release';
  if(corruption==='approval')saved.releases[0].approvedBy=saved.releases[0].plan.owner;
  if(corruption==='run mapping')saved.runs[0].head='b'.repeat(40);
  if(corruption==='completion')saved.runs[0].phase='complete';
  const raw=JSON.stringify(saved);await fs.writeFile(file,raw);const restored=new DeliveryService(root,false,deps);services.push(restored);
  await expect(restored.init()).rejects.toThrow('preserve and repair');await restored.close();expect(await fs.readFile(file,'utf8')).toBe(raw);
});
it('rejects delivery writes before initialization and cannot restart a closed service',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-admission-'));directories.push(root);const service=new DeliveryService(root,false);services.push(service);
  await expect(service.configure(target,true)).rejects.toThrow('not ready');expect(()=>service.view()).toThrow('unavailable');await service.close();await expect(service.init()).rejects.toThrow('already started or stopped');
  expect(await fs.stat(path.join(root,'delivery.json')).then(()=>true,()=>false)).toBe(false);
});
it('waits for an initializing lease write before shutdown cleanup without resetting persisted state',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-startup-close-'));directories.push(root);
  const file=path.join(root,'delivery.json');const raw=JSON.stringify(storedBase);await fs.writeFile(file,raw);
  const service=new DeliveryService(root,false);services.push(service);
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});const hold=new Promise<void>(resolve=>{release=resolve;});
  const original=fs.open.bind(fs);let intercepted=false;
  const spy=vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{
    const handle=await (original as any)(...args);
    if(!intercepted&&String(args[0])===path.join(root,'delivery.lock')&&args[1]==='wx'){intercepted=true;entered();await hold;}
    return handle;
  });
  let closing:Promise<void>|undefined;
  try {
    const pending=service.init();const rejected=expect(pending).rejects.toThrow('preserve and repair');await started;
    let finished=false;closing=service.close().then(()=>{finished=true;});await Promise.resolve();expect(finished).toBe(false);
    release();await rejected;await closing;
    expect(await fs.readFile(file,'utf8')).toBe(raw);expect(await fs.stat(path.join(root,'delivery.lock')).then(()=>true,()=>false)).toBe(false);
  } finally {release();spy.mockRestore();await closing;}
});
it.each(['configuration','first command','between commands'] as const)('quarantines lost delivery ownership during %s without writing over its successor',async point=>{
  const {service,root,deps,repo,release,calls}=await fixture();
  const file=path.join(root,'delivery.json'),lock=path.join(root,'delivery.lock');const before=await fs.readFile(file,'utf8');
  const successor={...JSON.parse(await fs.readFile(lock,'utf8')),token:crypto.randomUUID()};const marker=JSON.stringify(successor);
  calls.length=0;
  if(point==='between commands'){
    const original=deps.run;deps.run=async(command,cwd,env,signal)=>{const result=await original(command,cwd,env,signal);if(command.executable==='git'&&command.args[0]==='fetch')await fs.writeFile(lock,marker);return result;};
  }else await fs.writeFile(lock,marker);
  const request=point==='configuration'?service.configure(target,false):service.createRelease(repo,{...release.plan,name:'Synthetic replacement release'});
  await expect(request).rejects.toThrow('ownership lost');
  expect(calls).toHaveLength(point==='between commands'?1:0);expect(await fs.readFile(file,'utf8')).toBe(before);expect(await fs.readFile(lock,'utf8')).toBe(marker);
  expect(()=>service.view()).toThrow('ownership lost');await expect(service.configure(target,true)).rejects.toThrow('closed');
  await expect(service.close()).rejects.toThrow('ownership lost');services.splice(services.indexOf(service),1);
  expect(await fs.readFile(lock,'utf8')).toBe(marker);
});
it('does not accept independent verification after its delivery owner is replaced',async()=>{
  const {service,root,deps,repo}=await fixture();const lock=path.join(root,'delivery.lock');
  const successor={...JSON.parse(await fs.readFile(lock,'utf8')),token:crypto.randomUUID()};const marker=JSON.stringify(successor);
  const original=deps.verify!;deps.verify=async(...args)=>{const result=await original(...args);await fs.writeFile(lock,marker);return result;};
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    await service.start(repo);await service.waitForIdle();expect(()=>service.view()).toThrow('ownership lost');
    const saved=JSON.parse(await fs.readFile(path.join(root,'delivery.json'),'utf8'));expect(saved.runs[0].phase).not.toBe('complete');expect(saved.runs[0].phase).not.toBe('reviewing');
    expect(await fs.readFile(lock,'utf8')).toBe(marker);await expect(service.close()).rejects.toThrow('ownership lost');services.splice(services.indexOf(service),1);
  }finally{warn.mockRestore();}
});
const validReview = (hash: string) => ({ evidenceHash: hash, scores: [4, 4, 4, 4, 4], notes: 'Inspected desktop/mobile hierarchy, accessibility, task clarity and recovery evidence.', recoveryReviewed: true });
it('drains automatic and manual delivery starts without changing approved policy or releases',async()=>{
  const {service,repo,calls,release}=await fixture();const before=service.view();calls.length=0;service.setDraining(true);
  await expect(service.start(repo)).rejects.toThrow('draining');await service.tick([repo]);expect(calls).toEqual([]);expect(service.view().policy).toEqual(before.policy);expect(service.view().releases).toEqual(before.releases);
  service.setDraining(false);await service.start(repo,false,release.id);await service.waitForIdle();expect(service.view().runs[0].phase).toBe('reviewing');
});
describe('Real solution delivery', () => {
  it('blocks an unconfigured governance provider before executing project build commands',async()=>{
    const {service,repo,calls,deps,root}=await fixture();delete deps.governance;
    await service.start(repo);await service.waitForIdle();const run=service.view().runs[0];
    expect(run.phase).toBe('blocked');expect(run.error).toContain('governance unavailable at build');
    expect(calls).not.toContain('build');expect(calls.some(call=>call.includes('solution import'))).toBe(false);
    const file=run.evidence.find(file=>file.endsWith('-build.json'))!;
    expect(JSON.parse(await fs.readFile(path.join(root,'delivery-runs',run.id,'evidence',file),'utf8'))).toMatchObject({status:'unavailable',sourceCommit:run.head,releaseId:run.releaseId});
  });
  it('retains a blocked package inventory in the same evidence index as its denying decision',async()=>{
    const {service,repo,deps,root}=await fixture();const original=deps.governance!;
    deps.governance=async request=>{
      const decision=await original(request);if(request.phase!=='import')return decision;
      const file=`package-inventory-${request.packageSha256}.json`;
      await fs.writeFile(path.join(request.evidenceDirectory!,file),JSON.stringify({scope:'injected-test-inventory',resourceInventoryComplete:false}));
      return {...decision,status:'unavailable',packageInventoryFile:file,reasons:['Opaque package components need validation']};
    };
    await service.start(repo);await service.waitForIdle();const run=service.view().runs[0];
    expect(run.phase).toBe('blocked');const inventory=run.evidence.find(file=>file.startsWith('package-inventory-'));expect(inventory).toBeDefined();
    expect(JSON.parse(await fs.readFile(path.join(root,'delivery-runs',run.id,'evidence',inventory!),'utf8')).resourceInventoryComplete).toBe(false);
    expect(run.operations?.length??0).toBe(0);
  });
  for(const stage of ['test','import','post-deploy','verify'] as const) it(`rechecks governance at ${stage} and blocks drift without inventing an import outcome`,async()=>{
    const {service,repo,calls,deps,root}=await fixture();const original=deps.governance!;
    const stages:string[]=[];
    deps.governance=async request=>{stages.push(request.phase);const result=await original(request);return request.phase===stage?{...result,status:'blocked',reasons:['New policy or schema drift detected']}:result;};
    await service.start(repo);await service.waitForIdle();const run=service.view().runs[0];
    expect(run.phase).toBe('blocked');expect(run.error).toContain(`governance blocked at ${stage}`);
    expect(stages).toContain(stage);
    if(stage==='test'||stage==='import'){expect(calls.some(call=>call.includes('solution import'))).toBe(false);expect(run.checkpoint).not.toBe('import-started');expect(run.operations?.length??0).toBe(0);}
    if(stage==='post-deploy'||stage==='verify')expect(calls.filter(call=>call.includes('solution import'))).toHaveLength(1);
    const file=run.evidence.filter(file=>file.endsWith(`-${stage}.json`)).at(-1)!;
    expect(JSON.parse(await fs.readFile(path.join(root,'delivery-runs',run.id,'evidence',file),'utf8')).status).toBe('blocked');
  });
  it('marks health degraded when governance expires without altering signed release evidence',async()=>{
    const {service,repo,deps,root}=await fixture();await service.start(repo);await service.waitForIdle();const run=service.view().runs[0];await service.approveVisual(run.id,'sherlock',validReview(run.evidenceHash!));
    const signed=service.view().runs[0];const original=deps.governance!;deps.governance=async request=>({...await original(request),status:'unavailable',reasons:['Policy evidence expired']});
    await service.monitor(repo,run.id);const current=service.view().runs[0];expect(current.health?.status).toBe('degraded');expect(current.health?.error).toContain('Policy evidence expired');expect(current.evidence).toEqual(signed.evidence);expect(current.evidenceHash).toBe(signed.evidenceHash);
    expect(JSON.parse(await fs.readFile(path.join(root,'delivery-runs',run.id,current.health!.governanceEvidence!),'utf8')).status).toBe('unavailable');
  });
  it('runs a backend-only release through runner-owned API verification without launching a browser', async () => {
    const { service, repo, root, deps, calls } = await fixture(); const original = deps.run;
    const id = '11111111-1111-4111-8111-111111111111';
    deps.run = async (...args) => {
      if (args[0].executable === 'git' && args[0].args[0] === 'show') return JSON.stringify({ ...manifest, hasUi: false, targetBinding: { organizationId: id, userId: id } });
      if (args[0].executable === 'dataverse') {
        const resource = args[0].args[args[0].args.indexOf('--path') + 1];
        if (resource.includes('/solutions?')) return JSON.stringify({ value: [{ solutionid: id }] });
        if (resource.includes('/solutioncomponents?')) return JSON.stringify({ value: [] });
        return JSON.stringify({ OrganizationId: id, UserId: id });
      }
      const result = await original(...args);
      if (args[0].executable === 'verify') { const file = args[2].SWARM_DELIVERY_REPORT; const report = JSON.parse(await fs.readFile(file, 'utf8')); report.appUrls = []; delete report.ui; await fs.writeFile(file, JSON.stringify(report)); }
      return result;
    };
    const backend = { ...plan, acceptanceProfile: 'functional-development', verification: { baseUrl: target, identities: [], scenarios: [], api: {
      binding: { organizationId: id, userId: id }, checks: ['journey', 'authorization', 'persistence', 'error-handling'].map((category) => ({ name: 'Observe ' + category, category, criterion: 0, resource: 'WhoAmI', assertions: [{ pointer: ['UserId'], equals: id }] })),
    } } };
    const release = await service.createRelease(repo, backend); await service.approveRelease(release.id, 'sherlock', release.planHash);
    await service.start(repo, false, release.id); await service.waitForIdle();
    const run = service.view().runs[0]; expect(run.phase, run.error).toBe('reviewing'); expect(calls).not.toContain('independent');
    expect(run.appUrls).toEqual([]); expect(run.evidence).toContain('independent-api.json');
    expect(JSON.parse(await fs.readFile(path.join(root, 'delivery-runs', run.id, 'evidence', 'acceptance-scope.json'), 'utf8')).independentMethod).toBe('dataverse-api');
    await expect(service.approveVisual(run.id, 'sherlock', validReview(run.evidenceHash!))).rejects.toThrow();
    await service.approveVisual(run.id, 'sherlock', { evidenceHash: run.evidenceHash, scores: [], notes: 'Reviewed API assertions, transaction outputs, target identity and protected-record recovery evidence.', recoveryReviewed: true });
    expect(service.view().runs[0].phase).toBe('complete');
  });
  it('retains functional validation scope in hashed evidence and after restart without changing the plan hash', async () => {
    const { service, repo, root, deps } = await fixture();
    const original = deps.run;
    deps.run = async (...args) => { const output = await original(...args); if (args[0].executable === 'verify') { const file = args[2].SWARM_DELIVERY_REPORT; const report = JSON.parse(await fs.readFile(file, 'utf8')); report.security = 'not-verified'; await fs.writeFile(file, JSON.stringify(report)); } return output; };
    const development = { ...plan, acceptanceProfile: 'functional-development', verification: { ...plan.verification,
      identities: [plan.verification.identities[0]], scenarios: plan.verification.scenarios.map((scenario) => ({ ...scenario, identity: 'employee' })) } };
    const release = await service.createRelease(repo, development); await service.approveRelease(release.id, 'sherlock', release.planHash);
    await service.start(repo, false, release.id); await service.waitForIdle();
    const run = service.view().runs[0]; expect(run.phase).toBe('reviewing');
    const scope = JSON.parse(await fs.readFile(path.join(root, 'delivery-runs', run.id, 'evidence', 'acceptance-scope.json'), 'utf8'));
    expect(scope).toMatchObject({ profile: 'functional-development', sourceCommit: sha, planHash: release.planHash, environmentUrl: target });
    expect(scope.limitations.join()).toContain('permission isolation are not certified');
    await service.approveVisual(run.id, 'sherlock', validReview(run.evidenceHash!));
    await service.close(); const restarted = new DeliveryService(root, false, deps); services.push(restarted); await restarted.init();
    expect(restarted.view().runs[0].acceptance?.profile).toBe('functional-development');
    expect(restarted.view().releases[0].planHash).toBe(release.planHash);
  });
  it('blocks strict acceptance when the project explicitly reports unverified security', async () => {
    const { service, repo, deps } = await fixture(); const original = deps.run;
    deps.run = async (...args) => { const output = await original(...args); if (args[0].executable === 'verify') { const file = args[2].SWARM_DELIVERY_REPORT; const report = JSON.parse(await fs.readFile(file, 'utf8')); report.security = 'not-verified'; await fs.writeFile(file, JSON.stringify(report)); } return output; };
    await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].phase).toBe('blocked');
    expect(service.view().runs[0].error).toContain('requires passing authorization evidence');
  });
  it('builds and tests before importing and persists independently approved evidence', async () => {
    const { service, repo, calls, root, deps } = await fixture(); await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].phase).toBe('reviewing');
    await service.approveVisual(service.view().runs[0].id, 'sherlock', validReview(service.view().runs[0].evidenceHash!));
    expect(service.view().runs[0].phase).toBe('complete'); expect(service.view().runs[0].appUrls).toHaveLength(1);
    expect(calls.indexOf('test')).toBeLessThan(calls.findIndex((c) => c.includes('solution import')));
    expect(calls.filter((c) => c.includes('solution list'))).toHaveLength(2);
    expect(calls.find((c) => c.includes('solution import'))).toContain(`--environment ${target}`);
    expect(service.view().runs[0].operations?.[0]).toMatchObject({ id: 'solution-import', kind: 'import', status: 'verified' });
    await service.close(); const restarted = new DeliveryService(root, false, deps); services.push(restarted); await restarted.init(); restarted.checkCapabilities = service.checkCapabilities;
    expect(restarted.view().runs[0].phase).toBe('complete'); const before = calls.length; await restarted.start(repo);
    expect(calls.slice(before).some((c) => c.includes('solution import'))).toBe(false);
  });
  for (const failure of ['test', 'inventory', 'evidence', 'target', 'independent'] as const) it(`blocks completion when ${failure} fails`, async () => {
    const { service, repo, calls } = await fixture(failure); await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].phase).toBe('blocked'); if (failure === 'test') expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  it('refuses demo execution while unrelated backlog does not block a scoped release', async () => {
    const { service, repo, root, deps } = await fixture();const demo=new DeliveryService(root,true,deps);await demo.init();await expect(demo.configure(target, true)).rejects.toThrow('Demo');
    await service.start({ ...repo, issues: [{ number: 999 }], pulls: [{ state: 'OPEN', number: 999 }] } as RepoView); await service.waitForIdle(); expect(service.view().runs[0].phase).toBe('reviewing');
  });
  it('rejects foreign evidence paths and wrong installed versions', async () => {
    const { root } = await fixture(); const sub = path.join(root, 'evidence'); await fs.mkdir(sub); await fs.writeFile(path.join(root, 'outside'), 'outside');
    await expect(containedFile(sub, '../outside')).rejects.toThrow('outside');
    expect(installedSolution('[{"UniqueName":"Expenses","Version":"1.0.0.0"}]', 'Expenses', '1.0.0.1')).toBe(false);
  });
});
describe('Release reliability', () => {
  it('publishes a mapped Copilot and retains the independent published-channel contract', async () => {
    const { service, repo, deps, root, calls } = await fixture(); const original = deps.run;
    const id = '11111111-1111-4111-8111-111111111111', solutionId = '22222222-2222-4222-8222-222222222222';
    let published: string | null = null;
    deps.run = async (...args) => {
      const cmd = args[0];
      if (cmd.executable === 'git' && cmd.args[0] === 'show') return JSON.stringify({ ...manifest, targetBinding: { organizationId: id, userId: id }, platformIdentity: { tenantId: id, username: 'maker@example.com', environmentId: id },
        targetComponents: [{ key: 'agent', kind: 'copilot', logicalName: 'expense_assistant' }], postDeployActions: [{ id: 'publish-agent', type: 'copilot-publish', component: 'agent' }] });
      if (cmd.executable === 'pac' && cmd.args[0] === 'org') return `Org ID: ${id}\nUser ID: ${id}\nOrg URL: ${target}\nEnvironment ID: ${id}\nUser Email: maker@example.com`;
      if (cmd.executable === 'pac' && cmd.args[0] === 'copilot') { expect(cmd.args).toContain(target); expect(cmd.args).toContain(id); published = new Date().toISOString(); }
      if (cmd.executable === 'dataverse') {
        if (cmd.args[0] === 'auth') return `Tenant: ${id}\nUser: maker@example.com\nEnvironment: ${target}`;
        const resource = cmd.args[cmd.args.indexOf('--path') + 1];
        if (resource.endsWith('WhoAmI')) return JSON.stringify({ OrganizationId: id, UserId: id });
        if (resource.includes('/solutioncomponents?')) return JSON.stringify({ value: [{ objectid: id, componenttype: 10030 }] });
        if (resource.includes('/solutions?')) return JSON.stringify({ value: [{ solutionid: solutionId }] });
        if (resource.includes('/bots?')) return JSON.stringify({ value: [{ botid: id }] });
        return JSON.stringify({ statecode: 0, statuscode: 1, publishedon: published });
      }
      const output = await original(...args);
      if (cmd.executable === 'verify') {
        const file = args[2].SWARM_DELIVERY_REPORT; const report = JSON.parse(await fs.readFile(file, 'utf8'));
        report.appUrls = [plan.verification.baseUrl]; await fs.writeFile(file, JSON.stringify(report));
      }
      return output;
    };
    const kinds = ['grounding', 'authorization', 'tool-action', 'fallback', 'safety', 'multi-turn'];
    const scenarios = plan.verification.scenarios.map((scenario) => ({ ...scenario, steps: [{ action: 'fill', selector: '#prompt', value: 'Synthetic question' }, ...scenario.steps,
      { action: 'fill', selector: '#prompt', value: 'Follow-up' }, { action: 'text', selector: '#reply', contains: 'Expected follow-up' }] }));
    const release = await service.createRelease(repo, { ...plan, verification: { ...plan.verification, scenarios, copilotChecks: [{ component: 'agent', channelUrl: plan.verification.baseUrl, cases: kinds.map((kind, i) => ({ kind, scenario: scenarios[i].name })) }] } });
    await service.approveRelease(release.id, 'sherlock', release.planHash);
    await service.start(repo, false, release.id); await service.waitForIdle();
    const run = service.view().runs[0]; expect(run.phase).toBe('reviewing');
    expect(calls.filter((call) => call.startsWith('pac copilot publish'))).toHaveLength(1);
    expect(run.operations?.find((op) => op.id === 'typed:publish-agent')?.status).toBe('verified');
    const evidence = JSON.parse(await fs.readFile(path.join(root, 'delivery-runs', run.id, 'evidence', 'copilot-verification.json'), 'utf8'));
    expect(evidence.mapping[0].id).toBe(id); expect(evidence.checks[0].cases).toHaveLength(6);
    expect(run.appUrls).toContain(plan.verification.baseUrl);
  });
  it.each(['owned','replaced'] as const)('runs a mapped cloud-flow release with %s office ownership', async ownership => {
    const { service, repo, deps, root,calls } = await fixture(); const original = deps.run;
    const id = '11111111-1111-4111-8111-111111111111', solutionId = '22222222-2222-4222-8222-222222222222';
    const referenceId = '33333333-3333-4333-8333-333333333333';
    const targetManifest = { ...manifest, targetBinding: { organizationId: id, userId: id }, platformIdentity: { tenantId: id, username: 'maker@example.com', environmentId: id },
      targetComponents: [{ key: 'approval', kind: 'cloud-flow', logicalName: 'expense_approval' }, { key: 'dataverse', kind: 'connection-reference', logicalName: 'exp_dataverse' }],
      postDeployActions: [{ id: 'activate', type: 'cloud-flow-state', component: 'approval', state: 'active' }, { id: 'binding', type: 'connection-reference-check', component: 'dataverse', connectionId: 'approved', connectorId: 'dataverse-connector' }] };
    let correlatedRunId = ''; let active = false; let referenceChecked = false;
    const flow = { close: vi.fn(async () => {}), call: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'whoami') {
        if(ownership==='replaced'){
          const file=path.join(root,'delivery.lock');const successor=JSON.parse(await fs.readFile(file,'utf8'));successor.token=crypto.randomUUID();await fs.writeFile(file,JSON.stringify(successor));
        }
        return { azIdentity: { tenantId: id, user: 'maker@example.com' }, tokenIdentity: { tenantId: id, username: 'maker@example.com' }, effectiveConnectivityIdentity: { tenantId: id, username: 'maker@example.com' }, identityMismatch: false, connectivityIdentityMismatch: false };
      }
      expect(args.env).toBe(id);
      if (tool === 'get_flow_context') return { workflowId: id, inSolution: true, solutionUniqueName: 'Active', isManaged: false, category: 5, warning: null };
      if (tool === 'get_flow') return args.path === 'properties' ? { definition: {}, connectionReferences: {} } : args.path === 'properties.connectionReferences' ? { dataverse: { connectionName: 'approved', connectionReferenceLogicalName: 'exp_dataverse', id: 'dataverse-connector' } } : active ? 'Started' : 'Stopped';
      if (tool === 'preflight_flow') return { overall: 'ready' };
      if (tool === 'publish_flow') { expect(referenceChecked).toBe(true); active = true; return { success: true }; }
      if (tool === 'get_run_history') return [{ name: 'observed-test-run', status: 'Succeeded', startTime: new Date().toISOString() }];
      if (tool === 'get_run_action_content') return { content: { body: { releaseId: correlatedRunId, saved: true } } };
      throw new Error(`Unexpected tool ${tool}`);
    }) };
    deps.flow = async () => flow;
    deps.run = async (...args) => {
      const cmd = args[0];
      if (cmd.executable === 'git' && cmd.args[0] === 'show') return JSON.stringify(targetManifest);
      if (cmd.executable === 'pac' && cmd.args[0] === 'org') return `Org ID: ${id}\nUser ID: ${id}\nOrg URL: ${target}\nEnvironment ID: ${id}\nUser Email: maker@example.com`;
      if (cmd.executable === 'dataverse') {
        if (cmd.args[0] === 'auth') return `Tenant: ${id}\nUser: maker@example.com\nEnvironment: ${target}`;
        const resource = cmd.args[cmd.args.indexOf('--path') + 1];
        if (resource.endsWith('WhoAmI')) return JSON.stringify({ OrganizationId: id, UserId: id });
        if (resource.includes('/solutioncomponents?')) return JSON.stringify({ value: [{ objectid: id, componenttype: 29 }, { objectid: referenceId, componenttype: 10039 }] });
        if (resource.includes('/solutions?')) return JSON.stringify({ value: [{ solutionid: solutionId }] });
        if (resource.includes('/connectionreferences?')) return JSON.stringify({ value: [{ connectionreferenceid: referenceId }] });
        if (resource.includes('/connectionreferences(')) { referenceChecked = true; return JSON.stringify({ connectionid: 'approved', connectorid: 'dataverse-connector', statecode: 0 }); }
        return JSON.stringify({ value: [{ workflowid: id }] });
      }
      if (cmd.executable === 'verify') correlatedRunId = args[2].SWARM_DELIVERY_RUN_ID;
      return original(...args);
    };
    const release = await service.createRelease(repo, { ...plan, verification: { ...plan.verification, cloudFlowChecks: [{ component: 'approval', action: 'Audit', correlationPointer: ['body', 'releaseId'], assertions: [{ pointer: ['body', 'saved'], equals: true }] }] } });
    await service.approveRelease(release.id, 'sherlock', release.planHash);
    const warn=ownership==='replaced'?vi.spyOn(console,'warn').mockImplementation(()=>{}):undefined;
    try{await service.start(repo, false, release.id); await service.waitForIdle();}finally{warn?.mockRestore();}
    if(ownership==='replaced'){
      expect(()=>service.view()).toThrow('ownership lost');expect(flow.call).toHaveBeenCalledOnce();expect(flow.call.mock.calls[0][0]).toBe('whoami');expect(flow.close).toHaveBeenCalledOnce();
      expect(calls.some(call=>call.startsWith('pac solution import'))).toBe(false);
      await expect(service.close()).rejects.toThrow('ownership lost');services.splice(services.indexOf(service),1);return;
    }
    const run = service.view().runs[0]; expect(run.phase).toBe('reviewing'); expect(flow.close).toHaveBeenCalledOnce();
    expect(run.operations?.find((operation) => operation.id === 'typed:binding')?.status).toBe('verified');
    const evidence = path.join(root, 'delivery-runs', run.id, 'evidence');
    expect(JSON.parse(await fs.readFile(path.join(evidence, 'platform-authentication.json'), 'utf8')).providers).toContain('flowagent');
    expect(JSON.parse(await fs.readFile(path.join(evidence, 'cloud-flow-verification.json'), 'utf8')).observations[0].correlationId).toBe(run.id);
  });
  it('resumes typed post-deployment reconciliation without another import or activation', async () => {
    const { service, repo, deps, calls, root } = await fixture(); const original = deps.run;
    const id = '11111111-1111-4111-8111-111111111111';
    const solutionId = '22222222-2222-4222-8222-222222222222';
    let active = false; let writes = 0;
    deps.run = async (...args) => {
      const cmd = args[0];
      if (cmd.executable === 'git' && cmd.args[0] === 'show') return JSON.stringify({ ...manifest,
        targetBinding: { organizationId: id, userId: id }, targetComponents: [{ key: 'approval', kind: 'workflow', logicalName: 'expense_approval' }],
        postDeployActions: [{ id: 'activate', type: 'workflow-state', component: 'approval', state: 'active' }] });
      if (cmd.executable === 'dataverse') {
        expect(cmd.args).toContain(target);
        const resource = cmd.args[cmd.args.indexOf('--path') + 1];
        if (cmd.args.includes('PATCH')) { writes++; active = true; throw new Error('Activation response lost'); }
        if (resource.endsWith('WhoAmI')) return JSON.stringify({ OrganizationId: id, UserId: id });
        if (resource.includes('/solutioncomponents?')) return JSON.stringify({ value: [{ objectid: id, componenttype: 29 }] });
        if (resource.includes('/solutions?')) return JSON.stringify({ value: [{ solutionid: solutionId }] });
        if (resource.includes('/workflows?')) return JSON.stringify({ value: [{ workflowid: id }] });
        return JSON.stringify({ category: 0, type: 1, statecode: active ? 1 : 0, statuscode: active ? 2 : 1 });
      }
      return original(...args);
    };
    await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].checkpoint).toBe('post-started');
    expect(service.view().runs[0].phase).toBe('blocked');
    await service.start(repo, true); await service.waitForIdle();
    const run = service.view().runs[0];
    expect(run.phase).toBe('reviewing'); expect(writes).toBe(1);
    expect(calls.filter((c) => c.includes('solution import'))).toHaveLength(1);
    expect(run.operations?.find((op) => op.id === 'typed:activate')?.status).toBe('verified');
    expect(JSON.parse(await fs.readFile(path.join(root, 'delivery-runs', run.id, 'evidence', 'target-component-map.json'), 'utf8')).mapping[0].id).toBe(id);
  });
  it('rejects author approval and stale plan hashes', async () => {
    const { service, release, repo } = await fixture();
    await expect(service.approveRelease(release.id, 'ada', release.planHash)).rejects.toThrow('independent');
    await expect(service.approveRelease(release.id, 'sherlock', 'changed')).rejects.toThrow('exact');
    await expect(service.createRelease(repo, { ...plan, qaOwner: 'ada' })).rejects.toThrow('different');
  });
  it('persists missing-plan blockers and notifies only on change', async () => {
    const { service, repo, root } = await fixture(); const changed = vi.fn(); service.onChange = changed;
    await service.tick([{ ...repo, id: 'owner/other' }]); await service.tick([{ ...repo, id: 'owner/other' }]);
    expect(changed).toHaveBeenCalledTimes(1); expect(service.view().blockers[0].owner).toBe('CEO');
    expect(JSON.parse(await fs.readFile(path.join(root, 'delivery.json'), 'utf8')).blockers).toHaveLength(1);
  });
  it('rejects a second process sharing the same state', async () => { const { root, deps } = await fixture(); await expect(new DeliveryService(root, false, deps).init()).rejects.toThrow('lease'); });
  it('blocks a required open issue before import', async () => {
    const { service, repo, deps, calls } = await fixture(); const original = deps.run;
    deps.run = async (...args) => args[0].executable === 'gh' ? '{"state":"OPEN"}' : original(...args);
    await expect(service.start(repo)).rejects.toThrow('Required issue #1'); expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  it('records missing manifest failures before importing', async () => {
    const { service, repo, deps, calls } = await fixture(); const original = deps.run;
    deps.run = async (...args) => { if (args[0].args[0] === 'show') throw new Error('Manifest is missing'); return original(...args); };
    await service.tick([repo]); expect(service.view().blockers[0].error).toBe('Manifest is missing'); expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  for (const checkpoint of ['import-started', 'post-started', 'deployed'] as const) it(`recovers ${checkpoint} without a duplicate import`, async () => {
    const { service, repo, root, deps, calls } = await fixture(); await service.start(repo); await service.waitForIdle(); await service.close();
    const file = path.join(root, 'delivery.json'); const state = JSON.parse(await fs.readFile(file, 'utf8')); state.runs[0].phase = 'deploying'; state.runs[0].checkpoint = checkpoint; await fs.writeFile(file, JSON.stringify(state));
    const resumed = new DeliveryService(root, false, deps); services.push(resumed); await resumed.init(); resumed.checkCapabilities = service.checkCapabilities;
    expect(resumed.view().runs[0].recoveryRequired).toBe(true); const before = calls.length; await resumed.start(repo, true); await resumed.waitForIdle();
    expect(calls.slice(before).some((c) => c.includes('solution import'))).toBe(false); expect(resumed.view().runs[0].phase).toBe(checkpoint === 'deployed' ? 'reviewing' : 'blocked');
    if (checkpoint !== 'deployed') expect(resumed.view().runs[0].error).toContain('ambiguous');
  });
  it('retrying failed independent verification skips successful import', async () => {
    const { service, repo, calls } = await fixture('independent'); await service.start(repo); await service.waitForIdle(); await service.start(repo, true); await service.waitForIdle();
    expect(calls.filter((c) => c.includes('solution import'))).toHaveLength(1); expect(service.view().runs).toHaveLength(1);
  });
  it('persists uncertain import intent and refuses to replay after a lost response', async () => {
    const { service, repo, deps, calls, root } = await fixture(); const original = deps.run;
    deps.run = async (...args) => { if (args[0].executable === 'pac' && args[0].args[1] === 'import') { await original(...args); throw new Error('Import response lost'); } return original(...args); };
    await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].operations?.[0].status).toBe('unknown');
    const persisted = JSON.parse(await fs.readFile(path.join(root, 'delivery.json'), 'utf8'));
    expect(persisted.runs[0].operations[0].commandSha256).toMatch(/^[a-f0-9]{64}$/);
    await service.start(repo, true); await service.waitForIdle();
    expect(calls.filter((call) => call.includes('solution import'))).toHaveLength(1);
    expect(service.view().runs[0].error).toContain('ambiguous');
  });
});

describe('Quality, recovery and monitoring', () => {
  const review = (hash: string) => ({ evidenceHash: hash, scores: [4, 5, 4, 5, 4], notes: 'Inspected every viewport and UI state, keyboard task, accessibility report and data-preserving recovery rehearsal.', recoveryReviewed: true });
  it('requires separate visual approval and rejects author approval or altered evidence', async () => {
    const { service, repo, root } = await fixture(); await service.start(repo); await service.waitForIdle();
    const run = service.view().runs[0]; expect(run.phase).toBe('reviewing');
    await expect(service.approveVisual(run.id, 'ada', review(run.evidenceHash!))).rejects.toThrow('assigned QA');
    await fs.appendFile(path.join(root, 'delivery-runs', run.id, 'evidence', 'release.json'), ' ');
    await expect(service.approveVisual(run.id, 'sherlock', review(run.evidenceHash!))).rejects.toThrow('Evidence changed');
  });
  it('blocks before import when capabilities are unavailable', async () => {
    const { service, repo, calls } = await fixture();
    service.checkCapabilities = async () => ({ status: 'blocked', checks: [{ id: 'licence', category: 'licence', passed: false, remedy: 'Assign the required licence' }] });
    await expect(service.start(repo)).rejects.toThrow('licence');
    expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  it('requires a recovery rehearsal against a separate environment before importing', async () => {
    const { service, repo, calls, deps } = await fixture(); const original = deps.run;
    deps.run = async (...args) => { const result = await original(...args); if (args[0].executable === 'build') { const file = path.join(args[1], 'recovery.json'); const report = JSON.parse(await fs.readFile(file, 'utf8')); report.environmentUrl = target; await fs.writeFile(file, JSON.stringify(report)); } return result; };
    await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].error).toContain('separate authorized');
    expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  it('rejects a recovery receipt with changed protected data', async () => {
    const { service, repo, calls, deps } = await fixture(); const original = deps.run;
    deps.run = async (...args) => { const result = await original(...args); if (args[0].executable === 'build') { const file = path.join(args[1], 'recovery.json'); const report = JSON.parse(await fs.readFile(file, 'utf8')); report.protectedRecords[0].afterSha256 = 'c'.repeat(64); await fs.writeFile(file, JSON.stringify(report)); } return result; };
    await service.start(repo); await service.waitForIdle();
    expect(service.view().runs[0].error).toContain('preserve every protected record');
    expect(calls.some((c) => c.includes('solution import'))).toBe(false);
  });
  it('monitors read-only health, detects configuration drift and deduplicates unchanged alerts', async () => {
    const { service, repo, calls } = await fixture(); await service.start(repo); await service.waitForIdle();
    const run = service.view().runs[0]; await service.approveVisual(run.id, 'sherlock', review(run.evidenceHash!));
    const before = calls.length; const approvedFiles=[...run.evidence];await service.monitor(repo, run.id);
    expect(service.view().runs[0].health?.status).toBe('healthy');
    expect(calls.slice(before)).toContain(`git show ${run.head}:cubefarm.delivery.json`);
    expect(calls.slice(before).every((c) => c.includes('solution list')||c===`git show ${run.head}:cubefarm.delivery.json`)).toBe(true);
    expect(service.view().runs[0].evidence).toEqual(approvedFiles);
    expect(service.view().runs[0].health?.governanceEvidence).toMatch(/^health\/governance-\d+-health.json$/);
    service.checkCapabilities = async () => ({ status: 'ready', configHash: 'changed', checks: [{ id: 'critical-flow', category: 'workflow', passed: true, remedy: '' }] });
    await service.monitor(repo, run.id); expect(service.view().runs[0].health?.status).toBe('degraded');
    const changed = vi.fn(); service.onChange = changed; await service.monitor(repo, run.id); expect(changed).not.toHaveBeenCalled();
    expect(service.view().blockers[0].error).toContain('configuration drift');
  });
  it('retains the previous verified deployment and recovery artifacts', async () => {
    const { service, repo, release } = await fixture(); await service.start(repo); await service.waitForIdle();
    const first = service.view().runs[0]; await service.approveVisual(first.id, 'sherlock', review(first.evidenceHash!));
    const next = await service.createRelease(repo, { ...release.plan, name: 'Next release' }); await service.approveRelease(next.id, 'sherlock', next.planHash);
    await service.start(repo); await service.waitForIdle(); const second = service.view().runs[0];
    expect(second.previousRunId).toBe(first.id); expect(second.recovery?.packageSha256).toHaveLength(64);
    expect(second.evidence).toContain('previous-inventory.json'); expect(second.evidence).toContain('recovery-rehearsal.json');
  });
});
