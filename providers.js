// providers.js
const { CircleFTPProvider } = require('./circleftp');
const { DhakaFlixProvider } = require('./dhakaflix');
const { FourKHDHubProvider } = require('./fourkdhhub');
const { AddonProvider } = require('./addons');
const { loadAllVegaProviders } = require('./vegaAdapter');
const { deduplicateMediaItems, cleanTitleForDeduplication, normalizeTitle } = require('./lib/mediaUtils');

class HiAnimeProvider {
  constructor() {
    this.id = 'hiAnime';
    this.displayName = 'HiAnime';
    this.tagline = 'Top Anime Hub (Sub & Dub, Fast Direct Play)';
    this.category = 'Featured Streaming';
    this.type = 'anime';
    this.disabled = false;
  }

  async search(query, page = 1) {
    if (!query) return [];
    try {
      if (registry.anikoto && !registry.anikoto.disabled) {
        const items = await registry.anikoto.instance.search(query, page);
        if (Array.isArray(items) && items.length > 0) {
          return items.map((item) => ({
            ...item,
            provider: 'hiAnime',
            providerDisplayName: 'HiAnime',
            tag: item.tag || 'Anime HD',
          }));
        }
      }
    } catch (err) {
      console.warn('[HiAnimeProvider] anikoto search error:', err.message);
    }

    try {
      if (registry.kickAssAnime && !registry.kickAssAnime.disabled) {
        const items = await registry.kickAssAnime.instance.search(query, page);
        if (Array.isArray(items) && items.length > 0) {
          return items.map((item) => ({
            ...item,
            provider: 'hiAnime',
            providerDisplayName: 'HiAnime',
            tag: item.tag || 'Anime Sub/Dub',
          }));
        }
      }
    } catch (err) {
      console.warn('[HiAnimeProvider] kickAssAnime search error:', err.message);
    }
    return [];
  }

  async catalog(filter = '', page = 1) {
    const catFilter = (!filter || filter === 'anime' || filter === 'all') ? '/most-viewed' : (filter.startsWith('/') ? filter : `/${filter}`);
    if (registry.anikoto && !registry.anikoto.disabled && typeof registry.anikoto.instance.catalog === 'function') {
      try {
        const items = await registry.anikoto.instance.catalog(catFilter, page);
        if (Array.isArray(items) && items.length > 0) {
          return items.map((item) => ({
            ...item,
            provider: 'hiAnime',
            providerDisplayName: 'HiAnime',
          }));
        }
      } catch (_e) {
        // try fallback
      }
    }
    return this.search('Demon Slayer');
  }

  async details(id) {
    if (registry.anikoto && !registry.anikoto.disabled) {
      try {
        const d = await registry.anikoto.instance.details(id);
        if (d && d.title) {
          return { ...d, provider: 'hiAnime', providerDisplayName: 'HiAnime' };
        }
      } catch (_e) {
        // try fallback
      }
    }
    if (registry.kickAssAnime && !registry.kickAssAnime.disabled) {
      try {
        const d = await registry.kickAssAnime.instance.details(id);
        if (d && d.title) {
          return { ...d, provider: 'hiAnime', providerDisplayName: 'HiAnime' };
        }
      } catch (_e) {
        // try fallback
      }
    }
    throw new Error('Failed to get HiAnime details');
  }

  async streams(id) {
    if (registry.anikoto && !registry.anikoto.disabled) {
      try {
        const s = await registry.anikoto.instance.streams(id);
        if (Array.isArray(s) && s.length > 0) {
          return s.map((r) => ({ ...r, provider: 'HiAnime' }));
        }
      } catch (_e) {
        // try fallback
      }
    }
    if (registry.kickAssAnime && !registry.kickAssAnime.disabled) {
      try {
        const s = await registry.kickAssAnime.instance.streams(id);
        if (Array.isArray(s) && s.length > 0) {
          return s.map((r) => ({ ...r, provider: 'HiAnime' }));
        }
      } catch (_e) {
        // try fallback
      }
    }
    return [];
  }
}

