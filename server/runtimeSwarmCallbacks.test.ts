import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Backend } from './backend.ts';
import type { SessionCallbacks } from './agentRunner.ts';
import type { SessionOptions } from './agentRunner.ts';
import type { PullInfo } from '../shared/types.ts';

vi.mock('./config.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./config.ts')>();
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-runtime-callbacks-'));
  return {...real, HOME_DIR: root, STATE_FILE: path.join(root, 'state.json'), WORKSPACE_ROOT: path.join(root, 'workspaces')};
});
import { HOME_DIR, STATE_FILE } from './config.ts';
import { Swarm } from './swarm.ts';
import type {SessionResult} from './agentRunner.ts';

const offices: Swarm[] = [];
const issue = {number: 1, title: 'Build synthetic feature', body: 'Test only', url: 'https://example.test/issues/1', labels: [], assignees: []};
function backend() {
  const external = {
    demo: false, terminals: false,
    listMyRepos:vi.fn<Backend['listMyRepos']>(async()=>[]),
    repoMeta:vi.fn<Backend['repoMeta']>(async()=>({nameWithOwner:'synthetic/new',description:'Synthetic',url:'https://example.test/repo',defaultBranch:'main'})),
    scanProjects:vi.fn<Backend['scanProjects']>(async()=>[]),
    inspectFolder:vi.fn<Backend['inspectFolder']>(async()=>{throw new Error('Unexpected folder inspection');}),
    publishFolder:vi.fn<Backend['publishFolder']>(async()=>{throw new Error('Unexpected folder publication');}),
    createProject:vi.fn<Backend['createProject']>(async()=>{throw new Error('Unexpected repository creation');}),
    createIssue:vi.fn<Backend['createIssue']>(async()=>{throw new Error('Unexpected issue creation');}),
    closePull:vi.fn<Backend['closePull']>(async()=>{}),
    tenancy:{info:vi.fn<Backend['tenancy']['info']>(async()=>({tenantName:'',tenantDomain:'',tenantId:'',user:'',environments:[],isReal:false,status:'disconnected'}))},
    user: vi.fn(async () => 'synthetic-user'), reconnectClis: vi.fn<Backend['reconnectClis']>(async () => []), hooksReady: vi.fn(),
    detectClis: vi.fn(async () => []), releaseClis: vi.fn(async () => {}),
    setLocalPath: vi.fn(), ensureClone: vi.fn(async () => {}), releaseDesk: vi.fn(async () => {}), removeDesk: vi.fn(async () => {}),
    listIssues: vi.fn(async () => [issue]), listPulls: vi.fn(async (): Promise<PullInfo[]> => []), syncMain: vi.fn(async () => null),
    prDetails: vi.fn<Backend['prDetails']>(async () => ({...pull,body:'Synthetic',isCrossRepository:false})),
    commentPull: vi.fn<Backend['commentPull']>(async () => 'https://example.test/comment'), mergePull: vi.fn(async () => {}),
    prFiles: vi.fn<Backend['prFiles']>(async () => []),
    prForBranch: vi.fn<Backend['prForBranch']>(async () => null),
    issueState:vi.fn<Backend['issueState']>(async()=> 'CLOSED'),editIssue:vi.fn<Backend['editIssue']>(async()=>{}),
    uploadEvidence: vi.fn<Backend['uploadEvidence']>(async () => 'https://example.test/evidence'),
    mainDir: () => HOME_DIR, deskDir: () => HOME_DIR, prepareDesk: vi.fn<Backend['prepareDesk']>(async () => HOME_DIR),
    startSession: vi.fn((_opts: unknown, _cb: SessionCallbacks) => ({stop: vi.fn(), send: vi.fn()})),
    previews: {hasDefault: vi.fn(async () => false), start: vi.fn(() => {throw new Error('Unexpected preview execution');})},
    office: {head: vi.fn(async () => null), takeLastUpdate: vi.fn(async () => null), isOwnFolder: () => false},
  };
  return external;
}
async function office(withRepo = false, configure?: (fake: ReturnType<typeof backend>) => void) {
  const persisted = {version: 2, settings: {runtime: 'sdk', ceoHeartbeatMin: 0},
    repos: withRepo ? [{id: 'synthetic/repo', fullName: 'synthetic/repo', defaultBranch: 'main', floor: 1, color: '#000', description: '', url: '', autoAssign: false, autoMerge: false, browserTesting: false, addedAt: 1}] : []};
  await fs.writeFile(STATE_FILE, JSON.stringify(persisted));
  const fake = backend(); configure?.(fake); const swarm = new Swarm(fake as unknown as Backend); offices.push(swarm);
  swarm.capabilityPreflight = vi.fn(async () => null); // explicitly approved synthetic readiness
  await swarm.init(); return {swarm, fake};
}

