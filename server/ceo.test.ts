import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createOfficeTools, createDeliveryQaTools, createEngineeringTools, IssueCap, jobLabel, planRoute, specialtyLabel, specialtySlug, type CeoJob, type RouteRequest } from './ceo.ts';

it('gives developers readiness and templates without QA approval authority', async () => {
  const tools = createEngineeringTools(() => 'Tenant access blocked');
  const client = new Client({ name: 'developer-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await tools.server.instance.connect(serverTransport); await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['canvas_authoring_acquire', 'canvas_authoring_release', 'capability_status', 'delivery_record', 'implementation_templates', 'installed_skills', 'platform_discovery','read_delivery_source','read_skill','sharepoint_provisioning']);
    const discovery = listed.tools.find(tool => tool.name === 'platform_discovery')!;
    expect(discovery.description).toContain('{kind:"sharepoint-list-schema",resourceKey:"exact planned key"}');
    expect(discovery.description).toContain('completed verified list');
    const catalogue = await client.callTool({ name: 'installed_skills', arguments: { task: 'Dataverse schema' } });
    expect(catalogue.isError).not.toBe(true);
    const status = await client.callTool({ name: 'capability_status', arguments: {} });
    expect(status.content).toEqual([{ type: 'text', text: 'Tenant access blocked' }]);
    const denied = await client.callTool({ name: 'approve_visual', arguments: {} });
    expect(denied.isError).toBe(true);
  } finally { await client.close(); await tools.server.instance.close(); }
});

it('exposes only status and session-bound release approval to QA', async () => {
  const approved: string[][] = [];
  const tools = createDeliveryQaTools(() => 'release status', async (id, hash) => { approved.push([id, hash]); return 'approved'; });
  const client = new Client({ name: 'qa-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await tools.server.instance.connect(serverTransport); await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['approve_backend', 'approve_release', 'approve_visual', 'capability_status', 'delivery_record', 'delivery_status', 'installed_skills', 'manual_governance', 'native_claim_reconciliation', 'platform_discovery', 'read_delivery_source', 'read_skill', 'review_architecture', 'review_governance']);
    expect((await client.callTool({name:'installed_skills',arguments:{task:'delivery manifest solution packaging'}})).isError).not.toBe(true);
    expect((await client.callTool({name:'read_skill',arguments:{id:'missing-skill',sha256:'0'.repeat(64)}})).isError).toBe(true);
    await client.callTool({ name: 'approve_release', arguments: { release_id: 'release', plan_hash: 'hash' } });
    expect(approved).toEqual([['release', 'hash']]);
  } finally { await client.close(); await tools.server.instance.close(); }
});

it.each(['sdk', 'http'])('revokes QA tools at handler dispatch in the %s server', async transportKind => {
  let active=true; const approve=vi.fn(async()=> 'approved');
  const tools=createDeliveryQaTools(()=> 'status',approve,undefined,()=>active?null:'Task superseded');
  const server=transportKind==='sdk'?tools.server.instance:tools.serve();
  const client=new Client({name:'revocation-test',version:'1'});
  const [outbound,inbound]=InMemoryTransport.createLinkedPair();
  await server.connect(inbound);await client.connect(outbound);
  try {
    await client.callTool({name:'approve_release',arguments:{release_id:'release',plan_hash:'hash'}});
    expect(approve).toHaveBeenCalledOnce();active=false;
    const denied=await client.callTool({name:'approve_release',arguments:{release_id:'release',plan_hash:'hash'}});
    expect(denied.isError).toBe(true);expect(denied.content).toEqual([{type:'text',text:'Task superseded'}]);
    expect(approve).toHaveBeenCalledOnce();
    expect(JSON.parse(await tools.call('approve_release',{release_id:'release',plan_hash:'hash'})).isError).toBe(true);
  } finally {await client.close();await server.close();}
});

it('binds architecture review to the QA session and revokes its handler authority',async()=>{
  let active=true;const review=vi.fn(async()=> 'reviewed');
  const tools=createDeliveryQaTools(()=> 'status',async()=> 'approved',undefined,()=>active?null:'Task cancelled',review);
  const args={release_id:'release',plan_hash:'hash',artifact_sha256:'a'.repeat(64),decision:'rejected',notes:'Independent assessment found missing authorization decisions and unresolved requirements; approval is denied until resolved.'};
  expect(JSON.parse(await tools.call('review_architecture',args)).isError).toBeUndefined();
  expect(review).toHaveBeenCalledWith('release','hash',{artifactSha256:args.artifact_sha256,decision:'rejected',notes:args.notes});
  active=false;expect(JSON.parse(await tools.call('review_architecture',args)).isError).toBe(true);expect(review).toHaveBeenCalledOnce();
});

it('does not acquire Canvas authority after a developer session is revoked',async()=>{
  const acquire=vi.fn(async()=> 'lease');const release=vi.fn(async()=>{});
  const tools=createEngineeringTools(()=> 'status',{acquire,release},()=> 'Task cancelled');
  const result=JSON.parse(await tools.call('canvas_authoring_acquire',{app:'11111111-1111-4111-8111-111111111111',owner:'synthetic'}));
  expect(result.isError).toBe(true);expect(acquire).not.toHaveBeenCalled();
});

describe('specialtySlug', () => {
  it('turns a specialty into a lowercase slug', () => {
    expect(specialtySlug('Three.js graphics')).toBe('three-js-graphics');
    expect(specialtySlug('Testing')).toBe('testing');
    expect(specialtySlug('front_end / UI')).toBe('front-end-ui');
  });

  it('trims separators from both ends', () => {
    expect(specialtySlug('  --Backend!!  ')).toBe('backend');
  });

  it('keeps at most 24 characters', () => {
    expect(specialtySlug('a'.repeat(40))).toBe('a'.repeat(24));
    expect(specialtySlug('infrastructure and devops tooling')).toHaveLength(24);
  });

  // Known bug: the cut happens after the trim, so 'abcdefghijklmnopqrstuvw xyz' becomes 'abcdefghijklmnopqrstuvw-'.
  it.todo('does not end in "-" when the 24-character cut lands on a separator');

  it('is empty for no specialty', () => {
    expect(specialtySlug(undefined)).toBe('');
    expect(specialtySlug('')).toBe('');
    expect(specialtySlug('!!!')).toBe('');
  });

  it('never returns "skip", which means "leave this issue alone"', () => {
    expect(specialtySlug('skip')).toBe('');
    expect(specialtySlug('SKIP')).toBe('');
    expect(specialtySlug(' -skip- ')).toBe('');
    expect(specialtySlug('skipping')).toBe('skipping');
  });

  it('round-trips through specialtyLabel', () => {
    expect(specialtyLabel(specialtySlug('Three.js graphics'))).toBe('swarm:three-js-graphics');
  });
});

describe('jobLabel', () => {
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, repoId: 'r1', at: 0 });
  const floor = { floor: 3, fullName: 'leonvanzyl/office-swarm' };

  it('names the floor and repo for floor jobs', () => {
    expect(jobLabel(job('onboard'), floor)).toBe('Onboarding floor 3 · office-swarm');
    expect(jobLabel(job('plan'), floor)).toBe('Planning floor 3 · office-swarm');
  });

  it('falls back to the full name when it has no owner', () => {
    expect(jobLabel(job('plan'), { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
  });

  it('says so when the floor is gone', () => {
    expect(jobLabel(job('onboard'), null)).toBe('Onboarding a removed floor');
    expect(jobLabel(job('plan'), null)).toBe('Planning a removed floor');
  });

  it('labels company-wide jobs without a floor', () => {
    expect(jobLabel(job('review'), floor)).toBe('Reviewing the company');
    expect(jobLabel(job('review'), null)).toBe('Reviewing the company');
    expect(jobLabel({ kind: 'chat', text: 'hi', at: 0 }, null)).toBe('Replying to you');
  });
});

// The CEO only sees the office tools if the whole list converts to JSON Schema: one schema the SDK can't handle
// (z.record did this) empties tools/list, and the CEO silently loses every tool.
describe('office tools', () => {
  const connect = async () => {
    const floors: unknown[] = [];
    const office = createOfficeTools({
      companyStatus: () => '{}',
      agentDetail: () => '{}',
      setFloorProfile: (a) => (floors.push(a), 'saved'),
      updateJob: () => '',
      proposeHire: () => '',
      proposeLetGo: () => '',
      fileIssue: async () => '',
      routeIssue: async () => '',
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await office.server.instance.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    return { client, floors };
  };

  it('lists every tool the CEO relies on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['agent_detail', 'capability_status', 'company_status', 'create_release', 'delivery_record', 'delivery_status', 'file_issue', 'implementation_templates', 'installed_skills', 'propose_hire', 'propose_let_go', 'read_delivery_source', 'read_skill', 'review_delivery_record', 'review_release', 'route_issue', 'set_floor_profile', 'update_job']);
  });

  it('still takes preview_env as a map of strings', async () => {
    const { client, floors } = await connect();
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } } });
    expect(floors).toEqual([{ floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } }]);
  });
  it('reads hash-bound headless guidance while refusing repository expansion',async()=>{
    const {client}=await connect();const args={request_json:JSON.stringify({kind:'office-document',document:'HEADLESS-FLOW',maxLines:2})};
    const result=await client.callTool({name:'read_delivery_source',arguments:args});expect(result.isError).not.toBe(true);const page=JSON.parse((result.content as any)[0].text);expect(page).toMatchObject({scope:'approved-office-guidance',document:'HEADLESS-FLOW',startLine:1,endLine:2,sourceCommit:null});expect(page.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await client.callTool({name:'read_delivery_source',arguments:{request_json:JSON.stringify({kind:'repository-file',file:'README.md'})}})).isError).toBe(true);
    expect((await client.callTool({name:'read_delivery_source',arguments:{request_json:JSON.stringify({kind:'office-document',document:'../../secret'})}})).isError).toBe(true);await client.close();
  });
  it('withholds coordinator document bytes when authority changes during the read',async()=>{
    let observations=0;const office=createOfficeTools({companyStatus:()=> '{}',agentDetail:()=> '{}',setFloorProfile:()=> '',updateJob:()=> '',proposeHire:()=> '',proposeLetGo:()=> '',fileIssue:async()=> '',routeIssue:async()=> ''},()=>++observations===1?null:'Coordinator scope changed');
    const [a,b]=InMemoryTransport.createLinkedPair(),client=new Client({name:'source-revocation',version:'1'});await office.server.instance.connect(a);await client.connect(b);
    try{const result=await client.callTool({name:'read_delivery_source',arguments:{request_json:JSON.stringify({kind:'office-document',document:'HEADLESS-FLOW',maxLines:2})}});expect(result.isError).toBe(true);expect(JSON.stringify(result.content)).toContain('Coordinator scope changed');expect(JSON.stringify(result.content)).not.toContain('approved-office-guidance');}finally{await client.close();await office.server.instance.close();}
  });

  it.each(['primary','fresh'] as const)('revokes CEO mutation authority on the %s native transport',async kind=>{
    let active=true;const update=vi.fn(()=> 'saved');
    const office=createOfficeTools({companyStatus:()=> '{}',agentDetail:()=> '{}',setFloorProfile:update,updateJob:()=> '',proposeHire:()=> '',proposeLetGo:()=> '',fileIssue:async()=> '',routeIssue:async()=> ''},()=>active?null:'CEO task cancelled');
    const server=kind==='primary'?office.server.instance:office.serve();
    const [serverSide,clientSide]=InMemoryTransport.createLinkedPair();const client=new Client({name:'ceo-authority',version:'1'});
    await server.connect(serverSide);await client.connect(clientSide);
    try{
      expect((await client.callTool({name:'set_floor_profile',arguments:{floor:1}})).isError).not.toBe(true);
      active=false;
      expect((await client.callTool({name:'set_floor_profile',arguments:{floor:2}})).isError).toBe(true);
      expect(update).toHaveBeenCalledOnce();
    }finally{await client.close();await server.close();}
  });

  it('validates direct engineering calls before acquiring authority',async()=>{
    const acquire=vi.fn(async()=> 'lease');const tools=createEngineeringTools(()=> 'status',{acquire,release:async()=>{}});
    for(const args of [{app:'invalid',owner:'test'},{app:'11111111-1111-4111-8111-111111111111',owner:'test',extraAuthority:'admin'}])expect(JSON.parse(await tools.call('canvas_authoring_acquire',args)).isError).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe('planRoute (route_issue)', () => {
  // #1 ← #2 ← #3 is a two-step chain; #5 waits for #4; #9 is closed.
  const base: RouteRequest = {
    floor: 1,
    number: 4,
    issues: [
      { number: 1, body: 'Set up the skeleton', labels: ['swarm:frontend'] },
      { number: 2, body: 'Depends on #1', labels: [] },
      { number: 3, body: 'Depends on #2\n\nThe rest', labels: [] },
      { number: 4, body: 'Some text', labels: ['swarm:backend', 'bug'] },
      { number: 5, body: 'Intro\n\nDepends on #4\n\nMore', labels: [] },
      { number: 6, body: 'Free', labels: [] },
    ],
    closed: (n) => n === 9,
    inProgress: false,
    specialties: ['frontend', 'backend'],
  };
  const route = (over: Partial<RouteRequest>) => planRoute({ ...base, ...over });

  it('re-routes to a specialty on the floor, dropping the old swarm label only', () => {
    expect(route({ specialty: 'Frontend' })).toEqual({ addLabels: ['swarm:frontend'], removeLabels: ['swarm:backend'], body: null, summary: '#4 on floor 1: routed to frontend.' });
    expect(route({ specialty: '' })).toMatchObject({ addLabels: [], removeLabels: ['swarm:backend'], summary: '#4 on floor 1: no specialty.' });
  });

  it('refuses a specialty nobody on the floor or in a pending proposal has', () => {
    expect(() => route({ specialty: 'wizardry' })).toThrow('Nobody on floor 1 has the specialty "wizardry", and no pending proposal does. Specialties there: frontend, backend.');
    expect(() => route({ specialty: '!!!' })).toThrow(/is not a specialty/);
  });

  it('rewrites the Depends on line and leaves the rest of the body alone', () => {
    expect(route({ number: 5, dependsOn: [6] }).body).toBe('Depends on #6\n\nIntro\n\nMore');
    expect(route({ number: 5, dependsOn: [] }).body).toBe('Intro\n\nMore');
    expect(route({ number: 6, dependsOn: [1, 4] })).toMatchObject({ body: 'Depends on #1, #4\n\nFree', summary: '#6 on floor 1: depends on #1, #4.' });
  });

  it('refuses a closed or unknown issue', () => {
    expect(() => route({ number: 9, specialty: 'frontend' })).toThrow('#9 is closed.');
    expect(() => route({ number: 42, specialty: 'frontend' })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses dependencies on itself, on closed and on unknown issues', () => {
    expect(() => route({ dependsOn: [4] })).toThrow("#4 can't depend on itself.");
    expect(() => route({ dependsOn: [9] })).toThrow("#9 is closed, so there's nothing to wait for.");
    expect(() => route({ dependsOn: [42] })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses a cycle', () => {
    expect(() => route({ number: 1, dependsOn: [3] })).toThrow('#3 already waits for #1, directly or through other issues, so that would be a cycle.');
    expect(() => route({ number: 4, dependsOn: [5] })).toThrow(/#5 already waits for #4/);
  });

  it('refuses a chain deeper than two steps', () => {
    expect(() => route({ number: 1, dependsOn: [6] })).toThrow('That makes a dependency chain 3 steps deep through #1.');
    expect(() => route({ number: 6, dependsOn: [3] })).toThrow(/3 steps deep/);
    expect(route({ number: 6, dependsOn: [2] }).body).toBe('Depends on #2\n\nFree');
  });

  it('keeps the specialty but not the dependencies of an issue in progress', () => {
    expect(() => route({ inProgress: true, dependsOn: [] })).toThrow("#4 is already in progress, so its dependencies can't change. Changing its specialty is fine.");
    expect(route({ inProgress: true, specialty: 'frontend' }).addLabels).toEqual(['swarm:frontend']);
  });

  it('needs something to change', () => {
    expect(() => route({})).toThrow(/Nothing to change/);
  });
});

describe('IssueCap', () => {
  it('refuses the 13th issue and says the next manager message allows more', () => {
    const cap = new IssueCap(12);
    for (let i = 0; i < 12; i++) {
      cap.check();
      cap.record('a/b');
    }
    expect(() => cap.check()).toThrow("You already filed 12 issues in this job. That's plenty for one milestone. The manager's next message allows more.");
  });

  it('resets when a manager message arrives, and still counts the whole job', () => {
    const cap = new IssueCap(2);
    cap.record('a/b');
    cap.record('c/d');
    expect(() => cap.check()).toThrow();
    cap.managerMessage();
    expect(() => cap.check()).not.toThrow();
    cap.record('a/b');
    expect(cap.total).toBe(3);
    expect([...cap.repos]).toEqual(['a/b', 'c/d']);
  });
});

it('transports exact per-check quality decisions through the session-bound QA MCP approval tool',async()=>{
  const visual=vi.fn(async()=> 'Reviewed');const tools=createDeliveryQaTools(()=> 'status',async()=> 'approved',visual);
  const client=new Client({name:'quality-qa-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await tools.server.instance.connect(b);await client.connect(a);
  const decision={checkId:'doc-user',evidenceSha256:'a'.repeat(64),decision:'approved',notes:'Inspected the user procedures, their actual behavior and remaining limitations.'};
  try{const result=await client.callTool({name:'approve_visual',arguments:{run_id:'run',evidence_hash:'b'.repeat(64),scores:[5,5,5,5,5],notes:'Independent synthetic review of actual screenshots and document evidence.',recovery_reviewed:true,quality_decisions:[decision]}});expect(result.isError).not.toBe(true);expect(visual).toHaveBeenCalledWith('run',expect.objectContaining({qualityDecisions:[decision]}));}
  finally{await client.close();await tools.server.instance.close();}
});
