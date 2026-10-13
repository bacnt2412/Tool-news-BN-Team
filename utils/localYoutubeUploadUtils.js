const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const CHUNK_SIZE = 8 * 1024 * 1024;
// Force IPv4 for all Google API requests.
// Node.js resolves AAAA (IPv6) before A (IPv4) by default; on networks where
// IPv6 routing to Google is broken this causes ETIMEDOUT (2001:4860:...:443).
const googleAgent = new https.Agent({ family: 4, keepAlive: true });

let store;

function getProxyConfig(channelId) {
  const data = load(channelId);
  return data?.proxy || { enabled: false, type: 'http', host: '', port: '', user: '', pass: '' };
}

function saveProxyConfig(channelId, config) {
  const data = load(channelId) || {};
  data.proxy = config;
  save(channelId, data);
}

function getProxyAgent(channelId) {
  const cfg = getProxyConfig(channelId);
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.port) return googleAgent;
  const auth = (cfg.user && cfg.pass) ? `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.pass)}@` : '';
  const port = cfg.port;
  const host = cfg.host;
  
  if (cfg.type === 'socks4' || cfg.type === 'socks5') {
    const protocol = cfg.type === 'socks4' ? 'socks4:' : 'socks5:';
    return new SocksProxyAgent(`${protocol}//${auth}${host}:${port}`);
  }
  return new HttpsProxyAgent(`http://${auth}${host}:${port}`);
}

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

function safeDeleteFile(targetPath) {
  if (!targetPath) return;
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch (err) {
    // Retry once on Windows in case file handle release is slightly delayed
    setTimeout(() => {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch (_) {}
    }, 500);
  }
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

async function exchangeToken(channelId, credentials, code, redirectUri) {
  const body = new URLSearchParams({
    code, client_id: credentials.clientId, client_secret: credentials.clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000, httpsAgent: getProxyAgent(channelId),
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
        const tokens = await exchangeToken(channelId, saved.credentials, url.searchParams.get('code'), redirectUri);
        const accessToken = tokens.access_token;
        const channels = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
          params: { part: 'id,snippet', mine: true }, headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000, httpsAgent: getProxyAgent(channelId),
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
        scope: SCOPES.join(' '), access_type: 'offline', prompt: 'select_account consent', state,
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      try {
        const { clipboard, BrowserWindow } = require('electron');
        clipboard.writeText(authUrl);
        console.log('Đã copy link kết nối Google OAuth vào clipboard.');
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.executeJavaScript(`
            (function() {
              const container = document.getElementById('toast-container');
              if (!container) return;
              const toast = document.createElement('div');
              toast.className = 'toast info';
              toast.innerHTML = '<div class="toast-icon">ℹ️</div><div class="toast-content"><div class="toast-message">Đã copy link Google OAuth vào clipboard. Hãy dán vào trình duyệt để đăng nhập.</div></div><button class="toast-close" onclick="this.closest(\\\'.toast\\\').remove()">×</button>';
              container.appendChild(toast);
              setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
              }, 5000);
            })();
          `).catch(console.error);
        }
      } catch (e) {}
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000, httpsAgent: getProxyAgent(channelId),
  });
  saved.tokens = { ...saved.tokens, ...response.data, expiry_date: Date.now() + response.data.expires_in * 1000 };
  save(channelId, saved);
  return saved.tokens.access_token;
}

/**
 * Download a file using parallel Range requests (like IDM) when the server
 * supports Accept-Ranges: bytes. Falls back to a single stream otherwise.
 *
 * @param {string} url         Source URL
 * @param {string} destPath    Local destination path
 * @param {Function} onPct     Progress callback (percent: 0-100)
 * @param {AbortSignal} signal  Optional AbortSignal
 * @param {number} concurrency Number of parallel connections (default 4)
 */