beforeEach(()=>vi.useFakeTimers());
afterEach(async()=>{vi.useRealTimers();await Promise.all(offices.splice(0).map(swarm=>swarm.shutdown().catch(()=>{})));for(const entry of await fs.readdir(HOME_DIR))await fs.rm(path.join(HOME_DIR,entry),{recursive:true,force:true,maxRetries:10});});
afterAll(async()=>fs.rm(HOME_DIR,{recursive:true,force:true,maxRetries:10}));
const pull:PullInfo={number:7,title:'Synthetic PR',url:'https://github.com/synthetic/repo/pull/7',headRefName:'swarm/issue-1-synthetic',headSha:'tested-head',state:'OPEN',isDraft:false,mergeable:'MERGEABLE',mergeState:'CLEAN',checks:'passing',failedChecks:[],pendingChecks:[],closesIssues:[],createdAt:'',mergedAt:null,additions:1,deletions:0,reviewDecision:null};
const passReport={verdict:'pass',summary:'Observed synthetic acceptance',checks:[{name:'API',result:'pass',details:'Observed expected output'}],commands:[{command:'synthetic verifier',result:'passed'}],screenshots:[]};
const result=(extra:Partial<SessionResult>={}):SessionResult=>({ok:true,text:'',costUsd:0,turns:1,errors:[],...extra});
async function startDeveloper(cli:'codex'|'gemini'|'opencode'='codex',defaultOpenCode=false){const fixture=await office(true,fake=>{fake.terminals=true;fake.listPulls.mockResolvedValue([pull]);fake.prDetails.mockResolvedValue({...pull,body:'Synthetic requirements',isCrossRepository:false});});if(defaultOpenCode)fixture.swarm.updateSettings({defaultCli:'opencode',defaultModel:'openai/gpt-synthetic'});const agent=fixture.swarm.hireAgent('synthetic/repo',{cli,model:cli==='opencode'?'openai/gpt-synthetic':''});await fixture.swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fixture.fake.startSession).toHaveBeenCalledOnce());return {...fixture,agent,callbacks:fixture.fake.startSession.mock.calls[0][1],options:fixture.fake.startSession.mock.calls[0][0] as SessionOptions};}
async function startQa(cli:'codex'|'opencode'='codex'){const fixture=await office(true,fake=>{fake.listPulls.mockResolvedValue([pull]);fake.prDetails.mockResolvedValue({...pull,body:'Synthetic requirements',isCrossRepository:false});});if(cli==='opencode'){fixture.swarm.updateSettings({defaultCli:'opencode',defaultModel:'openai/gpt-synthetic'});const qa=fixture.swarm.snapshot().agents.find(agent=>agent.role==='qa')!;fixture.swarm.updateAgent(qa.id,{cli,model:'openai/gpt-synthetic'});}await fixture.swarm.sendToQa('synthetic/repo',7);await vi.advanceTimersByTimeAsync(200);await settle();if(!fixture.fake.startSession.mock.calls.length)throw new Error(JSON.stringify({qa:fixture.swarm.snapshot().qa,agents:fixture.swarm.snapshot().agents}));fixture.swarm.setDraining(true);return {...fixture,agent:fixture.swarm.snapshot().agents.find(agent=>agent.task==='qa')!,callbacks:fixture.fake.startSession.mock.calls[0][1],options:fixture.fake.startSession.mock.calls[0][0] as SessionOptions};}
const view=(swarm:Swarm,id:string)=>swarm.snapshot().agents.find(agent=>agent.id===id)!;
async function settle(){for(let i=0;i<60;i++)await Promise.resolve();}

