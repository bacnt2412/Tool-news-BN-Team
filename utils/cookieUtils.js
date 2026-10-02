const fs = require('fs');
const path = require('path');
const pathUtils = require('./pathUtils');

let nextCookieIndex = 0;

/**
 * Chuẩn hoá cookie cũ (string) và cookie mới (mảng string) về cùng một dạng.
 * Mỗi phần tử trong mảng là một file Netscape cookie hoàn chỉnh.
 */
function normalizeCookies(cookiesContent) {
  const cookies = Array.isArray(cookiesContent) ? cookiesContent : [cookiesContent];

  return cookies
    .filter(cookie => typeof cookie === 'string')
    .map(cookie => cookie.trim())
    .filter(Boolean);
}

function getManagedCookieFiles() {
  const cookiesDir = pathUtils.getCookiesDir();
  return fs.readdirSync(cookiesDir)
    .filter(file => /^cookies(?:-\d+)?\.txt$/i.test(file))
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
}

// Hàm lưu cookie vào file
async function saveCookiesToFile(cookiesContent) {
  return new Promise((resolve, reject) => {
    // Sử dụng bin/cookies để lưu file (resources/bin không bị pack vào asar)
    const cookiesDir = pathUtils.getCookiesDir();
    const cookies = normalizeCookies(cookiesContent);

    try {
      if (cookies.length === 0) {
        throw new Error('Cookie không hợp lệ hoặc rỗng');
      }

      // Ghi mỗi cookie ra file riêng để các tác vụ yt-dlp có thể xoay vòng cookie
      // mà không ghi đè lên nhau khi tải song song.
      const cookieFilePaths = cookies.map((cookie, index) => {
        const filePath = path.join(cookiesDir, `cookies-${index + 1}.txt`);
        fs.writeFileSync(filePath, cookie, 'utf-8');
        return filePath;
      });

      const activeFiles = new Set(cookieFilePaths.map(filePath => path.basename(filePath)));
      getManagedCookieFiles().forEach(file => {
        if (!activeFiles.has(file)) {
          fs.unlinkSync(path.join(cookiesDir, file));
        }
      });

      nextCookieIndex = 0;
      resolve(cookieFilePaths[0]);
    } catch (error) {
      console.error('Error saving cookies file:', error);
      reject(error);
    }
  });
}

// Hàm xóa cookie file
function deleteCookiesFile() {
  const cookiesDir = pathUtils.getCookiesDir();
  getManagedCookieFiles().forEach(file => {
    try {
      fs.unlinkSync(path.join(cookiesDir, file));
    } catch (error) {
      console.error('Error deleting cookies file:', error);
    }
  });
  nextCookieIndex = 0;
}

// Hàm lấy các cookie file path nếu có
function getCookiesFilePaths() {
  const cookiesDir = pathUtils.getCookiesDir();
  return getManagedCookieFiles()
    .map(file => path.join(cookiesDir, file))
    .filter(filePath => fs.existsSync(filePath));
}

// Tương thích ngược với các chỗ cũ chỉ cần một file cookie.
function getCookiesFilePath() {
  return getCookiesFilePaths()[0] || null;
}

// Chọn cookie kế tiếp cho một tác vụ. Caller có thể giữ lại đường dẫn này để
// toàn bộ request của cùng một video dùng chung một phiên YouTube.
function getNextCookiesFilePath() {
  const cookieFilePaths = getCookiesFilePaths();

  if (cookieFilePaths.length === 0) {
    return null;
  }

  const cookiesFilePath = cookieFilePaths[nextCookieIndex % cookieFilePaths.length];
  nextCookieIndex = (nextCookieIndex + 1) % cookieFilePaths.length;
  return cookiesFilePath;
}

// Khi cookieFilePath được truyền vào, tiếp tục dùng đúng phiên đã chọn cho
// video thay vì xoay sang cookie khác.
function addCookiesToArgs(args, cookieFilePath) {
  const selectedCookieFilePath = arguments.length >= 2
    ? cookieFilePath
    : getNextCookiesFilePath();

  if (selectedCookieFilePath && fs.existsSync(selectedCookieFilePath)) {
    args.push('--cookies', selectedCookieFilePath);
  }
  return args;
}

function getCookieHeaderForUrl(cookieFilePath, targetUrl) {
  if (!cookieFilePath || !fs.existsSync(cookieFilePath)) {
    return '';
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_) {
    return '';
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const requestPath = parsedUrl.pathname || '/';
  const isSecureRequest = parsedUrl.protocol === 'https:';
  const currentEpochSeconds = Math.floor(Date.now() / 1000);
  const cookiePairs = [];

  const lines = fs.readFileSync(cookieFilePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine || (rawLine.startsWith('#') && !rawLine.startsWith('#HttpOnly_'))) {
      continue;
    }

    const fields = rawLine.split('\t');
    if (fields.length < 7) {
      continue;
    }

    const domain = fields[0].replace(/^#HttpOnly_/i, '').toLowerCase();
    const normalizedDomain = domain.replace(/^\./, '');
    const cookiePath = fields[2] || '/';
    const secureOnly = String(fields[3]).toUpperCase() === 'TRUE';
    const expiresAt = Number(fields[4]) || 0;
    const name = fields[5];
    const value = fields.slice(6).join('\t');

    const domainMatches = hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
    if (!domainMatches || !requestPath.startsWith(cookiePath)) continue;
    if (secureOnly && !isSecureRequest) continue;
    if (expiresAt > 0 && expiresAt <= currentEpochSeconds) continue;
    if (name) cookiePairs.push(`${name}=${value}`);
  }

  return cookiePairs.join('; ');
}

module.exports = {
  normalizeCookies,
  saveCookiesToFile,
  deleteCookiesFile,
  getCookiesFilePaths,
  getCookiesFilePath,
  getNextCookiesFilePath,
  getCookieHeaderForUrl,
  addCookiesToArgs
};

