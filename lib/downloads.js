/**
 * lib/downloads.js
 *
 * Disk-backed download queue for CineSphere Browser.
 *
 * Downloads are written to `DOWNLOAD_DIR` (default: ./downloads) through a
 * temporary `.part` file and only appear as completed once the file has been
 * flushed and renamed. Pause aborts the active request; resume continues with a
 * Range request when the upstream supports it. Metadata is persisted so queue
 * entries survive a server restart (interrupted items come back paused).
 *
 * All upstream requests go through `safeFetch`, which enforces the same SSRF
 * policy as the media proxies.
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { safeFetch } = require('./netGuard');

const downloads = new Map(); // id -> DownloadRecord

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_DOWNLOAD_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'downloads')
  : path.join(ROOT_DIR, 'downloads');
const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || DEFAULT_DOWNLOAD_DIR);
const STATE_FILE = path.join(DOWNLOAD_DIR, '.downloads-state.json');
const PART_SUFFIX = '.part';
const MAX_CONCURRENT = Math.min(6, Math.max(1, parseInt(process.env.DOWNLOAD_CONCURRENCY, 10) || 3));
const MAX_ITEMS_PER_REQUEST = 20;
const MAX_FILENAME_LENGTH = 180;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ALLOWED_HEADERS = new Set([
  'referer',
  'origin',
  'cookie',
  'user-agent',
  'authorization',
  'accept',
  'accept-language',
]);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true, mode: 0o700 });

function now() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeId(prefix = 'dl') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function cleanText(value, fallback, maxLength = 200) {
  const text = Array.from(String(value || ''))
    .map((char) => {
      const code = char.codePointAt(0);
      return code <= 31 || code === 127 ? ' ' : char;
    })
    .join('')
    .trim();
  return (text || fallback).slice(0, maxLength);
}

function sanitizeHeaders(input) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    const name = String(key || '').toLowerCase();
    if (!ALLOWED_HEADERS.has(name)) continue;
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\r\n]/.test(value)) continue;
    result[name] = value;
  }
  return result;
}

function extensionFor(filename, fallback = '.mp4') {
  const candidate = path.extname(String(filename || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(candidate) ? candidate : fallback;
}

function baseNameFor(value) {
  return String(value || 'download')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'download';
}

function buildFilePath(rec) {
  const ext = extensionFor(rec.filename);
  return path.join(DOWNLOAD_DIR, `${safeId(rec.id) || makeId()}-${baseNameFor(rec.title)}${ext}`);
}

function buildHeaders(rec, rangeStart) {
  const headers = { 'User-Agent': BROWSER_UA };
  if (rangeStart > 0) headers.Range = `bytes=${rangeStart}-`;
  Object.assign(headers, sanitizeHeaders(rec.headers));
  if (rec.cookie && !/[\r\n]/.test(rec.cookie)) headers.Cookie = rec.cookie.slice(0, 4096);
  return headers;
}

function emptyRecord(payload = {}) {
  const id = safeId(payload.id) || makeId();
  const filename = cleanText(payload.filename, `${baseNameFor(payload.title)}.mp4`, MAX_FILENAME_LENGTH);
  const record = {
    id,
    title: cleanText(payload.title, 'Untitled'),
    type: payload.type === 'series' ? 'series' : 'movie',
    provider: cleanText(payload.provider, 'unknown', 80),
    url: String(payload.url || '').trim(),
    filename,
    quality: cleanText(payload.quality, 'Standard', 60),
    headers: sanitizeHeaders(payload.headers),
    cookie: typeof payload.cookie === 'string' ? payload.cookie.slice(0, 4096) : '',
    status: 'queued',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speed: 0,
    createdAt: now(),
    updatedAt: now(),
    error: null,
    filePath: '',
    completedAt: null,
    controller: null,
    lastSampleTime: null,
    lastSampleBytes: null,
    lastPersistAt: 0,
    startTime: null,
  };
  record.filePath = buildFilePath(record);
  return record;
}

function fileUrlFor(rec) {
  return rec.status === 'completed'
    ? `/api/downloads/${encodeURIComponent(rec.id)}/file`
    : null;
}

/** Return a public, JSON-safe copy of a record (drops the AbortController). */
function serialise(rec) {
  return {
    id: rec.id,
    title: rec.title,
    type: rec.type,
    provider: rec.provider,
    url: rec.url,
    filename: rec.filename,
    quality: rec.quality,
    status: rec.status,
    progress: rec.progress,
    downloadedBytes: rec.downloadedBytes,
    totalBytes: rec.totalBytes,
    speed: Math.round(rec.speed),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    completedAt: rec.completedAt,
    error: rec.error,
    fileUrl: fileUrlFor(rec),
  };
}

