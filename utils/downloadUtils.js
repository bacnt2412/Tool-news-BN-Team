const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const pathUtils = require('./pathUtils');
const ytDlpUtils = require('./ytDlpUtils');

let mainWindow;
let findYtDlpPath;
let addCookiesToArgs;
let getCookiesFilePaths;
let getNextCookiesFilePath;

function isCookieErrorOutput(output) {
  const normalizedOutput = String(output || '').toLowerCase();
  return normalizedOutput.includes('sign in to confirm') ||
    normalizedOutput.includes('--cookies-from-browser') ||
    normalizedOutput.includes('--cookies for the authentication') ||
    (normalizedOutput.includes('cookie') && (
      normalizedOutput.includes('bot') ||
      normalizedOutput.includes('authentication') ||
      normalizedOutput.includes('expired') ||
      normalizedOutput.includes('invalid') ||
      normalizedOutput.includes('login') ||
      normalizedOutput.includes('sign in')
    ));
}

// Set dependencies (called from main.js)
function setDependencies(deps) {
  mainWindow = deps.mainWindow;
  findYtDlpPath = deps.findYtDlpPath;
  addCookiesToArgs = deps.addCookiesToArgs;
  getCookiesFilePaths = deps.getCookiesFilePaths;
  getNextCookiesFilePath = deps.getNextCookiesFilePath;
}

