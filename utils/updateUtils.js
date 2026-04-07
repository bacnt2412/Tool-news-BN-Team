const { autoUpdater } = require('electron-updater');
const { app, dialog } = require('electron');
const log = require('electron-log');
const licenseUtils = require('./licenseUtils');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// GitHub releases configuration
// Tự động lấy từ LICENSE_FILE_URL trong licenseUtils.js
// Không cần config ở 2 chỗ!
const githubInfo = licenseUtils.parseGitHubInfo();
const GITHUB_OWNER = githubInfo ? githubInfo.owner : 'bacnt2412';
const GITHUB_REPO = githubInfo ? githubInfo.repo : 'Tool-news-BN-Team';

log.info(`GitHub Info parsed from LICENSE_FILE_URL: owner=${GITHUB_OWNER}, repo=${GITHUB_REPO}`);

let mainWindow = null;
let updateCheckInProgress = false;

/**
 * Set main window reference for update notifications
 */
function setMainWindow(window) {
  mainWindow = window;
}

/**
 * Configure auto updater
 */
function configureAutoUpdater() {
  // Set GitHub repository (được lấy từ package.json build.publish)
  // Feed URL sẽ tự động là: https://github.com/bacnt2412/Tool-news-BN-Team/releases
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO
  });
  
  // Tắt auto download, để user quyết định
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  
  log.info(`Auto-updater configured for: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);

  // Event: Checking for update
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'checking',
        message: 'Đang kiểm tra phiên bản mới...'
      });
    }
  });

  // Event: Update available
  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'available',
        message: `Phiên bản mới ${info.version} đã có sẵn!`,
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate
      });
    }
  });

  // Event: Update not available
  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'not-available',
        message: 'Bạn đang sử dụng phiên bản mới nhất',
        version: info.version
      });
    }
  });

  // Event: Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    log.info('Download progress:', progressObj);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        message: 'Đang tải phiên bản mới...',
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond
      });
    }
  });

  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'downloaded',
        message: `Phiên bản ${info.version} đã tải xong. Khởi động lại để cập nhật.`,
        version: info.version
      });
    }
  });

  // Event: Error
  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'error',
        message: `Lỗi cập nhật: ${error.message}`
      });
    }
  });
}

/**
 * Check for updates manually
 */
async function checkForUpdates() {
  if (updateCheckInProgress) {
    log.info('Update check already in progress');
    return { success: false, message: 'Đang kiểm tra cập nhật...' };
  }

  try {
    updateCheckInProgress = true;
    log.info('Manually checking for updates');
    
    // Check if app is packaged (production)
    if (!app.isPackaged) {
      updateCheckInProgress = false;
      log.info('App is not packaged - update check skipped in dev mode');
      return {
        success: false,
        message: 'Update chỉ hoạt động khi app đã được build (production mode)',
        isDev: true
      };
    }
    
    const result = await autoUpdater.checkForUpdates();
    updateCheckInProgress = false;
    
    // Handle case where result is null (no connection or no releases)
    if (!result || !result.updateInfo) {
      log.warn('No update info returned - may be no releases on GitHub');
      return {
        success: false,
        message: 'Không thể kiểm tra cập nhật. Có thể chưa có release trên GitHub.'
      };
    }
    
    return {
      success: true,
      updateInfo: result.updateInfo
    };
  } catch (error) {
    updateCheckInProgress = false;
    log.error('Check for updates error:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Download update
 */
async function downloadUpdate() {
  try {
    log.info('Starting update download');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    log.error('Download update error:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Install update and restart
 */
function quitAndInstall() {
  log.info('Quitting and installing update');
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Get current app version
 */
function getCurrentVersion() {
  return app.getVersion();
}

/**
 * Auto check for updates on startup (optional)
 */
function autoCheckOnStartup(delayMs = 5000) {
  setTimeout(() => {
    log.info('Auto-checking for updates on startup');
    checkForUpdates();
  }, delayMs);
}

module.exports = {
  setMainWindow,
  configureAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getCurrentVersion,
  autoCheckOnStartup
};

