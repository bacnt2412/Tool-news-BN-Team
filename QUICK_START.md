# Quick Start - Auto Update Setup

## Cấu hình hiện tại

✅ Auto-update đã được setup cho:
- **GitHub Repo**: https://github.com/bacnt2412/Tool-news-BN-Team
- **Releases Page**: https://github.com/bacnt2412/Tool-news-BN-Team/releases

## Hành vi hiện tại

1. **Check License** → Nếu thành công → **Auto check update** (sau 3s)
2. User click nút "🔄 Cập nhật" → Check update manual
3. Có update mới → Confirm download → Confirm install

## Cách Release phiên bản mới

### 1. Tăng version trong package.json
```json
{
  "version": "1.0.1"  // Từ 1.0.0 → 1.0.1
}
```

### 2. Set GitHub Token (chỉ làm 1 lần)
```powershell
# Windows PowerShell
$env:GH_TOKEN="ghp_your_token_here"
```

Lấy token: https://github.com/settings/tokens (quyền `repo`)

### 3. Build và Publish
```bash
npm run build:win
```

File sẽ tự động upload lên: https://github.com/bacnt2412/Tool-news-BN-Team/releases

## Cách Update URL GitHub (nếu cần)

Nếu muốn đổi sang repo khác:

**File: `utils/updateUtils.js`**
```javascript
const GITHUB_OWNER = 'bacnt2412';         // Đổi owner
const GITHUB_REPO = 'Tool-news-BN-Team';  // Đổi repo name
```

**File: `package.json`**
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

## Test Update Flow

### Scenario 1: Development
```bash
npm start
# → Check license
# → (3s delay)
# → Auto check update từ GitHub
# → Console log kết quả
```

### Scenario 2: Production
1. Build version 1.0.0 và publish
2. Cài đặt app
3. Mở app → Check license → Auto check update
4. Build version 1.0.1 và publish
5. Mở app 1.0.0 → Sẽ thấy notification có update mới

## Files quan trọng

```
utils/updateUtils.js     # Logic auto-update
utils/licenseUtils.js    # Logic license check
renderer.js              # UI và auto-check sau license
package.json             # Version và GitHub config
UPDATE_SETUP.md          # Hướng dẫn chi tiết
```

## Troubleshooting

### "No releases found"
→ Chưa có release nào trên GitHub
→ Tạo release đầu tiên: https://github.com/bacnt2412/Tool-news-BN-Team/releases/new

### "Update check failed"
→ Kiểm tra internet
→ Kiểm tra GitHub repo có public không
→ Xem logs: `%APPDATA%/youtube-video-info-extractor/logs/main.log`

### License OK nhưng không auto-check update
→ Mở Console (F12) → Xem logs
→ Kiểm tra `window.electronAPI.checkForUpdates` có tồn tại không

## URLs Reference

- **Releases Page**: https://github.com/bacnt2412/Tool-news-BN-Team/releases
- **License File**: https://github.com/bacnt2412/Tool-news-BN-Team/blob/main/check-license-bn-team.txt
- **Create Token**: https://github.com/settings/tokens
- **Create Release**: https://github.com/bacnt2412/Tool-news-BN-Team/releases/new

## Next Steps

1. [ ] Tạo GitHub token
2. [ ] Test build local: `npm run build:win`
3. [ ] Upload manual release đầu tiên (v1.0.0)
4. [ ] Test auto-update flow
5. [ ] Build v1.0.1 để test update

---

**Lưu ý**: Hiện tại repo chưa có releases ([Empty releases page](https://github.com/bacnt2412/Tool-news-BN-Team/releases)). Cần tạo release đầu tiên để test auto-update!

