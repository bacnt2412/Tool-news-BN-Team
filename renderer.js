// ============================================
// LICENSE CHECK - Must run first before anything else
// ============================================
(async function checkLicenseOnStartup() {
    const licenseModal = document.getElementById('license-modal');
    const licenseLoading = document.getElementById('license-loading');
    const licenseDenied = document.getElementById('license-denied');
    const licenseMacDisplay = document.getElementById('license-mac-display');
    const licenseCopyBtn = document.getElementById('license-copy-btn');
    const licenseRetryBtn = document.getElementById('license-retry-btn');
    const appContainer = document.querySelector('.container');

    // Show license modal
    licenseModal.style.display = 'flex';

    // Hide app container until license is verified
    if (appContainer) {
        appContainer.style.display = 'none';
    }

    async function performLicenseCheck() {
        try {
            // Reset UI
            licenseLoading.style.display = 'block';
            licenseDenied.style.display = 'none';

            // Check license from GitHub
            let result = await window.electronAPI.checkLicense();
            if (!result.success) {
                result = await window.electronAPI.checkLicense();
            }
            if (!result.success) {
                result = await window.electronAPI.checkLicense();
            }
            if (!result.success) {
                result = await window.electronAPI.checkLicense();
            }
            if (!result.success) {
                result = await window.electronAPI.checkLicense();
            }
            if (result.success) {
                // License valid - hide modal and show app
                console.log('License verified successfully');
                licenseModal.style.display = 'none';
                if (appContainer) {
                    appContainer.style.display = 'block';
                }

                // Load config from main process
                try {
                    window.APP_CONFIG = await window.electronAPI.getConfig();
                    console.log('Config loaded:', window.APP_CONFIG);
                } catch (error) {
                    console.error('Failed to load config:', error);
                    // Set default config if loading fails
                    window.APP_CONFIG = {
                        MAX_TTS_CONCURRENT: 2,
                        MAX_CONCURRENT_VIDEO_PROCESSING: 5,
                        MAX_CONCURRENT_DOWNLOADS: 5,
                        DEFAULT_MAX_SENTENCE_LENGTH: 120,
                        AUTO_SPLIT_SENTENCES_DEFAULT: true
                    };
                }

                // Auto-sync cookies and settings from GitHub (if enabled in config)
                if (window.APP_CONFIG && window.APP_CONFIG.AUTO_SYNC_ENABLED) {
                    console.log('🔄 Auto-sync enabled, syncing from GitHub...');
                    try {
                        const syncResult = await window.electronAPI.syncFromGitHub();
                        if (syncResult.success) {
                            console.log('GitHub sync successful:', syncResult.message);
                            // Show success toast if both cookies and settings synced
                            if (syncResult.details.cookies.success && syncResult.details.settings.success) {
                                // Auto-refresh settings if modal is open
                                if (settingsModal && settingsModal.style.display === 'flex') {
                                    loadSettings();
                                    showToast('Đã đồng bộ cookies và settings từ GitHub và refresh Settings.', 'success', 3000);
                                } else {
                                    showToast('Đã đồng bộ cookies và settings từ GitHub', 'success', 3000);
                                }
                            } else {
                                // Partial success
                                const messages = [];
                                if (syncResult.details.cookies.success) messages.push('cookies');
                                if (syncResult.details.settings.success) messages.push('settings');
                                if (messages.length > 0) {
                                    showToast(`⚠️ Đã đồng bộ ${messages.join(', ')} từ GitHub`, 'info', 3000);
                                }
                            }
                        } else {
                            console.warn('⚠️ GitHub sync failed:', syncResult.message);
                            // Get detailed error messages from both cookies and settings
                            let errorMessages = [];
                            if (syncResult.details) {
                                if (syncResult.details.cookies && !syncResult.details.cookies.success) {
                                    errorMessages.push(`Cookies: ${syncResult.details.cookies.message}`);
                                }
                                if (syncResult.details.settings && !syncResult.details.settings.success) {
                                    errorMessages.push(`Settings: ${syncResult.details.settings.message}`);
                                }
                            }
                            // If no specific errors found, use general message
                            let detailedError = errorMessages.length > 0 ? errorMessages.join('\n') : syncResult.message;
                            // Show blocking modal for sync failure - app cannot be used
                            showSyncErrorModal(detailedError);
                            return; // Stop further execution
                        }
                    } catch (error) {
                        console.error('❌ GitHub sync error:', error);
                    }
                } else {
                    console.log('Auto-sync disabled in config');
                }

                // Auto check for updates after license verified
                setTimeout(() => {
                    console.log('Auto-checking for app updates...');
                    if (window.electronAPI && window.electronAPI.checkForUpdates) {
                        window.electronAPI.checkForUpdates().catch(err => {
                            console.error('Auto update check failed:', err);
                        });
                    }
                }, 3000); // Wait 3 seconds after app loads

            } else {
                // License denied - show error with MAC address
                console.log('License check failed:', result.message);
                licenseLoading.style.display = 'none';
                licenseDenied.style.display = 'block';
                licenseMacDisplay.textContent = result.macAddress || 'UNKNOWN';

                // Keep app container hidden
            }
        } catch (error) {
            console.error('License check error:', error);
            // Show error
            licenseLoading.style.display = 'none';
            licenseDenied.style.display = 'block';
            const macAddress = await window.electronAPI.getMacAddress();
            licenseMacDisplay.textContent = macAddress || 'UNKNOWN';
        }
    }

    // Copy MAC address button
    licenseCopyBtn.addEventListener('click', async () => {
        const macAddress = licenseMacDisplay.textContent;
        try {
            await window.electronAPI.copyToClipboard(macAddress);
            licenseCopyBtn.textContent = 'Đã copy!';
            setTimeout(() => {
                licenseCopyBtn.innerHTML = '📋 Copy MAC Address';
            }, 2000);
        } catch (error) {
            console.error('Copy failed:', error);
        }
    });

    // Retry button
    licenseRetryBtn.addEventListener('click', () => {
        performLicenseCheck();
    });

    // Perform initial check
    await performLicenseCheck();
})();

// ============================================
// SYNC ERROR MODAL - Blocking modal when sync (cookies/settings) fails
// ============================================
let appDisabled = false;

function showSyncErrorModal(errorMessage) {
    const modal = document.getElementById('sync-error-modal');
    const errorMsgElement = document.getElementById('sync-error-message');
    const retryBtn = document.getElementById('sync-retry-btn');
    const appContainer = document.querySelector('.container');

    // Set error message
    if (errorMsgElement) {
        errorMsgElement.textContent = errorMessage || 'Báo cho Admin cài settings';
    }

    // Disable app
    appDisabled = true;
    if (appContainer) {
        appContainer.style.pointerEvents = 'none';
        appContainer.style.opacity = '0.3';
        appContainer.style.userSelect = 'none';
    }

    // Disable all buttons and inputs
    disableAppElements();

    // Show modal
    if (modal) {
        modal.style.display = 'flex';
    }

    // Retry button handler
    if (retryBtn) {
        retryBtn.onclick = async () => {
            try {
                // Hide modal temporarily
                modal.style.display = 'none';

                // Try to sync again
                const syncResult = await window.electronAPI.syncFromGitHub();

                if (syncResult.success) {
                    // Success - re-enable app
                    hideSyncErrorModal();

                    // Auto-refresh settings if modal is open
                    if (settingsModal && settingsModal.style.display === 'flex') {
                        loadSettings();
                        showToast('Đã đồng bộ thành công và refresh Settings.', 'success', 3000);
                    } else {
                        showToast('Đã đồng bộ thành công. Mở Settings để xem cookies mới.', 'success', 5000);
                    }
                } else {
                    // Still failed - show modal again with detailed errors
                    let errorMessages = [];
                    if (syncResult.details) {
                        if (syncResult.details.cookies && !syncResult.details.cookies.success) {
                            errorMessages.push(`Cookies: ${syncResult.details.cookies.message}`);
                        }
                        if (syncResult.details.settings && !syncResult.details.settings.success) {
                            errorMessages.push(`Settings: ${syncResult.details.settings.message}`);
                        }
                    }
                    let detailedError = errorMessages.length > 0 ? errorMessages.join('\n') : syncResult.message;
                    showSyncErrorModal(detailedError);
                }
            } catch (error) {
                console.error('Retry sync failed:', error);
                showSyncErrorModal(`Lỗi kết nối server: ${error.message}`);
            }
        };
    }
}

function hideSyncErrorModal() {
    const modal = document.getElementById('sync-settings-error-modal');
    const appContainer = document.querySelector('.container');

    // Re-enable app
    appDisabled = false;
    if (appContainer) {
        appContainer.style.pointerEvents = 'auto';
        appContainer.style.opacity = '1';
        appContainer.style.userSelect = 'auto';
    }

    // Re-enable all buttons and inputs
    enableAppElements();

    // Hide modal
    if (modal) {
        modal.style.display = 'none';
    }
}

function disableAppElements() {
    // Disable all buttons
    const buttons = document.querySelectorAll('button:not(#sync-retry-btn)');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    });

    // Disable all inputs and textareas
    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.disabled = true;
        input.style.opacity = '0.5';
    });
}

function enableAppElements() {
    // Re-enable all buttons
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });

    // Re-enable all inputs and textareas
    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.disabled = false;
        input.style.opacity = '1';
    });
}

// DOM Elements
const videoUrlsTextarea = document.getElementById('video-urls');
const processBtn = document.getElementById('process-btn');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultsSection = document.getElementById('results-section');
const resultsBody = document.getElementById('results-body');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const appVersionSpan = document.getElementById('app-version');
const checkUpdateBtn = document.getElementById('check-update-btn');

// Settings elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
const visionApiKeyInput = document.getElementById('vision-api-key');
const visionEndpointInput = document.getElementById('vision-endpoint');
const googleVisionApiKeyInput = document.getElementById('google-vision-api-key');
const googleTtsApiKeyInput = document.getElementById('google-tts-api-key');
const ocrProviderMicrosoft = document.getElementById('ocr-provider-microsoft');
const ocrProviderGoogle = document.getElementById('ocr-provider-google');
const ytDlpCookiesInput = document.getElementById('yt-dlp-cookies');
const settingsStatus = document.getElementById('settings-status');

// yt-dlp update notification elements
const ytDlpNotification = document.getElementById('yt-dlp-notification');
const notificationIcon = document.getElementById('notification-icon');
const notificationTitle = document.getElementById('notification-title');
const notificationMessage = document.getElementById('notification-message');
const notificationProgress = document.getElementById('notification-progress');
const progressFillSmall = document.getElementById('progress-fill-small');
const notificationActions = document.getElementById('notification-actions');
const updateYtDlpBtn = document.getElementById('update-yt-dlp-btn');
const dismissNotificationBtn = document.getElementById('dismiss-notification-btn');
const closeNotificationBtn = document.getElementById('close-notification');

// Toast notification container
const toastContainer = document.getElementById('toast-container');

let results = [];

// Subtitle viewer functions - defined early to be available for inline onclick handlers
// Đóng modal xem subtitle
window.closeSubtitleViewerModal = function () {
    const modal = document.getElementById('subtitle-viewer-modal');
    const video = document.getElementById('subtitle-viewer-video');
    if (modal) {
        modal.style.display = 'none';
    }
    if (video) {
        video.pause();
        video.src = '';
    }
};

// Seek video to subtitle time
window.seekToSubtitleTime = function (seconds) {
    const video = document.getElementById('subtitle-viewer-video');
    if (video) {
        // If metadata is not loaded yet, wait for it before setting currentTime
        if (isNaN(video.duration) || video.readyState < 1) {
            const onLoaded = () => {
                try {
                    video.currentTime = Math.max(0, seconds + 0.05);
                } catch (e) {
                    console.warn('Failed to set currentTime on loadedmetadata:', e);
                }
                // video.play().catch(err => console.warn('Play failed:', err));
                video.removeEventListener('loadedmetadata', onLoaded);
            };
            video.addEventListener('loadedmetadata', onLoaded);
            // also try to call play once to allow user gesture on some platforms
            // video.play().catch(() => {});
        } else {
            try {
                video.currentTime = Math.max(0, seconds + 0.05);
            } catch (e) {
                console.warn('Failed to set currentTime:', e);
            }
            // video.play().catch(err => console.warn('Play failed:', err));
        }

        // Highlight entry
        const entries = document.querySelectorAll('.subtitle-entry');
        entries.forEach(entry => {
            const entryStart = parseFloat(entry.dataset.start);
            if (Math.abs(entryStart - seconds) < 0.1) {
                entry.style.backgroundColor = '#d4edda';
                entry.style.borderLeftColor = '#28a745';
                setTimeout(() => {
                    entry.style.backgroundColor = '';
                    entry.style.borderLeftColor = '';
                }, 2000);
            }
        });
    }
};

import { setupInfoListeners } from './renderer.info.js';
import { setupDownloadListeners } from './renderer.download.js';
import { setupVideoTextListeners } from './renderer.videotext.js';

// Load settings khi trang load
window.addEventListener('DOMContentLoaded', async () => {

    // Expose key handler functions to modules via window (modules will call these)
    window.handleProcess = handleProcess;
    window.copyAllVideosData = copyAllVideosData;
    window.openThumbnailDownloadModal = openThumbnailDownloadModal;
    window.openSettings = openSettings;
    window.closeSettings = closeSettings;
    window.saveSettings = saveSettings;

    window.openVideoTextModal = openVideoTextModal;
    window.closeVideoTextModal = closeVideoTextModalFunc;

    // Register grouped event listeners from modules
    setupInfoListeners();
    await setupDownloadListeners();
    setupVideoTextListeners();
    setupTtsListeners();

    await loadSettings();

    // Initialize tab-specific setups
    initInfoTab();
    await initDownloadTab();
    initVideoTextTab();
    initTtsTab();

    setupYtDlpUpdateListeners();

    // Setup app update listeners
    setupAppUpdateListeners();

    // Check yt-dlp ngay khi load
    checkYtDlpOnStartup();
});

// Initialize Info tab (Lấy thông tin)
function initInfoTab() {
    // Ensure results section hidden until data available
    if (resultsSection) resultsSection.style.display = 'none';
}

// Initialize Download tab
async function initDownloadTab() {
    // Load download settings and ensure UI sync
    await loadDownloadSettings();
}

// Initialize Video -> Text tab
function initVideoTextTab() {
    // Register listener to receive VideoSubFinder progress events
    if (typeof setupVideoSubtitleProgressListener === 'function') {
        try {
            setupVideoSubtitleProgressListener();
        } catch (e) {
            console.warn('initVideoTextTab: setupVideoSubtitleProgressListener failed', e);
        }
    }
}

// Initialize TTS tab
function initTtsTab() {
    // No-op for now; setupTtsListeners will populate UI when ready
}

