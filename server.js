const express = require('express');
const path = require('path');
const { searchAll, getDetails, getStreams, getEpisodeStreams, getProvidersList, getCatalogHomepage, registry } = require('./providers');
const { safeFetch, assertSafeUrl } = require('./lib/netGuard');
const { probePlayableSource } = require('./lib/mediaProbe');
const { wireClientAbort } = require('./lib/clientAbort');
const { TTLCache } = require('./lib/cache');
const {
  enqueueDownloads,
  getDownload,
  getAllDownloads,
  getDownloadFile,
  removeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  flushDownloads,
  MAX_ITEMS_PER_REQUEST,
} = require('./lib/downloads');

const searchCache = new TTLCache({ ttlMs: 10 * 60 * 1000, max: 300 });
const detailsCache = new TTLCache({ ttlMs: 30 * 60 * 1000, max: 500 });
const streamsCache = new TTLCache({ ttlMs: 3 * 60 * 1000, max: 300 });
const catalogCache = new TTLCache({ ttlMs: 15 * 60 * 1000, max: 200 });
const suggestionsCache = new TTLCache({ ttlMs: 15 * 60 * 1000, max: 300 });

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const app = express();
// Read port/host from environment. The default binding is localhost intentionally;
// remote exposure must be configured explicitly.
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self' https: http: data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ');

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Reject cross-site state-changing API calls. The app has no authentication,
// so at minimum a random website must not be able to POST to the local server.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return res.status(403).json({ error: 'Cross-site request rejected' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ error: 'Cross-origin request rejected' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid origin' });
    }
  }
  next();
});

// Fingerprinted assets are not used, so keep HTML uncached while allowing
// short-lived browser caching for CSS/JS to avoid a full refetch on each page.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '5m',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

