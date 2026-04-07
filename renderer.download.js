// Download tab helpers (module)
export async function setupDownloadListeners() {
    // Attach listeners; handler functions live in renderer.js
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const startDownloadBtn = document.getElementById('start-download-btn');
    const downloadQualitySelect = document.getElementById('download-quality');
    const downloadFolderInput = document.getElementById('download-folder');

    if (selectFolderBtn) selectFolderBtn.addEventListener('click', async () => {
        if (window.selectFolderHandler) return window.selectFolderHandler();
        if (window.electronAPI && window.electronAPI.selectFolder) {
            const result = await window.electronAPI.selectFolder();
            if (result && result.folderPath) {
                downloadFolderInput.value = result.folderPath;
                if (window.electronAPI && window.electronAPI.saveDownloadSettings) {
                    try {
                        await window.electronAPI.saveDownloadSettings({ folder: result.folderPath, quality: downloadQualitySelect.value });
                    } catch (e) {
                        console.warn('saveDownloadSettings failed', e);
                    }
                }
            }
        }
    });

    if (downloadQualitySelect) downloadQualitySelect.addEventListener('change', async () => {
        if (window.electronAPI && window.electronAPI.saveDownloadSettings) {
            try {
                await window.electronAPI.saveDownloadSettings({ folder: downloadFolderInput.value, quality: downloadQualitySelect.value });
            } catch (e) {
                console.warn('saveDownloadSettings failed', e);
            }
        }
    });
}
