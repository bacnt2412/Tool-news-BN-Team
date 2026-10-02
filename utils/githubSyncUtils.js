/**
 * GitHub Sync Utilities
 * Tự động tải cookies và settings từ GitHub khi khởi động app
 */

const axios = require('axios');
const config = require('../config');
const cookieUtils = require('./cookieUtils');

// API endpoints từ config
const SETTINGS_API = config.SETTINGS_API;
const SETTINGS_TYPE = config.SETTINGS_TYPE;

/**
 * Chỉ lấy nội dung cookie đang được API đánh dấu ACTIVE.
 * Dữ liệu API có dạng: { value: 'Netscape cookie content', status: 'ACTIVE' }.
 */
function getActiveYoutubeCookies(youtubeCookies) {
  if (!Array.isArray(youtubeCookies)) {
    return null;
  }

  return youtubeCookies
    .filter(cookie => cookie && String(cookie.status || '').toUpperCase() === 'ACTIVE')
    .map(cookie => cookie.value)
    .filter(cookie => typeof cookie === 'string' && cookie.trim());
}

/**
 * Lưu cookies từ settings API vào local và store
 * @param {string|string[]} cookiesContent - Nội dung cookie hoặc danh sách cookie từ API
 * @param {object} store - Electron store instance
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function syncCookiesFromAPI(cookiesContent, store) {
  try {
    const cookies = cookieUtils.normalizeCookies(cookiesContent);

    // Validate từng cookie trong mảng theo Netscape cookie format.
    if (cookies.length === 0 || cookies.some(cookie => !cookie.includes('# Netscape HTTP Cookie File'))) {
      throw new Error('Invalid cookies format (not Netscape format)');
    }

    // Lưu mỗi cookie ra một file để yt-dlp có thể xoay vòng khi có nhiều tác vụ.
    const cookiesFilePath = await cookieUtils.saveCookiesToFile(cookies);

    // Lưu cookies vào electron-store để hiển thị trong UI
    if (store) {
      store.set('ytDlpCookies', Array.isArray(cookiesContent) ? cookies : cookies[0]);
    }


    return {
      success: true,
      message: 'Cookies đã được cập nhật từ API',
      filePath: cookiesFilePath
    };

  } catch (error) {
    console.error('❌ Failed to sync cookies from API:', error);
    return {
      success: false,
      message: `Lỗi đồng bộ cookies: ${error.message}`
    };
  }
}

/**
 * Tải settings từ API và cập nhật electron-store
 * @param {object} store - Electron store instance
 * @returns {Promise<{success: boolean, message: string, settings: object}>}
 */
async function syncSettingsFromAPI(store) {
  try {

    // Tải settings từ API
    const response = await axios.get(`${SETTINGS_API}?type=${SETTINGS_TYPE}`, {
      timeout: config.AUTO_SYNC_TIMEOUT || 30000,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch settings: HTTP ${response.status}`);
    }

    const data = response.data;
    // API trả về format: { settings: { ... } }
    if (!data.settings || typeof data.settings !== 'object') {
      throw new Error(`Báo cho Admin cài settings - API response invalid: ${JSON.stringify(data).substring(0, 100)}...`);
    }

    const settings = data.settings;

    // Parse và cập nhật Google Vision (Studio AI) settings
    if (settings.studioAiGoogleApiKey && Array.isArray(settings.studioAiGoogleApiKey)) {
      const apiKeys = settings.studioAiGoogleApiKey;
      store.set('googleVision', {
        apiKeys: apiKeys
      });

      // Auto-set OCR Provider to Google AI Studio OCR if studioAiGoogleApiKey exists
      store.set('ocrProvider', 'google');
    }

    // Parse và cập nhật Google Cloud TTS settings
    if (settings.googleCloudApiKey && Array.isArray(settings.googleCloudApiKey)) {
      const apiKey = settings.googleCloudApiKey[0]; // Lấy key đầu tiên
      if (apiKey) {
        store.set('googleTts', {
          apiKey: apiKey
        });
      }
    }


    const activeYoutubeCookies = getActiveYoutubeCookies(settings.youtubeCookies);

    return {
      success: true,
      message: 'Settings đã được cập nhật từ API',
      settings: settings,
      // API mới: chỉ dùng cookie có trạng thái ACTIVE.
      // API cũ: giữ tương thích khi chưa có youtubeCookies.
      cookiesContent: activeYoutubeCookies ?? (settings.cookies ?? settings.cookie)
    };

  } catch (error) {
    console.error('❌ Failed to sync settings from API:', error);
    return {
      success: false,
      message: `Lỗi đồng bộ settings: ${error.message}`
    };
  }
}

/**
 * Đồng bộ cả cookies và settings từ API
 * @param {object} store - Electron store instance
 * @returns {Promise<{success: boolean, message: string, details: object}>}
 */
async function syncAllFromAPI(store) {
  // Kiểm tra xem có bật auto-sync không
  if (!config.AUTO_SYNC_ENABLED) {
    return {
      success: false,
      message: 'Auto-sync đã bị tắt trong config',
      details: {
        cookies: { success: false, message: 'Disabled' },
        settings: { success: false, message: 'Disabled' }
      }
    };
  }


  // Đồng bộ settings (bao gồm cookies)
  const settingsResult = await syncSettingsFromAPI(store);

  let cookiesResult = { success: false, message: 'Settings sync failed' };

  // Nếu API có youtubeCookies nhưng không có phần tử ACTIVE, xóa cookie cũ
  // để app không vô tình tiếp tục dùng cookie INACTIVE.
  if (settingsResult.success && Array.isArray(settingsResult.cookiesContent) && settingsResult.cookiesContent.length === 0) {
    cookieUtils.deleteCookiesFile();
    if (store) {
      store.set('ytDlpCookies', []);
    }
    cookiesResult = {
      success: false,
      message: 'Đã hết YouTube cookie ACTIVE. Vui lòng liên hệ Admin để bật hoặc cập nhật cookie.'
    };
  // Nếu settings sync thành công và có cookies, đồng bộ cookies
  } else if (settingsResult.success && settingsResult.cookiesContent) {
    cookiesResult = await syncCookiesFromAPI(settingsResult.cookiesContent, store);
  } else if (settingsResult.success) {
    cookiesResult = { success: false, message: 'No cookies found in settings' };
  }

  const allSuccess = cookiesResult.success && settingsResult.success;


  return {
    success: allSuccess,
    message: allSuccess
      ? 'Đã đồng bộ cookies và settings từ API'
      : 'Đồng bộ hoàn tất nhưng có lỗi',
    details: {
      cookies: cookiesResult,
      settings: settingsResult
    }
  };
}

module.exports = {
  getActiveYoutubeCookies,
  syncCookiesFromAPI,
  syncSettingsFromAPI,
  syncAllFromAPI
};

