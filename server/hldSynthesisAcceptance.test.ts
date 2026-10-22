import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {DeliveryRecord} from '../shared/deliveryRecord.ts';
import {afterEach,expect,it,vi} from 'vitest';
import {HldSynthesisService,type SynthesisDependencies} from './hldSynthesis.ts';
import {synthesisRequirements} from './synthesisTraceability.ts';
import type {SessionCallbacks,SessionOptions} from './agentRunner.ts';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0))await close();});
const input={solutionName:'Synthetic expense design',problemContext:'Capture GBP expenses with a receipt for each item.',components:[]};
const detail='Synthetic explicit design decision with independently observable acceptance evidence.';
const output={skillBindings:[{skillId:'dataverse:dv-metadata',sourceSha256:'a'.repeat(64),planStepIds:['data'],rationale:detail,toolStatus:'unverified' as const}],summary:detail,architecture:detail,dataModel:detail,securityAndGovernance:detail,operationsAndRecovery:detail,decisions:[{decision:detail,rationale:detail,alternatives:detail}],risks:[{risk:detail,mitigation:detail}],requirements:synthesisRequirements(input).map(source=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['data'],requirement:detail,design:detail,acceptance:detail})),missingEvidence:['Tenant validation remains unavailable.'],implementationPlan:['data','app','verify'].map(id=>({id,title:id,deliverables:['Synthetic artifact'],acceptance:[detail]})),mermaidDiagrams:{topology:'flowchart LR\n A-->B',erd:'erDiagram\n REPORT ||--o{ ITEM : contains',sequence:'sequenceDiagram\n A->>B: Submit'}};
async function fixture(admission:SynthesisDependencies['admission']=async()=>null){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hld-synthesis-')),checkout=path.join(root,'repo');await fs.mkdir(checkout);
  let fingerprint='original';let callbacks!:SessionCallbacks;
  const stop=vi.fn(),start=vi.fn((_options:SessionOptions,cb:SessionCallbacks)=>{callbacks=cb;return {stop,send:vi.fn()};});
  const lease={running:vi.fn(),stopping:vi.fn(),release:vi.fn()};
  const deps:SynthesisDependencies={reserve:()=>lease,assertOpen:()=>{},context:()=>({checkoutPath:checkout,fingerprint,copilotPaused:true,skills:[{id:'dataverse:dv-metadata',sha256:'a'.repeat(64),toolStatus:'unverified'}]}),admission,start};
  const service=new HldSynthesisService(root,deps);await service.init();
  cleanup.push(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
  return {service,root,checkout,start,stop,deps,lease,get callbacks(){return callbacks;},change:()=>{fingerprint='changed';}};
}
const success=(structured:unknown=output)=>({ok:true,text:'',structured,costUsd:0.01,turns:1,errors:[]});
it('does not append excluded work or blanket schema revalidation to a scoped model draft', async () => {
  const f=await fixture(), scoped={...input,problemContext:'Dedicated schema has authenticated readback. DLP is excluded by the user. Canvas authoring remains blocked.'};
  const job=await f.service.start('synthetic/project',scoped); await vi.waitFor(()=>expect(f.start).toHaveBeenCalledOnce());
  const options=f.start.mock.calls[0][0];
  expect(options.effort).toBe('low');expect(options.noTools).toBe(true);
  expect(options.systemAppend).toContain('Respect explicit scope exclusions');
  expect(options.systemAppend).not.toContain('DLP and schema gates');
  const missing=['A working native Canvas authoring session remains required.'];
  f.callbacks.finished(success({...output,requirements:synthesisRequirements(scoped).map(source=>({requirementId:source.id,sourceSha256:source.sourceSha256,planStepIds:['data'],requirement:detail,design:detail,acceptance:detail})),missingEvidence:missing}));
  await vi.waitFor(()=>expect(f.service.view('synthetic/project',job.id)[0].status).toBe('completed'));
  const artifact=await f.service.result('synthetic/project',job.id);
  expect(artifact.result.missingEvidence).toContain(missing[0]);
  expect(artifact.result.missingEvidence.join(' ')).not.toMatch(/DLP|live tenant schema/);
  expect(artifact.result.markdownContent).toContain('This draft does not grant architecture approval, deployment approval or runtime acceptance.');
  expect(artifact.result.status).toBe('draft');
});
it.each(['nan-cost', 'infinite-cost', 'negative-cost', 'fractional-turns', 'negative-turns', 'infinite-turns'] as const)('refuses malformed %s native usage without publishing or counting a successful synthesis', async mode => {
  const f = await fixture(), job = await f.service.start('synthetic/project', input); await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const result = success(); if (mode.endsWith('cost')) result.costUsd = mode === 'nan-cost' ? NaN : mode === 'infinite-cost' ? Infinity : -1;
  else result.turns = mode === 'fractional-turns' ? 1.5 : mode === 'negative-turns' ? -1 : Infinity;
  f.callbacks.finished(result); await vi.waitFor(() => expect(f.service.view('synthetic/project', job.id)[0].status).toBe('failed'));
  expect(f.service.view('synthetic/project', job.id)[0].error).toContain('invalid usage telemetry'); expect(f.service.summary('synthetic/project').successfulDurationMs.count).toBe(0); expect(await fs.readdir(f.checkout)).toEqual([]); expect(f.lease.release).toHaveBeenCalledOnce();
});
it.each(['requirements-bound', 'connector-safeguard', 'reservation-failure'] as const)('denies %s before native model dispatch or publication', async mode => {
  const f = await fixture(), reserve = vi.spyOn(f.deps, 'reserve'), before = await fs.readFile(path.join(f.root, 'architecture-synthesis.json'), 'utf8');
  const requirements = mode === 'requirements-bound' ? { ...input, components: Array.from({ length: 10 }, () => ({ role: 'Maker', badge: 'Canvas', title: 'x'.repeat(8000), details: 'x'.repeat(8000), deliverables: [] })) } : mode === 'connector-safeguard' ? { ...input, problemContext: 'Send enterprise records to shared_dropbox' } : input;
  if (mode === 'reservation-failure') reserve.mockImplementation(() => { throw new Error('Synthetic capacity unavailable'); });
  await expect(f.service.start('synthetic/project', requirements)).rejects.toThrow(mode === 'requirements-bound' ? 'exceed their bound' : mode === 'connector-safeguard' ? 'local connector safeguard' : 'capacity unavailable');
  expect(f.start).not.toHaveBeenCalled(); expect(await fs.readFile(path.join(f.root, 'architecture-synthesis.json'), 'utf8')).toBe(before); expect(f.service.view('synthetic/project')).toEqual([]);
});
it.each(['oversized-output', 'connector-output', 'native-failure', 'native-empty-failure'] as const)('keeps %s outside accepted draft publication', async mode => {
  const f = await fixture(), job = await f.service.start('synthetic/project', input); await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const result = mode === 'oversized-output' ? success({ ...output, summary: 'x'.repeat(2 * 1024 * 1024) }) : mode === 'connector-output' ? success({ ...output, summary: 'Use shared_dropbox for all enterprise documents' }) : { ...success(), ok: false, errors: mode === 'native-failure' ? ['Synthetic runtime crashed'] : [] };
  f.callbacks.finished(result); await vi.waitFor(() => expect(f.service.view('synthetic/project', job.id)[0].status).toBe('failed'));
  expect(f.service.view('synthetic/project', job.id)[0].error).toContain(mode === 'oversized-output' ? 'oversized structured output' : mode === 'connector-output' ? 'local connector safeguard' : mode === 'native-failure' ? 'Synthetic runtime crashed' : 'no successful response'); expect(await fs.readdir(f.checkout)).toEqual([]);
});
it('retains a useful draft when no installed skill guidance exists without inventing a verified tool binding', async () => {
  const f = await fixture(), current = f.deps.context; f.deps.context = id => ({ ...current(id), skills: [] });
  const job = await f.service.start('synthetic/project', input); await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce()); f.callbacks.finished(success({ ...output, skillBindings: [] }));
  await vi.waitFor(() => expect(f.service.view('synthetic/project', job.id)[0].status).toBe('completed')); const artifact = await f.service.result('synthetic/project', job.id); expect(artifact.result.markdownContent).toContain('No selected installed skill guidance is available');
  expect(artifact.result.markdownContent).toContain('tool/tenant readiness remains unverified'); expect(() => f.service.view('foreign/project', job.id)).toThrow('outside this project');
});
it('ignores empty or terminal runtime progress and rejects reopening closed synthesis authority', async () => {
  const f = await fixture(), job = await f.service.start('synthetic/project', input); await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  const count = f.service.view('synthetic/project', job.id)[0].events.length; f.callbacks.log([]); expect(f.service.view('synthetic/project', job.id)[0].events).toHaveLength(count);
  f.callbacks.log([{ kind: 'error', text: 'Synthetic transient observation' }]); expect(f.service.view('synthetic/project', job.id)[0].events.at(-1)?.kind).toBe('error'); f.callbacks.tool(null); f.callbacks.sessionId(null); f.callbacks.browserUrl('http://synthetic'); f.callbacks.screenshot(Buffer.from('synthetic'), 'image/png');
  f.callbacks.finished(success()); await vi.waitFor(() => expect(f.service.view('synthetic/project', job.id)[0].status).toBe('completed')); const completed = f.service.view('synthetic/project', job.id)[0];
  f.callbacks.log([{ kind: 'error', text: 'Late ignored' }]); f.service.cancel('synthetic/project', job.id); expect(f.service.view('synthetic/project', job.id)[0]).toEqual(completed);
  await f.service.close(); await expect(f.service.start('synthetic/project', input)).rejects.toThrow('closed'); await expect(f.service.result('synthetic/project', job.id)).rejects.toThrow('closed');
});
it.each(['unchanged', 'changed'] as const)('binds the published draft to %s explicitly captured local evidence', async mode => {
  const f = await fixture(), evidence = path.join(f.root, 'observed-contract.md'), text = '# Synthetic observed contract\nThe request has an explicit version field.';
  await fs.writeFile(evidence, text); const reference = { reference: evidence, sha256: crypto.createHash('sha256').update(text).digest('hex'), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const record = { id: crypto.randomUUID(), repoId: 'synthetic/project', revision: 1, sha256: 'b'.repeat(64), content: { requirements: [{ id: 'observed', description: 'Preserve the versioned contract', acceptance: 'Fresh reads show the explicit version' }], findings: [{ evidence: [reference] }] } } as unknown as DeliveryRecord;
  const original = f.deps.context; f.deps.context = id => ({ ...original(id), evidenceRoots: [f.root], discoveryRecord: record });
  const job = await f.service.start('synthetic/project', input); await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  expect(f.start.mock.calls[0][0].prompt).toContain('The request has an explicit version field.');
  if (mode === 'changed') await fs.appendFile(evidence, '\nChanged after model admission');
  f.callbacks.finished(success({ ...output, requirements: synthesisRequirements(input, record).map(source => ({ ...output.requirements[0], requirementId: source.id, sourceSha256: source.sourceSha256 })) }));
  await vi.waitFor(() => expect(f.service.view('synthetic/project', job.id)[0].status).toBe(mode === 'changed' ? 'failed' : 'completed'));
  if (mode === 'changed') { expect(f.service.view('synthetic/project', job.id)[0].error).toContain('evidence changed during synthesis'); expect(await fs.readdir(f.checkout)).toEqual([]); }
  else { const artifact = await f.service.result('synthetic/project', job.id); expect(artifact.result.deliveryRecord).toEqual({ id: record.id, revision: record.revision, sha256: record.sha256 }); expect(artifact.result.markdownContent).toContain('Captured local evidence (source data, not live assurance)'); }
});
it('restores interrupted legacy planning as blocked and refuses duplicate persisted job identities', async () => {
  const f = await fixture(); await f.service.close(); const file = path.join(f.root, 'architecture-synthesis.json'), id = crypto.randomUUID(), now = Date.now();
  const row = { id, repoId: 'synthetic/project', status: 'running', runtime: 'codex-cli', startedAt: now, deadlineMs: 300000, events: [], costUsd: 0, turns: 0 };
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, jobs: [row] })); const restored = new HldSynthesisService(f.root, f.deps);
  try { await restored.init(); expect(restored.view('synthetic/project', id)[0]).toMatchObject({ status: 'blocked', error: expect.stringContaining('Office restarted') }); expect(f.start).not.toHaveBeenCalled(); }
  finally { await restored.close(); }
  const duplicate = JSON.stringify({ schemaVersion: 1, jobs: [{ ...row, status: 'blocked' }, { ...row, status: 'blocked' }] }); await fs.writeFile(file, duplicate); const corrupt = new HldSynthesisService(f.root, f.deps);
  try { await expect(corrupt.init()).rejects.toThrow('Duplicate architecture'); expect(await fs.readFile(file, 'utf8')).toBe(duplicate); }
  finally { await corrupt.close(); }
});