const registry = {
  hiAnime: {
    instance: new HiAnimeProvider(),
    displayName: 'HiAnime',
    tagline: 'Top Anime Hub (Sub & Dub, Fast Direct Play)',
    type: 'anime',
    category: 'Featured Streaming',
  },
  addon: {
    instance: new AddonProvider('https://v3-cinemeta.strem.io'),
    displayName: 'Stremio Cinemeta',
    tagline: 'Standard Stremio JSON protocol',
    type: 'stremio',
    category: 'Native',
  },
  '4khdhub': {
    instance: new FourKHDHubProvider(),
    displayName: '4KHDHub',
    tagline: 'Web scraper + HubCloud resolver',
    type: 'html',
    category: 'Featured Streaming',
  },
  circleftp: {
    instance: new CircleFTPProvider(),
    displayName: 'CircleFTP',
    tagline: 'REST API & direct file links',
    type: 'api',
    category: 'BDIX & Local',
  },
  dhakaflix: {
    instance: new DhakaFlixProvider(),
    displayName: 'DhakaFlix',
    tagline: 'Local BDIX fast-probe storage',
    type: 'bdix',
    category: 'BDIX & Local',
  },
};

// Dynamically register enabled Vega providers only.
// movieBoxWeb is force-enabled: it has top priority for movie fetching/search.
const vegaProviders = loadAllVegaProviders(false);
const hasMovieBoxWeb = vegaProviders.some((vp) => vp.id === 'movieBoxWeb');
if (!hasMovieBoxWeb) {
  try {
    const allVega = loadAllVegaProviders(true);
    const mbw = allVega.find((vp) => vp.id === 'movieBoxWeb');
    if (mbw) {
      mbw.disabled = false;
      vegaProviders.push(mbw);
    }
  } catch (err) {
    console.warn('[providers] Failed to force-enable movieBoxWeb:', err.message);
  }
}
for (const vp of vegaProviders) {
  let regKey = vp.id;
  let displayName = vp.displayName;

  if (vp.id === 'movieBox') {
    regKey = 'movieBoxApp';
    displayName = 'MovieBox (Vega App)';
  } else if (vp.id === 'movieBoxWeb') {
    displayName = 'MovieBox Web (Vega)';
  }

  if (!registry[regKey]) {
    let cat = 'Vega Global';
    if (vp.category === 'anime') cat = 'Vega Anime';
    else if (vp.category === 'english') cat = 'Vega English';
    else if (vp.category === 'india') cat = 'Vega Regional (India)';
    else if (vp.category === 'italy') cat = 'Vega Regional';

    registry[regKey] = {
      instance: vp,
      displayName,
      tagline: vp.tagline,
      type: vp.category || 'vega',
      category: cat,
      isVega: true,
      disabled: vp.disabled,
    };
  }
}

// Core primary providers queried in unified "All Providers" search
const CORE_UNIFIED_PROVIDERS = [
  'addon',
  'showbox',
  'flixhq',
  '4khdhub',
  'vega',
  'hdhub4u',
  'gokuHD',
  'hiAnime',
  'katmovies',
  'mod',
  'ridoMovies',
  'drive',
  'world4u',
];

// ─── Genre-based provider priority lists ────────────────────────────────────
// Lower index = higher priority. movieBoxWeb is pinned to the TOP of every
// genre list, then genre-specialized providers, then the remaining core
// unified providers. Unknown providers fall to the bottom automatically.
const TOP_PROVIDER = 'movieBoxWeb';

