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
  // updatedAt lets syncFromServer() tell a newer local setting from a stale server copy.
  data.proxy = { ...config, updatedAt: new Date().toISOString() };
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

/**
 * Remove an upload temp folder without ever throwing.
 * On Windows a file deleted while another handle is still open (antivirus scan,
 * indexer, a stream not yet closed) stays "delete pending" for a moment, and
 * fs.rmSync on its folder throws `EPERM: operation not permitted, lstat ...`.
 * Thrown from upload()'s finally block, that error replaced the real result —
 * even a successful upload was reported as failed. Retry with backoff, then
 * schedule one late retry; cleanup failures are only logged.
 */
async function removeTempDir(dir) {
  if (!dir) return;
  const options = { recursive: true, force: true, maxRetries: 6, retryDelay: 250 };
  try {
    await fs.promises.rm(dir, options);
  } catch (error) {
    console.warn(`[YouTubeUpload] Temp cleanup deferred for ${dir}: ${error.code || error.message}`);
    const timer = setTimeout(() => {
      fs.promises.rm(dir, options).catch(err =>
        console.warn(`[YouTubeUpload] Temp cleanup failed for ${dir}: ${err.code || err.message}`));
    }, 60 * 1000);
    timer.unref?.();
  }
}

function parseClientJson(data) {
  if (data?.type === 'service_account') {
    throw new Error('Đây là Service Account JSON. YouTube upload yêu cầu OAuth Client loại Desktop app.');
  }
  if (data?.web && !data?.installed) {
    throw new Error('Đây là OAuth Client loại Web application ("web"). Hãy tạo loại Desktop app ("installed") trên Google Cloud Console.');
  }
  const client = data?.installed;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error('Nội dung không phải OAuth Client JSON loại Desktop app (thiếu khối "installed" hoặc client_id / client_secret).');
  }
  return {
    clientId: String(client.client_id).trim(),
    clientSecret: String(client.client_secret).trim(),
    projectId: String(client.project_id || '').trim(),
  };
}

