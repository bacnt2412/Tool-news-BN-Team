const axios = require('axios');

let store;
let apiBaseUrl = 'https://bn.proeditor.vn/api';

function initialize(options = {}) {
  store = options.store;
  apiBaseUrl = String(options.apiBaseUrl || apiBaseUrl).replace(/\/+$/, '');
}

function token() {
  return store ? String(store.get('proEditor.token', '') || '') : '';
}

function messageFrom(error) {
  return error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Không thể kết nối ProEditor';
}

async function request(method, url, data, authenticated = true) {
  try {
    const headers = authenticated && token() ? { Authorization: `Bearer ${token()}` } : {};
    const response = await axios({ method, url: `${apiBaseUrl}${url}`, data, headers, timeout: 30000 });
    return { success: true, data: response.data || {} };
  } catch (error) {
    if (error?.response?.status === 401 && store) store.delete('proEditor.token');
    return { success: false, status: error?.response?.status || 0, error: messageFrom(error) };
  }
}

async function login(username, password) {
  if (!String(username || '').trim() || !String(password || '')) {
    return { success: false, error: 'Vui lòng nhập tên đăng nhập và mật khẩu' };
  }
  const result = await request('post', '/user/login', { username, password }, false);
  const payload = result.data || {};
  if (result.success && payload.token) {
    store.set('proEditor.token', payload.token);
    store.set('proEditor.user', { username, name: payload.userData?.name || username });
    return { success: true, user: store.get('proEditor.user') };
  }
  return { success: false, error: result.error || 'Đăng nhập không thành công' };
}

function session() {
  return { authenticated: Boolean(token()), user: store?.get('proEditor.user', null) || null };
}

function logout() {
  store.delete('proEditor.token');
  store.delete('proEditor.user');
  return { success: true };
}

async function channels() {
  const result = await request('get', '/v1/channel/get-channels');
  return result.success ? { success: true, channels: result.data.listChannel || [] } : result;
}

async function createChannel(data) {
  return request('post', '/v1/channel/create-channel', data);
}

async function removeChannel(id) {
  return request('post', '/v1/channel/remove-channel', { id });
}

async function videos(channelId, page = 1) {
  const statuses = ['SUCCESS', 'UPLOADING', 'UPLOAD_SUCCESS', 'UPLOAD_ERROR'];
  const result = await request('post', '/v1/video/get-videos', { page, idChannel: channelId, statuses });
  if (!result.success) return result;
  const completedStatuses = new Set(statuses);
  return {
    success: true,
    videos: (result.data.listVideo || []).filter(video => completedStatuses.has(String(video.status || '').toUpperCase())),
    page,
    totalPage: result.data.totalPage || 1,
  };
}

async function oauthUrl(channelId) {
  const result = await request('get', `/v1/channel/channels/${channelId}/youtube-oauth-url`);
  return result.success ? { success: true, url: result.data.url } : result;
}

function setAutoUpload(channelId, enabled) {
  return request('post', `/v1/channel/channels/${channelId}/youtube-auto-upload`, { enabled });
}

function disconnect(channelId) {
  return request('post', `/v1/channel/channels/${channelId}/youtube-disconnect`, {});
}

function upload(videoId) {
  return request('post', '/v1/video/reupload-video', { idVideo: videoId });
}

module.exports = { initialize, login, session, logout, channels, createChannel, removeChannel, videos, oauthUrl, setAutoUpload, disconnect, upload };
