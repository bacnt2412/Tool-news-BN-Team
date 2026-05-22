const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');

// Import config
const config = require('./config');

// Import utils modules
const pathUtils = require('./utils/pathUtils');
const ytDlpUtils = require('./utils/ytDlpUtils');
const cookieUtils = require('./utils/cookieUtils');
const videoUtils = require('./utils/videoUtils');
const ocrUtils = require('./utils/ocrUtils');
const downloadUtils = require('./utils/downloadUtils');
const ttsUtils = require('./utils/ttsUtils');
const voicevoxUtils = require('./utils/voicevoxUtils');
const sentenceUtils = require('./utils/sentenceUtils');
const audioUtils = require('./utils/audioUtils');
const licenseUtils = require('./utils/licenseUtils');
const updateUtils = require('./utils/updateUtils');
const githubSyncUtils = require('./utils/githubSyncUtils');
const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
const cutVideoUtils = require('./utils/cutVideoUtils');

// Khởi tạo store để lưu settings
const store = new Store();

// Polyfill crypto for libraries that expect Web Crypto
if (typeof global.crypto === 'undefined') {
  global.crypto = crypto;
}

let mainWindow;

// Initialize utils with dependencies
function initializeUtils() {
  // Set mainWindow for ytDlpUtils
  ytDlpUtils.setMainWindow(mainWindow);
  
  // Set store for ocrUtils
  ocrUtils.setStore(store);
  
  // Set dependencies for videoUtils
  videoUtils.setDependencies({
    findYtDlpPath: ytDlpUtils.findYtDlpPath,
    addCookiesToArgs: cookieUtils.addCookiesToArgs
  });
  
  // Set dependencies for downloadUtils
  downloadUtils.setDependencies({
    mainWindow: mainWindow,
    findYtDlpPath: ytDlpUtils.findYtDlpPath,
    addCookiesToArgs: cookieUtils.addCookiesToArgs
  });

  cutVideoUtils.setDependencies({
    mainWindow: mainWindow
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.DEFAULT_WINDOW_WIDTH,
    height: config.DEFAULT_WINDOW_HEIGHT,
    show: false, // Không hiển thị ngay, đợi kiểm tra license
    icon: path.join(__dirname, 'build', 'icon.ico'), // App icon
    autoHideMenuBar: true, // Tự động ẩn menu bar (chỉ hiện khi nhấn Alt)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Tắt hoàn toàn menu bar khi build (production)
  if (app.isPackaged) {
    mainWindow.removeMenu();
  }

  mainWindow.loadFile('index.html');
  
  // Show window khi đã load xong HTML (để renderer có thể check license)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Chặn reload trang (F5, Ctrl+R, Ctrl+Shift+R)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Chặn F5
    if (input.key === 'F5') {
      event.preventDefault();
      return;
    }
    // Chặn Ctrl+R hoặc Cmd+R
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      return;
    }
    // Chặn Ctrl+Shift+R (hard reload)
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      return;
    }
  });

  // Chặn navigation (reload) - chỉ chặn khi đã load xong
  let isInitialLoad = true;
  mainWindow.webContents.once('did-finish-load', () => {
    isInitialLoad = false;
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    // Cho phép load ban đầu
    if (isInitialLoad) {
      return;
    }
    // Chặn mọi navigation sau khi đã load (reload)
    event.preventDefault();
  });

  // Mở DevTools trong chế độ dev
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  createWindow();
  
  // Initialize utils after mainWindow is created
  initializeUtils();
  
  // Setup auto-updater
  updateUtils.setMainWindow(mainWindow);
  updateUtils.configureAutoUpdater();
  
  // Auto check for updates after 10 seconds (optional, có thể bỏ nếu không muốn)
  // updateUtils.autoCheckOnStartup(10000);

  // Load cookie file từ store nếu có
  const savedCookies = store.get('ytDlpCookies', '');
  if (savedCookies && savedCookies.trim()) {
    try {
      await cookieUtils.saveCookiesToFile(savedCookies);
    } catch (error) {
      console.error('Error loading cookies file:', error);
    }
  }

  // Xóa các file subtitle cũ khi app khởi động
  try {
    const subtitlesDir = pathUtils.getSubtitlesDir();
    if (fs.existsSync(subtitlesDir)) {
      const files = fs.readdirSync(subtitlesDir);
      files.forEach(file => {
        try {
          const filePath = path.join(subtitlesDir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          console.warn(`Không thể xóa file subtitle ${file}:`, error.message);
        }
      });
    }
  } catch (error) {
    console.warn('Lỗi khi xóa subtitle cũ:', error.message);
  }

  // Tự động check và update yt-dlp version khi app khởi động
  setTimeout(async () => {
    try {
      // Đọc version từ file (trong bin)
      const versionFilePath = pathUtils.getYtDlpVersionFilePath();

      let fileVersion = null;

      try {
        if (fs.existsSync(versionFilePath)) {
          const versionContent = fs.readFileSync(versionFilePath, 'utf-8').trim();
          if (versionContent) {
            fileVersion = versionContent;
          }
        }
      } catch (error) {
        console.warn('Không thể đọc version file:', error.message);
      }

      // Kiểm tra version và tự động update nếu cần (không silent để hiển thị modal)
      const checkResult = await ytDlpUtils.checkYtDlpUpdate(false, cookieUtils.addCookiesToArgs); // false = hiển thị modal

      if (checkResult && !checkResult.error) {
        // Nếu yt-dlp không tồn tại hoặc có version mới, tự động tải/update
        if (checkResult.needsDownload || (!checkResult.upToDate && checkResult.latestVersion)) {
          const message = checkResult.needsDownload 
            ? 'yt-dlp không tìm thấy, đang tải...'
            : `Phát hiện version mới: ${checkResult.latestVersion}, đang tự động cập nhật...`;
          try {
            await ytDlpUtils.updateYtDlp(cookieUtils.addCookiesToArgs);
          } catch (updateError) {
            console.error('Lỗi khi tự động cập nhật/tải yt-dlp:', updateError.message);
            // Gửi error status để unblock UI
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('yt-dlp-update-status', {
                status: 'error',
                message: `Lỗi khi cập nhật: ${updateError.message}`
              });
            }
          }
        }
      } else if (checkResult && checkResult.error) {
        // Có lỗi khi check, vẫn unblock UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('yt-dlp-update-status', {
            status: 'error',
            message: checkResult.error
          });
        }
      }
    } catch (error) {
      console.error('Lỗi khi kiểm tra version yt-dlp:', error.message);
      // Gửi error status để unblock UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yt-dlp-update-status', {
          status: 'error',
          message: `Lỗi khi kiểm tra: ${error.message}`
        });
      }
    }
  }, 500); // Đợi 500ms để UI load xong

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Use ytDlpUtils.findYtDlpPath
const findYtDlpPath = ytDlpUtils.findYtDlpPath;

