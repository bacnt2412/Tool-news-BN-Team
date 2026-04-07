const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const pathUtils = require('./pathUtils');
let ocrUtils;
let store;

let mainWindow;
let processingQueue = [];
let activeProcesses = 0;
const MAX_CONCURRENT = 2;

// Clear temp directory on startup
function clearTempDir() {
  try {
    const tempDir = path.join(pathUtils.getBinPath(), 'temp');
    if (fs.existsSync(tempDir)) {
      console.log('🧹 Clearing temp directory:', tempDir);
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('✅ Temp directory cleared');
    }
  } catch (error) {
    console.error('❌ Error clearing temp directory:', error);
  }
}

// Clear temp directory immediately when module loads
clearTempDir();
const activeProcessHandles = new Map(); // Map taskId -> process handle

// Set mainWindow reference
function setMainWindow(window) {
  mainWindow = window;
}

// Set dependencies
function setDependencies(dependencies) {
  ocrUtils = dependencies.ocrUtils;
  store = dependencies.store;
}

function prepareOutputDirectory(outputDir) {
  try {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    throw new Error(`Không thể chuẩn bị thư mục output: ${error.message}`);
  }
}

// Tìm đường dẫn VideoSubFinder
function findVideoSubFinderPath() {
  // 1. Kiểm tra trong resources (cho app đã build)
  if (process.resourcesPath) {
    const resourcesPath = path.join(process.resourcesPath, 'bin', 'VideoSubFinder_6.10_x64', 'VideoSubFinderWXW.exe');
    if (fs.existsSync(resourcesPath)) {
      console.log('Found VideoSubFinder in resources:', resourcesPath);
      return resourcesPath;
    }
  }

  // 2. Kiểm tra trong thư mục bin (development)
  const binPath = path.join(__dirname, '..', 'bin', 'VideoSubFinder_6.10_x64', 'VideoSubFinderWXW.exe');
  if (fs.existsSync(binPath)) {
    console.log('Found VideoSubFinder in bin:', binPath);
    return binPath;
  }

  // 3. Kiểm tra trong thư mục gốc
  const rootPath = path.join(__dirname, '..', 'VideoSubFinder_6.10_x64', 'VideoSubFinderWXW.exe');
  if (fs.existsSync(rootPath)) {
    console.log('Found VideoSubFinder in root:', rootPath);
    return rootPath;
  }

  // 4. Kiểm tra trong thư mục hiện tại
  const currentPath = path.join(process.cwd(), 'VideoSubFinder_6.10_x64', 'VideoSubFinderWXW.exe');
  if (fs.existsSync(currentPath)) {
    console.log('Found VideoSubFinder in cwd:', currentPath);
    return currentPath;
  }

  console.error('VideoSubFinder not found! Checked paths:', {
    resourcesPath: process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'VideoSubFinder_6.10_x64', 'VideoSubFinderWXW.exe') : 'N/A',
    binPath,
    rootPath,
    currentPath
  });

  return null;
}

// Xử lý video subtitle với VideoSubFinder
async function processVideoSubtitle(videoPath, cropBox) {
  const videoSubFinderPath = findVideoSubFinderPath();

  if (!videoSubFinderPath) {
    return {
      success: false,
      error: 'VideoSubFinder không tìm thấy. Vui lòng đặt VideoSubFinder_6.10_x64 vào thư mục bin hoặc thư mục gốc của ứng dụng.'
    };
  }

  if (!fs.existsSync(videoPath)) {
    return {
      success: false,
      error: 'File video không tồn tại'
    };
  }

  // Tạo thư mục output trong bin/temp
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const tempDir = path.join(pathUtils.getBinPath(), 'temp');
  const outputDir = path.join(tempDir, `${videoName}_subtitle`);

  try {
    prepareOutputDirectory(outputDir);
  } catch (error) {
    return { success: false, error: error.message };
  }

  return new Promise((resolve, reject) => {
    // Tạo task ID
    const taskId = Date.now().toString();

    // Thêm vào queue
    const task = {
      id: taskId,
      videoPath,
      cropBox,
      outputDir,
      status: 'waiting',
      progress: 0
    };

    processingQueue.push(task);

    // Gửi thông báo task đã được thêm vào queue
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-subtitle-progress', {
        taskId,
        status: 'waiting',
        message: 'Đã thêm vào queue'
      });
    }

    // Xử lý queue
    processQueue();

    resolve({
      success: true,
      taskId,
      message: 'Đã thêm vào queue xử lý'
    });
  });
}

