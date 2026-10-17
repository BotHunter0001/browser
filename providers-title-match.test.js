const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTitleForMatch, isTitleMatchForSeriesQuery, getEpisodeStreams } = require('./providers');

test('title matching accepts either direction for series names', () => {
  assert.equal(isTitleMatchForSeriesQuery('The Office US', 'The Office'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Office', 'The Office US'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Office', 'The Office'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Wire', 'The Office'), false);
});

test('getEpisodeStreams resolves a matching series even when the candidate title is longer', async () => {
  const result = await getEpisodeStreams('The Office', 1, 1, [
    { provider: 'movieBoxWeb', subjectId: 'series:office-us', title: 'The Office US', type: 'series' },
  ]);

  assert.equal(result.provider, null);
  assert.deepEqual(result.releases, []);
});

const _normalized = normalizeTitleForMatch('The Office US');
assert.equal(_normalized.includes('theoffice'), true);