// Use videoUtils functions
const downloadThumbnail = videoUtils.downloadThumbnail;
const downloadThumbnailToPath = videoUtils.downloadThumbnailToPath;
const getSubtitleList = videoUtils.getSubtitleList;
const parseOriginalLanguageFromListSubs = videoUtils.parseOriginalLanguageFromListSubs;
const detectOriginalLanguageFromListSubs = videoUtils.detectOriginalLanguageFromListSubs;
const downloadSubtitle = videoUtils.downloadSubtitle;
const downloadSubtitleFallback = videoUtils.downloadSubtitleFallback;

// IPC handler để lấy thông tin video
ipcMain.handle('get-video-info', async (event, videoUrl) => {
  try {
    const ytDlpPath = findYtDlpPath();

    // Lấy thông tin video dạng JSON
    const args = [
      videoUrl,
      '--dump-json',
      '--skip-download',
      '--ignore-no-formats-error',
      '--no-playlist'
    ];

    // Thêm cookie nếu có
    cookieUtils.addCookiesToArgs(args);
    ytDlpUtils.addEjsRuntimeArgs(args);

    const videoInfo = await new Promise((resolve, reject) => {
      execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
          return;
        }

        try {
          const info = JSON.parse(stdout);
          resolve(info);
        } catch (parseError) {
          reject(new Error('Failed to parse video info'));
        }
      });
    });

    const result = {
      title: videoInfo.title || 'N/A',
      thumbnail: videoInfo.thumbnail || videoInfo.thumbnails?.[0]?.url || '',
      videoId: videoInfo.id || '',
      duration: videoInfo.duration_string || 'N/A',
      uploader: videoInfo.uploader || 'N/A',
      viewCount: videoInfo.view_count || 0,
      uploadDate: videoInfo.upload_date || 'N/A',
      description: videoInfo.description || '',
      url: videoUrl
    };

    // Không tải thumbnail ngay, chỉ tải khi cần OCR
    // Thumbnail URL đã có trong result.thumbnail để hiển thị trực tiếp

    // Lấy subtitle/transcript
    try {
      const subtitlePath = await videoUtils.downloadSubtitle(videoUrl, result.videoId, videoInfo);
      if (subtitlePath && fs.existsSync(subtitlePath)) {
        const subtitleContent = fs.readFileSync(subtitlePath, 'utf-8');
        result.subtitle = subtitleContent;
        result.subtitlePath = subtitlePath;
      }
    } catch (error) {
      console.error('Error downloading subtitle:', error);
      result.subtitle = 'Không thể tải subtitle';
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('Error getting video info:', error);
    return {
      success: false,
      error: error.message || 'Không thể lấy thông tin video. Đảm bảo yt-dlp đã được cài đặt và có trong PATH.'
    };
  }
});

// Video/subtitle functions moved to videoUtils.js

