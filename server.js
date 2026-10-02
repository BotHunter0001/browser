const express = require('express');
const path = require('path');
const { searchAll, getDetails, getStreams, getEpisodeStreams, getProvidersList, getCatalogHomepage, registry } = require('./providers');
const { safeFetch } = require('./lib/netGuard');
const { TTLCache } = require('./lib/cache');

const searchCache = new TTLCache({ ttlMs: 10 * 60 * 1000, max: 300 });
const detailsCache = new TTLCache({ ttlMs: 30 * 60 * 1000, max: 500 });
const streamsCache = new TTLCache({ ttlMs: 3 * 60 * 1000, max: 300 });
const catalogCache = new TTLCache({ ttlMs: 15 * 60 * 1000, max: 200 });

const app = express();
// Read port/host from environment (falls back to defaults via .env-style usage)
const PORT = parseInt(process.env.PORT, 10) || 3000;
// Default to 0.0.0.0 to allow container and preview access
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

// Very small per-IP rate limiter for the expensive API routes
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path.split('/')[2];
    const now = Date.now();
    const e = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > e.reset) { e.n = 0; e.reset = now + windowMs; }
    e.n++;
    hits.set(key, e);
    if (e.n > max) return res.status(429).json({ error: 'Too many requests, slow down.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, 60000).unref();

const PROVIDER_RE = /^[a-z0-9_-]{1,40}$/i;
function cleanProvider(p, fallback) {
  const v = String(p || '').trim();
  return PROVIDER_RE.test(v) ? v : fallback;
}
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : Math.min(max, Math.max(min, n));
}
function sendError(res, status, publicMsg, err) {
  console.error(`[${publicMsg}]`, err?.message || err);
  if (!res.headersSent) res.status(status).json({ error: publicMsg });
}
app.use('/api/search', rateLimit(60, 60000));
app.use(['/api/streams', '/api/resolve-source', '/api/episode-streams'], rateLimit(40, 60000));

// 1. Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Session info stub — returns active provider count for the header badge
app.get('/api/session', (req, res) => {
  const activeCount = Object.values(require('./providers').registry).filter(p => !p.disabled).length;
  res.json({ ok: true, currentHost: null, providers: activeCount, tokenPreview: `${activeCount} providers` });
});

// Gateway rotate stub — no-op for now, returns ok
app.post('/api/hosts/rotate', (req, res) => {
  res.json({ ok: true });
});

// 2. Providers list endpoint
app.get('/api/providers', (req, res) => {
  res.json({
    providers: getProvidersList(),
    count: Object.keys(registry).length,
  });
});

// Vega catalog listings (e.g. MovieBox Web) don't expose movie/series type, so every
// card defaulted to "movie". Resolve the real type from details (bounded concurrency +
// timeout), which also pre-warms the details cache for faster card opens.
const TYPE_ENRICH_TIMEOUT_MS = 6000;
const TYPE_ENRICH_CONCURRENCY = 6;
async function enrichCatalogTypes(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const targets = results.filter((it) => it?.subjectId && registry[it.provider]?.isVega);
  if (!targets.length) return data;

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const item = targets[cursor++];
      try {
        const details = await detailsCache.wrap(`${item.provider}::${item.subjectId}`, () =>
          getDetails(item.subjectId, item.provider)
        );
        if (details?.type === 'movie' || details?.type === 'series') item.type = details.type;
        if (!item.year && details?.year) item.year = details.year;
      } catch {
        // keep heuristic type when details lookup fails
      }
    }
  };
  const timeout = new Promise((resolve) => setTimeout(resolve, TYPE_ENRICH_TIMEOUT_MS).unref());
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(TYPE_ENRICH_CONCURRENCY, targets.length) }, worker)),
    timeout,
  ]);

  if (Array.isArray(data.metas)) {
    const typeById = new Map(results.map((it) => [it.subjectId, it.type]));
    for (const meta of data.metas) {
      const t = typeById.get(meta.id);
      if (t === 'movie' || t === 'series') meta.type = t;
    }
  }
  return data;
}

