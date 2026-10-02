/**
 * adapt.js - Normalizes provider JSON responses into clean application models.
 */

function toCatalogItem(raw) {
  if (!raw) return null;
  const subjectId = String(raw.subjectId ?? raw.id ?? '');
  const title = raw.title ?? raw.name ?? raw.postTitle ?? 'Untitled';
  
  let year = null;
  if (raw.releaseDate) {
    const parsed = parseInt(String(raw.releaseDate).slice(0, 4), 10);
    if (!isNaN(parsed)) year = parsed;
  } else if (raw.year) {
    year = Number(raw.year);
  }

  const poster = raw.cover?.url ?? raw.poster ?? raw.stills?.url ?? null;
  // subjectType: 1 = movie, 2 = series / tv
  const type = raw.subjectType === 2 || raw.type === 'series' || (raw.seNum && raw.seNum > 0)
    ? 'series'
    : 'movie';

  return {
    subjectId,
    title,
    year,
    poster,
    type,
    seasonNum: raw.seNum ?? null,
  };
}

function toMediaDetails(raw) {
  if (!raw) return null;
  const subjectId = String(raw.subjectId ?? raw.id ?? '');
  const title = raw.title ?? raw.name ?? raw.postTitle ?? 'Untitled';

  let year = null;
  if (raw.releaseDate) {
    const parsed = parseInt(String(raw.releaseDate).slice(0, 4), 10);
    if (!isNaN(parsed)) year = parsed;
  } else if (raw.year) {
    year = Number(raw.year);
  }

  // Genres parsing
  let genres = [];
  if (typeof raw.genre === 'string') {
    genres = raw.genre.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(raw.genres)) {
    genres = raw.genres;
  }

  // Duration formatting
  let duration = raw.duration ?? null;
  if (!duration && raw.durationSeconds) {
    const mins = Math.floor(raw.durationSeconds / 60);
    duration = `${mins} min`;
  }

  // Rating
  const rating = raw.imdbRatingValue ?? raw.imdbRating ?? raw.rating ?? null;

  // Type: movie or series
  const isSeries = raw.subjectType === 2 || (raw.seNum !== undefined && raw.seNum > 0);
  const type = isSeries ? 'series' : 'movie';

  // Seasons / episodes metadata if present
  const seasons = [];
  if (isSeries) {
    const seNum = raw.seNum || 1;
    seasons.push({
      seasonNumber: seNum,
      title: `Season ${seNum}`,
      episodeCount: raw.episodeCount || raw.epNum || null,
    });
  }

  return {
    subjectId,
    title,
    description: raw.description ?? raw.overview ?? 'No overview available.',
    year,
    poster: raw.cover?.url ?? raw.stills?.url ?? raw.poster ?? null,
    genres,
    duration,
    rating,
    type,
    subtitles: raw.subtitles ?? '',
    dubs: raw.dubs ?? [],
    trailerUrl: raw.trailer?.VideoAddress?.url ?? null,
    seasons,
    country: raw.countryName ?? null,
    language: raw.language ?? null,
  };
}

function toRelease(raw) {
  if (!raw) return null;

  const mirrors = [];
  if (Array.isArray(raw.mirrors)) {
    for (const m of raw.mirrors) {
      mirrors.push({
        label: m.label ?? 'Server Mirror',
        resolverUrl: m.url ?? m.resolverUrl ?? '',
        directFile: Boolean(m.directFile ?? true),
      });
    }
  } else if (raw.url) {
    mirrors.push({
      label: raw.format ? `${raw.format} Direct Stream` : 'Primary Mirror',
      resolverUrl: raw.url,
      directFile: true,
      signCookie: raw.signCookie ?? null,
    });
  }

  // If signCookie has encoded DASH URL prefix, expose full movie DASH stream mirror as well
  if (raw.signCookie && typeof raw.signCookie === 'string' && raw.signCookie.includes('urlprefix=')) {
    try {
      const match = raw.signCookie.match(/urlprefix=([^:]+)/);
      if (match && match[1]) {
        const decodedPrefix = Buffer.from(match[1], 'base64').toString('utf8');
        const normalizedPrefix = decodedPrefix.endsWith('/') ? decodedPrefix : `${decodedPrefix}/`;
        mirrors.push({
          label: 'Full Movie DASH Stream (1080p/720p)',
          resolverUrl: `${normalizedPrefix}index.mpd`,
          directFile: false,
          isDash: true,
          signCookie: raw.signCookie,
        });
        // The fragmented-MP4 variant of the same DASH path can often be played
        // directly by <video> through our proxy (no MSE/DASH parsing needed).
        for (const guess of ['index-f1-v1-x3.mp4', 'index-f1-v1x.mp4']) {
          mirrors.push({
            label: `Full Movie DASH Stream (${guess.replace('index-', '').replace('.mp4', '')})`,
            resolverUrl: `${normalizedPrefix}${guess}`,
            directFile: true,
            signCookie: raw.signCookie,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Quality parsing: e.g. "1080", "1080,720,480", or "720p"
  let quality = 'Standard';
  if (raw.displayResolutions) {
    quality = `${raw.displayResolutions}p`;
  } else if (raw.resolutions) {
    const maxRes = String(raw.resolutions).split(',')[0];
    quality = `${maxRes}p`;
  } else if (raw.resolution) {
    quality = `${raw.resolution}p`;
  } else if (raw.format) {
    quality = raw.format;
  }

  return {
    provider: 'movieBoxWeb',
    filename: raw.filename ?? (raw.url ? raw.url.split('/').pop().split('?')[0] : null),
    quality,
    resolutions: raw.resolutions ?? raw.displayResolutions ?? null,
    codec: raw.codecName ?? raw.codec ?? null,
    language: raw.language ?? null,
    sizeBytes: raw.size ? Number(raw.size) : null,
    duration: raw.duration ?? null,
    season: raw.season ?? raw.seNum ?? null,
    episode: raw.episode ?? raw.epNum ?? null,
    mirrors,
  };
}

/**
 * Defensive parser that checks multiple potential keys for streams/releases.
 */
function extractReleases(raw) {
  if (!raw) return [];

  let streamList = [];

  if (Array.isArray(raw)) {
    streamList = raw;
  } else if (Array.isArray(raw.streams)) {
    streamList = raw.streams;
  } else if (raw.playInfo && Array.isArray(raw.playInfo.streams)) {
    streamList = raw.playInfo.streams;
  } else if (Array.isArray(raw.releases)) {
    streamList = raw.releases;
  } else if (Array.isArray(raw.list)) {
    streamList = raw.list;
  } else if (raw.resource && Array.isArray(raw.resource.streams)) {
    streamList = raw.resource.streams;
  } else if (Array.isArray(raw.data)) {
    streamList = raw.data;
  } else if (raw.data && Array.isArray(raw.data.streams)) {
    streamList = raw.data.streams;
  } else if (raw.streams && typeof raw.streams === 'object') {
    streamList = [raw.streams];
  } else if (raw.url) {
    streamList = [raw];
  }

  return streamList.map(toRelease).filter(Boolean);
}

module.exports = {
  toCatalogItem,
  toMediaDetails,
  toRelease,
  extractReleases,
};
