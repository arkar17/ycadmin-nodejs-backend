import express from 'express';
import request from 'supertest';

import { createApp } from '../../app.js';
import type { TrustProxySetting } from '../../config/trust-proxy.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createLoginRateLimit, LoginRateLimiter } from './login-rate-limiter.js';

// Mirrors createApp's trust-proxy application so limiter keying can be observed directly.
const limiterApp = (trustProxy: TrustProxySetting, limiter = new LoginRateLimiter(2, 60_000)) => {
  const app = express();
  app.set('trust proxy', Array.isArray(trustProxy) ? [...trustProxy] : trustProxy);
  app.post('/login', createLoginRateLimit(limiter), (req, res) => res.json({ key: req.ip }));
  app.use(errorHandler);
  return app;
};

const attempt = (app: express.Express, forwardedFor?: string) => {
  const call = request(app).post('/login');
  return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
};

describe('login rate limiter behind proxies', () => {
  it('keys a direct request on the TCP peer', async () => {
    const response = await attempt(limiterApp(false));
    expect(response.status).toBe(200);
    expect(response.body.key).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
  });

  it('ignores spoofed X-Forwarded-For when no proxy is trusted', async () => {
    const app = limiterApp(false);
    const first = await attempt(app, '198.51.100.1');
    const second = await attempt(app, '198.51.100.2');
    const third = await attempt(app, '198.51.100.3');
    expect(first.body.key).toBe(second.body.key);
    expect(first.body.key).not.toBe('198.51.100.1');
    expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
    expect(third.body.error).toMatchObject({ code: 'LOGIN_THROTTLED' });
  });

  it('gives distinct clients separate buckets behind one trusted hop', async () => {
    const app = limiterApp(1);
    expect((await attempt(app, '203.0.113.10')).body.key).toBe('203.0.113.10');
    expect((await attempt(app, '203.0.113.10')).status).toBe(200);
    expect((await attempt(app, '203.0.113.10')).status).toBe(429);
    const other = await attempt(app, '203.0.113.11');
    expect(other.status).toBe(200);
    expect(other.body.key).toBe('203.0.113.11');
  });

  it('uses only the proxy-appended address when the client prepends forged entries', async () => {
    const app = limiterApp(1);
    // The trusted proxy appends the real client last; left-hand entries are client-controlled.
    const responses = [];
    for (const forged of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) responses.push(await attempt(app, `${forged}, 203.0.113.20`));
    expect(responses.map((response) => response.body.key ?? null)).toEqual(['203.0.113.20', '203.0.113.20', null]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 429]);
  });

  it('honours an exact multi-hop count', async () => {
    const app = limiterApp(2);
    // client-forged, real client (appended by edge), edge address (appended by second proxy)
    const response = await attempt(app, '9.9.9.9, 203.0.113.30, 10.0.0.5');
    expect(response.body.key).toBe('203.0.113.30');
  });

  it('supports IPv6 client addresses', async () => {
    const app = limiterApp(1);
    expect((await attempt(app, '2001:db8::1')).body.key).toBe('2001:db8::1');
    expect((await attempt(app, '2001:db8::1')).status).toBe(200);
    expect((await attempt(app, '2001:db8::1')).status).toBe(429);
    expect((await attempt(app, '2001:db8::2')).status).toBe(200);
  });

  it('trusts forwarded headers only from listed proxy addresses', async () => {
    const trusted = limiterApp(['loopback']);
    expect((await attempt(trusted, '203.0.113.40')).body.key).toBe('203.0.113.40');
    // The test peer is loopback; a list that excludes it must keep keying on the peer.
    const untrusted = limiterApp(['10.20.0.0/16']);
    const response = await attempt(untrusted, '203.0.113.40');
    expect(response.body.key).not.toBe('203.0.113.40');
  });
});

describe('createApp trust proxy wiring', () => {
  const login = (app: express.Express, forwardedFor?: string) => {
    const call = request(app).post('/api/admin/v1/auth/login').send({});
    return forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor);
  };

  it('defaults to not trusting forwarded headers', () => {
    expect(createApp().get('trust proxy')).toBe(false);
  });

  it('keeps the existing 10-attempt policy per apparent client and separates clients behind a trusted hop', async () => {
    const app = createApp({ trustProxy: 1 });
    // Invalid bodies still consume an attempt (the limiter runs before validation) and need no database.
    const statuses = [];
    for (let index = 0; index < 11; index += 1) statuses.push((await login(app, '203.0.113.50')).status);
    expect(statuses.slice(0, 10).every((status) => status === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await login(app, '203.0.113.51')).status).toBe(422);
  });
});
