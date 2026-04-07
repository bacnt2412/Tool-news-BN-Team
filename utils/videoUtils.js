const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { app } = require('electron');
const pathUtils = require('./pathUtils');

// Tìm yt-dlp path (import từ ytDlpUtils)
let findYtDlpPath;
let addCookiesToArgs;

// Set dependencies (called from main.js)
function setDependencies(deps) {
  findYtDlpPath = deps.findYtDlpPath;
  addCookiesToArgs = deps.addCookiesToArgs;
}

function getExtensionFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const ext = path.extname(parsedUrl.pathname || '').toLowerCase();
    return ext && ext.length <= 5 ? ext : '.jpg';
  } catch (error) {
    return '.jpg';
  }
}

// Hàm tải thumbnail
function downloadThumbnailToPath(url, filePath) {
  return new Promise((resolve, reject) => {
    // Sử dụng bin/thumbnails để lưu file (resources/bin không bị pack vào asar)
    const file = fs.createWriteStream(filePath);

    // Xử lý cả http và https
    const httpModule = url.startsWith('https') ? https : http;

    httpModule.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(filePath);
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
        // Redirect
        const redirectUrl = response.headers.location;
        const redirectModule = redirectUrl.startsWith('https') ? https : http;
        redirectModule.get(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(filePath);
          });
        }).on('error', reject);
      } else {
        reject(new Error(`Failed to download thumbnail: ${response.statusCode}`));
      }
    }).on('error', (error) => {
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => { });
      }
      reject(error);
    });
  });
}

function downloadThumbnail(url, videoId) {
  const thumbnailsDir = pathUtils.getThumbnailsDir();
  const extension = getExtensionFromUrl(url);
  const filePath = path.join(thumbnailsDir, `${videoId}${extension}`);
  return downloadThumbnailToPath(url, filePath);
}

// Hàm lấy danh sách subtitle từ yt-dlp --list-subs
function getSubtitleList(videoUrl) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = findYtDlpPath();
    const args = [
      videoUrl,
      '--list-subs',
      '--no-playlist'
    ];

    addCookiesToArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// Hàm parse ngôn ngữ gốc từ output của --list-subs
function parseOriginalLanguageFromListSubs(listSubsOutput) {
  // Tìm dòng có "Available subtitles for"
  const lines = listSubsOutput.split('\n');

  for (const line of lines) {
    // Format ví dụ: ja-orig  Japanese (Original)   vtt, srt, ttml, srv3, srv2, srv1, json3
    // Language code ở đầu dòng, sau đó là Name chứa (Original)
    
    // Kiểm tra nếu dòng chứa (Original)
    if (line.includes('(Original)')) {
      // Parse format: language_code  Language Name (Original)   formats
      // Lấy language code ở đầu dòng (có thể có đuôi -org hoặc -orig)
      // Pattern: bắt đầu dòng, language code (2 chữ cái, có thể có -xxx, có thể có -org hoặc -orig), sau đó là khoảng trắng
      const match = line.match(/^([a-z]{2}(?:-[a-z]+)?(?:-org|-orig)?)\s+/i);
      if (match) {
        return match[1]; // Return language code (ví dụ: ja-orig, en-org)
      }
      
      // Fallback: Nếu không match được ở đầu, thử tìm language code có đuôi -org hoặc -orig ở bất kỳ đâu trong dòng
      const matchOrg = line.match(/([a-z]{2}(?:-[a-z]+)?(?:-org|-orig))/i);
      if (matchOrg) {
        return matchOrg[1];
      }
    }
    
    // Kiểm tra nếu language code có đuôi -org hoặc -orig (không cần (Original) trong Name)
    // Format: language_code-org  Language Name   formats
    const matchOrgOnly = line.match(/^([a-z]{2}(?:-[a-z]+)?(?:-org|-orig))\s+/i);
    if (matchOrgOnly) {
      return matchOrgOnly[1];
    }
  }

  return null;
}

// Hàm detect ngôn ngữ gốc từ --list-subs
async function detectOriginalLanguageFromListSubs(videoUrl) {
  try {
    const listSubsOutput = await getSubtitleList(videoUrl);
    const languageCode = parseOriginalLanguageFromListSubs(listSubsOutput);

    if (languageCode) {
      return { language: languageCode, isAuto: false };
    }

    // Fallback nếu lỗi
    return { language: 'auto', isAuto: true };
  } catch (error) {
    console.error('Error detecting original language:', error);
    // Fallback nếu lỗi
    return { language: 'auto', isAuto: true };
  }
}

