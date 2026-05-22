const path = require('path');
const fs = require('fs');
const { execFile, execFileSync, spawn } = require('child_process');
const { app } = require('electron');
const axios = require('axios');
const pathUtils = require('./pathUtils');

let mainWindow;

// Set mainWindow reference (called from main.js)
function setMainWindow(window) {
  mainWindow = window;
}

// Tìm yt-dlp binary
function findYtDlpPath() {
  const ytDlpNames = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];

  // Khi build, app.asar là read-only, nên cần tìm yt-dlp ở các vị trí khác
  // Thử tìm trong bin (resources/bin khi build, project/bin khi dev)
  const possibleBinPaths = [
    pathUtils.getBinPath(), // bin path (resources/bin hoặc project/bin)
  ].filter(p => p !== null);

  for (const binPath of possibleBinPaths) {
    for (const name of ytDlpNames) {
      const ytDlpPath = path.join(binPath, name);
      if (fs.existsSync(ytDlpPath)) {
        return ytDlpPath;
      }
    }
  }

  // Nếu không tìm thấy trong bin, thử các vị trí khác
  for (const name of ytDlpNames) {
    try {
      const possiblePaths = [
        path.join(__dirname, '..', name),
        path.join(__dirname, '..', 'node_modules', '.bin', name),
        name // Tìm trong PATH
      ];

      for (const ytDlpPath of possiblePaths) {
        if (fs.existsSync(ytDlpPath)) {
          return ytDlpPath;
        }
      }
    } catch (error) {
      continue;
    }
  }

  // Nếu không tìm thấy, trả về tên để thử trong PATH
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function findExecutablePath(names) {
  const binPath = pathUtils.getBinPath();
  const searchDirs = [
    binPath,
    __dirname,
    path.join(__dirname, '..')
  ].filter(Boolean);

  for (const dir of searchDirs) {
    for (const name of names) {
      const executablePath = path.join(dir, name);
      if (fs.existsSync(executablePath)) {
        return executablePath;
      }
    }
  }

  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const name of names) {
    try {
      const stdout = execFileSync(finder, [name], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 3000
      });
      const foundPath = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      if (foundPath) {
        return foundPath;
      }
    } catch (error) {
      // Continue searching other runtime names.
    }
  }

  return null;
}

function getExecutableVersion(executablePath) {
  try {
    const stdout = execFileSync(executablePath, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 3000
    }).trim();
    return stdout;
  } catch (error) {
    return null;
  }
}

function parseMajorVersion(versionText) {
  const match = String(versionText || '').match(/(\d+)(?:\.\d+){0,2}/);
  return match ? Number(match[1]) : null;
}

function findSupportedJsRuntime() {
  const denoPath = findExecutablePath(process.platform === 'win32' ? ['deno.exe', 'deno'] : ['deno']);
  if (denoPath) {
    const version = getExecutableVersion(denoPath);
    const major = parseMajorVersion(version);
    if (major === null || major >= 2) {
      return { name: 'deno', path: denoPath };
    }
  }

  const nodePath = findExecutablePath(process.platform === 'win32' ? ['node.exe', 'node'] : ['node']);
  if (nodePath) {
    const version = getExecutableVersion(nodePath);
    const major = parseMajorVersion(version);
    if (major !== null && major >= 20) {
      return { name: 'node', path: nodePath };
    }
  }

  return null;
}

function addEjsRuntimeArgs(args) {
  const runtime = findSupportedJsRuntime();
  if (runtime && !args.includes('--js-runtimes')) {
    args.push('--js-runtimes', `${runtime.name}:${runtime.path}`);
  }

  if (!args.includes('--remote-components')) {
    args.push('--remote-components', 'ejs:github');
  }

  return args;
}