// Setup listeners and handlers for TTS UI
function setupTtsListeners() {
    // Elements
    const ttsConfigSelect = document.getElementById('tts-config-select');
    const ttsAddConfigBtn = document.getElementById('tts-add-config-btn');
    const ttsEditConfigBtn = document.getElementById('tts-edit-config-btn');
    const ttsDeleteConfigBtn = document.getElementById('tts-delete-config-btn');
    const ttsFileNameInput = document.getElementById('tts-file-name');
    const ttsTextInput = document.getElementById('tts-text');
    const ttsSynthesizeBtn = document.getElementById('tts-synthesize-btn');
    const ttsAutoSplitCheckbox = document.getElementById('tts-auto-split-sentences');
    const ttsMaxSentenceLengthInput = document.getElementById('tts-max-sentence-length');
    const ttsSaveFolderInput = document.getElementById('tts-save-folder');
    const ttsSelectFolderBtn = document.getElementById('tts-select-folder-btn');
    const ttsResult = document.getElementById('tts-result');
    const ttsQueueSection = document.getElementById('tts-queue-section');
    const ttsQueueBody = document.getElementById('tts-queue-body');

    // TTS queue state
    let ttsQueue = [];
    let ttsActiveCount = 0;
    const MAX_TTS_CONCURRENT = window.APP_CONFIG?.MAX_TTS_CONCURRENT || 2; // Chỉ xử lý X bài đồng thời (config trong config.js)
    let ttsTaskCounter = 1;

    if (!ttsConfigSelect) return;

    async function loadConfigs() {
        try {
            const res = await window.electronAPI.getTtsConfigs();
            if (res && res.success) {
                const configs = res.configs || [];
                // Clear select
                ttsConfigSelect.innerHTML = '';
                // Add default placeholder
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '-- Chọn config --';
                ttsConfigSelect.appendChild(placeholder);

                configs.forEach(cfg => {
                    const opt = document.createElement('option');
                    opt.value = cfg.id;
                    opt.textContent = `${cfg.name} (${cfg.provider})`;
                    ttsConfigSelect.appendChild(opt);
                });

                // Auto-select last selected config from settings
                try {
                    const settings = await window.electronAPI.getSettings();
                    if (settings && settings.lastSelectedTtsConfigId) {
                        // Check if the config still exists
                        const configExists = configs.some(c => String(c.id) === String(settings.lastSelectedTtsConfigId));
                        if (configExists) {
                            ttsConfigSelect.value = settings.lastSelectedTtsConfigId;
                            console.log('Auto-selected TTS config:', settings.lastSelectedTtsConfigId);
                        }
                    }
                } catch (err) {
                    console.warn('Could not restore last selected TTS config:', err);
                }
            }
        } catch (err) {
            console.error('Error loading TTS configs:', err);
        }
    }

    function ensureQueueVisible() {
        if (!ttsQueueSection) return;
        ttsQueueSection.style.display = (ttsQueue && ttsQueue.length > 0) ? 'block' : 'none';
    }

    function addTtsToQueue(task) {
        task.id = task.id || (`tts-${Date.now()}-${ttsTaskCounter++}`);
        task.status = 'waiting';
        task.attempts = task.attempts || 0;
        task.startTime = null;
        task.endTime = null;
        task.duration = null;
        ttsQueue.push(task);
        renderTtsQueue();
        processNextTts();
    }

    function renderTtsQueue() {
        if (!ttsQueueBody) return;
        ttsQueueBody.innerHTML = '';
        ttsQueue.forEach((task, idx) => {
            // Ensure startTime is set if task is processing but doesn't have it yet
            if (task.status === 'processing' && !task.startTime) {
                task.startTime = Date.now();
                console.log('Setting startTime in renderTtsQueue for processing task:', task.id);
            }

            const row = document.createElement('tr');
            row.id = `tts-queue-row-${task.id}`;

            // Calculate progress percentage first
            let progressPercent = 0;
            let progressClass = task.status;

            if (task.status === 'waiting') {
                progressPercent = 0;
            } else if (task.status === 'processing') {
                if (task.sentenceProgress) {
                    // Parse "5/20" format
                    const match = task.sentenceProgress.match(/(\d+)\/(\d+)/);
                    if (match) {
                        const current = parseInt(match[1]);
                        const total = parseInt(match[2]);
                        progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;
                    } else {
                        progressPercent = 0; // No valid progress yet
                    }
                } else {
                    progressPercent = 0; // No progress data yet, start at 0%
                }
            } else if (task.status === 'completed') {
                progressPercent = 100;
            } else if (task.status === 'error') {
                progressPercent = 0;
            }

            // Format duration helper (local to this function)
            function formatDuration(seconds) {
                if (!seconds || seconds < 0) return '';
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);

                if (hours > 0) {
                    return `${hours}h ${minutes}m ${secs}s`;
                } else if (minutes > 0) {
                    return `${minutes}m ${secs}s`;
                } else {
                    return `${secs}s`;
                }
            }

            // Build status text with progress percentage
            let statusText = '';
            if (task.status === 'waiting') {
                statusText = 'Đang chờ';
            } else if (task.status === 'processing') {
                statusText = `Đang xử lý: ${progressPercent}%`;
            } else if (task.status === 'completed') {
                // Calculate duration: prefer stored duration, then calculate from times
                let duration = task.duration;
                if (!duration && task.endTime && task.startTime) {
                    duration = (task.endTime - task.startTime) / 1000;
                }
                if (duration && duration > 0) {
                    const durationText = formatDuration(duration);
                    statusText = `Hoàn thành trong ${durationText}`;
                } else {
                    statusText = 'Hoàn thành';
                }
            } else if (task.status === 'error') {
                statusText = 'Lỗi';
            } else {
                statusText = task.status;
            }

            // Determine status color class
            let statusColorClass = '';
            if (task.status === 'waiting') {
                statusColorClass = 'status-waiting';
            } else if (task.status === 'processing') {
                statusColorClass = 'status-processing';
            } else if (task.status === 'completed') {
                statusColorClass = 'status-completed';
            } else if (task.status === 'error') {
                statusColorClass = 'status-error';
            }

            // Generate progress bar HTML
            const progressBar = `
                <div class="tts-progress-container" style="margin-top: 6px;">
                    <div class="tts-progress-bar">
                        <div class="tts-progress-fill ${progressClass}" style="width: ${progressPercent}%;">
                        </div>
                    </div>
                </div>
            `;

            // Combine status text and progress bar
            const statusCell = `
                <div style="min-width: 200px;">
                    <div><span class="${statusColorClass}">${escapeHtml(statusText)}</span>${task.error ? (': ' + escapeHtml(String(task.error))) : ''}</div>
                    ${progressBar}
                </div>
            `;

            const actions = [];
            actions.push(`<button class="btn-action btn-play" data-action="retry" data-id="${task.id}">🔁 Chạy lại</button>`);
            actions.push(`<button class="btn-action btn-stop" data-action="delete" data-id="${task.id}">🗑️ Xóa</button>`);
            actions.push(`<button class="btn-action btn-view" data-action="open" data-id="${task.id}">📂 Mở thư mục</button>`);
            actions.push(`<button class="btn-action btn-secondary" data-action="edit" data-id="${task.id}">✏️ Chỉnh sửa</button>`);

            row.innerHTML = `
                <td>${idx + 1}</td>
                <td>${escapeHtml(task.fileName || '')}</td>
                <td>${escapeHtml(task.configName || task.configId || '')}</td>
                <td>${statusCell}</td>
                <td class="tts-queue-actions">${actions.join(' ')}</td>
            `;

            ttsQueueBody.appendChild(row);
        });

        // wire actions
        ttsQueueBody.querySelectorAll('[data-action]').forEach(btn => {
            const action = btn.getAttribute('data-action');
            btn.onclick = async (e) => {
                const id = btn.getAttribute('data-id');
                const task = ttsQueue.find(t => String(t.id) === String(id));
                if (!task) return;
                if (action === 'retry') {
                    task.status = 'waiting';
                    task.attempts = (task.attempts || 0) + 1;
                    renderTtsQueue();
                    processNextTts();
                } else if (action === 'delete') {
                    ttsQueue = ttsQueue.filter(t => String(t.id) !== String(id));
                    renderTtsQueue();
                    ensureQueueVisible();
                } else if (action === 'open') {
                    if (task.filePath) {
                        const dir = task.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
                        try { await window.electronAPI.openFolder(dir); } catch (e) { console.error('open folder failed', e); }
                    } else {
                        showToast('Chưa có file để mở', 'warning');
                    }
                } else if (action === 'edit') {
                    // open config editor with the config used for this task (if available)
                    try {
                        const res = await window.electronAPI.getTtsConfigs();
                        if (res && res.success) {
                            const cfg = (res.configs || []).find(c => String(c.id) === String(task.configId));
                            if (cfg && typeof window.openTtsConfigModal === 'function') {
                                window.openTtsConfigModal(cfg);
                            } else {
                                showToast('Không tìm thấy config để chỉnh sửa', 'error');
                            }
                        }
                    } catch (e) {
                        console.error('edit action error', e);
                    }
                }
            };
        });

        ensureQueueVisible();
    }

    async function processNextTts() {
        if (ttsActiveCount >= MAX_TTS_CONCURRENT) return;
        const next = ttsQueue.find(t => t.status === 'waiting');
        if (!next) return;
        // start it
        next.status = 'processing';
        // Set start time when processing starts
        if (!next.startTime) {
            next.startTime = Date.now();
            console.log('TTS processing started, startTime set:', new Date(next.startTime).toISOString());
        }
        renderTtsQueue();
        ttsActiveCount++;
        try {
            const res = await window.electronAPI.synthesizeTts({
                configId: next.configId || null,
                fileName: next.fileName || '',
                text: next.text || '',
                autoSplitSentences: next.autoSplitSentences || false,
                maxSentenceLength: next.maxSentenceLength || 120,
                saveFolder: next.saveFolder || '',
                taskId: next.id || null
            });
            if (res && res.success) {
                next.status = 'completed';
                next.filePath = res.filePath;
                next.srtPath = res.srtPath;
                next.sentenceCount = res.sentenceCount;
                next.totalDuration = res.totalDuration;

                // Calculate duration when completed
                next.endTime = Date.now();
                if (next.startTime) {
                    next.duration = (next.endTime - next.startTime) / 1000; // Duration in seconds
                    console.log('TTS completed, duration calculated:', next.duration, 'seconds');
                }

                // Show Windows notification
                showTtsCompletedNotification(next.fileName || 'TTS file', next.filePath || '');
            } else {
                next.status = 'error';
                next.error = res && res.error ? res.error : 'Lỗi không xác định';
            }
        } catch (e) {
            next.status = 'error';
            next.error = e && e.message ? e.message : String(e);
        } finally {
            ttsActiveCount = Math.max(0, ttsActiveCount - 1);
            renderTtsQueue();
            // continue with next in queue
            setTimeout(processNextTts, 100);
        }
    }

    // Modal-based config creation/editing
    async function openTtsConfigModal(existing) {
        const modal = document.getElementById('tts-config-modal');
        const inputId = document.getElementById('tts-config-id');
        const inputName = document.getElementById('tts-config-name');
        const selectLanguage = document.getElementById('tts-config-language');
        const selectVoice = document.getElementById('tts-config-voice');
        const paramsContainer = document.getElementById('tts-config-params');
        const previewText = document.getElementById('tts-config-preview-text');
        const previewBtn = document.getElementById('tts-config-preview-btn');
        const saveBtn = document.getElementById('tts-config-save-btn');
        const cancelBtn = document.getElementById('tts-config-cancel-btn');
        const closeBtn = document.getElementById('tts-config-close');

        // Audio object for preview (to stop previous audio)
        let currentPreviewAudio = null;

        // Load language/voice options from file
        async function loadLanguageVoices() {
            try {
                const res = await window.electronAPI.ttsGetLanguageVoices();
                if (!res || !res.success) {
                    console.error('Failed to load language voices:', res);
                    return;
                }

                const data = res.data || [];
                // Clear selects
                selectLanguage.innerHTML = '';
                selectVoice.innerHTML = '';

                data.forEach((entry, idx) => {
                    const opt = document.createElement('option');
                    // Use index as value to easily reference entry
                    opt.value = String(idx);
                    opt.textContent = `${entry.language_name} [${entry.type}]`;
                    selectLanguage.appendChild(opt);
                });

                // select first by default or match existing
                let defaultIdx = 0;
                if (existing && existing.params && existing.params.language_code) {
                    // Match language_code and provider type (case-insensitive)
                    const existingProvider = (existing.provider || '').toUpperCase();
                    const found = data.findIndex(d => {
                        const languageMatch = d.language_code === existing.params.language_code;
                        const typeMatch = !existingProvider || d.type.toUpperCase() === existingProvider.replace('VOICEVOX', 'VOICE_VOX');
                        return languageMatch && typeMatch;
                    });
                    if (found !== -1) defaultIdx = found;
                }
                selectLanguage.value = String(defaultIdx);
                populateVoicesForIndex(defaultIdx, data);

                // when language changes, repopulate voices
                selectLanguage.onchange = () => {
                    const idx = Number(selectLanguage.value);
                    populateVoicesForIndex(idx, data);
                };

                // If existing, set voice and params
                if (existing && existing.params) {
                    // Wait for DOM to update after populateVoicesForIndex
                    setTimeout(() => {
                        console.log('Loading existing config:', existing);

                        // Set voice
                        if (existing.params.voice_code || existing.params.voiceName) {
                            const v = existing.params.voice_code || existing.params.voiceName;
                            console.log('Looking for voice:', v);

                            let foundVoice = false;
                            for (let i = 0; i < selectVoice.options.length; i++) {
                                if (String(selectVoice.options[i].value) === String(v)) {
                                    selectVoice.selectedIndex = i;
                                    foundVoice = true;
                                    console.log('Found voice at index:', i);
                                    break;
                                }
                            }

                            if (!foundVoice) {
                                console.warn('Voice not found:', v, 'Available voices:',
                                    Array.from(selectVoice.options).map(o => o.value));
                        }
                        }

                        // Set audio params values
                        if (existing.params.audioConfig) {
                            console.log('Loading audioConfig:', existing.params.audioConfig);

                            for (const key in existing.params.audioConfig) {
                                const el = document.getElementById('param-' + key);
                                if (el) {
                                    const value = existing.params.audioConfig[key];
                                    console.log(`Setting ${key} = ${value}`);

                                    el.value = value;

                                    // Update output display
                                    const outEl = document.getElementById(`param-${key}-val`);
                                    if (outEl) {
                                        const step = parseFloat(el.getAttribute('data-step')) || 1;
                                        // Format based on step: 1 decimal for 0.1, 2 decimals for 0.01
                                        let displayValue;
                                        if (step >= 1) {
                                            displayValue = value;
                                        } else {
                                            const decimals = step >= 0.1 ? 1 : 2;
                                            displayValue = parseFloat(value).toFixed(decimals);
                                        }
                                        outEl.textContent = displayValue;

                                        // Update slider background
                                        const minV = parseFloat(el.min);
                                        const maxV = parseFloat(el.max);
                                        const pct = (maxV > minV) ? ((value - minV) / (maxV - minV)) * 100 : 0;
                                        el.style.background = `linear-gradient(90deg, #667eea ${pct}%, #e9ecef ${pct}%)`;

                                        // Update default indicator
                                        const defVal = parseFloat(el.getAttribute('data-default'));
                                        const tol = step > 0 ? step / 2 : 0.5;
                                        if (Math.abs(value - defVal) <= tol) {
                                            outEl.classList.add('at-default');
                                        } else {
                                            outEl.classList.remove('at-default');
                                    }
                                }
                                } else {
                                    console.warn(`Param element not found: param-${key}`);
                                }
                            }
                        }
                    }, 100); // Tăng timeout lên 100ms để đảm bảo DOM đã render
                }
            } catch (error) {
                console.error('loadLanguageVoices error:', error);
            }
        }

        function populateVoicesForIndex(idx, data) {
            paramsContainer.innerHTML = '';
            selectVoice.innerHTML = '';
            const entry = data[idx];
            if (!entry) return;
            // Populate voices
            (entry.voices || []).forEach(v => {
                const opt = document.createElement('option');
                // save voice_code or voice_code string
                opt.value = v.voice_code;
                opt.textContent = v.voice_name;
                selectVoice.appendChild(opt);
            });

            // Populate audio config parameters
            const params = entry.audio_config_parameters || [];
                params.forEach(p => {
                const wrapper = document.createElement('div');
                wrapper.className = 'input-group';
                // Use range slider with a live value display
                const paramId = `param-${p.name}`;
                const min = (typeof p.min === 'number') ? p.min : 0;
                const max = (typeof p.max === 'number') ? p.max : 1;
                const def = (typeof p.default === 'number') ? p.default : min;

                // Smart step: if range > 5, use 0.1; otherwise use 0.01
                let step = 1;
                if (p.type && p.type.toLowerCase() === 'float') {
                    const range = Math.abs(max - min);
                    step = range > 5 ? 0.1 : 0.01;
                }

                wrapper.innerHTML = `
                    <div class="param-header">
                        <span class="param-name">${escapeHtml(p.name)}</span>
                        <small class="param-desc">${escapeHtml(p.description || '')}</small>
                    </div>
                    <div class="param-control">
                        <input id="${paramId}" class="param-slider" data-param-name="${escapeHtml(p.name)}" data-default="${def}" data-step="${step}" type="range" min="${min}" max="${max}" step="${step}" value="${def}">
                        <output id="${paramId}-val" class="param-value">${def}</output>
                    </div>
                `;

                paramsContainer.appendChild(wrapper);

                // Wire live update for the slider
                const slider = wrapper.querySelector(`#${paramId}`);
                const out = wrapper.querySelector(`#${paramId}-val`);
                if (slider && out) {
                    const formatValue = (v) => {
                        if (step >= 1) return Number(v);
                        // Show 1 decimal for step 0.1, 2 decimals for step 0.01
                        const decimals = step >= 0.1 ? 1 : 2;
                        return parseFloat(Number(v).toFixed(decimals));
                    };

                    const setSliderBackground = (s) => {
                        const minV = Number(s.min);
                        const maxV = Number(s.max);
                        const val = Number(s.value);
                        const pct = (maxV > minV) ? ((val - minV) / (maxV - minV)) * 100 : 0;
                        s.style.background = `linear-gradient(90deg, #667eea ${pct}%, #e9ecef ${pct}%)`;
                    };

                    const isAtDefault = (s) => {
                        const defVal = Number(s.getAttribute('data-default'));
                        const stepVal = Math.abs(Number(s.getAttribute('data-step')) || 0);
                        const cur = Number(s.value);
                        // Tolerance based on step: half of step value
                        const tol = stepVal > 0 ? stepVal / 2 : 0.5;
                        return Math.abs(cur - defVal) <= tol;
                    };

                    const updateOutput = (s, o) => {
                        const v = s.value;
                        o.textContent = formatValue(v);
                        // set green when at default
                        if (isAtDefault(s)) {
                            o.classList.add('at-default');
                        } else {
                            o.classList.remove('at-default');
                        }
                        setSliderBackground(s);
                    };

                    // initial set
                    updateOutput(slider, out);

                    slider.addEventListener('input', (ev) => {
                        updateOutput(ev.target, out);
                    });
                }
            });
        }

        // Initial load
        inputId.value = existing && existing.id ? existing.id : '';
        inputName.value = existing && existing.name ? existing.name : '';
        await loadLanguageVoices();

        // Close handlers
        function closeModal() {
            // Dừng audio nếu đang phát
            if (currentPreviewAudio) {
                try {
                    currentPreviewAudio.pause();
                    currentPreviewAudio.currentTime = 0;
                    currentPreviewAudio = null;
                } catch (e) {
                    console.warn('Error stopping audio on modal close:', e);
                }
            }

            modal.style.display = 'none';
            // cleanup handlers
            saveBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            selectLanguage.onchange = null;
            previewBtn.onclick = null;
        }

        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;

        saveBtn.onclick = async () => {
            const name = inputName.value.trim();
            if (!name) { showToast('Tên config là bắt buộc', 'warning'); return; }

            // Get chosen language entry
            let chosenEntry = null;
            try {
                const res = await window.electronAPI.ttsGetLanguageVoices();
                if (res && res.success) chosenEntry = (res.data || [])[Number(selectLanguage.value)];
            } catch (e) {
                console.error('Error loading language voices for save:', e);
            }

            if (!chosenEntry) {
                showToast('Không thể xác định ngôn ngữ/giọng đã chọn', 'error');
                return;
            }

            // Determine provider type mapping
            let providerType = 'voicevox';
            if (chosenEntry.type && String(chosenEntry.type).toUpperCase() === 'GOOGLE') providerType = 'google';

            const voiceCode = selectVoice.value;

            // Collect audio params
            const audioConfig = {};
            Array.from(paramsContainer.querySelectorAll('input')).forEach(inp => {
                const key = inp.id.replace(/^param-/, '');
                audioConfig[key] = parseFloat(inp.value);
            });

            const params = {
                language_code: chosenEntry.language_code,
                voice_code: voiceCode,
                audioConfig
            };

            const cfg = {
                id: inputId.value ? inputId.value : undefined,
                name,
                provider: providerType,
                params
            };

            try {
                saveBtn.disabled = true;
                saveBtn.textContent = '⏳ Đang lưu...';
                console.log('Saving TTS config (modal):', cfg);
                const saveRes = await window.electronAPI.saveTtsConfig(cfg);
                console.log('tts saveRes (modal):', saveRes);
                if (saveRes && saveRes.success) {
                    showToast('Đã lưu config TTS', 'success');
                    await loadConfigs();

                    // Auto-select the saved config in combobox
                    if (saveRes.savedConfigId) {
                        ttsConfigSelect.value = saveRes.savedConfigId;

                        // Save to settings immediately
                        try {
                            const settings = await window.electronAPI.getSettings();
                            settings.lastSelectedTtsConfigId = saveRes.savedConfigId;
                            await window.electronAPI.saveSettings(settings);
                            console.log('Auto-selected and saved TTS config:', saveRes.savedConfigId);
                        } catch (err) {
                            console.warn('Could not save last selected TTS config:', err);
                        }
                    }

                    closeModal();
                } else {
                    const errMsg = (saveRes && saveRes.error) ? saveRes.error : 'Không thể lưu config';
                    showToast('Lỗi khi lưu config: ' + errMsg, 'error', 8000);
                    console.error('TTS save failed (modal):', saveRes);
                }
            } catch (err) {
                console.error('Error saving config (modal):', err);
                showToast('Lỗi khi lưu config: ' + (err && err.message ? err.message : String(err)), 'error', 10000);
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Lưu';
            }
        };

        // Preview handler
        previewBtn.onclick = async () => {
            const text = previewText.value.trim();
            if (!text) { showToast('Nhập text để nghe thử', 'warning'); return; }
            previewBtn.disabled = true;
            previewBtn.textContent = '⏳ Đang tạo...';
            try {
                const res = await window.electronAPI.ttsGetLanguageVoices();
                if (!res || !res.success) {
                    showToast('Không thể load danh sách ngôn ngữ/giọng', 'error');
                    return;
                }
                const entry = (res.data || [])[Number(selectLanguage.value)];
                if (!entry) { showToast('Ngôn ngữ không hợp lệ', 'error'); return; }

                // Check if VoiceVox and ensure server is running
                if (entry.type && entry.type.toUpperCase() === 'VOICE_VOX') {
                    previewBtn.textContent = '⏳ Kiểm tra VoiceVox...';

                    // Check if VoiceVox server is running
                    const checkRes = await window.electronAPI.voicevoxCheckServer('http://127.0.0.1:50021');

                    if (checkRes && !checkRes.isRunning) {
                        // Server not running, try to start it
                        showToast('VoiceVox chưa chạy, đang khởi động...', 'info', 5000);
                        previewBtn.textContent = '⏳ Đang khởi động VoiceVox...';

                        const startRes = await window.electronAPI.voicevoxStartServer('http://127.0.0.1:50021');

                        if (!startRes || !startRes.success) {
                            const errorMsg = startRes && startRes.error ? startRes.error : 'Không thể khởi động VoiceVox';
                            showToast(errorMsg, 'error', 10000);
                            return;
                        }

                        showToast(startRes.message || 'VoiceVox đã sẵn sàng', 'success');
                    }

                    previewBtn.textContent = '⏳ Đang tạo...';
                }

                // gather params
                const audioParams = {};
                Array.from(paramsContainer.querySelectorAll('input')).forEach(inp => {
                    const key = inp.id.replace(/^param-/, '');
                    audioParams[key] = parseFloat(inp.value);
                });

                const previewOptions = {
                    entryType: entry.type,
                    languageCode: entry.language_code,
                    voiceCode: selectVoice.value,
                    params: Object.assign({}, audioParams),
                    text
                };

                const previewRes = await window.electronAPI.ttsPreview(previewOptions);
                console.log('tts preview res:', previewRes);
                if (previewRes && previewRes.success && previewRes.filePath) {
                    try {
                        // Dừng audio trước đó nếu có
                        if (currentPreviewAudio) {
                            try {
                                currentPreviewAudio.pause();
                                currentPreviewAudio.currentTime = 0;
                                currentPreviewAudio = null;
                            } catch (stopErr) {
                                console.warn('Error stopping previous audio:', stopErr);
                            }
                        }

                        // Phát audio mới
                        currentPreviewAudio = new Audio(`file://${previewRes.filePath}`);
                        await currentPreviewAudio.play();
                        showToast('Đang phát file thử', 'success');

                        // Cleanup khi audio kết thúc
                        currentPreviewAudio.onended = () => {
                            currentPreviewAudio = null;
                        };
                    } catch (e) {
                        console.error('Audio play error:', e);
                        showToast('Không thể phát audio thử', 'error');
                    }
                } else {
                    showToast('Lỗi khi tạo thử giọng: ' + (previewRes && previewRes.error ? previewRes.error : 'Không xác định'), 'error', 8000);
                }
            } catch (e) {
                console.error('Preview error:', e);
                showToast('Lỗi khi nghe thử: ' + (e && e.message ? e.message : String(e)), 'error', 8000);
            } finally {
                previewBtn.disabled = false;
                previewBtn.textContent = 'Nghe thử';
            }
        };

        // Show modal
        modal.style.display = 'flex';
    }

    // Expose modal opener so other code (queue edit) can open config modal
    window.openTtsConfigModal = openTtsConfigModal;

    ttsAddConfigBtn.addEventListener('click', async () => {
        if (typeof window.openTtsConfigModal === 'function') {
            window.openTtsConfigModal(null);
        } else {
            showToast('Tính năng chưa sẵn sàng, vui lòng thử lại', 'warning');
        }
    });

    ttsEditConfigBtn.addEventListener('click', async () => {
        const sel = ttsConfigSelect.value;
        if (!sel) { showToast('Chọn config để chỉnh sửa', 'warning'); return; }
        try {
            const res = await window.electronAPI.getTtsConfigs();
            if (res && res.success) {
                const cfg = (res.configs || []).find(c => String(c.id) === String(sel));
                if (cfg) {
                    if (typeof window.openTtsConfigModal === 'function') {
                        window.openTtsConfigModal(cfg);
                    } else {
                        showToast('Tính năng chưa sẵn sàng, vui lòng thử lại', 'warning');
                    }
                }
            }
        } catch (err) {
            console.error('Error editing config:', err);
        }
    });

    ttsDeleteConfigBtn.addEventListener('click', async () => {
        const sel = ttsConfigSelect.value;
        if (!sel) { showToast('Chọn config để xóa', 'warning'); return; }

        // Confirm deletion
        if (!confirm('Bạn có chắc chắn muốn xóa config này?')) {
            return;
        }

        try {
            const result = await window.electronAPI.deleteTtsConfig(sel);
            if (result && result.success) {
                showToast('Đã xóa config thành công', 'success');
                // Reload configs
                loadConfigs();
            } else {
                showToast('Lỗi khi xóa config: ' + (result?.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            console.error('Error deleting config:', err);
            showToast('Lỗi khi xóa config', 'error');
        }
    });

    ttsSynthesizeBtn.addEventListener('click', async () => {
        const cfgId = ttsConfigSelect.value || null;
        const cfgName = (ttsConfigSelect.options[ttsConfigSelect.selectedIndex] || {}).text || '';
        const fileName = (ttsFileNameInput && ttsFileNameInput.value) ? ttsFileNameInput.value.trim() : '';
        const text = (ttsTextInput && ttsTextInput.value) ? ttsTextInput.value.trim() : '';
        const autoSplitSentences = ttsAutoSplitCheckbox ? ttsAutoSplitCheckbox.checked : false;
        const maxSentenceLength = ttsMaxSentenceLengthInput ? parseInt(ttsMaxSentenceLengthInput.value) || 120 : 120;
        const saveFolder = ttsSaveFolderInput ? ttsSaveFolderInput.value.trim() : '';

        if (!fileName) { showToast('Vui lòng nhập tên file lưu giọng đọc', 'warning'); return; }
        if (!text) { showToast('Vui lòng nhập nội dung voice', 'warning'); return; }

        // Add to queue instead of immediate synth
        const task = {
            configId: cfgId,
            configName: cfgName,
            fileName,
            text,
            autoSplitSentences,
            maxSentenceLength,
            saveFolder
        };

        addTtsToQueue(task);
        showToast('Đã thêm tác vụ vào queue', 'info');
        // clear UI state briefly
        if (ttsResult) { ttsResult.style.display = 'none'; }
    });

    // Save selected config to settings when user changes selection
    ttsConfigSelect.addEventListener('change', async () => {
        const selectedConfigId = ttsConfigSelect.value;
        if (selectedConfigId) {
            try {
                // Get current settings
                const settings = await window.electronAPI.getSettings();
                // Update lastSelectedTtsConfigId
                settings.lastSelectedTtsConfigId = selectedConfigId;
                // Save back
                await window.electronAPI.saveSettings(settings);
                console.log('Saved last selected TTS config:', selectedConfigId);
            } catch (err) {
                console.warn('Could not save last selected TTS config:', err);
            }
        }
    });

    // Listen for sentence progress updates
    if (window.electronAPI.onTtsSentenceProgress) {
        window.electronAPI.onTtsSentenceProgress((data) => {
            // Update the correct task by taskId
            if (data.taskId) {
                const task = ttsQueue.find(t => String(t.id) === String(data.taskId));
                if (task && task.status === 'processing') {
                    task.sentenceProgress = `${data.current}/${data.total}`;
                    task.currentSentence = data.sentence;
                    renderTtsQueue();
                }
            }
        });
    }

    // Load TTS folder from settings
    async function loadTtsFolder() {
        try {
            const settings = await window.electronAPI.getSettings();
            if (settings && settings.ttsSaveFolder) {
                ttsSaveFolderInput.value = settings.ttsSaveFolder;
            }
        } catch (err) {
            console.warn('Could not load TTS folder setting:', err);
        }
    }

    // Select folder button
    if (ttsSelectFolderBtn) {
        ttsSelectFolderBtn.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.selectFolder();
                if (result && result.folderPath) {
                    ttsSaveFolderInput.value = result.folderPath;

                    // Save to settings
                    try {
                        const settings = await window.electronAPI.getSettings();
                        settings.ttsSaveFolder = result.folderPath;
                        await window.electronAPI.saveSettings(settings);
                        showToast('Đã lưu thư mục TTS', 'success');
                    } catch (err) {
                        console.error('Could not save TTS folder:', err);
                        showToast('Lỗi khi lưu thư mục', 'error');
                    }
                }
            } catch (err) {
                console.error('Error selecting folder:', err);
                showToast('Lỗi khi chọn thư mục', 'error');
            }
        });
    }

    // Initial load
    loadConfigs();
    loadTtsFolder();
}