// List formats và chọn format đúng hoặc gần nhất với độ phân giải mong muốn
function selectBestFormat(videoUrl, targetHeight, cookieFilePath = null) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = findYtDlpPath();
    const args = [
      videoUrl,
      '--list-formats',
      '--no-playlist'
    ];

    // Thêm cookies nếu có
    addCookiesToArgs(args, cookieFilePath);
    ytDlpUtils.addEjsRuntimeArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10, windowsHide: true }, (error, stdout, stderr) => {
      // Kiểm tra lỗi cookie trong output
      const output = stderr || stdout || '';
      const isCookieError = isCookieErrorOutput(output);
      
      if (isCookieError) {
        reject(new Error('COOKIE_ERROR: Vui lòng cập nhật cookies trong Settings. YouTube yêu cầu xác thực để tránh bot.'));
        return;
      }
      
      if (error) {
        reject(new Error(`yt-dlp --list-formats failed: ${stderr || error.message}`));
        return;
      }

      try {
        // Parse output để tìm format phù hợp
        const lines = stdout.split('\n');
        const formats = [];
        let inFormatTable = false;

        for (const line of lines) {
          // Bỏ qua header và separator
          if (line.includes('ID') && line.includes('EXT')) {
            inFormatTable = true;
            continue;
          }
          if (line.startsWith('---') || !line.trim()) {
            continue;
          }

          if (inFormatTable && line.trim()) {
            // Parse format line: ID EXT RESOLUTION FPS FILESIZE TBR PROTO
            // Ví dụ: "397 mp4 854x480 30 12345678 1234k https"
            // Hoặc: "251 webm audio only 5 12345678 1234k https"
            // Hoặc format khác: "ID  EXT   RESOLUTION  FPS  FILESIZE   TBR PROTO"
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
              const formatId = parts[0];
              
              // Tìm ext (có thể ở vị trí 1 hoặc 2)
              let ext = parts[1];
              let resolutionIdx = 2;
              
              // Nếu phần tử thứ 2 là số (có thể là codec ID), ext ở vị trí khác
              if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
                ext = parts[2];
                resolutionIdx = 3;
              }
              
              // Parse resolution (có thể là "854x480", "1920x1080", "audio only", etc.)
              let height = null;
              let width = null;
              let isVideo = false;
              let isAudio = false;
              let resolution = parts[resolutionIdx] || '';

              // Kiểm tra nếu là audio only
              if (resolution === 'audio' && parts[resolutionIdx + 1] === 'only') {
                isAudio = true;
                resolution = 'audio only';
              } else if (resolution && resolution.includes('x')) {
                // Parse resolution như "854x480"
                const [w, h] = resolution.split('x').map(Number);
                if (!isNaN(w) && !isNaN(h)) {
                  width = w;
                  height = h;
                  isVideo = true;
                }
              } else if (resolution === 'audio') {
                // Chỉ có "audio"
                isAudio = true;
                resolution = 'audio';
              }

              // Chỉ thêm video hoặc audio format, loại bỏ mhtml và các format không phù hợp
              if ((isVideo || isAudio) && ext && ext !== 'mhtml' && ext !== 'html') {
                formats.push({
                  id: formatId,
                  ext: ext,
                  width: width,
                  height: height,
                  isVideo: isVideo,
                  isAudio: isAudio,
                  resolution: resolution,
                  line: line
                });
              }
            }
          }
        }
        
        // Tìm format video phù hợp nhất
        let bestVideoFormat = null;
        let bestAudioFormat = null;
        let exactMatch = null; // Format có height chính xác
        let minHeightDiff = Infinity;
        let closestFormat = null; // Format gần nhất

        // Tìm video format phù hợp
        // Chỉ chọn video formats có extension phù hợp (mp4, webm, mkv, etc.)
        const validVideoExts = ['mp4', 'webm', 'mkv', 'flv', 'avi', 'mov', 'm4v'];
        for (const format of formats) {
          if (format.isVideo && format.height !== null && validVideoExts.includes(format.ext.toLowerCase())) {
            // Ưu tiên format có height chính xác
            if (format.height === targetHeight) {
              if (!exactMatch || format.id > exactMatch.id) {
                exactMatch = format;
              }
            } else {
              // Tìm format gần nhất
              const heightDiff = Math.abs(format.height - targetHeight);
              if (heightDiff < minHeightDiff) {
                minHeightDiff = heightDiff;
                closestFormat = format;
              }
            }
          }
          // Tìm audio format tốt nhất (ưu tiên format ID lớn hơn = chất lượng tốt hơn)
          // Chỉ chọn audio formats có extension phù hợp
          const validAudioExts = ['m4a', 'mp3', 'webm', 'opus', 'aac', 'ogg'];
          if (format.isAudio && validAudioExts.includes(format.ext.toLowerCase())) {
            if (!bestAudioFormat || parseInt(format.id) > parseInt(bestAudioFormat.id)) {
              bestAudioFormat = format;
            }
          }
        }

        // Chọn format: ưu tiên exact match, sau đó closest format
        bestVideoFormat = exactMatch || closestFormat;

        // Nếu tìm thấy video format, ưu tiên video+audio merge
        if (bestVideoFormat) {
          // Đảm bảo video format có extension hợp lệ
          if (!validVideoExts.includes(bestVideoFormat.ext.toLowerCase())) {
            // Tìm format khác có extension hợp lệ
            bestVideoFormat = null;
          } else if (bestAudioFormat) {
            // Merge video + audio
            resolve(`${bestVideoFormat.id}+${bestAudioFormat.id}`);
          } else {
            // Chỉ video (có thể đã có audio)
            resolve(bestVideoFormat.id);
          }
        }
        
        // Nếu chưa có format hợp lệ, tìm fallback
        if (!bestVideoFormat) {
          // Fallback: tìm format best có height <= target và extension hợp lệ
          for (const format of formats) {
            if (format.isVideo && format.height !== null && format.height <= targetHeight && 
                validVideoExts.includes(format.ext.toLowerCase())) {
              if (!bestVideoFormat || format.height > bestVideoFormat.height) {
                bestVideoFormat = format;
              }
            }
          }

          if (bestVideoFormat) {
            if (bestAudioFormat) {
              resolve(`${bestVideoFormat.id}+${bestAudioFormat.id}`);
            } else {
              resolve(bestVideoFormat.id);
            }
          } else {
            // Cuối cùng: dùng format string với filter linh hoạt hơn
            resolve(`bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`);
          }
        }
      } catch (parseError) {
        // Fallback về format string cũ
        resolve(`bestvideo[height=${targetHeight}]+bestaudio/best[height=${targetHeight}]/best`);
      }
    });
  });
}

