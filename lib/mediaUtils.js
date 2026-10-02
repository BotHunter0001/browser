/**
 * lib/mediaUtils.js - Shared media heuristics and standardized response mapping.
 */

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses raw title, year, and media type heuristics from any scraper payload.
 */
function parseMediaInfo(rawItem, defaultType = 'movie') {
  if (!rawItem || typeof rawItem !== 'object') {
    return {
      title: 'Untitled',
      year: null,
      type: defaultType,
      isSeries: defaultType === 'series',
      poster: null,
      tag: null,
    };
  }

  const rawTitle = String(rawItem.title || rawItem.name || rawItem.label || 'Untitled').trim();
  const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
  const rawYear = rawItem.year ? Number(rawItem.year) : (rawItem.releaseInfo ? Number(String(rawItem.releaseInfo).slice(0, 4)) : null);
  const year = rawYear && Number.isFinite(rawYear) ? rawYear : (yearMatch ? Number(yearMatch[1]) : null);

  const rawType = String(rawItem.type || rawItem.kind || defaultType).toLowerCase();
  const titleLower = rawTitle.toLowerCase();
  const isSeries =
    rawType === 'series' ||
    rawType === 'tv' ||
    rawType === 'show' ||
    titleLower.includes('season') ||
    titleLower.includes('s0') ||
    titleLower.includes('s1') ||
    titleLower.includes('s2') ||
    titleLower.includes('series');

  const poster = rawItem.image || rawItem.poster || rawItem.thumbnail || null;
  const tag = (rawItem.tag && String(rawItem.tag).trim()) ||
    (rawItem.imdbRating ? `${rawItem.imdbRating}★` : null) ||
    (rawItem.rating ? `${rawItem.rating}★` : null) ||
    (year ? String(year) : null);

  return {
    title: rawTitle,
    year,
    type: isSeries ? 'series' : 'movie',
    isSeries,
    poster,
    tag,
  };
}

/**
 * Standardizes any scraper result into a consistent catalog/search item.
 */
function toCatalogItem(rawItem, providerId = 'unknown', providerDisplayName = null, defaultType = 'movie') {
  const info = parseMediaInfo(rawItem, defaultType);
  const subjectId = String(rawItem.link || rawItem.id || rawItem.subjectId || info.title).trim();

  return {
    subjectId,
    title: info.title,
    year: info.year,
    poster: info.poster,
    type: info.type,
    tag: info.tag,
    provider: providerId,
    providerDisplayName: providerDisplayName || providerId,
  };
}

function cleanTitleForDeduplication(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\b(19\d{2}|20\d{2})\b/g, '')
    .replace(/\[.*?\]|\(.*?\)|{.*?}/g, '')
    .replace(/\b(480p|720p|1080p|2160p|4k|uhd|hd|web-dl|bluray|hindi|english|dual audio|org|dubbed|season \d+|s\d+)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Server-side deduplication across multiple providers.
 * Keeps the highest-priority provider's item as the primary display item while
 * preserving alternative sources across providers for seamless playback/download failover.
 */
function deduplicateMediaItems(items) {
  if (!Array.isArray(items)) return [];
  const seenMap = new Map();

  for (const item of items) {
    if (!item || !item.title) continue;
    const cleanTitle = cleanTitleForDeduplication(item.title) || normalizeTitle(item.title);
    if (!cleanTitle) continue;
    const typeKey = item.type || 'movie';
    const yearKey = item.year ? String(item.year) : '';
    // Key by clean title and type (and year if present)
    const key = `${cleanTitle}::${typeKey}${yearKey ? `::${yearKey}` : ''}`;

    if (!seenMap.has(key)) {
      const entry = {
        ...item,
        alternateSources: [
          {
            provider: item.provider,
            providerDisplayName: item.providerDisplayName,
            subjectId: item.subjectId,
            title: item.title,
            year: item.year,
          },
        ],
      };
      seenMap.set(key, entry);
    } else {
      const existing = seenMap.get(key);
      if (!existing.poster && item.poster) existing.poster = item.poster;
      if (!existing.year && item.year) existing.year = item.year;
      if (!existing.tag && item.tag) existing.tag = item.tag;
      if (!existing.alternateSources) {
        existing.alternateSources = [
          {
            provider: existing.provider,
            providerDisplayName: existing.providerDisplayName,
            subjectId: existing.subjectId,
            title: existing.title,
            year: existing.year,
          },
        ];
      }
      if (!existing.alternateSources.some((s) => s.provider === item.provider)) {
        existing.alternateSources.push({
          provider: item.provider,
          providerDisplayName: item.providerDisplayName,
          subjectId: item.subjectId,
          title: item.title,
          year: item.year,
        });
      }
    }
  }

  return Array.from(seenMap.values());
}

module.exports = {
  normalizeTitle,
  cleanTitleForDeduplication,
  parseMediaInfo,
  toCatalogItem,
  deduplicateMediaItems,
};