async function downloadFile(url, destPath, onPct, signal, concurrency = 8) {
  // HEAD request to know file size and range support
  let total = 0;
  let supportsRange = false;
  try {
    const head = await axios.head(url, { timeout: 15000, maxRedirects: 5, signal });
    total = Number(head.headers['content-length'] || 0);
    supportsRange = String(head.headers['accept-ranges'] || '').toLowerCase() === 'bytes' && total > 2 * 1024 * 1024;
  } catch (_) { /* server may not support HEAD - fall through to single stream */ }

  // Marker file: created before download, deleted after success.
  // If download is aborted (cancel / crash), marker remains → next run sees incomplete file.
  // This is critical for parallel download which pre-allocates the full file size via ftruncateSync,
  // making the file LOOK complete (size matches) even when content is partial/zeroed.
  const incompleteMarker = destPath + '.incomplete';
  fs.writeFileSync(incompleteMarker, '');

  try {
    onPct(0);

    if (!supportsRange) {
      // Single-stream fallback (server doesn't support range or file is small)
      const resp = await axios.get(url, { responseType: 'stream', timeout: 30000, maxRedirects: 5, signal });
      const len = Number(resp.headers['content-length'] || 0) || total;
      let received = 0;
      resp.data.on('data', buf => { received += buf.length; if (len) onPct(received * 100 / len); });
      await pipeline(resp.data, fs.createWriteStream(destPath, { highWaterMark: 2 * 1024 * 1024 }));
    } else {
      // Parallel chunk download
      // Pre-allocate the file at full size so each chunk can write at its own offset
      const fd = fs.openSync(destPath, 'w');
      fs.ftruncateSync(fd, total);
      fs.closeSync(fd);

      const chunkSize = Math.ceil(total / concurrency);
      let received = 0;

      await Promise.all(Array.from({ length: concurrency }, (_, i) => {
        const start = i * chunkSize;
        if (start >= total) return Promise.resolve();
        const end = Math.min(start + chunkSize - 1, total - 1);
        return (async () => {
          const resp = await axios.get(url, {
            responseType: 'stream',
            headers: { Range: `bytes=${start}-${end}` },
            timeout: 0, maxRedirects: 5, signal,
          });
          resp.data.on('data', buf => { received += buf.length; onPct(received * 100 / total); });
          await pipeline(resp.data, fs.createWriteStream(destPath, { flags: 'r+', start, highWaterMark: 2 * 1024 * 1024 }));
        })();
      }));
    }

    // Download completed successfully — remove incomplete marker
    try { fs.unlinkSync(incompleteMarker); } catch (_) {}
  } catch (error) {
    // Keep the marker on failure so next run knows the file is incomplete
    throw error;
  }
}