const GENRE_SEARCH_PRIORITIES = {
  movies: [
    TOP_PROVIDER,
    'addon',          // Stremio Cinemeta metadata backbone
    'flixhq',
    'showbox',
    'ridoMovies',
    'vega',
    'hdhub4u',
    '4khdhub',
    'mod',            // MoviesMod
    'drive',          // MoviesDrive
    'katmovies',
    'world4u',
    'uhd',
    'multi',
    'neonMovies',
    'movies4u',
    'kmMovies',
    'netflixMirror',
    'primeMirror',
    'disneyMirror',
    'everything',
    'autoEmbed',
  ],
  anime: [
    TOP_PROVIDER,
    'hiAnime',
    'gokuHD',
    'anikoto',
    'kickAssAnime',
    'animetsu',
    'tokyoInsider',
    'uniquestream',
    'animerulz',
    'addon',
    'vega',
    'showbox',
    'everything',
    'autoEmbed',
  ],
  drama: [
    TOP_PROVIDER,
    'mkvDrama',       // Asian/C-drama/K-drama specialist
    'kissKh',         // K-drama
    'zeefliz',        // Turkish dramas
    'cinemaLuxe',
    'Joya9tv',
    'addon',
    'vega',
    'showbox',
    'everything',
    'autoEmbed',
  ],
  hollywood: [
    TOP_PROVIDER,
    'addon',
    'flixhq',
    'showbox',
    'ridoMovies',
    'primewire',
    'moviesApi',
    'a111477',
    'guardahd',
    'netflixMirror',
    'primeMirror',
    'disneyMirror',
    'vega',
    'everything',
    'autoEmbed',
  ],
  bollywood: [
    TOP_PROVIDER,
    '1cinevood',      // Cinewood (Hindi dub/regional)
    'luxMovies',      // RogMovies
    'topmovies',
    'moviezwap',
    'dooflix',
    'ogomovies',
    'filmyfly',
    'mod',
    'world4u',
    'vega',
    'addon',
    'everything',
    'autoEmbed',
  ],
};

// Default priority when no genre is supplied (legacy behaviour + extras).
const SEARCH_PRIORITY = [TOP_PROVIDER, ...CORE_UNIFIED_PROVIDERS];

// Map loose genre/type words onto our canonical genre keys.
const GENRE_ALIASES = {
  movie: 'movies',
  films: 'movies',
  film: 'movies',
  tv: 'movies',
  series: 'movies',
  cartoon: 'anime',
  anime: 'anime',
  kdrama: 'drama',
  cdrama: 'drama',
  jdrama: 'drama',
  dorama: 'drama',
  asian: 'drama',
  holly: 'hollywood',
  english: 'hollywood',
  west: 'hollywood',
  western: 'hollywood',
  bolly: 'bollywood',
  hindi: 'bollywood',
  india: 'bollywood',
  regional: 'bollywood',
  tamil: 'bollywood',
  telugu: 'bollywood',
  malayalam: 'bollywood',
  kannada: 'bollywood',
  punjabi: 'bollywood',
  bangla: 'bollywood',
};

function normalizeGenre(genre) {
  const g = String(genre || '').trim().toLowerCase();
  if (!g) return null;
  if (GENRE_SEARCH_PRIORITIES[g]) return g;
  return GENRE_ALIASES[g] || null;
}

function getSearchPriorityList(genre) {
  const key = normalizeGenre(genre);
  if (key) return GENRE_SEARCH_PRIORITIES[key];
  return SEARCH_PRIORITY;
}

function getSearchPriority(providerName, genre) {
  const list = getSearchPriorityList(genre);
  const idx = list.indexOf(providerName);
  return idx === -1 ? list.length : idx;
}

/**
 * Sorts flat search results per genre priority list: movieBoxWeb first for
 * every genre, then genre-specialized providers, then the rest. Stable sort
 * keeps each provider's internal relevance ordering intact.
 */
function sortByProviderPriority(items, genre = null) {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = getSearchPriority(a.item.provider, genre);
      const pb = getSearchPriority(b.item.provider, genre);
      return pa !== pb ? pa - pb : a.i - b.i;
    })
    .map(({ item }) => item);
}