// Xử lý queue
function processQueue() {
  // Nếu đã đạt max concurrent hoặc queue rỗng, không làm gì
  if (activeProcesses >= MAX_CONCURRENT || processingQueue.length === 0) {
    return;
  }

  // Tìm task đầu tiên có status = 'waiting'
  const taskIndex = processingQueue.findIndex(t => t.status === 'waiting');
  if (taskIndex === -1) {
    return;
  }

  const task = processingQueue[taskIndex];
  task.status = 'processing';
  activeProcesses++;

  console.log('Starting processing for task:', task.id, 'Current status:', task.status);

  // Gửi thông báo bắt đầu xử lý - gửi ngay lập tức
  if (mainWindow && !mainWindow.isDestroyed()) {
    const progressData = {
      taskId: task.id,
      status: 'processing',
      message: 'Đang xử lý...',
      progress: 0,
      videoProgress: 0,
      ocrProgress: 0
    };
    mainWindow.webContents.send('video-subtitle-progress', progressData);
  } else {
    console.warn('Cannot send progress: mainWindow is null or destroyed');
  }

  // Chạy VideoSubFinder
  const processPromise = runVideoSubFinder(task);

  // Lưu process handle để có thể dừng sau
  activeProcessHandles.set(task.id, processPromise);

  processPromise
    .then(async () => {
      // Kiểm tra xem task có bị dừng không
      if (task.status === 'stopped') {
        return; // Không cập nhật status nếu đã bị dừng
      }

      // Sau khi VideoSubFinder hoàn thành, notify videoProgress=100 and start OCR
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-subtitle-progress', {
          taskId: task.id,
          status: 'processing',
          message: 'VideoSubFinder hoàn thành. Bắt đầu OCR...',
          progress: 50,
          videoProgress: 100,
          ocrProgress: 0
        });
      }

      // Sau khi VideoSubFinder hoàn thành, OCR ảnh và tạo SRT
        try {
          console.log('VideoSubFinder completed, starting OCR process...');
          await processImagesAndCreateSRT(task);
          console.log('OCR process completed');
        } catch (ocrError) {
          console.error('Error processing images and creating SRT:', ocrError);
          // If OCR was aborted due to stop, handle gracefully
          if (ocrError && String(ocrError.message).toLowerCase().includes('stopped')) {
            task.status = 'stopped';
            activeProcesses = Math.max(0, activeProcesses - 1);
            activeProcessHandles.delete(task.id);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('video-subtitle-progress', {
                taskId: task.id,
                status: 'stopped',
                message: 'Đã dừng',
                progress: 0
              });
            }
            processQueue();
            return;
          }

          // On any other OCR error, mark task as error and notify renderer
          task.status = 'error';
          activeProcesses = Math.max(0, activeProcesses - 1);
          activeProcessHandles.delete(task.id);
          const errMsg = (ocrError && ocrError.message) ? ocrError.message : 'OCR error';
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-subtitle-progress', {
              taskId: task.id,
              status: 'error',
              message: `OCR lỗi: ${errMsg}`,
              progress: 0,
              videoProgress: 100,
              ocrProgress: 0
            });
          }
          // Do not mark completed; stop processing further and proceed to next task
          processQueue();
          return;
        }

      task.status = 'completed';
      activeProcesses--;
      activeProcessHandles.delete(task.id);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-subtitle-progress', {
          taskId: task.id,
          status: 'completed',
          message: 'Hoàn thành',
          progress: 100,
          outputDir: task.outputDir,
          srtPath: task.srtPath
        });
      }

      // Xử lý task tiếp theo
      processQueue();
    })
    .catch((error) => {
      // Kiểm tra xem task có bị dừng không
      if (task.status === 'stopped') {
        activeProcessHandles.delete(task.id);
        return; // Không cập nhật status nếu đã bị dừng
      }

      task.status = 'error';
      activeProcesses--;
      activeProcessHandles.delete(task.id);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-subtitle-progress', {
          taskId: task.id,
          status: 'error',
          message: error.message || 'Lỗi khi xử lý',
          progress: 0
        });
      }

      // Xử lý task tiếp theo
      processQueue();
    });
}