async function upload(channelId, video, onProgress = () => {}, signal = null, mode = 'MANUAL') {
  // B4: Accept AbortSignal so callers can cancel mid-upload
  function checkAborted() {
    if (signal?.aborted) throw new Error('Upload đã bị hủy.');
  }
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
    checkAborted();
    // Check if video file already exists and is not corrupted.
    // We do a HEAD request to get the expected size, then compare with local file.
    let skipDownload = false;
    const incompleteMarker = filePath + '.incomplete';
    const fileExists = fs.existsSync(filePath);
    const fileIncomplete = fs.existsSync(incompleteMarker); // marker left by a cancelled/failed download

    if (fileExists && !fileIncomplete) {
      // File exists and has no incomplete marker — verify size against remote
      const localSize = fs.statSync(filePath).size;
      if (localSize > 0) {
        try {
          const head = await axios.head(sourceUrl, { timeout: 15000, maxRedirects: 5, signal });
          const remoteSize = Number(head.headers['content-length'] || 0);
          skipDownload = !remoteSize || localSize === remoteSize;
          if (skipDownload) {
            onProgress({ stage: 'download', percent: 100 });
          } else {
            // Size mismatch — file is incomplete/corrupted, re-download
            fs.unlinkSync(filePath);
          }
        } catch (_) {
          // Can't reach server to verify — assume existing file is valid
          skipDownload = true;
          onProgress({ stage: 'download', percent: 100 });
        }
      }
    } else if (fileExists && fileIncomplete) {
      // File was pre-allocated by parallel download but aborted — must re-download
      try { fs.unlinkSync(filePath); } catch (_) {}
      try { fs.unlinkSync(incompleteMarker); } catch (_) {}
    }

    if (!skipDownload) {
      await downloadFile(sourceUrl, filePath, pct => onProgress({ stage: 'download', percent: pct }), signal);
    }
    checkAborted();
    let hasThumbnail = false;
    let thumbnailMimeType = 'image/jpeg';
    if (/^https?:\/\//i.test(thumbnailUrl)) {
      onProgress({ stage: 'thumbnail-download', percent: 0 });
      try {
        // B3 Fix: add connection timeout for thumbnail download
        const thumbnailResponse = await axios.get(thumbnailUrl, { responseType: 'stream', timeout: 30000, maxRedirects: 5, signal });
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
    checkAborted();
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
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Length': size, 'X-Upload-Content-Type': 'video/mp4' }, timeout: 30000, signal, httpsAgent: getProxyAgent(channelId),
    });
    let offset = 0, uploaded;
    while (offset < size) {
      checkAborted();
      const end = Math.min(offset + CHUNK_SIZE - 1, size - 1);
      const chunk = fs.createReadStream(filePath, { start: offset, end });
      const result = await axios.put(session.headers.location, chunk, {
        headers: { Authorization: `Bearer ${await accessToken(channelId)}`, 'Content-Type': 'video/mp4', 'Content-Length': end - offset + 1, 'Content-Range': `bytes ${offset}-${end}/${size}` },
        timeout: 0, maxBodyLength: Infinity, validateStatus: status => status === 308 || status === 200 || status === 201, signal, httpsAgent: getProxyAgent(channelId),
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
            httpsAgent: getProxyAgent(channelId),
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
      savedVideoPath: '',
      savedThumbnailPath: '',
    };
    const videoTitle = String(video.aiTitle || video.name || metadata.snippet.title || 'Untitled video').trim();
    const saved = load(channelId);
    saved.uploads = {
      ...(saved.uploads || {}),
      [String(video._id)]: {
        videoId: String(video._id),
        title: videoTitle,
        youtubeVideoId: result.youtubeVideoId,
        youtubeUrl: result.youtubeUrl,
        uploadedAt: new Date().toISOString(),
        privacyStatus: video.youtubeUploadOptions?.privacyStatus || requestedPrivacy || 'private',
        scheduledPublishAt: publishAt ? publishAt.toISOString() : null,
        mode: mode || 'MANUAL'
      }
    };
    save(channelId, saved);

    // Tự động xóa file video và thumbnail sau khi upload hoàn tất
    safeDeleteFile(filePath);
    safeDeleteFile(filePath + '.incomplete');
    safeDeleteFile(thumbnailPath);
    safeDeleteFile(path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.jpg`));
    safeDeleteFile(path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.png`));

    return result;
  } catch (error) {
    // Dọn dẹp file tạm nếu upload bị hủy hoặc phát sinh lỗi
    safeDeleteFile(filePath);
    safeDeleteFile(filePath + '.incomplete');
    safeDeleteFile(thumbnailPath);
    safeDeleteFile(path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.jpg`));
    safeDeleteFile(path.join(folders.downloadFolder || tempDir, `${baseName}-thumbnail.png`));
    throw error;
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function status(channelId) {
  const data = load(channelId);
  return {
    configured: Boolean(data?.credentials),
    connected: Boolean(data?.tokens?.refresh_token),
    channelTitle: data?.channel?.title || '',
    projectId: data?.credentials?.projectId || '',
    uploads: data?.uploads || {},
    proxy: data?.proxy || {},
    workStatus: data?.workStatus || 'ACTIVE'
  };
}

function disconnect(channelId) {
  const data = load(channelId);
  if (data?.credentials) save(channelId, { credentials: data.credentials, tokens: null, channel: null });
  return { success: true };
}

// ─── Auto-upload ────────────────────────────────────────────────────────────

const DEFAULT_AUTO_CONFIG = { enabled: false, privacyStatus: 'private', restMinutes: 30, maxPerDay: 5, maxPublicPerDay: 2, intervalDays: 1, scheduledTimes: [] };

function autoConfig(channelId) {
  const data = load(channelId);
  const cfg = data?.autoUpload || {};
  return {
    ...DEFAULT_AUTO_CONFIG,
    ...cfg,
    maxPublicPerDay: cfg.maxPublicPerDay ?? cfg.maxPerDay ?? DEFAULT_AUTO_CONFIG.maxPublicPerDay,
    intervalDays: Math.max(1, parseInt(cfg.intervalDays) || DEFAULT_AUTO_CONFIG.intervalDays),
  };
}

function saveAutoConfig(channelId, config) {
  const data = load(channelId) || {};
  save(channelId, { ...data, autoUpload: { ...DEFAULT_AUTO_CONFIG, ...config } });
  return { success: true };
}

/** Local date string YYYY-MM-DD in machine timezone. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLog(channelId) {
  return load(channelId)?.autoUploadLog?.[todayStr()] || { count: 0, lastAt: null };
}

/** Record that an auto-upload completed for this channel. */
function recordAutoUpload(channelId) {
  const data = load(channelId);
  if (!data) return;
  const today = todayStr();
  const log = data.autoUploadLog || {};
  const entry = log[today] || { count: 0, lastAt: null };
  entry.count += 1;
  entry.lastAt = new Date().toISOString();
  log[today] = entry;
  // Prune entries older than 7 days
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const k of Object.keys(log)) { if (new Date(k).getTime() < cutoff) delete log[k]; }
  save(channelId, { ...data, autoUploadLog: log });
}

/**
 * Check whether auto-upload is allowed to run for this channel right now.
 * Returns { ok: true } or { ok: false, reason: string }
 */
function shouldAutoUpload(channelId) {
  const data = load(channelId);
  if (data?.workStatus === 'PAUSED') return { ok: false, reason: 'Kênh đã dừng làm (PAUSED).' };
  const cfg = autoConfig(channelId);
  if (!cfg.enabled) return { ok: false, reason: 'Tự động upload chưa bật.' };
  if (!data?.tokens?.refresh_token) return { ok: false, reason: 'Kênh chưa kết nối OAuth.' };

  const log = todayLog(channelId);
  if (log.count >= cfg.maxPerDay) return { ok: false, reason: `Đã đạt ${cfg.maxPerDay} video hôm nay.` };

  if (log.lastAt) {
    const elapsed = Date.now() - new Date(log.lastAt).getTime();
    const restMs = cfg.restMinutes * 60 * 1000;
    if (elapsed < restMs) {
      const remainMins = Math.ceil((restMs - elapsed) / 60000);
      return { ok: false, reason: `Còn ${remainMins} phút nghỉ.` };
    }
  }
  return { ok: true };
}

/**
 * Calculate the publishAt datetime for the next video in schedule mode.
 * Continuous slot scanner: looks at previously scheduled videos in saved.uploads
 * and picks the next available slot strictly after the latest scheduled time.
 */
function nextPublishAt(channelId) {
  const cfg = autoConfig(channelId);
  if (cfg.privacyStatus !== 'schedule') return null;
  const rawSlots = cfg.scheduledTimes || [];
  if (!rawSlots.length) return null;
  const intervalDays = Math.max(1, parseInt(cfg.intervalDays) || 1);

  // Sắp xếp các mốc giờ tăng dần trong ngày
  const slots = rawSlots.slice().sort((a, b) => {
    const [ha, ma] = a.split(':').map(Number);
    const [hb, mb] = b.split(':').map(Number);
    return (ha * 60 + ma) - (hb * 60 + mb);
  });

  const data = load(channelId);
  const uploads = Object.values(data?.uploads || {});
  const now = Date.now();
  const bufferMs = 15 * 60 * 1000; // Đệm an toàn 15 phút

  // Lọc các video đã có scheduledPublishAt nằm ở tương lai (> now)
  const futureTimes = uploads
    .map(u => u.scheduledPublishAt ? new Date(u.scheduledPublishAt).getTime() : 0)
    .filter(t => !Number.isNaN(t) && t > now)
    .sort((a, b) => a - b);

  const latestScheduled = futureTimes.length > 0 ? futureTimes[futureTimes.length - 1] : 0;

  if (!latestScheduled) {
    // Chưa có lịch nào trong tương lai: bắt đầu dò từ hôm nay
    const today = new Date();
    for (const slot of slots) {
      const [hh, mm] = slot.split(':').map(Number);
      const d = new Date(today);
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() >= now + bufferMs) {
        return d.toISOString();
      }
    }
    // Hôm nay đã hết mốc hợp lệ -> lấy mốc đầu tiên của ngày mai
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const [hh, mm] = slots[0].split(':').map(Number);
    tomorrow.setHours(hh, mm, 0, 0);
    return tomorrow.toISOString();
  }

  // Đã có mốc hẹn xa nhất: tìm mốc tiếp theo nối tiếp sau latestScheduled
  const lastDate = new Date(latestScheduled);
  const lastMinutes = lastDate.getHours() * 60 + lastDate.getMinutes();

  // Tìm slot trong cùng ngày mà lớn hơn mốc vừa rồi
  for (const slot of slots) {
    const [hh, mm] = slot.split(':').map(Number);
    const slotMinutes = hh * 60 + mm;
    if (slotMinutes > lastMinutes) {
      const nextDate = new Date(lastDate);
      nextDate.setHours(hh, mm, 0, 0);
      if (nextDate.getTime() >= now + bufferMs) {
        return nextDate.toISOString();
      }
    }
  }

  // Nếu đã hết slot trong ngày đó -> chuyển sang ngày mới sau intervalDays ngày
  const nextDay = new Date(lastDate);
  nextDay.setDate(nextDay.getDate() + intervalDays);
  const [hh, mm] = slots[0].split(':').map(Number);
  nextDay.setHours(hh, mm, 0, 0);
  while (nextDay.getTime() < now + bufferMs) {
    nextDay.setDate(nextDay.getDate() + intervalDays);
  }
  return nextDay.toISOString();
}

/** Return all channelIds that have local YouTube credentials in the store. */
function allChannelIds() {
  if (!store) return [];
  const ytLocal = store.get('youtubeLocal', {});
  return Object.keys(ytLocal || {});
}

/** Auto-upload status for a channel (used by renderer to show badge). */
function autoStatus(channelId) {
  const cfg = autoConfig(channelId);
  const log = todayLog(channelId);
  return {
    enabled: cfg.enabled,
    privacyStatus: cfg.privacyStatus,
    restMinutes: cfg.restMinutes,
    maxPerDay: cfg.maxPerDay,
    maxPublicPerDay: cfg.maxPublicPerDay,
    intervalDays: cfg.intervalDays,
    scheduledTimes: cfg.scheduledTimes,
    todayCount: log.count,
    lastAt: log.lastAt,
    check: shouldAutoUpload(channelId),
  };
}

function uploadHistory(channelId) {
  const data = load(channelId);
  const uploads = data?.uploads || {};
  const list = Object.entries(uploads).map(([id, item]) => ({
    videoId: id,
    title: item.title || ('Video ' + (item.youtubeVideoId || id)),
    youtubeVideoId: item.youtubeVideoId || '',
    youtubeUrl: item.youtubeUrl || (item.youtubeVideoId ? `https://www.youtube.com/watch?v=${item.youtubeVideoId}` : ''),
    uploadedAt: item.uploadedAt || '',
    privacyStatus: item.privacyStatus || 'private',
    mode: item.mode || 'MANUAL'
  }));
  list.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  return {
    success: true,
    channelTitle: data?.channel?.title || '',
    history: list
  };
}