it('records current-session telemetry once, retains only bounded screenshots, and clears the provider checkpoint explicitly',async()=>{
  const {swarm,agent,callbacks}=await startDeveloper();callbacks.log([{kind:'text',text:'Synthetic current task output'}]);callbacks.tool('Read');callbacks.tool('Read');callbacks.sessionId('checkpoint');callbacks.browserUrl('https://synthetic.invalid/task');for(let i=0;i<14;i++)callbacks.screenshot(Buffer.from('synthetic image '+i),'image/png');expect(view(swarm,agent.id)).toMatchObject({currentTool:'Read',browserUrl:'https://synthetic.invalid/task'});callbacks.sessionId(null);expect((swarm as unknown as {state:{agents:{id:string;sessionId:string|null}[]}}).state.agents.find(a=>a.id===agent.id)?.sessionId).toBeNull();callbacks.tool(null);expect(view(swarm,agent.id).currentTool).toBeNull();
  const internal=swarm as unknown as {agentRt:Map<string,{shots:{data:Buffer}[]}>};expect(internal.agentRt.get(agent.id)?.shots).toHaveLength(12);expect(internal.agentRt.get(agent.id)?.shots[0].data.toString()).toBe('synthetic image 2');await settle();
});

it.each(['stop','reset','replace','fire'] as const)('drops all task callbacks and late completion after %s',async action=>{
  const {swarm,fake,agent,callbacks}=await startDeveloper();if(action==='fire')await swarm.fireAgent(agent.id);else {swarm.stopAgent(agent.id);if(action==='reset')swarm.resetAgent(agent.id);if(action==='replace'){await swarm.assign(agent.id,1);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));}}
  const before=structuredClone(swarm.snapshot());callbacks.log([{kind:'text',text:'obsolete log'}]);callbacks.tool('obsolete');callbacks.sessionId('obsolete');callbacks.browserUrl('https://obsolete.invalid');callbacks.screenshot(Buffer.from('obsolete'),'image/png');callbacks.limited?.(Date.now()+60000);callbacks.usageWarning?.({rateLimitType:'obsolete',utilization:.95,resetsAt:Date.now()+60000});await callbacks.finished(result({text:pull.url,costUsd:99,turns:99}));expect(swarm.snapshot().agents).toEqual(before.agents);expect(swarm.snapshot().usage).toEqual(before.usage);expect(swarm.snapshot().qa).toEqual(before.qa);
});

it.each([true,false])('recognizes a repository-owned PR from successful=%s completion without accepting a different repository URL',async ok=>{
  const {swarm,agent,callbacks}=await startDeveloper();await callbacks.finished(result({ok,text:'Review https://github.com/synthetic/other/pull/99 then '+pull.url,errors:ok?[]:['Synthetic failure'],costUsd:.5,turns:3}));expect(view(swarm,agent.id)).toMatchObject({status:ok?'done':'error',prNumber:7,prUrl:pull.url,costUsd:.5,turns:3});expect(swarm.snapshot().qa).toHaveLength(1);if(!ok)expect(swarm.snapshot().qa[0].status).toBe('queued');
});

it('uses the actual branch lookup when no PR URL was returned and refuses a second duplicate completion',async()=>{
  const {swarm,fake,agent,callbacks}=await startDeveloper();fake.prForBranch.mockResolvedValue({number:7,url:pull.url});await callbacks.finished(result({text:'Work complete',costUsd:.25}));expect(fake.prForBranch).toHaveBeenCalledOnce();expect(view(swarm,agent.id)).toMatchObject({prNumber:7,status:'done',costUsd:.25});await callbacks.finished(result({text:pull.url,costUsd:10,turns:10}));expect(view(swarm,agent.id)).toMatchObject({costUsd:.25,turns:1});expect(swarm.snapshot().qa).toHaveLength(1);
});

it('contains completion-handler failure and exposes reconciliation instead of leaving a worker active',async()=>{
  const {swarm,agent,callbacks}=await startDeveloper();const manager=swarm as unknown as {onIssueFinished:()=>Promise<void>};vi.spyOn(manager,'onIssueFinished').mockRejectedValue(new Error('synthetic completion processing unavailable'));await callbacks.finished(result({text:'Synthetic output'}));expect(view(swarm,agent.id)).toMatchObject({status:'error',currentTool:null,lastError:expect.stringContaining('reconcile artifacts')});
});

