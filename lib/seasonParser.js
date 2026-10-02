/**
 * lib/seasonParser.js
 *
 * Single common transform layer that normalizes ANY provider's season/episode
 * metadata into one internal model:
 *
 *   seasons = [{
 *     seasonNumber, title, episodeCount,
 *     episodes: [{ episodeNumber, title, streamId, language }]
 *   }]
 *
 * Handles the shapes returned by vega scrapers / addons:
 *   - group.directLinks[]                     (per-link entries)
 *   - group.episodesLink / group.link         (one grouped link — NOT a real
 *     single episode; expanded via the provider's episodes module when
 *     available, otherwise kept as one "all episodes" entry marked synthetic)
 *   - meta.videos[]                           (Stremio-style flat videos)
 *   - already-normalized seasons[]            (passed through cleaned)
 *
 * Language-only groups ("Hindi Dubbed", "Arabic Sub", …) become audio
 * variants on each episode instead of fake extra seasons.
 */

const fs = require('fs');
const path = require('path');

const DISALLOWED_FOREIGN_LANGUAGES = [
  'arabic', 'bengali', 'chinese', 'french', 'german', 'indonesian',
  'italian', 'japanese', 'kannada', 'korean', 'malayalam', 'marathi',
  'punjabi', 'portuguese', 'russian', 'spanish', 'tamil', 'telugu', 'thai',
  'turkish', 'vietnamese', 'tagalog', 'esla', 'ptbr', 'latam', 'castilian',
  'dublado',
];

const NON_ENGLISH_LANGUAGES = [
  ...DISALLOWED_FOREIGN_LANGUAGES,
  'hindi',
];

// Only treat an entry as "movie-like" when it is EXPLICITLY typed as a movie
// or clearly labelled as a full-movie download. Loose word matches (e.g. an
// episode of "Movie Room 13") must not be rejected.
const MOVIE_TYPE_RE = /^(movie|film)$/i;
const MOVIE_TITLE_RE = /\b(full movie|hd movie|movies?\s*4k?|dual audio movie)\b/i;

function normalizeAudioLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Detects the audio/language variant label from any text blob
 * (group titles like "Season 2 Hindi Dubbed", link labels, etc.).
 * Returns 'english', 'hindi', 'original', or a specific foreign language name.
 */
function detectLanguageFromText(text) {
  const label = normalizeAudioLabel(text);
  if (!label) return 'original';

  for (const lang of DISALLOWED_FOREIGN_LANGUAGES) {
    if (new RegExp(`(^|\\s)${lang}(\\s|$)`, 'i').test(label)) return lang;
  }

  if (/(^|\s)(hindi|hin|bollywood)(\s|$)/i.test(label) || label.includes('hindi dub')) {
    return 'hindi';
  }

  if (/(^|\s)(english|eng|dubbed in english|hdrip|web-dl|bluray)(\s|$)/i.test(label) || label.includes('english dub') || label.includes('eng dub')) {
    return 'english';
  }

  if (/(^|\s)(original|native|main)(\s|$)/i.test(label) || label.includes('original audio')) {
    return 'original';
  }

  return 'original';
}

function isMovieLike(entry) {
  if (!entry || typeof entry !== 'object') return true;
  const rawType = String(entry.type || entry.kind || '').toLowerCase();
  if (MOVIE_TYPE_RE.test(rawType)) return true;
  const title = `${entry.title || entry.name || entry.label || ''}`;
  return MOVIE_TITLE_RE.test(title);
}

function parseEpisodeNumber(explicit, title, fallbackIndex) {
  const direct = Number(explicit);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const t = String(title || '');
  const m = t.match(/(?:episode|ep)[^0-9]*(\d{1,4})/i) || t.match(/\bE(\d{1,4})\b/i);
  if (m) return Number(m[1]);
  return fallbackIndex + 1;
}

function parseSeasonNumber(explicit, title, fallbackIndex) {
  const direct = Number(explicit);
  if (Number.isFinite(direct) && direct >= 0) return Math.round(direct);
  const t = String(title || '');
  const m = t.match(/\b(?:season|s)\s*0*(\d{1,3})\b/i);
  if (m) return Number(m[1]);
  return fallbackIndex + 1;
}

// ── Provider episodes modules (lazy) ────────────────────────────────────────
const episodesModuleCache = new Map();

function loadEpisodesModule(providerDir, providerId) {
  if (episodesModuleCache.has(providerId)) return episodesModuleCache.get(providerId);
  let mod = null;
  try {
    const file = path.join(providerDir, 'episodes.js');
    if (fs.existsSync(file)) mod = require(file);
  } catch {
    mod = null;
  }
  episodesModuleCache.set(providerId, mod);
  return mod;
}

/**
 * Expands a grouped "episodesLink" into REAL per-episode entries using the
 * provider's own episodes module. Returns [] when expansion is impossible.
 */