// Lấy video resolution bằng ffprobe
function getVideoResolution(videoPath) {
  return new Promise((resolve, reject) => {
    // Tìm ffprobe trong resources (khi build) hoặc bin (khi dev)
    let ffprobePath = process.resourcesPath 
      ? path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
      : path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    
    // Fallback nếu không tìm thấy
    if (!fs.existsSync(ffprobePath)) {
      ffprobePath = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    }

    if (!fs.existsSync(ffprobePath)) {
      // Fallback: thử dùng ffprobe từ PATH
      execFile('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        videoPath
      ], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          if (data.streams && data.streams[0]) {
            resolve({
              width: data.streams[0].width,
              height: data.streams[0].height
            });
          } else {
            reject(new Error('Không thể lấy thông tin video'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    } else {
      execFile(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        videoPath
      ], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          if (data.streams && data.streams[0]) {
            resolve({
              width: data.streams[0].width,
              height: data.streams[0].height
            });
          } else {
            reject(new Error('Không thể lấy thông tin video'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    }
  });
}

// Lấy duration (giây) bằng ffprobe, safe wrapper that tries bundled ffprobe then PATH
function getVideoDurationSafe(videoPath) {
  return new Promise((resolve, reject) => {
    // Tìm ffprobe trong resources (khi build) hoặc bin (khi dev)
    let ffprobePath = process.resourcesPath 
      ? path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
      : path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    
    // Fallback nếu không tìm thấy
    if (!fs.existsSync(ffprobePath)) {
      ffprobePath = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    }

    const runProbe = (probeCmd) => {
      execFile(probeCmd, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath
      ], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        const txt = String(stdout || '').trim();
        const val = Number(txt);
        if (isNaN(val)) {
          reject(new Error('ffprobe returned invalid duration: ' + txt));
        } else {
          resolve(val);
        }
      });
    };

    if (fs.existsSync(ffprobePath)) {
      runProbe(ffprobePath);
    } else {
      // Try system ffprobe
      runProbe('ffprobe');
    }
  });
}

// Chạy VideoSubFinder
function runVideoSubFinder(task) {
  return new Promise(async (resolve, reject) => {
    const videoSubFinderPath = findVideoSubFinderPath();
    const { videoPath, cropBox, outputDir } = task;

    const args = [
      '-i', videoPath,
      '-o', outputDir,
      '--run_search',
      '--use_cuda',
      '-ccti',
      '-c'
    ];

    // Thêm crop box nếu có
    // cropBox có format: { x, y, width, height } với giá trị từ 0-1 (tương đối)
    // VideoSubFinder sử dụng hệ tọa độ tỷ lệ 0-1:
    // - -le (Left Edge): vị trí mép trái, tính từ trái sang (0 = sát mép trái, 1 = sát mép phải)
    // - -re (Right Edge): vị trí mép phải, tính từ trái sang (0 = sát mép trái, 1 = sát mép phải)
    // - -te (Top Edge): khoảng cách từ mép trên, tính từ trên xuống (0 = sát mép trên, 1 = sát mép dưới)
    // - -be (Bottom Edge): khoảng cách từ mép dưới, tính từ dưới lên (0 = sát mép dưới, 1 = sát mép trên)
    if (cropBox) {

      // Tính toán các edge dựa trên cropBox (0-1)
      let top = 1 - cropBox.y;
      let bottom = 1 - cropBox.y - cropBox.height;
      let left = cropBox.x;
      let right = cropBox.x + cropBox.width;


      if (0 < top && top < 1) {
        args.push('-te', top.toFixed(2));

      }
      if (0 < bottom && bottom < 1) {
        args.push('-be', bottom.toFixed(2));
      }
      if (0 < left && left < 1) {
        args.push('-le', left.toFixed(2));
      }
      if (0 < right && right < 1) {
        args.push('-re', right.toFixed(2));
      }

    }

    const process = spawn(videoSubFinderPath, args, {
      cwd: path.dirname(videoSubFinderPath),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Lưu process handle vào task để có thể dừng
    task.processHandle = process;

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
      // Parse progress từ output nếu có
      // VideoSubFinder có thể output progress, cần parse và gửi về renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video-subtitle-progress', {
          taskId: task.id,
          status: 'processing',
          message: 'Đang xử lý...',
          stdout: data.toString()
        });
      }
    });

    // Start a poller to compute videoProgress based on timestamps in RGBImages / TXTImages
    let poller = null;
    try {
      const durationSeconds = await getVideoDurationSafe(videoPath);
      if (durationSeconds && !isNaN(durationSeconds) && durationSeconds > 0) {
        const pollIntervalMs = 1000;
        poller = setInterval(() => {
          try {
            const rgbDir = path.join(outputDir, 'RGBImages');
            const txtDir = path.join(outputDir, 'TXTImages');

            let rgbMax = 0;
            let txtMax = 0;

            // Helper to compute max timestamp in a dir
            const computeMaxForDir = (dir) => {
              let maxTs = 0;
              try {
                if (!fs.existsSync(dir)) return 0;
                const files = fs.readdirSync(dir);
                for (const f of files) {
                  const t = parseTimestampFromFilename(f);
                  if (t == null) continue;
                  let seconds = null;
                  if (typeof t === 'number') seconds = t;
                  else if (typeof t === 'object') seconds = (typeof t.end === 'number' ? t.end : (typeof t.start === 'number' ? t.start : null));
                  if (seconds != null && !isNaN(seconds)) {
                    if (seconds > maxTs) maxTs = seconds;
                  }
                }
              } catch (e) {
                return 0;
              }
              return maxTs;
            };

            rgbMax = computeMaxForDir(rgbDir);
            txtMax = computeMaxForDir(txtDir);

            let rgbPercent = 0;
            let txtPercent = 0;
            if (durationSeconds > 0) {
              rgbPercent = Math.min(100, Math.round((rgbMax / durationSeconds) * 100));
              txtPercent = Math.min(100, Math.round((txtMax / durationSeconds) * 100));
            }

            // Each step (RGBImages, TXTImages) contributes 25% of overall.
            // We report videoProgress as combined percent (0..100) representing VideoSubFinder completion.
            const videoProgressCombined = Math.min(100, Math.round((rgbPercent + txtPercent) / 2));

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('video-subtitle-progress', {
                taskId: task.id,
                status: 'processing',
                message: 'Đang chạy VideoSubFinder',
                // legacy overall mapping (0..50) preserved in progress if needed
                progress: Math.round(videoProgressCombined / 2),
                videoProgress: videoProgressCombined,
                ocrProgress: 0,
                _debug: { rgbPercent, txtPercent, rgbMax, txtMax }
              });
            }
          } catch (err) {
            // ignore
          }
        }, pollIntervalMs);
      }
    } catch (err) {
      // ignore duration errors
    }

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('VideoSubFinder stderr:', data.toString());
    });

    process.on('close', (code) => {
      // Clear poller if running
      try { if (poller) clearInterval(poller); } catch(e) {}
      // Xóa process handle
      task.processHandle = null;

      // Kiểm tra nếu task bị dừng
      if (task.status === 'stopped') {
        resolve(); // Resolve nhưng không cập nhật status
        return;
      }

      if (code === 4294967295) {
        resolve();
      } else {
        reject(new Error(`VideoSubFinder exited with code ${code}. ${stderr}`));
      }
    });

    process.on('error', (error) => {
      // Clear poller if running
      try { if (poller) clearInterval(poller); } catch(e) {}
      task.processHandle = null;
      reject(new Error(`Failed to start VideoSubFinder: ${error.message}`));
    });
  });
}