function syncFromServer(channelId, serverConfig, serverWorkStatus) {
  if (!channelId) return;
  const current = load(channelId) || {};
  let modified = false;

  if (serverWorkStatus && current.workStatus !== serverWorkStatus) {
    current.workStatus = serverWorkStatus;
    modified = true;
  }
  if (serverConfig) {
    if (serverConfig.autoUpload && typeof serverConfig.autoUpload === 'object') {
      current.autoUpload = { ...DEFAULT_AUTO_CONFIG, ...(current.autoUpload || {}), ...serverConfig.autoUpload };
      modified = true;
    }
    if (serverConfig.proxy && typeof serverConfig.proxy === 'object') {
      current.proxy = { ...(current.proxy || {}), ...serverConfig.proxy };
      modified = true;
    }
    if (serverConfig.uploads && typeof serverConfig.uploads === 'object') {
      current.uploads = { ...(current.uploads || {}), ...serverConfig.uploads };
      modified = true;
    }
  }
  if (modified) {
    save(channelId, current);
  }
}

function saveWorkStatus(channelId, workStatus) {
  const current = load(channelId) || {};
  current.workStatus = workStatus;
  save(channelId, current);
  return { success: true };
}

function getSyncPayload(channelId) {
  const data = load(channelId);
  if (!data) return null;
  return {
    autoUpload: data.autoUpload || null,
    proxy: data.proxy || null,
    uploads: data.uploads || null
  };
}

module.exports = {
  getProxyConfig,
  saveProxyConfig,
  initialize, selectCredentials, connect, upload, status, disconnect, storageSettings, selectStorageFolder, uploadHistory,
  // auto-upload
  autoConfig, saveAutoConfig, recordAutoUpload, shouldAutoUpload, nextPublishAt, allChannelIds, autoStatus,
  syncFromServer,
  getSyncPayload,
  saveWorkStatus,
};

