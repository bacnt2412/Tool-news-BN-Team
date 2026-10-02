const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { app } = require('electron');
const pathUtils = require('./pathUtils');
const ytDlpUtils = require('./ytDlpUtils');

// Tìm yt-dlp path (import từ ytDlpUtils)
let findYtDlpPath;
let addCookiesToArgs;
let getCookieHeaderForUrl;
let getCookiesFilePaths;

// Set dependencies (called from main.js)
function setDependencies(deps) {
  findYtDlpPath = deps.findYtDlpPath;
  addCookiesToArgs = deps.addCookiesToArgs;
  getCookieHeaderForUrl = deps.getCookieHeaderForUrl;
  getCookiesFilePaths = deps.getCookiesFilePaths;
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

function isUsableCaptionLanguage(language) {
  const value = String(language || '').toLowerCase();
  return value && value !== 'live_chat' && !value.includes('storyboard');
}

function selectCaptionFormat(formats) {
  if (!Array.isArray(formats)) {
    return null;
  }

  return formats.find(format => format && format.ext === 'vtt' && format.url) || null;
}

function uniqueLanguages(languages) {
  return [...new Set(languages.filter(Boolean).map(language => String(language)))];
}

// Default audio may be a dubbed track selected for the current session.
function getOriginalAudioLanguages(videoInfo) {
  const audioTrackLanguages = Array.isArray(videoInfo?.audio_tracks)
    ? videoInfo.audio_tracks
      .filter(track => track?.is_original === true || track?.audio_is_original === true)
      .map(track => track?.language || track?.language_code || track?.id)
    : [];

  const detected = uniqueLanguages([
    videoInfo?.original_language,
    videoInfo?.language,
    ...audioTrackLanguages
  ]);
  return detected.length ? detected : uniqueLanguages([videoInfo?.default_audio_language]);
}

function findMatchingCaptionLanguage(languages, originalLanguage) {
  const normalizedOriginal = String(originalLanguage).toLowerCase();
  const baseOriginal = normalizedOriginal.split('-')[0];

  // YouTube may expose the source track as e.g. `ja-orig`.
  const explicitOriginal = languages.find(language => {
    const normalized = language.toLowerCase();
    return normalized === `${normalizedOriginal}-orig` ||
      normalized === `${baseOriginal}-orig` ||
      normalized === `${normalizedOriginal}-org` ||
      normalized === `${baseOriginal}-org`;
  });
  if (explicitOriginal) return explicitOriginal;

  const exact = languages.find(language => language.toLowerCase() === normalizedOriginal);
  if (exact) return exact;

  // en and en-US, for example, are both captions for English audio.
  return languages.find(language => {
    const normalized = language.toLowerCase();
    return normalized.split('-')[0] === baseOriginal &&
      !normalized.endsWith('-orig') && !normalized.endsWith('-org');
  }) || null;
}

function pickCaptionLanguage(captions, videoInfo) {
  const languages = Object.keys(captions || {}).filter(isUsableCaptionLanguage);

  for (const originalLanguage of getOriginalAudioLanguages(videoInfo)) {
    const matchingLanguage = findMatchingCaptionLanguage(languages, originalLanguage);
    if (matchingLanguage) return matchingLanguage;
  }

  // Dubbed captions can also carry the orig suffix: match audio first.
  const explicitlyOriginal = languages.find(language => /-(orig|org)$/i.test(language));
  if (explicitlyOriginal) return explicitlyOriginal;

  // User-requested fallback when no source-language track is available.
  const japanese = findMatchingCaptionLanguage(languages, 'ja');
  if (japanese) return japanese;

  // Never use the first returned subtitle: it can be a YouTube translation
  // selected differently by account, IP address, or locale.
  return null;
}

function findCaptionTrackFromVideoInfo(videoInfo) {
  return findCaptionTrackCandidates(videoInfo)[0] || null;
}

function findCaptionTrackCandidates(videoInfo) {
  return require('./captionSelection').getCaptionCandidates(videoInfo || {});
}

function validateSubtitleFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Không tìm thấy file transcript đã tải');
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    throw new Error('File transcript tải về đang rỗng');
  }

  // A caption endpoint can occasionally return an HLS manifest instead of
  // the requested VTT content. It is not copyable transcript text.
  if (/^#EXTM3U\b/i.test(content)) {
    throw new Error('YouTube trả về playlist HLS thay vì nội dung transcript');
  }

  return content;
}

