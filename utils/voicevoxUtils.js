const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

let voicevoxProcess = null;
let isStarting = false;

// Tìm VoiceVox Engine executable
function findVoiceVoxPath() {
  // Các đường dẫn thường gặp của VoiceVox trên Windows
  const possiblePaths = [
    // VoiceVox GUI (có engine kèm theo)
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'VOICEVOX',  'vv-engine', 'run.exe'),
    
    // VoiceVox Engine standalone
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'VOICEVOX', 'vv-engine', 'run.exe'),
    
    // Trong thư mục resources (khi build)
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'voicevox_engine', 'run.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'VOICEVOX', 'VOICEVOX.exe') : null,
    
    // Trong thư mục bin của project (khi dev)
    path.join(__dirname, '..', 'bin', 'voicevox_engine', 'run.exe'),
    path.join(__dirname, '..', 'bin', 'VOICEVOX', 'VOICEVOX.exe'),
  ].filter(Boolean); // Remove null values

  for (const voicevoxPath of possiblePaths) {
    if (fs.existsSync(voicevoxPath)) {
      return voicevoxPath;
    }
  }

  return null;
}

// Kiểm tra xem VoiceVox server có đang chạy không
async function checkVoiceVoxServer(voicevoxUrl = 'http://127.0.0.1:50021') {
  try {
    const response = await axios.get(`${voicevoxUrl}/version`, {
      timeout: 3000
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Khởi động VoiceVox server
async function startVoiceVoxServer(voicevoxUrl = 'http://127.0.0.1:50021') {
  // Nếu đã đang khởi động, đợi
  if (isStarting) {
    console.log('VoiceVox is already starting, waiting...');
    // Đợi tối đa 30 giây
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!isStarting) {
        const isRunning = await checkVoiceVoxServer(voicevoxUrl);
        if (isRunning) {
          return { success: true, message: 'VoiceVox server đã sẵn sàng' };
        }
      }
    }
    return { success: false, error: 'Timeout khi đợi VoiceVox server khởi động' };
  }

  // Kiểm tra xem server có đang chạy không
  const isRunning = await checkVoiceVoxServer(voicevoxUrl);
  if (isRunning) {
    return { success: true, message: 'VoiceVox server đã đang chạy' };
  }

  // Tìm VoiceVox executable
  const voicevoxPath = findVoiceVoxPath();
  if (!voicevoxPath) {
    return {
      success: false,
      error: 'Không tìm thấy VoiceVox. Vui lòng cài đặt VoiceVox hoặc VoiceVox Engine từ https://voicevox.hiroshiba.jp/'
    };
  }

  try {
    isStarting = true;
    console.log('Starting VoiceVox server from:', voicevoxPath);

    // Khởi động VoiceVox
    // Nếu là VOICEVOX.exe (GUI), nó sẽ tự động start engine
    // Nếu là run.exe (engine only), nó sẽ chạy engine trực tiếp
    // Thêm tham số --use_gpu để sử dụng GPU (tăng tốc độ xử lý)
    const args = ['--use_gpu'];
    voicevoxProcess = spawn(voicevoxPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true // Ẩn cửa sổ console của VoiceVox
    });

    // Unref để process không block app
    voicevoxProcess.unref();

    // Đợi server khởi động (tối đa 30 giây)
    console.log('Waiting for VoiceVox server to start...');
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const isReady = await checkVoiceVoxServer(voicevoxUrl);
      if (isReady) {
        console.log('VoiceVox server is ready!');
        isStarting = false;
        return { success: true, message: 'VoiceVox server đã khởi động thành công' };
      }
    }

    isStarting = false;
    return {
      success: false,
      error: 'VoiceVox đã khởi động nhưng server không phản hồi. Vui lòng thử lại hoặc khởi động VoiceVox thủ công.'
    };
  } catch (error) {
    isStarting = false;
    console.error('Error starting VoiceVox:', error);
    return {
      success: false,
      error: `Lỗi khi khởi động VoiceVox: ${error.message}`
    };
  }
}

// Dừng VoiceVox server (chỉ dừng nếu được app này khởi động)
function stopVoiceVoxServer() {
  if (voicevoxProcess && !voicevoxProcess.killed) {
    try {
      voicevoxProcess.kill();
      voicevoxProcess = null;
      return { success: true, message: 'Đã dừng VoiceVox server' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: true, message: 'VoiceVox server không được khởi động bởi app này' };
}

module.exports = {
  findVoiceVoxPath,
  checkVoiceVoxServer,
  startVoiceVoxServer,
  stopVoiceVoxServer
};

