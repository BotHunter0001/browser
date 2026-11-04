const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}

test('HTTP contract: security headers, honest routes, and download validation', { timeout: 30000 }, async (t) => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesphere-contract-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ALLOW_PRIVATE_NETWORKS: 'false',
      DOWNLOAD_DIR: downloadDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
    fs.rmSync(downloadDir, { recursive: true, force: true });
  });

  try {
    await waitForServer(base);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.doesNotMatch(health.headers.get('content-security-policy') || '', /script-src[^;]*'unsafe-inline'/);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.match(health.headers.get('cache-control') || '', /no-store/);

    const unknown = await fetch(`${base}/api/does-not-exist`);
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get('content-type') || '', /application\/json/);

    const session = await (await fetch(`${base}/api/session`)).json();
    assert.equal(session.gatewayStatus, 'unsupported');
    assert.equal(session.currentHost, null);

    const rotate = await fetch(`${base}/api/hosts/rotate`, { method: 'POST' });
    assert.equal(rotate.status, 501);

    const manifest = await (await fetch(`${base}/manifest.json`)).json();
    assert.deepEqual(manifest.resources, ['catalog']);

    const favicon = await fetch(`${base}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type') || '', /image\/svg\+xml/);

    const crossSite = await fetch(`${base}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ url: 'https://example.com/video.mp4' }),
    });
    assert.equal(crossSite.status, 403);

    const fetchSite = await fetch(`${base}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ url: 'https://example.com/video.mp4' }),
    });
    assert.equal(fetchSite.status, 403);

    for (const url of ['ftp://example.com/video.mp4', 'http://127.0.0.1/video.mp4', 'http://[::1]/video.mp4']) {
      const res = await fetch(`${base}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      assert.equal(res.status, 400, `${url} must be rejected`);
      const body = await res.json();
      assert.match(body.error, /not allowed|Only http/i);
    }

    for (const target of ['http://127.0.0.1:1/secret', 'http://169.254.169.254/latest/meta-data/']) {
      const details = await fetch(`${base}/api/details/${encodeURIComponent(target)}?provider=addon`);
      assert.equal(details.status, 400, `details must reject ${target}`);
      const streams = await fetch(`${base}/api/streams/${encodeURIComponent(target)}?provider=addon`);
      assert.equal(streams.status, 400, `streams must reject ${target}`);
    }

    const catalogFilter = await fetch(`${base}/api/catalog?filter=${encodeURIComponent('http://127.0.0.1:1/')}`);
    assert.equal(catalogFilter.status, 400);

    const stremio = await fetch(`${base}/catalog/movie/not-advertised.json`);
    assert.equal(stremio.status, 404);

    const missingFile = await fetch(`${base}/api/downloads/missing/file`);
    assert.equal(missingFile.status, 404);

    const missingDelete = await fetch(`${base}/api/downloads/missing`, { method: 'DELETE' });
    assert.equal(missingDelete.status, 404, 'deleting an unknown id must not return success');

    const badAsset = await fetch(`${base}/missing.js`, { headers: { Accept: 'text/html' } });
    assert.equal(badAsset.status, 404);
    assert.doesNotMatch(badAsset.headers.get('content-type') || '', /text\/html/);

    const spa = await fetch(`${base}/library/watchlist`, { headers: { Accept: 'text/html' } });
    assert.equal(spa.status, 200);
    assert.match(spa.headers.get('content-type') || '', /text\/html/);

    const list = await (await fetch(`${base}/api/downloads`)).json();
    assert.deepEqual(list.downloads, []);
  } catch (err) {
    if (logs) console.error(logs.slice(-4000));
    throw err;
  }
});
