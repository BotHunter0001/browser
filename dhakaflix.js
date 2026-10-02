// dhakaflix.js
const HOSTS = [
  'http://172.16.50.7',
  'http://172.16.50.14',
  'http://172.16.50.12',
  'http://172.16.50.9',
];

async function reachableHost() {
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/api/list`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.ok) return host;
    } catch {
      // try next host
    }
  }
  return null;
}

class DhakaFlixProvider {
  constructor() {
    this.name = 'dhakaflix';
    this.displayName = 'DhakaFlix';
  }

  async search(query) {
    const host = await reachableHost();
    if (!host) return [];

    try {
      const res = await fetch(`${host}/api/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const data = await res.json();

      return (data.results ?? []).map((r) => ({
        subjectId: String(r.id),
        title: r.name,
        year: r.year ? Number(r.year) : null,
        poster: r.poster ?? null,
        type: 'movie',
        provider: 'dhakaflix',
      }));
    } catch {
      return [];
    }
  }

  async details(id) {
    const host = await reachableHost();
    if (!host) throw new Error('No BDIX server reachable');

    const res = await fetch(`${host}/api/item/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return {
      subjectId: String(d.id),
      title: d.name,
      description: d.description ?? '',
      year: d.year ? Number(d.year) : null,
      poster: d.poster ?? null,
      genres: [],
      duration: null,
      rating: null,
      type: 'movie',
      provider: 'dhakaflix',
    };
  }

  async streams(id) {
    const host = await reachableHost();
    if (!host) return [];

    try {
      const res = await fetch(`${host}/api/item/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const d = await res.json();
      return (d.files ?? []).map((f) => ({
        provider: 'DhakaFlix',
        filename: f.name,
        quality: f.quality ?? 'HD',
        codec: null,
        language: null,
        sizeBytes: f.size ? Number(f.size) : null,
        season: null,
        episode: null,
        mirrors: [{ label: host, resolverUrl: `${host}${f.path}`, directFile: true }],
      }));
    } catch {
      return [];
    }
  }
}

module.exports = { DhakaFlixProvider };
