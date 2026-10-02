/**
 * vegaContext.js - Vega Providers Execution Environment & Context
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 1. Pre-seed local URLs into global baseUrl cache so providers don't depend on GitHub raw requests
let localUrls = {};
try {
  const urlsPath = path.join(__dirname, 'vega-urls.json');
  if (fs.existsSync(urlsPath)) {
    localUrls = JSON.parse(fs.readFileSync(urlsPath, 'utf8'));
  }
} catch (e) {
  console.warn('[vegaContext] Could not load local vega-urls.json:', e.message);
}

// Ensure consumet has an entry so scrapers don't fail on missing baseUrl
if (!localUrls['consumet']) {
  localUrls['consumet'] = {
    name: 'consumet',
    url: 'https://consumet.stream',
  };
}

const state = typeof globalThis !== 'undefined' ? globalThis : global;
state.__vegaProviderBaseUrlCache__ = {
  data: localUrls,
  expiresAt: Date.now() + 86400000 * 365, // 1 year
};

// Silence known noisy errors from unmaintained upstream scrapers
const origConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : a?.message || '')).join(' ');
  if (msg.includes('flixhq error') || msg.includes('zoro error') || msg.includes('Invalid URL')) {
    return;
  }
  origConsoleError.apply(console, args);
};

// Safe global fetch wrapper preventing "TypeError: Invalid URL" on relative paths in scrapers
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    if (typeof input === 'string' && !/^https?:\/\//i.test(input)) {
      const base = localUrls['consumet']?.url || 'https://consumet.stream';
      input = `${base.replace(/\/+$/, '')}/${input.replace(/^\/+/, '')}`;
    }
    return originalFetch.call(this, input, init);
  };
}

const commonHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
};

// In-memory key-value store for Vega providers that store cookies/session keys
const inMemoryStore = new Map();
const kvStore = {
  get: async (key) => inMemoryStore.get(key) || null,
  set: async (key, val) => inMemoryStore.set(key, val),
  delete: async (key) => inMemoryStore.delete(key),
};

const axiosInstance = axios.create({
  timeout: 4000,
  headers: commonHeaders,
  validateStatus: () => true, // allow inspection of HTML error pages
  maxRedirects: 5,
});

// Normalize relative URLs passed by scrapers before axios tries to request them
axiosInstance.interceptors.request.use((config) => {
  if (config.url && typeof config.url === 'string' && !/^https?:\/\//i.test(config.url)) {
    const base = localUrls['consumet']?.url || 'https://consumet.stream';
    config.url = `${base.replace(/\/+$/, '')}/${config.url.replace(/^\/+/, '')}`;
  }
  return config;
}, (err) => Promise.reject(err));

const providerContext = {
  axios: axiosInstance,
  cheerio,
  commonHeaders,
  kvStore,
  Aes: null,
};

module.exports = {
  providerContext,
  commonHeaders,
  kvStore,
  localUrls,
};