it.each([false,true])('fails malformed QA cleanly without publishing and escalates a repeated session failure=%s',async repeated=>{
  const {swarm,fake,agent,callbacks}=await startQa();if(repeated)(swarm as unknown as {state:{qa:{sessionFailures:number}[]}}).state.qa[0].sessionFailures=1;await callbacks.finished(result({structured:{...passReport,screenshots:['unobserved image']}}));expect(view(swarm,agent.id).status).toBe('error');expect(swarm.snapshot().qa[0].status).toBe(repeated?'needs-human':'queued');expect(fake.commentPull).not.toHaveBeenCalled();
});

it('does not charge a quota pause to the PR QA failure budget',async()=>{
  const {swarm,callbacks}=await startQa();callbacks.limited?.(Date.now()+60000);await callbacks.finished(result({ok:false,errors:['Synthetic quota'],structured:undefined}));expect((swarm as unknown as {state:{qa:{status:string;sessionFailures:number}[]}}).state.qa[0]).toMatchObject({status:'queued',sessionFailures:0});
});

it.each(['pass','fail'] as const)('publishes complete %s QA evidence with escaped table content, exact captions and captured browser context',async verdict=>{
  const {swarm,fake,callbacks}=await startQa();callbacks.browserUrl('https://synthetic.invalid/screen');callbacks.screenshot(Buffer.from('synthetic image'),'image/jpeg');await callbacks.finished(result({structured:{...passReport,verdict,summary:'Observed synthetic output',checks:[{name:'Pipe | and newline\n',result:verdict,details:'details | safe'}],fixInstructions:verdict==='fail'?'Repair the observed API output':undefined,screenshots:['Observed "image"']}}));expect(swarm.snapshot().qa[0].status).toBe(verdict==='pass'?'passed':'failed');expect(fake.uploadEvidence).toHaveBeenCalledWith('synthetic/repo',expect.stringMatching(/01\.jpg$/),Buffer.from('synthetic image'));const body=fake.commentPull.mock.calls[0][2];expect(body).toContain('https://synthetic.invalid/screen');expect(body).toContain('Observed "image"');expect(body).toContain('Pipe \\| and newline');expect(body).toContain('synthetic verifier');if(verdict==='fail')expect(body).toContain('Repair the observed API output');await settle();
});

it.each(['upload','upload-receipt','comment','missing-receipt'] as const)('holds independent QA approval when required %s publication fails, without blaming code or charging an automatic retry',async mode=>{
  const {swarm,fake,callbacks}=await startQa();if(mode==='upload')fake.uploadEvidence.mockRejectedValue(new Error('Synthetic image upload denied'));if(mode==='upload-receipt')fake.uploadEvidence.mockResolvedValue('');if(mode==='comment')fake.commentPull.mockRejectedValue(new Error('Synthetic comment unavailable'));if(mode==='missing-receipt')fake.commentPull.mockResolvedValue('');callbacks.screenshot(Buffer.from('synthetic'),'image/png');await callbacks.finished(result({structured:{...passReport,screenshots:['Synthetic observed image']}}));expect(swarm.snapshot().qa[0]).toMatchObject({status:'needs-human',commentUrl:null});const rec=(swarm as unknown as {state:{qa:{passedSha:string|null;testedSha:string|null;sessionFailures:number;summary:string;checks:unknown[]}[]}}).state.qa[0];expect(rec).toMatchObject({passedSha:null,testedSha:'tested-head',sessionFailures:0,summary:passReport.summary,checks:passReport.checks});expect(fake.mergePull).not.toHaveBeenCalled();swarm.setDraining(false);await vi.advanceTimersByTimeAsync(31000);expect(fake.startSession).toHaveBeenCalledOnce();expect(fake.mergePull).not.toHaveBeenCalled();await settle();
});

it('does not publish approval for changed task authority after a delayed QA comment outcome',async()=>{
  const {swarm,fake,agent,callbacks}=await startQa();let scope='reviewed';swarm.deliveryTaskContract=()=>({owner:'developer',qaOwner:agent.id,components:['synthetic-component'],resources:[]});swarm.deliveryTaskFingerprint=()=>scope;(swarm as unknown as {state:{qa:{taskAuthorityHash?:string}[]}}).state.qa[0].taskAuthorityHash=scope;let reply!:(value:string)=>void;fake.commentPull.mockImplementation(()=>new Promise(resolve=>{reply=resolve;}));const pending=callbacks.finished(result({structured:passReport}));await settle();expect(reply).toBeTypeOf('function');scope='changed';reply('https://example.test/comment');await pending;expect(swarm.snapshot().qa[0].status).toBe('queued');expect((swarm as unknown as {state:{qa:{passedSha:string|null}[]}}).state.qa[0].passedSha).toBeNull();expect(fake.mergePull).not.toHaveBeenCalled();
});