// 2b. Catalog Homepage endpoint (supports multiple alias paths for maximum client/tester compatibility)
app.get([
  '/api/catalog',
  '/api/catalog/homepage',
  '/api/catalog/home',
  '/api/catalog/trending',
  '/api/catalog/:provider',
  '/catalog/homepage',
  '/catalog/home',
  '/api/home',
  '/api/homepage',
], async (req, res) => {
  const rawProv = cleanProvider(req.params.provider || req.query.provider, 'movieBoxWeb');
  const provider = rawProv === 'all' ? 'movieBoxWeb' : rawProv;
  const filter = String(req.query.filter || req.query.genre || '').trim().slice(0, 100);
  const page = clampInt(req.query.page, 1, 50, 1);

  try {
    const data = await catalogCache.wrap(`catalog::${provider}::${filter}::${page}`, async () =>
      enrichCatalogTypes(await getCatalogHomepage(provider, filter, page))
    );
    res.json({
      ok: true,
      provider: data.provider,
      count: data.count,
      results: data.results,
      metas: data.metas,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to load catalog homepage', err);
  }
});

// Stremio Addon Protocol routes
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'org.cinesphere.browser',
    version: '1.0.0',
    name: 'CineSphere Browser',
    description: 'Unified multi-provider catalog and streaming engine',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
      { type: 'movie', id: 'top', name: 'Top Movies' },
      { type: 'series', id: 'top', name: 'Top Series' },
      { type: 'movie', id: 'trending', name: 'Trending Movies' },
    ],
  });
});

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { type, id } = req.params;
  try {
    const data = await catalogCache.wrap(`stremio::catalog::${type}::${id}`, () =>
      getCatalogHomepage('movieBoxWeb', id === 'top' ? '/' : id, 1)
    );
    res.json({ metas: data.metas });
  } catch (err) {
    sendError(res, 500, 'Failed to load catalog homepage', err);
  }
});

// 3. Multi-provider search endpoint
app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || req.query.query || '').trim().slice(0, 200);
  const rawProv = cleanProvider(req.query.provider, null);
  const provider = rawProv === 'all' ? null : rawProv;
  // Optional genre: movies | anime | drama | hollywood | bollywood
  // Selects which provider priority list sorts the results (movieBoxWeb always top).
  const genre = String(req.query.genre || req.query.type || '').trim().toLowerCase().slice(0, 30) || null;

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const results = await searchCache.wrap(`${provider || 'all'}::${genre || 'auto'}::${query.toLowerCase()}`, () => searchAll(query, provider, genre));
    res.json({
      query,
      provider: provider || 'all',
      genre: genre || 'auto',
      count: results.length,
      results,
    });
  } catch (err) {
    sendError(res, 500, 'Search failed across providers', err);
  }
});

// 4. Details endpoint with provider routing
app.get('/api/details/:id', async (req, res) => {
  const id = String(req.params.id || '').slice(0, 500);
  const provider = cleanProvider(req.query.provider, 'addon');

  if (!id) {
    return res.status(400).json({ error: 'Media ID is required' });
  }

  try {
    const details = await detailsCache.wrap(`${provider}::${id}`, () => getDetails(id, provider));
    res.json(details);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch media details', err);
  }
});

// 5. Streams endpoint with provider routing + automatic provider switching.
// If the requested provider is down or has no sources, other providers are tried
// automatically until playable/downloadable sources are found.
app.get('/api/streams/:id', async (req, res) => {
  const id = String(req.params.id || '').slice(0, 500);
  const provider = cleanProvider(req.query.provider, 'movieBoxWeb');
  const minSources = clampInt(req.query.minSources, 0, 10, 1);
  const maxFallbacks = clampInt(req.query.maxFallbacks, 0, 15, undefined);
  const title = String(req.query.title || '').trim().slice(0, 200);
  const year = req.query.year ? Number(req.query.year) : null;
  const type = String(req.query.type || 'movie').trim().slice(0, 20);

  let alternateSources = [];
  if (req.query.alternateSources) {
    try {
      alternateSources = JSON.parse(req.query.alternateSources);
    } catch {
      alternateSources = [];
    }
  }

  if (!id) {
    return res.status(400).json({ error: 'Media ID is required' });
  }

  try {
    const cacheKey = `${provider}::${id}::${title}::${minSources}`;
    const releases = await streamsCache.wrap(cacheKey, () =>
      getStreams(id, provider, { minSources, maxFallbacks, title, year, type, alternateSources })
    );
    res.json({
      subjectId: id,
      provider,
      count: releases.length,
      releases,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch playback sources', err);
  }
});

app.post('/api/episode-streams', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 200);
  const season = Number(req.body?.season);
  const episode = Number(req.body?.episode);
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 20) : [];

  if (!title || !Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) {
    return res.status(400).json({ error: 'A title, season, and episode are required' });
  }

  try {
    const result = await getEpisodeStreams(title, season, episode, candidates);
    res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to find episode playback sources', err);
  }
});