function cleanJsonInput(rawText) {
  let cleaned = String(rawText ?? '').replace(/^\uFEFF/, '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(cleaned);
  if (fenced) cleaned = fenced[1].trim();
  return cleaned;
}

function saveCredentialsJson(channelId, rawText) {
  if (!channelId) return { success: false, error: 'Thiếu mã kênh (channelId).' };
  const cleaned = cleanJsonInput(rawText);
  if (!cleaned) {
    return { success: false, error: 'Vui lòng dán nội dung JSON OAuth Client.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    return { success: false, error: 'Nội dung dán vào không phải JSON hợp lệ. Vui lòng kiểm tra lại định dạng JSON.' };
  }
  try {
    const credentials = parseClientJson(parsed);
    const current = load(channelId) || {};
    const sameClient =
      current.credentials?.clientId === credentials.clientId &&
      current.credentials?.clientSecret === credentials.clientSecret;
    save(channelId, {
      ...current,
      credentials,
      tokens: sameClient ? (current.tokens || null) : null,
      channel: sameClient ? (current.channel || null) : null,
    });
    return { success: true, configured: true, projectId: credentials.projectId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function selectCredentials(channelId) {
  const result = await dialog.showOpenDialog({
    title: 'Chọn OAuth Client JSON (Desktop app)', properties: ['openFile'],
    filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
  try {
    const fileContent = fs.readFileSync(result.filePaths[0], 'utf8');
    return saveCredentialsJson(channelId, fileContent);
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

const DEFAULT_RANGE_CONCURRENCY = 3;
const DEFAULT_MAX_GLOBAL_DOWNLOAD_STREAMS = 8;
const CONNECT_TIMEOUT_MS = 30 * 1000;
const STREAM_STALL_TIMEOUT_MS = 60 * 1000;
const UPLOAD_CHUNK_STALL_TIMEOUT_MS = 90 * 1000;

let activeDownloadStreams = 0;
const downloadWaitQueue = [];

function drainDownloadQueue(limit) {
  while (downloadWaitQueue.length > 0 && activeDownloadStreams < limit) {
    const waiter = downloadWaitQueue.shift();
    if (waiter.settled) continue;
    waiter.grant();
  }
}

function acquireDownloadSlot(signal, maxGlobalStreams = DEFAULT_MAX_GLOBAL_DOWNLOAD_STREAMS) {
  const limit = Math.max(1, Number(maxGlobalStreams) || DEFAULT_MAX_GLOBAL_DOWNLOAD_STREAMS);
  if (signal?.aborted) return Promise.reject(new Error('Upload đã bị hủy.'));
  if (activeDownloadStreams < limit) {
    activeDownloadStreams += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      activeDownloadStreams = Math.max(0, activeDownloadStreams - 1);
      drainDownloadQueue(limit);
    });
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      settled: false,
      grant() {
        if (waiter.settled) return;
        waiter.settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        activeDownloadStreams += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeDownloadStreams = Math.max(0, activeDownloadStreams - 1);
          drainDownloadQueue(limit);
        });
      },
    };
    const onAbort = () => {
      if (waiter.settled) return;
      waiter.settled = true;
      const idx = downloadWaitQueue.indexOf(waiter);
      if (idx !== -1) downloadWaitQueue.splice(idx, 1);
      reject(new Error('Upload đã bị hủy.'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    downloadWaitQueue.push(waiter);
  });
}

function abortableSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('Upload đã bị hủy.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Upload đã bị hủy.'));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function extractErrorDetail(error) {
  if (!error) return 'Lỗi không xác định';
  if (typeof error === 'string') return error;
  const data = error.response?.data;
  if (data && typeof data === 'object') {
    const apiMsg = data.error?.message || data.error_description || data.message || (typeof data.error === 'string' ? data.error : '');
    const reason = Array.isArray(data.error?.errors) ? data.error.errors.map(e => e?.reason).filter(Boolean).join(', ') : '';
    if (apiMsg && reason && !apiMsg.includes(reason)) return `${apiMsg} (${reason})`;
    if (apiMsg) return String(apiMsg);
  }
  return String(error.message || error);
}

/**
 * Classify an upload/download failure so Auto Upload knows whether:
 * - 'transient': temporary server/network/proxy/temp-cleanup failure -> backoff & retry later, NEVER mark video broken
 * - 'channel'  : OAuth / YouTube quota / channel permission issue -> pause channel, NEVER mark video broken
 * - 'video'    : broken URL / 404 / invalid metadata or file -> count toward 3-strike video skip
 */
function classifyUploadError(error) {
  const rawMessage = typeof error === 'string' ? error : String(error?.message || '');
  const detail = extractErrorDetail(error);
  const combined = `${rawMessage} ${detail}`.trim();

  let status = Number(error?.status || error?.response?.status || 0);
  if (!status) {
    const m = /status code (\d{3})|\bHTTP (\d{3})\b/i.exec(combined);
    if (m) status = Number(m[1] || m[2] || 0);
  }
  const code = String(error?.code || '');

  // 1. Channel-level auth / quota / account restrictions
  if (
    /chưa kết nối OAuth|invalid_grant|invalid_client|unauthorized_client|quotaExceeded|uploadLimitExceeded|youtubeSignupRequired|accountSuspended|insufficientPermissions/i.test(combined) ||
    status === 401
  ) {
    return { kind: 'channel', status, code, detail, message: rawMessage || detail };
  }

  // 2. Transient server / network / proxy / stream / Windows temp-handle errors
  const transientStatuses = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
  if (
    error?.isTransient === true ||
    transientStatuses.has(status) ||
    /^EPERM: operation not permitted, lstat/i.test(rawMessage.trim()) ||
    /\b(EPERM: operation not permitted, lstat)\b/i.test(combined) ||
    /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ENOTFOUND|EPIPE|ERR_STREAM_PREMATURE_CLOSE|ECONNABORTED)\b/i.test(`${code} ${combined}`) ||
    /\b(aborted|premature close|socket hang up|network socket disconnected|Proxy connection|SOCKS connection|Backend Error)\b/i.test(combined) ||
    /Quá thời gian|kết nối tải file|Dữ liệu tải về chưa đủ|Server bỏ qua Range/i.test(combined)
  ) {
    return { kind: 'transient', status, code, detail, message: rawMessage || detail };
  }

  // 3. Default: video-specific failure (404, 400 invalid metadata, invalid URL, etc.)
  return { kind: 'video', status, code, detail, message: rawMessage || detail };
}

function wrapStageError(error, stageLabel, signal) {
  if (signal?.aborted || error?.message === 'Upload đã bị hủy.') {
    return new Error('Upload đã bị hủy.');
  }
  const info = classifyUploadError(error);
  const cleanDetail = info.detail.replace(/^\[[^\]]+\]\s*/, '');
  const statusPart = info.status && !new RegExp(`\\b${info.status}\\b`).test(cleanDetail) ? `HTTP ${info.status} — ` : '';
  const prefix = stageLabel ? `[${stageLabel}] ` : '';
  const wrapped = new Error(`${prefix}${statusPart}${cleanDetail}`);
  wrapped.status = info.status;
  wrapped.code = info.code;
  wrapped.kind = info.kind;
  wrapped.isTransient = info.kind === 'transient';
  if (error?.response) wrapped.response = error.response;
  return wrapped;
}

async function withTransientRetry(stageLabel, fn, { signal = null, maxAttempts = 3, baseDelayMs = 1500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('Upload đã bị hủy.');
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted || err?.message === 'Upload đã bị hủy.') throw new Error('Upload đã bị hủy.');
      lastError = err;
      const info = classifyUploadError(err);
      if (attempt >= maxAttempts || info.kind !== 'transient') {
        throw wrapStageError(err, stageLabel, signal);
      }
      const jitter = Math.floor(Math.random() * Math.max(10, Math.round(baseDelayMs * 0.25)));
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await abortableSleep(delay, signal);
    }
  }
  throw wrapStageError(lastError, stageLabel, signal);
}

/**
 * Open a GET stream with an explicit connection timeout AND an inactivity watchdog
 * that resets whenever data flows (so large multi-GB files never time out while
 * stalled TCP sockets abort cleanly).
 */
async function openWatchdogGetStream(url, axiosConfig, {
  parentSignal = null,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
} = {}) {
  if (parentSignal?.aborted) throw new Error('Upload đã bị hủy.');
  const controller = new AbortController();
  let timedOutReason = null;
  const onParentAbort = () => controller.abort();
  if (parentSignal) parentSignal.addEventListener('abort', onParentAbort, { once: true });

  let connectTimer = setTimeout(() => {
    timedOutReason = 'Quá thời gian kết nối tải file';
    controller.abort();
  }, connectTimeoutMs);
  let stallTimer = null;

  const clearTimers = () => {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  };

  try {
    const resp = await axios.get(url, {
      ...axiosConfig,
      responseType: 'stream',
      timeout: 0,
      maxRedirects: 5,
      signal: controller.signal,
    });
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }

    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOutReason = 'Kết nối tải file bị treo quá lâu';
        controller.abort();
        resp.data?.destroy?.(Object.assign(new Error(timedOutReason), { isTransient: true }));
      }, stallTimeoutMs);
    };
    resetStall();
    resp.data.on('data', resetStall);
    resp.data.once('end', clearTimers);
    resp.data.once('close', clearTimers);
    resp.data.once('error', clearTimers);

    return {
      resp,
      cleanup: clearTimers,
      rethrowIfTimedOut(err) {
        if (parentSignal?.aborted) throw new Error('Upload đã bị hủy.');
        if (timedOutReason) {
          const timeoutErr = new Error(timedOutReason);
          timeoutErr.isTransient = true;
          throw timeoutErr;
        }
        throw err;
      },
    };
  } catch (err) {
    clearTimers();
    if (parentSignal?.aborted) throw new Error('Upload đã bị hủy.');
    if (timedOutReason) {
      const timeoutErr = new Error(timedOutReason);
      timeoutErr.isTransient = true;
      throw timeoutErr;
    }
    throw err;
  }
}

