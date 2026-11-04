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
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark/test networks
  // Documentation and special-use ranges are never valid upstream media hosts.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function parseIPv6Words(ip) {
  let value = normalizeAddress(ip).toLowerCase();
  if (!value.includes(':')) return null;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const v4 = ipv4ToInt(value.slice(lastColon + 1));
    if (v4 === null) return null;
    value = value.slice(0, lastColon + 1) +
      ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let words;
  if (halves.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    words = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    if (left.length !== 8) return null;
    words = left;
  }
  const parsed = words.map((word) => parseInt(word, 16));
  return parsed.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? parsed : null;
}

function isBlockedIPv6(ip) {
  const value = normalizeAddress(String(ip || '')).toLowerCase();
  if (!value || value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:') && net.isIPv4(value.slice(7))) return isBlockedIPv4(value.slice(7));
  // Multicast and link-local are never valid upstream destinations, even when
  // private LAN access is explicitly enabled.
  if (value.startsWith('ff') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  // Unique-local addresses (fc00::/7) are private-network addresses.
  if (value.startsWith('fc') || value.startsWith('fd')) return !ALLOW_PRIVATE;
  // Documentation and discard-only ranges are never valid upstream hosts.
  if (value.startsWith('2001:db8') || value.startsWith('100::')) return true;

  const words = parseIPv6Words(value);
  if (words) {
    const embeddedIpv4 = (high, low) => {
      const embedded = ((high << 16) | low) >>> 0;
      return `${(embedded >>> 24) & 0xff}.${(embedded >>> 16) & 0xff}.${(embedded >>> 8) & 0xff}.${embedded & 0xff}`;
    };
    // IPv4-mapped (::ffff:0:0/96) and deprecated IPv4-compatible addresses.
    if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 &&
        words[4] === 0 && (words[5] === 0 || words[5] === 0xffff)) {
      return isBlockedIPv4(embeddedIpv4(words[6], words[7]));
    }
    // Well-known NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4
    // destination. Allow public embedded addresses — NAT64-only networks need
    // this — but still reject private IPv4 hidden behind a public IPv6 literal.
    // The local-use 64:ff9b:1::/48 prefix is never a public destination.
    if (words[0] === 0x0064 && words[1] === 0xff9b) {
      if (words[2] !== 0) return true;
      if (words[3] === 0 && words[4] === 0 && words[5] === 0) {
        return isBlockedIPv4(embeddedIpv4(words[6], words[7]));
      }
    }
    if (words[0] === 0x2002) {
      return isBlockedIPv4(embeddedIpv4(words[1], words[2]));
    }
  }
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

const DNS_TIMEOUT_MS = 3000;

function withDnsTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve([]), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

async function resolveHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host || isBlockedHostname(host)) return [];
  const lookup = net.isIP(host)
    ? [{ address: host }]
    : await withDnsTimeout(
      dns.lookup(host, { all: true, verbatim: true }).catch(() => []),
      DNS_TIMEOUT_MS
    );
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