// Shared helpers for stream/download proxies
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function buildUpstreamHeaders(req, query) {
  const headers = { 'User-Agent': BROWSER_UA };
  if (req.headers.range) headers['Range'] = req.headers.range;
  if (typeof query.cookie === 'string' && query.cookie && !/[\r\n]/.test(query.cookie)) headers['Cookie'] = query.cookie.slice(0, 4096);
  // Providers may attach required headers (e.g. gofile accountToken cookies) to a stream
  let extra = null;
  try {
    extra = JSON.parse(query.headers || 'null');
  } catch {
    extra = null;
  }
  if (extra && typeof extra === 'object') {
    // Only a safe allowlist of headers may be injected by the client
    const ALLOWED = new Set(['referer', 'origin', 'cookie', 'user-agent', 'authorization', 'accept', 'accept-language']);
    for (const [k, v] of Object.entries(extra)) {
      if (ALLOWED.has(k.toLowerCase()) && typeof v === 'string' && v.length > 0 && v.length < 4096 && !/[\r\n]/.test(v)) headers[k] = v;
    }
  }
  return headers;
}

async function pipeStream(upstream, res, req, extraResponseHeaders = []) {
  res.status(upstream.status);

  const hopByHop = new Set(['connection', 'transfer-encoding', 'keep-alive', 'content-encoding']);
  const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', ...extraResponseHeaders];
  for (const h of forward) {
    if (hopByHop.has(h.toLowerCase())) continue;
    const val = upstream.headers.get(h);
    if (val) res.setHeader(h, val);
  }
  // Ensure the browser knows it can seek (some CDNs omit this header)
  if (!res.getHeader('Accept-Ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.body) return res.end();

  // pipeline() respects backpressure (the old manual loop buffered everything
  // in memory when the client was slower than the upstream CDN).
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.name !== 'AbortError') throw err;
  }
}

const BLOCKED_STATUSES = new Set([401, 403, 426, 429]);

// Some CDNs (e.g. MovieBox's hakunaymatata) reject the provider-supplied
// Referer/Origin or block datacenter IPs. Retry once with bare headers, and
// report whether the caller should hand the URL to the browser instead.
async function fetchMediaUpstream(targetUrl, req, signal) {
  let upstream = await safeFetch(targetUrl, { headers: buildUpstreamHeaders(req, req.query), signal });
  if (BLOCKED_STATUSES.has(upstream.status) && (req.query.headers || req.query.cookie)) {
    try { upstream.body?.cancel(); } catch { /* ignore */ }
    const bare = { 'User-Agent': BROWSER_UA };
    if (req.headers.range) bare['Range'] = req.headers.range;
    upstream = await safeFetch(targetUrl, { headers: bare, signal });
  }
  const blocked = !upstream.ok && upstream.status !== 206;
  if (blocked) {
    try { upstream.body?.cancel(); } catch { /* ignore */ }
  }
  return { upstream, blocked };
}

