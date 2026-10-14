// Guards proxy endpoints against SSRF / open-proxy abuse.
const dns = require('dns').promises;
const net = require('net');

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORKS === 'true';
const DEFAULT_TIMEOUT_MS = 15000;

function normalizeHost(hostname) {
  return String(hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function normalizeAddress(address) {
  let value = String(address || '').trim();
  if (!value) return value;
  if (value.includes('%')) value = value.split('%')[0];
  if (value.startsWith('::ffff:') && net.isIPv4(value.slice(7))) return value.slice(7);
  return value;
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
}

function isPrivateIPv4(ip) {
  const int = ipv4ToInt(ip);
  if (int === null) return false;
  const a = (int >>> 24) & 0xff;
  const b = (int >>> 16) & 0xff;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 127) || (a === 169 && b === 254) || (a === 0);
}

function isBlockedIPv4(ip) {
  const int = ipv4ToInt(ip);
  if (int === null) return true;
  const a = (int >>> 24) & 0xff;
  const b = (int >>> 16) & 0xff;
  const c = (int >>> 8) & 0xff;
  const d = int & 0xff;

  if (a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224) return true;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return !ALLOW_PRIVATE;
  if (a === 255 || (a === 0 && b === 0 && c === 0 && d === 0)) return true;
  if (a === 198 && b === 18) return true; // benchmark/test networks
  return false;
}

function isBlockedIPv6(ip) {
  const value = normalizeAddress(String(ip || '')).toLowerCase();
  if (!value || value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) return isBlockedIPv6(value.slice(7));
  if (value.startsWith('fe80') || value.startsWith('ff') || value.startsWith('fc') || value.startsWith('fd')) return !ALLOW_PRIVATE;
  if (value.startsWith('2001:db8') || value.startsWith('100::')) return true;
  return false;
}

function isBlockedAddress(address, allowPrivate = ALLOW_PRIVATE) {
  const normalized = normalizeAddress(address);
  if (net.isIPv4(normalized)) return isBlockedIPv4(normalized) || (!allowPrivate && isPrivateIPv4(normalized));
  if (net.isIPv6(normalized)) return isBlockedIPv6(normalized) || (!allowPrivate && (normalized.startsWith('fc') || normalized.startsWith('fd')));
  return false;
}

function isBlockedHostname(hostname) {
  const host = normalizeHost(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain' || host.endsWith('.localhost.localdomain')) return true;
  if (host === 'localtest.me' || host.endsWith('.localtest.me')) return true;
  return false;
}

async function resolveHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host || isBlockedHostname(host)) return [];
  const lookup = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  return lookup.filter(({ address }) => !!address).map(({ address }) => normalizeAddress(address));
}

/** Throws if the URL is not safe to fetch server-side. Returns a URL object. */
async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw Object.assign(new Error('Only http/https URLs are allowed'), { status: 400 });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('Credentials in URL are not allowed'), { status: 400 });
  }

  const hostname = normalizeHost(u.hostname);
  if (!hostname || hostname.includes(' ')) {
    throw Object.assign(new Error('Malformed destination hostname'), { status: 400 });
  }

  const addresses = await resolveHost(hostname);
  if (!addresses.length) {
    throw Object.assign(new Error('Host could not be resolved'), { status: 400 });
  }

  for (const address of addresses) {
    if (isBlockedAddress(address, ALLOW_PRIVATE)) {
      throw Object.assign(new Error('Destination address is not allowed'), { status: 403 });
    }
  }

  return u;
}

/** Fetches a URL while re-validating every redirect hop against the same SSRF policy. */
async function safeFetch(url, opts = {}, maxRedirects = 5) {
  let current = url;
  const fetchOptions = { ...opts, redirect: 'manual' };
  if (!fetchOptions.signal) {
    fetchOptions.signal = AbortSignal.timeout ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) : undefined;
  }

  for (let i = 0; i <= maxRedirects; i++) {
    const validated = await assertSafeUrl(current);
    const res = await fetch(validated, fetchOptions);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { res.body?.cancel?.(); } catch { /* ignore */ }
      const location = res.headers.get('location');
      const redirectTarget = new URL(location, validated).toString();
      if (i === maxRedirects) throw Object.assign(new Error('Too many redirects'), { status: 502 });
      current = redirectTarget;
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

module.exports = { assertSafeUrl, safeFetch, isBlockedAddress, normalizeHost, normalizeAddress, ALLOW_PRIVATE };
