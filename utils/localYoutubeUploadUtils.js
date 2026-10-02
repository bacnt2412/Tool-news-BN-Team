const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const CHUNK_SIZE = 8 * 1024 * 1024;
let store;
let shell;
let dialog;
let safeStorage;

function initialize(dependencies) {
  ({ store, shell, dialog, safeStorage } = dependencies);
}

function key(channelId) { return `youtubeLocal.${channelId}`; }

function protect(value) {
  const text = JSON.stringify(value);
  return safeStorage?.isEncryptionAvailable()
    ? `safe:${safeStorage.encryptString(text).toString('base64')}`
    : `plain:${Buffer.from(text).toString('base64')}`;
}

function unprotect(value) {
  if (!value) return null;
  const [mode, encoded] = String(value).split(':', 2);
  const buffer = Buffer.from(encoded || '', 'base64');
  const text = mode === 'safe' && safeStorage?.isEncryptionAvailable()
    ? safeStorage.decryptString(buffer) : buffer.toString('utf8');
  return JSON.parse(text);
}

function load(channelId) {
  try { return unprotect(store.get(key(channelId), '')); } catch (_) { return null; }
}

function save(channelId, data) { store.set(key(channelId), protect(data)); }

function storageSettings() {
  const folder = String(
    store.get('youtubeLocalStorage.downloadFolder', '') ||
    store.get('youtubeLocalStorage.videoFolder', '') ||
    store.get('youtubeLocalStorage.thumbnailFolder', '') || ''
  );
  return { downloadFolder: folder };
}