// IPC handler để xử lý OCR trên thumbnail
ipcMain.handle('extract-text-from-thumbnail', async (event, thumbnailUrl, videoId) => {
  try {
    return await ocrUtils.performSmartOCR(thumbnailUrl);
  } catch (error) {
    console.error('OCR Error:', error);
    let errorMessage = 'Lỗi khi xử lý OCR';

    if (error.statusCode || error.status) {
      errorMessage = `API Error: ${error.statusCode || error.status} - ${error.message}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return { success: false, error: errorMessage };
  }
});

// OCR functions moved to ocrUtils.js

// IPC handler để mở URL external
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
});

// IPC handler để mở thư mục
ipcMain.handle('open-folder', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handlers cho Download Settings
ipcMain.handle('get-download-settings', async () => {
  try {
    const folder = store.get('downloadFolder', '');
    const quality = store.get('downloadQuality', 'best');
    return { folder, quality };
  } catch (error) {
    return { folder: '', quality: 'best' };
  }
});

ipcMain.handle('save-download-settings', async (event, settings) => {
  try {
    if (settings.folder !== undefined) {
      store.set('downloadFolder', settings.folder);
    }
    if (settings.quality !== undefined) {
      store.set('downloadQuality', settings.quality);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// License IPC Handlers
ipcMain.handle('check-license', async () => {
  try {
    const result = await licenseUtils.checkLicense();
    return result;
  } catch (error) {
    return {
      success: false,
      message: `Lỗi kiểm tra license: ${error.message}`,
      macAddress: licenseUtils.getMacAddress()
    };
  }
});

ipcMain.handle('get-mac-address', async () => {
  return licenseUtils.getMacAddress();
});

ipcMain.handle('copy-to-clipboard', async (event, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return { success: true };
});

// GitHub Sync IPC Handlers
ipcMain.handle('sync-from-github', async () => {
  try {
    const result = await githubSyncUtils.syncAllFromAPI(store);
    return result;
  } catch (error) {
    console.error('GitHub sync error:', error);
    return {
      success: false,
      message: `Lỗi đồng bộ từ GitHub: ${error.message}`,
      details: {
        cookies: { success: false, message: error.message },
        settings: { success: false, message: error.message }
      }
    };
  }
});

// Update IPC Handlers
ipcMain.handle('check-for-updates', async () => {
  return await updateUtils.checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  return await updateUtils.downloadUpdate();
});

ipcMain.handle('quit-and-install', async () => {
  updateUtils.quitAndInstall();
  return { success: true };
});

ipcMain.handle('get-app-version', async () => {
  return updateUtils.getCurrentVersion();
});

// IPC handler cho Config
ipcMain.handle('get-config', async () => {
  return config;
});

// IPC handlers cho Settings
ipcMain.handle('get-settings', async () => {
  const ocrProvider = store.get('ocrProvider', 'google');
  const googleVision = store.get('googleVision', {
    apiKeys: []
  });
  const googleTts = store.get('googleTts', {
    apiKey: ''
  });
  const ytDlpCookies = store.get('ytDlpCookies', '');
  const lastSelectedTtsConfigId = store.get('lastSelectedTtsConfigId', '');
  const ttsSaveFolder = store.get('ttsSaveFolder', '');

  return {
    ocrProvider,
    googleVision,
    googleTts,
    ytDlpCookies,
    lastSelectedTtsConfigId,
    ttsSaveFolder
  };
});

ipcMain.handle('save-settings', async (event, settings) => {
  // Lưu OCR provider
  store.set('ocrProvider', 'google');

  // Lưu Google Vision settings
  if (settings.googleVision) {
    store.set('googleVision', settings.googleVision);
  }

  // Lưu Google TTS settings
  if (settings.googleTts) {
    store.set('googleTts', settings.googleTts);
  }

  // Lưu yt-dlp cookies
  if (settings.ytDlpCookies !== undefined) {
    store.set('ytDlpCookies', settings.ytDlpCookies);

    // Lưu cookie vào file nếu có
    if (settings.ytDlpCookies && settings.ytDlpCookies.trim()) {
      try {
        await cookieUtils.saveCookiesToFile(settings.ytDlpCookies);
      } catch (error) {
        console.error('Error saving cookies file:', error);
      }
    } else {
      // Xóa file cookie nếu không có cookie
      cookieUtils.deleteCookiesFile();
    }
  }

  // Lưu last selected TTS config ID
  if (settings.lastSelectedTtsConfigId !== undefined) {
    store.set('lastSelectedTtsConfigId', settings.lastSelectedTtsConfigId);
  }

  // Lưu TTS save folder
  if (settings.ttsSaveFolder !== undefined) {
    store.set('ttsSaveFolder', settings.ttsSaveFolder);
  }

  return { success: true };
});

// Cookie and yt-dlp functions moved to utils modules
const addCookiesToArgs = cookieUtils.addCookiesToArgs;
const getCurrentYtDlpVersion = ytDlpUtils.getCurrentYtDlpVersion;
const getLatestYtDlpVersion = ytDlpUtils.getLatestYtDlpVersion;
const compareVersions = ytDlpUtils.compareVersions;
const updateYtDlp = ytDlpUtils.updateYtDlp;
const checkYtDlpUpdate = ytDlpUtils.checkYtDlpUpdate;

// IPC handler để check yt-dlp version
ipcMain.handle('check-yt-dlp-update', async () => {
  return await ytDlpUtils.checkYtDlpUpdate(false, cookieUtils.addCookiesToArgs);
});

// IPC handler để update yt-dlp
ipcMain.handle('update-yt-dlp', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yt-dlp-update-status', {
        status: 'updating',
        message: 'Đang cập nhật yt-dlp...'
      });
    }

    const result = await ytDlpUtils.updateYtDlp(cookieUtils.addCookiesToArgs);

    // Lấy version mới sau khi update
    const newVersion = await ytDlpUtils.getCurrentYtDlpVersion();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yt-dlp-update-status', {
        status: 'updated',
        message: `Đã cập nhật thành công! Version mới: ${newVersion}`,
        version: newVersion
      });
    }

    return { success: true, version: newVersion, ...result };
  } catch (error) {
    console.error('Error updating yt-dlp:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yt-dlp-update-status', {
        status: 'update-error',
        message: `Lỗi khi cập nhật: ${error.message}`
      });
    }
    return { success: false, error: error.message };
  }
});

// IPC handler để lấy version hiện tại
ipcMain.handle('get-yt-dlp-version', async () => {
  try {
    const version = await ytDlpUtils.getCurrentYtDlpVersion();
    return { success: true, version };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler để chọn thư mục
ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Chọn thư mục để lưu video'
    });

    if (result.canceled) {
      return { canceled: true };
    }

    return { folderPath: result.filePaths[0] };
  } catch (error) {
    return { error: error.message };
  }
});

// IPC handler để download video
function sanitizeThumbnailFileName(fileName) {
  return String(fileName || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

ipcMain.handle('download-thumbnails-batch', async (event, options = {}) => {
  try {
    const folderPath = options.folderPath;
    const items = Array.isArray(options.items) ? options.items : [];

    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: 'Thư mục lưu không hợp lệ.' };
    }

    if (items.length === 0) {
      return { success: false, error: 'Không có thumbnail để tải.' };
    }

    const savedFiles = [];
    const usedFileNames = new Set();

    for (let index = 0; index < items.length; index++) {
      const item = items[index] || {};
      const thumbnailUrl = String(item.thumbnailUrl || '').trim();
      const requestedName = sanitizeThumbnailFileName(item.fileName);

      if (!thumbnailUrl) {
        throw new Error(`Thumbnail #${index + 1} không có URL.`);
      }

      if (!requestedName) {
        throw new Error(`Tên file dòng ${index + 1} không hợp lệ.`);
      }

      const parsedUrl = new URL(thumbnailUrl);
      let extension = path.extname(parsedUrl.pathname || '').toLowerCase();
      if (!extension || extension.length > 5) {
        extension = '.jpg';
      }

      const finalFileName = path.extname(requestedName)
        ? requestedName
        : `${requestedName}${extension}`;
      const finalFileKey = finalFileName.toLowerCase();

      if (usedFileNames.has(finalFileKey)) {
        throw new Error(`Tên file bị trùng: ${finalFileName}`);
      }

      usedFileNames.add(finalFileKey);
      const filePath = path.join(folderPath, finalFileName);

      await downloadThumbnailToPath(thumbnailUrl, filePath);
      savedFiles.push(filePath);
    }

    return { success: true, savedFiles };
  } catch (error) {
    console.error('Error downloading thumbnails batch:', error);
    return { success: false, error: error.message || 'Không thể tải thumbnail.' };
  }
});

