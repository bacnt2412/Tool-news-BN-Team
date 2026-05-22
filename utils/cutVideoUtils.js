const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const pathUtils = require('./pathUtils');

let mainWindow = null;

function setDependencies(deps = {}) {
  mainWindow = deps.mainWindow || null;
}

function findBinary(names) {
  const binPath = pathUtils.getBinPath();

  for (const name of names) {
    const localPath = path.join(binPath, name);
    if (fs.existsSync(localPath)) {
      return localPath;
    }
  }

  return names[0];
}

function findFfmpegPath() {
  return findBinary(process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']);
}

function findFfprobePath() {
  return findBinary(process.platform === 'win32' ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe']);
}

function sendProgress(progress, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cut-video-progress', {
      progress: Math.max(0, Math.min(100, Math.round(progress || 0))),
      message
    });
  }
}

function parseTimeToSeconds(time) {
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  const value = String(time || '').trim();
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  const parts = value.split(':').map(Number);
  if (parts.some(part => Number.isNaN(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function sanitizeFileName(fileName) {
  return String(fileName || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 160);
}

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    const ffprobePath = findFfprobePath();
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      videoPath
    ];

    execFile(ffprobePath, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message || 'Không thể đọc thông tin video bằng ffprobe'));
        return;
      }

      try {
        const data = JSON.parse(stdout || '{}');
        const stream = data.streams && data.streams[0] ? data.streams[0] : {};
        resolve({
          width: Number(stream.width) || 0,
          height: Number(stream.height) || 0,
          duration: Number(data.format && data.format.duration) || 0
        });
      } catch (parseError) {
        reject(new Error('Không thể parse thông tin video từ ffprobe'));
      }
    });
  });
}

function toEven(value) {
  const rounded = Math.max(2, Math.floor(Number(value) || 0));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function buildCropFilter(cropBox, videoInfo) {
  if (!cropBox || !videoInfo.width || !videoInfo.height) return null;

  const normalized = {
    x: Math.max(0, Math.min(1, Number(cropBox.x) || 0)),
    y: Math.max(0, Math.min(1, Number(cropBox.y) || 0)),
    width: Math.max(0, Math.min(1, Number(cropBox.width) || 1)),
    height: Math.max(0, Math.min(1, Number(cropBox.height) || 1))
  };

  if (
    normalized.x <= 0.005 &&
    normalized.y <= 0.005 &&
    normalized.width >= 0.99 &&
    normalized.height >= 0.99
  ) {
    return null;
  }

  let width = toEven(normalized.width * videoInfo.width);
  let height = toEven(normalized.height * videoInfo.height);
  let x = toEven(normalized.x * videoInfo.width);
  let y = toEven(normalized.y * videoInfo.height);

  width = Math.min(width, toEven(videoInfo.width));
  height = Math.min(height, toEven(videoInfo.height));

  if (x + width > videoInfo.width) x = toEven(videoInfo.width - width);
  if (y + height > videoInfo.height) y = toEven(videoInfo.height - height);

  x = Math.max(0, x);
  y = Math.max(0, y);

  return `crop=${width}:${height}:${x}:${y}`;
}

function buildOutputPaths(options) {
  const sourceBase = path.basename(options.videoPath, path.extname(options.videoPath));
  const baseName = sanitizeFileName(options.outputName) || `${sanitizeFileName(sourceBase)}_cut`;

  if (options.splitDuration) {
    return {
      outputPattern: path.join(options.outputFolder, `${baseName}_%03d.mp4`)
    };
  }

  return {
    outputPath: path.join(options.outputFolder, `${baseName}.mp4`)
  };
}

async function cutVideo(options = {}) {
  const videoPath = options.videoPath;
  const outputFolder = options.outputFolder;

  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, error: 'File video không tồn tại' };
  }

  if (!outputFolder) {
    return { success: false, error: 'Vui lòng chọn thư mục lưu' };
  }

  fs.mkdirSync(outputFolder, { recursive: true });

  const startSeconds = parseTimeToSeconds(options.startTime);
  const endSeconds = parseTimeToSeconds(options.endTime);
  const splitDuration = options.splitDuration ? Number(options.splitDuration) : null;

  if (startSeconds === null || endSeconds === null || startSeconds < 0 || endSeconds <= startSeconds) {
    return { success: false, error: 'Thời gian cắt không hợp lệ' };
  }

  if (splitDuration !== null && (!Number.isFinite(splitDuration) || splitDuration <= 0 || splitDuration >= (endSeconds - startSeconds))) {
    return { success: false, error: 'Thời gian cắt nhỏ không hợp lệ' };
  }

  try {
    sendProgress(1, 'Đang đọc thông tin video...');

    const ffmpegPath = findFfmpegPath();
    const videoInfo = await getVideoInfo(videoPath);
    const duration = endSeconds - startSeconds;
    const cropFilter = buildCropFilter(options.cropBox, videoInfo);
    const outputs = buildOutputPaths({
      videoPath,
      outputFolder,
      outputName: options.outputName,
      splitDuration
    });

    const args = [
      '-y',
      '-hide_banner',
      '-ss', String(startSeconds),
      '-i', videoPath,
      '-t', String(duration),
      '-map', '0:v:0',
    ];

    if (options.removeAudio) {
      args.push('-an');
    } else {
      args.push('-map', '0:a?');
    }

    if (cropFilter) {
      args.push('-vf', cropFilter);
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
    );

    if (!options.removeAudio) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }

    args.push(
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-metadata', 'comment='
    );

    if (splitDuration) {
      args.push(
        '-force_key_frames', `expr:gte(t,n_forced*${splitDuration})`,
        '-f', 'segment',
        '-segment_time', String(splitDuration),
        '-reset_timestamps', '1',
        outputs.outputPattern
      );
    } else {
      args.push('-movflags', '+faststart');
      args.push(outputs.outputPath);
    }

    sendProgress(2, 'Đang chạy FFmpeg...');

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let errorOutput = '';

      child.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;

        const matches = [...text.matchAll(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
        const last = matches[matches.length - 1];
        if (last) {
          const current = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
          const progress = Math.min(99, Math.max(2, (current / duration) * 100));
          sendProgress(progress, `Đang cắt video... ${Math.round(progress)}%`);
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Không thể chạy FFmpeg: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(errorOutput || `FFmpeg thoát với mã lỗi ${code}`));
      });
    });

    sendProgress(100, 'Hoàn thành');

    return {
      success: true,
      outputPath: outputs.outputPath || null,
      outputPattern: outputs.outputPattern || null
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  setDependencies,
  cutVideo
};