// Lấy thông tin task
function getTask(taskId) {
  return processingQueue.find(t => t.id === taskId);
}

// Xóa task khỏi queue
function removeTask(taskId) {
  const index = processingQueue.findIndex(t => t.id === taskId);
  if (index !== -1) {
    processingQueue.splice(index, 1);
  }
}

// Dừng task đang chạy
async function stopTask(taskId) {
  const task = processingQueue.find(t => t.id === taskId);
  if (!task) {
    return { success: false, error: 'Task không tìm thấy' };
  }

  if (task.status !== 'processing') {
    return { success: false, error: 'Task không đang chạy' };
  }

  try {
    // Kill process nếu có
    if (task.processHandle) {
      task.processHandle.kill();
      task.processHandle = null;
    }

    // Cập nhật status
    task.status = 'stopped';
    activeProcesses--;
    activeProcessHandles.delete(taskId);

    // Gửi thông báo về renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-subtitle-progress', {
        taskId: task.id,
        status: 'stopped',
        message: 'Đã dừng',
        progress: 0
      });
    }

    // Xử lý task tiếp theo
    processQueue();

    return { success: true, message: 'Đã dừng task thành công' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// OCR ảnh và tạo file SRT
async function processImagesAndCreateSRT(task) {
  try {
    let { outputDir, videoPath } = task;

   let outputDirTXTImages = path.join(outputDir, 'TXTImages');
    // Kiểm tra outputDir có tồn tại không
    if (!fs.existsSync(outputDirTXTImages)) {
      console.warn('Output directory does not exist:', outputDirTXTImages);
      return;
    }

    // Tìm tất cả file ảnh trong outputDir
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp'];
    let files;
    try {
      files = fs.readdirSync(outputDirTXTImages);
    } catch (error) {
      console.error('Error reading output directory:', error);
      throw new Error(`Không thể đọc thư mục output: ${error.message}`);
    }

    const imageFiles = files
      .filter(file => imageExtensions.some(ext => file.toLowerCase().endsWith(ext)))
      .map(file => ({
        name: file,
        path: path.join(outputDirTXTImages, file)
      }))
      .sort(); // Sort để đảm bảo thứ tự

    if (imageFiles.length === 0) {
      console.log('No images found in output directory:', outputDirTXTImages);
      return;
    }

    console.log(`Found ${imageFiles.length} images to process`);

    // Calculate number of concurrent threads based on API keys
    // Microsoft: 1 key = 1 thread
    // Google: number of threads = ceil(apiKeys.length / 3)
    const providerFromTop = store.get('ocrProvider');
    const settingsLegacy = store.get('ocr', {});
    const provider = providerFromTop || settingsLegacy.provider || 'microsoft';
    
    let maxConcurrent = 1; // Default for Microsoft (1 key)
    if (provider === 'google') {
      const apiKeys = store.get('googleVision', {}).apiKeys || [];
      if (apiKeys && apiKeys.length > 0) {
        maxConcurrent = Math.ceil(apiKeys.length / 4);
        if (maxConcurrent < 1) maxConcurrent = 1; // At least 1 thread
      }
    }
    
    console.log(`OCR provider: ${provider}, Max concurrent threads: ${maxConcurrent}`);

    // Parse timestamp từ tên file và OCR từng ảnh với xử lý song song
    const subtitleEntries = [];
    let processedCount = 0;
    let errorCount = 0;

    // Process images with concurrency control
    async function processImageWithIndex(imageFile, index) {
      try {
        // Check if task was requested to stop before processing this image
        if (task.status === 'stopped') {
          console.log('ProcessImagesAndCreateSRT: aborting because task was stopped');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-subtitle-progress', {
              taskId: task.id,
              status: 'stopped',
              message: 'Đã dừng OCR',
              progress: 0
            });
          }
          throw new Error('stopped');
        }
        console.log(`Processing image ${index + 1}/${imageFiles.length}`);

        const timestampInfo = parseTimestampFromFilename(imageFile.name);
        
        if (!timestampInfo) {
          console.log(`Could not parse timestamp from: ${imageFile.name}`);
          return null;
        }
        
        let startTime = null;
        let endTime = null;
        if (typeof timestampInfo === 'number') {
          startTime = timestampInfo;
        } else if (typeof timestampInfo === 'object') {
          startTime = typeof timestampInfo.start === 'number' ? timestampInfo.start : null;
          endTime = typeof timestampInfo.end === 'number' ? timestampInfo.end : null;
        }
        
        if (startTime === null) {
          console.log(`Missing start timestamp for: ${imageFile.name}`);
          return null;
        }

        // OCR ảnh
        const ocrResult = await performOCR(imageFile.path);
        
        // If OCR utility returned an error (e.g., all Google keys exhausted), stop the whole task
        if (!ocrResult || ocrResult.success === false) {
          const errMsg = (ocrResult && ocrResult.error) ? ocrResult.error : 'Unknown OCR error';
          console.error('Fatal OCR error, aborting task:', errMsg);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-subtitle-progress', {
              taskId: task.id,
              status: 'error',
              message: `OCR lỗi: ${errMsg}`,
              progress: 0,
              videoProgress: 100,
              ocrProgress: 0
            });
          }
          throw new Error(`OCR failed: ${errMsg}`);
        }

        // Check again after OCR call in case a stop happened while performing OCR
        if (task.status === 'stopped') {
          console.log('ProcessImagesAndCreateSRT: aborting after OCR because task was stopped');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('video-subtitle-progress', {
              taskId: task.id,
              status: 'stopped',
              message: 'Đã dừng OCR',
              progress: 0
            });
          }
          throw new Error('stopped');
        }

        let textResult = ocrResult.text.replace(/\r\n/g, '\n').split('\n').map(item => item.trim()).join('').trim();

        if (ocrResult && ocrResult.success && ocrResult.text && ocrResult.text.trim()) {
          const entry = {
            start: startTime,
            end: endTime,
            text: textResult
          };
          return entry;
        } else {
          throw new Error(ocrResult?.error || 'No text');
        }
      } catch (error) {
        console.error(`Error processing ${imageFile.name}:`, error);
        // If this is a fatal OCR error (e.g., all API keys exhausted, quota exceeded) or explicit stop, rethrow
        const msg = (error && error.message) ? String(error.message).toLowerCase() : '';
        if (msg.includes('ocr failed') || msg.includes('google ai studio') || msg.includes('quota') || msg.includes('exceeded') || msg === 'stopped') {
          console.error('Fatal OCR error encountered, aborting processImagesAndCreateSRT:', error);
          throw error;
        }
        // Otherwise, return null to continue processing next image
        return null;
      }
    }

    // Process images with concurrency limit (pipeline processing)
    const activePromises = new Set();
    let currentIndex = 0;
    let hasFatalError = false;
    let fatalError = null;

    while (currentIndex < imageFiles.length && !hasFatalError) {
      // Check if task was stopped
      if (task.status === 'stopped') {
        console.log('ProcessImagesAndCreateSRT: aborting because task was stopped');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('video-subtitle-progress', {
            taskId: task.id,
            status: 'stopped',
            message: 'Đã dừng OCR',
            progress: 0
          });
        }
        throw new Error('stopped');
      }

      // Start up to maxConcurrent tasks
      while (activePromises.size < maxConcurrent && currentIndex < imageFiles.length) {
        const imageFile = imageFiles[currentIndex];
        const index = currentIndex;
        currentIndex++;

        const promise = processImageWithIndex(imageFile, index)
          .then((entry) => {
            if (entry) {
              subtitleEntries.push(entry);
              processedCount++;
            } else {
              errorCount++;
            }

            // Send OCR progress update after each image processed
            if (mainWindow && !mainWindow.isDestroyed()) {
              const totalProcessed = processedCount + errorCount;
              const ocrPercent = Math.round((totalProcessed / imageFiles.length) * 100);
              mainWindow.webContents.send('video-subtitle-progress', {
                taskId: task.id,
                status: 'processing',
                message: `Đang OCR ảnh ${totalProcessed}/${imageFiles.length}`,
                progress: 50 + Math.round(ocrPercent / 2), // overall progress approx
                videoProgress: 100,
                ocrProgress: ocrPercent
              });
            }
          })
          .catch((error) => {
            errorCount++;
            const msg = (error && error.message) ? String(error.message).toLowerCase() : '';
            // If fatal error, mark and stop all processing
            if (msg.includes('ocr failed') || msg.includes('google ai studio') || msg.includes('quota') || msg.includes('exceeded') || msg === 'stopped') {
              hasFatalError = true;
              fatalError = error;
            } else {
              // Otherwise, just log and continue
              console.error(`Non-fatal error processing image:`, error);
            }
          })
          .finally(() => {
            activePromises.delete(promise);
          });

        activePromises.add(promise);
      }

      // Wait for at least one promise to complete before starting more
      if (activePromises.size >= maxConcurrent) {
        await Promise.race(Array.from(activePromises));
      }
    }

    // Wait for all remaining promises to complete
    if (activePromises.size > 0) {
      await Promise.all(Array.from(activePromises));
    }

    // If there was a fatal error, throw it
    if (hasFatalError && fatalError) {
      throw fatalError;
    }

    // Sắp xếp theo thời gian bắt đầu
    subtitleEntries.sort((a, b) => {
      const aStart = a.start ?? 0;
      const bStart = b.start ?? 0;
      return aStart - bStart;
    });

    // Tạo file SRT
    if (subtitleEntries.length > 0) {
      try {
        const srtContent = generateSRT(subtitleEntries);
        const srtPath = path.join(outputDir, path.basename(videoPath, path.extname(videoPath)) + '.srt');
        fs.writeFileSync(srtPath, srtContent, 'utf8');
        task.srtPath = srtPath;
        console.log(`SRT file created: ${srtPath} with ${subtitleEntries.length} entries`);
      } catch (error) {
        console.error('Error creating SRT file:', error);
        throw new Error(`Không thể tạo file SRT: ${error.message}`);
      }
    } else {
      console.warn('No subtitle entries created, SRT file will not be generated');
    }
  } catch (error) {
    console.error('Error in processImagesAndCreateSRT:', error);
    throw error; // Re-throw để caller có thể xử lý
  }
}

