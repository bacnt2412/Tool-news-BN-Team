const assert = require('node:assert/strict');
const utils = require('../utils/localYoutubeUploadUtils');

// In-memory stand-in for electron-store (safeStorage absent -> plain encoding).
const data = new Map();
const store = { get: (k, d) => (data.has(k) ? data.get(k) : d), set: (k, v) => data.set(k, v) };
utils.initialize({ store });
const enc = v => `plain:${Buffer.from(JSON.stringify(v)).toString('base64')}`;
const seed = (id, v) => store.set(`youtubeLocal.${id}`, enc(v));

const staleServer = {
  autoUpload: { enabled: false, privacyStatus: 'private', restMinutes: 30, maxPerDay: 5, scheduledTimes: ['05:30'] },
  proxy: { enabled: false, type: 'http', host: '1.2.3.4', port: '8080', user: '', pass: '' },
  uploads: { v1: { videoId: 'v1', youtubeVideoId: 'Y1' } },
};

// Bug: after an upload the channel list reloads and syncFromServer() let the
// (stale) server config overwrite the user's newer local settings.
{
  seed('ch1', { uploads: {} });
  utils.saveAutoConfig('ch1', { enabled: true, privacyStatus: 'schedule', restMinutes: 30, maxPerDay: 5, scheduledTimes: ['05:30'] });
  utils.saveProxyConfig('ch1', { enabled: true, type: 'http', host: '9.9.9.9', port: '3128', user: '', pass: '' });
  const result = utils.syncFromServer('ch1', staleServer);
  assert.equal(utils.autoConfig('ch1').enabled, true, 'stale server must not disable auto-upload');
  assert.equal(utils.getProxyConfig('ch1').enabled, true, 'stale server must not disable proxy');
  assert.equal(utils.getProxyConfig('ch1').host, '9.9.9.9');
  // Local is newer -> caller must push it to the server.
  assert.deepEqual(result.push, ['autoUpload', 'proxy']);
  // Uploads still merge from the server.
  assert.ok(utils.status('ch1').uploads.v1);
}

// A newer server config (changed on another machine) is still adopted.
{
  seed('ch2', { uploads: {} });
  utils.saveAutoConfig('ch2', { enabled: false, scheduledTimes: [] });
  const localStamp = utils.autoConfig('ch2').updatedAt;
  assert.ok(localStamp, 'saveAutoConfig must stamp updatedAt');
  const newer = new Date(Date.parse(localStamp) + 60000).toISOString();
  const result = utils.syncFromServer('ch2', { autoUpload: { enabled: true, scheduledTimes: ['08:00'], updatedAt: newer } });
  assert.equal(utils.autoConfig('ch2').enabled, true);
  assert.deepEqual(utils.autoConfig('ch2').scheduledTimes, ['08:00']);
  assert.deepEqual(result.push, []);
}

// Identical content (server may drop updatedAt) -> nothing overwritten, nothing pushed.
{
  seed('ch3', { uploads: {} });
  utils.saveAutoConfig('ch3', { ...staleServer.autoUpload, enabled: true });
  const { updatedAt, ...same } = utils.autoConfig('ch3');
  const result = utils.syncFromServer('ch3', { autoUpload: same });
  assert.equal(utils.autoConfig('ch3').updatedAt, updatedAt);
  assert.deepEqual(result.push, []);
}

// Legacy local data (no updatedAt) with active settings MUST NOT be silently
// disabled by an unstamped stale server record ({ enabled: false }). Instead,
// local wins, gets stamped with updatedAt, and asks the caller to push.
{
  seed('ch4', { autoUpload: { enabled: true, scheduledTimes: ['07:00'] }, proxy: { enabled: true, host: 'x', port: '1' } });
  const result = utils.syncFromServer('ch4', staleServer);
  assert.equal(utils.autoConfig('ch4').enabled, true, 'unstamped server must not disable legacy active autoUpload');
  assert.ok(utils.autoConfig('ch4').updatedAt, 'legacy active autoUpload should be stamped for future syncs');
  assert.equal(utils.getProxyConfig('ch4').enabled, true, 'unstamped server must not disable legacy active proxy');
  assert.equal(utils.getProxyConfig('ch4').host, 'x');
  assert.ok(utils.getProxyConfig('ch4').updatedAt, 'legacy active proxy should be stamped for future syncs');
  assert.deepEqual(result.push, ['autoUpload', 'proxy']);
}

// Legacy local data IS updated when the server carries a newer updatedAt stamp
// (e.g. user explicitly turned Auto Upload off on another 1.2.9+ machine).
{
  seed('ch4_stamped_server', { autoUpload: { enabled: true, scheduledTimes: ['07:00'] }, proxy: { enabled: true, host: 'x', port: '1' } });
  const stampedServer = {
    autoUpload: { ...staleServer.autoUpload, enabled: false, updatedAt: '2026-11-14T10:00:00.000Z' },
    proxy: { ...staleServer.proxy, enabled: false, updatedAt: '2026-11-14T10:00:00.000Z' },
  };
  const result = utils.syncFromServer('ch4_stamped_server', stampedServer);
  assert.equal(utils.autoConfig('ch4_stamped_server').enabled, false);
  assert.equal(utils.getProxyConfig('ch4_stamped_server').enabled, false);
  assert.deepEqual(result.push, []);
}

// Legacy disabled local data still adopts an active legacy server config (new machine setup).
{
  seed('ch4_new_machine', { autoUpload: { enabled: false }, proxy: { enabled: false, host: '', port: '' } });
  const activeLegacyServer = {
    autoUpload: { enabled: true, privacyStatus: 'schedule', scheduledTimes: ['09:00'] },
    proxy: { enabled: true, type: 'http', host: '8.8.4.4', port: '8080' },
  };
  const result = utils.syncFromServer('ch4_new_machine', activeLegacyServer);
  assert.equal(utils.autoConfig('ch4_new_machine').enabled, true);
  assert.equal(utils.getProxyConfig('ch4_new_machine').enabled, true);
  assert.equal(utils.getProxyConfig('ch4_new_machine').host, '8.8.4.4');
  assert.deepEqual(result.push, []);
}

// Server has no section but local does -> push local, keep local.
{
  seed('ch5', { uploads: {} });
  utils.saveProxyConfig('ch5', { enabled: true, type: 'socks5', host: '5.5.5.5', port: '1080' });
  const result = utils.syncFromServer('ch5', { uploads: {} });
  assert.equal(utils.getProxyConfig('ch5').host, '5.5.5.5');
  assert.deepEqual(result.push, ['proxy']);
}

// Token refresh must not write back a stale snapshot over concurrent changes.
{
  assert.equal(typeof utils.mergeTokens, 'function');
  seed('ch6', { tokens: { refresh_token: 'r', access_token: 'old' }, autoUpload: { enabled: false } });
  utils.saveAutoConfig('ch6', { enabled: true }); // happens while the refresh request is in flight
  utils.mergeTokens('ch6', { access_token: 'new', expiry_date: 1 });
  assert.equal(utils.autoConfig('ch6').enabled, true);
}

console.log('Passed YouTube config sync regressions');

