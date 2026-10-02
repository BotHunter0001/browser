// fourkdhhub.js
const cheerio = require('cheerio');
const BASE = process.env.FOURKDH_BASE || 'https://4khdhub.site';

// Regex shared with seasonParser — matches "s01", "s01e02", "season 1" etc.
// Using a word-boundary check so "S0cial" or "S0mething" doesn't misfire.
const SERIES_TITLE_RE = /\b(season|series)\s*\d+|\bs\d{2}e\d{2}\b|\bs\d{2}\b/i;

class FourKHDHubProvider {
  constructor() {
    this.name = '4khdhub';
    this.displayName = '4KHDHub';
  }

  async search(query) {
    try {
      const res = await fetch(`${BASE}/?s=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(2000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);

      const items = [];
      $('article, .movie-item, .post-item, .result-item').each((_, el) => {
        const $el = $(el);
        const link = $el.find('a').first().attr('href');
        const title = $el.find('.title, h2, h3, .entry-title').first().text().trim() || $el.find('a').first().attr('title');
        const yearMatch = title ? title.match(/\b(19\d{2}|20\d{2})\b/) : null;
        const year = yearMatch ? Number(yearMatch[1]) : (Number($el.find('.year').text()) || null);
        const poster = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');

        if (link && title) {
          items.push({
            subjectId: link,
            title,
            year,
            poster: poster ?? null,
            // B2b fix: use the shared SERIES_TITLE_RE regex instead of the
            // naive `title.includes('s0')` check that misfires on titles like
            // "S0cial Network", "S0mewhere", etc.
            type: SERIES_TITLE_RE.test(title) ? 'series' : 'movie',
            provider: '4khdhub',
          });
        }
      });
      return items;
    } catch {
      return [];
    }
  }

  async details(id) {
    try {
      const res = await fetch(id, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('h1').first().text().trim() || $('title').text().trim();
      const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
      const year = yearMatch ? Number(yearMatch[1]) : null;
      const description = $('.description, .entry-content p, .storyline').first().text().trim();
      const poster = $('.poster img, .entry-content img, meta[property="og:image"]').attr('src')
        || $('meta[property="og:image"]').attr('content');

      return {
        subjectId: id,
        title,
        description: description || 'Synopsis available on provider page.',
        year,
        poster: poster ?? null,
        genres: [],
        duration: null,
        rating: null,
        type: SERIES_TITLE_RE.test(title) ? 'series' : 'movie',
        provider: '4khdhub',
      };
    } catch (err) {
      throw new Error(`4KHDHub details failed: ${err.message}`);
    }
  }

  async streams(id) {
    try {
      const res = await fetch(id, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);

      const links = [];
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (href.includes('hubcloud') || href.includes('drive') || href.includes('download') || href.includes('link'))) {
          links.push({
            label: text || 'HubCloud / Download',
            resolverUrl: href,
            directFile: false,
          });
        }
      });

      // B2 fix: resolve HubCloud links in parallel (max 3) instead of
      // sequentially. Sequential resolution at 2 s timeout each = up to 10 s
      // worst-case; parallel cuts that to a single 2 s window.
      const topLinks = links.slice(0, 3);
      const resolved = await Promise.allSettled(
        topLinks.map((link) => this.resolveHubCloud(link.resolverUrl))
      );

      const mirrors = topLinks.map((link, i) => {
        const result = resolved[i];
        const direct = result.status === 'fulfilled' ? result.value : null;
        return direct
          ? { label: link.label, resolverUrl: direct, directFile: true }
          : link; // keep original intermediate link as fallback
      });

      const usableMirrors = mirrors.filter((m) => m.resolverUrl);
      if (usableMirrors.length === 0) return [];

      return [
        {
          provider: '4KHDHub',
          filename: $('h1').first().text().trim() || 'Video',
          quality: '1080p',
          codec: null,
          language: null,
          sizeBytes: null,
          season: null,
          episode: null,
          mirrors: usableMirrors,
        },
      ];
    } catch {
      return [];
    }
  }

  async resolveHubCloud(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const html = await res.text();
      const $ = cheerio.load(html);

      const direct = $('a.download').attr('href')
                  ?? $('a:contains("Download")').attr('href')
                  ?? $('a:contains("Direct")').attr('href');

      return direct ?? null;
    } catch {
      return null;
    }
  }
}

module.exports = { FourKHDHubProvider };
