const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTitleForMatch, isTitleMatchForSeriesQuery, rankEpisodeCandidates } = require('./providers');

test('title matching accepts either direction for series names', () => {
  assert.equal(isTitleMatchForSeriesQuery('The Office US', 'The Office'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Office', 'The Office US'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Office', 'The Office'), true);
  assert.equal(isTitleMatchForSeriesQuery('The Wire', 'The Office'), false);
});

test('episode candidate ranking keeps a longer matching title and rejects unrelated titles', () => {
  const matching = [
    { provider: 'movieBoxWeb', subjectId: 'series:office-us', title: 'The Office US', type: 'series' },
  ];
  assert.deepEqual(rankEpisodeCandidates(matching, 'The Office'), matching);
  assert.deepEqual(rankEpisodeCandidates([
    { provider: 'movieBoxWeb', subjectId: 'series:wire', title: 'The Wire', type: 'series' },
  ], 'The Office'), []);
  assert.deepEqual(rankEpisodeCandidates([
    { provider: 'movieBoxWeb', subjectId: 'movie:office', title: 'The Office Movie', type: 'movie' },
  ], 'The Office'), []);
});

const _normalized = normalizeTitleForMatch('The Office US');
assert.equal(_normalized.includes('theoffice'), true);
