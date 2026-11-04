const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
const html = read('public', 'index.html');
const app = read('public', 'app.js');
const css = read('public', 'style.css');
const server = read('server.js');

test('downloads library is reachable and has real queue controls', () => {
  for (const id of [
    'tabDownloadsBtn',
    'libDownloadsBadge',
    'libraryDownloadsContainer',
    'queuePlayerStream',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists in index.html`);
  }

  assert.match(app, /tabDownloadsBtn\?\.addEventListener\('click',\s*\(\)\s*=>\s*switchLibraryTab\('downloads'\)\)/);
  assert.ok(app.includes("data-action=\"dl-toggle\""));
  assert.ok(app.includes("data-action=\"dl-cancel\""));
  assert.ok(app.includes("data-action=\"dl-remove\""));
  assert.ok(app.includes("action === 'queue-download'"));
  assert.ok(app.includes('function queueDownloadFromStream'));
  assert.ok(app.includes("apiDownload('', 'POST', body)"));
  assert.match(server, /app\.get\('\/api\/downloads\/:id\/file'/);
  assert.match(server, /res\.download\(file\.path, file\.filename/);
});

test('new searches and catalog loads cancel stale in-flight requests', () => {
  assert.ok(app.includes('function beginBrowseRequest'));
  assert.ok(app.includes('browseController?.abort()'));
  assert.ok(app.includes('isCurrentBrowseRequest(controller)'));
  assert.ok(app.includes("err?.name === 'AbortError'"));
  assert.ok(app.includes('controller.signal'));
  assert.ok(app.includes('const contextSnapshot = resultContext'));
});

test('search autocomplete, recent searches, and backup/import are wired', () => {
  assert.ok(html.includes('id="searchSuggestionsDropdown"'));
  assert.ok(html.includes('id="libraryExportBtn"'));
  assert.ok(html.includes('id="libraryImportBtn"'));
  assert.ok(html.includes('id="libraryImportFile"'));
  assert.ok(app.includes('function loadSearchSuggestions'));
  assert.ok(app.includes('function renderSearchSuggestions'));
  assert.ok(app.includes('function saveSearchTerm'));
  assert.ok(app.includes('function exportLibraryBackup'));
  assert.ok(app.includes('function importLibraryBackup'));
  assert.ok(app.includes("libraryExportBtn?.addEventListener('click', exportLibraryBackup)"));
  assert.ok(app.includes("libraryImportFile?.addEventListener('change'"));
});

test('player sleep timer and auto-next preference are implemented', () => {
  assert.ok(html.includes('id="sleepTimerSelect"'));
  assert.ok(html.includes('id="autoNextToggle"'));
  assert.ok(app.includes('function scheduleSleepTimer'));
  assert.ok(app.includes('function autoNextEnabled'));
  assert.ok(app.includes('AUTO_NEXT_STORAGE_KEY'));
  assert.ok(app.includes("sleepTimerSelect?.addEventListener('change'"));
  assert.ok(app.includes('videoPlayer.pause()'));
});

test('security: no inline handlers remain and CSP forbids inline scripts', () => {
  assert.equal(/on(?:error|click|load|submit|change|input)\s*=\s*"/i.test(html + app), false);
  assert.equal(/script-src[^;]*'unsafe-inline'/i.test(server), false);
  assert.ok(server.includes("res.setHeader('Content-Security-Policy', csp)"));
  assert.ok(app.includes('function safeImageUrl'));
  assert.ok(app.includes("image.src = POSTER_FALLBACK"));
  assert.equal(/\$\{posterUrl\}/.test(app), true, 'posters still render through escaped URL values');
  assert.equal(/onerror\s*=\s*"/.test(app), false);
  const hlsScript = html.match(/<script[^>]+hls\.js@([^/]+)[^>]+>/);
  assert.ok(hlsScript, 'hls.js is loaded');
  assert.match(hlsScript[1], /^\d+\.\d+\.\d+$/, 'hls.js version is pinned');
  assert.match(hlsScript[0], /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(hlsScript[0], /crossorigin="anonymous"/);
});

test('downloads and proxy responses are bounded and validated', () => {
  assert.ok(server.includes('readBodyLimited'));
  assert.ok(server.includes('5 * 1024 * 1024'), 'HLS playlists are capped');
  assert.ok(server.includes('10 * 1024 * 1024'), 'posters are capped');
  assert.match(server, /assertSafeUrl\(url\)/);
  assert.match(server, /MAX_ITEMS_PER_REQUEST/);
  assert.match(server, /Cross-site request rejected/);
});

test('catalog aliases are registered before the provider parameter route', () => {
  const homepage = server.indexOf("'/api/catalog/homepage'");
  const provider = server.indexOf("'/api/catalog/:provider'");
  assert.ok(homepage > 0 && provider > homepage, 'static aliases win over :provider');
  assert.ok(server.includes("resources: ['catalog']"));
  assert.ok(server.includes('Unsupported catalog type'));
});

test('toast styling and accessible library tabs exist', () => {
  assert.ok(css.includes('.app-toast'));
  assert.ok(css.includes('.app-toast-visible'));
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('role="tabpanel"'));
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(app.includes('role="option"'), 'suggestion options expose the listbox option role');
});