function getRedirectHeaders(headers, sourceUrl, redirectUrl) {
  try {
    if (new URL(sourceUrl).origin === new URL(redirectUrl).origin) {
      return headers;
    }
  } catch (_) {}

  const safeHeaders = { ...headers };
  delete safeHeaders.Cookie;
  delete safeHeaders.cookie;
  delete safeHeaders.Authorization;
  delete safeHeaders.authorization;
  return safeHeaders;
}

function downloadCaptionUrlToFile(captionUrl, filePath, requestHeaders = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const httpModule = captionUrl.startsWith('https') ? https : http;

    const request = httpModule.get(captionUrl, { headers: requestHeaders }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close(() => {
          try { fs.unlinkSync(filePath); } catch (_) {}
          if (response.headers.location) {
            const redirectUrl = new URL(response.headers.location, captionUrl).toString();
            const redirectHeaders = getRedirectHeaders(requestHeaders, captionUrl, redirectUrl);
            downloadCaptionUrlToFile(redirectUrl, filePath, redirectHeaders).then(resolve).catch(reject);
          } else {
            reject(new Error('Caption redirect missing location'));
          }
        });
        return;
      }

      if (response.statusCode !== 200) {
        file.close(() => {
          try { fs.unlinkSync(filePath); } catch (_) {}
          reject(new Error(`Failed to download caption: ${response.statusCode}`));
        });
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            validateSubtitleFile(filePath);
            resolve(filePath);
          } catch (error) {
            try { fs.unlinkSync(filePath); } catch (_) {}
            reject(error);
          }
        });
      });
    });

    request.on('error', (error) => {
      file.close(() => {
        try { fs.unlinkSync(filePath); } catch (_) {}
        reject(error);
      });
    });

    file.on('error', (error) => {
      request.destroy();
      try { fs.unlinkSync(filePath); } catch (_) {}
      reject(error);
    });
  });
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
    ytDlpUtils.addEjsRuntimeArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
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

function downloadSubtitleWithYtDlp(videoUrl, videoId, targetLanguages, cookieFilePath) {
  return new Promise((resolve, reject) => {
    const subtitlesDir = pathUtils.getSubtitlesDir();
    const outputPath = path.join(subtitlesDir, `${videoId}.%(ext)s`);
    const ytDlpPath = findYtDlpPath();
    const languages = [...new Set(targetLanguages.filter(Boolean))];
    const languageSelector = languages.join(',');
    const args = [
      videoUrl,
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', languageSelector,
      '--sub-format', 'vtt',
      '--force-overwrites',
      '-o', outputPath,
      '--skip-download',
      '--no-playlist'
    ];

    addCookiesToArgs(args, cookieFilePath);
    ytDlpUtils.addEjsRuntimeArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout, stderr) => {
      // yt-dlp can exit non-zero when one requested language fails even though
      // it successfully wrote the other one. Always inspect every output first.
      for (const language of languages) {
        const subtitlePath = path.join(subtitlesDir, `${videoId}.${language}.vtt`);
        try {
          validateSubtitleFile(subtitlePath);
          resolve(subtitlePath);
          return;
        } catch (_) {}
      }

      if (error) {
        reject(new Error(`yt-dlp (${languageSelector}) failed: ${stderr || error.message}`));
      } else {
        reject(new Error(`yt-dlp không tạo file transcript hợp lệ (${languageSelector})`));
      }
    });
  });
}

