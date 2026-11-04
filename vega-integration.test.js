const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('index.html contains Vega Hero Carousel and Continue Watching sections', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

  assert.ok(html.includes('id="continueWatchingSection"'), 'Continue watching section exists');
  assert.ok(html.includes('id="continueWatchingStrip"'), 'Continue watching horizontal strip exists');
  assert.ok(html.includes('id="cwClearBtn"'), 'Continue watching clear button exists');

  assert.ok(html.includes('id="heroCarouselSection"'), 'Hero carousel section exists');
  assert.ok(html.includes('id="heroCarousel"'), 'Hero carousel container exists');
  assert.ok(html.includes('id="heroSlides"'), 'Hero slides container exists');
  assert.ok(html.includes('id="heroTitle"'), 'Hero title element exists');
  assert.ok(html.includes('id="heroPlayBtn"'), 'Hero play button exists');
  assert.ok(html.includes('id="heroInfoBtn"'), 'Hero info button exists');
  assert.ok(html.includes('id="heroDots"'), 'Hero dots container exists');
  assert.ok(html.includes('id="heroPrev"'), 'Hero prev arrow exists');
  assert.ok(html.includes('id="heroNext"'), 'Hero next arrow exists');
});

test('style.css defines Vega-style Hero Carousel and Continue Watching rules', () => {
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');

  assert.ok(css.includes('#heroCarousel'), 'CSS contains #heroCarousel height definitions');
  assert.ok(css.includes('.hero-slide'), 'CSS contains .hero-slide transition rules');
  assert.ok(css.includes('#continueWatchingStrip'), 'CSS contains scrollbar styles for continueWatchingStrip');
  assert.ok(css.includes('.cw-card'), 'CSS contains hover styles for .cw-card');
});

test('app.js defines Continue Watching and Hero Carousel logic and auto-next threshold', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');

  // Continue Watching logic
  assert.ok(js.includes('CONTINUE_WATCHING_THRESHOLD_MIN = 0.05'), 'Minimum watch progress threshold defined');
  assert.ok(js.includes('CONTINUE_WATCHING_THRESHOLD_MAX = 0.92'), 'Maximum watch progress threshold defined');
  assert.ok(js.includes('function getContinueWatchingItems'), 'getContinueWatchingItems function exists');
  assert.ok(js.includes('function renderContinueWatchingStrip'), 'renderContinueWatchingStrip function exists');

  // Auto-next logic
  assert.ok(js.includes('WATCHED_FRACTION = 0.85'), 'Watched fraction 85% threshold defined');
  assert.ok(js.includes('triggerAutoNextCountdown'), 'triggerAutoNextCountdown function exists');
  assert.ok(js.includes('cancelAutoNext'), 'cancelAutoNext function exists');
  assert.ok(js.includes('playNextEpisode'), 'playNextEpisode function exists');

  // Hero carousel logic
  assert.ok(js.includes('HERO_COUNT = 4'), 'Hero item count set to 4');
  assert.ok(js.includes('HERO_INTERVAL = 8000'), 'Hero rotation interval set to 8000ms');
  assert.ok(js.includes('function populateHeroCarousel'), 'populateHeroCarousel function exists');
  assert.ok(js.includes('function heroGoTo'), 'heroGoTo function exists');
  assert.ok(js.includes('function heroStartTimer'), 'heroStartTimer function exists');
});
