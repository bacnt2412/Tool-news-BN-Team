const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removeTempDir } = require('../utils/localYoutubeUploadUtils');

// Windows: a file deleted while another process (antivirus scan, unclosed stream)
// still holds a handle stays "delete pending"; fs.rmSync on its folder then throws
// EPERM lstat (Node 18 / Electron 28). Temp cleanup must never throw, because a
// throw from upload()'s finally block replaced a successful upload result.
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-youtube-upload-test-'));
  const file = path.join(dir, '16年間、夫の会社で「お手伝いさん」——-229dd143.mp4');
  fs.writeFileSync(file, Buffer.alloc(64 * 1024));
  const fd = fs.openSync(file, 'r');
  fs.unlinkSync(file);
  setTimeout(() => fs.closeSync(fd), 400); // handle released while cleanup is retrying

  await assert.doesNotReject(() => removeTempDir(dir));
  assert.equal(fs.existsSync(dir), false, 'temp dir should be removed once the handle is released');

  // Missing / empty paths are no-ops.
  await assert.doesNotReject(() => removeTempDir(path.join(os.tmpdir(), 'does-not-exist-bn')));
  await assert.doesNotReject(() => removeTempDir(''));
  console.log(`Passed temp cleanup regressions (node ${process.versions.node})`);
})().catch(err => { console.error(err); process.exit(1); });