// Setup listeners cho yt-dlp update
function setupYtDlpUpdateListeners() {
    // Listen for update status
    window.electronAPI.onYtDlpUpdateStatus((data) => {
        handleYtDlpUpdateStatus(data);
    });

    // Listen for update progress
    window.electronAPI.onYtDlpUpdateProgress((data) => {
        handleYtDlpUpdateProgress(data);
    });

    // Button handlers
    updateYtDlpBtn.addEventListener('click', handleUpdateYtDlp);
    dismissNotificationBtn.addEventListener('click', hideNotification);
    closeNotificationBtn.addEventListener('click', hideNotification);
}

// Setup listeners cho app update
function setupAppUpdateListeners() {
    // Load and display app version
    if (appVersionSpan && window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(version => {
            appVersionSpan.textContent = `v${version}`;
        }).catch(err => {
            console.error('Error getting app version:', err);
        });
    }

    // Listen for update status
    if (window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
            handleAppUpdateStatus(data);
        });
    }

    // Check update button - DISABLED (button hidden)
    /*
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', async () => {
            checkUpdateBtn.disabled = true;
            checkUpdateBtn.innerHTML = '⏳ Đang kiểm tra...';
            try {
                const result = await window.electronAPI.checkForUpdates();

                // Handle specific error cases
                if (result && !result.success) {
                    if (result.isDev) {
                        showToast('⚠️ Update chỉ hoạt động khi app đã được build', 'warning', 5000);
                    } else if (result.message && result.message.includes('no releases')) {
                        showToast('ℹ️ Chưa có phiên bản release nào trên GitHub', 'info', 5000);
                    } else if (result.message) {
                        showToast(`❌ ${result.message}`, 'error', 5000);
                    }
                }
                // Success case will be handled by onUpdateStatus listener
            } catch (error) {
                console.error('Check update error:', error);
                showToast('❌ Lỗi kiểm tra cập nhật: Có thể chưa có release trên GitHub', 'error', 5000);
            } finally {
                setTimeout(() => {
                    checkUpdateBtn.disabled = false;
                    checkUpdateBtn.innerHTML = '🔄 Cập nhật';
                }, 3000);
            }
        });
    }
    */
}

// Handle app update status
function handleAppUpdateStatus(data) {
    console.log('App update status:', data);

    const modal = document.getElementById('update-modal');
    const title = document.getElementById('update-modal-title');
    const message = document.getElementById('update-modal-message');
    const progressContainer = document.getElementById('update-progress-container');
    const progressBar = document.getElementById('update-progress-bar');
    const progressText = document.getElementById('update-progress-text');
    const speedText = document.getElementById('update-speed-text');
    const spinner = document.querySelector('#update-modal-body .spinner');
    const installBtn = document.getElementById('update-install-btn');
    const laterBtn = document.getElementById('update-later-btn');

    switch (data.status) {
        case 'checking':
            modal.style.display = 'flex';
            title.textContent = 'Đang kiểm tra cập nhật...';
            message.textContent = 'Vui lòng đợi...';
            spinner.style.display = 'block';
            progressContainer.style.display = 'none';
            installBtn.style.display = 'none';
            laterBtn.style.display = 'none';
            break;

        case 'available':
            title.textContent = `🎉 Phiên bản mới ${data.version} đã có sẵn!`;
            message.textContent = 'Đang tự động tải xuống...';
            spinner.style.display = 'block';
            progressContainer.style.display = 'none';

            // Auto download
            window.electronAPI.downloadUpdate();
            break;

        case 'not-available':
            showToast('Bạn đang sử dụng phiên bản mới nhất', 'success', 3000);
            modal.style.display = 'none';
            break;

        case 'downloading':
            title.textContent = 'Đang tải phiên bản mới...';
            message.textContent = `Đang tải phiên bản ${data.version}...`;
            spinner.style.display = 'none';
            progressContainer.style.display = 'block';

            const percent = Math.round(data.percent || 0);
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `${percent}%`;

            // Calculate speed
            if (data.bytesPerSecond) {
                const speedMB = (data.bytesPerSecond / (1024 * 1024)).toFixed(2);
                speedText.textContent = `Tốc độ: ${speedMB} MB/s`;
            }
            break;

        case 'downloaded':
            title.textContent = 'Đã tải xong!';
            message.textContent = `Phiên bản ${data.version} đã sẵn sàng cài đặt.`;
            spinner.style.display = 'none';
            progressContainer.style.display = 'none';
            installBtn.style.display = 'inline-block';
            laterBtn.style.display = 'inline-block';

            // Button handlers
            installBtn.onclick = () => {
                window.electronAPI.quitAndInstall();
            };

            laterBtn.onclick = () => {
                modal.style.display = 'none';
            };
            break;

        case 'error':
            title.textContent = '❌ Lỗi cập nhật';
            message.textContent = data.message || 'Đã xảy ra lỗi khi cập nhật';
            spinner.style.display = 'none';
            progressContainer.style.display = 'none';
            installBtn.style.display = 'none';
            laterBtn.style.display = 'inline-block';
            laterBtn.textContent = '❌ Đóng';
            laterBtn.onclick = () => {
                modal.style.display = 'none';
            };
            break;
    }
}

// Check yt-dlp khi startup
async function checkYtDlpOnStartup() {
    try {
        // Gửi signal để main process check yt-dlp
        // Main process sẽ tự động check và update nếu cần
        // Chúng ta chỉ cần listen events
    } catch (error) {
        console.error('Error checking yt-dlp on startup:', error);
    }
}

// Xử lý update status
function handleYtDlpUpdateStatus(data) {
    switch (data.status) {
        case 'checking':
            showToast('⏳ Đang kiểm tra version yt-dlp...', 'info', 3000);
            break;
        case 'up-to-date':
            showToast(`yt-dlp đã là version mới nhất (${data.currentVersion})`, 'success', 3000);
            break;
        case 'update-available':
            showToast(`🔄 Có version mới: ${data.latestVersion} (hiện tại: ${data.currentVersion}). Đang tải...`, 'info', 5000);
            break;
        case 'not-found':
            showToast('⬇️ yt-dlp không tìm thấy. Đang tải...', 'info', 5000);
            break;
        case 'error':
            showToast(`❌ Lỗi: ${data.message}`, 'error', 5000);
            break;
    }
}

// Xử lý update progress
function handleYtDlpUpdateProgress(data) {
    switch (data.type) {
        case 'downloading':
            showToast(data.message || '⬇️ Đang tải yt-dlp từ GitHub...', 'info', 5000);
            break;
        case 'progress':
            // Không hiển thị progress trong toast (toast đã tự động ẩn)
            break;
        case 'completed':
            showToast(data.message || `Đã tải yt-dlp thành công${data.version ? ` (version: ${data.version})` : ''}`, 'success', 5000);
            break;
        case 'stdout':
        case 'stderr':
            // Không hiển thị log trong toast
            break;
    }
}

// Hiển thị notification
function showNotification(icon, title, message, statusClass) {
    notificationIcon.textContent = icon;
    notificationTitle.textContent = title;
    notificationMessage.textContent = message;
    ytDlpNotification.className = `yt-dlp-notification ${statusClass}`;
    ytDlpNotification.style.display = 'block';
}

// Ẩn notification
function hideNotification() {
    ytDlpNotification.style.display = 'none';
    notificationProgress.style.display = 'none';
    notificationActions.style.display = 'none';
    updateYtDlpBtn.style.display = 'block';
    progressFillSmall.style.width = '0%';
}

// Xử lý khi nhấn nút Update
async function handleUpdateYtDlp() {
    try {
        updateYtDlpBtn.disabled = true;
        updateYtDlpBtn.textContent = 'Đang cập nhật...';

        const result = await window.electronAPI.updateYtDlp();

        if (result.success) {
            // Status sẽ được cập nhật qua listener
        } else {
            showNotification('❌', 'Lỗi', result.error || 'Không thể cập nhật', 'error');
        }
    } catch (error) {
        console.error('Error updating yt-dlp:', error);
        showNotification('❌', 'Lỗi', error.message || 'Không thể cập nhật', 'error');
    } finally {
        updateYtDlpBtn.disabled = false;
        updateYtDlpBtn.textContent = 'Cập nhật';
    }
}

// Xử lý khi nhấn nút "Lấy thông tin"
async function handleProcess() {
    const urls = videoUrlsTextarea.value
        .split('\n')
        .map(url => url.trim())
        .filter(url => url && isValidYouTubeUrl(url));

    if (urls.length === 0) {
        showError('Vui lòng nhập ít nhất một link YouTube hợp lệ!');
        return;
    }

    // Reset UI
    results = [];
    resultsBody.innerHTML = '';
    hideError();
    showProgress();
    processBtn.disabled = true;
    processBtn.querySelector('.btn-text').style.display = 'none';
    processBtn.querySelector('.btn-loader').style.display = 'inline';

    // Xử lý song song với tối đa X luồng cùng lúc (config trong config.js)
    const MAX_CONCURRENT = window.APP_CONFIG?.MAX_CONCURRENT_VIDEO_PROCESSING || 5;
    let processedCount = 0;
    const videoResults = new Array(urls.length); // Lưu kết quả theo thứ tự ban đầu

    // Hàm xử lý một video và lưu kết quả vào array
    async function processVideo(url, originalIndex) {
        try {
            const result = await window.electronAPI.getVideoInfo(url);

            if (result.success) {
                const videoData = result.data;
                const displayIndex = originalIndex + 1; // Index hiển thị theo thứ tự ban đầu (1-based)
                // Lưu displayIndex vào videoData để dùng cho copy all
                videoData.displayIndex = displayIndex;
                
                // Lưu vào array theo đúng vị trí
                videoResults[originalIndex] = { type: 'success', data: videoData, url: url };
            } else {
                // Lưu lỗi vào array theo đúng vị trí
                videoResults[originalIndex] = { type: 'error', error: result.error, url: url };
            }
        } catch (error) {
            console.error('Error processing video:', error);
            // Lưu lỗi vào array theo đúng vị trí
            videoResults[originalIndex] = { type: 'error', error: error.message, url: url };
        } finally {
            processedCount++;
            updateProgress((processedCount / urls.length) * 100, `Đang xử lý video ${processedCount}/${urls.length}...`);
        }
    }

    // Xử lý tất cả video song song
    const allPromises = urls.map((url, index) => processVideo(url, index));

    // Đợi tất cả video hoàn thành
    await Promise.allSettled(allPromises);

    // Hiển thị kết quả theo đúng thứ tự ban đầu
    resultsBody.innerHTML = ''; // Xóa tất cả rows hiện tại (nếu có)
    results = []; // Reset results array

    videoResults.forEach((result, originalIndex) => {
        if (result && result.type === 'success') {
            const videoData = result.data;
            results.push(videoData);
            const resultIndex = results.length - 1; // Index trong mảng results (0-based)
            const displayIndex = originalIndex + 1; // Index hiển thị (1-based)

            // Thêm row vào bảng theo đúng thứ tự
            addResultRow(videoData, displayIndex, resultIndex);

            // Xử lý OCR cho thumbnail (bất đồng bộ)
            processThumbnailOCR(videoData, displayIndex);
        } else if (result && result.type === 'error') {
            // Thêm row với lỗi theo đúng thứ tự
            addErrorRow(result.url, result.error, originalIndex + 1);
        }
    });

    // Hoàn thành
    updateProgress(100, 'Hoàn thành!');
    hideProgress();
    showResults();
    processBtn.disabled = false;
    processBtn.querySelector('.btn-text').style.display = 'inline';
    processBtn.querySelector('.btn-loader').style.display = 'none';
}

