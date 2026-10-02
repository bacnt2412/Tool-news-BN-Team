const api = () => window.electronAPI;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

const statusLabel = status => ({
  SUCCESS: 'Đã render', UPLOADING: 'Đang upload', UPLOAD_SUCCESS: 'Đã upload', UPLOAD_ERROR: 'Upload lỗi'
}[status] || status || 'Không rõ');

export function setupYoutubeUploadListeners() {
  const root = document.getElementById('youtube-upload-tab');
  if (!root) return;
  const loginPanel = document.getElementById('proeditor-login-panel');
  const manager = document.getElementById('youtube-channel-manager');
  const channelBody = document.getElementById('youtube-channel-body');
  const status = document.getElementById('youtube-manager-status');
  const loginForm = document.getElementById('proeditor-login-form');
  const addForm = document.getElementById('youtube-add-channel-form');
  const loginStatus = document.getElementById('proeditor-login-status');
  const videoCache = new Map();
  const localChannelState = new Map();
  const downloadFolderInput = document.getElementById('youtube-download-folder');
  const videoModal = document.getElementById('youtube-videos-modal');
  const videoModalBody = document.getElementById('youtube-videos-modal-body');
  const videoModalStatus = document.getElementById('youtube-videos-modal-status');
  const publishModal = document.getElementById('youtube-publish-modal');
  const publishPrivacy = document.getElementById('youtube-publish-privacy');
  const publishScheduleGroup = document.getElementById('youtube-publish-schedule-group');
  const publishAtInput = document.getElementById('youtube-publish-at');
  const publishStatus = document.getElementById('youtube-publish-status');
  let pendingUpload = null;

  function notify(message, type = 'info') {
    const target = videoModal.style.display === 'flex'
      ? videoModalStatus
      : loginPanel.style.display !== 'none' ? loginStatus : status;
    target.textContent = message || '';
    target.className = `youtube-manager-status ${type}`;
  }

  function setAuthenticated(value, user) {
    loginPanel.style.display = value ? 'none' : 'block';
    manager.style.display = value ? 'block' : 'none';
    document.getElementById('proeditor-current-user').textContent = user?.name || user?.username || '';
  }

  async function loadChannels() {
    notify('Đang tải danh sách kênh...');
    const result = await api().proEditorChannels();
    if (!result.success) {
      if (result.status === 401) setAuthenticated(false);
      notify(result.error, 'error');
      return;
    }
    const channels = await Promise.all(result.channels.map(async channel => ({
      ...channel,
      localYoutube: await api().localYoutubeStatus(channel._id),
    })));
    channels.forEach(channel => localChannelState.set(String(channel._id), channel.localYoutube || {}));
    renderChannels(channels);
    notify(`Đã tải ${result.channels.length} kênh`, 'success');
  }

  function renderChannels(channels) {
    channelBody.innerHTML = channels.length ? channels.map((channel, index) => `
      <tr class="youtube-channel-row" data-channel-id="${escapeHtml(channel._id)}">
        <td>${index + 1}</td>
        <td><img class="youtube-channel-avatar" src="${escapeHtml(channel.thumbnail || '')}" alt="" /></td>
        <td><strong>${escapeHtml(channel.name)}</strong><div class="youtube-muted">${escapeHtml(channel.channelId)}</div></td>
        <td><span class="youtube-badge ${channel.localYoutube?.connected ? 'connected' : ''}">${channel.localYoutube?.connected ? `Local: ${escapeHtml(channel.localYoutube.channelTitle || 'Đã kết nối')}` : channel.localYoutube?.configured ? 'Đã cài JSON, chưa OAuth' : 'Chưa cài OAuth JSON'}</span><div class="youtube-muted">${escapeHtml(channel.localYoutube?.projectId || '')}</div></td>
        <td><span class="youtube-muted">Upload từ máy local</span></td>
        <td class="youtube-channel-actions">
          <button class="btn-secondary youtube-videos-btn">Danh sách video</button>
          <button class="btn-secondary youtube-json-btn">${channel.localYoutube?.configured ? 'Đổi JSON' : 'Chọn OAuth JSON'}</button>
          ${channel.localYoutube?.connected
            ? '<button class="btn-secondary youtube-local-disconnect-btn">Ngắt OAuth</button>'
            : `<button class="btn-primary youtube-local-connect-btn" ${channel.localYoutube?.configured ? '' : 'disabled'}>Kết nối Google</button>`}
          <button class="btn-danger youtube-remove-channel-btn">Xóa</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="youtube-empty">Chưa có kênh. Hãy thêm kênh YouTube đầu tiên.</td></tr>';
  }

  async function showVideos(channelId, page = 1) {
    videoModal.dataset.channelId = channelId;
    videoModal.style.display = 'flex';
    videoModalBody.innerHTML = '<div class="youtube-loading">Đang tải video hoàn thành...</div>';
    const result = await api().proEditorChannelVideos(channelId, page);
    if (!result.success) { videoModalBody.textContent = result.error; return; }
    videoCache.set(channelId, result);
    const localUploads = localChannelState.get(String(channelId))?.uploads || {};
    videoModalBody.innerHTML = `
      <div class="table-container"><table class="youtube-video-table"><thead><tr><th>Video</th><th>Ngày tạo</th><th>Trạng thái</th><th>YouTube</th><th>Thao tác</th></tr></thead>
      <tbody>${result.videos.length ? result.videos.map(video => `
        <tr><td><strong>${escapeHtml(video.name || 'Không có tiêu đề')}</strong></td>
        <td>${video.created ? new Date(video.created).toLocaleString('vi-VN') : ''}</td>
        <td><span class="youtube-badge status-${escapeHtml(video.status)}">${escapeHtml(statusLabel(video.status))}</span><div class="youtube-muted">${escapeHtml(video.statusMessage || '')}</div></td>
        <td>${localUploads[String(video._id)]?.youtubeUrl || video.youtubeUrl ? `<a href="#" class="youtube-open-link" data-url="${escapeHtml(localUploads[String(video._id)]?.youtubeUrl || video.youtubeUrl)}">Mở video</a>` : '—'}</td>
        <td>${localUploads[String(video._id)]?.youtubeVideoId || video.youtubeVideoId || video.status === 'UPLOADING' ? '<span class="youtube-badge connected">Đã upload local</span>' : `<button class="btn-primary youtube-upload-now" data-video-id="${escapeHtml(video._id)}">Upload từ máy</button>`}</td></tr>
      `).join('') : '<tr><td colspan="5" class="youtube-empty">Không có video hoàn thành ở trang này.</td></tr>'}</tbody></table></div>
      <div class="youtube-pagination"><button class="btn-secondary youtube-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Trang trước</button><span>Trang ${page}/${result.totalPage}</span><button class="btn-secondary youtube-page" data-page="${page + 1}" ${page >= result.totalPage ? 'disabled' : ''}>Trang sau</button></div>`;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    const username = document.getElementById('proeditor-username').value.trim();
    const password = document.getElementById('proeditor-password').value;
    if (!username || !password) return notify('Vui lòng nhập tên đăng nhập và mật khẩu.', 'error');
    button.disabled = true;
    button.textContent = 'Đang đăng nhập...';
    notify('Đang kết nối ProEditor...');
    try {
      const result = await api().proEditorLogin({ username, password });
      if (!result || !result.success) return notify(result?.error || 'Đăng nhập không thành công.', 'error');
      document.getElementById('proeditor-password').value = '';
      setAuthenticated(true, result.user);
      await loadStorageSettings();
      await loadChannels();
    } catch (error) {
      notify(`Không gọi được chức năng đăng nhập: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Đăng nhập';
    }
  });

  addForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = addForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const result = await api().proEditorCreateChannel({
      channelId: document.getElementById('youtube-new-channel-id').value.trim(),
      name: document.getElementById('youtube-new-channel-name').value.trim(),
      typeChannel: 'YOUTUBE', uploadOnly: true, configCombos: [], typeVideoUpload: document.getElementById('youtube-new-privacy').value,
    });
    button.disabled = false;
    if (!result.success) return notify(result.error, 'error');
    addForm.reset();
    await loadChannels();
  });

  channelBody.addEventListener('click', async event => {
    const channelRow = event.target.closest('.youtube-channel-row');
    const channelId = channelRow?.dataset.channelId;
    if (event.target.closest('.youtube-videos-btn')) return showVideos(channelId);
    if (event.target.closest('.youtube-json-btn')) {
      const result = await api().localYoutubeSelectCredentials(channelId);
      if (!result.canceled) notify(result.success ? 'Đã lưu OAuth Client JSON an toàn trên máy.' : result.error, result.success ? 'success' : 'error');
      if (result.success) await loadChannels();
    }
    if (event.target.closest('.youtube-local-connect-btn')) {
      notify('Đang chờ bạn xác nhận tài khoản Google trên trình duyệt...');
      const youtubeChannelId = channelRow.querySelector('.youtube-muted')?.textContent || '';
      const result = await api().localYoutubeConnect(channelId, youtubeChannelId);
      notify(result.success ? `Đã kết nối local với ${result.channelTitle}.` : result.error, result.success ? 'success' : 'error');
      if (result.success) await loadChannels();
    }
    if (event.target.closest('.youtube-local-disconnect-btn') && confirm('Ngắt OAuth lưu trên máy này?')) {
      const result = await api().localYoutubeDisconnect(channelId);
      result.success ? await loadChannels() : notify(result.error, 'error');
    }
    if (event.target.closest('.youtube-remove-channel-btn') && confirm('Xóa kênh này khỏi ProEditor?')) {
      const result = await api().proEditorRemoveChannel(channelId);
      result.success ? await loadChannels() : notify(result.error, 'error');
    }
  });

  function closeVideoModal() {
    videoModal.style.display = 'none';
    videoModalBody.innerHTML = '';
    videoModalStatus.textContent = '';
  }

  document.getElementById('youtube-videos-modal-close').addEventListener('click', closeVideoModal);
  videoModal.addEventListener('click', async event => {
    if (event.target === videoModal) return closeVideoModal();
    const channelId = videoModal.dataset.channelId;
    const pageButton = event.target.closest('.youtube-page');
    if (pageButton) return showVideos(channelId, Number(pageButton.dataset.page));
    const openLink = event.target.closest('.youtube-open-link');
    if (openLink) return api().openExternal(openLink.dataset.url);
    const uploadButton = event.target.closest('.youtube-upload-now');
    if (!uploadButton) return;
    const pageData = videoCache.get(channelId);
    const video = pageData?.videos?.find(item => String(item._id) === uploadButton.dataset.videoId);
    if (!video) return notify('Không tìm thấy dữ liệu video.', 'error');
    pendingUpload = { channelId, video, page: pageData?.page || 1 };
    const defaultPrivacy = String(video.typeVideoUpload || 'private').toLowerCase();
    publishPrivacy.value = ['public', 'private', 'unlisted', 'schedule'].includes(defaultPrivacy) ? defaultPrivacy : 'private';
    publishScheduleGroup.style.display = publishPrivacy.value === 'schedule' ? 'block' : 'none';
    publishAtInput.value = video.datePublic ? `${video.datePublic}T${String(video.timePublic || '00:00').slice(0, 5)}` : '';
    publishAtInput.min = new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    publishStatus.textContent = '';
    publishModal.style.display = 'flex';
  });

  function closePublishModal() {
    publishModal.style.display = 'none';
    publishStatus.textContent = '';
  }

  publishPrivacy.addEventListener('change', () => {
    publishScheduleGroup.style.display = publishPrivacy.value === 'schedule' ? 'block' : 'none';
  });
  document.getElementById('youtube-publish-modal-close').addEventListener('click', closePublishModal);
  document.getElementById('youtube-publish-cancel').addEventListener('click', closePublishModal);
  publishModal.addEventListener('click', event => { if (event.target === publishModal) closePublishModal(); });
  document.getElementById('youtube-publish-confirm').addEventListener('click', async event => {
    if (!pendingUpload) return;
    let publishAt = '';
    if (publishPrivacy.value === 'schedule') {
      const scheduledDate = new Date(publishAtInput.value);
      if (!publishAtInput.value || Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        publishStatus.textContent = 'Vui lòng chọn thời gian hẹn đăng lớn hơn thời gian hiện tại.';
        publishStatus.className = 'youtube-manager-status error';
        return;
      }
      publishAt = scheduledDate.toISOString();
    }
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang upload...';
    const { channelId, video, page } = pendingUpload;
    closePublishModal();
    const uploadVideo = { ...video, youtubeUploadOptions: { privacyStatus: publishPrivacy.value, publishAt } };
    const result = await api().localYoutubeUpload(channelId, uploadVideo);
    const savedFiles = [result.savedVideoPath, result.savedThumbnailPath].filter(Boolean);
    const savedSuffix = savedFiles.length ? ` Đã lưu file tại: ${savedFiles.join(' | ')}` : '';
    const successMessage = result.thumbnailError
      ? `Video đã upload với tiêu đề AI nhưng thumbnail lỗi: ${result.thumbnailError}`
      : `Đã upload video, tiêu đề AI và thumbnail AI: ${result.youtubeUrl}.${savedSuffix}`;
    notify(result.success ? successMessage : result.error, result.success ? (result.thumbnailError ? 'warning' : 'success') : 'error');
    button.disabled = false;
    button.textContent = 'Bắt đầu upload';
    pendingUpload = null;
    await showVideos(channelId, page);
  });

  api().onLocalYoutubeUploadProgress(data => {
    if (data.stage === 'thumbnail-warning') return notify(data.message, 'warning');
    const labels = {
      download: 'Đang tải video về máy',
      upload: 'Đang upload video từ máy lên YouTube',
      'thumbnail-download': 'Đang tải thumbnail AI về máy',
      'thumbnail-upload': 'Đang upload thumbnail AI lên YouTube',
    };
    notify(`${labels[data.stage] || 'Đang xử lý'}: ${Math.round(data.percent || 0)}%`);
  });

  document.getElementById('youtube-refresh-btn').addEventListener('click', loadChannels);
  document.getElementById('proeditor-logout-btn').addEventListener('click', async () => { await api().proEditorLogout(); setAuthenticated(false); });

  async function loadStorageSettings() {
    const settings = await api().localYoutubeStorageSettings();
    downloadFolderInput.value = settings.downloadFolder || '';
  }

  async function chooseStorageFolder() {
    const result = await api().localYoutubeSelectStorageFolder();
    if (!result.canceled) notify(result.success ? 'Đã lưu thư mục tải về.' : result.error, result.success ? 'success' : 'error');
    if (result.success) await loadStorageSettings();
  }

  document.getElementById('youtube-select-download-folder').addEventListener('click', chooseStorageFolder);

  api().proEditorSession().then(session => {
    setAuthenticated(session.authenticated, session.user);
    if (session.authenticated) {
      loadStorageSettings();
      loadChannels();
    }
  });
}