// Parse timestamp từ tên file
function parseTimestampFromFilename(filename) {
  // Hỗ trợ format mới: 0_00_31_300__0_00_35_732...
  const rangeMatch = filename.match(/(\d+)_([0-5]\d)_([0-5]\d)_(\d{3})__+(\d+)_([0-5]\d)_([0-5]\d)_(\d{3})/);
  if (rangeMatch) {
    const startSeconds = convertUnderscoreTimeToSeconds(rangeMatch[1], rangeMatch[2], rangeMatch[3], rangeMatch[4]);
    const endSeconds = convertUnderscoreTimeToSeconds(rangeMatch[5], rangeMatch[6], rangeMatch[7], rangeMatch[8]);
    return { start: startSeconds, end: endSeconds };
  }

  // Format 00_01_23_456
  const underscoreTimeMatch = filename.match(/(\d+)_([0-5]\d)_([0-5]\d)_(\d{3})/);
  if (underscoreTimeMatch) {
    return convertUnderscoreTimeToSeconds(
      underscoreTimeMatch[1],
      underscoreTimeMatch[2],
      underscoreTimeMatch[3],
      underscoreTimeMatch[4]
    );
  }

  // Format HH:MM:SS.mmm
  const colonMatch = filename.match(/(\d{2}):(\d{2}):(\d{2})[.:](\d{3})/);
  if (colonMatch) {
    return convertUnderscoreTimeToSeconds(colonMatch[1], colonMatch[2], colonMatch[3], colonMatch[4]);
  }

  // Frame number (giả sử 30fps)
  const frameMatch = filename.match(/(\d+)/);
  if (frameMatch) {
    const frameNumber = parseInt(frameMatch[1], 10);
    return frameNumber / 30;
  }

  return null;
}