// Helper function to convert HH:MM:SS to seconds
function timeToSeconds(timeStr) {
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

// Tìm ffmpeg binary (tương tự như tìm yt-dlp)
function findFfmpegPath() {
  const ffmpegNames = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

  // Tìm trong bin directory (cùng nơi với yt-dlp)
  const possibleBinPaths = [
    pathUtils.getBinPath(), // bin path (resources/bin hoặc project/bin)
  ].filter(p => p !== null);

  for (const binPath of possibleBinPaths) {
    for (const name of ffmpegNames) {
      const ffmpegPath = path.join(binPath, name);
      if (fs.existsSync(ffmpegPath)) {
        return ffmpegPath;
      }
    }
  }

  // Nếu không tìm thấy, trả về null (yt-dlp sẽ tìm trong PATH)
  return null;
}

// Build yt-dlp arguments for download
function buildDownloadArgs(url, outputPath, quality, selectedFormat = null, downloadType = 'full', startTime = null, endTime = null, audioOnly = false, cookieFilePath = null) {
  // Tham khảo từ app.py: thứ tự arguments và các options quan trọng
  const args = [
    '--no-playlist',
    '--force-overwrites', // Replace existing downloads, including older lower-resolution files.
    '--no-mtime',
    '--progress', // Enable progress output
    '--newline', // Use newline for progress (better parsing)
    '--console-title', // Enable console title updates (might help with progress)
    '--concurrent-fragments', '16', // Download 16 fragments concurrently (tăng tốc độ)
    '--fragment-retries', '10', // Retry fragments 10 times
    '--retries', '10', // Retry download 10 times
    '--file-access-retries', '3', // Retry file access
    '--abort-on-unavailable-fragment', // Quan trọng: abort nếu fragment không có
    '--no-write-info-json' // Don't write info json to save time
  ];

  // Add quality option - tham khảo chính xác từ app.py
  if (audioOnly) {
    args.push('-f', 'bestaudio/best');
    args.push('--extract-audio');
    args.push('--audio-format', 'mp3');
    args.push('--audio-quality', '0');
  } else if (selectedFormat) {
    // Sử dụng format đã chọn từ list-formats
    args.push('-f', selectedFormat);
    // Force mp4 format và extension
    args.push('--merge-output-format', 'mp4');
    // Lưu ý: --prefer-ffmpeg đã deprecated, không dùng nữa
  } else if (quality === 'best') {
    // Include separate HD video/audio streams; "best" alone only selects combined formats.
    args.push('-f', 'bestvideo*+bestaudio/best');
    args.push('-S', 'res');
    args.push('--merge-output-format', 'mp4');
  } else if (quality === 'worst') {
    args.push('-f', 'worst');
  }

  // Add cookies if available
  addCookiesToArgs(args, cookieFilePath);
  ytDlpUtils.addEjsRuntimeArgs(args);

  // Add segment download options if specified
  if (downloadType === 'segment' && startTime && endTime) {
    // Convert HH:MM:SS to seconds for yt-dlp
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    args.push('--download-sections', `*${startSeconds}-${endSeconds}`);
  }

  // Add ffmpeg location if available (quan trọng để merge video+audio)
  // Tham khảo từ app.py dòng 736: --ffmpeg-location FFMPEG_PATH
  const ffmpegPath = findFfmpegPath();
  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  // Output path
  args.push('-o', outputPath);

  // URL phải ở cuối cùng (theo thứ tự trong app.py)
  args.push(url);

  return args;
}

// Parse progress from yt-dlp output
function parseProgress(output, buffer) {
  const lines = buffer.split('\n');
  const newBuffer = lines.pop() || ''; // Keep incomplete line in buffer
  let progress = null;

  for (const line of lines) {
    // Try multiple progress formats
    // Format 1: [download] XX.X% of YY at ZZ speed
    // Format 2: [download]   XX.X% of YY MiB at ZZ MiB/s ETA XX:XX
    // Format 3: [download] XX.X% of ~YY MiB at ZZ MiB/s ETA XX:XX
    let progressMatch = line.match(/\[download\]\s*(\d+\.?\d*)%/i);
    if (progressMatch) {
      progress = parseFloat(progressMatch[1]);
    } else {
      // Format 4: Just percentage in line (anywhere)
      progressMatch = line.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        progress = parseFloat(progressMatch[1]);
        // Only use if it's a reasonable percentage (0-100)
        if (progress < 0 || progress > 100) {
          progress = null;
        }
      }
    }

    if (progress !== null && !isNaN(progress) && progress >= 0 && progress <= 100) {
      break; // Found valid progress
    }
  }

  return { progress, buffer: newBuffer };
}

