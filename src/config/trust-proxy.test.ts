import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('defaults to trusting no proxy', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('accepts an exact hop count between 1 and 5', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('5')).toBe(5);
  });

  it('accepts presets, IPv4/IPv6 addresses, and bounded CIDR subnets', () => {
    expect(parseTrustProxy('loopback')).toEqual(['loopback']);
    expect(parseTrustProxy('loopback, 10.20.0.0/16, 192.0.2.7, 2001:db8::/32, ::1')).toEqual(['loopback', '10.20.0.0/16', '192.0.2.7', '2001:db8::/32', '::1']);
  });

  it.each([
    ['true', /must not be "true"/],
    ['0', /between 1 and 5/],
    ['6', /between 1 and 5/],
    ['-1', /not an IP address/],
    ['1.5', /not an IP address/],
    ['everyone', /not an IP address/],
    ['() => true', /not an IP address/],
    ['10.0.0.0/33', /invalid prefix length/],
    ['10.0.0.0/abc', /invalid prefix length/],
    ['0.0.0.0/0', /too broad/],
    ['10.0.0.0/7', /too broad/],
    ['::/0', /too broad/],
    ['10.0.0.0/8/1', /not an IP address/],
    ['loopback,,10.0.0.1', /empty list entries/],
    ['999.1.1.1', /not an IP address/],
  ])('rejects %j', (value, message) => {
    expect(() => parseTrustProxy(value)).toThrow(message);
  });
});

describe('ADMIN_TRUST_PROXY environment validation', () => {
  const original = process.env.ADMIN_TRUST_PROXY;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_TRUST_PROXY;
    else process.env.ADMIN_TRUST_PROXY = original;
    vi.resetModules();
  });

  it('rejects an unsafe value at startup', async () => {
    process.env.ADMIN_TRUST_PROXY = 'true';
    vi.resetModules();
    await expect(import('./env.js')).rejects.toThrow(/ADMIN_TRUST_PROXY: must not be "true"/);
  });

  it('parses a valid hop count', async () => {
    process.env.ADMIN_TRUST_PROXY = '1';
    vi.resetModules();
    const { env } = await import('./env.js');
    expect(env.ADMIN_TRUST_PROXY).toBe(1);
  });

  it('defaults to false when unset', async () => {
    delete process.env.ADMIN_TRUST_PROXY;
    vi.resetModules();
    const { env } = await import('./env.js');
    expect(env.ADMIN_TRUST_PROXY).toBe(false);
  });
});
