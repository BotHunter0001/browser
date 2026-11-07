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

test('browser player exposes volume, fill mode, and complete keyboard shortcuts', () => {
  assert.ok(html.includes('id="playerVolume"'));
  assert.ok(html.includes('id="playerFitBtn"'));
  assert.ok(app.includes('function setPlayerVolume'));
  assert.ok(app.includes('function applyPlayerFill'));
  assert.ok(app.includes("localStorage.getItem(PLAYER_VOLUME_KEY)"));
  assert.ok(app.includes('raw === null ? NaN'), 'missing saved volume must not silence the player by default');
  assert.ok(app.includes("localStorage.getItem(PLAYER_FILL_KEY)"));
  assert.ok(app.includes("lower === 'j'"));
  assert.ok(app.includes("lower === 'p'"));
  assert.ok(app.includes("lower === 'c'"));
  assert.ok(app.includes("lower === 'a'"));
  assert.ok(app.includes("lower === 's'"));
  assert.ok(css.includes('.player-fill video'));
});

test('series player has a real next-episode button and series-only resolver', () => {
  assert.ok(html.includes('id="nextEpisodeBtn"'));
  assert.ok(html.includes('id="nextEpisodeBtnLabel"'));
  assert.ok(app.includes('function isSeriesMedia'));
  assert.ok(app.includes('function getSeriesEpisodeEntries'));
  assert.ok(app.includes('function getNextEpisodeContext'));
  assert.ok(app.includes('function updateNextEpisodeUi'));
  assert.ok(app.includes('data-audio='), 'episode buttons remember the active audio variant');
  assert.ok(app.includes('nextEpisodeBtn?.addEventListener'), 'next button is wired');
  assert.ok(app.includes("lower === 'n'"), 'N shortcut selects the next episode');
  assert.ok(app.includes('player-up-next'), 'the up-next card uses the working overlay class');
  assert.equal(app.includes("getElementById('playerSection')"), false, 'overlay must not target a missing element');
  assert.ok(app.includes("videoPlayerContainer || playerContainer"), 'overlay mounts inside the video frame');
  assert.ok(css.includes('.player-control-btn.hidden'), 'series-only button can actually be hidden');
});

test('series View Sources selects the first episode before querying sources', () => {
  assert.ok(app.includes('function getFirstEpisodeContext'));
  assert.ok(app.includes('function markSelectedEpisode'));
  assert.match(app, /const firstEpisode = getFirstEpisodeContext\(activeMedia\)/);
  assert.match(app, /loadStreams\(firstEpisode\.streamId, firstEpisode\.provider, firstEpisode\)/);
  assert.ok(app.includes("querySelector('.episode-row.episode-selected')"));
  assert.ok(app.includes('episode-row flex items-center'));
  assert.ok(app.includes('aria-pressed="false"'));
  assert.ok(css.includes('.episode-row.episode-selected'));
  assert.ok(app.includes('markSelectedEpisode(\n    activeStreamContext.season'), 'playback highlights the active episode row');
});

test('provider bundle has a validated update path', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['providers:update'], 'node scripts/update-vega-providers.js');
  assert.equal(pkg.scripts['providers:check'], 'node scripts/update-vega-providers.js --check');

  const updater = read('scripts', 'update-vega-providers.js');
  assert.ok(updater.includes('Zenda-Cross/vega-providers'));
  assert.ok(updater.includes('@vega-provider'));
  assert.ok(updater.includes('new vm.Script'), 'downloaded modules are syntax-checked');
  assert.ok(updater.includes('.vega-backup'), 'the previous bundle is retained for rollback');
  assert.ok(fs.existsSync(path.join(__dirname, 'vega-manifest.json')));
  assert.ok(fs.existsSync(path.join(__dirname, 'vega-urls.json')));
  assert.ok(fs.existsSync(path.join(__dirname, 'vega-dist')));
});

test('player seek feedback shows target time, skipped amount, and buffering hint', () => {
  assert.ok(html.includes('id="playerSeekFeedback"'));
  assert.ok(html.includes('id="playerSeekTooltip"'));
  assert.ok(html.includes('id="playerSeekDelta"'));
  assert.ok(app.includes('function seekPlayerTo'));
  assert.ok(app.includes('function showSeekFeedback'));
  assert.ok(app.includes('function positionSeekTooltip'));
  assert.ok(app.includes('Seeking to ${formatPlayerTime'), 'unbuffered seeks show a buffering message');
  assert.ok(app.includes("playerSeek?.addEventListener('pointermove'"));
  assert.ok(app.includes('playerSeekFeedbackRange'));
  assert.ok(css.includes('.player-seek-feedback.show'));
  assert.ok(css.includes('.player-seek-tooltip.show'));
  assert.ok(css.includes('.player-up-next'));
});

test('security: no inline handlers remain and CSP forbids inline scripts', () => {
  assert.equal(/on(?:error|click|load|submit|change|input)\s*=\s*"/i.test(html + app), false);
  assert.equal(/script-src[^;]*'unsafe-inline'/i.test(server), false);
  assert.ok(server.includes("res.setHeader('Content-Security-Policy', csp)"));
  assert.ok(app.includes('function safeImageUrl'));
  assert.ok(app.includes("image.src = POSTER_FALLBACK"));
  assert.equal(/\$\{posterUrl\}/.test(app), true, 'posters still render through escaped URL values');
  assert.equal(/onerror\s*=\s*"/.test(app), false);
  const hlsScript = html.match(/<script[^>]+src="\/vendor\/hls\.min\.js"[^>]*>/);
  assert.ok(hlsScript, 'hls.js is loaded from the local vendor directory');
  assert.match(html, /hls\.js 1\.7\.4/, 'hls.js version is pinned in the source comment');
  assert.match(hlsScript[0], /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(hlsScript[0], /crossorigin="anonymous"/);
  assert.ok(fs.statSync(path.join(__dirname, 'public', 'vendor', 'hls.min.js')).size > 500000);
  assert.ok(fs.existsSync(path.join(__dirname, 'public', 'vendor', 'hls.LICENSE')));
  assert.equal(/cdn\.jsdelivr/.test(html + server), false, 'playback has no CDN dependency');
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