// Kiểm tra URL YouTube hợp lệ
function isValidYouTubeUrl(url) {
    const patterns = [
        /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/,
        /^https?:\/\/youtube\.com\/watch\?v=[\w-]+/,
        /^https?:\/\/youtu\.be\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

// Thêm row kết quả vào bảng
function addResultRow(videoData, displayIndex, resultIndex) {
    const row = document.createElement('tr');
    row.id = `row-${displayIndex}`;

    row.innerHTML = `
        <td>${displayIndex}</td>
        <td class="thumbnail-cell">
            ${videoData.thumbnail ?
            `<img src="${videoData.thumbnail}" alt="Thumbnail" class="thumbnail-img" onclick="showThumbnailModal('${videoData.thumbnail}', ${resultIndex})">` :
            '<span class="empty-state">Không có</span>'}
        </td>
        <td>
            <div class="thumbnail-text-container">
                <div class="text-on-thumbnail loading" 
                     id="thumbnail-text-${displayIndex}"
                     onclick="${videoData.thumbnail ? `showThumbnailModal('${videoData.thumbnail}', ${resultIndex})` : ''}"
                     style="${videoData.thumbnail ? 'cursor: pointer;' : ''}"
                     title="${videoData.thumbnail ? 'Click để xem thumbnail lớn' : ''}">
                    Đang xử lý OCR...
                </div>
                ${videoData.thumbnail ? `<button class="btn-retry-ocr" onclick="retryThumbnailOCR(${resultIndex}, ${displayIndex})" title="Lấy lại text từ thumbnail">🔄 Lấy text</button>` : ''}
            </div>
        </td>
        <td class="title-cell">${escapeHtml(videoData.title)}</td>
    
        <td class="transcript-cell">
            ${videoData.subtitle ?
            `<div id="transcript-${displayIndex}">${formatSubtitleForDisplay(videoData.subtitle)}</div>` :
            '<span class="empty-state">Không có transcript</span>'}
        </td>
        <td>
            <div class="action-buttons">
                ${videoData.url ? `<button class="btn-action btn-view" onclick="openVideo('${videoData.url}')">Mở video</button>` : ''}
                ${videoData.subtitle ? `<button class="btn-action btn-copy" onclick="copyTranscript(${resultIndex})">Copy transcript</button>` : ''}
                <button class="btn-action btn-copy-all" onclick="copyAllData(${resultIndex})">📋 Copy Data</button>
            </div>
        </td>
    `;

    resultsBody.appendChild(row);
}

// Chuẩn hóa lỗi để hiển thị thân thiện hơn
function formatFriendlyVideoError(rawError) {
    if (!rawError) {
        return 'Lỗi báo cho Admin';
    }

    const msg = String(rawError);
    const lower = msg.toLowerCase();

    // Lỗi cookies YouTube hết hạn hoặc không hợp lệ
    if (lower.includes('cookies') && (lower.includes('no longer valid') || lower.includes('rotated'))) {
        return 'Cookie YouTube không còn hợp lệ. Báo cho Admin cập nhật cookie.';
    }

    // Lỗi JavaScript runtime từ yt-dlp
    if (lower.includes('no supported javascript runtime') || lower.includes('javascript runtime could be found')) {
        return 'Lỗi kỹ thuật với YouTube. Báo cho Admin kiểm tra.';
    }

    // Lỗi web client formats / SABR streaming
    if (lower.includes('web_safari client') || lower.includes('sabr streaming') || lower.includes('formats have been skipped')) {
        return 'Lỗi kỹ thuật với YouTube. Báo cho Admin kiểm tra.';
    }

    // Lỗi chung từ yt-dlp hoặc YouTube
    if (lower.includes('yt-dlp') || lower.includes('youtube') || lower.includes('warning:')) {
        return 'Không thể lấy thông tin video. Báo cho Admin kiểm tra.';
    }

    // Lỗi network
    if (lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused')) {
        return 'Lỗi kết nối mạng. Vui lòng thử lại sau.';
    }

    // Lỗi không tìm thấy video
    if (lower.includes('video unavailable') || lower.includes('not found') || lower.includes('404')) {
        return 'Video không tồn tại hoặc đã bị xóa.';
    }

    // Mặc định: lỗi chung
    return 'Lỗi báo cho Admin';
}

// Thêm row lỗi
function addErrorRow(url, error, index) {
    const row = document.createElement('tr');
    row.style.background = '#fff3cd';

    const friendlyError = formatFriendlyVideoError(error);

    row.innerHTML = `
        <td>${index}</td>
        <td colspan="5">
            <strong>Lỗi:</strong> ${escapeHtml(friendlyError)}<br>
            <small>URL: ${escapeHtml(url)}</small>
        </td>
    `;

    resultsBody.appendChild(row);
}

// Xử lý OCR cho thumbnail
async function processThumbnailOCR(videoData, index) {
    if (!videoData.thumbnail) {
        updateThumbnailText(index, 'Không có thumbnail');
        return;
    }

    try {
        // Tải thumbnail về và xử lý OCR
        const result = await window.electronAPI.extractTextFromThumbnail(videoData.thumbnail, videoData.videoId);
        if (result.success && result.text) {
            // Lưu text OCR vào videoData để dùng cho modal
            const resultIndex = index - 1; // Chuyển từ displayIndex về resultIndex
            if (results[resultIndex]) {
                results[resultIndex].thumbnailText = result.text;
            }
            updateThumbnailText(index, result.text);
        } else {
            const errorText = result.error || 'Không phát hiện được chữ';
            const resultIndex = index - 1;
            if (results[resultIndex]) {
                results[resultIndex].thumbnailText = errorText;
            }
            updateThumbnailText(index, errorText);
        }
    } catch (error) {
        console.error('OCR Error:', error);
        const errorText = 'Lỗi khi xử lý OCR';
        const resultIndex = index - 1;
        if (results[resultIndex]) {
            results[resultIndex].thumbnailText = errorText;
        }
        updateThumbnailText(index, errorText);
    }
}

// Cập nhật text trên thumbnail
function updateThumbnailText(index, text) {
    const elementId = `thumbnail-text-${index}`;
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text || 'Không có chữ';
        element.classList.remove('loading');
    } else {
        console.error(`Element not found: ${elementId}`);
    }
}

// Hàm OCR lại thumbnail khi click button "Lấy text"
window.retryThumbnailOCR = async function (resultIndex, displayIndex) {
    const videoData = results[resultIndex];
    if (!videoData || !videoData.thumbnail) {
        showToast('Không có thumbnail để OCR', 'warning');
        return;
    }

    // Cập nhật UI để hiển thị loading
    const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
    if (textElement) {
        textElement.textContent = 'Đang xử lý OCR...';
        textElement.classList.add('loading');
    }

    // Gọi lại hàm OCR
    await processThumbnailOCR(videoData, displayIndex);
};

// Format subtitle - chỉ lấy text, bỏ timestamp (full content)
function formatSubtitle(subtitle) {
    if (!subtitle) return 'Không có';

    const lines = subtitle.split('\n');
    const textLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Bỏ qua dòng rỗng
        if (!line) continue;

        // Bỏ qua header VTT
        if (line.startsWith('WEBVTT') || line.startsWith('NOTE')) continue;

        // Bỏ qua metadata như "Kind: captions", "Language: ja", etc.
        if (/^(Kind|Language|Style|Region):\s*/i.test(line)) continue;

        // Bỏ qua timestamp (format: 00:00:00.000 --> 00:00:05.000 hoặc 00:00:00,000 --> 00:00:05,000)
        if (line.includes('-->') && /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(line)) {
            continue;
        }

        // Bỏ qua số thứ tự (chỉ có số)
        if (/^\d+$/.test(line)) continue;

        // Bỏ qua các tag HTML/VTT như <c>, </c>, <v>, etc.
        if (line.startsWith('<') && line.endsWith('>')) continue;

        // Giữ lại text
        if (line.length > 0) {
            // Loại bỏ các tag HTML/VTT và timing tags trong text
            // Loại bỏ các tag như <00:00:00.640>, <c>...</c>
            let cleanText = line.replace(/<[^>]+>/g, '').trim();

            // Nếu dòng chỉ chứa khoảng trắng sau khi loại bỏ tag, bỏ qua
            if (!cleanText || cleanText.length === 0) continue;

            // Nếu text này giống hệt với text cuối cùng đã thêm, bỏ qua (tránh lặp lại)
            if (textLines.length > 0 && textLines[textLines.length - 1] === cleanText) {
                continue;
            }

            textLines.push(cleanText);
        }
    }

    return textLines.join(' ');
}

// Return subtitle text as one sentence per line (preserve entry separation).
function formatSubtitleAsLines(srtContent) {
    if (!srtContent) return '';
    try {
        const entries = parseSRT(srtContent);
        const lines = entries.map(e => {
            // Collapse internal newlines into spaces and trim
            return e.text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        }).filter(l => l && l.length > 0);
        return lines.join('\n\n');
    } catch (e) {
        console.error('formatSubtitleAsLines error:', e);
        // Fallback to old formatter
        return formatSubtitle(srtContent);
    }
}

// Format subtitle cho hiển thị (CSS sẽ xử lý ellipsis)
function formatSubtitleForDisplay(subtitle) {
    const fullText = formatSubtitle(subtitle);

    if (!fullText || fullText === 'Không có') return fullText;

    // Escape HTML để tránh XSS và hiển thị đúng
    // CSS sẽ xử lý việc cắt text và hiển thị "..."
    return escapeHtml(fullText);
}

// Hiển thị progress
function showProgress() {
    progressSection.style.display = 'block';
    updateProgress(0, 'Bắt đầu xử lý...');
}

function hideProgress() {
    setTimeout(() => {
        progressSection.style.display = 'none';
    }, 1000);
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

// Hiển thị kết quả
function showResults() {
    resultsSection.style.display = 'block';
}

// Hiển thị lỗi
function showError(message) {
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
}

function hideError() {
    errorSection.style.display = 'none';
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Global functions cho các button
window.showThumbnailModal = function (thumbnailUrl, resultIndex) {
    // Tạo modal để xem thumbnail lớn
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';

    // Xử lý cả URL và file path
    const imgSrc = (thumbnailUrl.startsWith('http://') || thumbnailUrl.startsWith('https://'))
        ? thumbnailUrl
        : `file://${thumbnailUrl.replace(/\\/g, '/')}`;

    // Lấy text OCR từ results
    let thumbnailText = 'Đang xử lý OCR...';
    if (results[resultIndex] && results[resultIndex].thumbnailText) {
        thumbnailText = results[resultIndex].thumbnailText;
    } else {
        // Nếu chưa có, thử lấy từ element
        const displayIndex = resultIndex + 1;
        const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
        if (textElement && !textElement.classList.contains('loading')) {
            thumbnailText = textElement.textContent || 'Không có chữ';
        }
    }

    modal.innerHTML = `
        <div class="modal-content thumbnail-modal-content">
            <span class="close" onclick="closeThumbnailModal()">&times;</span>
            <div class="thumbnail-modal-body">
                <div class="thumbnail-modal-image">
                    <img src="${imgSrc}" alt="Thumbnail">
                </div>
                <div class="thumbnail-modal-text">
                    <h3>Chữ trên thumbnail:</h3>
                    <textarea 
                        id="thumbnail-text-edit" 
                        class="thumbnail-text-edit"
                        rows="10"
                        placeholder="Nhập hoặc chỉnh sửa text OCR..."
                    >${escapeHtml(thumbnailText)}</textarea>
                    <div class="thumbnail-modal-actions">
                        <button class="btn-primary" onclick="saveThumbnailText(${resultIndex})">💾 Lưu</button>
                        <button class="btn-secondary" onclick="closeThumbnailModal()">Đóng</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Lưu reference để có thể đóng modal
    window.currentThumbnailModal = modal;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeThumbnailModal();
        }
    });
};

// Hàm đóng modal thumbnail
window.closeThumbnailModal = function () {
    if (window.currentThumbnailModal) {
        window.currentThumbnailModal.style.display = 'none';
        document.body.removeChild(window.currentThumbnailModal);
        window.currentThumbnailModal = null;
    }
};

// Hàm lưu text OCR đã chỉnh sửa
window.saveThumbnailText = function (resultIndex) {
    const textarea = document.getElementById('thumbnail-text-edit');
    if (!textarea) {
        showToast('Không tìm thấy textarea', 'error');
        return;
    }

    const newText = textarea.value.trim();

    // Cập nhật trong results
    if (results[resultIndex]) {
        results[resultIndex].thumbnailText = newText;
    }

    // Cập nhật trong bảng
    const displayIndex = resultIndex + 1;
    const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
    if (textElement) {
        textElement.textContent = newText || 'Không có chữ';
        textElement.classList.remove('loading');
    }

    showToast('Đã lưu text OCR thành công!', 'success');

    // Đóng modal sau khi lưu
    closeThumbnailModal();
};

function getDownloadableThumbnailItems() {
    return results.filter(video => video && video.thumbnail).map((video, index) => ({
        order: index + 1,
        title: video.title || `Thumbnail ${index + 1}`,
        thumbnailUrl: video.thumbnail
    }));
}

function buildThumbnailNamesPlaceholder(items) {
    return items.map(item => `${item.order}. ${item.title}`).join('\n');
}

function openThumbnailDownloadModal() {
    const thumbnailItems = getDownloadableThumbnailItems();

    if (thumbnailItems.length === 0) {
        showToast('Khong co thumbnail de tai', 'warning');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';

    modal.innerHTML = `
        <div class="modal-content thumbnail-download-modal-content">
            <span class="close" onclick="closeThumbnailDownloadModal()">&times;</span>
            <div class="modal-header">
                <h2>Tai Thumbnail</h2>
            </div>
            <div class="modal-body">
                <p class="thumbnail-download-help">
                    Nhap ${thumbnailItems.length} ten file theo thu tu tu tren xuong duoi, moi dong mot ten.
                </p>
                <textarea
                    id="thumbnail-filenames-input"
                    class="thumbnail-filenames-input"
                    rows="12"
                    placeholder="${escapeHtml(buildThumbnailNamesPlaceholder(thumbnailItems))}"
                ></textarea>
                <div class="thumbnail-download-actions">
                    <button class="btn-primary" onclick="confirmThumbnailDownload()">Chon thu muc va tai</button>
                    <button class="btn-secondary" onclick="closeThumbnailDownloadModal()">Dong</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    window.currentThumbnailDownloadModal = modal;

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeThumbnailDownloadModal();
        }
    });
}

window.closeThumbnailDownloadModal = function () {
    if (window.currentThumbnailDownloadModal) {
        window.currentThumbnailDownloadModal.style.display = 'none';
        document.body.removeChild(window.currentThumbnailDownloadModal);
        window.currentThumbnailDownloadModal = null;
    }
};

window.confirmThumbnailDownload = async function () {
    const thumbnailItems = getDownloadableThumbnailItems();
    const textarea = document.getElementById('thumbnail-filenames-input');

    if (!textarea) {
        showToast('Khong tim thay o nhap ten file', 'error');
        return;
    }

    const fileNames = textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (fileNames.length !== thumbnailItems.length) {
        showToast(`Can nhap dung ${thumbnailItems.length} ten file theo thu tu tu tren xuong duoi`, 'warning', 4000);
        return;
    }

    const folderResult = await window.electronAPI.selectFolder();
    if (!folderResult || folderResult.canceled) {
        return;
    }

    if (folderResult.error || !folderResult.folderPath) {
        showToast(folderResult.error || 'Khong chon duoc thu muc luu', 'error');
        return;
    }

    const downloadResult = await window.electronAPI.downloadThumbnailsBatch({
        folderPath: folderResult.folderPath,
        items: thumbnailItems.map((item, index) => ({
            thumbnailUrl: item.thumbnailUrl,
            fileName: fileNames[index]
        }))
    });

    if (!downloadResult.success) {
        showToast(downloadResult.error || 'Khong the tai thumbnail', 'error', 4000);
        return;
    }

    closeThumbnailDownloadModal();
    showToast(`Da tai ${downloadResult.savedFiles.length} thumbnail thanh cong`, 'success', 4000);
};

window.openVideo = function (url) {
    window.electronAPI.openExternal(url);
};

// Hàm hiển thị toast notification
// Hiển thị thông báo lỗi cookie và mở Settings
function showCookieErrorNotification() {
    showToast('YouTube yêu cầu cập nhật cookies. Vui lòng vào Settings để cập nhật cookies.', 'error', 5000);
    // Mở Settings modal sau 1 giây
    setTimeout(() => {
        openSettings();
        // Scroll đến phần cookies trong Settings
        if (ytDlpCookiesInput) {
            setTimeout(() => {
                ytDlpCookiesInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ytDlpCookiesInput.focus();
            }, 300);
        }
    }, 1000);
}

