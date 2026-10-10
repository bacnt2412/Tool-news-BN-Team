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
      autoSt: await api().localYoutubeAutoGet(channel._id).catch(() => ({})),
    })));
    channels.forEach(channel => localChannelState.set(String(channel._id), channel.localYoutube || {}));
    renderChannels(channels);
    notify(`Đã tải ${result.channels.length} kênh`, 'success');
  }

  function renderChannels(channels) {
    channelBody.innerHTML = channels.length ? channels.map((channel, index) => {
      const autoSt = channel.autoSt || {};
      const autoBadge = autoSt.enabled
        ? `<span class="yt-auto-badge">⚡ ${autoSt.todayCount || 0}/${autoSt.maxPerDay || 5} hôm nay</span>`
        : `<span class="yt-auto-badge disabled">Tắt</span>`;
      return `
      <tr class="youtube-channel-row" data-channel-id="${escapeHtml(channel._id)}">
        <td>${index + 1}</td>
        <td><img class="youtube-channel-avatar" src="${escapeHtml(channel.thumbnail || '')}" alt="" /></td>
        <td><strong>${escapeHtml(channel.name)}</strong><div class="youtube-muted">${escapeHtml(channel.channelId)}</div></td>
        <td><span class="youtube-badge ${channel.localYoutube?.connected ? 'connected' : ''}">${channel.localYoutube?.connected ? `Local: ${escapeHtml(channel.localYoutube.channelTitle || 'Đã kết nối')}` : channel.localYoutube?.configured ? 'Đã cài JSON, chưa OAuth' : 'Chưa cài OAuth JSON'}</span>${channel.localYoutube?.proxy?.enabled ? ' <span class="youtube-badge proxy-on" style="background:#ff9800;color:white">Proxy: Bật</span>' : ''}<div class="youtube-muted">${escapeHtml(channel.localYoutube?.projectId || '')}</div></td>
        <td>${autoBadge}</td>
        <td class="youtube-channel-actions">
          <button class="btn-secondary youtube-videos-btn">Danh sách video</button>
          <button class="btn-secondary youtube-json-btn">${channel.localYoutube?.configured ? 'Đổi JSON' : 'Chọn OAuth JSON'}</button>
          ${channel.localYoutube?.connected
            ? '<button class="btn-secondary youtube-local-disconnect-btn">Ngắt OAuth</button>'
            : `<button class="btn-primary youtube-local-connect-btn" ${channel.localYoutube?.configured ? '' : 'disabled'}>Kết nối Google</button>`}
          <button class="yt-auto-btn youtube-auto-btn" title="Cài đặt tự động upload">⚡ Tự động</button>
          <button class="btn-secondary youtube-proxy-btn" title="Cài đặt Proxy">🌐 Proxy</button>
          <button class="btn-danger youtube-remove-channel-btn">Xóa</button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="youtube-empty">Chưa có kênh. Hãy thêm kênh YouTube đầu tiên.</td></tr>';
  }

  async function showVideos(channelId, page = 1) {
    videoModal.dataset.channelId = channelId;
    videoModal.style.display = 'flex';
    videoModalBody.innerHTML = '<div class="youtube-loading">Đang tải video hoàn thành...</div>';
    const result = await api().proEditorChannelVideos(channelId, page);
    if (!result.success) { videoModalBody.textContent = result.error; return; }
    videoCache.set(channelId, result);
    const localUploads = localChannelState.get(String(channelId))?.uploads || {};
    const PRIVACY_LABELS = {
      public: 'Công khai',
      private: 'Riêng tư',
      unlisted: 'Không công khai',
      schedule: 'Hẹn giờ'
    };

    videoModalBody.innerHTML = `
      <div class="table-container"><table class="youtube-video-table"><thead><tr><th>Video</th><th>Ngày tạo</th><th>Trạng thái</th><th>YouTube</th><th>Thao tác</th></tr></thead>
      <tbody>${result.videos.length ? result.videos.map(video => {
        const localData = localUploads[String(video._id)];
        const isUploaded = localData?.youtubeVideoId || video.youtubeVideoId || video.status === 'UPLOADING';
        const privacy = localData?.privacyStatus || video.typeVideoUpload || 'private';
        const privacyLabel = PRIVACY_LABELS[privacy.toLowerCase()] || privacy;
        const uploadBadge = isUploaded 
          ? `<div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
               <span class="youtube-badge connected">Đã upload local</span>
               <span style="font-size: 11px; color: var(--gray-500);">${privacyLabel}</span>
             </div>`
          : `<button class="btn-primary youtube-upload-now" data-video-id="${escapeHtml(video._id)}">Upload từ máy</button>`;
        return `
        <tr><td><strong>${escapeHtml(video.name || 'Không có tiêu đề')}</strong></td>
        <td>${video.created ? new Date(video.created).toLocaleString('vi-VN') : ''}</td>
        <td><span class="youtube-badge status-${escapeHtml(video.status)}">${escapeHtml(statusLabel(video.status))}</span><div class="youtube-muted">${escapeHtml(video.statusMessage || '')}</div></td>
        <td>${localData?.youtubeUrl || video.youtubeUrl ? `<a href="#" class="youtube-open-link" data-url="${escapeHtml(localData?.youtubeUrl || video.youtubeUrl)}">Mở video</a>` : '—'}</td>
        <td>${uploadBadge}</td></tr>
        `;
      }).join('') : '<tr><td colspan="5" class="youtube-empty">Không có video hoàn thành ở trang này.</td></tr>'}</tbody></table></div>
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
    if (event.target.closest('.youtube-auto-btn')) return openAutoModal(channelId);
    if (event.target.closest('.youtube-proxy-btn')) return openProxyModal(channelId);
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

  // ── Proxy Modal ────────────────────────────────────────────────────────────
  const proxyModal = document.getElementById('youtube-proxy-modal');
  let proxyModalChannelId = null;

  async function openProxyModal(channelId) {
    proxyModalChannelId = channelId;
    const statusEl = document.getElementById('youtube-proxy-status');
    statusEl.textContent = '';
    statusEl.className = 'youtube-manager-status';
    
    const cfg = await api().localYoutubeProxyGet(channelId) || {};
    document.getElementById('youtube-proxy-enabled').checked = !!cfg.enabled;
    document.getElementById('youtube-proxy-type').value = cfg.type || 'http';
    document.getElementById('youtube-proxy-host').value = cfg.host || '';
    document.getElementById('youtube-proxy-port').value = cfg.port || '';
    document.getElementById('youtube-proxy-user').value = cfg.user || '';
    document.getElementById('youtube-proxy-pass').value = cfg.pass || '';
    
    proxyModal.style.display = 'flex';
  }

  document.getElementById('youtube-proxy-modal-close').addEventListener('click', () => { proxyModal.style.display = 'none'; });
  proxyModal.addEventListener('click', event => { if (event.target === proxyModal) proxyModal.style.display = 'none'; });

  document.getElementById('youtube-proxy-save-btn').addEventListener('click', async () => {
    if (!proxyModalChannelId) return;
    const config = {
      enabled: document.getElementById('youtube-proxy-enabled').checked,
      type: document.getElementById('youtube-proxy-type').value,
      host: document.getElementById('youtube-proxy-host').value.trim(),
      port: document.getElementById('youtube-proxy-port').value.trim(),
      user: document.getElementById('youtube-proxy-user').value.trim(),
      pass: document.getElementById('youtube-proxy-pass').value
    };
    
    const statusEl = document.getElementById('youtube-proxy-status');
    if (config.enabled && (!config.host || !config.port)) {
      statusEl.textContent = 'Vui lòng nhập IP/Host và Port khi bật proxy.';
      statusEl.className = 'youtube-manager-status error';
      return;
    }
    
    const result = await api().localYoutubeProxySave(proxyModalChannelId, config);
    statusEl.textContent = result.success ? 'Đã lưu cài đặt Proxy.' : (result.error || 'Lỗi lưu proxy.');
    statusEl.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
    if (result.success) {
      setTimeout(() => { proxyModal.style.display = 'none'; }, 800);
      await loadChannels();
    }
  });

  document.getElementById('youtube-proxy-test-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('youtube-proxy-status');
    const btn = document.getElementById('youtube-proxy-test-btn');
    const config = {
      type: document.getElementById('youtube-proxy-type').value,
      host: document.getElementById('youtube-proxy-host').value.trim(),
      port: document.getElementById('youtube-proxy-port').value.trim(),
      user: document.getElementById('youtube-proxy-user').value.trim(),
      pass: document.getElementById('youtube-proxy-pass').value
    };
    
    if (!config.host || !config.port) {
      statusEl.textContent = 'Vui lòng nhập IP/Host và Port trước khi kiểm tra.';
      statusEl.className = 'youtube-manager-status error';
      return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra...';
    statusEl.textContent = 'Đang gọi thử tới api.ipify.org qua proxy...';
    statusEl.className = 'youtube-manager-status';
    
    const result = await api().localYoutubeProxyTest(config);
    btn.disabled = false;
    btn.textContent = 'Kiểm tra Proxy';
    
    if (result.success) {
      statusEl.textContent = `✅ Proxy hoạt động. IP trả về: ${result.ip}`;
      statusEl.className = 'youtube-manager-status success';
    } else {
      statusEl.textContent = `❌ Lỗi: ${result.error}`;
      statusEl.className = 'youtube-manager-status error';
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

  document.getElementById('youtube-auto-log-btn').addEventListener('click', openAutoLogModal);
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

  // ── Auto-upload modal ─────────────────────────────────────────────────────
  const autoModal = document.getElementById('youtube-auto-modal');
  const autoEnabled = document.getElementById('auto-enabled');
  const autoPrivacy = document.getElementById('auto-privacy');
  const autoRestMinutes = document.getElementById('auto-rest-minutes');
  const autoMaxPerDay = document.getElementById('auto-max-per-day');
  const autoScheduleGroup = document.getElementById('auto-schedule-group');
  const autoScheduleSlots = document.getElementById('auto-schedule-slots');
  const autoTodayStatus = document.getElementById('auto-today-status');
  const autoModalStatus = document.getElementById('auto-modal-status');
  let autoModalChannelId = null;

  function getSlotTime(slotDiv) {
    return slotDiv.querySelector('.auto-time-input')?.value || '';
  }

  function renderScheduleSlots(count, savedTimes = []) {
    autoScheduleSlots.innerHTML = Array.from({ length: count }, (_, i) => `
      <div class="auto-slot-input" data-slot="${i}">
        <label>Video ${i + 1}</label>
        <input type="text" inputmode="numeric" class="auto-time-input settings-input"
               placeholder="HH:MM" maxlength="5" autocomplete="off"
               value="${savedTimes[i] || ''}" />
      </div>`).join('');

    autoScheduleSlots.querySelectorAll('.auto-time-input').forEach(el => {
      // Auto-insert colon after 2 digits
      el.addEventListener('input', () => {
        const pos = el.selectionStart;
        let v = el.value.replace(/[^0-9]/g, '');
        if (v.length > 4) v = v.slice(0, 4);
        if (v.length > 2) v = v.slice(0, 2) + ':' + v.slice(2);
        el.value = v;
        // Restore cursor after colon insertion
        if (v.length === 3 && pos === 2) el.setSelectionRange(3, 3);
      });
      // Validate + normalize on blur
      el.addEventListener('blur', () => {
        const m = el.value.match(/^([0-9]{1,2}):([0-5][0-9])$/);
        if (m) {
          const h = parseInt(m[1]);
          if (h >= 0 && h <= 23) { el.value = String(h).padStart(2, '0') + ':' + m[2]; return; }
        }
        if (el.value) el.value = ''; // clear invalid
      });
    });
  }

  function syncSlotsToMax() {
    const n = Math.max(1, Math.min(50, parseInt(autoMaxPerDay.value) || 5));
    const savedTimes = [...autoScheduleSlots.querySelectorAll('.auto-time-input')].map(el => el.value);
    renderScheduleSlots(n, savedTimes);
  }

  autoPrivacy.addEventListener('change', () => {
    autoScheduleGroup.style.display = autoPrivacy.value === 'schedule' ? 'block' : 'none';
  });
  autoMaxPerDay.addEventListener('change', () => {
    if (autoPrivacy.value === 'schedule') syncSlotsToMax();
  });

  async function openAutoModal(channelId) {
    autoModalChannelId = channelId;
    autoModalStatus.textContent = '';
    autoModalStatus.className = 'youtube-manager-status';
    const cfg = await api().localYoutubeAutoGet(channelId);
    autoEnabled.checked = !!cfg.enabled;
    autoPrivacy.value = cfg.privacyStatus || 'private';
    autoRestMinutes.value = cfg.restMinutes ?? 30;
    autoMaxPerDay.value = cfg.maxPerDay ?? 5;
    autoScheduleGroup.style.display = cfg.privacyStatus === 'schedule' ? 'block' : 'none';
    renderScheduleSlots(cfg.maxPerDay || 5, cfg.scheduledTimes || []);
    if (cfg.enabled !== undefined) {
      const lastAtStr = cfg.lastAt ? new Date(cfg.lastAt).toLocaleTimeString('vi-VN') : 'chưa có';
      autoTodayStatus.style.display = 'block';
      autoTodayStatus.textContent = `Hôm nay đã upload: ${cfg.todayCount || 0}/${cfg.maxPerDay || 5} video. Lần cuối: ${lastAtStr}. ${cfg.enabled ? '▶ Đang hoạt động.' : '⏸ Tự động upload chưa bật.'}`;
    } else {
      autoTodayStatus.style.display = 'none';
    }
    const row = channelBody.querySelector(`[data-channel-id="${channelId}"]`);
    const channelName = row?.querySelector('strong')?.textContent || channelId;
    document.getElementById('auto-modal-channel-name').textContent = channelName;
    autoModal.style.display = 'flex';
  }

  document.getElementById('youtube-auto-modal-close').addEventListener('click', () => { autoModal.style.display = 'none'; });
  document.getElementById('auto-modal-cancel').addEventListener('click', () => { autoModal.style.display = 'none'; });

  document.getElementById('auto-modal-save').addEventListener('click', async () => {
    if (!autoModalChannelId) return;
    const scheduledTimes = autoPrivacy.value === 'schedule'
      ? [...autoScheduleSlots.querySelectorAll('.auto-slot-input')].map(div => getSlotTime(div)).filter(Boolean)
      : [];
    const config = {
      enabled: autoEnabled.checked,
      privacyStatus: autoPrivacy.value,
      restMinutes: parseInt(autoRestMinutes.value) || 30,
      maxPerDay: parseInt(autoMaxPerDay.value) || 5,
      scheduledTimes,
    };
    if (config.privacyStatus === 'schedule' && scheduledTimes.length < config.maxPerDay) {
      autoModalStatus.textContent = `Cần đủ ${config.maxPerDay} mốc giờ cho chế độ Hẹn giờ đăng.`;
      autoModalStatus.className = 'youtube-manager-status error';
      return;
    }
    const result = await api().localYoutubeAutoSave(autoModalChannelId, config);
    autoModalStatus.textContent = result.success ? 'Đã lưu cài đặt tự động upload.' : (result.error || 'Lỗi lưu cài đặt.');
    autoModalStatus.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
    if (result.success) {
      setTimeout(() => { autoModal.style.display = 'none'; }, 800);
      await loadChannels();
    }
  });

  // ── Auto log modal ────────────────────────────────────────────────────────
  const autoLogModal = document.getElementById('youtube-auto-log-modal');
  const autoLogBody = document.getElementById('youtube-auto-log-body');

  // Buffer all log entries even when modal is closed
  const autoLogBuffer = [];

  const STAGE_LABELS = {
    download: 'Tải video',
    upload: 'Upload YT',
    'thumbnail-download': 'Tải thumbnail',
    'thumbnail-upload': 'Upload thumbnail',
  };

  function renderLogEntry(entry) {
    const time = entry.time || new Date().toLocaleTimeString('vi-VN');
    const el = document.createElement('div');
    el.className = `auto-log-entry ${entry.type || ''}`;
    const who = entry.channelId ? `<span class="auto-log-who">${entry.channelId.slice(-6)}</span>` : '';
    const title = `<em>${entry.videoTitle || entry.videoId || ''}</em>`;
    let msg = '';
    if (entry.type === 'start')    msg = `⬆️ Bắt đầu upload ${title}`;
    else if (entry.type === 'success') msg = `✅ Thành công ${title}${entry.youtubeUrl ? ` <a href="#" class="youtube-open-link" data-url="${entry.youtubeUrl}">Mở</a>` : ''}`;
    else if (entry.type === 'error')   msg = `❌ Lỗi: ${entry.error || ''}`;
    else if (entry.type === 'progress') {
      const stageLabel = STAGE_LABELS[entry.stage] || entry.stage || '';
      const pct = Math.round(entry.percent || 0);
      msg = `<span class="auto-log-progress-bar" style="width:${pct}%"></span>${stageLabel}: <strong>${pct}%</strong> ${title}`;
    } else msg = entry.msg || '';
    el.innerHTML = `<span class="auto-log-time">${time}</span>${who}<span class="auto-log-msg">${msg}</span>`;
    return el;
  }

  function updateChannelRowBadge(channelId, type, entry) {
    const row = channelBody.querySelector(`[data-channel-id="${channelId}"]`);
    if (!row) return;
    const badge = row.querySelector('.yt-auto-badge');
    if (!badge) return;
    if (type === 'start') {
      badge.className = 'yt-auto-badge running';
      badge.textContent = '⚡ Đang upload...';
    } else if (type === 'progress') {
      badge.className = 'yt-auto-badge running';
      badge.textContent = `⚡ ${entry.stage || ''} ${Math.round(entry.percent || 0)}%`;
    } else if (type === 'success' || type === 'error') {
      // Refresh full channel list to get accurate todayCount
      loadChannels();
    }
  }

  function openAutoLogModal() {
    autoLogBody.innerHTML = '';
    if (!autoLogBuffer.length) {
      autoLogBody.innerHTML = '<div class="auto-log-empty">Chưa có hoạt động nào.</div>';
    } else {
      autoLogBuffer.slice().reverse().forEach(entry => autoLogBody.appendChild(renderLogEntry(entry)));
    }
    autoLogModal.style.display = 'flex';
  }

  document.getElementById('youtube-auto-log-close').addEventListener('click', () => { autoLogModal.style.display = 'none'; });
  autoLogModal.addEventListener('click', e => { if (e.target === autoLogModal) autoLogModal.style.display = 'none'; });
  document.getElementById('youtube-auto-run-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('youtube-auto-run-now-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Đang chạy...';
    await api().localYoutubeAutoRunNow();
    setTimeout(() => { btn.disabled = false; btn.textContent = '▶ Chạy ngay'; }, 3000);
  });

  // Track in-progress DOM element per channelId (to update progress in-place)
  const activeProgressEl = new Map();

  api().onLocalYoutubeAutoLog(entry => {
    const enriched = { ...entry, time: new Date().toLocaleTimeString('vi-VN') };

    // Always update channel row badge
    if (entry.channelId) updateChannelRowBadge(entry.channelId, entry.type, entry);

    if (entry.type === 'progress') {
      // Deduplicate in buffer: replace existing entry for same channelId+stage
      const bufKey = `${entry.channelId}::${entry.stage}`;
      const existIdx = autoLogBuffer.findIndex(e => e.type === 'progress' && `${e.channelId}::${e.stage}` === bufKey);
      if (existIdx !== -1) autoLogBuffer.splice(existIdx, 1);
      autoLogBuffer.unshift(enriched);

      // Update in-place in modal DOM
      if (autoLogModal.style.display === 'flex') {
        const existing = activeProgressEl.get(entry.channelId);
        if (existing) {
          const stageLabel = STAGE_LABELS[entry.stage] || entry.stage || '';
          const pct = Math.round(entry.percent || 0);
          const title = `<em>${entry.videoTitle || entry.videoId || ''}</em>`;
          const msgEl = existing.querySelector('.auto-log-msg');
          if (msgEl) msgEl.innerHTML = `<span class="auto-log-progress-bar" style="width:${pct}%"></span>${stageLabel}: <strong>${pct}%</strong> ${title}`;
          return; // don't add new DOM node
        }
        // First progress entry for this channel — create it
        const el = renderLogEntry(enriched);
        autoLogBody.prepend(el);
        activeProgressEl.set(entry.channelId, el);
      }
    } else {
      autoLogBuffer.unshift(enriched);
      if (autoLogBuffer.length > 100) autoLogBuffer.length = 100;

      if (autoLogModal.style.display === 'flex') {
        const el = renderLogEntry(enriched);
        autoLogBody.prepend(el);
        // success/error clears the in-progress tracker
        if (entry.type === 'success' || entry.type === 'error') {
          activeProgressEl.delete(entry.channelId);
        }
      }
    }
  });

  api().proEditorSession().then(session => {
    setAuthenticated(session.authenticated, session.user);
    if (session.authenticated) {
      loadStorageSettings();
      loadChannels();
    }
  });
}