ipcMain.handle('download-video', async (event, options) => {
  return await downloadUtils.downloadVideo(options);
});

ipcMain.handle('cut-video', async (event, options) => {
  return await cutVideoUtils.cutVideo(options);
});

// IPC handler để chọn video file
ipcMain.handle('select-video-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Chọn video file'
    });

    if (result.canceled) {
      return { canceled: true };
    }

    return { filePath: result.filePaths[0] };
  } catch (error) {
    return { error: error.message };
  }
});

// TTS: get saved configs
ipcMain.handle('tts-get-configs', async () => {
  try {
    const configs = store.get('ttsConfigs', []);
    return { success: true, configs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// TTS: save config (add or update)
ipcMain.handle('tts-save-config', async (event, config) => {
  try {
    if (!config || typeof config !== 'object') return { success: false, error: 'Invalid config payload' };

    // Normalize and validate name
    config.name = config.name ? String(config.name).trim() : '';
    if (!config.name) return { success: false, error: 'Config name is required' };

    // Normalize provider
    config.provider = config.provider ? String(config.provider).toLowerCase() : 'voicevox';
    if (!['voicevox', 'google'].includes(config.provider)) {
      return { success: false, error: 'Unknown provider. Use "voicevox" or "google"' };
    }

    // Ensure params is an object
    if (!config.params || typeof config.params !== 'object') config.params = {};

    // Persist safely
    const configs = store.get('ttsConfigs', []);
    try {
      // If id provided, update existing
      if (config.id) {
        const idx = configs.findIndex(c => String(c.id) === String(config.id));
        if (idx !== -1) {
          configs[idx] = config;
        } else {
          configs.push(config);
        }
      } else {
        config.id = Date.now().toString();
        configs.push(config);
      }

      store.set('ttsConfigs', configs);
      return { success: true, configs, savedConfigId: config.id };
    } catch (writeErr) {
      console.error('Error saving TTS config to store:', writeErr);
      return { success: false, error: writeErr.message || String(writeErr) };
    }
  } catch (error) {
    console.error('tts-save-config handler error:', error);
    return { success: false, error: error.message || String(error) };
  }
});

// Delete TTS config
ipcMain.handle('tts-delete-config', async (event, configId) => {
  try {
    if (!configId) return { success: false, error: 'Config ID is required' };

    const configs = store.get('ttsConfigs', []);
    const originalLength = configs.length;

    // Filter out the config with matching ID
    const filteredConfigs = configs.filter(c => String(c.id) !== String(configId));

    if (filteredConfigs.length === originalLength) {
      return { success: false, error: 'Config not found' };
    }

    // Save updated configs
    store.set('ttsConfigs', filteredConfigs);

    // If this was the last selected config, clear the selection
    const lastSelected = store.get('lastSelectedTtsConfigId');
    if (lastSelected && String(lastSelected) === String(configId)) {
      store.delete('lastSelectedTtsConfigId');
    }

    return { success: true, message: 'Config deleted successfully' };
  } catch (error) {
    console.error('tts-delete-config handler error:', error);
    return { success: false, error: error.message || String(error) };
  }
});

/**
 * Synthesize TTS with automatic sentence splitting
 * @param {string} text - Full text to synthesize
 * @param {Object} cfg - TTS config
 * @param {string} outputPath - Final output file path
 * @param {BrowserWindow} window - Main window for progress updates
 * @param {number} maxSentenceLength - Maximum sentence length in characters
 * @param {string} taskId - Task ID for progress tracking
 * @returns {Promise<Object>} Result with success, filePath, srtPath
 */
async function synthesizeWithSentenceSplit(text, cfg, outputPath, window, maxSentenceLength = 120, taskId = null) {
  try {
    // 1. Split text into sentences
    const sentences = sentenceUtils.splitIntoSentences(text, maxSentenceLength);
    
    if (sentences.length === 0) {
      return { success: false, error: 'No sentences found in text' };
    }
    
    // 2. Create temp directory for individual audio files
    const tempDir = path.join(app.getPath('temp'), `tts_sentences_${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const provider = (cfg && cfg.provider) ? cfg.provider : 'voicevox';
    const audioExt = provider === 'google' ? '.mp3' : '.wav';
    
    // 3. Synthesize each sentence (parallel processing)
    // VoiceVox: 20 concurrent sentences, Google and others: 10 concurrent sentences
    const MAX_CONCURRENT_SENTENCES = (provider === 'voicevox') 
      ? config.MAX_CONCURRENT_SENTENCES_VOICEVOX 
      : config.MAX_CONCURRENT_SENTENCES_OTHER;
    const sentenceData = [];
    let currentTime = 0;
    let completedCount = 0;
    
    // Prepare provider configs
    let speaker, voicevoxUrl, audioConfig, apiKey, voiceName, languageCode;
    
    if (provider === 'voicevox') {
      speaker = (cfg && cfg.params && cfg.params.voice_code !== undefined) ? cfg.params.voice_code : 1;
      voicevoxUrl = (cfg && cfg.params && cfg.params.voicevoxUrl) ? cfg.params.voicevoxUrl : 'http://127.0.0.1:50021';
      audioConfig = (cfg && cfg.params && cfg.params.audioConfig) ? cfg.params.audioConfig : {};
      
      // Check/start VoiceVox server once
      const isRunning = await voicevoxUtils.checkVoiceVoxServer(voicevoxUrl);
      if (!isRunning) {
        const startResult = await voicevoxUtils.startVoiceVoxServer(voicevoxUrl);
        if (!startResult.success) {
          throw new Error(startResult.error || 'Could not start VoiceVox server');
        }
      }
    } else if (provider === 'google') {
      // Get Google API key
      apiKey = (cfg && cfg.params && cfg.params.apiKey) ? cfg.params.apiKey : null;
      if (!apiKey) {
        const tts = store.get('googleTts', {}) || {};
        apiKey = tts.apiKey;
        if (!apiKey) {
          const g = store.get('googleVision', {}) || {};
          const keys = g.apiKeys || g.apiKey || [];
          if (Array.isArray(keys) && keys.length > 0) apiKey = keys[0];
          if (!apiKey && typeof keys === 'string' && keys.trim()) apiKey = keys.trim();
        }
      }
      
      voiceName = (cfg && cfg.params && cfg.params.voice_code) ? cfg.params.voice_code : 'ja-JP-Chirp3-HD-Zephyr';
      languageCode = (cfg && cfg.params && cfg.params.language_code) ? cfg.params.language_code : 'ja-JP';
      audioConfig = (cfg && cfg.params && cfg.params.audioConfig) ? cfg.params.audioConfig : {};
    }
    
    // Process sentences with pipeline (always keep 10 running)
    async function synthesizeSentence(i, sentence) {
      const sentencePath = path.join(tempDir, `sentence_${i.toString().padStart(4, '0')}${audioExt}`);
      
      
      // Synthesize this sentence
      let result;
      if (provider === 'voicevox') {
        result = await ttsUtils.synthesizeWithVoiceVox({ 
          text: sentence, 
          speaker, 
          outputPath: sentencePath, 
          voicevoxUrl, 
          audioConfig 
        });
      } else if (provider === 'google') {
        result = await ttsUtils.synthesizeWithGoogle({ 
          text: sentence, 
          apiKey, 
          voiceName, 
          languageCode, 
          outputPath: sentencePath, 
          audioEncoding: 'MP3', 
          audioConfig 
        });
      }
      
      if (!result || !result.success) {
        throw new Error(`Failed to synthesize sentence ${i + 1}: ${result.error || 'Unknown error'}`);
      }
      
      // Get audio duration
      const duration = await audioUtils.getAudioDuration(sentencePath);
      
      return {
        index: i,
        text: sentence,
        filePath: sentencePath,
        duration: duration
      };
    }
    
    // Pipeline processing: always keep MAX_CONCURRENT_SENTENCES running
    const results = new Array(sentences.length); // Pre-allocate array to maintain order
    let nextIndex = 0;
    let processedCount = 0;
    const activePromises = new Map(); // Track active promises by index
    
    // Start initial batch
    for (let i = 0; i < Math.min(MAX_CONCURRENT_SENTENCES, sentences.length); i++) {
      const promise = synthesizeSentence(i, sentences[i]).then(result => {
        activePromises.delete(i);
        results[i] = result;
        processedCount++;
        
        // Send progress update to renderer
        if (window && !window.isDestroyed() && taskId) {
          window.webContents.send('tts-sentence-progress', {
            taskId: taskId,
            current: processedCount,
            total: sentences.length,
            sentence: result.text.substring(0, 100)
          });
        }
        
        return i;
      }).catch(error => {
        activePromises.delete(i);
        throw error;
      });
      activePromises.set(i, promise);
      nextIndex++;
    }
    
    // Process remaining sentences: when one finishes, start the next
    while (nextIndex < sentences.length || activePromises.size > 0) {
      // Wait for at least one to complete
      await Promise.race(Array.from(activePromises.values()));
      
      // Start next sentence if available
      if (nextIndex < sentences.length) {
        const i = nextIndex++;
        const promise = synthesizeSentence(i, sentences[i]).then(result => {
          activePromises.delete(i);
          results[i] = result;
          processedCount++;
          
          // Send progress update to renderer
          if (window && !window.isDestroyed() && taskId) {
            window.webContents.send('tts-sentence-progress', {
              taskId: taskId,
              current: processedCount,
              total: sentences.length,
              sentence: result.text.substring(0, 100)
            });
          }
          
          return i;
        }).catch(error => {
          activePromises.delete(i);
          throw error;
        });
        activePromises.set(i, promise);
      }
    }
    
    // All sentences completed, now process results in order
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result) {
        sentenceData.push({
          text: result.text,
          filePath: result.filePath,
          startTime: currentTime,
          duration: result.duration,
          endTime: currentTime + result.duration
        });
        
        currentTime += result.duration;
      }
    }
    
    completedCount = processedCount;
    
    
    // 4. Concatenate audio files
    const audioFiles = sentenceData.map(s => s.filePath);
    await audioUtils.concatenateAudioFiles(audioFiles, outputPath);
    
    // 5. Generate SRT file
    const srtPath = outputPath.replace(/\.(wav|mp3)$/i, '.srt');
    const srtContent = sentenceUtils.generateSrt(sentenceData);
    sentenceUtils.saveSrtFile(srtPath, srtContent);
    
    // 6. Clean up temp files
    sentenceData.forEach(s => {
      try {
        if (fs.existsSync(s.filePath)) {
          fs.unlinkSync(s.filePath);
        }
      } catch (e) {
        console.warn('Could not delete temp file:', s.filePath, e);
      }
    });
    
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (e) {
      console.warn('Could not delete temp directory:', tempDir, e);
    }
    
    return { 
      success: true, 
      filePath: outputPath, 
      srtPath: srtPath,
      sentenceCount: sentences.length,
      totalDuration: currentTime
    };
  } catch (error) {
    console.error('Error in synthesizeWithSentenceSplit:', error);
    return { success: false, error: error.message || String(error) };
  }
}

// TTS: synthesize and save file
ipcMain.handle('tts-synthesize', async (event, options) => {
  try {
    // options: { configId, provider, fileName, text, autoSplitSentences }
    if (!options || !options.text) return { success: false, error: 'No text provided' };

    const configs = store.get('ttsConfigs', []);
    let cfg = null;
    if (options.configId) cfg = configs.find(c => String(c.id) === String(options.configId));
    if (!cfg && options.provider) cfg = configs.find(c => c.provider === options.provider);

    // Determine save path
    const defaultName = (options.fileName && String(options.fileName).trim()) ? options.fileName.trim() : 'tts_output';
    const defaultExt = (cfg && cfg.provider === 'google') ? '.mp3' : '.wav';
    let filePath = null;
    
    // If saveFolder is provided, use it directly
    if (options.saveFolder && options.saveFolder.trim()) {
      const saveFolder = options.saveFolder.trim();
      // Ensure folder exists
      if (!fs.existsSync(saveFolder)) {
        fs.mkdirSync(saveFolder, { recursive: true });
      }
      // Generate unique filename if needed
      let fileName = defaultName + defaultExt;
      let counter = 1;
      while (fs.existsSync(path.join(saveFolder, fileName))) {
        fileName = `${defaultName}_${counter}${defaultExt}`;
        counter++;
      }
      filePath = path.join(saveFolder, fileName);
    } else {
      // Ask user where to save
      const { canceled, filePath: dialogPath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Lưu file giọng đọc',
        defaultPath: path.join(app.getPath('music') || app.getPath('desktop'), defaultName + defaultExt),
        filters: [ { name: 'Audio', extensions: [ defaultExt.replace('.', '') ] }, { name: 'All', extensions: ['*'] } ]
      });

      if (canceled || !dialogPath) return { success: false, error: 'Save canceled' };
      filePath = dialogPath;
    }

    // Check if auto split sentences mode
    if (options.autoSplitSentences) {
      const maxSentenceLength = options.maxSentenceLength || 120;
      const taskId = options.taskId || null;
      return await synthesizeWithSentenceSplit(options.text, cfg, filePath, mainWindow, maxSentenceLength, taskId);
    }

    // Choose provider
    const provider = (cfg && cfg.provider) ? cfg.provider : (options.provider || 'voicevox');

    if (provider === 'voicevox') {
      // Get speaker from voice_code (VoiceVox uses voice_code as speaker ID)
      const speaker = (cfg && cfg.params && cfg.params.voice_code !== undefined) ? cfg.params.voice_code : 1;
      const voicevoxUrl = (cfg && cfg.params && cfg.params.voicevoxUrl) ? cfg.params.voicevoxUrl : 'http://127.0.0.1:50021';
      const audioConfig = (cfg && cfg.params && cfg.params.audioConfig) ? cfg.params.audioConfig : {};
      
      
      // Check if VoiceVox server is running, start it if not
      const isRunning = await voicevoxUtils.checkVoiceVoxServer(voicevoxUrl);
      if (!isRunning) {
        const startResult = await voicevoxUtils.startVoiceVoxServer(voicevoxUrl);
        if (!startResult.success) {
          return { success: false, error: startResult.error || 'Không thể khởi động VoiceVox server' };
        }
      }
      
      const res = await ttsUtils.synthesizeWithVoiceVox({ text: options.text, speaker, outputPath: filePath, voicevoxUrl, audioConfig });
      return res;
    } else if (provider === 'google') {
      // Get apiKey: prefer config param, fallback to googleTts settings, then googleVision.apiKeys
      let apiKey = (cfg && cfg.params && cfg.params.apiKey) ? cfg.params.apiKey : null;
      if (!apiKey) {
        // Try Google TTS settings first
        const tts = store.get('googleTts', {}) || {};
        apiKey = tts.apiKey;
        
        // Fallback to Google Vision keys if no TTS key
        if (!apiKey) {
          const g = store.get('googleVision', {}) || {};
          const keys = g.apiKeys || g.apiKey || [];
          if (Array.isArray(keys) && keys.length > 0) apiKey = keys[0];
          if (!apiKey && typeof keys === 'string' && keys.trim()) apiKey = keys.trim();
        }
      }

      // Get voice_code and language_code from config
      const voiceName = (cfg && cfg.params && cfg.params.voice_code) ? cfg.params.voice_code : (options.voiceName || 'ja-JP-Chirp3-HD-Zephyr');
      const languageCode = (cfg && cfg.params && cfg.params.language_code) ? cfg.params.language_code : (options.languageCode || 'ja-JP');
      const audioConfig = (cfg && cfg.params && cfg.params.audioConfig) ? cfg.params.audioConfig : {};
      
      
      const res = await ttsUtils.synthesizeWithGoogle({ text: options.text, apiKey, voiceName, languageCode, outputPath: filePath, audioEncoding: 'MP3', audioConfig });
      return res;
    }

    return { success: false, error: 'Unknown provider' };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

// TTS: read language/voice JSON from bin
ipcMain.handle('tts-get-language-voices', async () => {
  try {
    const jsonPath = path.join(__dirname, 'bin', 'tts_language_voice.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: 'Language file not found' };
    const content = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(content);
    return { success: true, data };
  } catch (error) {
    console.error('Error reading tts_language_voice.json:', error);
    return { success: false, error: error.message || String(error) };
  }
});

// VoiceVox: check if server is running
ipcMain.handle('voicevox-check-server', async (event, voicevoxUrl) => {
  try {
    const url = voicevoxUrl || 'http://127.0.0.1:50021';
    const isRunning = await voicevoxUtils.checkVoiceVoxServer(url);
    return { success: true, isRunning };
  } catch (error) {
    console.error('voicevox-check-server error:', error);
    return { success: false, error: error.message || String(error) };
  }
});

// VoiceVox: start server if not running
ipcMain.handle('voicevox-start-server', async (event, voicevoxUrl) => {
  try {
    const url = voicevoxUrl || 'http://127.0.0.1:50021';
    const result = await voicevoxUtils.startVoiceVoxServer(url);
    return result;
  } catch (error) {
    console.error('voicevox-start-server error:', error);
    return { success: false, error: error.message || String(error) };
  }
});

// TTS: preview (synthesize to temp file and return path)
ipcMain.handle('tts-preview', async (event, options) => {
  try {
    // options: { entryType, languageCode, voice, params, text }
    if (!options || !options.text) return { success: false, error: 'No text provided' };

    // Determine provider type from options.entryType ('VOICE_VOX' or 'GOOGLE')
    const type = options.entryType || 'VOICE_VOX';
    const tmpDir = app.getPath('temp') || pathUtils.getBinPath();
    const fileName = `tts_preview_${Date.now()}`;
    const ext = (type === 'GOOGLE') ? '.mp3' : '.wav';
    const outPath = path.join(tmpDir, fileName + ext);

    if (type === 'VOICE_VOX') {
      const speaker = options.voiceCode || (options.voice && options.voice.voice_code) || 1;
      const voicevoxUrl = (options.voicevoxUrl) ? options.voicevoxUrl : (options.params && options.params.voicevoxUrl) || 'http://127.0.0.1:50021';
      const audioConfig = options.params || {};
      
      // Check if VoiceVox server is running, start it if not
      const isRunning = await voicevoxUtils.checkVoiceVoxServer(voicevoxUrl);
      if (!isRunning) {
        const startResult = await voicevoxUtils.startVoiceVoxServer(voicevoxUrl);
        if (!startResult.success) {
          return { success: false, error: startResult.error || 'Không thể khởi động VoiceVox server' };
        }
      }
      
      const res = await ttsUtils.synthesizeWithVoiceVox({ text: options.text, speaker, outputPath: outPath, voicevoxUrl, audioConfig });
      return res.success ? { success: true, filePath: outPath } : res;
    } else if (type === 'GOOGLE') {
      // Get apiKey: prefer from params, fallback to googleTts settings, then googleVision.apiKeys
      let apiKey = options.apiKey || (options.params && options.params.apiKey) || null;
      if (!apiKey) {
        // Try Google TTS settings first
        const tts = store.get('googleTts', {}) || {};
        apiKey = tts.apiKey;
        
        // Fallback to Google Vision keys if no TTS key
        if (!apiKey) {
          const g = store.get('googleVision', {}) || {};
          const keys = g.apiKeys || g.apiKey || [];
          if (Array.isArray(keys) && keys.length > 0) apiKey = keys[0];
          if (!apiKey && typeof keys === 'string' && keys.trim()) apiKey = keys.trim();
        }
      }
      
      const voiceName = options.voiceCode || (options.voice && options.voice.voice_code) || options.voiceName || 'chirp3';
      const languageCode = options.languageCode || (options.voice && options.voice.language_code) || 'en-US';
      const audioConfig = options.params || {};
      
      
      const res = await ttsUtils.synthesizeWithGoogle({ text: options.text, apiKey, voiceName, languageCode, outputPath: outPath, audioEncoding: 'MP3', audioConfig });
      return res.success ? { success: true, filePath: outPath } : res;
    }

    return { success: false, error: 'Unknown TTS type' };
  } catch (error) {
    console.error('tts-preview handler error:', error);
    return { success: false, error: error.message || String(error) };
  }
});

// IPC handler để xử lý video subtitle với VideoSubFinder
ipcMain.handle('process-video-subtitle', async (event, videoPath, cropBox) => {
  try {
    // Import videoSubFinderUtils
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    videoSubFinderUtils.setMainWindow(mainWindow);
    videoSubFinderUtils.setDependencies({
      ocrUtils: ocrUtils,
      store: store
    });
    
    return await videoSubFinderUtils.processVideoSubtitle(videoPath, cropBox);
  } catch (error) {
    console.error('Error processing video subtitle:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler để dừng xử lý video subtitle
ipcMain.handle('stop-video-subtitle-processing', async (event, taskId) => {
  try {
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    return await videoSubFinderUtils.stopTask(taskId);
  } catch (error) {
    console.error('Error stopping video subtitle processing:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler để chạy lại task đã dừng
ipcMain.handle('restart-video-subtitle-processing', async (event, taskId) => {
  try {
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    return await videoSubFinderUtils.restartTask(taskId);
  } catch (error) {
    console.error('Error restarting video subtitle processing:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rerun-video-subtitle', async (event, taskId) => {
  try {
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    return await videoSubFinderUtils.rerunVideoSubFinderTask(taskId);
  } catch (error) {
    console.error('Error rerunning video subtitle:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rerun-video-ocr', async (event, taskId) => {
  try {
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    return await videoSubFinderUtils.rerunTaskOCR(taskId);
  } catch (error) {
    console.error('Error rerunning video OCR:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler để đọc file SRT
ipcMain.handle('read-srt-file', async (event, srtPath) => {
  try {
    const fs = require('fs');
    if (!fs.existsSync(srtPath)) {
      return { success: false, error: 'File SRT không tồn tại' };
    }
    const content = fs.readFileSync(srtPath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler to write SRT file (used when user edits subtitles in the viewer)
ipcMain.handle('write-srt-file', async (event, srtPath, content) => {
  try {
    const fs = require('fs');
    if (!srtPath) return { success: false, error: 'No SRT path provided' };
    fs.writeFileSync(srtPath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error writing SRT file:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler để lấy task status
ipcMain.handle('get-video-subtitle-task-status', async (event, taskId) => {
  try {
    const videoSubFinderUtils = require('./utils/videoSubFinderUtils');
    const task = videoSubFinderUtils.getTask(taskId);
    if (task) {
      return { success: true, status: task.status, progress: task.progress, outputDir: task.outputDir, srtPath: task.srtPath };
    }
    return { success: false, error: 'Task không tìm thấy' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clear temp directory on app quit
app.on('before-quit', () => {
  videoSubFinderUtils.clearTempDir();
});
