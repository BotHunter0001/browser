/**
 * vegaAdapter.js - Universal adapter converting any Vega provider into CineSphere's Provider model.
 */
const path = require('path');
const fs = require('fs');
const { providerContext } = require('./vegaContext');

class VegaAdapter {
  constructor(manifestEntry) {
    this.id = manifestEntry.value;
    this.name = manifestEntry.value;
    this.displayName = manifestEntry.display_name || manifestEntry.value;
    this.category = manifestEntry.type || 'global';
    this.tagline = `Vega scraper (${this.category})`;
    this.type = 'vega';
    this.icon = manifestEntry.icon || null;
    // Don't disable MovieBox Web if the user wants it enabled
    this.disabled = false;

    const providerDir = path.join(__dirname, 'vega-dist', this.id);
    this.providerDir = providerDir;

    // Lazily loaded modules
    this._postsMod = null;
    this._metaMod = null;
    this._streamMod = null;
  }

  _loadModule(name) {
    const file = path.join(this.providerDir, `${name}.js`);
    if (fs.existsSync(file)) {
      try {
        return require(file);
      } catch {
        return null;
      }
    }
    return null;
  }

  get postsMod() {
    if (!this._postsMod) this._postsMod = this._loadModule('posts');
    return this._postsMod;
  }

  get metaMod() {
    if (!this._metaMod) this._metaMod = this._loadModule('meta');
    return this._metaMod;
  }

  get streamMod() {
    if (!this._streamMod) this._streamMod = this._loadModule('stream');
    return this._streamMod;
  }

  get catalogMod() {
    if (!this._catalogMod) this._catalogMod = this._loadModule('catalog');
    return this._catalogMod;
  }

  async catalog(filter = '', page = 1) {
    const mod = this.postsMod;
    if (!mod || typeof mod.getPosts !== 'function') return [];

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5000);

