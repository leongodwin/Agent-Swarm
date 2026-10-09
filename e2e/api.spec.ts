import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

test('browser API enforces sessions, schemas and connected repository IDs', async ({ request, baseURL }) => {
  expect((await request.get('/api/state')).status()).toBe(401);
  await request.get('/api/session');
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
