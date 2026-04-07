const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const createClient = require('@azure-rest/ai-vision-image-analysis').default;
const { AzureKeyCredential } = require('@azure/core-auth');

let store;

// Global counter để rotate keys giữa các luồng OCR
let ocrThreadCounter = 0;

// Set store reference (called from main.js)
function setStore(storeInstance) {
  store = storeInstance;
}

// Utility: nhận vào URL hoặc đường dẫn file cục bộ, trả về buffer và mime type
async function downloadOrReadImage(source) {
  if (!source) {
    throw new Error('Image source is empty');
  }

  // Nếu là đường dẫn local
  if (/^[a-zA-Z]:\\/.test(source) || source.startsWith('/') || source.startsWith('.')) {
    const cleaned = source.replace(/^file:\/\//i, '');
    const resolvedPath = path.resolve(cleaned);
    const buffer = fs.readFileSync(resolvedPath);
    return {
      buffer,
      mimeType: detectMimeType(resolvedPath)
    };
  }

  // Nếu là file:// URI
  if (source.startsWith('file://')) {
    const filePath = source.replace(/^file:\/+/, '');
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    const buffer = fs.readFileSync(resolvedPath);
    return {
      buffer,
      mimeType: detectMimeType(resolvedPath)
    };
  }

  // Ngược lại coi như URL
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

function isRemoteUrl(source = '') {
  return /^https?:\/\//i.test(source);
}

// Hàm xử lý OCR bằng Microsoft Vision API
async function extractTextWithMicrosoftVision(imageSource, threadIndex = 0) {
  const settings = store.get('microsoftVision', {});
  let apiKey = settings.apiKey;
  let endpoint = settings.endpoint;

  // Nếu có nhiều keys, rotate chúng dựa trên thread index
  if (settings.apiKeys && Array.isArray(settings.apiKeys) && settings.apiKeys.length > 0) {
    const keyIndex = threadIndex % settings.apiKeys.length;
    const selectedKey = settings.apiKeys[keyIndex];
    apiKey = selectedKey.value;
    endpoint = selectedKey.endpoint || selectedKey['end-point'];
    console.log(`🔄 Microsoft Vision Thread ${threadIndex}: Using key ${keyIndex + 1}/${settings.apiKeys.length}`);
  }

  if (!apiKey || !endpoint) {
    return {
      success: false,
      error: 'Vui lòng cấu hình Microsoft Vision API Key và Endpoint trong Settings'
    };
  }

  // Đảm bảo endpoint không có trailing slash
  const cleanEndpoint = endpoint.replace(/\/$/, '');

  // Tạo client sử dụng thư viện Azure chính thức
  const credential = new AzureKeyCredential(apiKey);
  const client = createClient(cleanEndpoint, credential);

  let requestBody = null;
  let contentType = 'application/json';

  if (isRemoteUrl(imageSource)) {
    requestBody = { url: imageSource };
  } else {
    const { buffer, mimeType } = await downloadOrReadImage(imageSource);
    requestBody = buffer;
    contentType = mimeType;
  }

  const response = await client.path('/imageanalysis:analyze').post({
    body: requestBody,
    queryParameters: {
      features: 'Read', // Chỉ dùng OCR
      modelVersion: 'latest'
    },
    headers: { "Content-Type": contentType }
  });

  // Kiểm tra status code
  if (response.status !== '200' && response.status !== 200) {
    const errorMsg = response.body?.error || 'Unknown error';
    console.error('OCR API Error:', errorMsg);
    return {
      success: false,
      error: `API Error: ${response.status} - ${JSON.stringify(errorMsg)}`
    };
  }

  // Trích xuất text từ kết quả
  let extractedText = '';
  const result = response.body.readResult;

  if (result && result.blocks) {
    result.blocks.forEach((block) => {
      if (block.lines) {
        block.lines.forEach((line) => {
          if (line.text) {
            extractedText += line.text + ' ';
            extractedText += '\n';
          }
        });
      }
    });
  }

  return { success: true, text: extractedText.trim() };
}

// Hàm xử lý OCR bằng Google AI Studio (Gemini Vision API)
async function extractTextWithGoogleVision(imageSource) {
  const settings = store.get('googleVision', {});

  // Support both `apiKey` (legacy single key) and `apiKeys` (array of keys)
  let apiKeys = [];
  if (Array.isArray(settings.apiKeys) && settings.apiKeys.length > 0) {
    apiKeys = settings.apiKeys;
  } else if (settings.apiKey) {
    apiKeys = [settings.apiKey];
  }

  if (!apiKeys || apiKeys.length === 0) {
    return {
      success: false,
      error: 'Vui lòng cấu hình Google AI Studio API Key trong Settings'
    };
  }

  try {
    const { buffer, mimeType } = await downloadOrReadImage(imageSource);
    const imageBase64 = buffer.toString('base64');

    // Gọi Google AI Studio Gemini Vision API
    // Sử dụng gemini-2.5-flash
    const model = 'gemini-2.5-flash';
    const apiVersions = ['v1', 'v1beta'];

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: 'Hãy đọc và trích xuất tất cả văn bản có trong hình ảnh này. Chỉ trả về văn bản, không cần giải thích gì thêm.'
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

    // Thử với từng API key
    let lastError = null;
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      
      try {
        // Thử với các API versions khác nhau
        let response = null;
        for (const apiVersion of apiVersions) {
          try {
            const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;

            response = await axios.post(apiUrl, requestBody, {
              headers: {
                'Content-Type': 'application/json'
              }
            });

            // Nếu thành công, break khỏi loop versions
            if (response.status === 200) {
              break;
            }
          } catch (versionError) {
            // Nếu là lỗi 404 (model not found), thử version tiếp theo
            if (versionError.response && versionError.response.status === 404) {
              continue;
            }
            // Nếu là lỗi khác, throw để thử API key tiếp theo
            throw versionError;
          }
        }

        // Nếu thành công, trích xuất text và return
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
        // Lưu lỗi để trả về nếu tất cả keys đều fail
        lastError = keyError;
        
        // Nếu không phải lỗi API key (403), có thể là lỗi khác, thử tiếp
        if (keyError.response && keyError.response.status === 403) {
          // API key không hợp lệ, thử key tiếp theo
          console.log(`API Key ${keyIndex + 1}/${apiKeys.length} failed (403), trying next key...`);
          continue;
        }
        
        // Nếu là lỗi khác (400, 500, etc.), có thể thử tiếp hoặc return error
        // Tạm thời thử tiếp với key tiếp theo
        console.log(`API Key ${keyIndex + 1}/${apiKeys.length} failed, trying next key...`);
        continue;
      }
    }

    // Nếu tất cả API keys đều fail, trả về lỗi
    if (lastError && lastError.response) {
      const status = lastError.response.status;
      const errorData = lastError.response.data;

      let errorMessage = `Google AI Studio API Error (${status}): `;

      if (status === 403) {
        if (errorData.error && errorData.error.message) {
          errorMessage += errorData.error.message;
        } else {
          errorMessage += 'Tất cả API Keys không hợp lệ hoặc không có quyền truy cập';
        }
      } else if (status === 400) {
        errorMessage += errorData.error?.message || JSON.stringify(errorData);
      } else {
        errorMessage += errorData.error?.message || JSON.stringify(errorData);
      }

      return {
        success: false,
        error: errorMessage
      };
    }

    return {
      success: false,
      error: lastError ? `Network error: ${lastError.message}` : 'Tất cả API Keys đều không hoạt động'
    };
  } catch (error) {
    return {
      success: false,
      error: `Error: ${error.message}`
    };
  }
}

// Hàm OCR thông minh: Ưu tiên Google AI Studio, fallback sang Microsoft Vision
async function performSmartOCR(imageSource) {
  try {
    // Get current thread index và increment counter cho luồng tiếp theo
    const currentThreadIndex = ocrThreadCounter++;
    console.log(`🔄 OCR Thread ${currentThreadIndex}: Starting OCR process`);

    // Kiểm tra xem có Google AI Studio keys không (studioAiGoogleApiKey đã được sync từ API)
    const googleVisionSettings = store.get('googleVision', {});
    let googleApiKeys = [];
    if (Array.isArray(googleVisionSettings.apiKeys) && googleVisionSettings.apiKeys.length > 0) {
      googleApiKeys = googleVisionSettings.apiKeys;
    } else if (googleVisionSettings.apiKey) {
      googleApiKeys = [googleVisionSettings.apiKey];
    }

    // Ưu tiên dùng Google AI Studio nếu có keys
    if (googleApiKeys.length > 0) {
      // Rotate keys: mỗi luồng sử dụng key khác nhau
      const keyIndex = currentThreadIndex % googleApiKeys.length;
      const selectedKey = googleApiKeys[keyIndex];
      const rotatedKeys = [selectedKey]; // Chỉ sử dụng 1 key cho luồng này

      console.log(`🔄 Thread ${currentThreadIndex}: Using Google AI Studio key ${keyIndex + 1}/${googleApiKeys.length} for OCR...`);
      try {
        const googleResult = await extractTextWithGoogleVision(imageSource, rotatedKeys);
        if (googleResult.success) {
          // console.log('✅ Google AI Studio OCR successful');
          return googleResult;
        } else {
          console.log('⚠️ Google AI Studio OCR failed:', googleResult.error);
          // Nếu Google thất bại, thử Microsoft Vision
        }
      } catch (googleError) {
        console.log('⚠️ Google AI Studio OCR error:', googleError.message);
        // Nếu Google lỗi, thử Microsoft Vision
      }
    } else {
      console.log('ℹ️ No Google AI Studio keys found, skipping to Microsoft Vision');
    }

    // Fallback sang Microsoft Vision
    console.log(`🔄 Thread ${currentThreadIndex}: Trying Microsoft Vision OCR...`);
    const microsoftResult = await extractTextWithMicrosoftVision(imageSource, currentThreadIndex);
    if (microsoftResult.success) {
      console.log('✅ Microsoft Vision OCR successful');
      return microsoftResult;
    } else {
      console.log('❌ Microsoft Vision OCR also failed:', microsoftResult.error);
      return microsoftResult;
    }

  } catch (error) {
    console.error('❌ Smart OCR Error:', error);
    return {
      success: false,
      error: `OCR Error: ${error.message}`
    };
  }
}

module.exports = {
  setStore,
  extractTextWithMicrosoftVision,
  extractTextWithGoogleVision,
  performSmartOCR
};