it('posts only the retained evidence subset and uses its original caption numbers',async()=>{
  const {fake,callbacks}=await startQa();for(let i=0;i<12;i++)callbacks.screenshot(Buffer.from('image '+i),'image/png');await callbacks.finished(result({structured:{...passReport,screenshots:Array.from({length:12},(_,i)=>'Caption '+(i+1))}}));expect(fake.uploadEvidence).toHaveBeenCalledTimes(8);expect(fake.uploadEvidence.mock.calls[0][1]).toMatch(/05\.png$/);expect(fake.commentPull.mock.calls[0][2]).toContain('**5. Caption 5**');expect(fake.commentPull.mock.calls[0][2]).not.toContain('**1. Caption 1**');await settle();
});

it('escalates repeated genuine QA failures but excludes office-requested retests from the author repair-round budget',async()=>{
  const {swarm,callbacks}=await startQa();const rec=(swarm as unknown as {state:{qa:{round:number;retests:number}[]}}).state.qa[0];rec.round=6;rec.retests=0;await callbacks.finished(result({structured:{...passReport,verdict:'fail',checks:[{name:'Acceptance',result:'fail',details:'Observed mismatch'}]}}));expect(swarm.snapshot().qa[0].status).toBe('needs-human');
});

it.each(['scope','owner'] as const)('revokes tool authority when task %s changes after launch',async change=>{
  const {swarm,agent,options}=await startDeveloper();let fingerprint='reviewed',owner=agent.id;swarm.deliveryTaskFingerprint=()=>fingerprint;swarm.deliveryTaskContract=()=>({owner,qaOwner:'qa',components:['component'],resources:[]});expect(await options.authorizeTool!()).toContain('Delivery scope');if(change==='scope')fingerprint='different';else owner='another-worker';expect(await options.authorizeTool!()).not.toBeNull();
});

it('updates an inherited OpenCode default only after an owning quota result and rechecks Codex readiness',async()=>{
  const {swarm,fake,agent,callbacks}=await startDeveloper('opencode',true);const ready=vi.fn(async()=>null);swarm.capabilityPreflight=ready;await callbacks.finished(result({ok:false,opencodeLimit:true,errors:['Synthetic native quota']}));await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));expect(swarm.snapshot().settings).toMatchObject({defaultCli:'codex',defaultModel:''});expect(fake.startSession.mock.calls[1][0]).toMatchObject({cli:'codex',model:''});expect(ready).toHaveBeenCalledWith('synthetic/repo','codex');expect(view(swarm,agent.id).cli).toBe('codex');
});

it('falls back to idle when the owning issue disappeared rather than fabricating a replacement task',async()=>{
  const {swarm,fake,agent,callbacks}=await startDeveloper('opencode');fake.listIssues.mockResolvedValue([]);await swarm.syncRepo('synthetic/repo');await callbacks.finished(result({ok:false,opencodeLimit:true,errors:['Synthetic native quota']}));expect(fake.startSession).toHaveBeenCalledOnce();expect(view(swarm,agent.id)).toMatchObject({cli:'codex',model:'',status:'idle'});
});

it('resumes a quota-limited QA task under freshly admitted Codex without accepting the old outcome',async()=>{
  const {swarm,fake,callbacks}=await startQa('opencode');swarm.setDraining(false);const ready=vi.fn(async()=>null);swarm.capabilityPreflight=ready;await callbacks.finished(result({ok:false,opencodeLimit:true,errors:['Synthetic native quota']}));await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));expect(fake.startSession.mock.calls[1][0]).toMatchObject({cli:'codex',role:'qa',keepAlive:false});expect(swarm.snapshot().qa[0].status).toBe('testing');expect(fake.commentPull).not.toHaveBeenCalled();expect(ready).toHaveBeenCalledWith('synthetic/repo','codex');
});