function snapshot(rec) {
  return {
    id: rec.id,
    title: rec.title,
    type: rec.type,
    provider: rec.provider,
    url: rec.url,
    filename: rec.filename,
    quality: rec.quality,
    headers: rec.headers,
    cookie: rec.cookie,
    status: rec.status === 'downloading' || rec.status === 'queued' ? 'paused' : rec.status,
    progress: rec.progress,
    downloadedBytes: rec.downloadedBytes,
    totalBytes: rec.totalBytes,
    speed: 0,
    createdAt: rec.createdAt,
    updatedAt: now(),
    completedAt: rec.completedAt,
    error: rec.error,
    filePath: rec.filePath,
  };
}

let persistTimer = null;
let persistChain = Promise.resolve();

async function writeState() {
  const payload = JSON.stringify({ version: 1, downloads: [...downloads.values()].map(snapshot) }, null, 0);
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, payload, { mode: 0o600 });
  await fsp.rename(tmp, STATE_FILE);
}

function persistNow() {
  persistChain = persistChain.then(writeState, writeState).catch((err) => {
    console.warn('[Downloads] Could not persist state:', err.message);
  });
  return persistChain;
}

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 400);
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

async function flushDownloads() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow();
}

function loadPersistedState() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return;
  }
  if (!parsed || !Array.isArray(parsed.downloads)) return;

  for (const saved of parsed.downloads) {
    if (!saved || !saved.id || !saved.url) continue;
    const rec = emptyRecord(saved);
    rec.id = safeId(saved.id) || rec.id;
    rec.status = ['completed', 'failed', 'paused', 'cancelled'].includes(saved.status) ? saved.status : 'paused';
    rec.progress = clamp(Number(saved.progress) || 0, 0, 100);
    rec.downloadedBytes = Math.max(0, Number(saved.downloadedBytes) || 0);
    rec.totalBytes = Number(saved.totalBytes) || null;
    rec.completedAt = Number(saved.completedAt) || null;
    rec.error = saved.error ? cleanText(saved.error, '', 400) : null;
    rec.filePath = saved.filePath && path.dirname(path.resolve(saved.filePath)) === DOWNLOAD_DIR
      ? path.resolve(saved.filePath)
      : buildFilePath(rec);
    rec.speed = 0;

    if (rec.status === 'completed') {
      try {
        const stat = fs.statSync(rec.filePath);
        if (!stat.isFile() || stat.size === 0) throw new Error('missing');
        rec.downloadedBytes = stat.size;
        rec.totalBytes = stat.size;
        rec.progress = 100;
      } catch {
        rec.status = 'failed';
        rec.error = 'Downloaded file is missing from disk';
      }
    } else {
      const part = rec.filePath + PART_SUFFIX;
      try {
        const stat = fs.statSync(part);
        if (stat.isFile()) rec.downloadedBytes = stat.size;
      } catch {
        // No partial data; resume will start from zero.
      }
    }
    downloads.set(rec.id, rec);
  }
}

loadPersistedState();

/**
 * Enqueue one or more downloads. Returns JSON-safe copies of the created
 * records. Duplicate ids only refresh metadata and are not restarted.
 * @param {Array<{id?, title, type, provider, url, filename, quality?, headers?, cookie?}>} items
 */
function enqueueDownloads(items) {
  if (!Array.isArray(items)) items = [items];
  const created = [];
  for (const payload of items.slice(0, MAX_ITEMS_PER_REQUEST)) {
    if (!payload || typeof payload !== 'object') continue;
    const url = String(payload.url || '').trim();
    if (!url) continue;

    const requestedId = safeId(payload.id);
    if (requestedId && downloads.has(requestedId)) {
      const rec = downloads.get(requestedId);
      rec.title = cleanText(payload.title, rec.title);
      rec.filename = cleanText(payload.filename, rec.filename, MAX_FILENAME_LENGTH);
      rec.quality = cleanText(payload.quality, rec.quality, 60);
      rec.provider = cleanText(payload.provider, rec.provider, 80);
      rec.updatedAt = now();
      created.push(serialise(rec));
      persistSoon();
      continue;
    }

    const rec = emptyRecord({ ...payload, url });
    rec.status = 'queued';
    downloads.set(rec.id, rec);
    created.push(serialise(rec));
  }
  persistSoon();
  drainQueue();
  return created;
}

