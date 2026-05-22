/**
 * GitHub Sync Utilities
 * Tự động tải cookies và settings từ GitHub khi khởi động app
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const config = require('../config');
const pathUtils = require('./pathUtils');

// API endpoints từ config
const SETTINGS_API = config.SETTINGS_API;
const SETTINGS_TYPE = config.SETTINGS_TYPE;

/**
 * Lưu cookies từ settings API vào local và store
 * @param {string} cookiesContent - Nội dung cookies từ API
 * @param {object} store - Electron store instance
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function syncCookiesFromAPI(cookiesContent, store) {
  try {

    // Validate cookies format (Netscape cookie format)
    if (!cookiesContent.includes('# Netscape HTTP Cookie File')) {
      throw new Error('Invalid cookies format (not Netscape format)');
    }

    // Tạo thư mục cookies nếu chưa có (trong bin/cookies)
    const cookiesDir = pathUtils.getCookiesDir();

    // Lưu cookies vào file
    const cookiesFilePath = pathUtils.getCookiesFilePath();
    fs.writeFileSync(cookiesFilePath, cookiesContent, 'utf8');

    // Lưu cookies vào electron-store để hiển thị trong UI
    if (store) {
      store.set('ytDlpCookies', cookiesContent);
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


    return {
      success: true,
      message: 'Settings đã được cập nhật từ API',
      settings: settings,
      cookiesContent: settings.cookie // Trả về cookies để đồng bộ riêng
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

  // Nếu settings sync thành công và có cookies, đồng bộ cookies
  if (settingsResult.success && settingsResult.cookiesContent) {
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
  syncCookiesFromAPI,
  syncSettingsFromAPI,
  syncAllFromAPI
};

