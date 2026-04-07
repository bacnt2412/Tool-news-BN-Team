const { networkInterfaces } = require('os');
const axios = require('axios');
const config = require('../config');

// Import API endpoints từ config
const LICENSE_CHECK_API = config.LICENSE_CHECK_API;


// Import LICENSE_FILE_URL từ config
const URL_GITHUB_RELEASES = config.URL_GITHUB_RELEASES;

/**
 * Parse GitHub owner và repo từ LICENSE_FILE_URL
 * @returns {{owner: string, repo: string} | null}
 */
function parseGitHubInfo() {
  try {
    // Match pattern: https://github.com/{owner}/{repo}/...
    const match = URL_GITHUB_RELEASES.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2]
      };
    }
    return null;
  } catch (error) {
    console.error('Error parsing GitHub info from URL_GITHUB_RELEASES:', error);
    return null;
  }
}



/**
 * Lấy MAC address của máy hiện tại
 * @returns {string} MAC address (dạng XX:XX:XX:XX:XX:XX)
 */
function getMacAddress() {
  const nets = networkInterfaces();
  let macAddress = null;

  // Tìm MAC address của interface mạng đầu tiên có IPv4 và không phải loopback
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Bỏ qua loopback và internal interfaces
      if (net.family === 'IPv4' && !net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        macAddress = net.mac.toUpperCase();
        break;
      }
    }
    if (macAddress) break;
  }

  // Fallback: lấy bất kỳ MAC address nào không phải 00:00:00:00:00:00
  if (!macAddress) {
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.mac && net.mac !== '00:00:00:00:00:00') {
          macAddress = net.mac.toUpperCase();
          break;
        }
      }
      if (macAddress) break;
    }
  }

  return macAddress || 'UNKNOWN';
}

/**
 * Kiểm tra license từ API
 * @returns {Promise<{success: boolean, message: string, macAddress: string}>}
 */
async function checkLicense() {
  const macAddress = getMacAddress();

  try {
    console.log('Checking license for MAC:', macAddress);

    // Gọi API check license với MAC address làm licenseKey
    const response = await axios.post(LICENSE_CHECK_API, {
      licenseKey: macAddress
    }, {
      timeout: config.LICENSE_CHECK_TIMEOUT || 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status !== 200) {
      return {
        success: false,
        message: 'Không thể kết nối đến server license',
        macAddress
      };
    }

    // Kiểm tra response từ API
    const result = response.data;
    // Giả sử API trả về { success: boolean, message: string }
    if (result.isValid) {
      return {
        success: true,
        message: result.message || 'License hợp lệ',
        macAddress
      };
    } else {
      return {
        success: false,
        message: result.message || 'License không hợp lệ',
        macAddress
      };
    }

  } catch (error) {
    console.error('License check error:', error.message);

    // Nếu không kết nối được (offline, server down, etc.)
    return {
      success: false,
      message: `Lỗi kiểm tra license: ${error.message}`,
      macAddress
    };
  }
}

/**
 * Cập nhật URL file license
 * @param {string} url - URL mới
 */
function setLicenseUrl(url) {
  // This would need to be implemented to store in config
  console.log('License URL updated:', url);
}

module.exports = {
  getMacAddress,
  checkLicense,
  setLicenseUrl,
  parseGitHubInfo
};

