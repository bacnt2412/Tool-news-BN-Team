const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // Video info
  getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
  extractTextFromThumbnail: (thumbnailPath) => ipcRenderer.invoke('extract-text-from-thumbnail', thumbnailPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  checkYtDlpUpdate: () => ipcRenderer.invoke('check-yt-dlp-update'),
  updateYtDlp: () => ipcRenderer.invoke('update-yt-dlp'),
  getYtDlpVersion: () => ipcRenderer.invoke('get-yt-dlp-version'),
  downloadThumbnailsBatch: (options) => ipcRenderer.invoke('download-thumbnails-batch', options),
  onYtDlpUpdateStatus: (callback) => {
    ipcRenderer.on('yt-dlp-update-status', (event, data) => callback(data));
  },
  onYtDlpUpdateProgress: (callback) => {
    ipcRenderer.on('yt-dlp-update-progress', (event, data) => callback(data));
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  downloadVideo: (options) => ipcRenderer.invoke('download-video', options),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  cutVideo: (options) => ipcRenderer.invoke('cut-video', options),
  onCutVideoProgress: (callback) => {
    ipcRenderer.on('cut-video-progress', (event, data) => callback(data));
  },
  getDownloadSettings: () => ipcRenderer.invoke('get-download-settings'),
  saveDownloadSettings: (settings) => ipcRenderer.invoke('save-download-settings', settings),

  // Video -> Text
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  processVideoSubtitle: (videoPath, cropBox) => ipcRenderer.invoke('process-video-subtitle', videoPath, cropBox),
  stopVideoSubtitleProcessing: (taskId) => ipcRenderer.invoke('stop-video-subtitle-processing', taskId),
  restartVideoSubtitleProcessing: (taskId) => ipcRenderer.invoke('restart-video-subtitle-processing', taskId),
  rerunVideoSubtitle: (taskId) => ipcRenderer.invoke('rerun-video-subtitle', taskId),
  rerunVideoSubtitleOCR: (taskId) => ipcRenderer.invoke('rerun-video-ocr', taskId),
  readSrtFile: (srtPath) => ipcRenderer.invoke('read-srt-file', srtPath),
  saveSrtFile: (srtPath, content) => ipcRenderer.invoke('write-srt-file', srtPath, content),
  getVideoSubtitleTaskStatus: (taskId) => ipcRenderer.invoke('get-video-subtitle-task-status', taskId),
  onVideoSubtitleProgress: (callback) => {
    ipcRenderer.on('video-subtitle-progress', (event, data) => callback(data));
  }
  ,
  // Text-to-Speech (TTS)
  getTtsConfigs: () => ipcRenderer.invoke('tts-get-configs'),
  saveTtsConfig: (config) => ipcRenderer.invoke('tts-save-config', config),
  deleteTtsConfig: (configId) => ipcRenderer.invoke('tts-delete-config', configId),
  synthesizeTts: (options) => ipcRenderer.invoke('tts-synthesize', options),
  onTtsSentenceProgress: (callback) => {
    ipcRenderer.on('tts-sentence-progress', (event, data) => callback(data));
  }
  ,
  // TTS language/voice list and preview
  ttsGetLanguageVoices: () => ipcRenderer.invoke('tts-get-language-voices'),
  ttsPreview: (options) => ipcRenderer.invoke('tts-preview', options)
  ,
  // VoiceVox server management
  voicevoxCheckServer: (voicevoxUrl) => ipcRenderer.invoke('voicevox-check-server', voicevoxUrl),
  voicevoxStartServer: (voicevoxUrl) => ipcRenderer.invoke('voicevox-start-server', voicevoxUrl),
  
  // License management
  checkLicense: () => ipcRenderer.invoke('check-license'),
  getMacAddress: () => ipcRenderer.invoke('get-mac-address'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  
  // GitHub Sync
  syncFromGitHub: () => ipcRenderer.invoke('sync-from-github'),
  
  // App update management
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  }
});