function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.success}</div>
        <div class="toast-content">
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
    `;

    toastContainer.appendChild(toast);

    // Tự động xóa sau duration
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// Hàm copy text OCR từ thumbnail
window.copyThumbnailText = function (index) {
    try {
        const videoData = results[index];
        if (!videoData) {
            console.error('Video data not found at index:', index);
            showToast('Không tìm thấy dữ liệu video', 'error');
            return;
        }

        // Lấy text từ results hoặc từ element
        let thumbnailText = '';
        if (videoData.thumbnailText) {
            thumbnailText = videoData.thumbnailText;
        } else {
            const displayIndex = index + 1;
            const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
            if (textElement) {
                thumbnailText = textElement.textContent || '';
            }
        }

        if (!thumbnailText || thumbnailText === 'Không có chữ' || thumbnailText === 'Đang xử lý OCR...') {
            showToast('Không có text OCR để copy', 'warning');
            return;
        }

        // Copy text với đúng định dạng (giữ nguyên xuống dòng)
        navigator.clipboard.writeText(thumbnailText).then(() => {
            showToast('Đã copy text OCR vào clipboard!', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback: tạo textarea và copy
            const textarea = document.createElement('textarea');
            textarea.value = thumbnailText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Đã copy text OCR vào clipboard!', 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy text OCR. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        });
    } catch (error) {
        console.error('Error in copyThumbnailText:', error);
        showToast('Lỗi khi copy text OCR: ' + error.message, 'error');
    }
};

// Hàm copy tất cả dữ liệu của tất cả video (mỗi video một dòng)
function copyAllVideosData() {
    try {
        if (!results || results.length === 0) {
            showToast('Không có dữ liệu video để copy', 'warning');
            return;
        }

        // Tạo dữ liệu cho tất cả video, mỗi video một dòng
        const allVideosData = results.map((videoData, index) => {
            // Cột 1: Link video YouTube
            const column1 = videoData.url || '';

            // Cột 2: Tiêu đề + Thumbnail text
            let column2 = '"';
            if (videoData.title) {
                column2 += `Tiêu đề: ${videoData.title.replace(/\"/g, '“')}`;
            }

            // Lấy thumbnail text
            let thumbnailText = '';
            if (videoData.thumbnailText) {
                thumbnailText = videoData.thumbnailText;
            } else {
                // Sử dụng displayIndex đã lưu trong videoData
                const displayIndex = videoData.displayIndex || (index + 1);
                const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
                if (textElement && !textElement.classList.contains('loading')) {
                    thumbnailText = textElement.textContent || '';
                }
            }

            if (thumbnailText && thumbnailText !== 'Không có chữ' && thumbnailText !== 'Đang xử lý OCR...') {
                if (column2) {
                    column2 += '\nThumbnail:\n';
                } else {
                    column2 += 'Thumbnail:\n';
                }
                column2 += thumbnailText.replace(/\"/g, '“') + '"';
            } else if (column2) {
                column2 += '"';
            }

            // Cột 3: Transcript
            let column3 = '"';
            if (videoData.subtitle) {
                column3 += `Tiêu đề: ${videoData.title.replace(/\"/g, '“')}`
                    + '\n\nThumbnail:\n'
                    + thumbnailText.replace(/\"/g, '“')
                    + '\n\nTranscript:\n'
                    + formatSubtitle(videoData.subtitle).replace(/\"/g, '“');


            }

            if (!column3 || column3 === 'Không có') {
                column3 += '';
            }
            column3 += '"';
            // Kết hợp các cột với tab separator (Excel format)
            return `${column1}\t${column2}\t${column3}`;
        });

        // Kết hợp tất cả các dòng với xuống dòng
        const excelData = allVideosData.join('\n');

        // Copy vào clipboard
        navigator.clipboard.writeText(excelData).then(() => {
            showToast(`Đã copy dữ liệu của ${results.length} video vào clipboard! Có thể paste vào Excel.`, 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback: tạo textarea và copy
            const textarea = document.createElement('textarea');
            textarea.value = excelData;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast(`Đã copy dữ liệu của ${results.length} video vào clipboard! Có thể paste vào Excel.`, 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy dữ liệu. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        });
    } catch (error) {
        console.error('Error in copyAllVideosData:', error);
        showToast('Lỗi khi copy dữ liệu: ' + error.message, 'error');
    }
}

// Hàm copy tất cả dữ liệu theo format Excel
window.copyAllData = function (index) {
    try {
        const videoData = results[index];
        if (!videoData) {
            console.error('Video data not found at index:', index);
            showToast('Không tìm thấy dữ liệu video', 'error');
            return;
        }

        // Cột 1: Link video YouTube
        const column1 = videoData.url || '';

        // Cột 2: Tiêu đề + Thumbnail text
        let column2 = '';
        if (videoData.title) {
            column2 += `"Tiêu đề: ${videoData.title}`;
        }

        // Lấy thumbnail text
        let thumbnailText = '';
        if (videoData.thumbnailText) {
            thumbnailText = videoData.thumbnailText;
        } else {
            const displayIndex = index + 1;
            const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
            if (textElement && !textElement.classList.contains('loading')) {
                thumbnailText = textElement.textContent || '';
            }
        }

        if (thumbnailText && thumbnailText !== 'Không có chữ' && thumbnailText !== 'Đang xử lý OCR...') {
            // Làm sạch thumbnail text: thay thế tất cả các ký tự xuống dòng và whitespace nhiều lần bằng một dấu cách
            // const cleanThumbnailText = thumbnailText
            //     .replace(/[\r\n\t]+/g, ' ')  // Thay \r, \n, \t bằng space
            //     .replace(/\s+/g, ' ')          // Thay nhiều space liên tiếp bằng một space
            //     .trim();

            if (column2) {
                // Không dùng xuống dòng, chỉ dùng dấu cách để tránh Excel hiểu nhầm
                column2 += '\nThumbnail:\n';
            } else {
                column2 += 'Thumbnail:\n';
            }
            column2 += thumbnailText + '"';
        }


        // Cột 3: Transcript
        let column3 = '';
        if (videoData.subtitle) {
            column3 = formatSubtitle(videoData.subtitle);
        }
        if (!column3 || column3 === 'Không có') {
            column3 = '';
        }

        // Kết hợp các cột với tab separator (Excel format)
        const excelData = `${column1}\t${column2}\t${column3}`;

        // Copy vào clipboard
        navigator.clipboard.writeText(excelData).then(() => {
            showToast('Đã copy dữ liệu vào clipboard! Có thể paste vào Excel.', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback: tạo textarea và copy
            const textarea = document.createElement('textarea');
            textarea.value = excelData;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Đã copy dữ liệu vào clipboard! Có thể paste vào Excel.', 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy dữ liệu. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        });
    } catch (error) {
        console.error('Error in copyAllData:', error);
        showToast('Lỗi khi copy dữ liệu: ' + error.message, 'error');
    }
};

window.copyTranscript = function (index) {
    try {
        const videoData = results[index];
        if (!videoData) {
            console.error('Video data not found at index:', index);
            showToast('Không tìm thấy dữ liệu video', 'error');
            return;
        }

        if (!videoData.subtitle) {
            showToast('Video này không có transcript', 'warning');
            return;
        }

        // Copy full transcript đã format (không có timestamp, chỉ text)
        const fullText = formatSubtitle(videoData.subtitle);

        if (!fullText || fullText === 'Không có') {
            showToast('Không có nội dung transcript để copy', 'warning');
            return;
        }

        navigator.clipboard.writeText(fullText).then(() => {
            showToast('Đã copy transcript vào clipboard!', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            // Fallback: tạo textarea và copy
            const textarea = document.createElement('textarea');
            textarea.value = fullText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Đã copy transcript vào clipboard!', 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy transcript. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        });
    } catch (error) {
        console.error('Error in copyTranscript:', error);
        showToast('Lỗi khi copy transcript: ' + error.message, 'error');
    }
};

// Settings functions
async function loadSettings() {
    try {
        const settings = await window.electronAPI.getSettings();

        // Load OCR provider
        const ocrProvider = settings.ocrProvider || 'microsoft';
        if (ocrProvider === 'google') {
            ocrProviderGoogle.checked = true;
            document.getElementById('microsoft-vision-settings').style.display = 'none';
            document.getElementById('microsoft-vision-endpoint-settings').style.display = 'none';
            document.getElementById('google-vision-settings').style.display = 'block';
        } else {
            ocrProviderMicrosoft.checked = true;
            document.getElementById('microsoft-vision-settings').style.display = 'block';
            document.getElementById('microsoft-vision-endpoint-settings').style.display = 'block';
            document.getElementById('google-vision-settings').style.display = 'none';
        }

        // Load Microsoft Vision settings
        if (settings.microsoftVision) {
            visionApiKeyInput.value = settings.microsoftVision.apiKey || '';
            visionEndpointInput.value = settings.microsoftVision.endpoint || '';
        }

        // Load Google Vision settings
        if (settings.googleVision) {
            // Nếu là array, join bằng newline; nếu là string, dùng trực tiếp
            if (Array.isArray(settings.googleVision.apiKeys)) {
                googleVisionApiKeyInput.value = settings.googleVision.apiKeys.join('\n');
            } else if (settings.googleVision.apiKey) {
                // Backward compatibility: nếu có apiKey cũ, dùng nó
                googleVisionApiKeyInput.value = settings.googleVision.apiKey;
            } else if (settings.googleVision.apiKeys) {
                // Nếu là string với newline
                googleVisionApiKeyInput.value = settings.googleVision.apiKeys;
            }
        }

        // Load Google TTS settings
        if (settings.googleTts && settings.googleTts.apiKey) {
            googleTtsApiKeyInput.value = settings.googleTts.apiKey;
        }

        // Load yt-dlp cookies
        ytDlpCookiesInput.value = settings.ytDlpCookies || '';
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function openSettings() {
    settingsModal.style.display = 'flex';
    loadSettings();
}

function closeSettings() {
    settingsModal.style.display = 'none';
    settingsStatus.style.display = 'none';
}

async function saveSettings() {
    const ocrProvider = ocrProviderMicrosoft.checked ? 'microsoft' : 'google';
    const microsoftApiKey = visionApiKeyInput.value.trim();
    const microsoftEndpoint = visionEndpointInput.value.trim();
    const googleApiKeysText = googleVisionApiKeyInput.value.trim();
    const googleTtsApiKey = googleTtsApiKeyInput.value.trim();
    const cookies = ytDlpCookiesInput.value.trim();

    // Validate Microsoft Vision settings (nếu chọn Microsoft và có nhập)
    if (ocrProvider === 'microsoft' && (microsoftApiKey || microsoftEndpoint)) {
        if (!microsoftApiKey || !microsoftEndpoint) {
            showSettingsStatus('Vui lòng nhập đầy đủ API Key và Endpoint cho Microsoft Vision hoặc để trống cả hai', 'error');
            return;
        }

        // Validate endpoint format
        if (!microsoftEndpoint.startsWith('http://') && !microsoftEndpoint.startsWith('https://')) {
            showSettingsStatus('Endpoint phải bắt đầu bằng http:// hoặc https://', 'error');
            return;
        }
    }

    // Validate Google AI Studio settings (nếu chọn Google và có nhập)
    if (ocrProvider === 'google' && googleApiKeysText) {
        // Parse danh sách API keys (mỗi dòng một key)
        const apiKeys = googleApiKeysText
            .split('\n')
            .map(key => key.trim())
            .filter(key => key.length > 0);

        if (apiKeys.length === 0) {
            showSettingsStatus('Vui lòng nhập ít nhất một Google AI Studio API Key', 'error');
            return;
        }
    }

    try {
        // Parse Google API keys into array (parse regardless of selected provider)
        let googleApiKeys = [];
        if (googleApiKeysText) {
            googleApiKeys = googleApiKeysText
                .split('\n')
                .map(key => key.trim())
                .filter(key => key.length > 0);
        }

        // Build payload. Only include googleVision when we actually have keys to save
        const settingsPayload = {
            ocrProvider: ocrProvider,
            microsoftVision: {
                apiKey: microsoftApiKey,
                endpoint: microsoftEndpoint
            },
            ytDlpCookies: cookies
        };

        if (googleApiKeys.length > 0) {
            settingsPayload.googleVision = { apiKeys: googleApiKeys };
        }

        // Save Google TTS API Key
        if (googleTtsApiKey) {
            settingsPayload.googleTts = { apiKey: googleTtsApiKey };
        }

        await window.electronAPI.saveSettings(settingsPayload);
        showSettingsStatus('Đã lưu settings thành công!', 'success');
        closeSettings();
    } catch (error) {
        console.error('Error saving settings:', error);
        showSettingsStatus('Lỗi khi lưu settings: ' + error.message, 'error');
    }
}

function showSettingsStatus(message, type) {
    settingsStatus.textContent = message;
    settingsStatus.className = `settings-status ${type}`;
    settingsStatus.style.display = 'block';
}

// Tab switching functionality
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');

        // Remove active class from all tabs and contents
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // Add active class to clicked tab and corresponding content
        button.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
    });
});

// Download functionality
const downloadUrlsTextarea = document.getElementById('download-urls');
const downloadQualitySelect = document.getElementById('download-quality');
const downloadFolderInput = document.getElementById('download-folder');
const namingPatternInput = document.getElementById('naming-pattern');
const selectFolderBtn = document.getElementById('select-folder-btn');
const startDownloadBtn = document.getElementById('start-download-btn');
const downloadProgressSection = document.getElementById('download-progress-section');
const downloadBody = document.getElementById('download-body');

// Download type and segment options
const downloadTypeRadios = document.querySelectorAll('input[name="download-type"]');
const segmentOptions = document.getElementById('segment-options');
const startTimeInput = document.getElementById('start-time');
const endTimeInput = document.getElementById('end-time');
const downloadAudioOnlyCheckbox = document.getElementById('download-audio-only');

// Load download settings on page load
async function loadDownloadSettings() {
    try {
        const settings = await window.electronAPI.getDownloadSettings();
        if (settings) {
            if (settings.folder) {
                downloadFolderInput.value = settings.folder;
            }
            if (settings.quality) {
                downloadQualitySelect.value = settings.quality;
            }
        }
    } catch (error) {
        console.error('Error loading download settings:', error);
    }
}

// Save download settings when quality changes
downloadQualitySelect.addEventListener('change', async () => {
    try {
        await window.electronAPI.saveDownloadSettings({
            folder: downloadFolderInput.value,
            quality: downloadQualitySelect.value
        });
    } catch (error) {
        console.error('Error saving download settings:', error);
    }
});

let downloadTasks = [];
let downloadQueue = [];
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = window.APP_CONFIG?.MAX_CONCURRENT_DOWNLOADS || 5; // Config trong config.js

// Select folder button
selectFolderBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.selectFolder();
        if (result && result.folderPath) {
            downloadFolderInput.value = result.folderPath;
            // Save to settings
            await window.electronAPI.saveDownloadSettings({
                folder: result.folderPath,
                quality: downloadQualitySelect.value
            });
        }
    } catch (error) {
        console.error('Error selecting folder:', error);
        showToast('Lỗi khi chọn thư mục: ' + error.message, 'error');
    }
});

// Click vào input thư mục để mở folder
downloadFolderInput.addEventListener('click', async () => {
    const folderPath = downloadFolderInput.value.trim();
    if (folderPath) {
        try {
            await window.electronAPI.openFolder(folderPath);
        } catch (error) {
            console.error('Error opening folder:', error);
        }
    } else {
        // Nếu chưa có folder, mở dialog chọn folder
        selectFolderBtn.click();
    }
});

// Handle download type radio buttons
downloadTypeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        if (radio.value === 'segment') {
            segmentOptions.style.display = 'block';
        } else {
            segmentOptions.style.display = 'none';
            // Clear time inputs when switching to full video
            if (startTimeInput) startTimeInput.value = '';
            if (endTimeInput) endTimeInput.value = '';
        }
    });
});

// Real-time validation for time inputs
if (startTimeInput) {
    startTimeInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        if (value) {
            const seconds = parseTimeInput(value);
            if (seconds !== null) {
                e.target.style.borderColor = '#28a745';
                e.target.style.backgroundColor = '#f0fff4';
            } else {
                e.target.style.borderColor = '#dc3545';
                e.target.style.backgroundColor = '#fff5f5';
            }
        } else {
            e.target.style.borderColor = '';
            e.target.style.backgroundColor = '';
        }
    });
    
    startTimeInput.addEventListener('blur', (e) => {
        const value = e.target.value.trim();
        if (value) {
            const seconds = parseTimeInput(value);
            if (seconds !== null) {
                // Auto-format to friendly display
                e.target.value = formatTimeDisplay(seconds);
                e.target.style.borderColor = '#28a745';
                e.target.style.backgroundColor = '#f0fff4';
            }
        }
    });
}

if (endTimeInput) {
    endTimeInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        if (value) {
            const seconds = parseTimeInput(value);
            if (seconds !== null) {
                e.target.style.borderColor = '#28a745';
                e.target.style.backgroundColor = '#f0fff4';
            } else {
                e.target.style.borderColor = '#dc3545';
                e.target.style.backgroundColor = '#fff5f5';
            }
        } else {
            e.target.style.borderColor = '';
            e.target.style.backgroundColor = '';
        }
    });
    
    endTimeInput.addEventListener('blur', (e) => {
        const value = e.target.value.trim();
        if (value) {
            const seconds = parseTimeInput(value);
            if (seconds !== null) {
                // Auto-format to friendly display
                e.target.value = formatTimeDisplay(seconds);
                e.target.style.borderColor = '#28a745';
                e.target.style.backgroundColor = '#f0fff4';
            }
        }
    });
}

// Helper functions for time validation and conversion
function parseTimeInput(timeStr) {
    if (!timeStr || !timeStr.trim()) return null;
    
    const time = timeStr.trim();
    
    // Format 1: Chỉ số (giây) - ví dụ: 90, 300
    if (/^\d+$/.test(time)) {
        const seconds = parseInt(time, 10);
        if (seconds >= 0 && seconds < 86400) { // Max 24 hours
            return seconds;
        }
        return null;
    }
    
    // Format 1b: Số + "s" (giây) - ví dụ: 30s, 0s
    const secondsMatch = time.match(/^(\d+)s$/i);
    if (secondsMatch) {
        const seconds = parseInt(secondsMatch[1], 10);
        if (seconds >= 0 && seconds < 86400) {
            return seconds;
        }
        return null;
    }
    
    // Format 2: MM:SS hoặc M:SS - ví dụ: 1:30, 5:00, 0:00
    const mmssMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (mmssMatch) {
        const minutes = parseInt(mmssMatch[1], 10);
        const seconds = parseInt(mmssMatch[2], 10);
        if (minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
            return minutes * 60 + seconds;
        }
        return null;
    }
    
    // Format 3: HH:MM:SS hoặc H:MM:SS - ví dụ: 0:01:30, 1:05:00
    const hhmmssMatch = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (hhmmssMatch) {
        const hours = parseInt(hhmmssMatch[1], 10);
        const minutes = parseInt(hhmmssMatch[2], 10);
        const seconds = parseInt(hhmmssMatch[3], 10);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
            return hours * 3600 + minutes * 60 + seconds;
        }
        return null;
    }
    
    return null;
}