type PrivateManager={state:{agents:any[];repos:any[];qa:any[]};runFix:(agent:any,repo:any,record:any)=>Promise<void>;runQa:(agent:any,repo:any,record:any)=>Promise<void>};
const manager=(swarm:Swarm)=>swarm as unknown as PrivateManager;
async function failedQa(){const fixture=await startQa();await fixture.callbacks.finished(result({structured:{...passReport,verdict:'fail',checks:[{name:'API behavior',result:'fail',details:'Observed mismatch'}],fixInstructions:'Repair the actual synthetic response'}}));const dev=fixture.swarm.hireAgent('synthetic/repo',{name:'Synthetic repairer'}),internal=manager(fixture.swarm);return {...fixture,dev,internal,record:internal.state.qa[0],persistedDev:internal.state.agents.find(agent=>agent.id===dev.id),repo:internal.state.repos[0]};}

it.each(['qa','conflict','checks','dlp'] as const)('repairs %s findings on the existing PR branch and keeps its independent retest/merge path explicit',async reason=>{
  const fixture=await failedQa(),{swarm,fake,internal,persistedDev,repo,record}=fixture;record.fixReason=reason;swarm.setDraining(false);await internal.runFix(persistedDev,repo,record);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));swarm.setDraining(true);const opts=fake.startSession.mock.calls[1][0] as SessionOptions;expect(opts.prompt).toContain('git push origin HEAD:swarm/issue-1-synthetic');expect(opts.prompt).toContain('Do not open a new pull request');if(reason==='qa')expect(opts.prompt).toContain('Repair the actual synthetic response');if(reason==='conflict')expect(opts.prompt).toContain('git merge origin/main');if(reason==='checks')expect(opts.prompt).toContain('gh run view');if(reason==='dlp')expect(opts.prompt).toContain('Data Loss Prevention');await fake.startSession.mock.calls[1][1].finished(result({text:'Pushed verified synthetic repair'}));expect(view(swarm,fixture.dev.id).status).toBe('done');expect(swarm.snapshot().qa[0].status).toBe(reason==='checks'||reason==='conflict'?'passed':'queued');expect(fake.mergePull).not.toHaveBeenCalled();
});

it.each([false,true])('does not blame quota for a failed repair and escalates repeated nonquota failures=%s',async quota=>{
  const {swarm,fake,internal,persistedDev,repo,record}=await failedQa();record.sessionFailures=1;swarm.setDraining(false);await internal.runFix(persistedDev,repo,record);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));swarm.setDraining(true);const callbacks=fake.startSession.mock.calls[1][1];if(quota)callbacks.limited?.(Date.now()+60000);await callbacks.finished(result({ok:false,errors:['Synthetic repair failed']}));expect(swarm.snapshot().qa[0].status).toBe(quota?'failed':'needs-human');expect(record.sessionFailures).toBe(quota?1:2);
});

it('returns a failed repair to its queue when preparation fails and never launches model work',async()=>{
  const {swarm,fake,internal,persistedDev,repo,record}=await failedQa();fake.prepareDesk.mockRejectedValue(new Error('Synthetic checkout unavailable'));swarm.setDraining(false);await internal.runFix(persistedDev,repo,record);expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().qa[0].status).toBe('failed');
});

it('refuses repair when its fresh PR metadata is unavailable instead of inventing a remote branch',async()=>{
  const {swarm,fake,internal,persistedDev,repo,record}=await failedQa();fake.listPulls.mockResolvedValue([]);await swarm.syncRepo('synthetic/repo');fake.prDetails.mockRejectedValue(new Error('Synthetic PR metadata inaccessible'));swarm.setDraining(false);await internal.runFix(persistedDev,repo,record);expect(fake.startSession).toHaveBeenCalledOnce();expect(view(swarm,persistedDev.id)).toMatchObject({status:'error',lastError:'Repair PR metadata is unavailable'});expect(swarm.snapshot().qa[0].status).toBe('failed');
});

it.each(['conflict','checks','dlp','retest'] as const)('gives a fresh reviewer the prior %s findings before a new independent QA session',async reason=>{
  const {swarm,fake,internal,record}=await failedQa(),qa=internal.state.agents.find(agent=>agent.role==='qa');record.fixReason=reason==='retest'?'qa':reason;record.round=2;swarm.setDraining(false);await internal.runQa(qa,internal.state.repos[0],record);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));const opts=fake.startSession.mock.calls[1][0] as SessionOptions;if(reason==='conflict')expect(opts.prompt).toContain('resolve merge conflicts');if(reason==='checks')expect(opts.prompt).toContain('fix failing GitHub checks');if(reason==='dlp')expect(opts.prompt).toContain('DLP policy violations');if(reason==='retest')expect(opts.prompt).toContain('Check those first, then re-check everything else');
});