// Very small per-IP rate limiter for the expensive API routes
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const routeKey = String(req.baseUrl || req.path || '/').replace(/\/+$/, '') || '/';
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${clientIp}:${routeKey}`;
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
  const effectiveStatus = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500
    ? err.status
    : status;
  const message = effectiveStatus === status ? publicMsg : String(err?.message || publicMsg);
  console.error(`[${publicMsg}]`, err?.message || err);
  if (!res.headersSent) res.status(effectiveStatus).json({ error: message });
}
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
/**
 * Provider IDs may be absolute URLs (shared scraper links). Validate the first
 * hop before handing the value to a provider, otherwise a caller can point
 * arbitrary provider fetchers at loopback/link-local/metadata services.
 */
async function guardProviderReference(value, label = 'Provider') {
  const reference = String(value || '').trim();
  if (!/^https?:\/\//i.test(reference)) return reference;
  try {
    await assertSafeUrl(reference);
  } catch {
    throw badRequest(`${label} reference is not allowed`);
  }
  return reference;
}
function buildStreamsCacheKey({ provider, id, title, year, type, minSources, alternateSources = [] }) {
  return JSON.stringify([provider, id, title, year, type, minSources, alternateSources]);
}
app.use(['/api/search', '/api/suggestions'], rateLimit(60, 60000));
app.use(['/api/streams', '/api/resolve-source', '/api/episode-streams'], rateLimit(40, 60000));
app.use('/api/downloads', rateLimit(180, 60000));

// 1. Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Session metadata is intentionally minimal: there is no real authenticated
// gateway/session system in this project. Expose the supported state accurately
// instead of advertising a fake token or host rotation capability.
app.get('/api/session', (req, res) => {
  const activeCount = Object.values(require('./providers').registry).filter(p => !p.disabled).length;
  res.json({
    ok: true,
    currentHost: null,
    providers: activeCount,
    tokenPreview: null,
    gatewayStatus: 'unsupported',
    note: 'No authenticated gateway session is configured for this instance.'
  });
});

// Host rotation is unsupported by the current app and should not masquerade as a
// real network rotation feature. Returning a clear unsupported response avoids
// misleading front-end or operators into believing rotation is functional.
app.post('/api/hosts/rotate', (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Host rotation is not implemented for this deployment.',
    gatewayStatus: 'unsupported'
  });
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
const TYPE_ENRICH_CONCURRENCY = 6;
const TYPE_ENRICH_DETAIL_TIMEOUT_MS = 3500;
const TYPE_ENRICH_TOTAL_BUDGET_MS = 6500;

function hasUsableMediaDetails(details) {
  const title = String(details?.title || '').trim();
  return Boolean(
    title &&
    !title.startsWith('/') &&
    !/^https?:\/\//i.test(title) &&
    !/^(?:404(?:\s+not found)?|page not found|not found|unknown title|untitled|n\/a|oops[!,.]?\s+that page\b)/i.test(title)
  );
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'Operation timed out')), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

async function enrichVegaTypes(items) {
  // Catalog requests already know whether a shelf is movies or series, so only
  // enrich entries whose type is unknown. This avoids dozens of detail fetches
  // on every homepage load (the previous behaviour could hang for minutes).
  const targets = items.filter((item) =>
    item?.subjectId &&
    item.provider === 'movieBoxWeb' &&
    !item.typeVerified &&
    /^\/moviesDetail\//i.test(String(item.subjectId))
  );

  const deadline = Date.now() + TYPE_ENRICH_TOTAL_BUDGET_MS;
  let cursor = 0;
  let complete = true;
  const worker = async () => {
    while (cursor < targets.length && Date.now() < deadline) {
      const item = targets[cursor++];
      try {
        const details = await withTimeout(
          detailsCache.wrap(`${item.provider}::${item.subjectId}`, () =>
            registry[item.provider].instance.details(item.subjectId)
          ),
          TYPE_ENRICH_DETAIL_TIMEOUT_MS,
          'Details enrichment timed out'
        );
        if (!hasUsableMediaDetails(details)) throw new Error('Provider returned unusable details');
        if (details.type === 'movie' || details.type === 'series') item.type = details.type;
        else {
          item.type = 'unknown';
          complete = false;
        }
        if (!item.year && details?.year) item.year = details.year;
        if (!item.country && details?.country) item.country = details.country;
        if (Array.isArray(details?.genres)) item.genres = details.genres;
      } catch {
        item.type = 'unknown';
        complete = false;
      }
    }
  };
  if (targets.length) {
    await Promise.all(Array.from({ length: Math.min(TYPE_ENRICH_CONCURRENCY, targets.length) }, worker));
  }
  if (cursor < targets.length) complete = false;
  return complete;
}

async function enrichCatalogTypes(data, genre = null) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const typesVerified = await enrichVegaTypes(results);

  if (genre === 'drama') {
    const asianRegions = new Set([
      'china', 'chinese', 'hong kong', 'india', 'indian', 'indonesia', 'indonesian',
      'japan', 'japanese', 'korea', 'south korea', 'korean', 'malaysia', 'malaysian',
      'philippines', 'philippine', 'singapore', 'taiwan', 'taiwanese', 'thailand',
      'thai', 'vietnam', 'vietnamese',
    ]);
    data.results = results.filter((item) =>
      item.type === 'series' &&
      (
        asianRegions.has(String(item.country || '').trim().toLowerCase()) ||
        (item.genres || []).some((tag) => asianRegions.has(String(tag).trim().toLowerCase()))
      )
    );
    const visibleIds = new Set(data.results.map((item) => item.subjectId));
    data.count = data.results.length;
    if (Array.isArray(data.metas)) {
      data.metas = data.metas.filter((meta) => visibleIds.has(meta.id));
    }
  }

  if (Array.isArray(data.metas)) {
    const itemById = new Map(results.map((item) => [item.subjectId, item]));
    for (const meta of data.metas) {
      const item = itemById.get(meta.id);
      if (item?.type === 'movie' || item?.type === 'series') meta.type = item.type;
      if (item?.year) meta.year = item.year;
      if (item?.country) meta.country = item.country;
      if (Array.isArray(item?.genres)) meta.genres = item.genres;
    }
  }
  data.typesVerified = typesVerified;
  return data;
}

// 2b. Multi-category catalog shelves (Vega Home Rows)
app.get(['/api/catalog/rows', '/api/rows'], async (_req, res) => {
  try {
    const cached = await catalogCache.wrap('catalog::rows::all', async () => {
      const rowDefinitions = [
        { id: 'trending-movies', title: 'Trending Movies', provider: 'movieBoxWeb', filter: '/newWeb/movie', genre: 'movies' },
        { id: 'popular-series', title: 'Popular TV Series', provider: 'movieBoxWeb', filter: '/newWeb/tv-series', genre: 'series' },
        { id: 'top-anime', title: 'Top Anime', provider: 'anikoto', filter: '/most-viewed', genre: 'anime' },
        { id: 'asian-drama', title: 'Asian Drama', provider: 'all', filter: '', genre: 'drama' },
      ];

      const loaded = await Promise.allSettled(rowDefinitions.map(async (row) => {
        try {
          const cat = await getCatalogHomepage(row.provider, row.filter, 1, row.genre);
          const enriched = await enrichCatalogTypes(cat, row.genre);
          return {
            id: row.id,
            title: row.title,
            genre: row.genre,
            provider: row.provider,
            items: enriched.results || [],
          };
        } catch (err) {
          console.warn(`[CatalogRows] Failed to load row "${row.title}":`, err.message);
          return {
            id: row.id,
            title: row.title,
            genre: row.genre,
            provider: row.provider,
            items: [],
          };
        }
      }));

      return loaded
        .filter((r) => r.status === 'fulfilled' && r.value.items.length > 0)
        .map((r) => r.value);
    });

    res.json({ ok: true, rows: cached || [] });
  } catch (err) {
    sendError(res, 500, 'Failed to load catalog rows', err);
  }
});

// 2c. Catalog Homepage endpoint (supports multiple alias paths for maximum client/tester compatibility)
app.get([
  // Static aliases must be registered before /api/catalog/:provider; otherwise
  // "homepage", "home" and "trending" are consumed as provider names.
  '/api/catalog',
  '/api/catalog/homepage',
  '/api/catalog/home',
  '/api/catalog/trending',
  '/catalog/homepage',
  '/catalog/home',
  '/api/home',
  '/api/homepage',
  '/api/catalog/:provider',
], async (req, res) => {
  const rawProv = cleanProvider(req.params.provider || req.query.provider, null);
  const genre = String(req.query.genre || req.query.type || '').trim().toLowerCase().slice(0, 30);
  let provider = rawProv && rawProv !== 'all' ? rawProv : 'movieBoxWeb';
  if ((!rawProv || rawProv === 'all') && genre === 'anime') provider = 'anikoto';
  if ((!rawProv || rawProv === 'all') && genre === 'drama') provider = 'all';
  const filter = String(req.query.filter || (genre === 'drama' ? '' : genre)).trim().slice(0, 100);
  const page = clampInt(req.query.page, 1, 50, 1);
  if (/^https?:\/\//i.test(filter)) {
    return res.status(400).json({ error: 'Absolute catalog filters are not allowed' });
  }

  try {
    const data = await catalogCache.wrap(
      `catalog::${provider}::${genre}::${filter}::${page}`,
      async () => enrichCatalogTypes(await getCatalogHomepage(provider, filter, page, genre), genre),
      undefined,
      (catalog) => catalog.count > 0 && catalog.typesVerified
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
    description: 'Unified multi-provider catalog browser (Stremio catalog bridge)',
    // Only advertise resources that are actually implemented. Meta/stream
    // handlers are intentionally omitted until provider IDs can round-trip
    // through the Stremio protocol safely.
    resources: ['catalog'],
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
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'Unsupported catalog type' });
  }
  if (!['top', 'trending'].includes(id)) {
    return res.status(404).json({ error: 'Unknown catalog id' });
  }
  const filter = type === 'series' ? '/newWeb/tv-series' : '/newWeb/movie';
  try {
    const data = await catalogCache.wrap(`stremio::catalog::${type}::${id}`, () =>
      getCatalogHomepage('movieBoxWeb', filter, 1)
    );
    const metas = (data.metas || [])
      .filter((meta) => !meta.type || meta.type === type)
      .map((meta) => ({ ...meta, type }));
    res.json({ metas });
  } catch (err) {
    sendError(res, 500, 'Failed to load catalog homepage', err);
  }
});

// 3. Multi-provider search endpoint
app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || req.query.query || '').trim().slice(0, 200);
  const rawProv = cleanProvider(req.query.provider, null);
  const provider = rawProv === 'all' ? null : rawProv;
  const page = clampInt(req.query.page, 1, 50, 1);
  // Optional genre: movies | anime | drama | hollywood | bollywood
  // Selects which provider priority list sorts the results (movieBoxWeb always top).
  const genre = String(req.query.genre || req.query.type || '').trim().toLowerCase().slice(0, 30) || null;

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const cached = await searchCache.wrap(
      `${provider || 'all'}::${genre || 'auto'}::${page}::${query.toLowerCase()}`,
      async () => {
        const results = await searchAll(query, provider, genre, page);
        const complete = await enrichVegaTypes(results);
        return { results, complete };
      },
      undefined,
      (value) => value.complete && Array.isArray(value.results) && value.results.length > 0
    );
    const results = cached.results;
    res.json({
      query,
      provider: provider || 'all',
      genre: genre || 'auto',
      page,
      hasMore: results.length > 0,
      count: results.length,
      results,
    });
  } catch (err) {
    sendError(res, 500, 'Search failed across providers', err);
  }
});

// 3b. Search suggestions (Vega IMDb autocomplete)
app.get('/api/suggestions', async (req, res) => {
  const q = String(req.query.q || req.query.query || '').trim();
  if (q.length < 2) {
    return res.json({ suggestions: [] });
  }

  try {
    const list = await suggestionsCache.wrap(`sug::${q.toLowerCase()}`, async () => {
      const clean = q.toLowerCase();
      const firstChar = /^[a-z0-9]/.test(clean) ? clean.charAt(0) : 'x';
      const url = `https://v3.sg.media-imdb.com/suggestion/titles/${encodeURIComponent(firstChar)}/${encodeURIComponent(clean)}.json`;

      const response = await safeFetch(url, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return [];

      const json = await response.json();
      const items = json?.d;
      if (!Array.isArray(items)) return [];

      const results = [];
      const seen = new Set();
      for (const item of items) {
        const title = item?.l?.trim();
        if (!title) continue;
        const norm = (item.id || title).toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);

        const itemQ = String(item?.q || '').toLowerCase();
        const itemQid = String(item?.qid || '').toLowerCase();
        const isTv = itemQid.startsWith('tv') || itemQid.includes('series') || itemQ.includes('tv') || itemQ.includes('series');

        results.push({
          id: item.id || norm,
          title,
          type: isTv ? 'series' : 'movie',
          year: item?.y || null,
          poster: typeof item?.i?.imageUrl === 'string' ? item.i.imageUrl : null,
        });
        if (results.length >= 8) break;
      }
      return results;
    });

    res.json({ suggestions: list || [] });
  } catch {
    res.json({ suggestions: [] });
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
    await guardProviderReference(id, 'Media');
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
    await guardProviderReference(id, 'Media');
    alternateSources = await Promise.all((Array.isArray(alternateSources) ? alternateSources : [])
      .slice(0, 20)
      .map(async (source) => (
        source?.subjectId
          ? { ...source, subjectId: await guardProviderReference(source.subjectId, 'Alternate media') }
          : source
      )));
    const cacheKey = buildStreamsCacheKey({ provider, id, title, year, type, minSources, alternateSources });
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
    const guardedCandidates = await Promise.all(candidates.map(async (candidate) => (
      candidate?.subjectId
        ? { ...candidate, subjectId: await guardProviderReference(candidate.subjectId, 'Episode candidate') }
        : candidate
    )));
    const result = await getEpisodeStreams(title, season, episode, guardedCandidates);
    res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to find episode playback sources', err);
  }
});

