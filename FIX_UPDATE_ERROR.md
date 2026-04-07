# Fix Lỗi Update 404

## Nguyên nhân

App version 1.0.1 đang check update từ GitHub, nhưng release v1.0.1 chưa tồn tại.

URL đang tìm: https://github.com/bacnt2412/Tool-news-BN-Team/releases/download/v1.0.1/YouTube-Video-Info-Extractor-Setup-1.0.1.exe

## Giải pháp nhanh

### Option 1: Tắt Auto-Check Update tạm thời

**File: `renderer.js` (dòng ~30-43)**

Comment out đoạn auto-check:

```javascript
if (result.success) {
    // License valid - hide modal and show app
    console.log('License verified successfully');
    licenseModal.style.display = 'none';
    if (appContainer) {
        appContainer.style.display = 'block';
    }
    
    // COMMENT OUT auto-check update
    /*
    setTimeout(() => {
        console.log('Auto-checking for app updates...');
        if (window.electronAPI && window.electronAPI.checkForUpdates) {
            window.electronAPI.checkForUpdates().catch(err => {
                console.error('Auto update check failed:', err);
            });
        }
    }, 3000);
    */
}
```

Sau khi comment, reload app → Không còn lỗi 404!

### Option 2: Đổi version về 1.0.0

**File: `package.json`**

```json
{
  "version": "1.0.0"
}
```

Nhưng vẫn sẽ lỗi vì GitHub chưa có release 1.0.0.

### Option 3: Build và Publish Release (Đúng cách)

## Cách Build và Publish Release

### Bước 1: Tạo GitHub Personal Access Token

1. Vào: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Đặt tên: `Electron Publisher`
4. Chọn quyền: ✅ `repo` (Full control)
5. Click "Generate token"
6. **Copy token** (chỉ hiển thị 1 lần!)

### Bước 2: Set Token

**PowerShell:**
```powershell
$env:GH_TOKEN="ghp_xxxxxxxxxxxxx"
```

**CMD:**
```cmd
set GH_TOKEN=ghp_xxxxxxxxxxxxx
```

### Bước 3: Build và Publish

```bash
npm run build:win
```

→ File sẽ tự động upload lên GitHub Releases!

### Bước 4: Verify Release

Check tại: https://github.com/bacnt2412/Tool-news-BN-Team/releases

Phải thấy:
- ✅ Release tag: `v1.0.1`
- ✅ File: `YouTube-Video-Info-Extractor-Setup-1.0.1.exe`
- ✅ File: `latest.yml`

## Workflow đúng

### Lần đầu tiên (Setup):

1. Version trong `package.json`: `1.0.0`
2. Build: `npm run build:win`
3. Publish lên GitHub → Release v1.0.0
4. Test app → Không có update (đang dùng latest)

### Lần sau (Update):

1. Code xong features mới
2. Tăng version: `1.0.0` → `1.0.1`
3. Build: `npm run build:win`
4. Publish lên GitHub → Release v1.0.1
5. User mở app v1.0.0 → Thấy có update v1.0.1

## Test Update Flow

### Cách test đúng:

1. **Build v1.0.0** → Publish
2. **Cài app v1.0.0** trên máy khác hoặc folder khác
3. **Build v1.0.1** → Publish
4. **Mở app v1.0.0** → Sẽ thấy notification có update!

### Không nên:

- ❌ Tăng version mà không publish
- ❌ Publish mà không build trước
- ❌ Test update trên cùng version

## Quick Fix cho Development

Nếu đang dev và chưa muốn publish:

**File: `main.js` (dòng ~120-125)**

Comment out auto-check on startup:

```javascript
// Setup auto-updater
updateUtils.setMainWindow(mainWindow);
updateUtils.configureAutoUpdater();

// COMMENT OUT nếu chưa có release trên GitHub
// updateUtils.autoCheckOnStartup(10000);
```

**File: `renderer.js`**

Comment out auto-check sau license (như Option 1)

## Troubleshooting

### "Cannot download, status 404"
→ Release chưa tồn tại trên GitHub
→ Publish release hoặc tắt auto-check

### "No releases found"  
→ GitHub repo chưa có release nào
→ Build và publish release đầu tiên

### "Error: getaddrinfo ENOTFOUND"
→ Không có internet
→ Check kết nối mạng

### Build success nhưng không upload
→ `GH_TOKEN` không hợp lệ
→ Tạo token mới với quyền `repo`

## Summary

**Để fix lỗi 404 ngay:**
→ Comment out auto-check update trong `renderer.js`

**Để dùng update đúng cách:**
→ Build và publish release v1.0.1 lên GitHub

**Workflow đúng:**
1. Code → 2. Tăng version → 3. Build → 4. Auto-publish → 5. Users update

