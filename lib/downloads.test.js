const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

const HOST = lanAddress();
if (HOST) {
  process.env.ALLOW_PRIVATE_NETWORKS = 'true';
  process.env.DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesphere-downloads-test-'));
} else {
  process.env.DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesphere-downloads-test-'));
}

const downloadsModule = require('./downloads');

test('uses writable temporary storage on Vercel by default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinesphere-vercel-test-'));
  const env = { ...process.env, VERCEL: '1', TMPDIR: tmpDir };
  delete env.DOWNLOAD_DIR;
  try {
    const result = spawnSync(process.execPath, [
      '-e',
      "process.stdout.write(require('./lib/downloads').DOWNLOAD_DIR)",
    ], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, path.join(tmpDir, 'downloads'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

after(() => {
  sampleClosed = true;
  fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true });
});

const SAMPLE = Buffer.alloc(1.5 * 1024 * 1024);
for (let i = 0; i < SAMPLE.length; i++) SAMPLE[i] = i % 251;

let server;
let serverUrl;
let sampleClosed = false;

function createSampleServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/truncated.mp4')) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': SAMPLE.length,
      });
      res.end(SAMPLE.subarray(0, 256 * 1024));
      return;
    }
    if (!req.url.startsWith('/sample.mp4')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    const range = /^bytes=(\d+)-/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    if (!Number.isFinite(start) || start >= SAMPLE.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${SAMPLE.length}` });
      res.end();
      return;
    }

    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': SAMPLE.length - start,
      ...(range ? { 'Content-Range': `bytes ${start}-${SAMPLE.length - 1}/${SAMPLE.length}` } : {}),
    });

    let offset = start;
    let requestClosed = false;
    const sendChunk = () => {
      if (sampleClosed || requestClosed) return;
      if (offset >= SAMPLE.length) {
        res.end();
        return;
      }
      const next = Math.min(offset + 16 * 1024, SAMPLE.length);
      res.write(SAMPLE.subarray(offset, next));
      offset = next;
      setTimeout(sendChunk, 15);
    };
    sendChunk();
    req.on('close', () => { requestClosed = true; });
  });
}

async function startServer() {
  sampleClosed = false;
  server = createSampleServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  serverUrl = `http://${HOST}:${server.address().port}/sample.mp4`;
}

async function waitFor(fn, timeout = 15000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function removeAll() {
  for (const item of downloadsModule.getAllDownloads()) {
    await downloadsModule.removeDownload(item.id);
  }
  await downloadsModule.flushDownloads();
}

async function closeServer() {
  sampleClosed = true;
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

test('downloaded files are written to disk and served back byte-for-byte', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(async () => {
    await closeServer();
    await removeAll();
  });

  const [created] = downloadsModule.enqueueDownloads([{
    title: 'Integration Sample',
    type: 'movie',
    provider: 'test',
    url: serverUrl,
    filename: 'sample.mp4',
    quality: '1080p',
  }]);
  assert.ok(created.id);

  const completed = await waitFor(() => {
    const item = downloadsModule.getDownload(created.id);
    return item?.status === 'completed' ? item : null;
  }, 20000, 'download completion');

  assert.equal(completed.progress, 100);
  assert.equal(completed.downloadedBytes, SAMPLE.length);
  assert.equal(completed.totalBytes, SAMPLE.length);
  assert.match(completed.fileUrl, new RegExp(`/api/downloads/${created.id}/file$`));

  const file = downloadsModule.getDownloadFile(created.id);
  assert.ok(file, 'completed file is available');
  assert.equal(file.size, SAMPLE.length);
  assert.equal(file.filename, 'sample.mp4');
  assert.ok(fs.readFileSync(file.path).equals(SAMPLE), 'downloaded bytes match the upstream file');

  const filePath = file.path;
  assert.equal(await downloadsModule.removeDownload(created.id), true);
  assert.equal(downloadsModule.getDownload(created.id), undefined);
  assert.equal(fs.existsSync(filePath), false, 'removing a download deletes its file');
});

test('short upstream bodies are failed instead of being treated as complete', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(async () => {
    await closeServer();
    await removeAll();
  });

  const [created] = downloadsModule.enqueueDownloads([{
    title: 'Truncated Sample',
    type: 'movie',
    provider: 'test',
    url: serverUrl.replace('/sample.mp4', '/truncated.mp4'),
    filename: 'truncated.mp4',
  }]);

  const failed = await waitFor(() => {
    const item = downloadsModule.getDownload(created.id);
    return item?.status === 'failed' ? item : null;
  }, 10000, 'truncated download failure');
  assert.match(failed.error, /ended early/i);
  assert.equal(downloadsModule.getDownloadFile(created.id), null);
});

test('pause stops the transfer and resume continues with a Range request', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(async () => {
    await closeServer();
    await removeAll();
  });

  const [created] = downloadsModule.enqueueDownloads([{
    title: 'Pause Resume Sample',
    type: 'movie',
    provider: 'test',
    url: serverUrl,
    filename: 'resume.mp4',
    quality: '720p',
  }]);

  await waitFor(() => {
    const item = downloadsModule.getDownload(created.id);
    return item?.status === 'downloading' && item.downloadedBytes > 64 * 1024 ? item : null;
  }, 10000, 'download to start');

  assert.equal(downloadsModule.pauseDownload(created.id), true);
  const paused = await waitFor(() => {
    const item = downloadsModule.getDownload(created.id);
    return item?.status === 'paused' ? item : null;
  }, 5000, 'paused state');
  assert.ok(paused.downloadedBytes > 0);
  assert.equal(paused.speed, 0);

  const partFile = fs.readdirSync(process.env.DOWNLOAD_DIR).find((name) => name.endsWith('.part'));
  assert.ok(partFile, 'resume data is kept in a .part file');
  const partialSize = fs.statSync(path.join(process.env.DOWNLOAD_DIR, partFile)).size;
  assert.ok(partialSize > 0);

  assert.equal(downloadsModule.resumeDownload(created.id), true);
  const completed = await waitFor(() => {
    const item = downloadsModule.getDownload(created.id);
    return item?.status === 'completed' ? item : null;
  }, 20000, 'resumed completion');

  assert.equal(completed.downloadedBytes, SAMPLE.length);
  const file = downloadsModule.getDownloadFile(created.id);
  assert.ok(file);
  assert.ok(fs.readFileSync(file.path).equals(SAMPLE), 'resumed file matches the upstream file');
});

test('duplicate ids refresh metadata without replacing an existing record', { skip: !HOST }, async (t) => {
  await startServer();
  t.after(async () => {
    await closeServer();
    await removeAll();
  });

  const payload = {
    id: 'fixed-test-id',
    title: 'Original Title',
    type: 'movie',
    provider: 'test',
    url: serverUrl,
    filename: 'fixed.mp4',
  };
  downloadsModule.enqueueDownloads([payload]);
  downloadsModule.pauseDownload('fixed-test-id');
  await waitFor(() => downloadsModule.getDownload('fixed-test-id')?.status === 'paused');

  const [updated] = downloadsModule.enqueueDownloads([{ ...payload, title: 'Updated Title', quality: '4K' }]);
  assert.equal(updated.id, 'fixed-test-id');
  assert.equal(updated.title, 'Updated Title');
  assert.equal(updated.quality, '4K');
  assert.equal(updated.status, 'paused');
  assert.equal(downloadsModule.getAllDownloads().filter((item) => item.id === 'fixed-test-id').length, 1);
});
