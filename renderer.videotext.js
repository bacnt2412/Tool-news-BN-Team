// Video -> Text tab helpers (module)
export function setupVideoTextListeners() {
    const selectVideoBtn = document.getElementById('select-video-btn');
    const closeVideoTextModal = document.getElementById('close-video-text-modal');
    const cancelVideoTextBtn = document.getElementById('cancel-video-text-btn');
    const initVideoProcessingBtn = document.getElementById('init-video-processing-btn');

    if (selectVideoBtn) selectVideoBtn.addEventListener('click', async () => {
        if (window.selectVideoFileHandler) return window.selectVideoFileHandler();
        if (window.electronAPI && window.electronAPI.selectVideoFile) {
            try {
                const result = await window.electronAPI.selectVideoFile();
                if (result && !result.canceled) {
                    window.currentVideoPath = result.filePath;
                    if (window.openVideoTextModal) window.openVideoTextModal(result.filePath);
                }
            } catch (e) {
                console.error('selectVideoFile error', e);
            }
        }
    });

    if (closeVideoTextModal) closeVideoTextModal.addEventListener('click', window.closeVideoTextModal || (() => {}));
    if (cancelVideoTextBtn) cancelVideoTextBtn.addEventListener('click', window.closeVideoTextModal || (() => {}));
    if (initVideoProcessingBtn) initVideoProcessingBtn.addEventListener('click', window.initVideoProcessingBtnHandler || (() => {}));
}