function redirectToDirect(res, targetUrl) {
  if (!/^https?:\/\//i.test(String(targetUrl))) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, targetUrl);
  return true;
}

// Abort the upstream fetch when the client disconnects (video seeking / closing player)
function wireClientAbort(req, res, controller) {
  const abort = () => controller.abort();
  req.on('close', abort);
  res.on('finish', () => req.off('close', abort));
}

// 6. Direct Video Streaming Proxy (Range request support for smooth browser playback)
app.get('/api/proxy-video', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const controller = new AbortController();
    wireClientAbort(req, res, controller);

    const { upstream, blocked } = await fetchMediaUpstream(targetUrl, req, controller.signal);
    if (blocked && redirectToDirect(res, targetUrl)) return;

    await pipeStream(upstream, res, req);
  } catch (err) {
    console.error('[Proxy Video Error]:', err.message);
    if (!res.headersSent) {
      res.status(err.status || 502).send(err.status ? err.message : 'Streaming proxy error');
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// 7. Download route with forced attachment header
app.get('/api/download', async (req, res) => {
  const targetUrl = req.query.url;
  const rawFilename = String(req.query.filename || 'media.mp4').slice(0, 150);

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const controller = new AbortController();
    wireClientAbort(req, res, controller);

    const { upstream, blocked } = await fetchMediaUpstream(targetUrl, req, controller.signal);
    if (blocked && redirectToDirect(res, targetUrl)) return;

    // Force browser download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await pipeStream(upstream, res, req);
  } catch (err) {
    console.error('[Download Proxy Error]:', err.message);
    if (!res.headersSent) {
      res.status(err.status || 502).send(err.status ? err.message : 'Download proxy error');
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Backward-compatible alias for /api/play/:id (also benefits from provider fallback)
app.get('/api/play/:id', async (req, res) => {
  const id = String(req.params.id || '').slice(0, 500);
  const provider = cleanProvider(req.query.provider, 'movieBoxWeb');
  const title = String(req.query.title || '').trim().slice(0, 200);
  const year = req.query.year ? Number(req.query.year) : null;
  const type = String(req.query.type || 'movie').trim().slice(0, 20);
  try {
    const releases = await streamsCache.wrap(`${provider}::${id}::${title}`, () =>
      getStreams(id, provider, { minSources: 1, title, year, type })
    );
    res.json({ subjectId: id, provider, releases });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch playback sources', err);
  }
});

// Auto-resolve the best working source URL across providers.
// Used by the player when a mirror link fails mid-playback or before downloading:
// tries the preferred provider first, then switches to other providers until a
// reachable file is found (HEAD/range probe). Works for both play & download.
app.get('/api/resolve-source', async (req, res) => {
  const id = String(req.query.id || '').trim();
  const provider = cleanProvider(req.query.provider, 'movieBoxWeb');
  const title = String(req.query.title || '').trim().slice(0, 200);
  const year = req.query.year ? Number(req.query.year) : null;
  const type = String(req.query.type || 'movie').trim().slice(0, 20);

  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  try {
    // Gather sources from the preferred provider + fallbacks
    const releases = await getStreams(id, provider, { minSources: 2, maxFallbacks: 8, title, year, type });
    const candidates = [];
    for (const r of releases) {
      for (const m of r.mirrors || []) {
        if (m && m.resolverUrl && !/^https?:\/\/[^/]+\/api\//.test(m.resolverUrl)) {
          candidates.push({ url: m.resolverUrl, headers: m.headers || null, cookie: m.signCookie || '', quality: r.quality, provider: r.provider });
        }
      }
    }

    // Probe each candidate concurrently — first one that responds OK wins
    const probes = candidates.slice(0, 20).map((c) =>
      (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const upstream = await safeFetch(c.url, {
            method: 'GET',
            headers: { ...buildUpstreamHeaders({ headers: {} }, { headers: c.headers ? JSON.stringify(c.headers) : '', cookie: c.cookie }), Range: 'bytes=0-1023' },
            signal: controller.signal,
          });
          const ok = upstream.ok || upstream.status === 206;
          try { upstream.body?.cancel(); } catch { /* ignore */ }
          if (!ok) throw new Error(`HTTP ${upstream.status}`);
          return c;
        } finally {
          clearTimeout(timer);
        }
      })().catch(() => null)
    );

    const settled = await Promise.allSettled(probes);
    const alive = settled
      .filter((s) => s.status === 'fulfilled' && s.value)
      .map((s) => s.value);

    if (alive.length === 0) {
      return res.status(404).json({ error: 'No working source found on any provider', id, provider, tested: candidates.length });
    }

    res.json({ ok: true, id, provider, source: alive[0], alternatives: alive.slice(1, 6) });
  } catch (err) {
    sendError(res, 500, 'Failed to resolve a working source', err);
  }
});

// 8. HLS playlist proxy — rewrites segment/key URIs so hls.js can load them
// through this server instead of going direct (fixes CORS + relative URL issues).
// Works for both master playlists and media playlists.
app.get('/api/proxy-hls', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const controller = new AbortController();
    wireClientAbort(req, res, controller);

    const upstream = await safeFetch(targetUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        ...(req.query.cookie ? { 'Cookie': String(req.query.cookie).slice(0, 4096) } : {}),
      },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send('Upstream HLS error');
    }

    const raw = await upstream.text();

    // Compute the base URL for resolving relative URIs in the playlist.
    const base = new URL(targetUrl);
    const baseDir = targetUrl.slice(0, targetUrl.lastIndexOf('/') + 1);

    /**
     * Make any URI in the playlist absolute and then rewrite it so it routes
     * through either /api/proxy-hls (for nested .m3u8 playlists) or
     * /api/proxy-video (for .ts segments, .aac, .mp4, encryption keys, etc.).
     */
    function rewriteUri(uri) {
      if (!uri || uri.startsWith('#')) return uri;
      uri = uri.trim();
      // Already absolute?
      let absolute;
      if (/^https?:\/\//i.test(uri)) {
        absolute = uri;
      } else if (uri.startsWith('//')) {
        absolute = base.protocol + uri;
      } else if (uri.startsWith('/')) {
        absolute = `${base.protocol}//${base.host}${uri}`;
      } else {
        absolute = baseDir + uri;
      }

      // Route sub-playlists through proxy-hls, everything else through proxy-video
      const isPlaylist = /\.m3u8(\?|#|$)/i.test(absolute);
      const proxyBase = isPlaylist ? '/api/proxy-hls' : '/api/proxy-video';
      return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
    }

    // Rewrite the M3U8 line by line.
    const rewritten = raw.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#EXT-X-VERSION') || trimmed.startsWith('#EXTM3U')) return line;

      // URI= attribute inside tags like #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
      if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewriteUri(uri)}"`);
      }

      // Plain segment / sub-playlist lines (not starting with #)
      if (!trimmed.startsWith('#')) {
        return rewriteUri(trimmed);
      }

      return line;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rewritten);
  } catch (err) {
    console.error('[Proxy HLS Error]:', err.message);
    if (!res.headersSent) res.status(err.status || 502).send(err.status ? err.message : 'HLS proxy error');
  }
});