// Hàm tải subtitle
async function downloadSubtitle(videoUrl, videoId, videoInfo) {
  return new Promise(async (resolve, reject) => {

    // Sử dụng bin/subtitles để lưu file (resources/bin không bị pack vào asar)
    const subtitlesDir = pathUtils.getSubtitlesDir();

    const outputPath = path.join(subtitlesDir, `${videoId}.%(ext)s`);
    const ytDlpPath = findYtDlpPath();

    // Sử dụng --list-subs để xác định ngôn ngữ gốc
    let targetLanguage = 'auto';

    try {
      const languageInfo = await detectOriginalLanguageFromListSubs(videoUrl);
      targetLanguage = languageInfo.language;
    } catch (error) {
      console.warn('Không thể detect ngôn ngữ, sử dụng auto:', error.message);
    }

    const args = [
      videoUrl,
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', targetLanguage,
      '--sub-format', 'vtt',
      '-o', outputPath,
      '--skip-download',
      '--no-playlist'
    ];

    addCookiesToArgs(args);


    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        // Nếu lỗi với ngôn ngữ cụ thể, thử fallback
        if (targetLanguage !== 'auto' && targetLanguage !== 'en') {
          console.log(`Failed with language ${targetLanguage}, trying fallback...`);
          // Thử lại với auto hoặc en
          return downloadSubtitleFallback(videoUrl, videoId, resolve, reject);
        }
        reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
        return;
      }

      // Tìm file subtitle đã tải
      const possiblePaths = [
        path.join(subtitlesDir, `${videoId}.${targetLanguage}.vtt`),
        path.join(subtitlesDir, `${videoId}.vtt`),
        path.join(subtitlesDir, `${videoId}.en.vtt`),
        path.join(subtitlesDir, `${videoId}.auto.vtt`)
      ];

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          resolve(possiblePath);
          return;
        }
      }

      // Nếu không tìm thấy, thử tìm bất kỳ file nào trong thư mục
      const files = fs.readdirSync(subtitlesDir);
      const subtitleFile = files.find(f => f.startsWith(videoId) && f.endsWith('.vtt'));
      if (subtitleFile) {
        resolve(path.join(subtitlesDir, subtitleFile));
      } else {
        reject(new Error('Subtitle file not found'));
      }
    });
  });
}

// Hàm fallback để tải subtitle khi ngôn ngữ cụ thể thất bại
function downloadSubtitleFallback(videoUrl, videoId, resolve, reject) {
  const subtitlesDir = pathUtils.getSubtitlesDir();
  const outputPath = path.join(subtitlesDir, `${videoId}.%(ext)s`);
  const ytDlpPath = findYtDlpPath();

  // Thử với auto và en
  const fallbackLanguages = ['auto', 'en'];
  let currentLanguageIndex = 0;

  function tryNextLanguage() {
    if (currentLanguageIndex >= fallbackLanguages.length) {
      reject(new Error('Failed to download subtitle with all fallback languages'));
      return;
    }

    const targetLanguage = fallbackLanguages[currentLanguageIndex];
    const args = [
      videoUrl,
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', targetLanguage,
      '--sub-format', 'vtt',
      '-o', outputPath,
      '--skip-download',
      '--no-playlist'
    ];

    addCookiesToArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        currentLanguageIndex++;
        tryNextLanguage();
        return;
      }

      // Tìm file subtitle đã tải
      const possiblePaths = [
        path.join(subtitlesDir, `${videoId}.auto.vtt`),
        path.join(subtitlesDir, `${videoId}.en.vtt`),
        path.join(subtitlesDir, `${videoId}.vtt`)
      ];

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          resolve(possiblePath);
          return;
        }
      }

      // Nếu không tìm thấy, thử tìm bất kỳ file nào trong thư mục
      const files = fs.readdirSync(subtitlesDir);
      const subtitleFile = files.find(f => f.startsWith(videoId) && f.endsWith('.vtt'));
      if (subtitleFile) {
        resolve(path.join(subtitlesDir, subtitleFile));
      } else {
        currentLanguageIndex++;
        tryNextLanguage();
      }
    });
  }

  tryNextLanguage();
}

module.exports = {
  setDependencies,
  downloadThumbnail,
  downloadThumbnailToPath,
  getSubtitleList,
  parseOriginalLanguageFromListSubs,
  detectOriginalLanguageFromListSubs,
  downloadSubtitle,
  downloadSubtitleFallback
};