      const defaultFilter = this.id === 'movieBoxWeb' ? '/' : (this.id === 'anikoto' ? '/most-viewed' : '');
      let cleanFilter = filter || defaultFilter;
      if (cleanFilter && !cleanFilter.startsWith('/') && !cleanFilter.startsWith('?')) {
        if (cleanFilter === 'anime' || cleanFilter === 'all' || cleanFilter === 'movies') {
          cleanFilter = this.id === 'anikoto' ? '/most-viewed' : '/';
        } else {
          cleanFilter = '/' + cleanFilter;
        }
      }
      const items = await Promise.race([
        mod.getPosts({
          filter: cleanFilter,
          page,
          signal: ctrl.signal,
          providerContext,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Vega catalog timeout')), 5000)
        ),
      ]);
      clearTimeout(timeout);

      if (!Array.isArray(items)) return [];

      return items
        .filter((item) => item && (item.title || item.name))
        .map((item) => {
          const rawTitle = item.title || item.name || 'Untitled';
          const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
          const year = yearMatch ? Number(yearMatch[1]) : (item.year ? Number(item.year) : null);
          const isSeries =
            item.type === 'series' ||
            item.type === 'tv' ||
            rawTitle.toLowerCase().includes('season') ||
            rawTitle.toLowerCase().includes('s0');

          return {
            subjectId: item.link || item.id || rawTitle,
            title: rawTitle,
            year,
            poster: item.image || item.poster || null,
            type: isSeries ? 'series' : 'movie',
            provider: this.id,
            providerDisplayName: this.displayName,
          };
        });
    } catch {
      return [];
    }
  }

  async search(query, page = 1) {
    if (!query) return [];
    const mod = this.postsMod;
    if (!mod) return [];

    const searchFn = mod.getSearchPosts || mod.getPosts;
    if (typeof searchFn !== 'function') return [];

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4500);

      const items = await Promise.race([
        searchFn({
          searchQuery: query,
          filter: query,
          page,
          signal: ctrl.signal,
          providerContext,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Vega search timeout')), 4500)
        ),
      ]);
      clearTimeout(timeout);

      if (!Array.isArray(items)) return [];

      return items
        .filter((item) => item && (item.title || item.name))
        .map((item) => {
          const rawTitle = item.title || item.name || 'Untitled';
          const yearMatch = rawTitle.match(/\b(19\d{2}|20\d{2})\b/);
          const year = yearMatch ? Number(yearMatch[1]) : (item.year ? Number(item.year) : null);
          const isSeries =
            item.type === 'series' ||
            item.type === 'tv' ||
            rawTitle.toLowerCase().includes('season') ||
            rawTitle.toLowerCase().includes('s0');

          return {
            subjectId: item.link || item.id || rawTitle,
            title: rawTitle,
            year,
            poster: item.image || item.poster || null,
            type: isSeries ? 'series' : 'movie',
            provider: this.id,
            providerDisplayName: this.displayName,
          };
        });
    } catch {
      return [];
    }
  }

  async details(id) {
    const mod = this.metaMod;
    if (!mod || typeof mod.getMeta !== 'function') {
      throw new Error(`${this.displayName}: meta module unavailable`);
    }

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);

    let meta;
    try {
      meta = await Promise.race([
        mod.getMeta({
          link: id,
          signal: ctrl.signal,
          providerContext,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Vega meta timeout')), 5000)
        ),
      ]);
    } catch (err) {
      throw new Error(`${this.displayName} details failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!meta) throw new Error(`${this.displayName}: getMeta returned no data`);

    const title = meta.title || meta.name || '';
    if (!title) throw new Error(`${this.displayName}: getMeta returned no title`);

    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    const year = meta.year ? Number(meta.year) : (yearMatch ? Number(yearMatch[1]) : null);
    const isSeries = meta.type === 'series' || meta.type === 'tv' || title.toLowerCase().includes('season');

    const { normalizeSeasons } = require('./lib/seasonParser');
    let seasons = [];
    try {
      seasons = await normalizeSeasons(meta, {
        providerInfo: { id: this.id, dir: this.providerDir },
        preferredLanguages: ['original', 'english', 'hindi'],
      });
    } catch {
      seasons = [];
    }

    return {
      subjectId: id,
      title,
      description: meta.synopsis || meta.description || 'No overview available.',
      year,
      poster: meta.image || meta.poster || null,
      genres: meta.genres || [],
      duration: null,
      rating: meta.rating || meta.imdbRating || null,
      type: isSeries ? 'series' : 'movie',
      seasons,
      linkList: meta.linkList || [],
      provider: this.id,
      providerDisplayName: this.displayName,
    };
  }

  async streams(id) {
    const mod = this.streamMod;
    if (!mod || typeof mod.getStream !== 'function') return [];

    let rawStreams = [];

    // 1. If ID is already a JSON directLink or standard link
    try {
      const res = await mod.getStream({
        link: id,
        type: 'movie',
        providerContext,
      });
      if (Array.isArray(res) && res.length > 0) {
        rawStreams = res;
      }
    } catch {
      // ignore
    }

    // 2. If direct getStream failed or returned empty and id is not JSON, resolve via linkList.
    // Call metaMod.getMeta() directly instead of this.details() — the details() method now
    // throws on failure, which would be silently swallowed here and leave linkList empty.
    if (rawStreams.length === 0 && !id.trim().startsWith('{')) {
      try {
        const metaMod = this.metaMod;
        const rawMeta = (metaMod && typeof metaMod.getMeta === 'function')
          ? await metaMod.getMeta({ link: id, providerContext })
          : null;
        const linkList = (rawMeta && Array.isArray(rawMeta.linkList)) ? rawMeta.linkList : [];

        for (const group of linkList.slice(0, 4)) {
          // Direct links array
          if (Array.isArray(group.directLinks) && group.directLinks.length > 0) {
            for (const d of group.directLinks.slice(0, 3)) {
              if (d && d.link) {
                try {
                  const sRes = await mod.getStream({
                    link: d.link,
                    type: d.type || 'movie',
                    providerContext,
                  });
                  if (Array.isArray(sRes)) {
                    rawStreams.push(...sRes);
                  }
                } catch {
                  // try next
                }
              }
            }
          }
          // Episodes or direct link on group
          if (group.episodesLink || group.link) {
            const targetLink = group.episodesLink || group.link;
            try {
              const sRes = await mod.getStream({
                link: targetLink,
                type: 'movie',
                providerContext,
              });
              if (Array.isArray(sRes)) {
                rawStreams.push(...sRes);
              }
            } catch {
              // try next
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (!Array.isArray(rawStreams) || rawStreams.length === 0) {
      return [];
    }

    // Group streams by quality or return releases
    return rawStreams
      .filter((s) => s && s.link)
      .map((s, idx) => {
        const quality = s.quality ? `${s.quality}p` : '1080p';
        const serverName = s.server || `Server ${idx + 1}`;
        const isMp4 = s.link.includes('.mp4') || s.type === 'mp4';
        const isM3u8 = s.link.includes('.m3u8') || s.type === 'm3u8' || s.type === 'hls';
        // Some hosts (gofile etc.) require special headers/cookies to fetch the file
        const streamHeaders = (s.headers && typeof s.headers === 'object') ? s.headers : null;

        return {
          provider: this.displayName,
          filename: `${serverName}.${isMp4 ? 'mp4' : isM3u8 ? 'm3u8' : 'mkv'}`,
          quality,
          codec: s.type || null,
          language: null,
          sizeBytes: null,
          season: null,
          episode: null,
          subtitles: s.subtitles || [],
          headers: streamHeaders,
          mirrors: [
            {
              label: serverName,
              resolverUrl: s.link,
              directFile: isMp4 || isM3u8,
              subtitles: s.subtitles || [],
              headers: streamHeaders,
            },
          ],
        };
      });
  }
}

/**
 * Loads all providers from vega-manifest.json
 */
function loadAllVegaProviders(includeDisabled = true) {
  const manifestPath = path.join(__dirname, 'vega-manifest.json');
  if (!fs.existsSync(manifestPath)) return [];

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest
      .filter((p) => p && p.value && (includeDisabled || !p.disabled))
      .map((p) => new VegaAdapter(p));
  } catch (e) {
    console.error('Failed to load Vega providers manifest:', e);
    return [];
  }
}

module.exports = {
  VegaAdapter,
  loadAllVegaProviders,
};