// Shared helpers for stream/download proxies
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
  // Node's fetch transparently decompresses bodies. Forwarding the compressed
  // content-length in that case makes browsers wait forever for missing bytes.
  const contentEncoding = String(upstream.headers.get('content-encoding') || '').toLowerCase();
  const skipLength = contentEncoding && contentEncoding !== 'identity';
  const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', ...extraResponseHeaders];
  for (const h of forward) {
    if (hopByHop.has(h.toLowerCase())) continue;
    if (skipLength && h.toLowerCase() === 'content-length') continue;
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

async function readBodyLimited(upstream, maxBytes) {
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    const error = new Error('Upstream response is too large');
    error.status = 413;
    throw error;
  }
  if (!upstream.body) return Buffer.alloc(0);

  const reader = upstream.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        const error = new Error('Upstream response is too large');
        error.status = 413;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks, total);
}

const BLOCKED_STATUSES = new Set([401, 403, 426, 429]);
const DIRECT_REDIRECT_STATUSES = new Set([401, 403, 426, 429]);

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
  const blocked = DIRECT_REDIRECT_STATUSES.has(upstream.status);
  if (blocked) {
    try { upstream.body?.cancel(); } catch { /* ignore */ }
  }
  return { upstream, blocked };
}

function redirectToDirect(res, targetUrl) {
  if (!/^https?:\/\//i.test(String(targetUrl))) return false;
  try {
    const validated = new URL(String(targetUrl));
    if (!['http:', 'https:'].includes(validated.protocol)) return false;
  } catch {
    return false;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, targetUrl);
  return true;
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
    await guardProviderReference(id, 'Media');
    const cacheKey = buildStreamsCacheKey({ provider, id, title, year, type, minSources: 1 });
    const releases = await streamsCache.wrap(cacheKey, () =>
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
    await guardProviderReference(id, 'Media');
    // Gather sources from the preferred provider + fallbacks
    const releases = await getStreams(id, provider, { minSources: 2, maxFallbacks: 8, title, year, type });
    const candidates = [];
    for (const r of releases) {
      for (const m of r.mirrors || []) {
        if (m && m.resolverUrl && !/^https?:\/\/[^/]+\/api\//.test(m.resolverUrl)) {
          candidates.push({ url: m.resolverUrl, headers: m.headers || null, cookie: m.signCookie || '', quality: r.quality, provider: r.provider, type: m.type || m.streamType || r.codec || '' });
        }
      }
    }

    // Probe actual media bytes, not just a URL that returns HTTP 200. The
    // shared probe rejects challenge pages, images and invalid HLS playlists,
    // and annotates real HLS sources so the player can choose the right path.
    const probes = candidates.slice(0, 20).map((candidate) =>
      probePlayableSource(candidate, { timeoutMs: 15000 })
    );

    const settled = await Promise.allSettled(probes);
    const alive = settled
      .filter((s) => s.status === 'fulfilled' && s.value)
      .map((s) => s.value);

    if (alive.length === 0) {
      const reasons = settled
        .filter((s) => s.status === 'rejected')
        .slice(0, 3)
        .map((s) => String(s.reason?.message || s.reason).slice(0, 120));
      console.warn(`[resolve-source] No playable source for ${provider} (${candidates.length} tested): ${reasons.join(' | ')}`);
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
      headers: buildUpstreamHeaders(req, req.query),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send('Upstream HLS error');
    }

    // Playlists should be small; cap the response so a hostile upstream cannot
    // exhaust process memory. Use the final redirect URL as the base so
    // relative segment paths resolve against the document that was served.
    const raw = (await readBodyLimited(upstream, 5 * 1024 * 1024)).toString('utf8');

    // Compute the base URL for resolving relative URIs in the playlist without
    // losing query parameters or path segments from the upstream source.
    const base = new URL(upstream.url || targetUrl);

    /**
     * Make any URI in the playlist absolute and then rewrite it so it routes
     * through either /api/proxy-hls (for nested .m3u8 playlists) or
     * /api/proxy-video (for .ts segments, .aac, .mp4, encryption keys, etc.).
     */
    function rewriteUri(uri) {
      if (!uri || uri.startsWith('#')) return uri;
      uri = uri.trim();

      let absolute;
      try {
        absolute = new URL(uri, base).toString();
      } catch {
        return uri;
      }

      // Route sub-playlists through proxy-hls, everything else through proxy-video
      const isPlaylist = /\.m3u8(\?|#|$)/i.test(absolute);
      const proxyBase = isPlaylist ? '/api/proxy-hls' : '/api/proxy-video';
      const params = new URLSearchParams({ url: absolute });
      if (typeof req.query.cookie === 'string' && req.query.cookie) {
        params.set('cookie', req.query.cookie.slice(0, 4096));
      }
      if (typeof req.query.headers === 'string' && req.query.headers) {
        params.set('headers', req.query.headers.slice(0, 8192));
      }
      return `${proxyBase}?${params.toString()}`;
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
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/vtt, text/plain, */*' },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) return res.status(upstream.status).send('Subtitle fetch failed');

    if (!upstream.body) return res.status(502).send('Subtitle response has no body');
    const maxBytes = 2 * 1024 * 1024;
    const reader = upstream.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return res.status(413).send('Subtitle file is too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
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
        .replace(/\r\n?/g, '\n')
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

    const buf = await readBodyLimited(upstream, 10 * 1024 * 1024);
    if (!buf.length) return res.status(502).send('Poster response is empty');
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

// 11. Download manager (Vega-inspired). Reuses existing stream resolverUrls;
// supports enqueue / pause / resume / cancel with progress + speed tracking.
app.post('/api/downloads', async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body) ? req.body : [req.body];
    if (rawItems.length === 0 || rawItems.length > MAX_ITEMS_PER_REQUEST) {
      return res.status(400).json({ error: `Provide between 1 and ${MAX_ITEMS_PER_REQUEST} downloads` });
    }

    const items = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') {
        return res.status(400).json({ error: 'Each download must be an object' });
      }
      const url = String(raw.url || '').trim();
      if (!url) return res.status(400).json({ error: 'Each download requires a url' });
      try {
        await assertSafeUrl(url);
      } catch (err) {
        return res.status(400).json({ error: `Download URL is not allowed: ${err.message}` });
      }
      items.push({ ...raw, url });
    }

    const created = enqueueDownloads(items);
    res.status(201).json({ downloads: created });
  } catch (err) {
    sendError(res, 500, 'Failed to enqueue download', err);
  }
});

app.get('/api/downloads', (_req, res) => {
  res.json({ downloads: getAllDownloads() });
});

app.get('/api/downloads/:id/file', (req, res) => {
  const file = getDownloadFile(String(req.params.id));
  if (!file) return res.status(404).json({ error: 'Completed download file not found' });
  res.download(file.path, file.filename, (err) => {
    if (err && !res.headersSent) {
      console.error('[Download File Error]:', err.message);
      res.status(500).json({ error: 'Could not send downloaded file' });
    }
  });
});

app.get('/api/downloads/:id', (req, res) => {
  const item = getDownload(String(req.params.id));
  if (!item) return res.status(404).json({ error: 'Download not found' });
  res.json({ download: item });
});

app.post('/api/downloads/:id/pause', (req, res) => {
  const ok = pauseDownload(String(req.params.id));
  if (!ok) return res.status(409).json({ error: 'Download cannot be paused' });
  res.json({ ok: true });
});

app.post('/api/downloads/:id/resume', (req, res) => {
  const ok = resumeDownload(String(req.params.id));
  if (!ok) return res.status(409).json({ error: 'Download cannot be resumed' });
  res.json({ ok: true });
});

app.post('/api/downloads/:id/cancel', (req, res) => {
  const ok = cancelDownload(String(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Download not found' });
  res.json({ ok: true });
});

app.delete('/api/downloads/:id', async (req, res) => {
  try {
    const ok = await removeDownload(String(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Download not found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 500, 'Could not remove download', err);
  }
});

// Unknown API routes -> JSON 404 (not the HTML page)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback for HTML5 routing. Do not return the HTML shell for missing
// assets or non-HTML clients (that used to produce 200 text/html for /x.js).
app.use((req, res) => {
  // Missing assets must 404 even when the browser sends Accept: text/html.
  // Only extensionless client-side routes should receive the SPA shell.
  if (req.method !== 'GET' || path.extname(req.path) || !req.accepts('html')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`CineSphere Browser running at http://${HOST}:${PORT}`);
});
// requestTimeout covers receiving the request, not streaming the response, so
// long media playback is unaffected while slow-body uploads still time out.
server.requestTimeout = 120000;
server.headersTimeout = 30000;
server.keepAliveTimeout = 15000;
server.maxHeadersCount = 100; // allow Range/video-request headers without artificial limits

process.on('unhandledRejection', (err) => console.error('[Unhandled Rejection]', err));
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await flushDownloads(); } catch { /* best effort */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
