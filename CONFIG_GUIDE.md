# 📋 CONFIG GUIDE - Hướng dẫn cấu hình

## 🎯 Mục đích

File `config.js` chứa **TẤT CẢ** các cấu hình quan trọng của ứng dụng.

**Lợi ích**: Chỉ cần sửa **1 file** thay vì tìm trong nhiều file khác nhau!

---

## 📂 File config: `config.js`

```javascript
const config = require('./config');

// Sử dụng config
console.log(config.LICENSE_FILE_URL);
console.log(config.MAX_TTS_CONCURRENT);
```

---

## 🔧 Các config quan trọng

### 1. 🔐 LICENSE & GITHUB

#### `LICENSE_FILE_URL`
- **Mô tả**: URL file license trên GitHub (chứa danh sách MAC address)
- **Mặc định**: `https://github.com/bacnt2412/Tool-news-BN-Team/blob/main/check-license-bn-team.txt`
- **Cách sửa**: Đổi thành URL GitHub của bạn
- **Lưu ý**: GitHub owner và repo sẽ được tự động parse từ URL này cho auto-update

---

### 2. 🎤 TTS (TEXT TO SPEECH)

#### `MAX_TTS_CONCURRENT`
- **Mô tả**: Số lượng bài TTS xử lý đồng thời
- **Mặc định**: `2`
- **Khuyến nghị**: 
  - `1-2`: Ổn định, CPU thấp
  - `3-5`: Nhanh hơn nhưng CPU cao

#### `MAX_CONCURRENT_SENTENCES_VOICEVOX`
- **Mô tả**: Số câu xử lý song song cho VoiceVox
- **Mặc định**: `20`
- **Khuyến nghị**: `10-30` (VoiceVox chạy local nên có thể cao)

#### `MAX_CONCURRENT_SENTENCES_OTHER`
- **Mô tả**: Số câu xử lý song song cho Google/Azure/...
- **Mặc định**: `10`
- **Khuyến nghị**: `5-15` (Tùy thuộc API rate limit)

#### `DEFAULT_MAX_SENTENCE_LENGTH`
- **Mô tả**: Độ dài câu tối đa (ký tự)
- **Mặc định**: `120`
- **Lưu ý**: Tool sẽ tự động tách câu dài

---

### 3. 📹 VIDEO PROCESSING

#### `MAX_CONCURRENT_VIDEO_PROCESSING`
- **Mô tả**: Số video xử lý song song (Video -> Text tab)
- **Mặc định**: `5`
- **Khuyến nghị**:
  - RAM 8GB: `2-3`
  - RAM 16GB: `5-7`
  - RAM 32GB+: `10-15`

#### `OCR_THREADS_DIVIDER`
- **Mô tả**: Số luồng OCR = số API keys / giá trị này
- **Mặc định**: `3`
- **Ví dụ**: 
  - 9 API keys → 3 luồng OCR
  - 12 API keys → 4 luồng OCR

---

### 4. ⬇️ DOWNLOAD

#### `MAX_CONCURRENT_DOWNLOADS`
- **Mô tả**: Số video download đồng thời
- **Mặc định**: `5`
- **Khuyến nghị**:
  - Mạng chậm: `2-3`
  - Mạng nhanh: `5-10`

#### `DOWNLOAD_TIMEOUT`
- **Mô tả**: Timeout cho yt-dlp (milliseconds)
- **Mặc định**: `0` (không timeout)
- **Lưu ý**: Set `300000` (5 phút) nếu muốn timeout

---

### 5. 🌐 NETWORK

#### `LICENSE_CHECK_TIMEOUT`
- **Mô tả**: Timeout cho license check
- **Mặc định**: `30000` (30 giây)

#### `UPDATE_CHECK_TIMEOUT`
- **Mô tả**: Timeout cho update check
- **Mặc định**: `30000` (30 giây)

#### `MAX_RETRY_COUNT`
- **Mô tả**: Số lần retry khi request bị lỗi
- **Mặc định**: `3`

---

### 6. 🎨 UI CONFIG

#### `TOAST_DURATION_SUCCESS`
- **Mô tả**: Thời gian hiển thị toast thành công
- **Mặc định**: `3000` (3 giây)

#### `TOAST_DURATION_ERROR`
- **Mô tả**: Thời gian hiển thị toast lỗi
- **Mặc định**: `5000` (5 giây)

#### `AUTO_SPLIT_SENTENCES_DEFAULT`
- **Mô tả**: Auto-tích checkbox "Tự động tách câu và tạo subtitle"
- **Mặc định**: `true`

---

### 7. 🔧 VOICEVOX

#### `VOICEVOX_SERVER_URL`
- **Mô tả**: URL VoiceVox server
- **Mặc định**: `http://127.0.0.1:50021`

#### `VOICEVOX_CHECK_TIMEOUT`
- **Mô tả**: Timeout khi check VoiceVox server
- **Mặc định**: `5000` (5 giây)

---

### 8. 🔄 AUTO-SYNC FROM GITHUB

