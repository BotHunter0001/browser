// Guards the proxy endpoints against SSRF / open-proxy abuse.
const dns = require('dns').promises;
const net = require('net');

// BDIX providers (DhakaFlix, CircleFTP) live on private 10.x / 172.16.x ranges,
// so private LAN ranges are allowed by default. Loopback, link-local (cloud
// metadata at 169.254.169.254) and "this host" addresses are ALWAYS blocked.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORKS !== 'false';

function isAlwaysBlocked(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isAlwaysBlocked(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fe80') || v.startsWith('ff');
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd');
}

/** Throws if the URL is not safe to fetch server-side. Returns a URL object. */
async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('Only http/https URLs are allowed'), { status: 400 });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('Credentials in URL are not allowed'), { status: 400 });
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Host could not be resolved'), { status: 400 });
  for (const { address } of addrs) {
    if (isAlwaysBlocked(address) || (!ALLOW_PRIVATE && isPrivate(address))) {
      throw Object.assign(new Error('Destination address is not allowed'), { status: 403 });
    }
  }
  return u;
}

/**
 * fetch() that re-validates every redirect hop, so a public URL can't
 * bounce the server to localhost / metadata endpoints.
 */
async function safeFetch(url, opts = {}, maxRedirects = 5) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(current);
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { res.body?.cancel(); } catch { /* ignore */ }
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

module.exports = { assertSafeUrl, safeFetch };