function isValidTimeFormat(time) {
    return parseTimeInput(time) !== null;
}

function timeToSeconds(time) {
    const seconds = parseTimeInput(time);
    return seconds !== null ? seconds : 0;
}

function formatTimeToHHMMSS(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeDisplay(seconds) {
    if (seconds < 3600) {
        // Luôn hiển thị format MM:SS cho tất cả giá trị < 1 giờ
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    } else {
        return formatTimeToHHMMSS(seconds);
    }
}

// Quick time buttons - setup after elements are available
if (startTimeInput && endTimeInput) {
    // Use event delegation for dynamically created buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('quick-time-btn')) {
            const btn = e.target;
            const seconds = parseInt(btn.dataset.time, 10);
            const target = btn.dataset.target;
            const input = target === 'start' ? startTimeInput : endTimeInput;
            
            if (input) {
                // Format hiển thị thân thiện
                const displayTime = formatTimeDisplay(seconds);
                input.value = displayTime;
                
                // Trigger input event để validate
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });
}

// Start download button
startDownloadBtn.addEventListener('click', async () => {
    const urls = downloadUrlsTextarea.value.trim();
    const folder = downloadFolderInput.value.trim();
    const namingPattern = namingPatternInput.value.trim();
    const downloadType = document.querySelector('input[name="download-type"]:checked').value;
    const audioOnly = !!(downloadAudioOnlyCheckbox && downloadAudioOnlyCheckbox.checked);
    let startTime = startTimeInput.value.trim();
    let endTime = endTimeInput.value.trim();

    if (!urls) {
        showToast('Vui lòng nhập danh sách link YouTube', 'error');
        return;
    }

    if (!folder) {
        showToast('Vui lòng chọn thư mục lưu', 'error');
        return;
    }

    // Naming pattern is optional - if empty, will use video title from YouTube

    // Validate segment download options
    if (downloadType === 'segment') {
        // Check if start time is provided and valid
        if (!startTime) {
            showToast('Vui lòng nhập thời gian bắt đầu cho đoạn video', 'error');
            startTimeInput.focus();
            return;
        }

        const startSeconds = parseTimeInput(startTime);
        if (startSeconds === null) {
            showToast('Thời gian bắt đầu không hợp lệ. Có thể nhập: số giây (90), phút:giây (1:30), hoặc giờ:phút:giây (0:01:30)', 'error');
            startTimeInput.focus();
            return;
        }

        // Check if end time is provided and valid
        if (!endTime) {
            showToast('Vui lòng nhập thời gian kết thúc cho đoạn video', 'error');
            endTimeInput.focus();
            return;
        }

        const endSeconds = parseTimeInput(endTime);
        if (endSeconds === null) {
            showToast('Thời gian kết thúc không hợp lệ. Có thể nhập: số giây (300), phút:giây (5:00), hoặc giờ:phút:giây (0:05:00)', 'error');
            endTimeInput.focus();
            return;
        }

        // Check if start time is before end time
        if (startSeconds >= endSeconds) {
            showToast('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc', 'error');
            startTimeInput.focus();
            return;
        }

        // Convert to HH:MM:SS format for backend
        const startTimeFormatted = formatTimeToHHMMSS(startSeconds);
        const endTimeFormatted = formatTimeToHHMMSS(endSeconds);
        
        // Update variables to use formatted time
        startTime = startTimeFormatted;
        endTime = endTimeFormatted;
    }

    // Parse URLs
    const urlList = urls.split('\n')
        .map(url => url.trim())
        .filter(url => url && (url.includes('youtube.com') || url.includes('youtu.be')));

    if (urlList.length === 0) {
        showToast('Không tìm thấy link YouTube hợp lệ', 'error');
        return;
    }

    // Helper function to sanitize filename
    function sanitizeFileName(fileName) {
        // Remove invalid characters for Windows/Linux filenames
        return fileName
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim()
            .substring(0, 200); // Limit length
    }

    // If no naming pattern, fetch video titles from YouTube
    if (!namingPattern) {
        // Show progress
        downloadProgressSection.style.display = 'block';
        renderDownloadTable();
        startDownloadBtn.disabled = true;
        const btnText = startDownloadBtn.querySelector('.btn-text');
        const btnLoader = startDownloadBtn.querySelector('.btn-loader');
        btnText.style.display = 'none';
        btnLoader.style.display = 'inline';

        // Fetch video info for all URLs
        downloadTasks = [];
        for (let i = 0; i < urlList.length; i++) {
            const url = urlList[i];
            try {
                const result = await window.electronAPI.getVideoInfo(url);
                if (result.success && result.data && result.data.title) {
                    const videoTitle = sanitizeFileName(result.data.title);
                    downloadTasks.push({
                        id: i,
                        url,
                        fileName: videoTitle,
                        status: 'waiting',
                        progress: 0,
                        error: null,
                        audioOnly,
                        downloadType,
                        startTime: downloadType === 'segment' ? startTime : null,
                        endTime: downloadType === 'segment' ? endTime : null
                    });
                } else {
                    // Fallback to video ID if title not available
                    const videoId = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || `video_${i + 1}`;
                    downloadTasks.push({
                        id: i,
                        url,
                        fileName: videoId,
                        status: 'waiting',
                        progress: 0,
                        error: null,
                        audioOnly,
                        downloadType,
                        startTime: downloadType === 'segment' ? startTime : null,
                        endTime: downloadType === 'segment' ? endTime : null
                    });
                }
            } catch (error) {
                console.error(`Error fetching video info for ${url}:`, error);
                // Fallback to video ID
                const videoId = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || `video_${i + 1}`;
                downloadTasks.push({
                    id: i,
                    url,
                    fileName: videoId,
                    status: 'waiting',
                    progress: 0,
                    error: null,
                    audioOnly,
                    downloadType,
                    startTime: downloadType === 'segment' ? startTime : null,
                    endTime: downloadType === 'segment' ? endTime : null
                });
            }
        }

        // Render table with fetched titles
        renderDownloadTable();
        
        // Start downloads
        downloadQueue = [...downloadTasks];
        activeDownloads = 0;

        // Start initial batch
        for (let i = 0; i < Math.min(MAX_CONCURRENT_DOWNLOADS, downloadQueue.length); i++) {
            processNextDownload();
        }
        return;
    }

    // Extract number from naming pattern - support multiple formats:
    // BAC-005, BAC005, 005
    // Strategy: Find the number at the end, rest is prefix

    // First, check if it's just a number
    if (/^\d+$/.test(namingPattern)) {
        // Only number: 005
        const startNumber = parseInt(namingPattern, 10);
        const numberPadding = namingPattern.length;

        downloadTasks = urlList.map((url, index) => {
            const number = startNumber - index; // Giảm dần
            const fileName = String(number).padStart(numberPadding, '0');
            return {
                id: index,
                url,
                fileName,
                status: 'waiting',
                progress: 0,
                error: null,
                downloadType,
                startTime: downloadType === 'segment' ? startTime : null,
                endTime: downloadType === 'segment' ? endTime : null
            };
        });
    } else {
        // Has prefix: BAC-005 or BAC005
        // Strategy: Find the last occurrence of a number sequence at the end
        // This handles both BAC-005 and BAC005 correctly

        // Try to match with dash first: BAC-005
        let match = namingPattern.match(/^(.+)-(\d+)$/);
        let separator = '-';

    if (!match) {
            // No dash, try without: BAC005
            // Find where the number sequence starts at the end
            const numberMatch = namingPattern.match(/(\d+)$/);
            if (!numberMatch) {
                showToast('Quy cách đặt tên không đúng (ví dụ: BAC-005, BAC005, hoặc 005)', 'error');
        return;
    }

            const numberStart = namingPattern.length - numberMatch[1].length;
            const prefix = namingPattern.substring(0, numberStart);
            const startNumber = parseInt(numberMatch[1], 10);
            const numberPadding = numberMatch[1].length;
            separator = ''; // No separator

    // Initialize download tasks
    downloadTasks = urlList.map((url, index) => {
        const number = startNumber - index; // Giảm dần
                const numberStr = String(number).padStart(numberPadding, '0');
                const fileName = `${prefix}${numberStr}`;
        return {
            id: index,
            url,
            fileName,
            status: 'waiting',
            progress: 0,
            error: null,
            audioOnly,
            downloadType,
            startTime: downloadType === 'segment' ? startTime : null,
            endTime: downloadType === 'segment' ? endTime : null
        };
    });
        } else {
            // Has dash: BAC-005
            const prefix = match[1];
            const startNumber = parseInt(match[2], 10);
            const numberPadding = match[2].length;

            // Initialize download tasks
            downloadTasks = urlList.map((url, index) => {
                const number = startNumber - index; // Giảm dần
                const numberStr = String(number).padStart(numberPadding, '0');
                const fileName = `${prefix}-${numberStr}`;
                return {
                    id: index,
                    url,
                    fileName,
                    status: 'waiting',
                    progress: 0,
                    error: null,
                    audioOnly,
                    downloadType,
                    startTime: downloadType === 'segment' ? startTime : null,
                    endTime: downloadType === 'segment' ? endTime : null
                };
            });
        }
    }

    // Render table immediately
    downloadProgressSection.style.display = 'block';
    renderDownloadTable();

    // Disable button
    startDownloadBtn.disabled = true;
    const btnText = startDownloadBtn.querySelector('.btn-text');
    const btnLoader = startDownloadBtn.querySelector('.btn-loader');
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline';

    // Start downloads
    downloadQueue = [...downloadTasks];
    activeDownloads = 0;

    // Start initial batch
    for (let i = 0; i < Math.min(MAX_CONCURRENT_DOWNLOADS, downloadQueue.length); i++) {
        processNextDownload();
    }
});

function processNextDownload() {
    // Check if we can start more downloads
    while (downloadQueue.length > 0 && activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
        const task = downloadQueue.shift();
        if (!task) break;

        activeDownloads++;
        task.status = 'fetching'; // Đang lấy thông tin
        updateDownloadRow(task);

        // Start download (don't await, let it run in parallel)
        downloadVideo(task).catch(error => {
            console.error(`Error downloading task ${task.id}:`, error);
            task.status = 'error';
            task.error = error.message;
            updateDownloadRow(task);
            activeDownloads = Math.max(0, activeDownloads - 1);
            processNextDownload();
        });
    }
}

async function downloadVideo(task) {
    try {
        const quality = downloadQualitySelect.value;
        const folder = downloadFolderInput.value;

        // Listen for progress updates (set up before starting download)
        // Use a unique handler for this task
        const progressHandler = (data) => {
            if (String(data.taskId) === String(task.id)) {
                if (data.status === 'fetching') {
                    task.status = 'fetching';
                    task.progress = 0;
                } else if (data.status === 'downloading') {
                    task.status = 'downloading';
                    task.progress = data.progress || 0;
                } else if (data.status === 'cookie-error') {
                    task.status = 'cookie-error';
                    task.progress = 0;
                    task.error = data.error || 'Vui lòng cập nhật cookies trong Settings';
                    updateDownloadRow(task);
                    // Hiển thị thông báo và mở Settings
                    showCookieErrorNotification();
                }
                updateDownloadRow(task);
            }
        };

        window.electronAPI.onDownloadProgress(progressHandler);

        // Start download with taskId
        const downloadPromise = window.electronAPI.downloadVideo({
            url: task.url,
            folder: folder,
            fileName: task.fileName,
            quality: quality,
            taskId: task.id,
            audioOnly: !!task.audioOnly,
            downloadType: task.downloadType,
            startTime: task.startTime,
            endTime: task.endTime
        });

        // Wait for download to complete
        const result = await downloadPromise;

        if (result.success) {
            const wasCompleted = task.status === 'completed';
            task.status = 'completed';
            task.progress = 100;
            task.filePath = result.filePath;

            // Show Windows notification when download is completed
            if (!wasCompleted) {
                const fileName = task.fileName || 'Video';
                const urlName = task.url ? (task.url.split('/').pop() || task.url) : 'Video';

                console.log('Download completed, showing notification:', { fileName, urlName });

                // Check if Notification API is available
                if ('Notification' in window) {
                    // Request permission if needed
                    if (Notification.permission === 'default') {
                        Notification.requestPermission().then(permission => {
                            console.log('Notification permission:', permission);
                            if (permission === 'granted') {
                                showDownloadCompletedNotification(fileName, urlName);
                            } else {
                                console.warn('Notification permission denied');
                            }
                        }).catch(err => {
                            console.error('Error requesting notification permission:', err);
                        });
                    } else if (Notification.permission === 'granted') {
                        showDownloadCompletedNotification(fileName, urlName);
                    } else {
                        console.warn('Notification permission denied or not available');
                    }
                } else {
                    console.warn('Notification API not available in this browser');
                }
            }
        } else {
            // Kiểm tra nếu lỗi liên quan đến cookie
            if (result.error && result.error.includes('COOKIE_ERROR')) {
                task.status = 'cookie-error';
                task.error = 'Vui lòng cập nhật cookies trong Settings';
                showCookieErrorNotification();
            } else {
                task.status = 'error';
                task.error = result.error || 'Lỗi không xác định';
            }
        }

        updateDownloadRow(task);
    } catch (error) {
        // Kiểm tra nếu lỗi liên quan đến cookie
        if (error.message && error.message.includes('COOKIE_ERROR')) {
            task.status = 'cookie-error';
            task.error = 'Vui lòng cập nhật cookies trong Settings';
            showCookieErrorNotification();
        } else {
            task.status = 'error';
            task.error = error.message;
        }
        updateDownloadRow(task);
    } finally {
        activeDownloads--;
        // Process next download
        processNextDownload();

        // Check if all downloads are done
        if (downloadQueue.length === 0 && activeDownloads === 0) {
            const btnText = startDownloadBtn.querySelector('.btn-text');
            const btnLoader = startDownloadBtn.querySelector('.btn-loader');
            btnText.style.display = 'inline';
            btnLoader.style.display = 'none';
            startDownloadBtn.disabled = false;
            showToast('Đã hoàn thành tất cả video!', 'success');
        }
    }
}

function renderDownloadTable() {
    downloadBody.innerHTML = '';
    downloadTasks.forEach(task => {
        const row = createDownloadRow(task);
        downloadBody.appendChild(row);
    });
}

function createDownloadRow(task) {
    const row = document.createElement('tr');
    row.id = `download-row-${task.id}`;

    const statusClass = task.status === 'waiting' ? 'waiting' :
        task.status === 'fetching' ? 'fetching' :
            task.status === 'downloading' ? 'downloading' :
                task.status === 'completed' ? 'completed' :
                    task.status === 'cookie-error' ? 'cookie-error' : 'error';

    const statusText = task.status === 'waiting' ? 'Đang chờ' :
        task.status === 'fetching' ? 'Đang lấy thông tin' :
            task.status === 'downloading' ? 'Đang tải' :
                task.status === 'completed' ? 'Hoàn thành' :
                    task.status === 'cookie-error' ? 'Cần cập nhật cookies' : 'Lỗi';

    row.innerHTML = `
        <td>${task.id + 1}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(task.fileName || '')}">${escapeHtml(task.fileName || '-')}</td>
        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(task.url)}">${escapeHtml(task.url)}</td>
        <td>
            <div><span class="download-status ${statusClass}">${statusText}</span></div>
            <div style="margin-top: 8px; width: 200px;">
            <div class="download-progress-bar">
                <div class="download-progress-fill" style="width: ${task.progress}%">${task.progress}%</div>
                </div>
            </div>
        </td>
    `;

    return row;
}

// Video -> Text functionality
const selectVideoBtn = document.getElementById('select-video-btn');
const videoTextModal = document.getElementById('video-text-modal');
const videoPreviewContainer = document.getElementById('video-text-preview-container');
const videoPreview = document.getElementById('video-preview');
const subtitleCropBox = document.getElementById('subtitle-crop-box');
const closeVideoTextModal = document.getElementById('close-video-text-modal');
const cancelVideoTextBtn = document.getElementById('cancel-video-text-btn');
const initVideoProcessingBtn = document.getElementById('init-video-processing-btn');
const videoTextQueueSection = document.getElementById('video-text-queue-section');
const videoTextQueueBody = document.getElementById('video-text-queue-body');

// Video controls
const videoPlayPauseBtn = document.getElementById('video-play-pause-btn');
const videoSeekBar = document.getElementById('video-seek-bar');
const videoCurrentTime = document.getElementById('video-current-time');
const videoDuration = document.getElementById('video-duration');
const videoMuteBtn = document.getElementById('video-mute-btn');
const videoVolumeBar = document.getElementById('video-volume-bar');

let currentVideoPath = null;
let currentCropBox = null;
let videoTextQueue = [];
let videoTextQueueIndex = 0;

function escapeJsString(value = '') {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, '\\n');
}

// Khởi tạo drag cho crop box
const cropInteractionState = {
    active: false,
    mode: null, // 'drag' | 'resize'
    handle: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    startRect: null,
    containerRect: null
};

// Note: Video selection click is handled by `renderer.videotext.js` module.

if (closeVideoTextModal) {
    closeVideoTextModal.addEventListener('click', closeVideoTextModalFunc);
}

if (cancelVideoTextBtn) {
    cancelVideoTextBtn.addEventListener('click', closeVideoTextModalFunc);
}

if (initVideoProcessingBtn) {
    initVideoProcessingBtn.addEventListener('click', async () => {
        if (!currentVideoPath) {
            showToast('Vui lòng chọn video trước', 'warning');
            return;
        }

        // Lấy vị trí crop box
        const cropBox = getCropBoxPosition();
        if (!cropBox) {
            showToast('Vui lòng căn chỉnh vị trí subtitle', 'warning');
            return;
        }

        // Thêm vào queue
        try {
            const result = await window.electronAPI.processVideoSubtitle(currentVideoPath, cropBox);
            if (result.success) {
                const videoData = {
                    id: videoTextQueueIndex++,
                    taskId: result.taskId,
                    videoPath: currentVideoPath,
                    cropBox: cropBox,
                    status: 'waiting',
                    progress: 0,
                    videoProgress: 0,
                    ocrProgress: 0,
                    startTime: null,
                    endTime: null,
                    duration: null
                };
                addVideoToQueue(videoData);

                // Polling để cập nhật status nếu event không đến (fallback)
                const pollInterval = setInterval(async () => {
                    const video = videoTextQueue.find(v => String(v.taskId) === String(result.taskId));
                    if (video && video.status === 'waiting') {
                        // Query status từ backend
                        try {
                            const statusResult = await window.electronAPI.getVideoSubtitleTaskStatus(result.taskId);
                            if (statusResult.success && statusResult.status !== video.status) {
                                video.status = statusResult.status;
                                video.progress = statusResult.progress || 0;
                                if (statusResult.outputDir) {
                                    video.outputDir = statusResult.outputDir;
                                }
                                if (statusResult.srtPath) {
                                    video.srtPath = statusResult.srtPath;
                                }
                                updateVideoTextQueueTable();
                            }
                        } catch (error) {
                            console.error('Error polling task status:', error);
                        }
                    } else {
                        clearInterval(pollInterval);
                    }
                }, 1000); // Poll mỗi 1 giây

                // Clear interval sau 5 phút
                setTimeout(() => clearInterval(pollInterval), 300000);

                closeVideoTextModalFunc();
                showToast('Đã thêm video vào queue', 'success');

                // If user selected multiple files, open modal for next one automatically
                if (window.pendingVideoPaths && Array.isArray(window.pendingVideoPaths) && window.pendingVideoPaths.length > 0) {
                    // Small delay to allow modal to close cleanly
                    setTimeout(() => {
                        currentVideoPath = window.pendingVideoPaths.shift();
                        openVideoTextModal();
                    }, 250);
                }
            } else {
                showToast('Lỗi: ' + (result.error || 'Không thể thêm vào queue'), 'error');
            }
        } catch (error) {
            console.error('Error processing video:', error);
            showToast('Lỗi: ' + error.message, 'error');
        }
    });
}