// Lightweight genre hints from the query text itself (e.g. "anime naruto",
// "kdrama ...", "bollywood movie"). Used when no explicit genre is passed.
const QUERY_GENRE_HINTS = [
  ['anime', 'anime'],
  ['cartoon', 'anime'],
  ['kdrama', 'drama'],
  ['k-drama', 'drama'],
  ['cdrama', 'drama'],
  ['c-drama', 'drama'],
  ['drama', 'drama'],
  ['hollywood', 'hollywood'],
  ['bollywood', 'bollywood'],
  ['hindi', 'bollywood'],
  ['punjabi', 'bollywood'],
  ['tamil', 'bollywood'],
  ['telugu', 'bollywood'],
];

function detectGenreFromQuery(query) {
  const q = String(query || '').toLowerCase();
  for (const [needle, genre] of QUERY_GENRE_HINTS) {
    if (q.includes(needle)) return genre;
  }
  return null;
}

/**
 * Searches across registered providers concurrently with Promise.allSettled.
 * If specificProvider is requested, queries that provider first; if it returns 0 results,
 * automatically falls back to other providers so the user is never left with an empty result.
 * Deduplicates identical titles across providers so each movie is listed only once.
 */
async function searchAll(query, specificProvider = null, genre = null) {
  if (!query || typeof query !== 'string') return [];
  const cleanQuery = query.trim();

  let targetEntries = [];
  if (specificProvider && specificProvider !== 'all' && registry[specificProvider]) {
    targetEntries = [[specificProvider, registry[specificProvider]]];
  } else {
    targetEntries = Object.entries(registry).filter(([, provider]) => !provider.disabled);
  }

  const results = await Promise.allSettled(
    targetEntries.map(async ([name, p]) => {
      try {
        const items = await withTimeout(
          p.instance.search(cleanQuery),
          7000,
          `search(${name}) timed out`
        );
        return (items || []).map((i) => ({
          ...i,
          provider: name,
          providerDisplayName: p.displayName,
        }));
      } catch (err) {
        console.warn(`[Provider: ${name}] search failed:`, err.message);
        return [];
      }
    })
  );

  let flat = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  // If specific provider was requested (e.g. movieBoxWeb or hiAnime) and returned 0 results:
  // Automatically fallback to searching other providers so user is never left with an empty screen!
  if (flat.length === 0 && specificProvider && specificProvider !== 'all') {
    const fallbackEntries = Object.entries(registry).filter(([name, p]) => name !== specificProvider && !p.disabled);
    const fbResults = await Promise.allSettled(
      fallbackEntries.map(async ([name, p]) => {
        try {
          const items = await withTimeout(p.instance.search(cleanQuery), 7000, `search(${name}) timed out`);
          return (items || []).map((i) => ({
            ...i,
            provider: name,
            providerDisplayName: p.displayName,
          }));
        } catch {
          return [];
        }
      })
    );
    flat = fbResults.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  }

  // movieBoxWeb first for movies, hiAnime first for anime, then genre-specific priority.
  const effectiveGenre = normalizeGenre(genre) || detectGenreFromQuery(cleanQuery);
  const prioritized = sortByProviderPriority(flat, effectiveGenre);

  // Deduplicate identical movies across providers — user request: "we should not list the same movie from every provider"
  return deduplicateMediaItems(prioritized);
}