// Hàm lấy version hiện tại của yt-dlp
function getCurrentYtDlpVersion() {
  return new Promise(async (resolve, reject) => {
    // Đọc version từ file nếu có (lưu trong bin/yt-dlp-version.txt)
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

    // Lấy version thực tế từ yt-dlp
    const ytDlpPath = findYtDlpPath();
    const args = ['--version'];

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Xử lý lỗi EBUSY (file đang được sử dụng)
        if (error.code === 'EBUSY' || error.message.includes('EBUSY')) {
          // Nếu có version trong file, dùng version file
          if (fileVersion) {
            console.warn('yt-dlp đang được sử dụng, sử dụng version từ file:', fileVersion);
            resolve(fileVersion);
            return;
          }
          reject(new Error(`yt-dlp đang được sử dụng, không thể lấy version. Vui lòng thử lại sau.`));
          return;
        }
        
        // Nếu không thể lấy version từ yt-dlp nhưng có version trong file, dùng version file
        if (fileVersion) {
          console.warn('Không thể lấy version từ yt-dlp, sử dụng version từ file:', fileVersion);
          resolve(fileVersion);
          return;
        }
        reject(new Error(`Không thể lấy version: ${stderr || error.message}`));
        return;
      }

      const actualVersion = stdout.trim();

      // Cập nhật file version nếu khác với version thực tế
      if (fileVersion !== actualVersion) {
        try {
          // Đảm bảo thư mục bin tồn tại
          const binDir = pathUtils.getBinPath();
          if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
          }
          fs.writeFileSync(versionFilePath, actualVersion, 'utf-8');
        } catch (writeError) {
          console.warn('Không thể ghi version file:', writeError.message);
        }
      }

      resolve(actualVersion);
    });
  });
}

// Hàm lấy version mới nhất từ GitHub
async function getLatestYtDlpVersion() {
  try {
    const response = await axios.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      timeout: 10000,
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const tagName = response.data.tag_name;
    // Loại bỏ 'v' prefix nếu có (ví dụ: v2024.01.01 -> 2024.01.01)
    const version = tagName.replace(/^v/, '');
    return version;
  } catch (error) {
    throw new Error(`Không thể lấy version mới nhất: ${error.message}`);
  }
}

// Hàm so sánh version
function compareVersions(current, latest) {
  // Loại bỏ các ký tự không phải số và dấu chấm
  const normalizeVersion = (v) => v.replace(/[^0-9.]/g, '');

  const currentNormalized = normalizeVersion(current);
  const latestNormalized = normalizeVersion(latest);

  // Chuyển version string thành array để so sánh
  const currentParts = currentNormalized.split('.').map(Number);
  const latestParts = latestNormalized.split('.').map(Number);

  const maxLength = Math.max(currentParts.length, latestParts.length);

  for (let i = 0; i < maxLength; i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (latestPart > currentPart) {
      return -1; // Có version mới hơn
    } else if (latestPart < currentPart) {
      return 1; // Version hiện tại mới hơn
    }
  }

  return 0; // Cùng version
}

// Hàm tải yt-dlp từ GitHub
async function downloadYtDlpFromGitHub() {
  return new Promise(async (resolve, reject) => {
    try {
      // Xác định thư mục lưu yt-dlp (resources/bin không bị pack vào asar)
      const binDir = pathUtils.getBinPath();
      if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
      }

      const ytDlpPath = pathUtils.getYtDlpPath();
      const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

      // Gửi thông báo đang tải
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yt-dlp-update-progress', {
          type: 'downloading',
          message: 'Đang tải yt-dlp từ GitHub...'
        });
      }

      // Tải file từ GitHub
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 60000, // 60 seconds timeout
        headers: {
          'Accept': 'application/octet-stream'
        }
      });

      // Lưu file
      const writer = fs.createWriteStream(ytDlpPath);
      let downloadedBytes = 0;
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          mainWindow.webContents.send('yt-dlp-update-progress', {
            type: 'progress',
            progress: progress,
            downloaded: downloadedBytes,
            total: totalBytes
          });
        }
        writer.write(chunk);
      });

      response.data.on('end', async () => {
        writer.end();
        
        // Đợi writer đóng hoàn toàn
        await new Promise((resolve) => {
          writer.on('close', () => {
            resolve();
          });
        });
        
        // Đảm bảo file có quyền thực thi (trên Windows không cần, nhưng trên Unix cần)
        if (process.platform !== 'win32') {
          fs.chmodSync(ytDlpPath, 0o755);
        }

        // Đợi một chút để đảm bảo file được unlock (Windows có thể lock file sau khi ghi)
        await new Promise(resolve => setTimeout(resolve, 500));

        // Lấy version mới và cập nhật file version
        try {
          // Retry logic để đợi file unlock
          let retries = 5;
          let newVersion = null;
          while (retries > 0) {
            try {
              newVersion = await getCurrentYtDlpVersion();
              break;
            } catch (versionError) {
              retries--;
              if (retries > 0) {
                // Đợi thêm một chút trước khi retry
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                throw versionError;
              }
            }
          }
          
          if (newVersion) {
            const versionFilePath = path.join(binDir, 'yt-dlp-version.txt');
            fs.writeFileSync(versionFilePath, newVersion, 'utf-8');
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('yt-dlp-update-progress', {
                type: 'completed',
                message: `Đã tải yt-dlp thành công (version: ${newVersion})`,
                version: newVersion
              });
            }
            
            resolve({ success: true, version: newVersion, path: ytDlpPath });
          } else {
            // Nếu không lấy được version sau nhiều lần retry, vẫn coi là thành công
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('yt-dlp-update-progress', {
                type: 'completed',
                message: 'Đã tải yt-dlp thành công (không thể lấy version)',
                version: null
              });
            }
            resolve({ success: true, path: ytDlpPath });
          }
        } catch (versionError) {
          // Nếu không lấy được version, vẫn coi là thành công
          console.warn('Không thể lấy version sau khi tải yt-dlp:', versionError.message);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('yt-dlp-update-progress', {
              type: 'completed',
              message: 'Đã tải yt-dlp thành công (không thể lấy version)',
              version: null
            });
          }
          resolve({ success: true, path: ytDlpPath });
        }
      });

      response.data.on('error', (error) => {
        writer.close();
        fs.unlinkSync(ytDlpPath).catch(() => {}); // Xóa file nếu tải lỗi
        reject(new Error(`Lỗi khi tải file: ${error.message}`));
      });

      writer.on('error', (error) => {
        writer.close();
        fs.unlinkSync(ytDlpPath).catch(() => {}); // Xóa file nếu ghi lỗi
        reject(new Error(`Lỗi khi ghi file: ${error.message}`));
      });
    } catch (error) {
      reject(new Error(`Lỗi khi tải yt-dlp: ${error.message}`));
    }
  });
}