async function accessToken(channelId, signal = null) {
  const saved = load(channelId);
  if (!saved?.tokens?.refresh_token) throw new Error('Kênh chưa kết nối OAuth trên máy này.');
  if (saved.tokens.access_token && Number(saved.tokens.expiry_date || 0) > Date.now() + 60000) return saved.tokens.access_token;
  const body = new URLSearchParams({
    client_id: saved.credentials.clientId, client_secret: saved.credentials.clientSecret,
    refresh_token: saved.tokens.refresh_token, grant_type: 'refresh_token',
  });
  const response = await withTransientRetry('OAuth Google', () => axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
    signal,
    httpsAgent: getProxyAgent(channelId),
  }), { signal });
  saved.tokens = { ...saved.tokens, ...response.data, expiry_date: Date.now() + response.data.expires_in * 1000 };
  mergeTokens(channelId, saved.tokens);
  return saved.tokens.access_token;
}

/**
 * Write refreshed tokens onto the CURRENT stored data. Saving the snapshot loaded
 * before the network call would silently revert any settings changed meanwhile
 * (auto-upload config, proxy, uploads recorded by another upload thread...).
 */
function mergeTokens(channelId, tokens) {
  const current = load(channelId);
  if (!current) return;
  save(channelId, { ...current, tokens: { ...(current.tokens || {}), ...tokens } });
}

/**
 * Download a file using capped parallel Range requests when the server supports
 * Accept-Ranges: bytes, guarded by a global stream semaphore so multi-threaded
 * uploads do not stampede the source server with 60–80 concurrent connections.
 * Automatically aborts sibling chunks and falls back to single-stream + retries
 * when transient 5xx / aborted / reset errors occur.
 *
 * @param {string} url          Source URL
 * @param {string} destPath     Local destination path
 * @param {Function} onPct      Progress callback (percent: 0-100)
 * @param {AbortSignal} signal  Optional AbortSignal
 * @param {number} concurrency  Parallel Range chunks for first attempt (default 3)
 * @param {object} options      Optional tuning overrides (used by tests)
 */
