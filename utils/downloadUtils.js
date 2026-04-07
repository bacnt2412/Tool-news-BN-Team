const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const pathUtils = require('./pathUtils');

let mainWindow;
let findYtDlpPath;
let addCookiesToArgs;

// Set dependencies (called from main.js)
function setDependencies(deps) {
  mainWindow = deps.mainWindow;
  findYtDlpPath = deps.findYtDlpPath;
  addCookiesToArgs = deps.addCookiesToArgs;
}

// List formats và chọn format đúng hoặc gần nhất với độ phân giải mong muốn
function selectBestFormat(videoUrl, targetHeight) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = findYtDlpPath();
    const args = [
      videoUrl,
      '--list-formats',
      '--no-playlist'
    ];

    // Thêm cookies nếu có
    addCookiesToArgs(args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      // Kiểm tra lỗi cookie trong output
      const output = stderr || stdout || '';
      const isCookieError = output.includes('Sign in to confirm') || 
                           (output.includes('cookies') && output.includes('bot')) ||
                           output.includes('--cookies-from-browser') ||
                           output.includes('--cookies for the authentication');
      
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
            // Không dùng [ext=mp4] filter quá strict, để yt-dlp tự chọn format tốt nhất
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
function buildDownloadArgs(url, outputPath, quality, selectedFormat = null, downloadType = 'full', startTime = null, endTime = null) {
  // Tham khảo từ app.py: thứ tự arguments và các options quan trọng
  const args = [
    '--no-playlist',
    '--no-mtime',
    '--progress', // Enable progress output
    '--newline', // Use newline for progress (better parsing)
    '--console-title', // Enable console title updates (might help with progress)
    '--concurrent-fragments', '16', // Download 16 fragments concurrently (tăng tốc độ)
    '--fragment-retries', '10', // Retry fragments 10 times
    '--retries', '10', // Retry download 10 times
    '--file-access-retries', '3', // Retry file access
    '--abort-on-unavailable-fragment', // Quan trọng: abort nếu fragment không có
    '--no-part', // Don't use .part files (faster)
    '--no-write-info-json' // Don't write info json to save time
  ];

  // Add quality option - tham khảo chính xác từ app.py
  if (selectedFormat) {
    // Sử dụng format đã chọn từ list-formats
    args.push('-f', selectedFormat);
    // Force mp4 format và extension
    args.push('--merge-output-format', 'mp4');
    // Lưu ý: --prefer-ffmpeg đã deprecated, không dùng nữa
  } else if (quality === 'best') {
    args.push('-f', 'best');
  } else if (quality === 'worst') {
    args.push('-f', 'worst');
  }

  // Add cookies if available
  addCookiesToArgs(args);

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

// Find downloaded file
function findDownloadedFile(folder, fileName) {
  try {
    const files = fs.readdirSync(folder);
    // Look for file starting with fileName
    const downloadedFile = files.find(f => f.startsWith(fileName));

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

// Download video with progress tracking
function downloadVideo(options) {
  const { url, folder, fileName, quality, taskId, downloadType, startTime, endTime } = options;
  const taskKey = taskId !== undefined ? String(taskId) : Date.now().toString();

  return new Promise(async (resolve, reject) => {
    try {
      const ytDlpPath = findYtDlpPath();

      // Nếu có quality cụ thể (1080p, 720p, etc.), list formats và chọn format phù hợp
      let selectedFormat = null;
      if (quality && quality.match(/^\d+p$/)) {
        const height = parseInt(quality.replace('p', ''));
        try {
          selectedFormat = await selectBestFormat(url, height);
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
      if (selectedFormat) {
        // Khi dùng format ID cụ thể, force extension là mp4
        outputPath = path.join(folder, `${fileName}.mp4`);
      } else {
        outputPath = path.join(folder, `${fileName}.%(ext)s`);
      }

      // Build yt-dlp arguments
      const args = buildDownloadArgs(url, outputPath, quality, selectedFormat, downloadType, startTime, endTime);

      // Spawn yt-dlp process
      const downloadProcess = spawn(ytDlpPath, args, {
        cwd: folder
      });

      let stdout = '';
      let stderr = '';
      let lastProgress = 0;
      let isFetching = true;
      let buffer = '';

      // Send initial "fetching" status
      sendProgressUpdate(taskKey, 0, 'fetching');

      // Parse progress from yt-dlp output
      // yt-dlp outputs progress to stderr by default
      downloadProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        const output = data.toString();
        
        // Log để debug format selection
        if (output.includes('format') || output.includes('height') || output.includes('Downloading') || output.includes('info') || output.includes('Merger')) {
          // console.log(" ######### yt-dlp stderr:", output.trim());
        }

        // Kiểm tra lỗi cookie ngay khi xuất hiện
        if (output.includes('Sign in to confirm') || 
            (output.includes('cookies') && output.includes('bot')) ||
            output.includes('--cookies-from-browser') ||
            output.includes('--cookies for the authentication')) {
          // Gửi thông báo lỗi cookie ngay lập tức
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              taskId: taskKey,
              progress: 0,
              status: 'cookie-error',
              error: 'Vui lòng cập nhật cookies trong Settings để tiếp tục tải video. YouTube yêu cầu xác thực để tránh bot.'
            });
          }
        }

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

      downloadProcess.on('close', (code) => {
        if (code === 0) {
          // Find the downloaded file
          const filePath = findDownloadedFile(folder, fileName);
          const downloadedFile = path.basename(filePath);

          resolve({
            success: true,
            filePath: filePath,
            fileName: downloadedFile
          });
        } else {
          // Kiểm tra nếu lỗi liên quan đến cookie
          const errorOutput = stderr || stdout;
          const isCookieError = errorOutput.includes('Sign in to confirm') || 
                               errorOutput.includes('cookies') && errorOutput.includes('bot') ||
                               errorOutput.includes('authentication') ||
                               errorOutput.includes('--cookies-from-browser') ||
                               errorOutput.includes('--cookies for the authentication');
          
          if (isCookieError) {
            // Gửi thông báo đến renderer để hiển thị cho người dùng
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', {
                taskId: taskKey,
                progress: 0,
                status: 'cookie-error',
                error: 'Vui lòng cập nhật cookies trong Settings để tiếp tục tải video. YouTube yêu cầu xác thực để tránh bot.'
              });
            }
            reject(new Error('COOKIE_ERROR: Vui lòng cập nhật cookies trong Settings. YouTube yêu cầu xác thực để tránh bot.'));
          } else {
            reject(new Error(`Download failed với code ${code}: ${errorOutput}`));
          }
        }
      });

      downloadProcess.on('error', (error) => {
        reject(new Error(`Download error: ${error.message}`));
      });

    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  setDependencies,
  downloadVideo
};