// Hàm update yt-dlp
function updateYtDlp(addCookiesToArgs) {
  return new Promise(async (resolve, reject) => {
    try {
      // Tải yt-dlp trực tiếp từ GitHub
      const result = await downloadYtDlpFromGitHub();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

// Hàm check và update yt-dlp
async function checkYtDlpUpdate(silent = false, addCookiesToArgs) {
  try {
    // Chỉ gửi notification "checking" nếu không phải silent mode
    if (!silent && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yt-dlp-update-status', {
        status: 'checking',
        message: 'Đang kiểm tra version yt-dlp...'
      });
    }

    // Lấy version mới nhất từ GitHub
    const latestVersion = await getLatestYtDlpVersion();
    // Kiểm tra xem yt-dlp có tồn tại không
    const ytDlpPath = findYtDlpPath();
    const defaultName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    // Nếu findYtDlpPath trả về tên file mặc định (không có path), có nghĩa là không tìm thấy
    const ytDlpExists = ytDlpPath !== defaultName && fs.existsSync(ytDlpPath);
    
    let currentVersion = null;
    let comparison = -1; // Mặc định là cần update
    
    if (ytDlpExists) {
      try {
        currentVersion = await getCurrentYtDlpVersion();
        comparison = compareVersions(currentVersion, latestVersion);
      } catch (versionError) {
        // Nếu không lấy được version hiện tại, coi như cần tải mới
        console.warn('Không thể lấy version hiện tại, sẽ tải yt-dlp mới:', versionError.message);
        comparison = -1;
      }
    } else {
      // yt-dlp không tồn tại, cần tải
      if (!silent && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yt-dlp-update-status', {
          status: 'not-found',
          message: 'yt-dlp không tìm thấy, đang tải...',
          latestVersion
        });
      }
      return { upToDate: false, currentVersion: null, latestVersion, needsDownload: true };
    }

    if (comparison === 0) {
      // Đã là version mới nhất
      if (!silent && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yt-dlp-update-status', {
          status: 'up-to-date',
          message: `yt-dlp đã là version mới nhất (${currentVersion})`,
          currentVersion,
          latestVersion
        });
      }
      return { upToDate: true, currentVersion, latestVersion };
    } else if (comparison < 0) {
      // Có version mới hơn
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('yt-dlp-update-status', {
          status: 'update-available',
          message: `Có version mới: ${latestVersion} (hiện tại: ${currentVersion})`,
          currentVersion,
          latestVersion
        });
      }
      return { upToDate: false, currentVersion, latestVersion };
    }
  } catch (error) {
    console.error('Error checking yt-dlp update:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('yt-dlp-update-status', {
        status: 'error',
        message: `Lỗi khi kiểm tra: ${error.message}`
      });
    }
    return { error: error.message };
  }
}

module.exports = {
  setMainWindow,
  findYtDlpPath,
  getCurrentYtDlpVersion,
  getLatestYtDlpVersion,
  compareVersions,
  addEjsRuntimeArgs,
  updateYtDlp,
  checkYtDlpUpdate
};