// 9. Subtitle proxy with on-the-fly SRT → WebVTT conversion.
// Browsers only render <track> elements pointing at WebVTT; most scrapers
// serve SRT. This endpoint auto-detects format and converts when needed.
app.get('/api/subtitle', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const upstream = await safeFetch(targetUrl, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) return res.status(upstream.status).send('Subtitle fetch failed');

    const raw = await upstream.text();
    const ct = upstream.headers.get('content-type') || '';

    let vtt;
    if (ct.includes('vtt') || raw.trimStart().startsWith('WEBVTT')) {
      // Already WebVTT
      vtt = raw;
    } else {
      // Treat as SRT and convert:
      // 1. Add WebVTT header
      // 2. Strip numeric-only cue counters (lines that are just a number)
      // 3. Replace comma decimal separator in timestamps with dot
      //    (SRT: 00:01:23,456 → VTT: 00:01:23.456)
      vtt = 'WEBVTT\n\n' + raw
        .replace(/\r\n/g, '\n')
        .replace(/^\d+\n/gm, '')            // remove cue index lines
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); // comma → dot
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(vtt);
  } catch (err) {
    console.error('[Subtitle Proxy Error]:', err.message);
    if (!res.headersSent) res.status(err.status || 502).send(err.status ? err.message : 'Subtitle proxy error');
  }
});

// 10. Poster proxy — serves poster images through the server to avoid
// mixed-content failures on HTTPS and referer-blocked CDN images.
// Short TTL in-memory cache keeps repeat requests free.
const posterCache = new TTLCache({ ttlMs: 10 * 60 * 1000, max: 500 });

app.get('/api/poster', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  // Check cache (store raw Buffer + content-type)
  const cached = posterCache.get(targetUrl);
  if (cached) {
    res.setHeader('Content-Type', cached.ct);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached.buf);
  }

  try {
    const upstream = await safeFetch(targetUrl, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'image/*' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) return res.status(upstream.status).send('Poster fetch failed');

    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return res.status(415).send('Not an image');

    const buf = Buffer.from(await upstream.arrayBuffer());
    posterCache.set(targetUrl, { buf, ct });

    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('X-Cache', 'MISS');
    res.send(buf);
  } catch (err) {
    console.error('[Poster Proxy Error]:', err.message);
    if (!res.headersSent) res.status(err.status || 502).send(err.status ? err.message : 'Poster proxy error');
  }
});

// Unknown API routes -> JSON 404 (not the HTML page)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback for HTML5 routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`CineSphere Browser running at http://${HOST}:${PORT}`);
});
server.requestTimeout = 0; // long video streams must not be cut off
server.headersTimeout = 30000;

process.on('unhandledRejection', (err) => console.error('[Unhandled Rejection]', err));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