// Send progress update to renderer
function sendProgressUpdate(taskKey, progress, status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      taskId: taskKey,
      progress: Math.round(progress),
      status: status
    });
  }
}

function cleanDownloadError(output, code = null) {
  const sanitizedOutput = String(output || '')
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '\n');
  const lines = sanitizedOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const errorLines = lines.filter(line => /(^|\s)ERROR:/i.test(line));
  const usefulLines = errorLines.length > 0 ? errorLines : lines.slice(-5);
  const detail = [...new Set(usefulLines)].join(' | ');
  const prefix = code === null ? 'Không thể khởi động yt-dlp' : `yt-dlp dừng với mã ${code}`;

  return detail ? `${prefix}: ${detail}`.slice(0, 2000) : prefix;
}

function sendDownloadError(taskKey, error) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      taskId: taskKey,
      progress: 0,
      status: 'error',
      error
    });
  }
}

function sendCookieRetryUpdate(taskKey, attempt, totalAttempts, previousError) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      taskId: taskKey,
      progress: 0,
      status: 'retrying-cookie',
      attempt,
      totalAttempts,
      message: `Lượt tải trước bị lỗi. Đang đổi cookie và thử lại (${attempt}/${totalAttempts})...`,
      previousError
    });
  }
}

// Find downloaded file
function findDownloadedFile(folder, fileName) {
  try {
    const files = fs.readdirSync(folder);
    // Look for file starting with fileName
    const downloadedFile = files.find(file => {
      const normalizedFile = file.toLowerCase();
      return file.startsWith(fileName) &&
        !normalizedFile.endsWith('.part') &&
        !normalizedFile.endsWith('.ytdl') &&
        !normalizedFile.includes('.metadata-clean-');
    });

    if (downloadedFile) {
      return path.join(folder, downloadedFile);
    }

    // Try with common extensions
    const extensions = ['.mp4', '.webm', '.mkv', '.m4a', '.mp3'];
    for (const ext of extensions) {
      const testPath = path.join(folder, fileName + ext);
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    }

    return path.join(folder, fileName);
  } catch (error) {
    return path.join(folder, fileName);
  }
}

function stripMediaMetadata(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      resolve(false);
      return;
    }

    const ffmpegPath = findFfmpegPath();
    if (!ffmpegPath) {
      resolve(false);
      return;
    }

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const tempPath = path.join(dir, `${base}.metadata-clean-${Date.now()}${ext || '.tmp'}`);
    const args = [
      '-y',
      '-hide_banner',
      '-i', filePath,
      '-map', '0',
      '-c', 'copy',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-metadata', 'comment=',
      tempPath
    ];

    const process = spawn(ffmpegPath, args, { windowsHide: true });
    let errorOutput = '';

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('error', (error) => {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      console.warn('Could not strip media metadata:', error.message);
      resolve(false);
    });

    process.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tempPath)) {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        console.warn('Could not strip media metadata:', errorOutput || `ffmpeg exited with code ${code}`);
        resolve(false);
        return;
      }

      try {
        fs.renameSync(tempPath, filePath);
        resolve(true);
      } catch (renameError) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
        try {
          fs.renameSync(tempPath, filePath);
          resolve(true);
        } catch (replaceError) {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
          console.warn('Could not replace media file after metadata cleanup:', replaceError.message || renameError.message);
          resolve(false);
        }
      }
    });
  });
}