async function expandEpisodesLink(episodesMod, providerId, groupTitle, encodedLink, timeoutMs = 8000) {
  if (!episodesMod || typeof episodesMod.getEpisodes !== 'function') return [];
  if (typeof encodedLink !== 'string' || !encodedLink.trim()) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let items;
    try {
      items = await Promise.race([
        episodesMod.getEpisodes({ url: encodedLink, signal: ctrl.signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getEpisodes timeout')), timeoutMs + 500)),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(items)) return [];

    const bySeason = new Map();
    items.forEach((item, index) => {
      if (!item || !item.link) return;
      const title = String(item.title || item.name || `Episode ${index + 1}`);
      const seasonMatch = title.match(/\bS(\d{1,3})\b/i);
      const seasonNumber = seasonMatch ? Number(seasonMatch[1]) : 1;
      const epNumber = parseEpisodeNumber(item.episodeNumber ?? item.episode ?? item.ep, title, index);
      const language = detectLanguageFromText(`${groupTitle || ''} ${title}`);
      if (!bySeason.has(seasonNumber)) bySeason.set(seasonNumber, []);
      bySeason.get(seasonNumber).push({
        episodeNumber: epNumber,
        title,
        streamId: item.link,
        language,
        synthetic: false,
      });
    });
    return [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, episodes]) => ({ seasonNumber, episodes }));
  } catch (err) {
    console.warn(`[seasonParser:${providerId}] episodes expansion failed: ${err.message}`);
    return [];
  }
}

// ── Deduplication helpers ───────────────────────────────────────────────────

function dedupeEpisodes(episodes) {
  const seen = new Set();
  const out = [];
  for (const ep of episodes) {
    const key = `${ep.episodeNumber}::${ep.language || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
  }
  return out.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Collapses pseudo-seasons that only differ by audio language
 * ("Season 1", "Season 1 Hindi Dub", "Season 1 Arabic Sub") into ONE season
 * whose episodes carry a `language` variant label. Non-preferred languages
 * are dropped here (before render), not after.
 */
function mergeLanguageVariantSeasons(seasons, preferredLanguages = ['original', 'english', 'hindi']) {
  const merged = new Map();
  for (const season of seasons) {
    const seasonLang = detectLanguageFromText(season.title);
    if (seasonLang && !preferredLanguages.includes(seasonLang)) {
      continue; // Drop seasons for disallowed languages completely
    }

    const strippedTitle = normalizeAudioLabel(season.title).replace(
      new RegExp(`\\b(${NON_ENGLISH_LANGUAGES.join('|')})\\b`, 'g'), ' '
    ).replace(/\s+/g, ' ').trim();
    const key = `${season.seasonNumber}::${strippedTitle.replace(/season\s*\d+/, '').trim()}`;
    if (!merged.has(key)) {
      merged.set(key, { seasonNumber: season.seasonNumber, candidateTitles: [], episodes: [] });
    }
    const target = merged.get(key);
    if (season.title && !target.candidateTitles.includes(season.title)) {
      target.candidateTitles.push(season.title);
    }
    for (const ep of season.episodes) {
      const lang = ep.language || seasonLang || 'original';
      if (preferredLanguages && !preferredLanguages.includes(lang)) continue;
      target.episodes.push({ ...ep, language: lang });
    }
  }

  const result = [];
  for (const bucket of merged.values()) {
    const episodes = dedupeEpisodes(bucket.episodes);
    if (episodes.length === 0) continue;
    // Prefer a language-neutral title for the merged season ("Original"
    // group titles or plain "Season N"), so dubbed groups don't rename it.
    const neutralTitle =
      bucket.candidateTitles.find((t) => detectLanguageFromText(t) === 'original') ||
      bucket.candidateTitles[0] ||
      `Season ${bucket.seasonNumber}`;
    result.push({
      seasonNumber: bucket.seasonNumber,
      title: neutralTitle,
      episodeCount: episodes.length,
      episodes,
      hasSyntheticOnly: episodes.every((e) => e.synthetic),
    });
  }
  return result.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

// ── Main normalization ──────────────────────────────────────────────────────

/**
 * Normalizes provider metadata into a consistent season/episode tree.
 *
 * @param {object} meta        Provider meta object (linkList / videos / seasons)
 * @param {object} options
 * @param {object} options.providerInfo  { id, dir } – used to lazily load the
 *        provider's episodes.js module and expand grouped links.
 * @param {string[]} options.preferredLanguages  Languages to keep
 *        ('' = original/default always kept). Others are filtered pre-render.
 * @returns {Array} normalized seasons
 */
async function normalizeSeasons(meta, options = {}) {
  const { providerInfo = null, preferredLanguages = ['original', 'english', 'hindi'] } = options;
  const seasons = [];

  // 1) Already-normalized seasons passed straight through (cleaned anyway).
  if (Array.isArray(meta.seasons) && meta.seasons.length > 0) {
    for (const s of meta.seasons) {
      const eps = (Array.isArray(s.episodes) ? s.episodes : [])
        .filter((e) => e && !isMovieLike(e))
        .map((e, i) => ({
          episodeNumber: parseEpisodeNumber(e.episodeNumber ?? e.ep ?? e.number, e.title, i),
          title: String(e.title || `Episode ${i + 1}`),
          streamId: e.streamId || e.link || '',
          language: e.language || detectLanguageFromText(`${e.language || ''} ${e.title || ''}`),
          synthetic: Boolean(e.synthetic),
        }))
        .filter((e) => e.streamId);
      if (eps.length === 0) continue;
      seasons.push({
        seasonNumber: parseSeasonNumber(s.seasonNumber, s.title, seasons.length),
        title: s.title || `Season ${s.seasonNumber}`,
        episodes: eps,
      });
    }
  }

  // 2) Vega-style linkList groups.
  const groups = Array.isArray(meta.linkList) ? meta.linkList : [];
  if (groups.length > 0) {
    const episodesMod = providerInfo?.dir ? loadEpisodesModule(providerInfo.dir, providerInfo.id) : null;

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      if (!group || typeof group !== 'object') continue;
      const groupTitle = String(group.title || group.name || `Group ${gi + 1}`);
      const groupLang = detectLanguageFromText(groupTitle);
      const seasonNumber = parseSeasonNumber(group.seasonNumber, groupTitle, gi);

      // 2a) Real per-episode links present.
      const directLinks = Array.isArray(group.directLinks) ? group.directLinks : [];
      const usableDirect = directLinks.filter((d) => d && d.link && !isMovieLike(d));
      if (usableDirect.length > 0) {
        const episodes = usableDirect.map((d, i) => ({
          episodeNumber: parseEpisodeNumber(d.episodeNumber ?? d.episode, d.title, i),
          title: String(d.title || `Episode ${i + 1}`),
          streamId: d.link,
          language: groupLang || detectLanguageFromText(d.title || ''),
          synthetic: false,
        }));
        seasons.push({ seasonNumber, title: groupTitle, episodes });
        continue;
      }

      // 2b) Grouped episodesLink → try to expand into REAL episodes.
      const groupedLink = group.episodesLink || group.link;
      if (groupedLink) {
        const expanded = await expandEpisodesLink(episodesMod, providerInfo?.id, groupTitle, groupedLink);
        if (expanded.length > 0) {
          for (const part of expanded) {
            const epSeasonNumber = expanded.length === 1 ? seasonNumber : part.seasonNumber;
            seasons.push({
              seasonNumber: epSeasonNumber,
              title: groupTitle,
              episodes: part.episodes.map((e) => ({ ...e, language: e.language || groupLang })),
            });
          }
          continue;
        }
        // Expansion unavailable → keep ONE honest "all episodes" entry
        // (marked synthetic) instead of pretending it is Episode 1.
        seasons.push({
          seasonNumber,
          title: groupTitle,
          episodes: [{
            episodeNumber: 1,
            title: `${groupTitle} — All Episodes`,
            streamId: groupedLink,
            language: groupLang,
            synthetic: true,
          }],
        });
      }
    }
  }

  // 3) Stremio-style flat videos list.
  if (seasons.length === 0 && Array.isArray(meta.videos) && meta.videos.length > 0) {
    const bySeason = new Map();
    meta.videos.forEach((video, index) => {
      if (!video) return;
      const seasonNumber = parseSeasonNumber(video.season, video.title, 0);
      const episodeNumber = parseEpisodeNumber(video.episode, video.title, index);
      if (!bySeason.has(seasonNumber)) bySeason.set(seasonNumber, []);
      bySeason.get(seasonNumber).push({
        episodeNumber,
        title: String(video.title || `Episode ${episodeNumber}`),
        streamId: video.id ? `${meta.type || 'series'}:${video.id}` : '',
        language: detectLanguageFromText(video.title || ''),
        synthetic: false,
      });
    });
    for (const [seasonNumber, episodes] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      seasons.push({ seasonNumber, title: `Season ${seasonNumber}`, episodes: episodes.filter((e) => e.streamId) });
    }
  }

  const merged = mergeLanguageVariantSeasons(seasons, preferredLanguages);
  return merged;
}

module.exports = {
  normalizeSeasons,
  detectLanguageFromText,
  normalizeAudioLabel,
  isMovieLike,
  parseEpisodeNumber,
  parseSeasonNumber,
  dedupeEpisodes,
  mergeLanguageVariantSeasons,
  NON_ENGLISH_LANGUAGES,
};
