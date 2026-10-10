// TTS tab listeners (module)
// Extracted from renderer.js to reduce file size (T3 fix)
// Dependencies: window.showToast, window.escapeHtml, window.showTtsCompletedNotification

export function setupTtsListeners() {
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

                        // Set voice
                        if (existing.params.voice_code || existing.params.voiceName) {
                            const v = existing.params.voice_code || existing.params.voiceName;

                            let foundVoice = false;
                            for (let i = 0; i < selectVoice.options.length; i++) {
                                if (String(selectVoice.options[i].value) === String(v)) {
                                    selectVoice.selectedIndex = i;
                                    foundVoice = true;
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

                            for (const key in existing.params.audioConfig) {
                                const el = document.getElementById('param-' + key);
                                if (el) {
                                    const value = existing.params.audioConfig[key];

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
                const saveRes = await window.electronAPI.saveTtsConfig(cfg);
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