async function downloadFile(url, destPath, onPct = () => {}, signal = null, concurrency = DEFAULT_RANGE_CONCURRENCY, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
  const retryBaseDelayMs = Math.max(10, Number(options.retryBaseDelayMs) || 1500);
  const maxGlobalStreams = Math.max(1, Number(options.maxGlobalStreams) || DEFAULT_MAX_GLOBAL_DOWNLOAD_STREAMS);
  const connectTimeoutMs = Math.max(1000, Number(options.connectTimeoutMs) || CONNECT_TIMEOUT_MS);
  const stallTimeoutMs = Math.max(1000, Number(options.stallTimeoutMs) || STREAM_STALL_TIMEOUT_MS);
  const rangeStreams = Math.max(1, Math.min(4, Number(concurrency) || DEFAULT_RANGE_CONCURRENCY));

  // HEAD request to know file size and range support
  let total = 0;
  let supportsRange = false;
  try {
    const head = await axios.head(url, { timeout: 15000, maxRedirects: 5, signal });
    total = Number(head.headers['content-length'] || 0);
    supportsRange = String(head.headers['accept-ranges'] || '').toLowerCase() === 'bytes' && total > 2 * 1024 * 1024 && rangeStreams > 1;
  } catch (_) {
    // Some servers/signed URLs block HEAD — let GET determine availability.
  }

  // Marker file: created before download, deleted only after verified completion.
  const incompleteMarker = destPath + '.incomplete';
  fs.writeFileSync(incompleteMarker, '');

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('Upload đã bị hủy.');
    // Attempt 1 uses parallel Range when supported; retries always fall back to a
    // clean single stream so servers/CDNs that reject concurrent Range succeed reliably.
    const useRange = attempt === 1 && supportsRange;

    try {
      onPct(0);

      if (!useRange) {
        const release = await acquireDownloadSlot(signal, maxGlobalStreams);
        let streamHandle;
        try {
          streamHandle = await openWatchdogGetStream(url, {}, { parentSignal: signal, connectTimeoutMs, stallTimeoutMs });
          const { resp } = streamHandle;
          const expectedLen = Number(resp.headers['content-length'] || 0) || total;
          let received = 0;
          resp.data.on('data', buf => {
            received += buf.length;
            if (expectedLen > 0) onPct(Math.min(100, (received * 100) / expectedLen));
          });
          await pipeline(resp.data, fs.createWriteStream(destPath, { flags: 'w', highWaterMark: 2 * 1024 * 1024 }));
          if (expectedLen > 0 && received !== expectedLen) {
            const shortErr = new Error(`Dữ liệu tải về chưa đủ (${received}/${expectedLen} bytes)`);
            shortErr.isTransient = true;
            throw shortErr;
          }
        } catch (err) {
          if (streamHandle) streamHandle.rethrowIfTimedOut(err);
          throw err;
        } finally {
          streamHandle?.cleanup?.();
          release();
        }
      } else {
        // Pre-allocate the file at full size so each chunk can write at its own offset
        const fd = fs.openSync(destPath, 'w');
        try {
          fs.ftruncateSync(fd, total);
        } finally {
          fs.closeSync(fd);
        }

        const chunkSize = Math.ceil(total / rangeStreams);
        const attemptController = new AbortController();
        const onOuterAbort = () => attemptController.abort();
        if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });

        let received = 0;
        let firstChunkError = null;

        const tasks = Array.from({ length: rangeStreams }, (_, i) => {
          const start = i * chunkSize;
          if (start >= total) return Promise.resolve();
          const end = Math.min(start + chunkSize - 1, total - 1);
          const expectedChunkBytes = end - start + 1;

          return (async () => {
            const release = await acquireDownloadSlot(attemptController.signal, maxGlobalStreams);
            let streamHandle;
            try {
              streamHandle = await openWatchdogGetStream(
                url,
                {
                  headers: { Range: `bytes=${start}-${end}` },
                  validateStatus: s => s === 206 || s === 200,
                },
                { parentSignal: attemptController.signal, connectTimeoutMs, stallTimeoutMs }
              );
              const { resp } = streamHandle;
              if (resp.status !== 206) {
                resp.data?.destroy?.();
                const rangeErr = new Error(`Server bỏ qua Range (HTTP ${resp.status})`);
                rangeErr.isTransient = true;
                throw rangeErr;
              }
              let chunkReceived = 0;
              resp.data.on('data', buf => {
                chunkReceived += buf.length;
                received += buf.length;
                onPct(Math.min(100, (received * 100) / total));
              });
              await pipeline(resp.data, fs.createWriteStream(destPath, { flags: 'r+', start, highWaterMark: 2 * 1024 * 1024 }));
              if (chunkReceived !== expectedChunkBytes) {
                const shortErr = new Error(`Dữ liệu tải về chưa đủ ở phân đoạn ${i + 1} (${chunkReceived}/${expectedChunkBytes} bytes)`);
                shortErr.isTransient = true;
                throw shortErr;
              }
            } catch (err) {
              if (!firstChunkError && !signal?.aborted) {
                try {
                  if (streamHandle) streamHandle.rethrowIfTimedOut(err);
                  firstChunkError = err;
                } catch (mappedErr) {
                  firstChunkError = mappedErr;
                }
                attemptController.abort();
              }
              throw err;
            } finally {
              streamHandle?.cleanup?.();
              release();
            }
          })();
        });

        try {
          // Wait for ALL chunk WriteStreams & sockets to settle before retrying or deleting
          // the file on Windows — otherwise open file handles cause EBUSY / EPERM.
          const settled = await Promise.allSettled(tasks);
          if (signal?.aborted) throw new Error('Upload đã bị hủy.');
          const rejected = settled.find(r => r.status === 'rejected');
          if (rejected) throw firstChunkError || rejected.reason;
        } finally {
          if (signal) signal.removeEventListener('abort', onOuterAbort);
        }
      }

      const finalSize = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
      if (finalSize <= 0) {
        throw new Error('File video tải về rỗng (0 bytes).');
      }

      // Download completed and verified — remove incomplete marker
      try { fs.unlinkSync(incompleteMarker); } catch (_) {}
      onPct(100);
      return;
    } catch (err) {
      if (signal?.aborted || err?.message === 'Upload đã bị hủy.') {
        throw new Error('Upload đã bị hủy.');
      }
      lastError = err;
      const info = classifyUploadError(err);
      const canFallbackFromRange = useRange && info.status !== 404 && info.status !== 410;
      if (attempt >= maxAttempts || (!canFallbackFromRange && info.kind !== 'transient')) {
        throw wrapStageError(err, 'Tải video', signal);
      }
      const jitter = Math.floor(Math.random() * Math.max(10, Math.round(retryBaseDelayMs * 0.25)));
      const delay = retryBaseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await abortableSleep(delay, signal);
    }
  }

  throw wrapStageError(lastError, 'Tải video', signal);
}

