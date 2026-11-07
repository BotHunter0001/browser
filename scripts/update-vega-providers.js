#!/usr/bin/env node
/**
 * Update the vendored Vega provider bundle from the official GitHub repo.
 *
 *   npm run providers:check    # compare versions/URLs only
 *   npm run providers:update   # download, validate, and swap in a new bundle
 *
 * The swap is staged and validated before the live files are touched. A copy
 * of the previous bundle is kept in .vega-backup/ for manual rollback.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'Zenda-Cross/vega-providers';
const REF = process.env.VEGA_PROVIDERS_REF || 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(REF)}?recursive=1`;
const CHECK_ONLY = process.argv.includes('--check') || process.argv.includes('--dry-run');
const CONCURRENCY = 8;
const MODULE_NAMES = ['catalog', 'posts', 'meta', 'stream', 'episodes', 'settings'];

function log(message) {
  console.log(`[providers] ${message}`);
}

async function fetchText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CineSphere-Provider-Updater' },
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`);
  }
}

function parseManifest(text) {
  const manifest = JSON.parse(text);
  if (!Array.isArray(manifest)) throw new Error('Provider manifest must be an array');

  const seen = new Set();
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object') throw new Error('Provider manifest entries must be objects');
    if (typeof entry.value !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entry.value)) {
      throw new Error(`Invalid provider value: ${JSON.stringify(entry.value)}`);
    }
    if (typeof entry.version !== 'string' || !/^[A-Za-z0-9_.+-]+$/.test(entry.version)) {
      throw new Error(`Invalid version for ${entry.value}`);
    }
    if (seen.has(entry.value)) throw new Error(`Duplicate provider value: ${entry.value}`);
    seen.add(entry.value);
  }
  return manifest;
}

function parseUrls(text) {
  const urls = JSON.parse(text);
  if (!urls || typeof urls !== 'object' || Array.isArray(urls)) {
    throw new Error('Provider URL configuration must be an object');
  }
  for (const [key, value] of Object.entries(urls)) {
    if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !/^https?:\/\//i.test(value.url)) {
      throw new Error(`Invalid URL entry: ${key}`);
    }
  }
  return urls;
}

function compareVersions(a, b) {
  const left = String(a || '').split(/[.+-]/).map((part) => Number(part) || 0);
  const right = String(b || '').split(/[.+-]/).map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
  }
  return 0;
}

function readLocalJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listRemoteDistFiles(manifest) {
  try {
    const tree = await fetchJson(TREE_URL);
    if (!tree || !Array.isArray(tree.tree) || tree.truncated) {
      throw new Error('GitHub tree response is incomplete');
    }
    const values = new Set(manifest.map((entry) => entry.value));
    return tree.tree
      .filter((item) => item.type === 'blob' && item.path.endsWith('.js') && item.path.startsWith('dist/'))
      .map((item) => item.path)
      .filter((file) => {
        const parts = file.split('/');
        return parts.length === 2 || (parts.length === 3 && values.has(parts[1]));
      });
  } catch (error) {
    log(`Could not list remote files (${error.message}); falling back to the known module list.`);
    const files = ['dist/headers.js', 'dist/providerContext.js'];
    for (const entry of manifest) {
      for (const moduleName of MODULE_NAMES) {
        files.push(`dist/${entry.value}/${moduleName}.js`);
      }
    }
    return files;
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function validateProviderModule(file, code, provider, version) {
  const expected = `// @vega-provider ${provider}\n// @vega-version ${version}\n`;
  if (!code.startsWith(expected)) {
    throw new Error(`${file} is not stamped for ${provider} ${version}`);
  }
  try {
    new vm.Script(code, { filename: file });
  } catch (error) {
    throw new Error(`${file} has invalid JavaScript: ${error.message}`);
  }
}

function providerForFile(file) {
  const parts = file.split('/');
  return parts.length === 3 ? parts[1] : null;
}

function formatManifestDiff(localManifest, remoteManifest) {
  const local = new Map((localManifest || []).map((entry) => [entry.value, entry]));
  const remote = new Map(remoteManifest.map((entry) => [entry.value, entry]));
  const lines = [];

  for (const [value, entry] of remote) {
    const previous = local.get(value);
    if (!previous) {
      lines.push(`  + ${value} ${entry.version} (new provider)`);
    } else if (compareVersions(previous.version, entry.version) !== 0) {
      lines.push(`  * ${value} ${previous.version} -> ${entry.version}`);
    }
  }
  for (const value of local.keys()) {
    if (!remote.has(value)) lines.push(`  - ${value} (removed upstream)`);
  }
  return lines;
}

function formatUrlDiff(localUrls, remoteUrls) {
  const local = localUrls || {};
  const lines = [];
  for (const [key, value] of Object.entries(remoteUrls)) {
    const previous = local[key];
    if (!previous) lines.push(`  + ${key} ${value.url}`);
    else if (previous.url !== value.url) lines.push(`  * ${key} ${previous.url} -> ${value.url}`);
  }
  for (const key of Object.keys(local)) {
    if (!remoteUrls[key]) lines.push(`  - ${key} (removed upstream)`);
  }
  return lines;
}

async function main() {
  log(`Checking ${REPO}@${REF}...`);

  const [manifestText, urlsText] = await Promise.all([
    fetchText(`${RAW_BASE}/manifest.json`),
    fetchText(`${RAW_BASE}/urls.json`),
  ]);
  const remoteManifest = parseManifest(manifestText);
  const remoteUrls = parseUrls(urlsText);

  const manifestPath = path.join(ROOT, 'vega-manifest.json');
  const urlsPath = path.join(ROOT, 'vega-urls.json');
  const distPath = path.join(ROOT, 'vega-dist');
  const localManifest = readLocalJson(manifestPath);
  const localUrls = readLocalJson(urlsPath);

  const manifestDiff = formatManifestDiff(localManifest, remoteManifest);
  const urlDiff = formatUrlDiff(localUrls, remoteUrls);

  log(`Remote manifest: ${remoteManifest.length} providers`);
  if (manifestDiff.length) {
    log('Provider changes:');
    for (const line of manifestDiff) console.log(line);
  } else {
    log('Provider versions are already up to date.');
  }

  if (urlDiff.length) {
    log(`Provider URL changes: ${urlDiff.length}`);
    for (const line of urlDiff.slice(0, 40)) console.log(line);
    if (urlDiff.length > 40) log(`... and ${urlDiff.length - 40} more URL changes`);
  } else {
    log('Provider URLs are already up to date.');
  }

  if (CHECK_ONLY) {
    log('Check-only mode: no files were changed. Run "npm run providers:update" to apply.');
    return;
  }

  const files = await listRemoteDistFiles(remoteManifest);
  log(`Downloading ${files.length} provider module(s)...`);

  const versionByProvider = new Map(remoteManifest.map((entry) => [entry.value, entry.version]));
  const stagingRoot = path.join(ROOT, `.vega-update-${process.pid}`);
  const stagingDist = path.join(stagingRoot, 'dist');
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingDist, { recursive: true });

  let downloaded = 0;
  let changedFiles = 0;
  let skipped = 0;

  try {
    await mapLimit(files, CONCURRENCY, async (file) => {
      const parts = file.split('/');
      if (parts.some((part) => part === '..' || part === '.')) {
        throw new Error(`Unsafe remote path: ${file}`);
      }

      let code;
      try {
        code = await fetchText(`${RAW_BASE}/${file}`);
      } catch (error) {
        if (error.status === 404 && providerForFile(file)) {
          skipped += 1;
          return;
        }
        throw error;
      }

      const provider = providerForFile(file);
      if (provider) {
        const version = versionByProvider.get(provider);
        if (!version) throw new Error(`File ${file} belongs to a provider missing from the manifest`);
        validateProviderModule(file, code, provider, version);
      } else if (file.endsWith('.js')) {
        try {
          new vm.Script(code, { filename: file });
        } catch (error) {
          throw new Error(`${file} has invalid JavaScript: ${error.message}`);
        }
      }

      const target = path.join(stagingRoot, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, code);

      const localTarget = path.join(ROOT, 'vega-dist', file.slice('dist/'.length));
      if (!fs.existsSync(localTarget) || fs.readFileSync(localTarget, 'utf8') !== code) {
        changedFiles += 1;
      }
      downloaded += 1;
    });

    fs.writeFileSync(path.join(stagingRoot, 'manifest.json'), manifestText);
    fs.writeFileSync(path.join(stagingRoot, 'urls.json'), urlsText);

    const contentChanged = changedFiles > 0 ||
      JSON.stringify(localManifest) !== JSON.stringify(remoteManifest) ||
      JSON.stringify(localUrls) !== JSON.stringify(remoteUrls);

    if (!contentChanged) {
      log(`Already up to date (${downloaded} files checked).`);
      return;
    }

    const backupRoot = path.join(ROOT, '.vega-backup');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.mkdirSync(backupRoot, { recursive: true });

    if (fs.existsSync(distPath)) fs.renameSync(distPath, path.join(backupRoot, 'vega-dist'));
    if (fs.existsSync(manifestPath)) fs.renameSync(manifestPath, path.join(backupRoot, 'vega-manifest.json'));
    if (fs.existsSync(urlsPath)) fs.renameSync(urlsPath, path.join(backupRoot, 'vega-urls.json'));

    try {
      fs.renameSync(stagingDist, distPath);
      fs.writeFileSync(manifestPath, manifestText);
      fs.writeFileSync(urlsPath, urlsText);
    } catch (error) {
      // Put the previous bundle back if the final swap fails.
      fs.rmSync(distPath, { recursive: true, force: true });
      fs.rmSync(manifestPath, { force: true });
      fs.rmSync(urlsPath, { force: true });
      const backupDist = path.join(backupRoot, 'vega-dist');
      const backupManifest = path.join(backupRoot, 'vega-manifest.json');
      const backupUrls = path.join(backupRoot, 'vega-urls.json');
      if (fs.existsSync(backupDist)) fs.renameSync(backupDist, distPath);
      if (fs.existsSync(backupManifest)) fs.renameSync(backupManifest, manifestPath);
      if (fs.existsSync(backupUrls)) fs.renameSync(backupUrls, urlsPath);
      throw error;
    }

    log(`Updated ${remoteManifest.length} providers (${downloaded} modules, ${changedFiles} changed, ${skipped} skipped).`);
    log('Restart the server to load the new provider modules.');
    log(`Previous bundle kept in ${path.relative(ROOT, backupRoot)}.`);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[providers] Update failed: ${error.message}`);
  process.exitCode = 1;
});