// Hàm tải subtitle. Một cookie được giữ nguyên từ lúc lấy metadata đến mọi
// lần thử caption, tránh đổi phiên giữa chừng khi nhiều video chạy song song.
async function downloadSubtitle(videoUrl, videoId, videoInfo, cookieFilePath = null) {
  const subtitlesDir = pathUtils.getSubtitlesDir();
  const originalLanguages = getOriginalAudioLanguages(videoInfo);
  const captionTracks = findCaptionTrackCandidates(videoInfo);
  if (!captionTracks.length) {
    throw new Error('Không tìm thấy phụ đề nguồn chưa dịch của video');
  }
  const fallbackLanguages = [...new Set(captionTracks.map(track => track.language))];

  const directErrors = [];
  for (const captionTrack of captionTracks) {
    if (!captionTrack.format) continue;
    const ext = captionTrack.format.ext || 'vtt';
    const directSubtitlePath = path.join(subtitlesDir, `${videoId}.${captionTrack.language}.${ext}`);
    const requestHeaders = { ...(videoInfo?.http_headers || {}) };
    const cookieHeader = typeof getCookieHeaderForUrl === 'function'
      ? getCookieHeaderForUrl(cookieFilePath, captionTrack.format.url)
      : '';

    if (cookieHeader) requestHeaders.Cookie = cookieHeader;
    if (!requestHeaders['User-Agent']) requestHeaders['User-Agent'] = 'Mozilla/5.0';
    if (!requestHeaders.Referer) requestHeaders.Referer = videoUrl;

    try {
      const downloadedPath = await downloadCaptionUrlToFile(
        captionTrack.format.url,
        directSubtitlePath,
        requestHeaders
      );
      console.info(`Transcript direct download succeeded: ${videoId} (${captionTrack.language})`);
      return downloadedPath;
    } catch (error) {
      directErrors.push(`${captionTrack.language}: ${error.message}`);
      console.warn(`Direct transcript failed for ${videoId} (${captionTrack.language}):`, error.message);
    }
  }

  const ytDlpErrors = [];
  const availableCookieFiles = typeof getCookiesFilePaths === 'function'
    ? getCookiesFilePaths()
    : [];
  const cookieCandidates = [];

  function addCookieCandidate(candidate) {
    if (!cookieCandidates.includes(candidate)) cookieCandidates.push(candidate);
  }

  addCookieCandidate(cookieFilePath);
  availableCookieFiles.forEach(addCookieCandidate);

  // Four attempts cover the pinned cookie plus several independent sessions,
  // while avoiding an excessive number of YouTube requests for videos that
  // genuinely have no captions.
  const retryCookies = cookieCandidates.slice(0, 4);
  for (const retryCookieFilePath of retryCookies) {
    const cookieLabel = retryCookieFilePath ? path.basename(retryCookieFilePath) : 'không-cookie';
    try {
      const downloadedPath = await downloadSubtitleWithYtDlp(
        videoUrl,
        videoId,
        fallbackLanguages,
        retryCookieFilePath
      );
      console.info(`Transcript yt-dlp fallback succeeded: ${videoId} (${fallbackLanguages.join(',')}; ${cookieLabel})`);
      return downloadedPath;
    } catch (error) {
      ytDlpErrors.push(`${cookieLabel}: ${error.message}`);
      console.warn(`yt-dlp transcript failed for ${videoId} (${cookieLabel}):`, error.message);
    }
  }

  const languageDescription = originalLanguages.length > 0
    ? originalLanguages.join(', ')
    : 'không xác định';
  const directDescription = directErrors.length > 0
    ? directErrors.join(' | ')
    : `metadata không có URL caption (audio gốc: ${languageDescription})`;
  throw new Error(`Không tải được transcript. Direct: ${directDescription}. yt-dlp: ${ytDlpErrors.join(' | ')}`);
}

// Hàm fallback để tải subtitle khi ngôn ngữ cụ thể thất bại
function downloadSubtitleFallback(videoUrl, videoId, resolve, reject) {
  const subtitlesDir = pathUtils.getSubtitlesDir();
  const outputPath = path.join(subtitlesDir, `${videoId}.%(ext)s`);
  const ytDlpPath = findYtDlpPath();

  // Thử với auto và en
  const fallbackLanguages = ['en', 'vi', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'all,-live_chat'];
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
    ytDlpUtils.addEjsRuntimeArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout, stderr) => {
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

