const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const utils = require('../utils/localYoutubeUploadUtils');

const storeData = new Map();
const store = {
  get: (k, d) => (storeData.has(k) ? storeData.get(k) : d),
  set: (k, v) => storeData.set(k, v),
};
utils.initialize({ store });

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-resilience-test-'));
  // Make test retries fast while exercising exact production retry/fallback paths.
  const fastOpts = { retryBaseDelayMs: 20, maxGlobalStreams: 4 };

  try {
    // Prepare a deterministic 3.2 MB payload (> 2 MB threshold so parallel Range is triggered).
    const payload = crypto.randomBytes(3.2 * 1024 * 1024);
    const expectedHash = sha256(payload);

    // 1. Global download stream semaphore caps total concurrent Range connections across workers.
    {
      let activeGetStreams = 0;
      let peakGetStreams = 0;

      const server = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': payload.length,
            'Accept-Ranges': 'bytes',
          });
          res.end();
          return;
        }
        activeGetStreams += 1;
        if (activeGetStreams > peakGetStreams) peakGetStreams = activeGetStreams;
        const done = () => { activeGetStreams = Math.max(0, activeGetStreams - 1); };
        res.on('close', done);

        const range = req.headers.range;
        let slice = payload;
        let statusCode = 200;
        const headers = {};
        if (range) {
          const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range);
          const start = Number(s);
          const end = Math.min(Number(e), payload.length - 1);
          slice = payload.subarray(start, end + 1);
          statusCode = 206;
          headers['Content-Range'] = `bytes ${start}-${end}/${payload.length}`;
        }
        headers['Content-Length'] = slice.length;
        res.writeHead(statusCode, headers);

        // Trickle in two halves with a brief pause so concurrent workers overlap predictably.
        const mid = Math.floor(slice.length / 2);
        res.write(slice.subarray(0, mid));
        setTimeout(() => {
          res.end(slice.subarray(mid));
        }, 25);
      });

      const baseUrl = await listen(server);
      try {
        const destinations = Array.from({ length: 5 }, (_, idx) => path.join(tmpRoot, `cap-${idx}.mp4`));
        await Promise.all(
          destinations.map(dest => utils.downloadFile(`${baseUrl}/video.mp4`, dest, () => {}, null, 3, fastOpts))
        );
        assert.ok(
          peakGetStreams <= fastOpts.maxGlobalStreams,
          `expected peak concurrent streams <= ${fastOpts.maxGlobalStreams}, got ${peakGetStreams}`
        );
        for (const dest of destinations) {
          assert.equal(fs.existsSync(dest + '.incomplete'), false);
          assert.equal(sha256(fs.readFileSync(dest)), expectedHash);
        }
      } finally {
        await closeServer(server);
      }
    }

    // 2. Parallel Range failing with HTTP 500 cleanly aborts sibling chunks and falls back to single-stream.
    {
      let rangeHits = 0;
      let fullGetHits = 0;
      const server = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': payload.length, 'Accept-Ranges': 'bytes' });
          res.end();
          return;
        }
        if (req.headers.range) {
          rangeHits += 1;
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
          return;
        }
        fullGetHits += 1;
        res.writeHead(200, { 'Content-Length': payload.length });
        res.end(payload);
      });

      const baseUrl = await listen(server);
      try {
        const dest = path.join(tmpRoot, 'fallback-single.mp4');
        await utils.downloadFile(`${baseUrl}/video.mp4`, dest, () => {}, null, 3, fastOpts);
        assert.ok(rangeHits >= 1, 'should have tried Range first');
        assert.equal(fullGetHits, 1, 'should have recovered via single-stream GET');
        assert.equal(fs.existsSync(dest + '.incomplete'), false);
        assert.equal(sha256(fs.readFileSync(dest)), expectedHash);
      } finally {
        await closeServer(server);
      }
    }

    // 3. Premature socket close ("aborted") mid-stream retries and succeeds with intact file.
    {
      let attempts = 0;
      const server = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': payload.length }); // no Accept-Ranges
          res.end();
          return;
        }
        attempts += 1;
        res.writeHead(200, { 'Content-Length': payload.length });
        if (attempts === 1) {
          res.write(payload.subarray(0, 256 * 1024));
          setTimeout(() => req.socket.destroy(), 10);
          return;
        }
        res.end(payload);
      });

      const baseUrl = await listen(server);
      try {
        const dest = path.join(tmpRoot, 'aborted-retry.mp4');
        await utils.downloadFile(`${baseUrl}/video.mp4`, dest, () => {}, null, 3, fastOpts);
        assert.equal(attempts, 2, 'should retry after premature stream close');
        assert.equal(fs.existsSync(dest + '.incomplete'), false);
        assert.equal(sha256(fs.readFileSync(dest)), expectedHash);
      } finally {
        await closeServer(server);
      }
    }

    // 4. Permanent HTTP 404 fails immediately without retries and is classified as a video error.
    {
      let getCount = 0;
      const server = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(404);
          res.end();
          return;
        }
        getCount += 1;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'File video không tồn tại' }));
      });

      const baseUrl = await listen(server);
      try {
        const dest = path.join(tmpRoot, 'missing-404.mp4');
        await assert.rejects(
          () => utils.downloadFile(`${baseUrl}/missing.mp4`, dest, () => {}, null, 3, fastOpts),
          err => {
            assert.equal(utils.classifyUploadError(err).kind, 'video');
            assert.match(err.message, /404/);
            return true;
          }
        );
        assert.equal(getCount, 1, 'permanent 404 must not waste retry attempts');
      } finally {
        await closeServer(server);
      }
    }

    // 5. Resumable YouTube upload retries a failed 500/aborted chunk using session offset query.
    {
      const videoFile = path.join(tmpRoot, 'yt-source.mp4');
      fs.writeFileSync(videoFile, payload);
      let putDataCalls = 0;
      let rangeQueryCalls = 0;
      const receivedBuf = Buffer.alloc(payload.length);

      const server = http.createServer((req, res) => {
        const contentRange = String(req.headers['content-range'] || '');
        if (/^bytes \*\/\d+$/.test(contentRange)) {
          rangeQueryCalls += 1;
          // Report nothing committed yet on first query so chunk 0 is re-sent cleanly.
          res.writeHead(308);
          res.end();
          return;
        }
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
        assert.ok(m, `unexpected content-range: ${contentRange}`);
        const start = Number(m[1]);
        const end = Number(m[2]);
        const total = Number(m[3]);
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          putDataCalls += 1;
          if (putDataCalls === 1) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Backend Error' } }));
            return;
          }
          const body = Buffer.concat(chunks);
          body.copy(receivedBuf, start);
          if (end + 1 >= total) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'yt_ok_123' }));
          } else {
            res.writeHead(308, { Range: `bytes=0-${end}` });
            res.end();
          }
        });
      });

      const baseUrl = await listen(server);
      try {
        const uploaded = await utils.uploadResumableChunks({
          sessionUrl: `${baseUrl}/upload-session`,
          filePath: videoFile,
          size: payload.length,
          chunkSize: 2 * 1024 * 1024, // 2 chunks for 3.2 MB
          getAccessToken: async () => 'fake-token',
          httpsAgent: undefined,
          signal: null,
          onProgress: () => {},
          retryBaseDelayMs: 20,
        });
        assert.equal(uploaded?.id, 'yt_ok_123');
        assert.equal(putDataCalls, 3, '1 failed chunk + 2 successful chunks');
        assert.ok(rangeQueryCalls >= 1, 'queried resumable session offset after 500');
        assert.equal(sha256(receivedBuf), expectedHash);
      } finally {
        await closeServer(server);
      }
    }

    console.log('Passed upload resilience & concurrency cap regressions');
  } finally {
    await utils.removeTempDir(tmpRoot);
  }
})();

