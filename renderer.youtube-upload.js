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

  let currentChannels = [];
  let sortScheduleOrder = 'none'; // 'none' | 'desc' | 'asc'
  let sortWorkStatusOrder = 'none'; // 'none' | 'active-first' | 'paused-first'

  async function loadChannels() {
    notify('Đang tải danh sách kênh...');
    const result = await api().proEditorChannels();
    if (!result.success) {
      if (result.status === 401) setAuthenticated(false);
      notify(result.error, 'error');
      return;
    }
    const channels = await Promise.all(result.channels.map(async channel => {
      await api().localYoutubeSyncChannel?.(channel._id, channel.youtubeUploadConfig, channel.workStatus).catch(() => {});
      const localStatus = await api().localYoutubeStatus(channel._id);
      return {
        ...channel,
        workStatus: channel.workStatus || localStatus?.workStatus || 'ACTIVE',
        localYoutube: localStatus,
        autoSt: await api().localYoutubeAutoGet(channel._id).catch(() => ({})),
      };
    }));
    channels.forEach(channel => localChannelState.set(String(channel._id), channel.localYoutube || {}));
    currentChannels = channels;
    applySortAndRender();
    if (sortScheduleOrder === 'none' && sortWorkStatusOrder === 'none') {
      notify(`Đã tải ${result.channels.length} kênh`, 'success');
    }
  }

  function getFurthestScheduleInfo(channel) {
    const localUploads = channel.localYoutube?.uploads || {};
    const serverUploads = channel.youtubeUploadConfig?.uploads || {};
    const uploadsObj = { ...serverUploads, ...localUploads };
    const uploadList = Object.values(uploadsObj).filter(Boolean);

    if (!uploadList.length) {
      if (channel.autoSt?.lastAt) {
        const d = new Date(channel.autoSt.lastAt);
        if (!isNaN(d.getTime())) {
          return {
            type: 'autorun',
            timestamp: d.getTime(),
            date: d,
            title: 'Auto run',
          };
        }
      }
      return { type: 'none', timestamp: 0, date: null, title: '' };
    }

    const now = Date.now();

    // 1. Thu thập tất cả video có lịch hẹn giờ (scheduledPublishAt hoặc publishAt hoặc datePublic)
    const scheduledList = uploadList
      .map(u => {
        let timestamp = NaN;
        const rawDate = u.scheduledPublishAt || u.publishAt;
        if (rawDate) {
          timestamp = new Date(rawDate).getTime();
        } else if (u.datePublic) {
          timestamp = new Date(`${u.datePublic}T${u.timePublic || '00:00:00'}+07:00`).getTime();
        }
        return { ...u, timestamp };
      })
      .filter(u => !isNaN(u.timestamp));

    // Lọc các video có lịch hẹn giờ ở tương lai (Max scheduled timestamp)
    const futureScheduled = scheduledList.filter(u => u.timestamp > now);
    if (futureScheduled.length > 0) {
      futureScheduled.sort((a, b) => b.timestamp - a.timestamp);
      const furthest = futureScheduled[0];
      return {
        type: 'future',
        timestamp: furthest.timestamp,
        date: new Date(furthest.timestamp),
        title: furthest.title || '',
      };
    }

    // 2. Nếu đã hết lịch hẹn trong tương lai, nhưng có video đã hẹn trong quá khứ
    if (scheduledList.length > 0) {
      scheduledList.sort((a, b) => b.timestamp - a.timestamp);
      const latestScheduled = scheduledList[0];
      return {
        type: 'past',
        timestamp: latestScheduled.timestamp,
        date: new Date(latestScheduled.timestamp),
        title: latestScheduled.title || '',
      };
    }

    // 3. Nếu là các video upload trực tiếp (Công khai / Riêng tư không hẹn giờ)
    const uploadedList = uploadList
      .filter(u => u && u.uploadedAt)
      .map(u => ({
        ...u,
        timestamp: new Date(u.uploadedAt).getTime()
      }))
      .filter(u => !isNaN(u.timestamp));

    if (uploadedList.length > 0) {
      uploadedList.sort((a, b) => b.timestamp - a.timestamp);
      const latest = uploadedList[0];
      return {
        type: 'uploaded',
        timestamp: latest.timestamp,
        date: new Date(latest.timestamp),
        title: latest.title || '',
      };
    }

    return { type: 'none', timestamp: 0, date: null, title: '' };
  }

  function formatFurthestSchedule(channel) {
    const info = getFurthestScheduleInfo(channel);
    if (info.type === 'none' || !info.date) {
      return '<span class="yt-last-upload-empty">Chưa có video</span>';
    }

    const now = Date.now();
    const d = String(info.date.getDate()).padStart(2, '0');
    const m = String(info.date.getMonth() + 1).padStart(2, '0');
    const y = info.date.getFullYear();
    const hh = String(info.date.getHours()).padStart(2, '0');
    const mm = String(info.date.getMinutes()).padStart(2, '0');
    const dateStr = `${d}/${m}/${y}`;
    const timeStr = `${hh}:${mm}`;

    if (info.type === 'future') {
      const diffMs = info.timestamp - now;
      const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
      const diffHours = Math.ceil(diffMs / (60 * 60 * 1000));
      const diffText = diffDays > 1 ? `(còn ${diffDays} ngày)` : diffHours > 1 ? `(còn ${diffHours}h)` : '(hôm nay)';

      return `
        <div class="yt-last-upload-wrap" title="${escapeHtml(info.title || '')} — Hẹn công khai: ${dateStr} ${timeStr}">
          <span class="yt-last-upload-date is-future">📅 ${dateStr}</span>
          <span class="yt-last-upload-meta">
            <span class="yt-sched-tag">Hẹn giờ</span> ${timeStr} ${diffText}
          </span>
        </div>`;
    }

    if (info.type === 'past') {
      return `
        <div class="yt-last-upload-wrap" title="${escapeHtml(info.title || '')} — Lịch hẹn cuối: ${dateStr} ${timeStr}">
          <span class="yt-last-upload-date">📅 ${dateStr}</span>
          <span class="yt-last-upload-meta">
            <span class="yt-sched-tag past">Hết lịch</span> ${timeStr} (đã đăng)
          </span>
        </div>`;
    }

    if (info.type === 'uploaded') {
      return `
        <div class="yt-last-upload-wrap" title="${escapeHtml(info.title || '')} — Upload lúc: ${dateStr} ${timeStr}">
          <span class="yt-last-upload-date">📅 ${dateStr}</span>
          <span class="yt-last-upload-meta">
            <span class="yt-sched-tag upload">Đã đăng</span> ${timeStr}
          </span>
        </div>`;
    }

    if (info.type === 'autorun') {
      return `
        <div class="yt-last-upload-wrap">
          <span class="yt-last-upload-date">📅 ${dateStr}</span>
          <span class="yt-last-upload-meta">⏰ ${timeStr} • Auto run</span>
        </div>`;
    }

    return '<span class="yt-last-upload-empty">Chưa có video</span>';
  }

  function applySortAndRender() {
    let list = [...currentChannels];
    if (sortWorkStatusOrder !== 'none') {
      list.sort((a, b) => {
        const statusA = a.workStatus || 'ACTIVE';
        const statusB = b.workStatus || 'ACTIVE';
        if (statusA !== statusB) {
          if (sortWorkStatusOrder === 'active-first') {
            return statusA === 'ACTIVE' ? -1 : 1;
          } else {
            return statusA === 'PAUSED' ? -1 : 1;
          }
        }
        return (a.name || '').localeCompare(b.name || '');
      });
    } else if (sortScheduleOrder !== 'none') {
      list.sort((a, b) => {
        const infoA = getFurthestScheduleInfo(a);
        const infoB = getFurthestScheduleInfo(b);

        const hasA = infoA.type !== 'none' && infoA.timestamp > 0;
        const hasB = infoB.type !== 'none' && infoB.timestamp > 0;

        if (!hasA && !hasB) return (a.name || '').localeCompare(b.name || '');
        if (!hasA) return 1;
        if (!hasB) return -1;

        if (sortScheduleOrder === 'desc') {
          const scoreA = (infoA.type === 'future' ? 1e15 : 0) + infoA.timestamp;
          const scoreB = (infoB.type === 'future' ? 1e15 : 0) + infoB.timestamp;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return (a.name || '').localeCompare(b.name || '');
        } else {
          const scoreA = (infoA.type === 'future' ? 1e15 : 0) + infoA.timestamp;
          const scoreB = (infoB.type === 'future' ? 1e15 : 0) + infoB.timestamp;
          if (scoreA !== scoreB) return scoreA - scoreB;
          return (a.name || '').localeCompare(b.name || '');
        }
      });
    }

    renderChannels(list);
    updateSortHeaderUI();
  }

  function updateSortHeaderUI() {
    const thSched = document.getElementById('th-furthest-schedule');
    const iconSched = document.getElementById('sort-schedule-icon');
    if (thSched && iconSched) {
      thSched.classList.remove('sort-active');
      if (sortScheduleOrder === 'desc') {
        thSched.classList.add('sort-active');
        iconSched.textContent = '▼';
        thSched.title = 'Đang sắp xếp: Lịch xa nhất trước (Giảm dần). Nhấn để chuyển sang xem lịch gần nhất (Tăng dần)';
      } else if (sortScheduleOrder === 'asc') {
        thSched.classList.add('sort-active');
        iconSched.textContent = '▲';
        thSched.title = 'Đang sắp xếp: Lịch gần nhất trước (Tăng dần). Nhấn để hủy sắp xếp';
      } else {
        iconSched.textContent = '↕';
        thSched.title = 'Nhấn để sắp xếp theo Hẹn giờ xa nhất (Giảm dần / Tăng dần)';
      }
    }

    const thWork = document.getElementById('th-channel-work-status');
    const iconWork = document.getElementById('sort-work-status-icon');
    if (thWork && iconWork) {
      thWork.classList.remove('sort-active');
      if (sortWorkStatusOrder === 'active-first') {
        thWork.classList.add('sort-active');
        iconWork.textContent = '▼';
        thWork.title = 'Đang sắp xếp: Đang làm trước (▼). Nhấn để chuyển sang Dừng làm trước (▲)';
      } else if (sortWorkStatusOrder === 'paused-first') {
        thWork.classList.add('sort-active');
        iconWork.textContent = '▲';
        thWork.title = 'Đang sắp xếp: Dừng làm trước (▲). Nhấn để hủy sắp xếp';
      } else {
        iconWork.textContent = '↕';
        thWork.title = 'Nhấn để sắp xếp theo Trạng thái (Đang làm / Dừng làm)';
      }
    }
  }

  function toggleScheduleSort() {
    sortWorkStatusOrder = 'none';
    if (sortScheduleOrder === 'none') {
      sortScheduleOrder = 'desc';
      notify(`Đã tải ${currentChannels.length} kênh • Sắp xếp: Hẹn xa nhất trước (Giảm dần ▼)`, 'info');
    } else if (sortScheduleOrder === 'desc') {
      sortScheduleOrder = 'asc';
      notify(`Đã tải ${currentChannels.length} kênh • Sắp xếp: Hẹn gần nhất trước (Tăng dần ▲)`, 'info');
    } else {
      sortScheduleOrder = 'none';
      notify(`Đã tải ${currentChannels.length} kênh`, 'success');
    }
    applySortAndRender();
  }

  function toggleWorkStatusSort() {
    sortScheduleOrder = 'none';
    if (sortWorkStatusOrder === 'none') {
      sortWorkStatusOrder = 'active-first';
      notify(`Đã tải ${currentChannels.length} kênh • Sắp xếp: Kênh Đang làm trước (▼)`, 'info');
    } else if (sortWorkStatusOrder === 'active-first') {
      sortWorkStatusOrder = 'paused-first';
      notify(`Đã tải ${currentChannels.length} kênh • Sắp xếp: Kênh Dừng làm trước (▲)`, 'info');
    } else {
      sortWorkStatusOrder = 'none';
      notify(`Đã tải ${currentChannels.length} kênh`, 'success');
    }
    applySortAndRender();
  }

  function renderChannels(channels) {
    channelBody.innerHTML = channels.length ? channels.map((channel, index) => {
      const autoSt = channel.autoSt || {};
      const autoBadge = autoSt.enabled
        ? `<span class="yt-auto-badge">⚡ ${autoSt.todayCount || 0}/${autoSt.maxPerDay || 5} hôm nay</span>`
        : `<span class="yt-auto-badge disabled">Tắt</span>`;
      const isPaused = channel.workStatus === 'PAUSED';
      const statusBtn = isPaused
        ? `<button class="btn-work-status paused" data-channel-id="${escapeHtml(channel._id)}" type="button" title="Kênh đang tạm dừng làm. Nhấn để chuyển sang Đang làm"><span class="status-dot"></span><span>Dừng làm</span></button>`
        : `<button class="btn-work-status active" data-channel-id="${escapeHtml(channel._id)}" type="button" title="Kênh đang làm việc. Nhấn để chuyển sang Dừng làm"><span class="status-dot"></span><span>Đang làm</span></button>`;
      return `
      <tr class="youtube-channel-row" data-channel-id="${escapeHtml(channel._id)}">
        <td>${index + 1}</td>
        <td><img class="youtube-channel-avatar" src="${escapeHtml(channel.thumbnail || '')}" alt="" /></td>
        <td><strong>${escapeHtml(channel.name)}</strong><div class="youtube-muted">${escapeHtml(channel.channelId)}</div></td>
        <td>${statusBtn}</td>
        <td><span class="youtube-badge ${channel.localYoutube?.connected ? 'connected' : ''}">${channel.localYoutube?.connected ? `Local: ${escapeHtml(channel.localYoutube.channelTitle || 'Đã kết nối')}` : channel.localYoutube?.configured ? 'Đã cài JSON, chưa OAuth' : 'Chưa cài OAuth JSON'}</span>${channel.localYoutube?.proxy?.enabled ? ' <span class="youtube-badge proxy-on" style="background:#ff9800;color:white">Proxy: Bật</span>' : ''}<div class="youtube-muted">${escapeHtml(channel.localYoutube?.projectId || '')}</div></td>
        <td>${autoBadge}</td>
        <td>${formatFurthestSchedule(channel)}</td>
        <td class="youtube-channel-actions">
          <button class="btn-primary youtube-videos-btn" title="Xem danh sách video">Danh sách video</button>
          <button class="btn-secondary youtube-history-btn" title="Xem lịch sử upload của kênh">📜 Lịch sử</button>
          <button class="btn-secondary youtube-settings-btn" title="Cài đặt kênh (OAuth, Tự động, Proxy)">⚙️ Cài đặt</button>
          <button class="btn-ghost-danger youtube-remove-channel-btn" title="Xóa kênh khỏi danh sách">Xóa</button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="youtube-empty">Chưa có kênh nào trên tài khoản ProEditor của bạn.</td></tr>';
  }

  async function showVideos(channelId, page = 1) {
    videoModal.dataset.channelId = channelId;
    videoModal.style.display = 'flex';
    videoModalBody.innerHTML = '<div class="youtube-loading">Đang tải video hoàn thành...</div>';
    const result = await api().proEditorChannelVideos(channelId, page);
    if (!result.success) { videoModalBody.textContent = result.error; return; }
    videoCache.set(channelId, result);
    
    // Fetch latest local status so uploads map is up to date (e.g. after an upload completes)
    const localStatus = await api().localYoutubeStatus(channelId);
    localChannelState.set(String(channelId), localStatus || {});
    const localUploads = localStatus?.uploads || {};
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
        const isCurrentPending = pendingUpload && String(pendingUpload.video?._id) === String(video._id);
        const currentStatus = isCurrentPending ? 'UPLOADING' : video.status;
        const currentStatusLabel = isCurrentPending ? 'Đang upload' : statusLabel(video.status);
        const uploadBadge = isUploaded 
          ? `<div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
               <span class="youtube-badge connected">Đã upload local</span>
               <span style="font-size: 11px; color: var(--gray-500);">${privacyLabel}</span>
             </div>`
          : (isCurrentPending
              ? `<div class="yt-upload-progress">
                   <div class="yt-upload-top">
                     <span class="yt-upload-stage">Đang upload...</span>
                     <button class="yt-cancel-btn" data-video-id="${escapeHtml(video._id)}" title="Hủy upload">⏹ Hủy</button>
                   </div>
                   <div class="yt-upload-bar"><div class="yt-upload-fill" style="width: 50%"></div></div>
                 </div>`
              : `<button class="btn-primary youtube-upload-now" data-video-id="${escapeHtml(video._id)}">Upload từ máy</button>`);
        return `
        <tr data-video-id="${escapeHtml(video._id)}"><td><strong>${escapeHtml(video.name || 'Không có tiêu đề')}</strong></td>
        <td>${video.created ? new Date(video.created).toLocaleString('vi-VN') : ''}</td>
        <td class="youtube-status-cell"><span class="youtube-badge status-${escapeHtml(currentStatus)}">${escapeHtml(currentStatusLabel)}</span><div class="youtube-muted">${escapeHtml(video.statusMessage || '')}</div></td>
        <td>${localData?.youtubeUrl || video.youtubeUrl ? `<a href="#" class="youtube-open-link" data-url="${escapeHtml(localData?.youtubeUrl || video.youtubeUrl)}">Mở video</a>` : '—'}</td>
        <td class="youtube-action-cell">${uploadBadge}</td></tr>
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

  channelBody.addEventListener('click', async event => {
    const channelRow = event.target.closest('.youtube-channel-row');
    const channelId = channelRow?.dataset.channelId;
    if (!channelId) return;

    const workStatusBtn = event.target.closest('.btn-work-status');
    if (workStatusBtn) {
      const channel = currentChannels.find(c => String(c._id) === String(channelId));
      if (!channel) return;
      const currentStatus = channel.workStatus || 'ACTIVE';
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

      // Optimistic update
      channel.workStatus = newStatus;
      if (channel.localYoutube) channel.localYoutube.workStatus = newStatus;
      workStatusBtn.classList.add('is-loading');

      try {
        const res = await api().proEditorChannelWorkStatus(channelId, newStatus);
        if (res && res.success === false) {
          channel.workStatus = currentStatus;
          if (channel.localYoutube) channel.localYoutube.workStatus = currentStatus;
          notify(`Không thể cập nhật trạng thái: ${res.error || 'Lỗi server'}`, 'error');
        } else {
          const statusText = newStatus === 'ACTIVE' ? 'Đang làm' : 'Dừng làm';
          notify(`Kênh "${channel.name}" đã chuyển sang "${statusText}"`, 'success');
        }
      } catch (err) {
        channel.workStatus = currentStatus;
        if (channel.localYoutube) channel.localYoutube.workStatus = currentStatus;
        notify(`Lỗi cập nhật trạng thái: ${err.message}`, 'error');
      } finally {
        applySortAndRender();
      }
      return;
    }

    if (event.target.closest('.youtube-videos-btn')) return showVideos(channelId);
    if (event.target.closest('.youtube-history-btn')) return openHistoryModal(channelId);
    if (event.target.closest('.youtube-settings-btn')) return openChannelSettingsModal(channelId);

    // Fallbacks
    if (event.target.closest('.youtube-auto-btn')) return openChannelSettingsModal(channelId, 'auto');
    if (event.target.closest('.youtube-proxy-btn')) return openChannelSettingsModal(channelId, 'proxy');

    if (event.target.closest('.youtube-remove-channel-btn') && confirm('Xóa kênh này khỏi ProEditor?')) {
      const result = await api().proEditorRemoveChannel(channelId);
      result.success ? await loadChannels() : notify(result.error, 'error');
    }
  });

  // ── Unified Channel Settings Modal (OAuth, Auto, Proxy) ────────────────────
  const channelSettingsModal = document.getElementById('youtube-channel-settings-modal');
  const chSettingsChannelName = document.getElementById('ch-settings-channel-name');
  const chSettingsChannelId = document.getElementById('ch-settings-channel-id');
  const chSettingsJsonBadge = document.getElementById('ch-settings-json-badge');
  const chSettingsJsonProject = document.getElementById('ch-settings-json-project');
  const chSettingsConnectBadge = document.getElementById('ch-settings-connect-badge');
  const chSettingsConnectBtn = document.getElementById('ch-settings-connect-btn');
  const chSettingsDisconnectBtn = document.getElementById('ch-settings-disconnect-btn');
  const chSettingsSelectJsonBtn = document.getElementById('ch-settings-select-json-btn');
  const chSettingsOauthStatus = document.getElementById('ch-settings-oauth-status');

  const autoEnabled = document.getElementById('auto-enabled');
  const autoPrivacy = document.getElementById('auto-privacy');
  const autoRestMinutes = document.getElementById('auto-rest-minutes');
  const autoMaxPerDay = document.getElementById('auto-max-per-day');
  const autoMaxPublicGroup = document.getElementById('auto-max-public-group');
  const autoMaxPublicPerDay = document.getElementById('auto-max-public-per-day');
  const autoIntervalGroup = document.getElementById('auto-interval-group');
  const autoIntervalDays = document.getElementById('auto-interval-days');
  const autoSlotsTitle = document.getElementById('auto-slots-title');
  const autoScheduleGroup = document.getElementById('auto-schedule-group');
  const autoScheduleSlots = document.getElementById('auto-schedule-slots');
  const autoTodayStatus = document.getElementById('auto-today-status');
  const autoModalStatus = document.getElementById('auto-modal-status');

  const proxyEnabledEl = document.getElementById('youtube-proxy-enabled');
  const proxyTypeEl = document.getElementById('youtube-proxy-type');
  const proxyHostEl = document.getElementById('youtube-proxy-host');
  const proxyPortEl = document.getElementById('youtube-proxy-port');
  const proxyUserEl = document.getElementById('youtube-proxy-user');
  const proxyPassEl = document.getElementById('youtube-proxy-pass');
  const proxyStatusEl = document.getElementById('youtube-proxy-status');

  let currentSettingsChannelId = null;
  let currentSettingsYoutubeChannelId = '';

  function switchChannelSettingsTab(tabName) {
    if (!channelSettingsModal) return;
    channelSettingsModal.querySelectorAll('.youtube-settings-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    channelSettingsModal.querySelectorAll('.youtube-settings-pane').forEach(pane => {
      pane.style.display = (pane.id === `ch-tab-${tabName}`) ? 'block' : 'none';
      pane.classList.toggle('active', pane.id === `ch-tab-${tabName}`);
    });
  }

  channelSettingsModal?.querySelectorAll('.youtube-settings-tab').forEach(tab => {
    tab.addEventListener('click', () => switchChannelSettingsTab(tab.dataset.tab));
  });

  const channelSettingsClose = document.getElementById('youtube-channel-settings-close');
  if (channelSettingsClose) {
    channelSettingsClose.addEventListener('click', () => {
      if (channelSettingsModal) channelSettingsModal.style.display = 'none';
    });
  }
  if (channelSettingsModal) {
    channelSettingsModal.addEventListener('click', event => {
      if (event.target === channelSettingsModal) channelSettingsModal.style.display = 'none';
    });
  }

  // 1. Google OAuth Tab Helpers & Listeners
  async function refreshOAuthTabStatus(channelId) {
    if (chSettingsOauthStatus) {
      chSettingsOauthStatus.textContent = '';
      chSettingsOauthStatus.className = 'youtube-manager-status';
    }
    const localStatus = await api().localYoutubeStatus(channelId);
    localChannelState.set(String(channelId), localStatus || {});

    if (localStatus?.configured) {
      chSettingsJsonBadge.className = 'youtube-badge connected';
      chSettingsJsonBadge.textContent = 'Đã cài đặt';
      chSettingsJsonProject.textContent = `Project: ${localStatus.projectId || 'N/A'}`;
      chSettingsConnectBtn.disabled = false;
    } else {
      chSettingsJsonBadge.className = 'youtube-badge';
      chSettingsJsonBadge.textContent = 'Chưa cài đặt';
      chSettingsJsonProject.textContent = '';
      chSettingsConnectBtn.disabled = true;
    }

    if (localStatus?.connected) {
      chSettingsConnectBadge.className = 'youtube-badge connected';
      chSettingsConnectBadge.textContent = `Đã kết nối: ${localStatus.channelTitle || ''}`;
      chSettingsConnectBtn.style.display = 'none';
      chSettingsDisconnectBtn.style.display = 'inline-flex';
    } else {
      chSettingsConnectBadge.className = 'youtube-badge';
      chSettingsConnectBadge.textContent = 'Chưa kết nối';
      chSettingsConnectBtn.style.display = 'inline-flex';
      chSettingsDisconnectBtn.style.display = 'none';
    }
  }

  chSettingsSelectJsonBtn?.addEventListener('click', async () => {
    if (!currentSettingsChannelId) return;
    const result = await api().localYoutubeSelectCredentials(currentSettingsChannelId);
    if (!result.canceled) {
      notify(result.success ? 'Đã lưu OAuth Client JSON an toàn trên máy.' : result.error, result.success ? 'success' : 'error');
      if (chSettingsOauthStatus) {
        chSettingsOauthStatus.textContent = result.success ? 'Đã lưu OAuth Client JSON.' : result.error;
        chSettingsOauthStatus.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
      }
    }
    if (result.success) {
      await refreshOAuthTabStatus(currentSettingsChannelId);
      await loadChannels();
    }
  });

  chSettingsConnectBtn?.addEventListener('click', async () => {
    if (!currentSettingsChannelId) return;
    notify('Đang chờ bạn xác nhận tài khoản Google trên trình duyệt...');
    if (chSettingsOauthStatus) {
      chSettingsOauthStatus.textContent = 'Đang mở trình duyệt để xác thực Google...';
      chSettingsOauthStatus.className = 'youtube-manager-status';
    }
    const result = await api().localYoutubeConnect(currentSettingsChannelId, currentSettingsYoutubeChannelId);
    notify(result.success ? `Đã kết nối local với ${result.channelTitle}.` : result.error, result.success ? 'success' : 'error');
    if (chSettingsOauthStatus) {
      chSettingsOauthStatus.textContent = result.success ? `Đã kết nối thành công với: ${result.channelTitle}` : (result.error || 'Kết nối thất bại.');
      chSettingsOauthStatus.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
    }
    if (result.success) {
      await refreshOAuthTabStatus(currentSettingsChannelId);
      await loadChannels();
    }
  });

  chSettingsDisconnectBtn?.addEventListener('click', async () => {
    if (!currentSettingsChannelId) return;
    if (!confirm('Ngắt OAuth lưu trên máy này?')) return;
    const result = await api().localYoutubeDisconnect(currentSettingsChannelId);
    if (result.success) {
      notify('Đã ngắt kết nối OAuth thành công.', 'success');
      if (chSettingsOauthStatus) {
        chSettingsOauthStatus.textContent = 'Đã ngắt kết nối OAuth.';
        chSettingsOauthStatus.className = 'youtube-manager-status success';
      }
      await refreshOAuthTabStatus(currentSettingsChannelId);
      await loadChannels();
    } else {
      notify(result.error, 'error');
      if (chSettingsOauthStatus) {
        chSettingsOauthStatus.textContent = result.error;
        chSettingsOauthStatus.className = 'youtube-manager-status error';
      }
    }
  });

  // 2. Auto-Upload Tab Helpers & Listeners
  function getSlotTime(slotDiv) {
    return slotDiv.querySelector('.auto-time-input')?.value || '';
  }

  function renderScheduleSlots(count, savedTimes = []) {
    if (!autoScheduleSlots) return;
    autoScheduleSlots.innerHTML = Array.from({ length: count }, (_, i) => `
      <div class="auto-slot-input" data-slot="${i}">
        <label>Video ${i + 1}</label>
        <input type="text" inputmode="numeric" class="auto-time-input settings-input"
               placeholder="HH:MM" maxlength="5" autocomplete="off"
               value="${savedTimes[i] || ''}" />
      </div>`).join('');

    autoScheduleSlots.querySelectorAll('.auto-time-input').forEach(el => {
      el.addEventListener('input', () => {
        const pos = el.selectionStart;
        let v = el.value.replace(/[^0-9]/g, '');
        if (v.length > 4) v = v.slice(0, 4);
        if (v.length > 2) v = v.slice(0, 2) + ':' + v.slice(2);
        el.value = v;
        if (v.length === 3 && pos === 2) el.setSelectionRange(3, 3);
      });
      el.addEventListener('blur', () => {
        const m = el.value.match(/^([0-9]{1,2}):([0-5][0-9])$/);
        if (m) {
          const h = parseInt(m[1]);
          if (h >= 0 && h <= 23) { el.value = String(h).padStart(2, '0') + ':' + m[2]; return; }
        }
        if (el.value) el.value = '';
      });
    });
  }

  function syncSlotsToMax() {
    const n = Math.max(1, Math.min(50, parseInt(autoMaxPublicPerDay?.value) || 2));
    const savedTimes = autoScheduleSlots ? [...autoScheduleSlots.querySelectorAll('.auto-time-input')].map(el => el.value) : [];
    renderScheduleSlots(n, savedTimes);
    if (autoSlotsTitle) {
      autoSlotsTitle.innerHTML = `Mốc giờ đăng <small>(số mốc = ${n} video public/ngày)</small>`;
    }
  }

  function updateScheduleVisibility() {
    const isSchedule = autoPrivacy?.value === 'schedule';
    if (autoScheduleGroup) autoScheduleGroup.style.display = isSchedule ? 'block' : 'none';
    if (autoMaxPublicGroup) autoMaxPublicGroup.style.display = isSchedule ? 'block' : 'none';
    if (autoIntervalGroup) autoIntervalGroup.style.display = isSchedule ? 'block' : 'none';
    if (isSchedule) syncSlotsToMax();
  }

  autoPrivacy?.addEventListener('change', updateScheduleVisibility);
  autoMaxPublicPerDay?.addEventListener('input', () => {
    if (autoPrivacy?.value === 'schedule') syncSlotsToMax();
  });
  autoMaxPublicPerDay?.addEventListener('change', () => {
    if (autoPrivacy?.value === 'schedule') syncSlotsToMax();
  });

  document.getElementById('auto-modal-save')?.addEventListener('click', async () => {
    if (!currentSettingsChannelId) return;
    const isSchedule = autoPrivacy.value === 'schedule';
    const scheduledTimes = isSchedule
      ? [...autoScheduleSlots.querySelectorAll('.auto-slot-input')].map(div => getSlotTime(div)).filter(Boolean)
      : [];
    const maxPublicPerDay = Math.max(1, Math.min(50, parseInt(autoMaxPublicPerDay?.value) || 2));
    const intervalDays = Math.max(1, Math.min(30, parseInt(autoIntervalDays?.value) || 1));
    const config = {
      enabled: autoEnabled.checked,
      privacyStatus: autoPrivacy.value,
      restMinutes: parseInt(autoRestMinutes.value) || 30,
      maxPerDay: parseInt(autoMaxPerDay.value) || 5,
      maxPublicPerDay,
      intervalDays,
      scheduledTimes,
    };
    if (isSchedule && scheduledTimes.length < config.maxPublicPerDay) {
      if (autoModalStatus) {
        autoModalStatus.textContent = `Cần đủ ${config.maxPublicPerDay} mốc giờ cho chế độ Hẹn giờ đăng.`;
        autoModalStatus.className = 'youtube-manager-status error';
      }
      return;
    }
    const result = await api().localYoutubeAutoSave(currentSettingsChannelId, config);
    if (autoModalStatus) {
      autoModalStatus.textContent = result.success ? 'Đã lưu cài đặt tự động upload.' : (result.error || 'Lỗi lưu cài đặt.');
      autoModalStatus.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
    }
    if (result.success) {
      notify('Đã lưu cấu hình tự động upload.', 'success');
      await loadChannels();
    }
  });

  // 3. Proxy Tab Listeners
  document.getElementById('youtube-proxy-save-btn')?.addEventListener('click', async () => {
    if (!currentSettingsChannelId) return;
    const config = {
      enabled: proxyEnabledEl?.checked || false,
      type: proxyTypeEl?.value || 'http',
      host: proxyHostEl?.value.trim() || '',
      port: proxyPortEl?.value.trim() || '',
      user: proxyUserEl?.value.trim() || '',
      pass: proxyPassEl?.value || ''
    };

    if (config.enabled && (!config.host || !config.port)) {
      if (proxyStatusEl) {
        proxyStatusEl.textContent = 'Vui lòng nhập IP/Host và Port khi bật proxy.';
        proxyStatusEl.className = 'youtube-manager-status error';
      }
      return;
    }

    const result = await api().localYoutubeProxySave(currentSettingsChannelId, config);
    if (proxyStatusEl) {
      proxyStatusEl.textContent = result.success ? 'Đã lưu cài đặt Proxy.' : (result.error || 'Lỗi lưu proxy.');
      proxyStatusEl.className = `youtube-manager-status ${result.success ? 'success' : 'error'}`;
    }
    if (result.success) {
      notify('Đã lưu cấu hình Proxy.', 'success');
      await loadChannels();
    }
  });

  document.getElementById('youtube-proxy-test-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('youtube-proxy-test-btn');
    const config = {
      type: proxyTypeEl?.value || 'http',
      host: proxyHostEl?.value.trim() || '',
      port: proxyPortEl?.value.trim() || '',
      user: proxyUserEl?.value.trim() || '',
      pass: proxyPassEl?.value || ''
    };

    if (!config.host || !config.port) {
      if (proxyStatusEl) {
        proxyStatusEl.textContent = 'Vui lòng nhập IP/Host và Port trước khi kiểm tra.';
        proxyStatusEl.className = 'youtube-manager-status error';
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra...';
    if (proxyStatusEl) {
      proxyStatusEl.textContent = 'Đang gọi thử tới api.ipify.org qua proxy...';
      proxyStatusEl.className = 'youtube-manager-status';
    }

    const result = await api().localYoutubeProxyTest(config);
    btn.disabled = false;
    btn.textContent = 'Kiểm tra Proxy';

    if (proxyStatusEl) {
      if (result.success) {
        proxyStatusEl.textContent = `✅ Proxy hoạt động. IP trả về: ${result.ip}`;
        proxyStatusEl.className = 'youtube-manager-status success';
      } else {
        proxyStatusEl.textContent = `❌ Lỗi: ${result.error}`;
        proxyStatusEl.className = 'youtube-manager-status error';
      }
    }
  });

  // Open Unified Channel Settings Modal
  async function openChannelSettingsModal(channelId, initialTab = 'oauth') {
    if (!channelSettingsModal) return;
    currentSettingsChannelId = channelId;

    const row = channelBody.querySelector(`[data-channel-id="${channelId}"]`);
    const channelName = row?.querySelector('strong')?.textContent || channelId;
    currentSettingsYoutubeChannelId = row?.querySelector('.youtube-muted')?.textContent || '';

    if (chSettingsChannelName) chSettingsChannelName.textContent = channelName;
    if (chSettingsChannelId) chSettingsChannelId.textContent = currentSettingsYoutubeChannelId ? `YouTube ID: ${currentSettingsYoutubeChannelId}` : '';

    // Switch tab first so user sees it right away
    switchChannelSettingsTab(initialTab);
    channelSettingsModal.style.display = 'flex';

    // 1. Tab OAuth
    await refreshOAuthTabStatus(channelId);

    // 2. Tab Auto
    if (autoModalStatus) {
      autoModalStatus.textContent = '';
      autoModalStatus.className = 'youtube-manager-status';
    }
    const autoCfg = await api().localYoutubeAutoGet(channelId).catch(() => ({})) || {};
    if (autoEnabled) autoEnabled.checked = !!autoCfg.enabled;
    if (autoPrivacy) autoPrivacy.value = autoCfg.privacyStatus || 'private';
    if (autoRestMinutes) autoRestMinutes.value = autoCfg.restMinutes ?? 30;
    if (autoMaxPerDay) autoMaxPerDay.value = autoCfg.maxPerDay ?? 5;
    const maxPublic = autoCfg.maxPublicPerDay ?? 2;
    if (autoMaxPublicPerDay) autoMaxPublicPerDay.value = maxPublic;
    const intervalDays = autoCfg.intervalDays ?? 1;
    if (autoIntervalDays) autoIntervalDays.value = intervalDays;

    const isSchedule = autoCfg.privacyStatus === 'schedule';
    if (autoScheduleGroup) autoScheduleGroup.style.display = isSchedule ? 'block' : 'none';
    if (autoMaxPublicGroup) autoMaxPublicGroup.style.display = isSchedule ? 'block' : 'none';
    if (autoIntervalGroup) autoIntervalGroup.style.display = isSchedule ? 'block' : 'none';
    renderScheduleSlots(maxPublic, autoCfg.scheduledTimes || []);
    if (autoSlotsTitle) {
      autoSlotsTitle.innerHTML = `Mốc giờ đăng <small>(số mốc = ${maxPublic} video public/ngày)</small>`;
    }
    if (autoCfg.enabled !== undefined && autoTodayStatus) {
      const lastAtStr = autoCfg.lastAt ? new Date(autoCfg.lastAt).toLocaleTimeString('vi-VN') : 'chưa có';
      autoTodayStatus.style.display = 'block';
      autoTodayStatus.textContent = `Hôm nay đã upload: ${autoCfg.todayCount || 0}/${autoCfg.maxPerDay || 5} video. Lần cuối: ${lastAtStr}. ${autoCfg.enabled ? '▶ Đang hoạt động.' : '⏸ Tự động upload chưa bật.'}`;
    } else if (autoTodayStatus) {
      autoTodayStatus.style.display = 'none';
    }

    // 3. Tab Proxy
    if (proxyStatusEl) {
      proxyStatusEl.textContent = '';
      proxyStatusEl.className = 'youtube-manager-status';
    }
    const proxyCfg = await api().localYoutubeProxyGet(channelId).catch(() => ({})) || {};
    if (proxyEnabledEl) proxyEnabledEl.checked = !!proxyCfg.enabled;
    if (proxyTypeEl) proxyTypeEl.value = proxyCfg.type || 'http';
    if (proxyHostEl) proxyHostEl.value = proxyCfg.host || '';
    if (proxyPortEl) proxyPortEl.value = proxyCfg.port || '';
    if (proxyUserEl) proxyUserEl.value = proxyCfg.user || '';
    if (proxyPassEl) proxyPassEl.value = proxyCfg.pass || '';
  }

  function openProxyModal(channelId) {
    return openChannelSettingsModal(channelId, 'proxy');
  }

  function openAutoModal(channelId) {
    return openChannelSettingsModal(channelId, 'auto');
  }

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
    // Cancel upload button embedded in row progress bar
    const cancelBtn = event.target.closest('.yt-cancel-btn');
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Đang hủy...';
      await api().localYoutubeCancelUpload();
      return;
    }
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

  // Update inline progress on the specific video row that is being uploaded.
  function updateRowProgress(videoId, stage, percent) {
    const row = videoModalBody.querySelector(`tr[data-video-id="${videoId}"]`);
    if (!row) return;

    // Update status badge in "Trạng thái" column
    const statusCell = row.querySelector('.youtube-status-cell');
    if (statusCell) {
      const badge = statusCell.querySelector('.youtube-badge');
      if (badge && !badge.classList.contains('status-UPLOADING')) {
        badge.className = 'youtube-badge status-UPLOADING';
        badge.textContent = 'Đang upload';
      }
    }

    const cell = row.querySelector('.youtube-action-cell');
    if (!cell) return;
    const labels = {
      download: '↓ Tải video',
      upload: '↑ Upload YT',
      'thumbnail-download': '↓ Thumbnail',
      'thumbnail-upload': '↑ Thumbnail',
    };
    const pct = Math.round(percent || 0);
    const label = labels[stage] || 'Đang xử lý';

    // First call: build DOM structure once so elements stay mounted
    let progressDiv = cell.querySelector('.yt-upload-progress');
    if (!progressDiv) {
      cell.innerHTML = `
        <div class="yt-upload-progress">
          <div class="yt-upload-top">
            <span class="yt-upload-stage"></span>
            <button class="yt-cancel-btn" data-video-id="${videoId}" title="Hủy upload">⏹ Hủy</button>
          </div>
          <div class="yt-upload-bar"><div class="yt-upload-fill"></div></div>
        </div>`;
      progressDiv = cell.querySelector('.yt-upload-progress');
    }

    // Subsequent calls: only update text & width so cancel button isn't recreated
    const stageEl = progressDiv.querySelector('.yt-upload-stage');
    if (stageEl) stageEl.textContent = `${label}: ${pct}%`;
    const fillEl = progressDiv.querySelector('.yt-upload-fill');
    if (fillEl) fillEl.style.width = `${pct}%`;
  }

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
    // Immediate visual feedback on the video row
    updateRowProgress(String(video._id), 'download', 0);
    const uploadVideo = { ...video, youtubeUploadOptions: { privacyStatus: publishPrivacy.value, publishAt } };
    const result = await api().localYoutubeUpload(channelId, uploadVideo);
    const successMessage = result.thumbnailError
      ? `Video đã upload với tiêu đề AI nhưng thumbnail lỗi: ${result.thumbnailError}`
      : `Đã upload thành công lên YouTube: ${result.youtubeUrl} (Đã tự động dọn dẹp video & thumbnail tạm)`;
    notify(result.success ? successMessage : result.error, result.success ? (result.thumbnailError ? 'warning' : 'success') : 'error');
    button.disabled = false;
    button.textContent = 'Bắt đầu upload';
    pendingUpload = null;
    await showVideos(channelId, page);
  });

  api().onLocalYoutubeUploadProgress(data => {
    if (data.stage === 'thumbnail-warning') return notify(data.message, 'warning');
    const pct = Math.round(data.percent || 0);
    if (data.videoId) {
      updateRowProgress(String(data.videoId), data.stage, pct);
    } else {
      const labels = {
        download: 'Đang tải video về máy',
        upload: 'Đang upload video từ máy lên YouTube',
        'thumbnail-download': 'Đang tải thumbnail AI về máy',
        'thumbnail-upload': 'Đang upload thumbnail AI lên YouTube',
      };
      notify(`${labels[data.stage] || 'Đang xử lý'}: ${pct}%`);
    }
  });

  const autoToggleBtn = document.getElementById('youtube-auto-toggle-btn');
  const autoToggleText = document.getElementById('youtube-auto-toggle-text');
  const autoLoopBadge = document.getElementById('youtube-auto-loop-badge');
  const autoLogStatusBadge = document.getElementById('youtube-auto-log-status-badge');
  let isAutoLoopActive = false;

  function updateAutoLoopUI(state) {
    if (!state) return;
    isAutoLoopActive = !!state.active;
    const { active, running } = state;

    if (autoToggleBtn) {
      autoToggleBtn.className = active ? 'btn-auto-toggle state-running' : 'btn-auto-toggle state-stopped';
      autoToggleBtn.title = active ? 'Nhấn để dừng luồng tự động upload' : 'Nhấn để bắt đầu luồng tự động upload';
    }
    if (autoToggleText) {
      if (!active) {
        autoToggleText.textContent = 'Bắt đầu Auto Upload';
      } else if (running) {
        autoToggleText.textContent = 'Dừng Auto (Đang xử lý...)';
      } else {
        autoToggleText.textContent = 'Dừng Auto Upload';
      }
    }
    if (autoLoopBadge) {
      autoLoopBadge.className = active ? 'youtube-badge connected' : 'youtube-badge';
      autoLoopBadge.textContent = active ? (running ? '⚡ Auto: Đang upload...' : '⚡ Auto: Đang hoạt động') : 'Auto: Chưa chạy';
    }
    if (autoLogStatusBadge) {
      autoLogStatusBadge.className = active ? 'youtube-badge connected' : 'youtube-badge';
      autoLogStatusBadge.textContent = active ? (running ? '⚡ Đang upload...' : '⚡ Đang hoạt động') : 'Chưa chạy';
    }
  }

  autoToggleBtn?.addEventListener('click', async () => {
    if (autoToggleBtn.disabled) return;
    autoToggleBtn.disabled = true;
    try {
      if (!isAutoLoopActive) {
        const res = await api().localYoutubeAutoLoopStart();
        if (res?.success) {
          notify('Đã khởi động luồng Auto Upload chung cho tất cả các kênh.', 'success');
          updateAutoLoopUI({ active: true, running: false });
        } else {
          notify(res?.error || 'Không thể khởi động Auto Upload.', 'error');
        }
      } else {
        const res = await api().localYoutubeAutoLoopStop();
        if (res?.success) {
          notify('Đã dừng luồng Auto Upload.', 'info');
          updateAutoLoopUI({ active: false, running: false });
        } else {
          notify(res?.error || 'Lỗi khi dừng Auto Upload.', 'error');
        }
      }
    } catch (err) {
      notify(`Lỗi: ${err.message}`, 'error');
    } finally {
      autoToggleBtn.disabled = false;
    }
  });

  api().onLocalYoutubeAutoLoopChanged?.(state => {
    updateAutoLoopUI(state);
  });

  api().localYoutubeAutoLoopStatus?.().then(st => {
    updateAutoLoopUI(st);
  }).catch(() => {});

  document.getElementById('youtube-auto-log-btn').addEventListener('click', openAutoLogModal);
  document.getElementById('youtube-refresh-btn').addEventListener('click', loadChannels);
  document.getElementById('th-furthest-schedule')?.addEventListener('click', toggleScheduleSort);
  document.getElementById('th-channel-work-status')?.addEventListener('click', toggleWorkStatusSort);
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

  // ── Upload History Modal ───────────────────────────────────────────────────
  const historyModal = document.getElementById('youtube-history-modal');
  const historyTitle = document.getElementById('youtube-history-title');
  const historySubtitle = document.getElementById('youtube-history-subtitle');
  const historyBody = document.getElementById('youtube-history-body');
  const historyClose = document.getElementById('youtube-history-close');

  if (historyClose) {
    historyClose.addEventListener('click', () => { historyModal.style.display = 'none'; });
  }
  if (historyModal) {
    historyModal.addEventListener('click', event => {
      if (event.target === historyModal) historyModal.style.display = 'none';
    });
  }

  async function openHistoryModal(channelId) {
    if (!historyModal) return;
    historyModal.style.display = 'flex';
    historyBody.innerHTML = '<div class="youtube-loading">Đang tải lịch sử upload...</div>';

    const channelRow = channelBody.querySelector(`tr[data-channel-id="${channelId}"]`);
    const channelName = channelRow?.querySelector('strong')?.textContent || 'Kênh YouTube';

    historyTitle.textContent = `📜 Lịch sử Upload — ${channelName}`;
    historySubtitle.textContent = 'Đang tải dữ liệu...';

    const result = await api().localYoutubeUploadHistory(channelId);
    if (!result.success) {
      historyBody.innerHTML = `<div class="auto-log-empty" style="color:var(--error);">${escapeHtml(result.error || 'Không tải được lịch sử')}</div>`;
      historySubtitle.textContent = '';
      return;
    }

    const items = result.history || [];
    if (!items.length) {
      historySubtitle.textContent = 'Tổng cộng: 0 video đã upload';
      historyBody.innerHTML = `
        <div class="youtube-history-empty">
          <div style="font-size:36px;margin-bottom:8px;">📭</div>
          <p>Kênh này chưa có lịch sử upload video nào.</p>
        </div>`;
      return;
    }

    historySubtitle.textContent = `Tổng cộng: ${items.length} video đã upload`;

    const groups = new Map();
    const todayStr = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    for (const item of items) {
      const dt = item.uploadedAt ? new Date(item.uploadedAt) : null;
      let dateLabel = 'Chưa xác định ngày';
      if (dt && !isNaN(dt.getTime())) {
        const dtDateStr = dt.toDateString();
        const dateFormatted = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
        if (dtDateStr === todayStr) {
          dateLabel = `Hôm nay (${dateFormatted})`;
        } else if (dtDateStr === yesterdayStr) {
          dateLabel = `Hôm qua (${dateFormatted})`;
        } else {
          dateLabel = `Ngày ${dateFormatted}`;
        }
      }
      if (!groups.has(dateLabel)) {
        groups.set(dateLabel, []);
      }
      groups.get(dateLabel).push(item);
    }

    const PRIVACY_LABELS = {
      public: 'Công khai',
      private: 'Riêng tư',
      unlisted: 'Không công khai',
      schedule: 'Hẹn giờ'
    };

    let html = '';
    for (const [dateLabel, groupItems] of groups.entries()) {
      html += `
        <div class="youtube-history-group">
          <div class="youtube-history-date-header">
            <span>📅 ${escapeHtml(dateLabel)}</span>
            <span class="youtube-history-date-count">${groupItems.length} video</span>
          </div>
          <div class="youtube-history-list">
            ${groupItems.map(item => {
              const dt = item.uploadedAt ? new Date(item.uploadedAt) : null;
              const timeStr = dt && !isNaN(dt.getTime())
                ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
                : '--:--';
              const modeBadge = item.mode === 'AUTO'
                ? '<span class="youtube-badge" style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-size:10px;">⚡ Tự động</span>'
                : '<span class="youtube-badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;font-size:10px;">👤 Thủ công</span>';
              const privacy = String(item.privacyStatus || 'private').toLowerCase();
              const privacyText = PRIVACY_LABELS[privacy] || privacy;
              return `
                <div class="youtube-history-item">
                  <div class="youtube-history-time-col">
                    <span class="youtube-history-time">${timeStr}</span>
                    ${modeBadge}
                  </div>
                  <div class="youtube-history-info">
                    <div class="youtube-history-video-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                    <div class="youtube-history-meta">
                      <span class="youtube-badge status-UPLOAD_SUCCESS" style="font-size:10px;padding:1px 6px;">Đã upload</span>
                      <span style="font-size:11px;color:var(--gray-500);">${escapeHtml(privacyText)}</span>
                      ${item.youtubeVideoId ? `<span class="youtube-muted" style="font-size:11px;">ID: ${escapeHtml(item.youtubeVideoId)}</span>` : ''}
                    </div>
                  </div>
                  <div class="youtube-history-actions">
                    ${item.youtubeUrl ? `
                      <button class="btn-action btn-view youtube-open-history-link" data-url="${escapeHtml(item.youtubeUrl)}" title="Mở video trên YouTube">🔗 Mở video</button>
                      <button class="btn-action btn-copy youtube-copy-history-link" data-url="${escapeHtml(item.youtubeUrl)}" title="Sao chép link YouTube">📋 Copy link</button>
                    ` : '—'}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    historyBody.innerHTML = html;

    historyBody.querySelectorAll('.youtube-open-history-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        if (url) api().openExternal(url);
      });
    });

    historyBody.querySelectorAll('.youtube-copy-history-link').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
          notify('Đã sao chép link YouTube vào clipboard!', 'success');
        } catch (_) {
          notify(url, 'info');
        }
      });
    });
  }

  api().proEditorSession().then(session => {
    setAuthenticated(session.authenticated, session.user);
    if (session.authenticated) {
      loadStorageSettings();
      loadChannels();
    }
  });
}