it('refuses QA approval if its record disappears or its tested commit was never observed',async()=>{
  const first=await startQa(),internal=manager(first.swarm);internal.state.qa=[];await first.callbacks.finished(result({structured:passReport}));expect(view(first.swarm,first.agent.id)).toMatchObject({status:'error',lastError:'QA record unavailable; report was not accepted'});expect(first.fake.commentPull).not.toHaveBeenCalled();
});

it('keeps a claimed QA pass unapproved when the tested commit is missing',async()=>{
  const {swarm,fake,callbacks}=await startQa();manager(swarm).state.qa[0].testedSha=null;await callbacks.finished(result({structured:passReport}));expect(swarm.snapshot().qa[0].status).toBe('queued');expect(fake.commentPull).not.toHaveBeenCalled();
});

it.each(['CLOSED','MERGED'] as const)('removes queued QA after authoritative PR metadata reports %s',async state=>{
  const {swarm,fake,internal,record}=await failedQa(),qa=internal.state.agents.find(agent=>agent.role==='qa');fake.prDetails.mockResolvedValue({...pull,state,body:'Synthetic requirements',isCrossRepository:false});swarm.setDraining(false);await internal.runQa(qa,internal.state.repos[0],record);expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().qa).toEqual([]);expect(view(swarm,qa.id).status).toBe('idle');
});

it('returns QA to its queue when fresh PR metadata cannot be read',async()=>{
  const {swarm,fake,internal,record}=await failedQa(),qa=internal.state.agents.find(agent=>agent.role==='qa');fake.prDetails.mockRejectedValue(new Error('Synthetic metadata unavailable'));swarm.setDraining(false);await internal.runQa(qa,internal.state.repos[0],record);expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().qa[0].status).toBe('queued');expect(view(swarm,qa.id)).toMatchObject({status:'error',lastError:'Synthetic metadata unavailable'});
});

it('returns an unlaunched QA checkout failure to the queue without retaining stale reviewer ownership',async()=>{
  const {swarm,fake,internal,record}=await failedQa(),qa=internal.state.agents.find(agent=>agent.role==='qa');fake.prepareDesk.mockRejectedValue(new Error('Synthetic QA checkout unavailable'));swarm.setDraining(false);await internal.runQa(qa,internal.state.repos[0],record);expect(fake.startSession).toHaveBeenCalledOnce();expect(swarm.snapshot().qa[0]).toMatchObject({status:'queued',qaAgentId:null});
});

it.each(['codex','unknown'] as const)('uses only a known original-author %s repair checkpoint',async runtime=>{
  const {swarm,fake,internal,persistedDev,repo,record}=await failedQa();fake.terminals=true;record.devAgentId=persistedDev.id;record.devSessionId='original-author-session';record.devSessionCli=runtime;swarm.setDraining(false);await internal.runFix(persistedDev,repo,record);await vi.waitFor(()=>expect(fake.startSession).toHaveBeenCalledTimes(2));const options=fake.startSession.mock.calls[1][0] as SessionOptions;expect(options.resumeSessionId).toBe(runtime==='codex'?'original-author-session':undefined);expect(options.prompt).toContain('your pull request');expect(record.devSessionId).toBe(runtime==='codex'?'original-author-session':null);
});

it('rejects a stale QA authority immediately after launch before publishing any captured result',async()=>{
  const {swarm,fake,agent,callbacks}=await startQa();swarm.deliveryTaskContract=()=>({owner:'dev',qaOwner:agent.id,components:['app'],resources:[]});swarm.deliveryTaskFingerprint=()=> 'new-approved-scope';manager(swarm).state.qa[0].taskAuthorityHash='old-approved-scope';await callbacks.finished(result({structured:passReport}));expect(fake.commentPull).not.toHaveBeenCalled();expect(swarm.snapshot().qa[0].status).toBe('queued');expect(view(swarm,agent.id).status).toBe('done');
});