// Mở modal video text
// Mở modal video text. Optional `videoPath` will override `currentVideoPath`.
function openVideoTextModal(videoPath) {
    if (!videoTextModal || !videoPreview) return;

    if (videoPath) {
        currentVideoPath = videoPath;
    }

    if (!currentVideoPath) return;

    videoTextModal.style.display = 'flex';

    // Load video (use file:/// and normalize backslashes)
    try {
        videoPreview.src = `file:///${String(currentVideoPath).replace(/\\/g, '/').replace(/^\/+/, '')}`;
    } catch (e) {
        videoPreview.src = `file://${currentVideoPath}`;
    }

    // Setup video controls
    setupVideoControls();

    // Reset crop box về vị trí mặc định (giữa dưới màn hình)
    setTimeout(() => {
        resetCropBox();
    }, 100);
}

// Setup video controls
function setupVideoControls() {
    if (!videoPreview) return;

    // Play/Pause button
    if (videoPlayPauseBtn) {
        videoPlayPauseBtn.addEventListener('click', () => {
            if (videoPreview.paused) {
                videoPreview.play();
                videoPlayPauseBtn.textContent = '⏸️';
            } else {
                videoPreview.pause();
                videoPlayPauseBtn.textContent = '▶️';
            }
        });
    }

    // Update play/pause button when video plays/pauses
    videoPreview.addEventListener('play', () => {
        if (videoPlayPauseBtn) videoPlayPauseBtn.textContent = '⏸️';
    });
    videoPreview.addEventListener('pause', () => {
        if (videoPlayPauseBtn) videoPlayPauseBtn.textContent = '▶️';
    });

    // Seek bar
    if (videoSeekBar) {
        videoPreview.addEventListener('loadedmetadata', () => {
            videoSeekBar.max = videoPreview.duration;
            updateVideoDuration();
        });

        videoPreview.addEventListener('timeupdate', () => {
            if (!videoSeekBar.dragging) {
                videoSeekBar.value = videoPreview.currentTime;
            }
            updateVideoCurrentTime();
        });

        videoSeekBar.addEventListener('input', () => {
            videoSeekBar.dragging = true;
        });

        videoSeekBar.addEventListener('change', () => {
            videoPreview.currentTime = videoSeekBar.value;
            videoSeekBar.dragging = false;
        });
    }

    // Volume controls
    if (videoVolumeBar) {
        videoVolumeBar.addEventListener('input', () => {
            videoPreview.volume = videoVolumeBar.value / 100;
            if (videoMuteBtn) {
                videoMuteBtn.textContent = videoPreview.volume === 0 ? '🔇' : '🔊';
            }
        });
    }

    if (videoMuteBtn) {
        videoMuteBtn.addEventListener('click', () => {
            if (videoPreview.volume === 0) {
                videoPreview.volume = videoVolumeBar ? videoVolumeBar.value / 100 : 0.5;
                if (videoVolumeBar) videoVolumeBar.value = videoPreview.volume * 100;
                videoMuteBtn.textContent = '🔊';
            } else {
                videoPreview.volume = 0;
                if (videoVolumeBar) videoVolumeBar.value = 0;
                videoMuteBtn.textContent = '🔇';
            }
        });
    }

    // Update duration when video loads
    videoPreview.addEventListener('loadedmetadata', () => {
        updateVideoDuration();
    });
}

// Update video current time display
function updateVideoCurrentTime() {
    if (!videoCurrentTime || !videoPreview) return;
    const current = formatTime(videoPreview.currentTime);
    videoCurrentTime.textContent = current;
}

// Update video duration display
function updateVideoDuration() {
    if (!videoDuration || !videoPreview) return;
    const duration = formatTime(videoPreview.duration || 0);
    videoDuration.textContent = duration;
}

// Format time (seconds to MM:SS)
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Đóng modal video text
function closeVideoTextModalFunc() {
    if (videoTextModal) {
        videoTextModal.style.display = 'none';
    }
    if (videoPreview) {
        videoPreview.src = '';
    }
    currentVideoPath = null;
    currentCropBox = null;
}

// Reset crop box về vị trí mặc định
function resetCropBox() {
    if (!subtitleCropBox) return;

    const referenceRect = (videoPreviewContainer || videoPreview)?.getBoundingClientRect();
    if (!referenceRect) return;

    const videoWidth = referenceRect.width;
    const videoHeight = referenceRect.height;

    // Vị trí mặc định: giữa dưới, chiếm 80% chiều rộng, 15% chiều cao
    const cropWidth = videoWidth * 0.8;
    const cropHeight = videoHeight * 0.15;
    const cropX = (videoWidth - cropWidth) / 2;
    const cropY = videoHeight - cropHeight - videoHeight * 0.1; // 10% từ dưới lên

    subtitleCropBox.style.width = `${cropWidth}px`;
    subtitleCropBox.style.height = `${cropHeight}px`;
    subtitleCropBox.style.left = `${cropX}px`;
    subtitleCropBox.style.top = `${cropY}px`;
}

// Lấy vị trí crop box (tương đối với video)
function getCropBoxPosition() {
    if (!subtitleCropBox) return null;

    const referenceRect = (videoPreviewContainer || videoPreview)?.getBoundingClientRect();
    if (!referenceRect) return null;

    const cropRect = subtitleCropBox.getBoundingClientRect();

    // Tính toán vị trí tương đối (0-1)
    const x = (cropRect.left - referenceRect.left) / referenceRect.width;
    const y = (cropRect.top - referenceRect.top) / referenceRect.height;
    const width = cropRect.width / referenceRect.width;
    const height = cropRect.height / referenceRect.height;

    return { x, y, width, height };
}

// Crop box interactions using Pointer Events
function initializeCropBoxInteractions() {
    if (!subtitleCropBox || !videoPreviewContainer) return;

    subtitleCropBox.style.touchAction = 'none';

    subtitleCropBox.addEventListener('pointerdown', (event) => {
        if (!videoPreviewContainer) return;
        event.preventDefault();

        const handle = event.target.dataset?.handle || null;
        const mode = handle ? 'resize' : 'drag';
        beginCropInteraction(event, mode, handle);
    });

    subtitleCropBox.addEventListener('pointermove', handleCropPointerMove);
    subtitleCropBox.addEventListener('pointerup', endCropInteraction);
    subtitleCropBox.addEventListener('pointercancel', endCropInteraction);
}

function beginCropInteraction(event, mode, handle) {
    if (!subtitleCropBox || !videoPreviewContainer) return;

    const containerRect = videoPreviewContainer.getBoundingClientRect();
    const boxRect = subtitleCropBox.getBoundingClientRect();

    cropInteractionState.active = true;
    cropInteractionState.mode = mode;
    cropInteractionState.handle = handle;
    cropInteractionState.pointerId = event.pointerId;
    cropInteractionState.startX = event.clientX;
    cropInteractionState.startY = event.clientY;
    cropInteractionState.containerRect = containerRect;
    cropInteractionState.startRect = {
        left: boxRect.left - containerRect.left,
        top: boxRect.top - containerRect.top,
        width: boxRect.width,
        height: boxRect.height
    };

    subtitleCropBox.setPointerCapture(event.pointerId);
}

function handleCropPointerMove(event) {
    if (!subtitleCropBox || !cropInteractionState.active || cropInteractionState.pointerId !== event.pointerId) {
        return;
    }

    event.preventDefault();

    const { mode, handle, startX, startY, startRect, containerRect } = cropInteractionState;

    if (!containerRect || !startRect) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    let { left, top, width, height } = { ...startRect };
    const minSize = 40;

    if (mode === 'drag') {
        left += deltaX;
        top += deltaY;
    } else if (mode === 'resize' && handle) {
        switch (handle) {
            case 'nw':
                left += deltaX;
                top += deltaY;
                width -= deltaX;
                height -= deltaY;
                break;
            case 'ne':
                top += deltaY;
                width += deltaX;
                height -= deltaY;
                break;
            case 'sw':
                left += deltaX;
                width -= deltaX;
                height += deltaY;
                break;
            case 'se':
                width += deltaX;
                height += deltaY;
                break;
            case 'n':
                top += deltaY;
                height -= deltaY;
                break;
            case 's':
                height += deltaY;
                break;
            case 'w':
                left += deltaX;
                width -= deltaX;
                break;
            case 'e':
                width += deltaX;
                break;
        }
    }

    width = Math.max(minSize, width);
    height = Math.max(minSize, height);

    if (left < 0) {
        if (mode === 'drag' || (handle && handle.includes('w'))) {
            left = 0;
        } else {
            width += left;
            left = 0;
        }
    }

    if (top < 0) {
        if (mode === 'drag' || (handle && handle.includes('n'))) {
            top = 0;
        } else {
            height += top;
            top = 0;
        }
    }

    if (left + width > containerRect.width) {
        if (mode === 'drag' || (handle && handle.includes('e'))) {
            left = containerRect.width - width;
        } else {
            width = containerRect.width - left;
        }
    }

    if (top + height > containerRect.height) {
        if (mode === 'drag' || (handle && handle.includes('s'))) {
            top = containerRect.height - height;
        } else {
            height = containerRect.height - top;
        }
    }

    subtitleCropBox.style.left = `${left}px`;
    subtitleCropBox.style.top = `${top}px`;
    subtitleCropBox.style.width = `${width}px`;
    subtitleCropBox.style.height = `${height}px`;
}

function endCropInteraction(event) {
    if (!subtitleCropBox || !cropInteractionState.active || cropInteractionState.pointerId !== event.pointerId) return;

    if (subtitleCropBox.hasPointerCapture(event.pointerId)) {
        subtitleCropBox.releasePointerCapture(event.pointerId);
    }
    cropInteractionState.active = false;
    cropInteractionState.mode = null;
    cropInteractionState.handle = null;
    cropInteractionState.pointerId = null;
    cropInteractionState.startRect = null;
    cropInteractionState.containerRect = null;
}

// Initialize crop box interactions immediately (elements exist because script is at end of body)
initializeCropBoxInteractions();

// Thêm video vào queue
function addVideoToQueue(videoData) {
    videoTextQueue.push(videoData);

    if (videoTextQueueSection) {
        videoTextQueueSection.style.display = 'block';
    }

    updateVideoTextQueueTable();
}

// Cập nhật bảng queue
function updateVideoTextQueueTable() {
    if (!videoTextQueueBody) return;

    videoTextQueueBody.innerHTML = '';

    videoTextQueue.forEach((video, index) => {
        // Ensure startTime is set if video is processing but doesn't have it yet
        if (video.status === 'processing' && !video.startTime) {
            video.startTime = Date.now();
            console.log('Setting startTime in updateVideoTextQueueTable for processing video:', video.id);
        }

        const row = document.createElement('tr');
        row.id = `video-text-row-${video.id}`;

        const videoName = video.videoPath ? (video.videoPath.split(/[/\\]/).pop()) : 'N/A';
        const videoPathArg = `'${escapeJsString(video.videoPath || '')}'`;
        const srtPathArg = `'${escapeJsString(video.srtPath || '')}'`;
        const outputDirArg = `'${escapeJsString(video.outputDir || '')}'`;
        const taskIdArg = `'${escapeJsString(String(video.taskId))}'`;
        const canRerunVideo = ['completed', 'error', 'stopped'].includes(video.status);

        const statusClass = video.status === 'waiting' ? 'waiting' :
            video.status === 'queued' ? 'waiting' :
                video.status === 'processing' ? 'downloading' :
                    video.status === 'completed' ? 'completed' :
                        video.status === 'stopped' ? 'error' :
                            video.status === 'error' ? 'error' : '';

        // Compute combined overall progress where VideoSubFinder and OCR each contribute 50%
        const vProg = Number(video.videoProgress || 0);
        const oProg = Number(video.ocrProgress || 0);
        const overallProgress = Math.round((vProg + oProg) / 2);

        // Format duration for display
        function formatDuration(seconds) {
            if (!seconds || seconds < 0) return '';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);

            if (hours > 0) {
                return `${hours}h ${minutes}m ${secs}s`;
            } else if (minutes > 0) {
                return `${minutes}m ${secs}s`;
            } else {
                return `${secs}s`;
            }
        }

        // Status text: include percent when processing, duration when completed
        let statusText;
        if (video.status === 'waiting' || video.status === 'queued') {
            statusText = 'Đang chờ';
        } else if (video.status === 'processing') {
            statusText = `Đang xử lý: ${overallProgress}%`;
        } else if (video.status === 'completed') {
            // Calculate duration: prefer stored duration, then calculate from times, or use 0
            let duration = video.duration;
            if (!duration && video.endTime && video.startTime) {
                duration = (video.endTime - video.startTime) / 1000;
            }

            // Debug log
            if (!duration || duration <= 0) {
                console.log('Video completed but no duration:', {
                    id: video.id,
                    duration: video.duration,
                    startTime: video.startTime,
                    endTime: video.endTime,
                    calculated: video.endTime && video.startTime ? (video.endTime - video.startTime) / 1000 : null
                });
            }

            if (duration && duration > 0) {
                const durationText = formatDuration(duration);
                statusText = `Hoàn thành trong ${durationText}`;
                console.log('Displaying completion time:', durationText, 'for video', video.id);
            } else {
                statusText = 'Hoàn thành';
            }
        } else if (video.status === 'stopped') {
            statusText = 'Đã dừng';
        } else if (video.status === 'error') {
            console.log(' ########### overallProgress: ', overallProgress);
            if (overallProgress >= 50) {
                statusText = 'Lỗi Báo cho Admin thêm Key';
            }else {
                statusText = 'Lỗi VideoSubFinder';

            }
        } else {
            statusText = 'Không xác định';
        }

        row.innerHTML = `
            <td>${index + 1}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(video.videoPath || '')}">${escapeHtml(videoName)}</td>
            <td>
                <div><span class="download-status ${statusClass}">${statusText}</span></div>
                <div style="margin-top:8px;">
                    <div class="download-progress-bar">
                        <div class="download-progress-fill" style="width: ${overallProgress}%"></div>
                    </div>
                </div>
            </td>
            <td class="actions-col">
                <div class="action-buttons">
                    ${video.status === 'completed' ? `<button class="btn-action btn-view" onclick="viewVideoSubtitle(${video.id}, ${videoPathArg}, ${srtPathArg})">👁️ Xem</button>` : ''}
                    ${video.status === 'completed' ? `<button class="btn-action btn-view" onclick="openVideoTextOutput(${outputDirArg})">📂</button>` : ''}
                    ${video.status === 'completed' ? `<button class="btn-action btn-copy" onclick="copyVideoSubtitleText(${video.id}, ${srtPathArg})">📋 Copy text</button>` : ''}
                    ${video.status === 'completed' ? `<button class="btn-action btn-view" onclick="rerunVideoOCR(${video.id}, ${taskIdArg})">🔁 OCR lại</button>` : ''}
                    ${video.status === 'error' && Number(video.videoProgress || 0) >= 100 ? `<button class="btn-action btn-view" onclick="rerunVideoOCR(${video.id}, ${taskIdArg})">🔁 OCR lại</button>` : ''}
                    ${canRerunVideo ? `<button class="btn-action btn-view" onclick="rerunVideoSubFinder(${video.id}, ${taskIdArg})">♻️ Chạy lại</button>` : ''}
                    ${video.status === 'processing' ? `<button class="btn-action btn-stop" onclick="stopVideoProcessing(${video.id}, ${taskIdArg})">⏹️ Dừng</button>` : ''}
                    ${video.status === 'stopped' ? `<button class="btn-action btn-play" onclick="restartVideoProcessing(${video.id}, ${taskIdArg})">▶️ Chạy</button>` : ''}
                    <button class="btn-action btn-copy" onclick="removeVideoFromQueue(${video.id})">🗑️ Xóa</button>
                </div>
            </td>
        `;

        videoTextQueueBody.appendChild(row);
    });
}

// Xóa video khỏi queue
window.removeVideoFromQueue = function (id) {
    const index = videoTextQueue.findIndex(v => v.id === id);
    if (index !== -1) {
        videoTextQueue.splice(index, 1);
        updateVideoTextQueueTable();
    }
};

// Mở thư mục output
window.openVideoTextOutput = function (outputDir) {
    window.electronAPI.openFolder(outputDir);
};

// Dừng xử lý video
window.stopVideoProcessing = async function (id, taskId) {
    try {
        const result = await window.electronAPI.stopVideoSubtitleProcessing(taskId);
        if (result.success) {
            const video = videoTextQueue.find(v => v.id === id);
            if (video) {
                video.status = 'stopped';
                video.progress = 0;
                updateVideoTextQueueTable();
            }
            showToast('Đã dừng xử lý video', 'success');
        } else {
            showToast('Lỗi khi dừng: ' + (result.error || 'Không thể dừng'), 'error');
        }
    } catch (error) {
        console.error('Error stopping video processing:', error);
        showToast('Lỗi: ' + error.message, 'error');
    }
};

// Chạy lại video đã dừng
window.restartVideoProcessing = async function (id, taskId) {
    try {
        const result = await window.electronAPI.restartVideoSubtitleProcessing(taskId);
        if (result.success) {
            const video = videoTextQueue.find(v => v.id === id);
            if (video) {
                video.status = 'waiting';
                video.progress = 0;
            }
            updateVideoTextQueueTable();
            showToast('Đã thêm vào queue lại', 'success');
        } else {
            showToast('Lỗi: ' + (result.error || 'Không thể chạy lại'), 'error');
        }
    } catch (error) {
        console.error('Error restarting video processing:', error);
        showToast('Lỗi: ' + error.message, 'error');
    }
};

