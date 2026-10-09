import http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserAuth } from './browserAuth.ts';
const app = express(); const auth = createBrowserAuth(); auth.install(app); app.get('/api/state', (_req, res) => res.json({ ok: true }));
const server = http.createServer(app);
let url = ''; let cookie = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(`${url}/api/session`); cookie = response.headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
describe('Browser session boundary', () => {
  it('requires a session and accepts authenticated same-origin requests', async () => {
    expect((await fetch(`${url}/api/state`)).status).toBe(401);
    expect((await fetch(`${url}/api/state`, { headers: { Cookie: cookie, Origin: url } })).status).toBe(200);
  });
  it('rejects foreign origins and rebound hostnames even with a valid cookie', async () => {
    expect((await fetch(`${url}/api/state`, { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status).toBe(403);
    const rebound = await new Promise<number>((resolve, reject) => {
      http.get(`${url}/api/session`, { headers: { Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode!); }).on('error', reject);
    });
    expect(rebound).toBe(403);
  });
  it('requires both origin and session before a websocket upgrade', () => {
    const req = (origin?: string, session = cookie) => ({ headers: { host: url.slice(7), origin, cookie: session } }) as http.IncomingMessage;
    expect(auth.websocket(req(url))).toBe(true);
    expect(auth.websocket(req('https://evil.example'))).toBe(false);
    expect(auth.websocket(req(url, 'cubefarm-session=bad'))).toBe(false);
    expect(auth.websocket(req())).toBe(false);
    expect(auth.websocket(req(url, `cubefarm-session=${'é'.repeat(64)}`))).toBe(false);
  });
});