// Run one complete download attempt with one pinned cookie. Format discovery
// and media download must use the same YouTube session.
function downloadVideoAttempt(options, cookieFilePath = null) {
  const { url, folder, fileName, quality, taskId, downloadType, startTime, endTime, audioOnly } = options;
  const taskKey = taskId !== undefined ? String(taskId) : Date.now().toString();

  return new Promise(async (resolve, reject) => {
    try {
      const ytDlpPath = findYtDlpPath();

      // Nếu có quality cụ thể (1080p, 720p, etc.), list formats và chọn format phù hợp
      let selectedFormat = null;
      if (!audioOnly && quality && quality.match(/^\d+p$/)) {
        const height = parseInt(quality.replace('p', ''));
        try {
          selectedFormat = await selectBestFormat(url, height, cookieFilePath);
        } catch (formatError) {
          // Nếu lỗi cookie, throw error để hiển thị thông báo
          if (formatError.message && formatError.message.includes('COOKIE_ERROR')) {
            throw formatError;
          }
          // Fallback về format string nếu không phải lỗi cookie
          selectedFormat = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
        }
      }

      // Build output path - force mp4 extension khi có selectedFormat
      // Nếu có selectedFormat (từ list-formats), đảm bảo output là mp4
      let outputPath;
      if (audioOnly) {
        outputPath = path.join(folder, `${fileName}.mp3`);
      } else if (selectedFormat) {
        // Khi dùng format ID cụ thể, force extension là mp4
        outputPath = path.join(folder, `${fileName}.mp4`);
      } else {
        outputPath = path.join(folder, `${fileName}.%(ext)s`);
      }

      // Build yt-dlp arguments
      const args = buildDownloadArgs(
        url,
        outputPath,
        quality,
        selectedFormat,
        downloadType,
        startTime,
        endTime,
        audioOnly,
        cookieFilePath
      );

      // Spawn yt-dlp process
      const downloadProcess = spawn(ytDlpPath, args, {
        cwd: folder,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let lastProgress = 0;
      let isFetching = true;
      let buffer = '';

      // Parse progress from yt-dlp output
      // yt-dlp outputs progress to stderr by default
      downloadProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        const output = data.toString();
        

        buffer += output;

        // Parse progress
        const { progress, buffer: newBuffer } = parseProgress(output, buffer);
        buffer = newBuffer;

        if (progress !== null && !isNaN(progress) && progress >= 0 && progress <= 100) {
          isFetching = false;
          // Always update if progress is different (even if slightly lower due to estimation)
          // Only skip if it's exactly the same rounded value
          const roundedProgress = Math.round(progress);
          const roundedLastProgress = Math.round(lastProgress);

          if (roundedProgress !== roundedLastProgress || progress === 100) {
            lastProgress = progress;
            sendProgressUpdate(taskKey, roundedProgress, 'downloading');
          }
        }
      });

      downloadProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        const output = data.toString();

        // Also check stdout for progress (some versions output there)
        const { progress } = parseProgress(output, output);

        if (progress !== null && !isNaN(progress) && progress >= 0 && progress <= 100) {
          isFetching = false;
          const roundedProgress = Math.round(progress);
          const roundedLastProgress = Math.round(lastProgress);

          if (roundedProgress !== roundedLastProgress || progress === 100) {
            lastProgress = progress;
            sendProgressUpdate(taskKey, roundedProgress, 'downloading');
          }
        }
      });

      downloadProcess.on('close', async (code) => {
        if (code === 0) {
          // Find the downloaded file
          const filePath = findDownloadedFile(folder, fileName);
          let isValidFile = false;
          try {
            const fileStats = fs.statSync(filePath);
            isValidFile = fileStats.isFile() && fileStats.size > 0;
          } catch (_) {}

          if (!isValidFile) {
            const errorMessage = 'yt-dlp đã kết thúc nhưng không tạo được file video hợp lệ.';
            reject(new Error(errorMessage));
            return;
          }

          await stripMediaMetadata(filePath);
          const downloadedFile = path.basename(filePath);

          resolve({
            success: true,
            filePath: filePath,
            fileName: downloadedFile
          });
        } else {
          // Kiểm tra nếu lỗi liên quan đến cookie
          const errorOutput = stderr || stdout;
          const isCookieError = isCookieErrorOutput(errorOutput);
          
          if (isCookieError) {
            reject(new Error('COOKIE_ERROR: Vui lòng cập nhật cookies trong Settings. YouTube yêu cầu xác thực để tránh bot.'));
          } else {
            const errorMessage = cleanDownloadError(errorOutput, code);
            reject(new Error(errorMessage));
          }
        }
      });

      downloadProcess.on('error', (error) => {
        const errorMessage = cleanDownloadError(error.message);
        reject(new Error(errorMessage));
      });

    } catch (error) {
      reject(error);
    }
  });
}

