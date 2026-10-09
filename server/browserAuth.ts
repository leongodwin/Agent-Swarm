import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Express } from 'express';

const COOKIE = 'cubefarm-session';
const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function createBrowserAuth(clientPort = Number(process.env.SWARM_CLIENT_PORT ?? 5317)) {
  const token = crypto.randomBytes(32).toString('hex');
  const localHost = (req: IncomingMessage) => {
    try { return loopback(new URL(`http://${req.headers.host}`).hostname); } catch { return false; }
  };
  const originAllowed = (req: IncomingMessage, required = false) => {
    if (!localHost(req)) return false;
    if (!req.headers.origin) return !required && req.headers['sec-fetch-site'] !== 'cross-site';
    try {
      const origin = new URL(req.headers.origin);
      const host = new URL(`http://${req.headers.host}`);
      return origin.protocol === 'http:' && loopback(origin.hostname) && (origin.port === host.port || origin.port === String(clientPort));
    } catch { return false; }
  };
  const authenticated = (req: IncomingMessage) => {
    const cookie = req.headers.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return !!cookie && /^[a-f0-9]{64}$/.test(cookie) && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(token));
  };
  return {
    websocket: (req: IncomingMessage) => originAllowed(req, true) && authenticated(req),
    install(app: Express) {
      app.get('/api/session', (req, res) => {
        if (!originAllowed(req)) return void res.status(403).json({ error: 'Office session requires a local origin' });
        res.set('Cache-Control', 'no-store');
        res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
        res.json({ ok: true });
      });
      app.use('/api', (req, res, next) => {
        if (!originAllowed(req)) return void res.status(403).json({ error: 'Office origin is not allowed' });
        if (!authenticated(req)) return void res.status(401).json({ error: 'Office session required' });
        next();
      });
    },
  };
}