/**
 * Query YouTube's resumable upload session to learn how many contiguous bytes
 * Google has committed so far (returns { completedData } or { nextOffset }).
 */
async function queryResumableUploadOffset(sessionUrl, size, token, httpsAgent, signal) {
  const res = await axios.put(sessionUrl, Buffer.alloc(0), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': 0,
      'Content-Range': `bytes */${size}`,
    },
    timeout: 30000,
    validateStatus: s => s === 308 || s === 200 || s === 201,
    signal,
    httpsAgent,
  });
  if (res.status === 200 || res.status === 201) {
    return { completedData: res.data, nextOffset: size };
  }
  const rangeHeader = String(res.headers?.range || '');
  const m = /bytes=0-(\d+)/i.exec(rangeHeader);
  return { completedData: null, nextOffset: m ? Number(m[1]) + 1 : 0 };
}

/**
 * Upload video file in resumable chunks, retrying transient 5xx / aborted / proxy
 * hiccups by querying Google's committed byte offset instead of restarting from 0.
 */
async function uploadResumableChunks({
  sessionUrl,
  filePath,
  size,
  chunkSize = CHUNK_SIZE,
  getAccessToken,
  httpsAgent,
  signal = null,
  onProgress = () => {},
  retryBaseDelayMs = 1500,
  maxChunkRetries = 3,
}) {
  let offset = 0;
  let uploaded = null;
  let chunkRetries = 0;

  while (offset < size) {
    if (signal?.aborted) throw new Error('Upload đã bị hủy.');
    const end = Math.min(offset + chunkSize - 1, size - 1);
    const chunkController = new AbortController();
    let stallReason = null;
    const onParentAbort = () => chunkController.abort();
    if (signal) signal.addEventListener('abort', onParentAbort, { once: true });

    let stallTimer = null;
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stallReason = 'Kết nối upload YouTube bị treo quá lâu';
        chunkController.abort();
      }, UPLOAD_CHUNK_STALL_TIMEOUT_MS);
    };

    const chunk = fs.createReadStream(filePath, { start: offset, end });
    resetStall();
    chunk.on('data', resetStall);

    try {
      const token = await getAccessToken();
      const result = await axios.put(sessionUrl, chunk, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'video/mp4',
          'Content-Length': end - offset + 1,
          'Content-Range': `bytes ${offset}-${end}/${size}`,
        },
        timeout: 0,
        maxBodyLength: Infinity,
        validateStatus: s => s === 308 || s === 200 || s === 201,
        signal: chunkController.signal,
        onUploadProgress: resetStall,
        httpsAgent,
      });
      if (result.status === 200 || result.status === 201) uploaded = result.data;
      offset = end + 1;
      chunkRetries = 0;
      onProgress({ stage: 'upload', percent: (offset * 100) / size });
    } catch (rawErr) {
      chunk.destroy();
      if (signal?.aborted) throw new Error('Upload đã bị hủy.');
      const err = stallReason ? Object.assign(new Error(stallReason), { isTransient: true }) : rawErr;
      const info = classifyUploadError(err);
      if (chunkRetries >= maxChunkRetries || info.kind !== 'transient') {
        throw wrapStageError(err, 'Upload YouTube', signal);
      }
      chunkRetries += 1;
      const jitter = Math.floor(Math.random() * Math.max(10, Math.round(retryBaseDelayMs * 0.25)));
      const delay = retryBaseDelayMs * Math.pow(2, chunkRetries - 1) + jitter;
      await abortableSleep(delay, signal);

      // Ask Google's resumable session where to resume from; if the status probe
      // itself fails transiently, keep current `offset` and re-send the chunk.
      try {
        const token = await getAccessToken();
        const probe = await queryResumableUploadOffset(sessionUrl, size, token, httpsAgent, signal);
        if (probe.completedData) {
          uploaded = probe.completedData;
          offset = size;
          onProgress({ stage: 'upload', percent: 100 });
          break;
        }
        if (Number.isFinite(probe.nextOffset) && probe.nextOffset >= 0 && probe.nextOffset <= size) {
          offset = probe.nextOffset;
        }
      } catch (probeErr) {
        if (signal?.aborted) throw new Error('Upload đã bị hủy.');
      }
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }
  }

  return uploaded;
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
    let skipDownload = false;
    const incompleteMarker = filePath + '.incomplete';
    const fileExists = fs.existsSync(filePath);
    const fileIncomplete = fs.existsSync(incompleteMarker);

    if (fileExists && !fileIncomplete) {
      const localSize = fs.statSync(filePath).size;
      if (localSize > 0) {
        try {
          const head = await axios.head(sourceUrl, { timeout: 15000, maxRedirects: 5, signal });
          const remoteSize = Number(head.headers['content-length'] || 0);
          skipDownload = !remoteSize || localSize === remoteSize;
          if (skipDownload) {
            onProgress({ stage: 'download', percent: 100 });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (_) {
          skipDownload = true;
          onProgress({ stage: 'download', percent: 100 });
        }
      }
    } else if (fileExists && fileIncomplete) {
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
    const token = await accessToken(channelId, signal);
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
    const proxyAgent = getProxyAgent(channelId);
    const session = await withTransientRetry('Tạo phiên YouTube', () => axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      metadata,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': size,
          'X-Upload-Content-Type': 'video/mp4',
        },
        timeout: 30000,
        signal,
        httpsAgent: proxyAgent,
      }
    ), { signal });

    const uploaded = await uploadResumableChunks({
      sessionUrl: session.headers.location,
      filePath,
      size,
      chunkSize: CHUNK_SIZE,
      getAccessToken: () => accessToken(channelId, signal),
      httpsAgent: proxyAgent,
      signal,
      onProgress,
    });
    if (!uploaded?.id) throw new Error('[Upload YouTube] YouTube không trả về video ID.');
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
  } finally {
    // Never let temp cleanup override the upload result (see removeTempDir).
    await removeTempDir(tempDir);
  }
}

