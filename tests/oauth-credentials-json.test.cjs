const assert = require('node:assert/strict');
const utils = require('../utils/localYoutubeUploadUtils');

const data = new Map();
const store = {
  get: (k, d) => (data.has(k) ? data.get(k) : d),
  set: (k, v) => data.set(k, v),
};
utils.initialize({ store });

const validDesktopJson = JSON.stringify({
  installed: {
    client_id: '123456-abc.apps.googleusercontent.com',
    project_id: 'demo-yt-project-01',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    client_secret: 'GOCSPX-secretValue123',
    redirect_uris: ['http://localhost'],
  },
});

assert.equal(typeof utils.saveCredentialsJson, 'function', 'saveCredentialsJson must be exported');

// 1. Valid Desktop OAuth JSON saves credentials and preserves existing channel settings.
{
  utils.saveAutoConfig('ch-paste-1', { enabled: true, maxPerDay: 4, scheduledTimes: [] });
  utils.saveProxyConfig('ch-paste-1', { enabled: true, type: 'http', host: '1.2.3.4', port: '8080' });

  const res = utils.saveCredentialsJson('ch-paste-1', validDesktopJson);
  assert.deepEqual(res, {
    success: true,
    configured: true,
    projectId: 'demo-yt-project-01',
  });

  const st = utils.status('ch-paste-1');
  assert.equal(st.configured, true);
  assert.equal(st.projectId, 'demo-yt-project-01');
  assert.equal(utils.autoConfig('ch-paste-1').enabled, true, 'must preserve autoUpload config');
  assert.equal(utils.getProxyConfig('ch-paste-1').host, '1.2.3.4', 'must preserve proxy config');
}

// 2. Supports pasted JSON wrapped in ```json ... ``` markdown fences or UTF-8 BOM.
{
  const fenced = `\uFEFF\`\`\`json\n${validDesktopJson}\n\`\`\`\n`;
  const res = utils.saveCredentialsJson('ch-paste-fenced', fenced);
  assert.equal(res.success, true);
  assert.equal(res.projectId, 'demo-yt-project-01');
}

// 3. Re-pasting identical client_id + client_secret keeps existing connected OAuth tokens;
//    pasting a different client_id resets tokens cleanly.
{
  const key = 'youtubeLocal.ch-paste-tokens';
  const seedObj = {
    credentials: {
      clientId: '123456-abc.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-secretValue123',
      projectId: 'demo-yt-project-01',
    },
    tokens: { refresh_token: 'keep-me-token', access_token: 'acc' },
    channel: { id: 'UC123', title: 'My Channel' },
  };
  store.set(key, `plain:${Buffer.from(JSON.stringify(seedObj)).toString('base64')}`);

  const sameRes = utils.saveCredentialsJson('ch-paste-tokens', validDesktopJson);
  assert.equal(sameRes.success, true);
  assert.equal(utils.status('ch-paste-tokens').connected, true, 'identical credentials should not wipe active OAuth connection');

  const differentJson = JSON.stringify({
    installed: {
      client_id: '999999-new.apps.googleusercontent.com',
      project_id: 'new-project-02',
      client_secret: 'GOCSPX-otherSecret',
    },
  });
  const diffRes = utils.saveCredentialsJson('ch-paste-tokens', differentJson);
  assert.equal(diffRes.success, true);
  assert.equal(utils.status('ch-paste-tokens').projectId, 'new-project-02');
  assert.equal(utils.status('ch-paste-tokens').connected, false, 'changed OAuth client must reset old tokens');
}

// 4. Rejects empty input, malformed JSON, Service Account JSON, and Web Application JSON with clear messages.
{
  const emptyRes = utils.saveCredentialsJson('ch-err', '   ');
  assert.equal(emptyRes.success, false);
  assert.match(emptyRes.error, /dán nội dung JSON/i);

  const badSyntax = utils.saveCredentialsJson('ch-err', '{not valid json');
  assert.equal(badSyntax.success, false);
  assert.match(badSyntax.error, /JSON hợp lệ/i);

  const serviceAcc = utils.saveCredentialsJson('ch-err', JSON.stringify({ type: 'service_account', project_id: 'x' }));
  assert.equal(serviceAcc.success, false);
  assert.match(serviceAcc.error, /Service Account/i);

  const webApp = utils.saveCredentialsJson('ch-err', JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } }));
  assert.equal(webApp.success, false);
  assert.match(webApp.error, /Web application|Desktop app/i);
}

console.log('Passed OAuth JSON paste & validation regressions');