function convertUnderscoreTimeToSeconds(hoursStr, minutesStr, secondsStr, millisStr) {
  const hours = parseInt(hoursStr, 10) || 0;
  const minutes = parseInt(minutesStr, 10) || 0;
  const seconds = parseInt(secondsStr, 10) || 0;
  const millis = parseInt(millisStr, 10) || 0;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

// Perform OCR trên ảnh
async function performOCR(imagePath) {
  try {
    if (!ocrUtils) {
      console.error('OCR utils not initialized');
      return { success: false, error: 'OCR utils not initialized' };
    }

    if (!store) {
      console.error('Store not initialized');
      return { success: false, error: 'Store not initialized' };
    }

    // Convert local path to file:// URL
    // Windows path: C:\Users\... -> file:///C:/Users/...
    let imageUrl = imagePath.replace(/\\/g, '/');
    if (!imageUrl.startsWith('file://')) {
      if (imageUrl.startsWith('/')) {
        imageUrl = `file://${imageUrl}`;
      } else {
        imageUrl = `file:///${imageUrl}`;
      }
    }

    // console.log(`Performing smart OCR on: ${imageUrl}`);

    // Sử dụng OCR thông minh: ưu tiên Google AI Studio, fallback sang Microsoft Vision
    return await ocrUtils.performSmartOCR(imageUrl);
  } catch (error) {
    console.error('Error in performOCR:', error);
    return { success: false, error: error.message || 'OCR error' };
  }
}

// Generate SRT content
function generateSRT(entries) {
  let srtContent = '';
  let index = 1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nextEntry = entries[i + 1];

    const startSeconds = typeof entry.start === 'number'
      ? entry.start
      : (typeof entry.timestamp === 'number' ? entry.timestamp : 0);

    let endSeconds = typeof entry.end === 'number'
      ? entry.end
      : (typeof entry.timestampEnd === 'number' ? entry.timestampEnd : null);

    if (endSeconds === null) {
      const nextStart = nextEntry
        ? (typeof nextEntry.start === 'number'
            ? nextEntry.start
            : (typeof nextEntry.timestamp === 'number' ? nextEntry.timestamp : null))
        : null;

      if (nextStart !== null) {
        endSeconds = Math.max(nextStart - 0.05, startSeconds + 0.2);
      } else {
        endSeconds = startSeconds + 2;
      }
    }

    if (endSeconds <= startSeconds) {
      endSeconds = startSeconds + 1;
    }

    const startTime = formatSRTTime(startSeconds);
    const endTime = formatSRTTime(endSeconds);

    srtContent += `${index}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${entry.text}\n\n`;

    index++;
  }

  return srtContent;
}