#### `AUTO_SYNC_ENABLED`
- **Mô tả**: Tự động tải cookies và settings từ GitHub khi khởi động app
- **Mặc định**: `true` (bật)
- **Giá trị**:
  - `true`: Bật auto-sync (khuyến nghị)
  - `false`: Tắt auto-sync
- **Lưu ý**: Rất hữu ích khi cần update cookies/settings cho nhiều máy cùng lúc

#### `COOKIES_GITHUB_URL`
- **Mô tả**: URL file cookies.txt trên GitHub (raw format)
- **Mặc định**: `https://raw.githubusercontent.com/bacnt2412/Tool-news-BN-Team/refs/heads/main/cookies.txt`
- **Format**: `https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/{file}`
- **Lưu ý**: Phải là URL raw, không phải URL HTML của GitHub

#### `SETTINGS_GITHUB_URL`
- **Mô tả**: URL file settings.json trên GitHub (raw format)
- **Mặc định**: `https://raw.githubusercontent.com/bacnt2412/Tool-news-BN-Team/refs/heads/main/settings.json`
- **Chứa**: API keys cho Microsoft Vision, Google Vision, Google TTS
- **Format JSON**:
```json
{
  "microsoft-vision-api-key": [
    {
      "value": "YOUR_API_KEY",
      "end-point": "https://eastus2.api.cognitive.microsoft.com/"
    }
  ],
  "studio-ai-google-api-key": [
    "API_KEY_1",
    "API_KEY_2"
  ],
  "google-cloud-api-key": [
    "API_KEY"
  ]
}
```

#### `AUTO_SYNC_TIMEOUT`
- **Mô tả**: Timeout cho auto-sync requests
- **Mặc định**: `30000` (30 giây)

---

### 9. 📱 APP INFO

#### `APP_DISPLAY_NAME`
- **Mô tả**: Tên app hiển thị trong UI
- **Mặc định**: `YouTube Video Info Extractor`

#### `DEFAULT_WINDOW_WIDTH` / `DEFAULT_WINDOW_HEIGHT`
- **Mô tả**: Kích thước cửa sổ mặc định
- **Mặc định**: `1920 x 1080`

---

## 💡 Ví dụ chỉnh sửa

### Tăng tốc độ TTS (có PC mạnh)

```javascript
// Trong config.js
MAX_TTS_CONCURRENT: 5, // Tăng từ 2 lên 5
MAX_CONCURRENT_SENTENCES_VOICEVOX: 30, // Tăng từ 20 lên 30
MAX_CONCURRENT_SENTENCES_OTHER: 15, // Tăng từ 10 lên 15
```

### Giảm RAM khi xử lý video (PC yếu)

```javascript
// Trong config.js
MAX_CONCURRENT_VIDEO_PROCESSING: 2, // Giảm từ 5 xuống 2
OCR_THREADS_DIVIDER: 5, // Tăng từ 3 lên 5 (giảm số luồng OCR)
```

### Đổi license URL

```javascript
// Trong config.js
LICENSE_FILE_URL: 'https://github.com/YOUR_USERNAME/YOUR_REPO/blob/main/license.txt',
```

**Lưu ý**: GitHub owner và repo cho auto-update sẽ được tự động parse từ URL này!

### Tắt auto-sync từ GitHub (dùng cookies/settings local)

```javascript
// Trong config.js
AUTO_SYNC_ENABLED: false, // Tắt auto-sync
```

### Đổi URL cookies và settings trên GitHub

```javascript
// Trong config.js
COOKIES_GITHUB_URL: 'https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/refs/heads/main/cookies.txt',
SETTINGS_GITHUB_URL: 'https://raw.githubusercontent.com/YOUR_NAME/YOUR_REPO/refs/heads/main/settings.json',
```

**Quan trọng**: Phải là URL **raw** của GitHub!

---

## 🚀 Sau khi sửa config

1. **Save file** `config.js`
2. **Khởi động lại app**:
   ```bash
   npm start
   ```
3. **Rebuild** nếu muốn tạo file `.exe` mới:
   ```bash
   npm run build:win
   ```

---

## ⚠️ Lưu ý quan trọng

1. **Backup** file `config.js` trước khi sửa
2. **Không sửa cú pháp JavaScript** (dấu phẩy, ngoặc, ...)
3. **Test kỹ** sau khi sửa config
4. **Restart app** để config có hiệu lực

---

## 📝 File liên quan

| File | Vai trò |
|------|---------|
| `config.js` | **File config chính** (SỬA Ở ĐÂY) |
| `main.js` | Import và sử dụng config (backend) |
| `renderer.js` | Nhận config qua IPC (frontend) |
| `preload.js` | Expose config từ main → renderer |
| `utils/licenseUtils.js` | Sử dụng `LICENSE_FILE_URL` |
| `utils/updateUtils.js` | Parse GitHub info từ `LICENSE_FILE_URL` |

---

## 🎯 Tóm tắt

✅ **Muốn sửa config** → Vào file `config.js`  
✅ **Không cần tìm nhiều file** → Tất cả ở một chỗ  
✅ **Dễ maintain** → Comment rõ ràng từng config  
✅ **Type-safe** → JSDoc để autocomplete  

**Happy coding!** 🏴‍☠️⚓

