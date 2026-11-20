import { isIP } from 'node:net';

/**
 * Express `trust proxy` value accepted by this service. Only three shapes are allowed:
 * - `false`: trust nothing; `req.ip` is the TCP peer (default, safe when directly exposed).
 * - a hop count (1-5): trust exactly that many reverse-proxy hops in front of the service.
 * - a list of addresses/subnets or proxy-addr presets (`loopback`, `linklocal`, `uniquelocal`).
 * `true`, functions and arbitrary strings are rejected so forwarded headers are never trusted
 * implicitly from any client.
 */
export type TrustProxySetting = false | number | readonly string[];

const presets = new Set(['loopback', 'linklocal', 'uniquelocal']);
const maxHops = 5;
// Refuse subnets broad enough to amount to "trust everyone".
const minimumPrefix = { 4: 8, 6: 16 } as const;

const invalid = (message: string): never => {
  throw new Error(message);
};

const validateAddressToken = (token: string): void => {
  if (presets.has(token)) return;
  const [address, prefix, extra] = token.split('/');
  if (extra !== undefined || !address) invalid(`entry "${token}" is not an IP address, CIDR subnet, or supported preset.`);
  const family = isIP(address!);
  if (family !== 4 && family !== 6) invalid(`entry "${token}" is not an IP address, CIDR subnet, or supported preset.`);
  if (prefix === undefined) return;
  if (!/^\d{1,3}$/.test(prefix)) invalid(`entry "${token}" has an invalid prefix length.`);
  const length = Number(prefix);
  const maximum = family === 4 ? 32 : 128;
  if (length > maximum) invalid(`entry "${token}" has an invalid prefix length.`);
  if (length < minimumPrefix[family as 4 | 6]) invalid(`entry "${token}" is too broad; use a narrower subnet.`);
};

export const parseTrustProxy = (raw: string | undefined): TrustProxySetting => {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'false') return false;
  if (value === 'true') return invalid('must not be "true"; configure an exact hop count or trusted proxy addresses.');
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > maxHops) invalid(`hop count must be between 1 and ${maxHops}.`);
    return hops;
  }
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => token === '')) invalid('must not contain empty list entries.');
  tokens.forEach(validateAddressToken);
  return tokens;
};