// Format time cho SRT (HH:MM:SS,mmm)
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

// Restart task đã dừng
async function restartTask(taskId) {
  const task = processingQueue.find(t => t.id === taskId);
  if (!task) {
    return { success: false, error: 'Task không tìm thấy' };
  }

  if (task.status !== 'stopped') {
    return { success: false, error: 'Chỉ có thể chạy lại task đã dừng' };
  }

  // Reset status và thêm vào queue lại
  task.status = 'waiting';
  task.progress = 0;

  // Gửi thông báo
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video-subtitle-progress', {
      taskId: task.id,
      status: 'waiting',
      message: 'Đã thêm vào queue lại'
    });
  }

  // Xử lý queue
  processQueue();

  return { success: true, message: 'Đã thêm vào queue lại' };
}

async function rerunVideoSubFinderTask(taskId) {
  const task = processingQueue.find(t => t.id === taskId);
  if (!task) {
    return { success: false, error: 'Task không tìm thấy' };
  }

  if (task.status === 'processing' || task.status === 'waiting') {
    return { success: false, error: 'Task đang trong hàng chờ hoặc đang chạy' };
  }

  try {
    prepareOutputDirectory(task.outputDir);
  } catch (error) {
    return { success: false, error: error.message };
  }

  task.status = 'waiting';
  task.progress = 0;
  task.srtPath = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video-subtitle-progress', {
      taskId: task.id,
      status: 'waiting',
      message: 'Đã thêm vào queue (chạy lại)'
    });
  }

  processQueue();

  return { success: true, message: 'Đang chạy lại VideoSubFinder', outputDir: task.outputDir };
}

