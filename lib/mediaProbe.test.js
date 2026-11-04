const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

const HOST = lanAddress();
if (HOST) process.env.ALLOW_PRIVATE_NETWORKS = 'true';
const { probePlayableSource } = require('./mediaProbe');

let server;
let base;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, base || 'http://localhost');
      if (url.pathname === '/video.mp4') {
        const body = Buffer.from('0000001866747970', 'hex');
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) });
        res.end(body);
        return;
      }
      if (url.pathname === '/page.mp4') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>login required</body></html>');
        return;
      }
      if (url.pathname === '/master.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmedia.m3u8\n');
        return;
      }
      if (url.pathname === '/media.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n');
        return;
      }
      if (url.pathname === '/extensionless') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n');
        return;
      }
      if (url.pathname === '/seg.ts') {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        res.end(Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]));
        return;
      }
      if (url.pathname === '/seg.jpg') {
        // Some HLS providers label MPEG-TS segments as JPEG. The sync byte is
        // the real signal that this is playable media.
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]));
        return;
      }
      if (url.pathname === '/spoof.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4,\nseg.jpg\n#EXT-X-ENDLIST\n');
        return;
      }
      if (url.pathname === '/bad.m3u8') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n#EXTINF:4,\npage.mp4\n#EXT-X-ENDLIST\n');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
    server.listen(0, '0.0.0.0', () => {
      base = `http://${HOST}:${server.address().port}`;
      resolve();
    });
  });
}

test('media probe accepts direct media and detects extensionless HLS', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const direct = await probePlayableSource({ url: `${base}/video.mp4` });
  assert.equal(direct.type, 'direct');

  const hls = await probePlayableSource({ url: `${base}/master.m3u8` });
  assert.equal(hls.type, 'hls');

  const extensionless = await probePlayableSource({ url: `${base}/extensionless` });
  assert.equal(extensionless.type, 'hls');

  const disguised = await probePlayableSource({ url: `${base}/spoof.m3u8` });
  assert.equal(disguised.type, 'hls');
});

test('media probe rejects HTTP 200 login pages and HLS playlists pointing at them', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(() => probePlayableSource({ url: `${base}/page.mp4` }), /web page|not media/i);
  await assert.rejects(() => probePlayableSource({ url: `${base}/bad.m3u8` }), /non-media/i);
});
