const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeUrl, isBlockedAddress } = require('./netGuard');

test('allows public HTTPS hosts', async () => {
  const url = await assertSafeUrl('https://example.com');
  assert.equal(url.hostname, 'example.com');
});

test('blocks loopback and private network destinations', async () => {
  await assert.rejects(() => assertSafeUrl('https://127.0.0.1'), /Destination address is not allowed|Host could not be resolved|Invalid URL/);
  await assert.rejects(() => assertSafeUrl('https://localhost'), /Destination address is not allowed|Host could not be resolved|Malformed destination hostname/);
  await assert.rejects(() => assertSafeUrl('https://172.16.0.1'), /Destination address is not allowed|Host could not be resolved|Malformed destination hostname/);
  assert.equal(isBlockedAddress('127.0.0.1'), true);
});

test('rejects credentials and non-http protocols', async () => {
  await assert.rejects(() => assertSafeUrl('ftp://example.com'), /Only http\/https URLs are allowed/);
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com'), /Credentials in URL are not allowed/);
});
