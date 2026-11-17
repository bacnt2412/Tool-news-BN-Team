const assert = require('node:assert/strict');
const utils = require('../utils/localYoutubeUploadUtils');

// In-memory stand-in for electron-store (supports dot-notation youtubeLocal.<id> + youtubeLocal root).
const data = new Map();
const store = {
  get: (k, d) => {
    if (data.has(k)) return data.get(k);
    if (k === 'youtubeLocal') {
      const out = {};
      for (const [key, val] of data.entries()) {
        if (key.startsWith('youtubeLocal.')) out[key.slice('youtubeLocal.'.length)] = val;
      }
      return out;
    }
    return d;
  },
  set: (k, v) => data.set(k, v),
};
utils.initialize({ store });

const ch = 'channel-1';
store.set(`youtubeLocal.${ch}`, `plain:${Buffer.from(JSON.stringify({ uploads: {}, autoUpload: { enabled: true } })).toString('base64')}`);
const MAX = utils.AUTO_SKIP_AFTER_FAILURES;
assert.equal(MAX, 3);

// Failures below the threshold are counted but not skipped.
for (let i = 1; i < MAX; i++) {
  const r = utils.recordAutoFailure(ch, 'v1', `boom ${i}`, 'Video 1');
  assert.deepEqual(r, { count: i, max: MAX, skipped: false });
  assert.equal(utils.autoSkippedVideoIds(ch).has('v1'), false);
}
// Reaching the threshold skips the video and keeps the last error for the UI.
assert.equal(utils.recordAutoFailure(ch, 'v1', 'final error', 'Video 1').skipped, true);
assert.equal(utils.autoSkippedVideoIds(ch).has('v1'), true);
assert.equal(utils.status(ch).autoFailures.v1.lastError, 'final error');
assert.equal(utils.status(ch).autoSkipAfter, MAX);

// Failures are tracked per video.
utils.recordAutoFailure(ch, 'v2', 'x');
assert.equal(utils.autoFailures(ch).v2.count, 1);
assert.equal(utils.autoSkippedVideoIds(ch).has('v2'), false);

// Reset (user retry / successful upload) clears only that video.
assert.deepEqual(utils.clearAutoFailure(ch, 'v1'), { success: true, cleared: true });
assert.equal(utils.autoSkippedVideoIds(ch).has('v1'), false);
assert.equal(utils.autoFailures(ch).v2.count, 1);
assert.deepEqual(utils.clearAutoFailure(ch, 'missing'), { success: true, cleared: false });

// Other channel data is preserved and failures are not part of the server sync payload.
assert.equal(utils.autoConfig(ch).enabled, true);
assert.equal('autoUploadFailures' in utils.getSyncPayload(ch), false);

// Entries older than the retention window are pruned on the next write.
const raw = JSON.parse(Buffer.from(store.get(`youtubeLocal.${ch}`).split(':')[1], 'base64').toString());
raw.autoUploadFailures.old = { count: 3, lastAt: new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString() };
store.set(`youtubeLocal.${ch}`, `plain:${Buffer.from(JSON.stringify(raw)).toString('base64')}`);
utils.recordAutoFailure(ch, 'v3', 'y');
assert.equal('old' in utils.autoFailures(ch), false);

// Unknown channel is a no-op.
assert.equal(utils.recordAutoFailure('nope', 'v1', 'e').skipped, false);

// Transient network/server/temp-cleanup errors are classified separately from broken videos.
assert.equal(typeof utils.classifyUploadError, 'function');
assert.equal(utils.classifyUploadError('aborted').kind, 'transient');
assert.equal(utils.classifyUploadError('Request failed with status code 500').kind, 'transient');
assert.equal(utils.classifyUploadError('[Tải video] HTTP 502 Bad Gateway').kind, 'transient');
assert.equal(utils.classifyUploadError('read ECONNRESET').kind, 'transient');
assert.equal(utils.classifyUploadError('connect ETIMEDOUT 1.2.3.4:443').kind, 'transient');
assert.equal(utils.classifyUploadError('Premature close').kind, 'transient');
assert.equal(utils.classifyUploadError("EPERM: operation not permitted, lstat '\\\\?\\C:\\Temp\\bn-youtube-upload-x\\a.mp4'").kind, 'transient');

// Channel/auth/quota errors do not blame the video either.
assert.equal(utils.classifyUploadError('Kênh chưa kết nối OAuth trên máy này.').kind, 'channel');
assert.equal(utils.classifyUploadError('[OAuth Google] invalid_grant').kind, 'channel');
assert.equal(utils.classifyUploadError('[Upload YouTube] The user has exceeded the number of videos they may upload. (uploadLimitExceeded)').kind, 'channel');
assert.equal(utils.classifyUploadError('The request cannot be completed because you have exceeded your quota. (quotaExceeded)').kind, 'channel');

// Permanent video-specific errors ARE classified as 'video'.
assert.equal(utils.classifyUploadError('Video hoàn thành không có URL tải hợp lệ.').kind, 'video');
assert.equal(utils.classifyUploadError('[Tải video] Request failed with status code 404').kind, 'video');
assert.equal(utils.classifyUploadError('Thời gian hẹn đăng YouTube phải lớn hơn thời gian hiện tại.').kind, 'video');

// Self-healing: videos previously marked 3/3 skipped due to transient 500 / aborted / EPERM
// errors in 1.2.9 are automatically pruned and NOT skipped anymore.
{
  const chHeal = 'channel-heal';
  const stored = {
    uploads: {},
    autoUpload: { enabled: true },
    autoUploadFailures: {
      transientAborted: { count: 3, lastError: 'aborted', lastAt: new Date().toISOString(), title: 'A' },
      transient500: { count: 3, lastError: 'Request failed with status code 500', lastAt: new Date().toISOString(), title: 'B' },
      transientEperm: { count: 3, lastError: "EPERM: operation not permitted, lstat 'C:\\Temp\\x.mp4'", lastAt: new Date().toISOString(), title: 'C' },
      broken404: { count: 3, lastError: 'Request failed with status code 404', lastAt: new Date().toISOString(), title: 'D' },
    },
  };
  store.set(`youtubeLocal.${chHeal}`, `plain:${Buffer.from(JSON.stringify(stored)).toString('base64')}`);
  const skipped = utils.autoSkippedVideoIds(chHeal);
  assert.equal(skipped.has('transientAborted'), false, 'aborted false-skip must self-heal');
  assert.equal(skipped.has('transient500'), false, 'HTTP 500 false-skip must self-heal');
  assert.equal(skipped.has('transientEperm'), false, 'EPERM false-skip must self-heal');
  assert.equal(skipped.has('broken404'), true, 'genuine 404 video failure remains skipped');
}

// Bulk reset clears all remaining failure records across one or all channels.
{
  const resetRes = utils.clearAllAutoFailures();
  assert.equal(resetRes.success, true);
  assert.ok(resetRes.clearedVideos >= 1);
  assert.equal(utils.autoSkippedVideoIds('channel-heal').size, 0);
}

console.log('Passed auto-upload failure tracking regressions');

