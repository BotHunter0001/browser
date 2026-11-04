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
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:7f00:1'), true, 'hex IPv4-mapped loopback is blocked');
  assert.equal(isBlockedAddress('::ffff:a00:1'), true, 'hex IPv4-mapped private address is blocked');
  assert.equal(isBlockedAddress('::ffff:808:808'), false, 'hex IPv4-mapped public address is allowed');
  assert.equal(isBlockedAddress('64:ff9b:1::a00:1'), true, 'local-use NAT64 is blocked');
  assert.equal(isBlockedAddress('fe80::1'), true);
  assert.equal(isBlockedAddress('ff02::1'), true);
  assert.equal(isBlockedAddress('192.0.2.10'), true);
  assert.equal(isBlockedAddress('198.51.100.10'), true);
  assert.equal(isBlockedAddress('203.0.113.10'), true);
  assert.equal(isBlockedAddress('64:ff9b::a280:e484'), false, 'public NAT64 address is allowed');
  assert.equal(isBlockedAddress('64:ff9b::10.0.0.1'), true, 'NAT64 address embedding a private IPv4 is blocked');
  assert.equal(isBlockedAddress('2002:a280:e484::'), false, 'public 6to4 address is allowed');
  assert.equal(isBlockedAddress('2002:0a00:0001::'), true, '6to4 address embedding a private IPv4 is blocked');
});

test('rejects credentials and non-http protocols', async () => {
  await assert.rejects(() => assertSafeUrl('ftp://example.com'), /Only http\/https URLs are allowed/);
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com'), /Credentials in URL are not allowed/);
});
