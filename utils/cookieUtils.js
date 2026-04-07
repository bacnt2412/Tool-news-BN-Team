const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const pathUtils = require('./pathUtils');

// Hàm lưu cookie vào file
async function saveCookiesToFile(cookiesContent) {
  return new Promise((resolve, reject) => {
    // Sử dụng bin/cookies để lưu file (resources/bin không bị pack vào asar)
    const cookiesDir = pathUtils.getCookiesDir();
    const cookiesFilePath = pathUtils.getCookiesFilePath();

    // Kiểm tra format cookie
    const trimmedCookies = cookiesContent.trim();

    // Nếu là JSON format, giữ nguyên
    // Nếu là Netscape format, giữ nguyên
    // Lưu vào file - dùng writeFileSync để đảm bảo ghi ngay lập tức
    try {
      fs.writeFileSync(cookiesFilePath, trimmedCookies, 'utf-8');
      resolve(cookiesFilePath);
    } catch (error) {
      console.error('Error saving cookies file:', error);
      reject(error);
    }
  });
}

// Hàm xóa cookie file
function deleteCookiesFile() {
  const cookiesFilePath = pathUtils.getCookiesFilePath();
  if (fs.existsSync(cookiesFilePath)) {
    try {
      fs.unlinkSync(cookiesFilePath);
    } catch (error) {
      console.error('Error deleting cookies file:', error);
    }
  }
}

// Hàm lấy cookie file path nếu có
function getCookiesFilePath() {
  const cookiesFilePath = pathUtils.getCookiesFilePath();
  if (fs.existsSync(cookiesFilePath)) {
    return cookiesFilePath;
  }
  return null;
}

// Hàm thêm cookie option vào yt-dlp args nếu có
function addCookiesToArgs(args) {
  const cookiesFilePath = getCookiesFilePath();
  
  if (cookiesFilePath) {
    args.push('--cookies', cookiesFilePath);
  }
  return args;
}

module.exports = {
  saveCookiesToFile,
  deleteCookiesFile,
  getCookiesFilePath,
  addCookiesToArgs
};