// Cross-provider fallback only makes sense for link-style ids shared by vega
// scrapers (site paths like "/movie/..." or full URLs). Native providers
// (MovieBox/Stremio/etc.) use their own id formats and are never probed.
function isVegaStyleId(id) {
  const s = String(id || '').trim();
  if (/^https?:\/\//i.test(s)) return !/strem\.io/i.test(s); // stremio meta URLs belong to 'addon'
  return s.startsWith('/');
}

// Providers eligible for cross-provider fallback when the requested one fails.
function getFallbackCandidates(preferredName, id) {
  if (!isVegaStyleId(id)) return [];

  const ordered = [];
  const push = (name) => {
    if (registry[name] && name !== preferredName && registry[name].isVega && !ordered.includes(name)) {
      ordered.push(name);
    }
  };
  // Core unified vega providers first (fast, well-tested), then remaining vega providers.
  for (const name of CORE_UNIFIED_PROVIDERS) push(name);
  for (const name of Object.keys(registry)) push(name);
  return ordered;
}

/**
 * Get media details with provider routing and automatic provider switching.
 * If the preferred provider is unavailable/down, we switch to another provider.
 */
async function getDetails(id, providerName = 'addon') {
  const entry = registry[providerName];
  const p = entry?.instance || registry.addon.instance;

  // A real title is a human-readable string — not a raw URL path like
  // "/moviesDetail/abc" which is what VegaAdapter.details returns when it
  // silently swallows an error. Reject those as not-a-valid-result.
  const isRealTitle = (title) => {
    if (!title || typeof title !== 'string') return false;
    const t = title.trim();
    if (t.startsWith('/') || /^https?:\/\//i.test(t)) return false;
    return t.length > 0;
  };

  try {
    const details = await p.details(id);
    if (details && isRealTitle(details.title)) {
      return {
        ...details,
        provider: providerName,
        providerDisplayName: registry[providerName]?.displayName || providerName,
      };
    }
    throw new Error(`Provider ${providerName} returned no usable details`);
  } catch (err) {
    console.warn(`[getDetails] Provider ${providerName} error: ${err.message}. Trying fallbacks...`);
    // Only probe other providers when the id is a URL/link shared across scrapers.
    {
      for (const name of getFallbackCandidates(providerName, id)) {
        try {
          const fallbackDetails = await registry[name].instance.details(id);
          if (fallbackDetails && isRealTitle(fallbackDetails.title)) {
            console.log(`[getDetails] Switched to provider "${name}" successfully.`);
            return {
              ...fallbackDetails,
              provider: name,
              providerDisplayName: registry[name].displayName,
              switchedFrom: providerName,
            };
          }
        } catch {
          // provider unavailable — try next
        }
      }
    }
    throw err;
  }
}

/**
 * Get streams / releases with provider routing AND automatic provider switching.
 * Tries the preferred/default provider first; if it errors or returns zero playable
 * sources, automatically falls back through alternative providers (via alternateSources
 * or title search) until playable/downloadable sources are found.
 * User request: "we will just swich to another provider when playing or download or pay is not avaliable"
 */
async function getStreams(id, providerName = 'movieBoxWeb', opts = {}) {
  const collect = (releases, name) =>
    (releases || [])
      .filter(Boolean)
      .map((r) => ({
        ...r,
        provider: r.provider || registry[name]?.displayName || name,
      }));

  const tried = new Set([providerName]);
  const results = [];

  // 1. Preferred / default provider
  const entry = registry[providerName];
  const p = entry?.instance || registry.movieBoxWeb?.instance || registry.addon.instance;
  try {
    const releases = collect(await withTimeout(p.streams(id), opts.timeoutMs || 10000, `streams(${providerName}) timed out`), providerName);
    results.push(...releases);
  } catch (err) {
    console.warn(`[getStreams] Primary provider ${providerName} failed for id ${id}: ${err.message}. Switching to another provider...`);
  }

  // 2. Automatic fallback: switch providers when none/few sources were found
  const minSources = Number.isInteger(opts.minSources) ? Math.max(1, opts.minSources) : 1;
  const timeoutMs = Number.isInteger(opts.timeoutMs) ? Math.max(1000, opts.timeoutMs) : 12000;

  if (results.length < minSources) {
    // A. Check if the item already has alternateSources recorded from search deduplication
    const alternates = Array.isArray(opts.alternateSources) ? opts.alternateSources : [];
    for (const alt of alternates) {
      if (!alt || !alt.provider || tried.has(alt.provider) || !registry[alt.provider]) continue;
      tried.add(alt.provider);
      try {
        const altReleases = collect(
          await withTimeout(registry[alt.provider].instance.streams(alt.subjectId), timeoutMs, `streams(${alt.provider}) timed out`),
          alt.provider
        );
        if (altReleases.length > 0) {
          console.log(`[getStreams] Switched to alternate provider "${alt.provider}" — found ${altReleases.length} source(s).`);
          results.push(...altReleases.map((r) => ({ ...r, switchedFrom: providerName })));
          if (results.length >= minSources) return results;
        }
      } catch (altErr) {
        console.warn(`[getStreams] Alternate provider ${alt.provider} failed:`, altErr.message);
      }
    }

    // B. Probing shared link-style IDs on other Vega scrapers
    const candidates = getFallbackCandidates(providerName, id).slice(0, 5);
    for (const name of candidates) {
      if (tried.has(name)) continue;
      tried.add(name);
      try {
        const rels = await withTimeout(
          registry[name].instance.streams(id),
          timeoutMs,
          `streams(${name}) timed out`
        );
        const mapped = collect(rels, name);
        if (mapped.length > 0) {
          console.log(`[getStreams] Switched to shared provider "${name}" — found ${mapped.length} source(s).`);
          results.push(...mapped.map((r) => ({ ...r, switchedFrom: providerName })));
          if (results.length >= minSources) return results;
        }
      } catch (err) {
        console.warn(`[getStreams] Fallback provider ${name} failed: ${err.message}`);
      }
    }

    // C. Search alternative providers by movie Title & Year!
    let titleToSearch = opts.title;
    if (!titleToSearch && typeof id === 'string') {
      const match = id.match(/\/([a-z0-9-]+?)(?:-[a-z0-9]{5,})?$/i);
      if (match) titleToSearch = match[1].replace(/-/g, ' ');
    }

    if (titleToSearch) {
      const cleanTargetTitle = cleanTitleForDeduplication(titleToSearch) || normalizeTitle(titleToSearch);
      const isAnime = opts.type === 'anime' || /anime|naruto|one piece|bleach|titan|demon slayer|jujutsu/i.test(titleToSearch);

      const fallbackList = isAnime
        ? ['hiAnime', 'anikoto', 'kickAssAnime', 'movieBoxWeb', 'gokuHD', 'vega']
        : ['movieBoxWeb', '4khdhub', 'vega', 'hdhub4u', 'mod', 'drive', 'circleftp', 'dhakaflix', 'showbox', 'gokuHD', 'addon'];

      for (const fbName of fallbackList) {
        if (tried.has(fbName) || !registry[fbName] || registry[fbName].disabled) continue;
        tried.add(fbName);
        try {
          const searchItems = await withTimeout(registry[fbName].instance.search(titleToSearch), 6000, `search(${fbName}) timed out`);
          if (!Array.isArray(searchItems) || searchItems.length === 0) continue;

          // Find closest title match
          const matchedItem = searchItems.find((it) => {
            const itClean = cleanTitleForDeduplication(it.title) || normalizeTitle(it.title);
            return itClean.includes(cleanTargetTitle) || cleanTargetTitle.includes(itClean);
          }) || searchItems[0];

          if (matchedItem && matchedItem.subjectId) {
            const fbReleases = collect(
              await withTimeout(registry[fbName].instance.streams(matchedItem.subjectId), timeoutMs, `streams(${fbName}) timed out`),
              fbName
            );
            if (fbReleases.length > 0) {
              console.log(`[getStreams] Auto-switched to provider "${fbName}" for "${titleToSearch}" (${fbReleases.length} sources found).`);
              results.push(...fbReleases.map((r) => ({ ...r, switchedFrom: providerName })));
              if (results.length >= minSources) break;
            }
          }
        } catch (fbErr) {
          console.warn(`[getStreams] Fallback search/stream on ${fbName} failed:`, fbErr.message);
        }
      }
    }
  }

  return results;
}

async function getEpisodeStreams(title, seasonNumber, episodeNumber, sourceCandidates = []) {
  const normalizedTitle = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedTitle) return { provider: null, subjectId: null, releases: [] };

  const tried = new Set();
  const resolveCandidates = async (candidates) => {
    for (const candidate of candidates) {
      const key = `${candidate.provider}::${candidate.subjectId}`;
      if (tried.has(key)) continue;
      tried.add(key);

      try {
        const details = await getDetails(candidate.subjectId, candidate.provider);
        const episodeLinks = (details.seasons || [])
          .filter((season) => Number(season.seasonNumber) === seasonNumber)
          .flatMap((season) => season.episodes || [])
          .filter((episode) => Number(episode.episodeNumber) === episodeNumber)
          .map((episode) => episode.streamId || episode.link)
          .filter(Boolean);

        for (const episodeLink of episodeLinks) {
          const releases = await getStreams(episodeLink, candidate.provider, {
            minSources: 1,
            maxFallbacks: 3,
            timeoutMs: 10000,
          });
          if (releases.length > 0) {
            return {
              provider: candidate.provider,
              subjectId: candidate.subjectId,
              streamId: episodeLink,
              releases,
            };
          }
        }
      } catch (err) {
        console.warn(`[getEpisodeStreams] Provider ${candidate.provider} failed: ${err.message}`);
      }
    }

    return null;
  };

  const isMatchingCandidate = (item) => {
    if (!item || typeof item !== 'object') return false;
    const candidateTitle = String(item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return item.provider !== 'addon' && registry[item.provider] && item.type === 'series' &&
      item.subjectId && candidateTitle.includes(normalizedTitle);
  };
  const rankCandidates = (candidates) => candidates
    .filter(isMatchingCandidate)
    .sort((a, b) => {
      const aTitle = String(a.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const bTitle = String(b.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return Number(aTitle !== normalizedTitle) - Number(bTitle !== normalizedTitle);
    });

  const localResult = await resolveCandidates(rankCandidates(sourceCandidates));
  if (localResult) return localResult;

  const searchResults = await searchAll(title);
  const searchResult = await resolveCandidates(rankCandidates(searchResults));
  if (searchResult) return searchResult;

  return { provider: null, subjectId: null, streamId: null, releases: [] };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'Operation timed out')), ms);
    }),
  ]);
}

