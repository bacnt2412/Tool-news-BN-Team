// Info tab helpers (module)
export function setupInfoListeners() {
    // Attach listeners that rely on handlers defined in renderer.js (assumes called after those handlers defined)
    const processBtn = document.getElementById('process-btn');
    if (processBtn) processBtn.addEventListener('click', window.handleProcess || (() => {}));

    const copyAllDataBtn = document.getElementById('copy-all-data-btn');
    if (copyAllDataBtn) copyAllDataBtn.addEventListener('click', window.copyAllVideosData || (() => {}));

    const downloadThumbnailsBtn = document.getElementById('download-thumbnails-btn');
    if (downloadThumbnailsBtn) downloadThumbnailsBtn.addEventListener('click', window.openThumbnailDownloadModal || (() => {}));

    // Settings related listeners (OCR provider radios)
    const ocrProviderGoogle = document.getElementById('ocr-provider-google');
    if (ocrProviderGoogle) {
        ocrProviderGoogle.addEventListener('change', function() {
            if (this.checked) {
                document.getElementById('google-vision-settings').style.display = 'block';
            }
        });
    }

    // Settings modal buttons
    const settingsBtn = document.getElementById('settings-btn');
    const logsBtn = document.getElementById('logs-btn');
    const closeSettingsBtn = document.getElementById('close-settings');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const viewLogsBtn = document.getElementById('view-logs-btn');

    // Settings button is hidden
    // if (settingsBtn) settingsBtn.addEventListener('click', window.openSettings || (() => {}));
    if (logsBtn) logsBtn.addEventListener('click', window.openLogs || (() => {}));
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', window.closeSettings || (() => {}));
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', window.closeSettings || (() => {}));
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', window.saveSettings || (() => {}));
    if (viewLogsBtn) viewLogsBtn.addEventListener('click', window.openLogs || (() => {}));
}
