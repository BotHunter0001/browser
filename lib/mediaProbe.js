/**
 * lib/mediaProbe.js
 *
 * Validates that a resolved source can actually deliver playable media before
 * the player switches to it. This prevents fallback from selecting a URL that
 * merely returns HTTP 200 (login pages, challenge pages, image placeholders).
 */

const { safeFetch } = require('./netGuard');

const ALLOWED_UPSTREAM_HEADERS = new Set([
  'referer', 'origin', 'cookie', 'user-agent', 'authorization',
  'accept', 'accept-language',
]);

function buildHeaders(candidate = {}) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  const extra = candidate.headers;
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (ALLOWED_UPSTREAM_HEADERS.has(key.toLowerCase()) &&
          typeof value === 'string' && value.length > 0 && value.length < 4096 &&
          !/[\r\n]/.test(value)) {
        headers[key] = value;
      }
    }
  }
  if (typeof candidate.cookie === 'string' && candidate.cookie &&
      candidate.cookie.length < 4096 && !/[\r\n]/.test(candidate.cookie)) {
    headers.Cookie = candidate.cookie;
  }
  return headers;
}

async function readPrefix(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value).subarray(0, maxBytes - size);
      chunks.push(chunk);
      size += chunk.length;
      if (chunk.length !== value.length) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* The prefix is enough for probing. */ }
  }
  return Buffer.concat(chunks, size);
}

function looksLikeHls(candidateUrl, contentType, headerText) {
  return /\.m3u8(?:[?#]|$)/i.test(candidateUrl) ||
    /[?&](?:format|type|ext)=m3u8(?:[&#]|$)/i.test(candidateUrl) ||
    /(?:mpegurl|m3u8)/i.test(contentType) ||
    headerText.trimStart().startsWith('#EXTM3U');
}

function hasMediaSignature(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // MPEG-TS packets start with 0x47. Some CDNs disguise .ts segments as .jpg.
  if (buffer[0] === 0x47 && (buffer.length < 189 || buffer[188] === 0x47)) return true;
  const box = buffer.subarray(4, 8).toString('latin1');
  if (['ftyp', 'styp', 'moof', 'mdat'].includes(box)) return true;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return true; // Matroska/WebM
  if (buffer.subarray(0, 4).toString('latin1') === 'OggS') return true;
  if (buffer.subarray(0, 4).toString('latin1') === 'fLaC') return true;
  if (buffer.subarray(0, 3).toString('latin1') === 'ID3') return true;
  if (buffer[0] === 0xff && (buffer[1] === 0xf1 || buffer[1] === 0xf9)) return true; // AAC ADTS
  return false;
}

function looksLikeWebPage(contentType, headerBuffer) {
  // Content-Type is advisory: many HLS CDNs label TS segments as image/jpeg.
  if (hasMediaSignature(headerBuffer)) return false;
  if (/^(?:image|text\/html|text\/xml|application\/(?:json|xml|javascript))/i.test(contentType) ||
      contentType.includes('text/html') || contentType.includes('application/json')) {
    return true;
  }
  const prefix = headerBuffer.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
  return /^<(?:!doctype\s+html|html|head|body|script)\b/.test(prefix) ||
    prefix.startsWith('gif8') || prefix.startsWith('\u0089png') ||
    prefix.startsWith('\u00ff\u00d8\u00ff');
}

async function request(candidate, url, headers, signal) {
  return safeFetch(url, { headers, signal });
}

async function assertPlayableHls(candidate, signal) {
  const headers = buildHeaders(candidate);
  let target = candidate.url;
  let segmentUrl = '';

  for (let depth = 0; depth < 3; depth++) {
    const playlist = await request(candidate, target, headers, signal);
    if (!playlist.ok) {
      try { await playlist.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`HLS playlist returned HTTP ${playlist.status}`);
    }
    const contentType = String(playlist.headers.get('content-type') || '').toLowerCase();
    const text = (await readPrefix(playlist, 512 * 1024)).toString('utf8');
    if (!text.trimStart().startsWith('#EXTM3U')) {
      throw new Error(contentType.includes('html') ? 'HLS URL returned an HTML page' : 'Invalid HLS playlist');
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const variantIndex = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
    if (variantIndex >= 0) {
      const variantUri = lines.slice(variantIndex + 1).find((line) => !line.startsWith('#'));
      if (!variantUri) throw new Error('HLS master playlist has no variant');
      target = new URL(variantUri, playlist.url || target).toString();
      continue;
    }

    segmentUrl = lines.find((line) => !line.startsWith('#')) || '';
    if (!segmentUrl) throw new Error('HLS media playlist has no segments');
    segmentUrl = new URL(segmentUrl, playlist.url || target).toString();
    break;
  }

  if (!segmentUrl) throw new Error('HLS playlist nesting is too deep');
  const segment = await request(candidate, segmentUrl, { ...headers, Range: 'bytes=0-1023' }, signal);
  if (!(segment.ok || segment.status === 206)) {
    try { await segment.body?.cancel(); } catch { /* ignore */ }
    throw new Error(`HLS segment returned HTTP ${segment.status}`);
  }
  const contentType = String(segment.headers.get('content-type') || '').toLowerCase();
  const prefix = await readPrefix(segment, 1024);
  if (looksLikeWebPage(contentType, prefix)) throw new Error('HLS playlist points to a non-media segment');
  return true;
}

/**
 * Probe one candidate with a hard timeout. Resolves to a copy annotated with
 * `type: 'hls' | 'direct'`, or rejects when the source is not playable.
 */
async function probePlayableSource(candidate, { timeoutMs = 10000 } = {}) {
  if (!candidate?.url) throw new Error('Candidate has no URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = buildHeaders(candidate);
    const upstream = await request(candidate, candidate.url, headers, controller.signal);
    if (!(upstream.ok || upstream.status === 206)) {
      try { await upstream.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`HTTP ${upstream.status}`);
    }
    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    const prefix = await readPrefix(upstream, 512 * 1024);

    if (looksLikeHls(candidate.url, contentType, prefix.toString('utf8').slice(0, 1024))) {
      await assertPlayableHls({ ...candidate, type: 'hls' }, controller.signal);
      return { ...candidate, type: 'hls' };
    }

    if (looksLikeWebPage(contentType, prefix)) throw new Error('Source returned a web page or image, not media');
    const hasMediaExtension = /\.(?:mp4|m4v|webm|mkv|mov|ts|m4s|aac|mp3|ogg)(?:[?#]|$)/i.test(candidate.url);
    if (/^text\//i.test(contentType) && !hasMediaExtension) {
      throw new Error(`Source returned ${contentType}, not media`);
    }
    return { ...candidate, type: candidate.type || 'direct' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probePlayableSource, buildHeaders };
