# Hướng dẫn Setup License System

## Cấu hình GitHub License File

### Bước 1: Tạo GitHub Repository

1. Tạo một repository mới trên GitHub (có thể là private hoặc public)
2. Ví dụ: `https://github.com/YOUR_USERNAME/app-licenses`

### Bước 2: Tạo file `licenses.txt`

1. Tạo file mới tên `licenses.txt` trong repository
2. Mỗi dòng chứa một MAC address được phép sử dụng app
3. Format: `XX:XX:XX:XX:XX:XX`

Ví dụ nội dung file `licenses.txt`:

```
# License file for YouTube Video Info Extractor
# Format: MAC Address (XX:XX:XX:XX:XX:XX)

AA:BB:CC:DD:EE:FF
11:22:33:44:55:66
00:11:22:33:44:55

# Có thể thêm comment bằng dấu #
```

### Bước 3: Lấy Raw URL

1. Mở file `licenses.txt` trên GitHub
2. Click nút "Raw"
3. Copy URL (dạng: `https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/licenses.txt`)

### Bước 4: Cập nhật URL trong Code

Mở file `utils/licenseUtils.js` và thay đổi:

```javascript
const LICENSE_FILE_URL = 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/licenses.txt';
```

## Cách lấy MAC Address của User

Khi user chạy app mà chưa có license:
1. App sẽ hiển thị thông báo "Chưa Active"
2. Hiển thị MAC address của máy user
3. User copy MAC address và gửi cho admin

## Cách Active License cho User

1. User gửi MAC address cho bạn
2. Bạn mở file `licenses.txt` trên GitHub
3. Click "Edit" (icon bút chì)
4. Thêm MAC address vào một dòng mới
5. Click "Commit changes"
6. User click nút "Thử lại" trong app để check lại

## Notes

- File license được cache 10 giây để tránh request quá nhiều
- Nếu không kết nối được GitHub, app sẽ không cho phép sử dụng
- MAC address format: `XX:XX:XX:XX:XX:XX` (viết hoa)
- Có thể thêm comment bằng dấu `#` ở đầu dòng

## Testing

Để test license system:

1. Lấy MAC address của máy test:
```javascript
await window.electronAPI.getMacAddress()
```

2. Thêm vào file `licenses.txt` trên GitHub

3. Reload app và kiểm tra

## Tắt License Check (Development)

Nếu muốn tắt tạm thời để dev, có thể sửa trong `renderer.js`:

```javascript
// Comment out hoặc sửa logic
if (result.success || true) { // Force pass
    // ...
}
```

**Nhớ bỏ comment trước khi build production!**

