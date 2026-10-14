import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

test('browser API enforces sessions, schemas and connected repository IDs', async ({ request, baseURL }) => {
  expect((await request.get('/api/state')).status()).toBe(401);
  expect((await request.get('/api/governance/tools')).status()).toBe(401);
  expect((await request.get('/api/governance/tenant')).status()).toBe(401);
  await request.get('/api/session');
  const governance = await (await request.get('/api/governance/tools')).json();
  expect(governance).toMatchObject({ evaluated: 0, blocked: 0, unavailable: 0, tenantPolicyVerified: false, scope: 'request-local-safeguards', recent: [] });
  expect(await (await request.get('/api/governance/tenant')).json()).toMatchObject({status:'unavailable',complianceVerified:false});
  expect((await request.post('/api/governance/tenant/refresh', {data:{tenantId:'5e9bd5a8-4e35-4907-ac7b-ec1dc8d1b77c'}})).status()).toBe(409);
  const missingHook = await (await request.post('/api/hooks/test-missing-session', { data: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pac copilot publish' } } })).json();
  expect(missingHook.hookSpecificOutput.permissionDecision).toBe('deny');
  for (const url of ['/api/hooks/test-missing-session', '/api/mcp/test-missing-session']) {
    const ambiguous = await request.post(url, {headers:{'Content-Type':'application/json'},data:'{"tool_input":{},"tool_\\u0069nput":{}}'});
    expect(ambiguous.status()).toBe(400);
    expect(await ambiguous.json()).toEqual({error:'Invalid or ambiguous request JSON'});
  }
  expect((await request.get('/api/state', { headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  for (const url of ['/api/proposals/generate', '/api/hld/generate', '/api/tenancy/login', '/api/tenancy/select']) {
    const data = url.endsWith('/login') ? { interactive: false, clientSecret: 'invalid' } : { unknown: true };
    expect((await request.post(url, { data })).status()).toBe(400);
  }
  expect((await request.get('/api/repos/missing%2Frepo/dlp-scan')).status()).toBe(404);
  const state = await (await request.get('/api/state')).json();
  const repo = encodeURIComponent(state.repos[0].id);
  const runs = await (await request.get(`/api/repos/${repo}/flow-runs`)).json();
  const resubmitted = await (await request.post(`/api/repos/${repo}/flow-runs/${runs[0].id}/resubmit`)).json();
  expect(resubmitted.simulated).toBe(true);
  const refreshed = await (await request.get(`/api/repos/${repo}/flow-runs`)).json();
  expect(refreshed[0].id).toBe(resubmitted.resubmitted.id);
  expect((await request.post(`/api/repos/${repo}/flow-runs/missing/resubmit`)).status()).toBe(404);
  expect((await request.post('/api/delivery/configure', { data: { enabled: true } })).status()).toBe(409);
  expect((await request.post(`/api/repos/${repo}/delivery/run`, { data: {} })).status()).toBe(409);
  expect((await request.get('/api/implementation-templates')).ok()).toBe(true);
  expect((await request.get('/api/implementation-templates/unknown')).status()).toBe(404);
  expect((await request.post(`/api/repos/${repo}/implementation-templates/canvas`, { data: {} })).status()).toBe(409);
  expect((await request.post(`/api/repos/${repo}/capabilities/configure`, { data: {} })).status()).toBe(400);
  expect((await request.get('/api/capabilities')).ok()).toBe(true);
  const catalogue = await (await request.get('/api/installed-skills')).json();
  expect(catalogue.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(Array.isArray(catalogue.skills)).toBe(true);
  for (const skill of catalogue.skills) expect(skill.toolStatus).toBe('unverified');
  expect((await (await request.post(`/api/repos/${repo}/capabilities/check`, { data: {} })).json()).status).toBe('ready');
  const login = await (await request.post('/api/tenancy/login', { data: { interactive: true } })).json();
  expect(login.status).toBe('completed'); expect(login.message).toContain('Demo');

  const cookies = (await request.storageState()).cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const wsUrl = baseURL!.replace('http:', 'ws:');
  const rejected = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/ws`, { origin: 'https://evil.example', headers: { Cookie: cookies } });
    socket.on('unexpected-response', (_req, res) => { res.resume(); socket.terminate(); resolve(res.statusCode!); });
    socket.on('error', () => {}); socket.on('open', () => { socket.close(); reject(new Error('Foreign origin was accepted')); });
  });
  expect(rejected).toBe(403);
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/ws`, { origin: baseURL, headers: { Cookie: cookies } });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('No authenticated snapshot')); }, 8000);
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    socket.once('message', () => { clearTimeout(timer); socket.close(); resolve(); });
  });
  expect((await request.get('/api/state')).ok()).toBe(true);
});