async function rerunTaskOCR(taskId) {
  const task = processingQueue.find(t => t.id === taskId);
  if (!task) {
    return { success: false, error: 'Task không tìm thấy' };
  }

  if (task.status === 'processing') {
    return { success: false, error: 'Không thể OCR khi task đang chạy VideoSubFinder' };
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-subtitle-progress', {
        taskId: task.id,
        status: 'processing',
        message: 'Đang OCR lại ảnh...',
        progress: 90
      });
    }

    await processImagesAndCreateSRT(task);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-subtitle-progress', {
        taskId: task.id,
        status: 'completed',
        message: 'Đã OCR lại thành công',
        progress: 100,
        outputDir: task.outputDir,
        srtPath: task.srtPath
      });
    }

    return { success: true, message: 'Đã OCR lại thành công', srtPath: task.srtPath };
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-subtitle-progress', {
        taskId: task.id,
        status: 'error',
        message: `OCR lỗi: ${error.message}`,
        progress: 0
      });
    }
    return { success: false, error: error.message };
  }
}

module.exports = {
  setMainWindow,
  setDependencies,
  processVideoSubtitle,
  getTask,
  removeTask,
  stopTask,
  restartTask,
  rerunVideoSubFinderTask,
  rerunTaskOCR,
  clearTempDir
};

