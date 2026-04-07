# Hướng dẫn Setup Auto-Update qua GitHub

## Tổng quan

App sử dụng `electron-updater` để tự động cập nhật từ GitHub Releases. Khi có phiên bản mới, user sẽ được thông báo và có thể tải về + cài đặt ngay trong app.

## Cài đặt Dependencies

```bash
npm install electron-updater electron-log --save
```

## Cấu hình package.json

### 1. Thêm publish config

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "bacnt2412",
      "repo": "Tool-news-BN-Team"
    }
  }
}
```

### 2. Tăng version khi có update

Mỗi lần build phiên bản mới, tăng version trong `package.json`:

```json
{
  "version": "1.0.0"  // -> "1.0.1" -> "1.1.0" -> "2.0.0"
}
```


## Publish Manual (nếu build:win không publish)

1. Build app locally:
```bash
npm run build:win
```

2. File sẽ nằm trong `dist/`:
   - `YouTube Video Info Extractor Setup 1.0.0.exe` (installer)
   - `latest.yml` (update metadata)

3. Create GitHub Release:
   - Vào repo: https://github.com/bacnt2412/Tool-news-BN-Team/releases
   - Click "Create a new release"
   - Tag: `v1.0.0` (phải match với version trong package.json)
   - Title: `Version 1.0.0`
   - Upload files:
     - `.exe` file
     - `latest.yml` file
   - Click "Publish release"

## Kiểm tra Update

### Test trên Dev:
1. Build version 1.0.0 và publish lên GitHub
2. Cài đặt app version 1.0.0
3. Build version 1.0.1 và publish lên GitHub  
4. Mở app version 1.0.0
5. Click "🔄 Cập nhật"
6. Sẽ thấy notification có version mới

### Auto-check on Startup (optional):
Uncomment dòng này trong `main.js`:
```javascript
updateUtils.autoCheckOnStartup(10000); // Check sau 10s
```

## Versioning Strategy

Theo [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.x.x): Breaking changes, thay đổi lớn
- **MINOR** (x.1.x): New features, backwards-compatible
- **PATCH** (x.x.1): Bug fixes, minor improvements

Ví dụ:
- `1.0.0` → `1.0.1`: Fix bugs
- `1.0.0` → `1.1.0`: Add new feature
- `1.0.0` → `2.0.0`: Major rewrite

## Troubleshooting

### Error: "Cannot check for updates"
- Kiểm tra kết nối internet
- Kiểm tra GitHub repo có public hay không
- Xem console logs: `main.log` trong userData folder

### Error: "No releases found"
- Đảm bảo đã publish release lên GitHub
- Tag phải match format `v1.0.0` (có chữ `v`)
- File `latest.yml` phải có trong release assets

### Update không hiển thị
- Xóa cache: `%APPDATA%/youtube-video-info-extractor`
- Build lại với version mới
- Kiểm tra `latest.yml` trên GitHub

## Logs

Xem logs để debug:
- Windows: `%USERPROFILE%\AppData\Roaming\youtube-video-info-extractor\logs\`
- File: `main.log`

## Security Notes

- **KHÔNG** commit `GH_TOKEN` vào git
- Chỉ cấp quyền `repo` cho token (không cần admin)
- Token chỉ dùng để publish, không share cho ai
- Có thể revoke token bất cứ lúc nào trên GitHub

## Release Checklist

Trước khi release phiên bản mới:

- [ ] Tăng version trong `package.json`
- [ ] Test đầy đủ features
- [ ] Update CHANGELOG.md (nếu có)
- [ ] Set `GH_TOKEN` environment variable
- [ ] Build: `npm run build:win`
- [ ] Verify release trên GitHub
- [ ] Test update từ version cũ
- [ ] Thông báo users về update mới

## Advanced: Custom Update Server

Nếu muốn dùng server riêng thay vì GitHub:

```javascript
// utils/updateUtils.js
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://your-server.com/updates'
});
```

Server cần serve:
- `latest.yml`: Update metadata
- `.exe` files: Installers