function getDownload(id) {
  const rec = downloads.get(id);
  return rec ? serialise(rec) : undefined;
}

function getAllDownloads() {
  return [...downloads.values()].map(serialise).sort((a, b) => b.createdAt - a.createdAt);
}

function getDownloadFile(id) {
  const rec = downloads.get(String(id || ''));
  if (!rec || rec.status !== 'completed') return null;
  const resolved = path.resolve(rec.filePath);
  if (path.dirname(resolved) !== DOWNLOAD_DIR) return null;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) return null;
    return { path: resolved, filename: rec.filename, size: stat.size, record: serialise(rec) };
  } catch {
    return null;
  }
}

function abortControllerFor(rec) {
  if (rec.controller) {
    try { rec.controller.abort(); } catch { /* ignore */ }
    rec.controller = null;
  }
}

async function removeFile(filePath) {
  try { await fsp.unlink(filePath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

async function removeDownload(id) {
  const rec = downloads.get(id);
  if (!rec) return false;
  rec.removed = true;
  abortControllerFor(rec);
  downloads.delete(id);
  await Promise.all([removeFile(rec.filePath), removeFile(rec.filePath + PART_SUFFIX)]);
  persistSoon();
  drainQueue();
  return true;
}

function pauseDownload(id) {
  const rec = downloads.get(id);
  if (!rec || !['queued', 'downloading'].includes(rec.status)) return false;
  rec.status = 'paused';
  rec.speed = 0;
  rec.updatedAt = now();
  abortControllerFor(rec);
  persistSoon();
  drainQueue();
  return true;
}

function resumeDownload(id) {
  const rec = downloads.get(id);
  if (!rec || !['paused', 'failed', 'cancelled'].includes(rec.status)) return false;
  rec.status = 'queued';
  rec.error = null;
  rec.speed = 0;
  rec.updatedAt = now();
  persistSoon();
  drainQueue();
  return true;
}

function cancelDownload(id) {
  const rec = downloads.get(id);
  if (!rec || rec.status === 'completed' || rec.status === 'cancelled') return false;
  rec.status = 'cancelled';
  rec.error = 'cancelled';
  rec.speed = 0;
  rec.updatedAt = now();
  abortControllerFor(rec);
  persistSoon();
  drainQueue();
  return true;
}

/** Kick off as many queued downloads as the concurrency cap allows. */
function drainQueue() {
  const running = [...downloads.values()].filter((rec) => rec.status === 'downloading').length;
  let slots = MAX_CONCURRENT - running;
  if (slots <= 0) return;
  for (const rec of [...downloads.values()].filter((entry) => entry.status === 'queued')) {
    if (slots <= 0) break;
    slots--;
    rec.status = 'downloading';
    rec.updatedAt = now();
    rec.startTime = now();
    runDownload(rec).catch((err) => {
      console.error('[Downloads] Unexpected worker failure:', err.message);
    });
  }
}

function updateProgress(rec, force = false) {
  const t = now();
  if (!force) {
    if (rec.totalBytes && rec.totalBytes > 0) {
      rec.progress = clamp(Math.round((rec.downloadedBytes / rec.totalBytes) * 100), 0, 99);
    }
    if (rec.lastSampleTime) {
      const dt = Math.max(t - rec.lastSampleTime, 1);
      const delta = Math.max(rec.downloadedBytes - (rec.lastSampleBytes || 0), 0);
      const instant = delta / (dt / 1000);
      rec.speed = rec.speed * 0.7 + instant * 0.3;
    }
    rec.lastSampleTime = t;
    rec.lastSampleBytes = rec.downloadedBytes;
    rec.updatedAt = t;
    if (t - (rec.lastPersistAt || 0) > 2000) {
      rec.lastPersistAt = t;
      persistSoon();
    }
  }
}

function parseContentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

/** Execute a single download. */
async function runDownload(rec, retried = false) {
  const controller = new AbortController();
  rec.controller = controller;
  rec.error = null;
  rec.speed = 0;
  rec.updatedAt = now();

  const partPath = rec.filePath + PART_SUFFIX;
  const finish = (status, error) => {
    rec.status = status;
    rec.error = error || null;
    rec.speed = 0;
    rec.updatedAt = now();
    if (status === 'completed') rec.completedAt = now();
    persistSoon();
    if (!['paused', 'cancelled'].includes(status)) drainQueue();
  };

  try {
    // Reconcile the resume offset with the actual partial file on disk.
    if (rec.downloadedBytes > 0) {
      try {
        const stat = fs.statSync(partPath);
        rec.downloadedBytes = stat.size;
      } catch {
        rec.downloadedBytes = 0;
      }
    }

    if (rec.totalBytes && rec.downloadedBytes >= rec.totalBytes) {
      await fsp.rename(partPath, rec.filePath);
      rec.downloadedBytes = rec.totalBytes;
      rec.progress = 100;
      finish('completed', null);
      return;
    }

    const requestedRange = rec.downloadedBytes > 0;
    const response = await safeFetch(rec.url, {
      headers: buildHeaders(rec, rec.downloadedBytes),
      signal: controller.signal,
    });

    if (response.status === 416 && requestedRange && !retried) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      rec.downloadedBytes = 0;
      rec.progress = 0;
      await removeFile(partPath);
      rec.controller = null;
      return runDownload(rec, true);
    }

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`Upstream returned HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new Error('URL returned a web page instead of a media file');
    }
    if (/\.m3u8(?:[?#]|$)/i.test(rec.url) || contentType.includes('application/vnd.apple.mpegurl')) {
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw new Error('HLS playlists cannot be queued as a single file; use the direct download link');
    }
    if (!response.body) {
      throw new Error('Upstream returned an empty response');
    }

    const range = parseContentRange(response.headers.get('content-range'));
    const contentLength = Number(response.headers.get('content-length'));
    let baseBytes = rec.downloadedBytes;

    if (requestedRange && response.status !== 206) {
      // Upstream ignored Range and sent the whole file: restart from zero.
      baseBytes = 0;
      rec.downloadedBytes = 0;
    } else if (range && range.start !== baseBytes) {
      // The server returned a different range than requested; trust its start.
      baseBytes = range.start;
      rec.downloadedBytes = range.start;
    }

    if (range?.total) rec.totalBytes = range.total;
    else if (Number.isFinite(contentLength) && contentLength > 0) rec.totalBytes = baseBytes + contentLength;

    const writeStream = fs.createWriteStream(partPath, { flags: baseBytes > 0 ? 'a' : 'w' });
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        rec.downloadedBytes += chunk.length;
        updateProgress(rec);
        callback(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(response.body), counter, writeStream);

    const stat = await fsp.stat(partPath);
    if (stat.size === 0) throw new Error('Upstream returned an empty file');
    if (rec.totalBytes && stat.size < rec.totalBytes) {
      throw new Error(`Transfer ended early (${stat.size} of ${rec.totalBytes} bytes)`);
    }
    await fsp.rename(partPath, rec.filePath);
    rec.downloadedBytes = stat.size;
    rec.totalBytes = stat.size;
    rec.progress = 100;
    rec.controller = null;
    finish('completed', null);
  } catch (err) {
    if (rec.removed) {
      // removeDownload() already unlinked the partial file. A streaming write
      // may recreate it just after that unlink, so clean it up again.
      try { await removeFile(partPath); } catch { /* best effort */ }
      return;
    }
    if (rec.status === 'paused' || rec.status === 'cancelled') {
      // Caller already updated the record and persisted it.
      return;
    }
    let message = err instanceof Error ? err.message : String(err);
    if (err?.name === 'AbortError') message = 'Download was interrupted';
    else if (/^(terminated|aborted)$/i.test(message)) message = 'Transfer ended early before the file was complete';
    finish('failed', message.slice(0, 400));
  } finally {
    if (rec.controller === controller) rec.controller = null;
  }
}

module.exports = {
  enqueueDownloads,
  getDownload,
  getAllDownloads,
  getDownloadFile,
  removeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  flushDownloads,
  drainQueue,
  serialise,
  MAX_CONCURRENT,
  MAX_ITEMS_PER_REQUEST,
  DOWNLOAD_DIR,
};