function getCookieAttemptOrder() {
  const cookieFiles = typeof getCookiesFilePaths === 'function'
    ? getCookiesFilePaths()
    : [];

  if (cookieFiles.length === 0) {
    return [null];
  }

  const firstCookie = typeof getNextCookiesFilePath === 'function'
    ? getNextCookiesFilePath()
    : cookieFiles[0];

  return [
    firstCookie,
    ...cookieFiles.filter(cookieFile => cookieFile !== firstCookie)
  ];
}

// Download video with automatic cookie rotation. Only surface a final error
// after every configured cookie has been tried.
async function downloadVideo(options) {
  const taskKey = options.taskId !== undefined
    ? String(options.taskId)
    : Date.now().toString();
  const cookieAttempts = getCookieAttemptOrder();
  const attemptErrors = [];

  sendProgressUpdate(taskKey, 0, 'fetching');

  for (let index = 0; index < cookieAttempts.length; index++) {
    if (index > 0) {
      sendCookieRetryUpdate(
        taskKey,
        index + 1,
        cookieAttempts.length,
        attemptErrors[index - 1]
      );
    }

    try {
      return await downloadVideoAttempt(options, cookieAttempts[index]);
    } catch (error) {
      attemptErrors.push(error?.message || 'Lỗi không xác định');
    }
  }

  const lastError = attemptErrors[attemptErrors.length - 1] || 'Không thể tải video.';
  const triedCookieCount = cookieAttempts.filter(Boolean).length;
  const attemptSuffix = triedCookieCount > 1
    ? ` Đã thử ${triedCookieCount} cookie nhưng đều thất bại.`
    : triedCookieCount === 1
      ? ' Không có cookie khác để thử.'
      : '';
  const allCookieErrors = attemptErrors.length > 0 &&
    attemptErrors.every(error => error.includes('COOKIE_ERROR'));

  if (allCookieErrors) {
    const errorMessage = `COOKIE_ERROR: ${lastError.replace(/^COOKIE_ERROR:\s*/, '')}${attemptSuffix}`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        taskId: taskKey,
        progress: 0,
        status: 'cookie-error',
        error: errorMessage.replace(/^COOKIE_ERROR:\s*/, '')
      });
    }
    throw new Error(errorMessage);
  }

  const errorMessage = `${lastError}${attemptSuffix}`;
  sendDownloadError(taskKey, errorMessage);
  throw new Error(errorMessage);
}

module.exports = {
  setDependencies,
  downloadVideo
};