function status(channelId) {
  const failures = autoFailures(channelId);
  const data = load(channelId);
  return {
    configured: Boolean(data?.credentials),
    connected: Boolean(data?.tokens?.refresh_token),
    channelTitle: data?.channel?.title || '',
    projectId: data?.credentials?.projectId || '',
    uploads: data?.uploads || {},
    autoFailures: failures,
    autoSkipAfter: AUTO_SKIP_AFTER_FAILURES,
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
  const autoUpload = { ...DEFAULT_AUTO_CONFIG, ...config, updatedAt: new Date().toISOString() };
  save(channelId, { ...data, autoUpload });
  return { success: true, config: autoUpload };
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

function clearUploadHistory(channelId) {
  const data = load(channelId);
  if (!data) return { success: true, removed: 0 };
  const removed = Object.keys(data.uploads || {}).length;
  data.uploads = {};
  save(channelId, data);
  return { success: true, removed };
}

/** Compare two config sections by content, ignoring the updatedAt stamp. */
function sameConfig(a, b) {
  const normalize = value => {
    const { updatedAt, ...rest } = value || {};
    return JSON.stringify(Object.keys(rest).sort().reduce((acc, k) => { acc[k] = rest[k]; return acc; }, {}));
  };
  return normalize(a) === normalize(b);
}

/**
 * Decide who wins for one settings section (autoUpload / proxy).
 * - Same content                  -> keep local, nothing to push.
 * - Both have updatedAt           -> newer timestamp wins ('adopt' vs 'push').
 * - Only local has updatedAt      -> local is newer than unstamped server -> 'push'.
 * - Only server has updatedAt     -> server was updated by 1.2.9+ elsewhere -> 'adopt'.
 * - Neither has updatedAt (legacy)-> protect active local settings (enabled: true or
 *                                    configured proxy host) from being wiped out by an
 *                                    unstamped disabled server default ('push'), while
 *                                    still adopting an active legacy server config onto
 *                                    a freshly connected machine ('adopt').
 */
function hasMeaningfulActiveSetting(section) {
  if (!section || typeof section !== 'object') return false;
  return Boolean(section.enabled) || Boolean(section.host);
}

function isLegacyLocalPreferred(local, server) {
  if (Boolean(local.enabled) && !Boolean(server.enabled)) return true;
  if (!Boolean(server.enabled) && Boolean(local.host) && !Boolean(server.host)) return true;
  return false;
}

function resolveSection(local, server) {
  if (!server || typeof server !== 'object') {
    if (!local || typeof local !== 'object') return 'keep';
    return local.updatedAt || hasMeaningfulActiveSetting(local) ? 'push' : 'keep';
  }
  if (!local || typeof local !== 'object') return 'adopt';
  if (sameConfig(local, server)) return 'keep';

  const localTime = Date.parse(local.updatedAt || '');
  const serverTime = Date.parse(server.updatedAt || '');
  const hasLocalStamp = Number.isFinite(localTime);
  const hasServerStamp = Number.isFinite(serverTime);

  if (hasLocalStamp && hasServerStamp) {
    return serverTime > localTime ? 'adopt' : 'push';
  }
  if (hasLocalStamp && !hasServerStamp) return 'push';
  if (!hasLocalStamp && hasServerStamp) return 'adopt';

  // Both legacy (unstamped): never let an inactive server copy silently disable
  // an active local channel (or wipe a configured proxy host) on channel reload.
  return isLegacyLocalPreferred(local, server) ? 'push' : 'adopt';
}

/**
 * Merge the server copy into local data.
 * Returns { push: string[] } — sections where local is newer and must be sent to the server.
 */
function syncFromServer(channelId, serverConfig, serverWorkStatus) {
  if (!channelId) return { push: [] };
  const current = load(channelId) || {};
  const push = [];
  let modified = false;
  const nowIso = new Date().toISOString();

  if (serverWorkStatus && current.workStatus !== serverWorkStatus) {
    current.workStatus = serverWorkStatus;
    modified = true;
  }
  const config = serverConfig && typeof serverConfig === 'object' ? serverConfig : {};
  const autoDecision = resolveSection(current.autoUpload, config.autoUpload);
  if (autoDecision === 'adopt') {
    current.autoUpload = { ...DEFAULT_AUTO_CONFIG, ...(current.autoUpload || {}), ...config.autoUpload };
    modified = true;
  } else if (autoDecision === 'push') {
    if (current.autoUpload && !current.autoUpload.updatedAt) {
      current.autoUpload = { ...DEFAULT_AUTO_CONFIG, ...current.autoUpload, updatedAt: nowIso };
      modified = true;
    }
    push.push('autoUpload');
  }

  const proxyDecision = resolveSection(current.proxy, config.proxy);
  if (proxyDecision === 'adopt') {
    current.proxy = { ...(current.proxy || {}), ...config.proxy };
    modified = true;
  } else if (proxyDecision === 'push') {
    if (current.proxy && !current.proxy.updatedAt) {
      current.proxy = { ...current.proxy, updatedAt: nowIso };
      modified = true;
    }
    push.push('proxy');
  }

  if (config.uploads && typeof config.uploads === 'object') {
    current.uploads = { ...(current.uploads || {}), ...config.uploads };
    modified = true;
  }
  if (modified) {
    save(channelId, current);
  }
  return { push };
}

function saveWorkStatus(channelId, workStatus) {
  const current = load(channelId) || {};
  current.workStatus = workStatus;
  save(channelId, current);
  return { success: true };
}

// ─── Auto-upload failure tracking ───────────────────────────────────────────
// A video that fails auto-upload AUTO_SKIP_AFTER_FAILURES times with a permanent
// video-level error is skipped so it no longer blocks the channel's next videos.
// Transient server/network/proxy outages are NOT counted as permanent video failures,
// and any historical false-positive records from transient errors self-heal automatically.

const AUTO_SKIP_AFTER_FAILURES = 3;
const AUTO_FAILURE_RETENTION_MS = 30 * 24 * 3600 * 1000;

function sanitizeFailureMap(rawFailures) {
  const failures = { ...(rawFailures || {}) };
  const cutoff = Date.now() - AUTO_FAILURE_RETENTION_MS;
  let dirty = false;
  for (const [id, entry] of Object.entries(failures)) {
    const expired = entry?.lastAt && new Date(entry.lastAt).getTime() < cutoff;
    const nonVideoError = entry?.lastError && classifyUploadError(entry.lastError).kind !== 'video';
    if (!entry || expired || nonVideoError) {
      delete failures[id];
      dirty = true;
    }
  }
  return { failures, dirty };
}

function autoFailures(channelId) {
  const data = load(channelId);
  if (!data?.autoUploadFailures) return {};
  const { failures, dirty } = sanitizeFailureMap(data.autoUploadFailures);
  if (dirty) {
    save(channelId, { ...data, autoUploadFailures: failures });
  }
  return failures;
}

/** Video ids that auto-upload must skip for this channel. */
function autoSkippedVideoIds(channelId) {
  const failures = autoFailures(channelId);
  return new Set(Object.keys(failures).filter(id => (failures[id]?.count || 0) >= AUTO_SKIP_AFTER_FAILURES));
}

/** Record one failed auto-upload attempt. Returns { count, max, skipped }. */
function recordAutoFailure(channelId, videoId, error, title) {
  const data = load(channelId);
  if (!data || !videoId) return { count: 0, max: AUTO_SKIP_AFTER_FAILURES, skipped: false };
  const { failures } = sanitizeFailureMap(data.autoUploadFailures);
  const id = String(videoId);
  const count = (failures[id]?.count || 0) + 1;
  failures[id] = {
    count,
    lastError: String(error || '').slice(0, 500),
    lastAt: new Date().toISOString(),
    title: title ? String(title).slice(0, 200) : (failures[id]?.title || ''),
  };
  save(channelId, { ...data, autoUploadFailures: failures });
  return { count, max: AUTO_SKIP_AFTER_FAILURES, skipped: count >= AUTO_SKIP_AFTER_FAILURES };
}

/** Remove the failure record of a video (after success or when the user asks to retry). */
function clearAutoFailure(channelId, videoId) {
  const data = load(channelId);
  const id = String(videoId || '');
  if (!data?.autoUploadFailures?.[id]) return { success: true, cleared: false };
  const failures = { ...data.autoUploadFailures };
  delete failures[id];
  save(channelId, { ...data, autoUploadFailures: failures });
  return { success: true, cleared: true };
}

/** Clear all auto-upload failure records for one channel, or across all channels when omitted. */
function clearAllAutoFailures(channelId = null) {
  const targetIds = channelId ? [String(channelId)] : allChannelIds();
  let clearedChannels = 0;
  let clearedVideos = 0;
  for (const id of targetIds) {
    const data = load(id);
    const existing = data?.autoUploadFailures ? Object.keys(data.autoUploadFailures).length : 0;
    if (existing > 0) {
      clearedChannels += 1;
      clearedVideos += existing;
      save(id, { ...data, autoUploadFailures: {} });
    }
  }
  return { success: true, clearedChannels, clearedVideos };
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
  initialize, selectCredentials, saveCredentialsJson, connect, upload, status, disconnect, storageSettings, selectStorageFolder, uploadHistory, clearUploadHistory,
  removeTempDir, mergeTokens,
  downloadFile, uploadResumableChunks, classifyUploadError,
  // auto-upload
  autoConfig, saveAutoConfig, recordAutoUpload, shouldAutoUpload, nextPublishAt, allChannelIds, autoStatus,
  syncFromServer,
  getSyncPayload,
  saveWorkStatus,
  // auto-upload failure tracking
  AUTO_SKIP_AFTER_FAILURES, autoFailures, autoSkippedVideoIds, recordAutoFailure, clearAutoFailure, clearAllAutoFailures,
};

