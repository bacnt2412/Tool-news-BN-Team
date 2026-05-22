const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

let store;
let ocrThreadCounter = 0;
const disabledGoogleKeys = new Map();

function setStore(storeInstance) {
  store = storeInstance;
}

async function downloadOrReadImage(source) {
  if (!source) {
    throw new Error('Image source is empty');
  }

  if (/^[a-zA-Z]:\\/.test(source) || source.startsWith('/') || source.startsWith('.')) {
    const cleaned = source.replace(/^file:\/\//i, '');
    const resolvedPath = path.resolve(cleaned);
    const buffer = fs.readFileSync(resolvedPath);
    return {
      buffer,
      mimeType: detectMimeType(resolvedPath)
    };
  }

  if (source.startsWith('file://')) {
    const filePath = source.replace(/^file:\/+/, '');
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    const buffer = fs.readFileSync(resolvedPath);
    return {
      buffer,
      mimeType: detectMimeType(resolvedPath)
    };
  }

  const protocol = source.startsWith('https') ? https : http;
  return await new Promise((resolve, reject) => {
    protocol.get(source, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          mimeType: detectMimeType(source)
        });
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

function detectMimeType(source) {
  const lower = source.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.tiff') || lower.endsWith('.tif')) return 'image/tiff';
  return 'image/jpeg';
}

function normalizeGoogleApiKeys(keys) {
  if (!Array.isArray(keys)) {
    keys = keys ? [keys] : [];
  }

  return keys
    .map((key) => {
      if (typeof key === 'string') return key.trim();
      if (key && typeof key === 'object') {
        return String(key.value || key.apiKey || key.key || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function getGoogleApiKeys() {
  const settings = store.get('googleVision', {});
  if (Array.isArray(settings.apiKeys) && settings.apiKeys.length > 0) {
    return normalizeGoogleApiKeys(settings.apiKeys);
  }
  return normalizeGoogleApiKeys(settings.apiKey);
}

function maskApiKey(apiKey) {
  if (!apiKey) return 'unknown';
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

function getGoogleErrorDetail(error) {
  if (!error || !error.response) {
    return {
      status: null,
      detail: error && error.message ? error.message : 'Unknown error'
    };
  }

  const status = error.response.status;
  const errorData = error.response.data;
  const detail = errorData?.error?.message || JSON.stringify(errorData);

  return { status, detail };
}

function shouldDisableGoogleKey(status, detail) {
  const message = String(detail || '').toLowerCase();

  return (
    status === 400 ||
    status === 401 ||
    status === 429 ||
    status === 403 ||
    message.includes('api key not valid') ||
    message.includes('denied access') ||
    message.includes('permission_denied') ||
    message.includes('quota') ||
    message.includes('exceeded')
  );
}

function disableGoogleKey(apiKey, status, detail) {
  if (!apiKey || disabledGoogleKeys.has(apiKey)) return;

  const reason = status
    ? `Google AI Studio API Error (${status}): ${detail}`
    : `Google AI Studio API Error: ${detail}`;

  disabledGoogleKeys.set(apiKey, {
    reason,
    disabledAt: Date.now()
  });

  console.warn(`Disabled Google AI Studio key ${maskApiKey(apiKey)} for this session: ${reason}`);
}

function getActiveGoogleApiKeys(apiKeys) {
  return apiKeys.filter((apiKey) => !disabledGoogleKeys.has(apiKey));
}

function summarizeGoogleKeyErrors(errors) {
  if (!errors || errors.length === 0) {
    return 'Tat ca API Keys deu khong hoat dong';
  }

  const uniqueErrors = [];
  const seen = new Set();

  for (const item of errors) {
    const text = item.status
      ? `Key ${item.keyNumber} (${item.keyMask}) loi ${item.status}: ${item.detail}`
      : `Key ${item.keyNumber} (${item.keyMask}) loi: ${item.detail}`;

    if (!seen.has(text)) {
      seen.add(text);
      uniqueErrors.push(text);
    }
  }

  return `Tat ca Google AI Studio API Keys deu loi. ${uniqueErrors.slice(0, 5).join(' | ')}`;
}

async function extractTextWithGoogleVision(imageSource, apiKeysOverride = null) {
  const apiKeys = apiKeysOverride ? normalizeGoogleApiKeys(apiKeysOverride) : getGoogleApiKeys();

  if (!apiKeys || apiKeys.length === 0) {
    return {
      success: false,
      error: 'Vui long cau hinh Google AI Studio API Key trong Settings'
    };
  }

  try {
    const { buffer, mimeType } = await downloadOrReadImage(imageSource);
    const imageBase64 = buffer.toString('base64');

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: 'Hay doc va trich xuat tat ca van ban co trong hinh anh nay. Chi tra ve van ban, khong can giai thich gi them.'
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ]
    };

    const errors = [];
    const activeApiKeys = getActiveGoogleApiKeys(apiKeys);

    if (activeApiKeys.length === 0) {
      const disabledReasons = apiKeys
        .map((apiKey, index) => {
          const disabledInfo = disabledGoogleKeys.get(apiKey);
          return disabledInfo
            ? `Key ${index + 1} (${maskApiKey(apiKey)}): ${disabledInfo.reason}`
            : null;
        })
        .filter(Boolean);

      return {
        success: false,
        error: disabledReasons.length > 0
          ? `Tat ca Google AI Studio API Keys dang bi vo hieu hoa trong phien nay. ${disabledReasons.join(' | ')}`
          : 'Tat ca API Keys deu khong hoat dong'
      };
    }

    for (const apiKey of activeApiKeys) {
      try {
        const apiVersion = 'v1beta';
        const model = 'gemini-3.1-flash-lite-preview';
        const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;

        const response = await axios.post(apiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response && response.status === 200) {
          let extractedText = '';
          if (response.data && response.data.candidates && response.data.candidates.length > 0) {
            const candidate = response.data.candidates[0];
            if (candidate.content && candidate.content.parts) {
              candidate.content.parts.forEach((part) => {
                if (part.text) {
                  extractedText += part.text;
                }
              });
            }
          }

          return { success: true, text: extractedText.trim() };
        }
      } catch (keyError) {
        const { status, detail } = getGoogleErrorDetail(keyError);
        const keyNumber = apiKeys.indexOf(apiKey) + 1;

        errors.push({
          keyNumber,
          keyMask: maskApiKey(apiKey),
          status,
          detail
        });

        if (shouldDisableGoogleKey(status, detail)) {
          disableGoogleKey(apiKey, status, detail);
        }

        continue;
      }
    }

    return {
      success: false,
      error: summarizeGoogleKeyErrors(errors)
    };
  } catch (error) {
    return {
      success: false,
      error: `Error: ${error.message}`
    };
  }
}

async function performSmartOCR(imageSource, keyIndex = null) {
  try {
    const googleApiKeys = getGoogleApiKeys();
    if (googleApiKeys.length === 0) {
      return {
        success: false,
        error: 'Vui long cau hinh Google AI Studio API Key trong Settings'
      };
    }

    const selectedIndex = Number.isInteger(keyIndex)
      ? keyIndex % googleApiKeys.length
      : ocrThreadCounter++ % googleApiKeys.length;

    const orderedKeys = googleApiKeys
      .slice(selectedIndex)
      .concat(googleApiKeys.slice(0, selectedIndex));

    // Nếu tất cả keys đã bị disabled (do lỗi trước), clear để cho phép retry
    if (getActiveGoogleApiKeys(orderedKeys).length === 0) {
      disabledGoogleKeys.clear();
    }

    return await extractTextWithGoogleVision(imageSource, orderedKeys);
  } catch (error) {
    console.error('Smart OCR Error:', error);
    return {
      success: false,
      error: `OCR Error: ${error.message}`
    };
  }
}

module.exports = {
  setStore,
  extractTextWithGoogleVision,
  performSmartOCR,
  getGoogleApiKeys
};