async function selectStorageFolder() {
  const current = storageSettings();
  const result = await dialog.showOpenDialog({
    title: 'Chọn thư mục lưu video và thumbnail AI',
    defaultPath: current.downloadFolder,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
  const folder = path.resolve(result.filePaths[0]);
  store.set('youtubeLocalStorage.downloadFolder', folder);
  return { success: true, folder, settings: storageSettings() };
}

function safeFileName(value) {
  const cleaned = String(value || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'video';
}

function parseClientJson(data) {
  if (data?.type === 'service_account') {
    throw new Error('Đây là Service Account JSON. YouTube upload yêu cầu OAuth Client loại Desktop app.');
  }
  const client = data?.installed;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error('File không phải OAuth Client JSON loại Desktop app (thiếu khối "installed").');
  }
  return { clientId: client.client_id, clientSecret: client.client_secret, projectId: client.project_id || '' };
}

async function selectCredentials(channelId) {
  const result = await dialog.showOpenDialog({
    title: 'Chọn OAuth Client JSON (Desktop app)', properties: ['openFile'],
    filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
  try {
    const credentials = parseClientJson(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')));
    const current = load(channelId) || {};
    save(channelId, { ...current, credentials, tokens: null, channel: null });
    return { success: true, configured: true, projectId: credentials.projectId };
  } catch (error) { return { success: false, error: error.message }; }
}

async function exchangeToken(credentials, code, redirectUri) {
  const body = new URLSearchParams({
    code, client_id: credentials.clientId, client_secret: credentials.clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000,
  });
  return response.data;
}

async function connect(channelId, expectedYoutubeChannelId) {
  const saved = load(channelId);
  if (!saved?.credentials) return { success: false, needsCredentials: true, error: 'Hãy chọn file OAuth JSON trước.' };
  const state = crypto.randomBytes(24).toString('hex');
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timeout); server.close(); resolve(result); };
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
        if (url.searchParams.get('state') !== state) throw new Error('OAuth state không hợp lệ');
        if (url.searchParams.get('error')) throw new Error(`Google OAuth: ${url.searchParams.get('error')}`);
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const tokens = await exchangeToken(saved.credentials, url.searchParams.get('code'), redirectUri);
        const accessToken = tokens.access_token;
        const channels = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
          params: { part: 'id,snippet', mine: true }, headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000,
        });
        const selected = channels.data.items?.find(item => item.id === expectedYoutubeChannelId);
        if (!selected) throw new Error('Tài khoản Google vừa chọn không quản lý đúng kênh YouTube này.');
        const previousRefresh = saved.tokens?.refresh_token;
        save(channelId, { ...saved, tokens: { ...tokens, refresh_token: tokens.refresh_token || previousRefresh }, channel: { id: selected.id, title: selected.snippet?.title || '' } });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Kết nối YouTube thành công. Bạn có thể đóng cửa sổ này.</h2><script>setTimeout(()=>window.close(),800)</script>');
        finish({ success: true, channelTitle: selected.snippet?.title || '' });
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>Kết nối thất bại</h2><p>${String(error.message).replace(/[<>]/g, '')}</p>`);
        finish({ success: false, error: error.response?.data?.error_description || error.message });
      }
    });
    server.listen(0, '127.0.0.1', async () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const params = new URLSearchParams({
        client_id: saved.credentials.clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state,
      });
      await shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });
    const timeout = setTimeout(() => finish({ success: false, error: 'Hết thời gian chờ OAuth.' }), 5 * 60 * 1000);
  });
}

async function accessToken(channelId) {
  const saved = load(channelId);
  if (!saved?.tokens?.refresh_token) throw new Error('Kênh chưa kết nối OAuth trên máy này.');
  if (saved.tokens.access_token && Number(saved.tokens.expiry_date || 0) > Date.now() + 60000) return saved.tokens.access_token;
  const body = new URLSearchParams({
    client_id: saved.credentials.clientId, client_secret: saved.credentials.clientSecret,
    refresh_token: saved.tokens.refresh_token, grant_type: 'refresh_token',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000,
  });
  saved.tokens = { ...saved.tokens, ...response.data, expiry_date: Date.now() + response.data.expires_in * 1000 };
  save(channelId, saved);
  return saved.tokens.access_token;
}

async function upload(channelId, video, onProgress = () => {}) {
  const sourceUrl = String(video?.videoSuccess || video?.videoLocalUrl || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) throw new Error('Video hoàn thành không có URL tải hợp lệ.');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-youtube-upload-'));
  const folders = storageSettings();
  const baseName = `${safeFileName(video?.aiTitle || video?.name)}-${String(video?._id || Date.now()).slice(-8)}`;
  if (folders.downloadFolder) fs.mkdirSync(folders.downloadFolder, { recursive: true });
  const filePath = path.join(folders.downloadFolder || tempDir, `${baseName}.mp4`);
  const thumbnailUrl = String(video?.thumbnail || video?.thumbnailSuccess || '').trim();
  let thumbnailPath = path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.jpg`);
  try {
    onProgress({ stage: 'download', percent: 0 });
    const response = await axios.get(sourceUrl, { responseType: 'stream', timeout: 0, maxRedirects: 5 });
    const total = Number(response.headers['content-length'] || 0);
    let received = 0;
    response.data.on('data', chunk => { received += chunk.length; if (total) onProgress({ stage: 'download', percent: received * 100 / total }); });
    await pipeline(response.data, fs.createWriteStream(filePath));
    let hasThumbnail = false;
    let thumbnailMimeType = 'image/jpeg';
    if (/^https?:\/\//i.test(thumbnailUrl)) {
      onProgress({ stage: 'thumbnail-download', percent: 0 });
      try {
        const thumbnailResponse = await axios.get(thumbnailUrl, { responseType: 'stream', timeout: 60000, maxRedirects: 5 });
        const responseMimeType = String(thumbnailResponse.headers['content-type'] || '').split(';')[0].toLowerCase();
        if (['image/jpeg', 'image/png'].includes(responseMimeType)) thumbnailMimeType = responseMimeType;
        if (thumbnailMimeType === 'image/png') thumbnailPath = path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.png`);
        await pipeline(thumbnailResponse.data, fs.createWriteStream(thumbnailPath));
        hasThumbnail = fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 0;
        onProgress({ stage: 'thumbnail-download', percent: 100 });
      } catch (error) {
        onProgress({ stage: 'thumbnail-warning', message: `Không tải được thumbnail AI: ${error.message}` });
      }
    }
    const size = fs.statSync(filePath).size;
    const token = await accessToken(channelId);
    const publishOptions = video?.youtubeUploadOptions || {};
    const requestedPrivacy = String(publishOptions.privacyStatus || video.typeVideoUpload || 'private').toLowerCase();
    const scheduled = requestedPrivacy === 'schedule';
    const privacyStatus = ['public', 'private', 'unlisted'].includes(requestedPrivacy) ? requestedPrivacy : 'private';
    const publishAt = scheduled ? new Date(publishOptions.publishAt) : null;
    if (scheduled && (!publishAt || Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= Date.now())) {
      throw new Error('Thời gian hẹn đăng YouTube phải lớn hơn thời gian hiện tại.');
    }
    const metadata = {
      snippet: { title: String(video.aiTitle || video.name || 'Untitled video').trim().slice(0, 100), description: '', categoryId: '22' },
      status: { privacyStatus: scheduled ? 'private' : privacyStatus },
    };
    if (scheduled) metadata.status.publishAt = publishAt.toISOString();
    const session = await axios.post('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', metadata, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Length': size, 'X-Upload-Content-Type': 'video/mp4' }, timeout: 30000,
    });
    let offset = 0, uploaded;
    while (offset < size) {
      const end = Math.min(offset + CHUNK_SIZE - 1, size - 1);
      const chunk = fs.createReadStream(filePath, { start: offset, end });
      const result = await axios.put(session.headers.location, chunk, {
        headers: { Authorization: `Bearer ${await accessToken(channelId)}`, 'Content-Type': 'video/mp4', 'Content-Length': end - offset + 1, 'Content-Range': `bytes ${offset}-${end}/${size}` },
        timeout: 0, maxBodyLength: Infinity, validateStatus: status => status === 308 || status === 200 || status === 201,
      });
      if (result.status === 200 || result.status === 201) uploaded = result.data;
      offset = end + 1;
      onProgress({ stage: 'upload', percent: offset * 100 / size });
    }
    if (!uploaded?.id) throw new Error('YouTube không trả về video ID.');
    let thumbnailError = '';
    if (hasThumbnail) {
      try {
        onProgress({ stage: 'thumbnail-upload', percent: 0 });
        const thumbnailSize = fs.statSync(thumbnailPath).size;
        await axios.post(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(uploaded.id)}&uploadType=media`,
          fs.createReadStream(thumbnailPath),
          {
            headers: {
              Authorization: `Bearer ${await accessToken(channelId)}`,
              'Content-Type': thumbnailMimeType,
              'Content-Length': thumbnailSize,
            },
            timeout: 60000,
            maxBodyLength: Infinity,
          }
        );
        onProgress({ stage: 'thumbnail-upload', percent: 100 });
      } catch (error) {
        const rawThumbnailError = error.response?.data?.error?.message || error.message;
        thumbnailError = /doesn't have permissions to upload and set custom video thumbnails/i.test(rawThumbnailError)
          ? 'Kênh chưa được bật quyền Thumbnail tùy chỉnh. Hãy vào YouTube Studio → Cài đặt → Kênh → Điều kiện sử dụng tính năng và xác minh số điện thoại.'
          : rawThumbnailError;
        onProgress({ stage: 'thumbnail-warning', message: `Video đã upload nhưng thumbnail lỗi: ${thumbnailError}` });
      }
    }
    const result = {
      success: true,
      youtubeVideoId: uploaded.id,
      youtubeUrl: `https://www.youtube.com/watch?v=${uploaded.id}`,
      title: metadata.snippet.title,
      thumbnailUploaded: hasThumbnail && !thumbnailError,
      thumbnailError,
      savedVideoPath: folders.downloadFolder ? filePath : '',
      savedThumbnailPath: folders.downloadFolder && hasThumbnail ? thumbnailPath : '',
    };
    const saved = load(channelId);
    saved.uploads = { ...(saved.uploads || {}), [String(video._id)]: { youtubeVideoId: result.youtubeVideoId, youtubeUrl: result.youtubeUrl, uploadedAt: new Date().toISOString() } };
    save(channelId, saved);
    return result;
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function status(channelId) {
  const data = load(channelId);
  return { configured: Boolean(data?.credentials), connected: Boolean(data?.tokens?.refresh_token), channelTitle: data?.channel?.title || '', projectId: data?.credentials?.projectId || '', uploads: data?.uploads || {} };
}

function disconnect(channelId) {
  const data = load(channelId);
  if (data?.credentials) save(channelId, { credentials: data.credentials, tokens: null, channel: null });
  return { success: true };
}

module.exports = { initialize, selectCredentials, connect, upload, status, disconnect, storageSettings, selectStorageFolder };