/**
 * Retrieves the catalog homepage items.
 * Tries the preferred provider (default: movieBoxWeb) first.
 * If empty or fails, falls back automatically to Stremio Cinemeta and GokuHD.
 * Returns deduplicated items with full provider metadata.
 */
async function getCatalogHomepage(provider = 'movieBoxWeb', filter = '', page = 1) {
  let items = [];
  const targetProvider = provider && provider !== 'all' ? provider : 'movieBoxWeb';

  // 1. Try requested provider first
  const primary = registry[targetProvider]?.instance;
  if (primary && typeof primary.catalog === 'function') {
    try {
      items = await withTimeout(
        primary.catalog(filter, page),
        5500,
        `Catalog timeout for ${targetProvider}`
      );
    } catch (err) {
      console.warn(`[Catalog] Failed to load catalog from ${targetProvider}:`, err.message);
    }
  }

  // 2. If primary returned no items and user wanted 'all' or fallback, try default movieBoxWeb
  if ((!items || items.length === 0) && targetProvider !== 'movieBoxWeb') {
    const mbw = registry.movieBoxWeb?.instance;
    if (mbw && typeof mbw.catalog === 'function') {
      try {
        items = await withTimeout(
          mbw.catalog('/', page),
          5500,
          'Catalog timeout for movieBoxWeb'
        );
      } catch (err) {
        console.warn('[Catalog] MovieBoxWeb fallback failed:', err.message);
      }
    }
  }

  // 3. Fallback to Stremio Cinemeta top movies if still empty
  if (!items || items.length === 0) {
    const addon = registry.addon?.instance;
    if (addon && typeof addon.catalog === 'function') {
      try {
        items = await withTimeout(
          addon.catalog('movie', 'top'),
          4500,
          'Catalog timeout for Cinemeta'
        );
      } catch (err) {
        console.warn('[Catalog] Cinemeta fallback failed:', err.message);
      }
    }
  }

  // 4. Fallback to GokuHD if still empty
  if (!items || items.length === 0) {
    const goku = registry.gokuHD?.instance;
    if (goku && typeof goku.catalog === 'function') {
      try {
        items = await withTimeout(
          goku.catalog('', page),
          4500,
          'Catalog timeout for GokuHD'
        );
      } catch (err) {
        console.warn('[Catalog] GokuHD fallback failed:', err.message);
      }
    }
  }

  // 5. Final safety net: if all network catalog scrapers fail, return curated popular media
  if (!items || items.length === 0) {
    items = [
      {
        subjectId: '/moviesDetail/inception-e1BOR6f19C7',
        title: 'Inception',
        year: 2010,
        poster: 'https://image.tmdb.org/t/p/w500/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg',
        type: 'movie',
        provider: 'movieBoxWeb',
        providerDisplayName: 'MovieBox Web',
      },
      {
        subjectId: '/moviesDetail/interstellar-e1BOUX84nC6',
        title: 'Interstellar',
        year: 2014,
        poster: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
        type: 'movie',
        provider: 'movieBoxWeb',
        providerDisplayName: 'MovieBox Web',
      },
      {
        subjectId: '/moviesDetail/dune-part-two-mK6R2G7d216',
        title: 'Dune: Part Two',
        year: 2024,
        poster: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
        type: 'movie',
        provider: 'movieBoxWeb',
        providerDisplayName: 'MovieBox Web',
      },
      {
        subjectId: 'series:tt0903747',
        title: 'Breaking Bad',
        year: 2008,
        poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
        type: 'series',
        provider: 'addon',
        providerDisplayName: 'Stremio Cinemeta',
      },
      {
        subjectId: '/moviesDetail/spider-man-no-way-home-9a8b7c6d5e4',
        title: 'Spider-Man: No Way Home',
        year: 2021,
        poster: 'https://image.tmdb.org/t/p/w500/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg',
        type: 'movie',
        provider: 'movieBoxWeb',
        providerDisplayName: 'MovieBox Web',
      },
      {
        subjectId: '/moviesDetail/oppenheimer-5f4e3d2c1b0',
        title: 'Oppenheimer',
        year: 2023,
        poster: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
        type: 'movie',
        provider: 'movieBoxWeb',
        providerDisplayName: 'MovieBox Web',
      },
    ];
  }

  // Deduplicate items to ensure clean display
  const deduplicated = deduplicateMediaItems(items);

  // Return both standard results format and Stremio metas format
  const metas = deduplicated.map((item) => ({
    id: item.subjectId,
    type: item.type === 'series' ? 'series' : 'movie',
    name: item.title,
    poster: item.poster,
    year: item.year,
    description: item.description || '',
    genres: item.genres || [],
  }));

  return {
    results: deduplicated,
    metas,
    count: deduplicated.length,
    provider: targetProvider,
  };
}

/**
 * List all available providers grouped and with metadata
 */
function getProvidersList() {
  return Object.entries(registry).map(([key, val]) => ({
    id: key,
    name: val.displayName,
    tagline: val.tagline,
    type: val.type,
    category: val.category || 'Other',
    isVega: Boolean(val.isVega),
    disabled: Boolean(val.disabled),
  }));
}

module.exports = {
  registry,
  searchAll,
  sortByProviderPriority,
  getSearchPriority,
  normalizeGenre,
  detectGenreFromQuery,
  GENRE_SEARCH_PRIORITIES,
  getDetails,
  getStreams,
  getEpisodeStreams,
  getProvidersList,
  getCatalogHomepage,
};
