const test = require('node:test');
const assert = require('node:assert/strict');
const { VegaAdapter } = require('./vegaAdapter');

test('anime Vega search results are classified as series', async () => {
  const adapter = new VegaAdapter({ value: 'anikoto', type: 'anime' });
  adapter._postsMod = {
    getSearchPosts: async () => [{ title: 'One Piece', link: 'https://anikototv.to/watch/one-piece/ep-1' }],
  };

  const [item] = await adapter.search('One Piece');

  assert.equal(item.type, 'series');
});

test('Anikoto details use a longer request budget and retain episode links', async () => {
  const adapter = new VegaAdapter({ value: 'anikoto', type: 'anime' });
  adapter._metaMod = {
    getMeta: async ({ providerContext }) => {
      assert.equal(providerContext.axios.defaults.timeout, 8000);
      return {
        title: 'One Piece',
        type: 'series',
        linkList: [{
          title: 'One Piece',
          directLinks: [{ title: 'Episode 3', link: '{"slug":"one-piece","epNum":"3"}' }],
        }],
      };
    },
  };

  const details = await adapter.details('https://anikototv.to/watch/one-piece/ep-1');

  assert.equal(details.type, 'series');
  assert.equal(details.seasons.length, 1);
  assert.equal(details.seasons[0].episodes[0].episodeNumber, 3);
  assert.equal(details.seasons[0].episodes[0].streamId, '{"slug":"one-piece","epNum":"3"}');
});
