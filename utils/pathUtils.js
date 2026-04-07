/**
 * Path Utilities
 * Helper functions để lấy đường dẫn thư mục bin và các thư mục con
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Lấy đường dẫn thư mục bin (resources/bin khi build, hoặc project/bin khi dev)
 * @returns {string} - Đường dẫn thư mục bin
 */
function getBinPath() {
  // Khi build: resources/bin (không bị pack vào asar nhờ asarUnpack)
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'bin');
  }
  
  // Khi dev: project/bin
  return path.join(__dirname, '..', 'bin');
}

/**
 * Lấy đường dẫn file/folder trong bin
 * @param {string} relativePath - Đường dẫn tương đối từ bin (ví dụ: 'cookies', 'thumbnails', 'yt-dlp.exe')
 * @returns {string} - Đường dẫn đầy đủ
 */
function getBinFilePath(relativePath) {
  return path.join(getBinPath(), relativePath);
}

/**
 * Đảm bảo thư mục tồn tại trong bin
 * @param {string} relativePath - Đường dẫn tương đối từ bin
 * @returns {string} - Đường dẫn đầy đủ của thư mục
 */
function ensureBinDir(relativePath) {
  const dirPath = getBinFilePath(relativePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Lấy đường dẫn thư mục cookies (trong bin/cookies)
 * @returns {string}
 */
function getCookiesDir() {
  return ensureBinDir('cookies');
}

/**
 * Lấy đường dẫn thư mục thumbnails (trong bin/thumbnails)
 * @returns {string}
 */
function getThumbnailsDir() {
  return ensureBinDir('thumbnails');
}

/**
 * Lấy đường dẫn thư mục subtitles (trong bin/subtitles)
 * @returns {string}
 */
function getSubtitlesDir() {
  return ensureBinDir('subtitles');
}

/**
 * Lấy đường dẫn file cookies.txt
 * @returns {string}
 */
function getCookiesFilePath() {
  const cookiesDir = getCookiesDir();
  return path.join(cookiesDir, 'cookies.txt');
}

/**
 * Lấy đường dẫn yt-dlp.exe
 * @returns {string}
 */
function getYtDlpPath() {
  return getBinFilePath('yt-dlp.exe');
}

/**
 * Lấy đường dẫn yt-dlp-version.txt
 * @returns {string}
 */
function getYtDlpVersionFilePath() {
  return getBinFilePath('yt-dlp-version.txt');
}

module.exports = {
  getBinPath,
  getBinFilePath,
  ensureBinDir,
  getCookiesDir,
  getThumbnailsDir,
  getSubtitlesDir,
  getCookiesFilePath,
  getYtDlpPath,
  getYtDlpVersionFilePath
};

