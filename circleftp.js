// circleftp.js
const BASE = 'http://new.circleftp.net:5000/api';

class CircleFTPProvider {
  constructor() {
    this.name = 'circleftp';
    this.displayName = 'CircleFTP';
  }

  async search(query) {
    try {
      const res = await fetch(`${BASE}/posts?search=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.posts ?? []).map((p) => ({
        subjectId: String(p.id),
        title: p.title,
        year: p.year ? Number(p.year) : null,
        poster: p.poster ?? null,
        type: 'movie',
        provider: 'circleftp',
      }));
    } catch {
      return [];
    }
  }

  async catalog() {
    try {
      const res = await fetch(`${BASE}/posts?page=1`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.posts ?? []).map((p) => ({
        subjectId: String(p.id),
        title: p.title,
        year: p.year ? Number(p.year) : null,
        poster: p.poster ?? null,
        type: 'movie',
        provider: 'circleftp',
        providerDisplayName: this.displayName,
      }));
    } catch {
      return [];
    }
  }

  async details(id) {
    try {
      const res = await fetch(`${BASE}/posts/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      return {
        subjectId: String(d.id),
        title: d.title,
        description: d.description ?? '',
        year: d.year ? Number(d.year) : null,
        poster: d.poster ?? null,
        genres: [],
        duration: null,
        rating: null,
        type: 'movie',
        provider: 'circleftp',
      };
    } catch (err) {
      throw new Error(`CircleFTP details failed: ${err.message}`);
    }
  }

  async streams(id) {
    try {
      const res = await fetch(`${BASE}/posts/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const d = await res.json();
      return (d.links ?? []).map((l) => ({
        provider: 'CircleFTP',
        filename: d.title,
        quality: l.quality ?? 'Standard',
        codec: null,
        language: null,
        sizeBytes: l.size ? Number(l.size) : null,
        season: null,
        episode: null,
        mirrors: [{ label: 'CircleFTP Direct', resolverUrl: l.url, directFile: true }],
      }));
    } catch {
      return [];
    }
  }
}

module.exports = { CircleFTPProvider };
