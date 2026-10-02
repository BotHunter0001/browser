// addons.js
// Implements the Stremio Addon protocol: Manifest → Catalog → Meta → Streams

class AddonProvider {
  constructor(addonUrl = 'https://v3-cinemeta.strem.io') {
    this.name = 'addon';
    this.displayName = 'Stremio Cinemeta';
    this.base = addonUrl.replace(/\/$/, '');
    this.manifest = null;
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    const res = await fetch(`${this.base}/manifest.json`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.manifest = await res.json();
    return this.manifest;
  }

  async search(query) {
    try {
      const m = await this.loadManifest();
      const catalogs = m.catalogs ?? [];
      const results = [];

      for (const cat of catalogs) {
        // B1 fix: `cat.type !== 'movie' || 'series'` is always truthy because
        // `'series'` is a non-empty string. The correct guard checks both types.
        const typeSupported = cat.type === 'movie' || cat.type === 'series';
        const hasSearchExtra = Array.isArray(cat.extra) && cat.extra.some(e => e.name === 'search');
        if (!hasSearchExtra && !typeSupported) {
          continue;
        }

        const url = `${this.base}/catalog/${cat.type}/${cat.id}.json?search=${encodeURIComponent(query)}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
          if (!res.ok) continue;
          const data = await res.json();
          for (const item of data.metas ?? []) {
            results.push({
              subjectId: `${cat.type}:${item.id}`,
              title: item.name,
              year: item.year ? Number(item.year) : (item.releaseInfo ? Number(String(item.releaseInfo).slice(0, 4)) : null),
              poster: item.poster ?? null,
              type: cat.type === 'series' ? 'series' : 'movie',
              provider: 'addon',
            });
          }
        } catch {
          // skip broken catalog
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  async catalog(type = 'movie', id = 'top') {
    try {
      const url = `${this.base}/catalog/${type}/${id}.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.metas || []).map((item) => ({
        subjectId: `${type}:${item.id}`,
        title: item.name,
        year: item.year ? Number(item.year) : (item.releaseInfo ? Number(String(item.releaseInfo).slice(0, 4)) : null),
        poster: item.poster ?? null,
        type: type === 'series' ? 'series' : 'movie',
        provider: 'addon',
        providerDisplayName: this.displayName,
      }));
    } catch {
      return [];
    }
  }

  async details(id) {
    const parts = id.split(':');
    const type = parts.length > 2 ? parts[0] : (id.startsWith('tt') ? 'movie' : (parts[0] || 'movie'));
    const realId = parts.length > 2 ? `${parts[1]}:${parts[2]}` : (parts[1] || id);

    try {
      const res = await fetch(`${this.base}/meta/${type}/${encodeURIComponent(realId)}.json`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const m = data.meta ?? {};
      const episodesBySeason = new Map();
      for (const [index, video] of (Array.isArray(m.videos) ? m.videos : []).entries()) {
        const season = Number(video.season);
        const seasonNumber = Number.isInteger(season) && season > 0 ? season : 1;
        const episode = Number(video.episode);
        const episodeNumber = Number.isInteger(episode) && episode > 0 ? episode : index + 1;
        const episodeId = video.id || `${realId}:${seasonNumber}:${episodeNumber}`;
        const episodes = episodesBySeason.get(seasonNumber) || [];
        episodes.push({
          episodeNumber,
          title: video.title || `Episode ${episodeNumber}`,
          streamId: `${type}:${episodeId}`,
        });
        episodesBySeason.set(seasonNumber, episodes);
      }

      return {
        subjectId: id,
        title: m.name ?? '',
        description: m.description ?? '',
        year: m.year ? Number(m.year) : (m.releaseInfo ? Number(String(m.releaseInfo).slice(0, 4)) : null),
        poster: m.poster ?? null,
        genres: m.genres ?? [],
        duration: m.runtime ?? null,
        rating: m.imdbRating ?? null,
        type: type === 'series' ? 'series' : 'movie',
        seasons: [...episodesBySeason.entries()].map(([seasonNumber, episodes]) => ({
          seasonNumber,
          title: `Season ${seasonNumber}`,
          episodeCount: episodes.length,
          episodes,
        })),
        provider: 'addon',
      };
    } catch (err) {
      throw new Error(`Addon details failed: ${err.message}`);
    }
  }

  async streams(id) {
    const parts = id.split(':');
    const explicitType = /^(movie|series):/.exec(id);
    const type = explicitType ? explicitType[1] : (parts.length > 2 ? parts[0] : (id.startsWith('tt') ? 'movie' : (parts[0] || 'movie')));
    const realId = explicitType ? id.slice(explicitType[0].length) : (parts.length > 2 ? `${parts[1]}:${parts[2]}` : (parts[1] || id));

    try {
      const res = await fetch(`${this.base}/stream/${type}/${encodeURIComponent(realId)}.json`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const data = await res.json();

      return (data.streams ?? []).map((s, i) => ({
        provider: 'Stremio Cinemeta',
        filename: s.title ?? s.name ?? `Stream ${i + 1}`,
        quality: s.name ?? 'Standard',
        codec: null,
        language: null,
        sizeBytes: null,
        season: null,
        episode: null,
        mirrors: [
          {
            label: s.name ?? `Stream ${i + 1}`,
            resolverUrl: s.url ?? s.externalUrl ?? '',
            directFile: Boolean(s.url && !s.externalUrl),
          },
        ],
      }));
    } catch {
      return [];
    }
  }
}

module.exports = { AddonProvider };