// OCR lại ảnh đã xuất
window.rerunVideoOCR = async function (id, taskId) {
    try {
        const result = await window.electronAPI.rerunVideoSubtitleOCR(taskId);
        if (result.success) {
            const video = videoTextQueue.find(v => v.id === id);
            if (video) {
                video.status = 'completed';
                video.progress = 100;
                if (result.srtPath) {
                    video.srtPath = result.srtPath;
                }
                updateVideoTextQueueTable();
            }
            showToast('Đã OCR lại thành công', 'success');
        } else {
            showToast('Lỗi OCR: ' + (result.error || 'Không thể OCR'), 'error');
        }
    } catch (error) {
        console.error('Error rerunning OCR:', error);
        showToast('Lỗi: ' + error.message, 'error');
    }
};

// Chạy lại VideoSubFinder
window.rerunVideoSubFinder = async function (id, taskId) {
    try {
        const result = await window.electronAPI.rerunVideoSubtitle(taskId);
        if (result.success) {
            const video = videoTextQueue.find(v => v.id === id);
            if (video) {
                // Set to processing so UI reflects active work instead of immediately waiting
                video.status = 'processing';
                video.progress = 0;
                video.srtPath = null;
                if (result.outputDir) {
                    video.outputDir = result.outputDir;
                }
            }
            updateVideoTextQueueTable();
            showToast(result.message || 'Đã chạy lại VideoSubFinder', 'success');
        } else {
            showToast('Lỗi chạy lại VideoSubFinder: ' + (result.error || 'Không thể chạy lại'), 'error');
        }
    } catch (error) {
        console.error('Error rerunning VideoSubFinder:', error);
        showToast('Lỗi: ' + error.message, 'error');
    }
};

// Xem subtitle và video
window.viewVideoSubtitle = async function (id, videoPath, srtPath) {
    try {
        if (!srtPath) {
            showToast('File SRT chưa được tạo', 'error');
            return;
        }

        const result = await window.electronAPI.readSrtFile(srtPath);
        if (!result.success) {
            showToast('Lỗi đọc file SRT: ' + result.error, 'error');
            return;
        }

        openSubtitleViewerModal(videoPath, result.content, srtPath);
    } catch (error) {
        console.error('Error viewing subtitle:', error);
        showToast('Lỗi: ' + error.message, 'error');
    }
};

// Copy subtitle text (without timestamps) from SRT associated with a video in the queue
window.copyVideoSubtitleText = async function (id, srtPath) {
    try {
        // Prefer queue-stored normalized SRT if available
        const video = videoTextQueue.find(v => v.id === id);
        let srtContent = null;

        if (video && video.srtContentClean) {
            srtContent = video.srtContentClean;
        } else {
            const pathToRead = (video && video.srtPath) ? video.srtPath : srtPath;
            if (!pathToRead) {
                showToast('File SRT chưa được tạo', 'error');
                return;
            }
            const result = await window.electronAPI.readSrtFile(pathToRead);
            if (!result.success) {
                showToast('Lỗi đọc file SRT: ' + (result.error || 'Không thể đọc'), 'error');
                return;
            }
            srtContent = result.content;
        }

        const textOnly = formatSubtitleAsLines(srtContent || '');

        if (!textOnly || textOnly === 'Không có') {
            showToast('Không có nội dung để copy', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(textOnly);
            showToast('Đã copy nội dung subtitle (mỗi câu 1 dòng)!', 'success');
        } catch (err) {
            console.error('Clipboard write failed, using fallback:', err);
            const textarea = document.createElement('textarea');
            textarea.value = textOnly;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Đã copy nội dung subtitle (mỗi câu 1 dòng)!', 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy subtitle. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        }
    } catch (error) {
        console.error('Error copying video subtitle text:', error);
        showToast('Lỗi khi copy subtitle: ' + error.message, 'error');
    }
};

// Show Windows notification when download is completed
function showDownloadCompletedNotification(fileName, urlName) {
    try {
        const notification = new Notification('Video tải xong', {
            body: `File: ${fileName}\nURL: ${urlName}`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9IiM0Q0FGNTAiLz4KPHBhdGggZD0iTTMyIDEwVjU0TTEwIDMySDU0IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K',
            tag: `download-completed-${Date.now()}` // Unique tag to prevent duplicate notifications
        });

        notification.onclick = () => {
            window.focus(); // Focus the window when notification is clicked
            notification.close();
        };

        // Auto close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}

// Show Windows notification when video processing is completed
function showVideoCompletedNotification(videoName, fileName) {
    try {
        const notification = new Notification('Video xử lý hoàn thành', {
            body: `Video: ${videoName}\nFile: ${fileName}`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9IiM0Q0FGNTAiLz4KPHBhdGggZD0iTTMyIDEwVjU0TTEwIDMySDU0IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K',
            tag: `video-completed-${Date.now()}` // Unique tag to prevent duplicate notifications
        });

        notification.onclick = () => {
            window.focus(); // Focus the window when notification is clicked
            notification.close();
        };

        // Auto close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}

// Show Windows notification when TTS synthesis is completed
function showTtsCompletedNotification(fileName, filePath) {
    try {
        const notification = new Notification('Tạo giọng đọc hoàn thành', {
            body: `File: ${fileName}\nĐường dẫn: ${filePath}`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9IiM0Q0FGNTAiLz4KPHBhdGggZD0iTTMyIDEwVjU0TTEwIDMySDU0IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K',
            tag: `tts-completed-${Date.now()}` // Unique tag to prevent duplicate notifications
        });

        notification.onclick = () => {
            window.focus(); // Focus the window when notification is clicked
            notification.close();
        };

        // Auto close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
    } catch (error) {
        console.error('Error showing TTS notification:', error);
    }
}

// Listen for video subtitle progress - Đăng ký ngay khi script load
function setupVideoSubtitleProgressListener() {
    // Đợi một chút để đảm bảo electronAPI đã sẵn sàng
    if (window.electronAPI && window.electronAPI.onVideoSubtitleProgress) {
        window.electronAPI.onVideoSubtitleProgress((data) => {

            // Đảm bảo taskId được so sánh đúng (có thể là string hoặc number)
            const video = videoTextQueue.find(v => {
                const vTaskId = String(v.taskId);
                const dataTaskId = String(data.taskId);
                const match = vTaskId === dataTaskId;
                if (!match) {
                    console.log(`Comparing: '${vTaskId}' (${typeof v.taskId}) === '${dataTaskId}' (${typeof data.taskId}) = ${match}`);
                }
                return match;
            });

            if (video) {
                // Check if status changed to completed (for notification)
                const wasCompleted = video.status === 'completed';
                const wasProcessing = video.status === 'processing';
                const isNowCompleted = data.status === 'completed';
                const isNowProcessing = data.status === 'processing';
                const justCompleted = !wasCompleted && isNowCompleted;
                const justStartedProcessing = !wasProcessing && isNowProcessing;

                // Track start time when processing starts (set if not already set)
                // Set startTime when status becomes 'processing' or if already processing but no startTime
                if (data.status === 'processing' && !video.startTime) {
                    video.startTime = Date.now();
                    console.log('Video processing started, startTime set:', new Date(video.startTime).toISOString());
                }

                // Also set startTime if status is processing and we don't have it yet (fallback)
                if (video.status === 'processing' && !video.startTime) {
                    video.startTime = Date.now();
                    console.log('Video already processing but no startTime, setting now:', new Date(video.startTime).toISOString());
                }

                // Track end time and calculate duration when completed
                if (justCompleted) {
                    video.endTime = Date.now();
                    if (video.startTime) {
                        video.duration = (video.endTime - video.startTime) / 1000; // Duration in seconds
                        console.log('Video completed, duration calculated:', video.duration, 'seconds');
                    } else {
                        // If startTime was not set, use current time as fallback
                        console.warn('Video completed but startTime was not set, using fallback');
                        video.duration = 0; // Will show "Hoàn thành" without time
                    }
                }

                // Update basic status/progress
                video.status = data.status;
                video.progress = data.progress || video.progress || 0;

                // New: update separate VideoSubFinder and OCR progress fields
                if (typeof data.videoProgress !== 'undefined') {
                    video.videoProgress = Number(data.videoProgress) || 0;
                }
                if (typeof data.ocrProgress !== 'undefined') {
                    video.ocrProgress = Number(data.ocrProgress) || 0;
                }

                if (data.outputDir) {
                    video.outputDir = data.outputDir;
                }
                if (data.srtPath) {
                    video.srtPath = data.srtPath;
                }
                updateVideoTextQueueTable();

                // Show Windows notification when video is completed
                if (justCompleted) {
                    const videoName = video.videoPath ? (video.videoPath.split(/[/\\]/).pop()) : 'Video';
                    const fileName = video.srtPath ? (video.srtPath.split(/[/\\]/).pop()) : (video.videoPath ? (video.videoPath.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')) : 'File');

                    console.log('Video completed, showing notification:', { videoName, fileName });

                    // Check if Notification API is available
                    if ('Notification' in window) {
                        // Request permission if needed
                        if (Notification.permission === 'default') {
                            Notification.requestPermission().then(permission => {
                                console.log('Notification permission:', permission);
                                if (permission === 'granted') {
                                    showVideoCompletedNotification(videoName, fileName);
                                } else {
                                    console.warn('Notification permission denied');
                                }
                            }).catch(err => {
                                console.error('Error requesting notification permission:', err);
                            });
                        } else if (Notification.permission === 'granted') {
                            showVideoCompletedNotification(videoName, fileName);
                        } else {
                            console.warn('Notification permission denied or not available');
                        }
                    } else {
                        console.warn('Notification API not available in this browser');
                    }
                }
            } else {
                console.warn('✗ Video not found for taskId:', data.taskId, 'Type:', typeof data.taskId);
                console.warn('Available videos:', videoTextQueue.map(v => ({ id: v.id, taskId: v.taskId, taskIdType: typeof v.taskId, status: v.status })));
            }
        });
    } else {
        console.error('✗ onVideoSubtitleProgress not available!');
        console.error('electronAPI:', window.electronAPI);
        // Thử lại sau 1 giây
        setTimeout(() => {
            if (window.electronAPI && window.electronAPI.onVideoSubtitleProgress) {
                setupVideoSubtitleProgressListener();
            }
        }, 1000);
    }
}

// Đăng ký listener ngay lập tức
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupVideoSubtitleProgressListener);
} else {
    setupVideoSubtitleProgressListener();
}

// Mở modal xem subtitle
function openSubtitleViewerModal(videoPath, srtContent, srtPath) {
    const modal = document.getElementById('subtitle-viewer-modal');
    const subtitleContent = document.getElementById('subtitle-content');
    const video = document.getElementById('subtitle-viewer-video');

    if (!modal || !subtitleContent || !video) return;

    // Store current srt path and content on window for save operations
    window.currentSrtPath = srtPath || null;
    window.currentSrtRaw = srtContent || '';

    // Parse SRT content
    const subtitleEntries = parseSRT(srtContent);
    // Keep entries for later updates
    window.currentSubtitleEntries = subtitleEntries;

    // Render subtitle content with click/dblclick handlers
    subtitleContent.innerHTML = subtitleEntries.map((entry, index) => {
        const startSeconds = parseSRTTime(entry.startTime);
        return `
            <div class="subtitle-entry" data-index="${index}" data-start="${startSeconds}" onclick="seekToSubtitleTime(${startSeconds})">
                <div class="subtitle-time">${entry.startTime} --> ${entry.endTime}</div>
                <div class="subtitle-text" data-index="${index}">${escapeHtml(entry.text)}</div>
            </div>
        `;
    }).join('');

    // Attach dblclick handlers to enable inline editing
    setTimeout(() => {
        const textNodes = subtitleContent.querySelectorAll('.subtitle-text');
        textNodes.forEach(node => {
            node.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                enableInlineEdit(node);
            });
        });
    }, 0);

    // Set video source
    video.src = `file:///${String(videoPath || '').replace(/\\/g, '/')}`;
    try { video.load(); } catch (e) { console.warn('Video load warning:', e); }

    // Show modal
    modal.style.display = 'flex';
}

// Enable inline editing for a subtitle text node
function enableInlineEdit(textNode) {
    if (!textNode) return;
    const index = parseInt(textNode.dataset.index, 10);
    const original = textNode.textContent || '';

    // Replace with textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'inline-sub-edit';
    textarea.value = original;
    textarea.style.width = '100%';
    textarea.style.minHeight = '48px';
    textarea.style.fontFamily = 'inherit';
    textarea.style.fontSize = '1em';
    textarea.style.boxSizing = 'border-box';

    // Replace node
    textNode.replaceWith(textarea);
    textarea.focus();

    // On blur, save changes
    const finish = async () => {
        const newText = textarea.value.trim();
        // Update in-memory entries
        if (window.currentSubtitleEntries && typeof index === 'number') {
            // Update the entry text
            window.currentSubtitleEntries[index].text = newText;
        }

        // Recreate SRT content from entries
        const newSrt = buildSrtFromEntries(window.currentSubtitleEntries);

        // Attempt to save to disk if path available
        if (window.currentSrtPath) {
            try {
                const res = await window.electronAPI.saveSrtFile(window.currentSrtPath, newSrt);
                if (!res || !res.success) {
                    showToast('Lỗi khi lưu SRT: ' + (res && res.error ? res.error : 'Không xác định'), 'error');
                } else {
                    showToast('Đã lưu subtitle!', 'success');
                }
            } catch (err) {
                console.error('Error saving SRT:', err);
                showToast('Lỗi khi lưu SRT: ' + err.message, 'error');
            }
        }

        // Restore display node
        const newDiv = document.createElement('div');
        newDiv.className = 'subtitle-text';
        newDiv.dataset.index = index;
        newDiv.innerHTML = escapeHtml(newText);
        newDiv.addEventListener('dblclick', (e) => { e.stopPropagation(); enableInlineEdit(newDiv); });

        textarea.replaceWith(newDiv);
    };

    textarea.addEventListener('blur', finish);
    // Allow Ctrl+Enter to finish editing as well
    textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            textarea.blur();
        }
        // Esc to cancel
        if (e.key === 'Escape') {
            textarea.value = original;
            textarea.blur();
        }
    });
}

// Build SRT text from parsed entries (entries have startTime, endTime, text)
function buildSrtFromEntries(entries) {
    if (!entries || !Array.isArray(entries)) return '';
    // Helper to format times as requested: HH:MM:S,mmm (seconds may be non-padded)
    function formatSrtTime(timeStr) {
        if (!timeStr) return '';
        // Normalize decimal separator to dot
        const t = String(timeStr).replace(',', '.');
        const parts = t.split(':');
        if (parts.length !== 3) return timeStr;
        const hh = String(parts[0]).padStart(2, '0');
        const mm = String(parts[1]).padStart(2, '0');
        const secParts = parts[2].split('.');
        const secNum = secParts[0] ? Number(secParts[0]) : 0;
        const s = String(secNum); // do not pad seconds (will be '0'..'59')
        let ms = (secParts[1] || '000').padEnd(3, '0').slice(0, 3);
        return `${hh}:${mm}:${s},${ms}`;
    }

    const blocks = entries.map((entry, idx) => {
        const index = idx + 1;
        const start = formatSrtTime(entry.startTime);
        const end = formatSrtTime(entry.endTime);
        // Ensure text lines preserve line breaks if any
        const text = (entry.text || '').replace(/\r?\n/g, '\n');
        return `${index}\n${start} --> ${end}\n${text}`;
    });
    return blocks.join('\n\n') + '\n';
}

// Parse SRT content
function parseSRT(srtContent) {
    const entries = [];
    const blocks = srtContent.trim().split(/\n\s*\n/);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;

        const timeLine = lines[1];
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
        if (!timeMatch) continue;

        const startTime = timeMatch[1].replace(',', '.');
        const endTime = timeMatch[2].replace(',', '.');
        const text = lines.slice(2).join('\n');

        entries.push({ startTime, endTime, text });
    }

    return entries;
}

// Parse SRT time to seconds
function parseSRTTime(timeStr) {
    // Format: HH:MM:SS.mmm or HH:MM:SS,mmm
    const parts = timeStr.replace(',', '.').split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
}

// Copy subtitle text (without timestamps) from the raw subtitle content associated with a result
window.copySubtitleText = function (index) {
    try {
        const videoData = results[index];
        if (!videoData) {
            showToast('Không tìm thấy dữ liệu video', 'error');
            return;
        }
        if (!videoData.subtitle) {
            showToast('Video này không có subtitle', 'warning');
            return;
        }

        // Use formatSubtitle to remove timestamps and return only text
        const text = formatSubtitle(videoData.subtitle);
        if (!text || text === 'Không có') {
            showToast('Không có nội dung để copy', 'warning');
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            showToast('Đã copy nội dung subtitle (không có timeline)!', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Đã copy nội dung subtitle (không có timeline)!', 'success');
            } catch (e) {
                console.error('Fallback copy failed:', e);
                showToast('Không thể copy. Vui lòng thử lại.', 'error');
            }
            document.body.removeChild(textarea);
        });
    } catch (error) {
        console.error('Error in copySubtitleText:', error);
        showToast('Lỗi khi copy subtitle: ' + error.message, 'error');
    }
};

// Chặn F5 và các phím tắt reload
document.addEventListener('keydown', function (event) {
    // Chặn F5
    if (event.key === 'F5') {
        event.preventDefault();
        return false;
    }
    // Chặn Ctrl+R (Windows/Linux) hoặc Cmd+R (Mac)
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        return false;
    }
    // Chặn Ctrl+Shift+R (hard reload)
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R') {
        event.preventDefault();
        return false;
    }
});

// Helper function để lấy basename (nếu không có path module)
if (typeof path === 'undefined') {
    window.path = {
        basename: (filePath) => {
            return filePath.split(/[/\\]/).pop();
        }
    };
}

function updateDownloadRow(task) {
    const row = document.getElementById(`download-row-${task.id}`);
    if (row) {
        const statusClass = task.status === 'waiting' ? 'waiting' :
            task.status === 'fetching' ? 'fetching' :
                task.status === 'downloading' ? 'downloading' :
                    task.status === 'completed' ? 'completed' :
                        task.status === 'cookie-error' ? 'cookie-error' : 'error';

        const statusText = task.status === 'waiting' ? 'Đang chờ' :
            task.status === 'fetching' ? 'Đang lấy thông tin' :
                task.status === 'downloading' ? 'Đang tải' :
                    task.status === 'completed' ? 'Hoàn thành' :
                        task.status === 'cookie-error' ? 'Cần cập nhật cookies' : 'Lỗi';

        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            cells[2].innerHTML = `<span class="download-status ${statusClass}">${statusText}</span>`;
            cells[3].innerHTML = `
                <div class="download-progress-bar">
                    <div class="download-progress-fill" style="width: ${task.progress}%">${task.progress}%</div>
                </div>
            `;
            if (cells.length >= 5) {
                cells[4].textContent = task.fileName || '-';
            }
        }
    }
}
