# YouTube Video Info Extractor

Ứng dụng Electron để lấy thông tin video YouTube bao gồm tiêu đề, thumbnail, chữ trên thumbnail (OCR), và transcript.

## Tính năng

- ✅ Nhập danh sách link YouTube (hỗ trợ nhiều link cùng lúc)
- ✅ Lấy thông tin video: tiêu đề, thumbnail, duration, uploader, view count
- ✅ Tải và hiển thị thumbnail
- ✅ OCR để nhận diện chữ trên thumbnail sử dụng **Microsoft Computer Vision API** (hỗ trợ nhiều ngôn ngữ)
- ✅ Tải transcript/subtitle ngôn ngữ gốc của video
- ✅ Hiển thị kết quả trong bảng đẹp mắt
- ✅ Copy transcript, mở video trên trình duyệt
- ✅ Settings để cấu hình Microsoft Vision API

## Yêu cầu hệ thống

- Node.js (v16 trở lên)
- npm hoặc yarn
- **yt-dlp** đã được cài đặt và có trong PATH
  - Windows: Tải từ [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) hoặc dùng `pip install yt-dlp`
  - Linux/Mac: `pip install yt-dlp` hoặc `brew install yt-dlp`
- **Microsoft Azure Computer Vision** resource với API Key và Endpoint

## Cài đặt

1. Clone repository hoặc tải source code
2. Cài đặt dependencies:

```bash
npm install
```

3. Đảm bảo **yt-dlp** đã được cài đặt:

```bash
# Kiểm tra
yt-dlp --version
```

4. Cấu hình Microsoft Computer Vision API:
   - Tạo Azure Computer Vision resource tại [Azure Portal](https://portal.azure.com)
   - Lấy API Key và Endpoint từ resource
   - Mở ứng dụng và vào Settings (nút ⚙️ ở góc trên bên phải)
   - Nhập API Key và Endpoint
   - Nhấn "Lưu Settings"

## Sử dụng

1. Khởi chạy ứng dụng:

```bash
npm start
```

Hoặc chế độ development (có DevTools):

```bash
npm run dev
```

2. **Cấu hình Settings (lần đầu sử dụng)**:
   - Nhấn nút "⚙️ Settings" ở góc trên bên phải
   - Nhập Microsoft Vision API Key
   - Nhập Microsoft Vision Endpoint (ví dụ: `https://your-resource.cognitiveservices.azure.com`)
   - Nhấn "Lưu Settings"

3. Nhập danh sách link YouTube vào textarea (mỗi link một dòng)
4. Nhấn nút "Lấy thông tin"
5. Chờ ứng dụng xử lý (sẽ hiển thị progress bar)
6. Xem kết quả trong bảng:
   - **Thumbnail**: Click để xem ảnh lớn
   - **Chữ trên thumbnail**: Được nhận diện bằng Microsoft Computer Vision OCR
   - **Transcript**: Subtitle đã tải về
   - **Thao tác**: Mở video hoặc copy transcript

## Cấu trúc dự án

```
.
├── main.js           # Electron main process
├── preload.js        # Preload script (bridge giữa main và renderer)
├── index.html        # UI chính
├── renderer.js       # Logic xử lý UI
├── styles.css        # Styling
├── package.json      # Dependencies và scripts
├── thumbnails/       # Thư mục lưu thumbnail (tự động tạo)
└── subtitles/        # Thư mục lưu subtitle (tự động tạo)
```

## Công nghệ sử dụng

- **Electron**: Framework để build desktop app
- **yt-dlp**: Công cụ gốc để lấy thông tin video và subtitle từ YouTube
- **Microsoft Computer Vision API**: OCR engine để nhận diện chữ trên thumbnail
- **electron-store**: Lưu trữ settings
- **axios**: HTTP client để gọi Microsoft Vision API

## Lấy Microsoft Computer Vision API

1. Đăng nhập vào [Azure Portal](https://portal.azure.com)
2. Tạo một **Computer Vision** resource:
   - Vào "Create a resource"
   - Tìm "Computer Vision"
   - Chọn "Create"
   - Điền thông tin và tạo resource
3. Sau khi tạo xong:
   - Vào resource vừa tạo
   - Vào "Keys and Endpoint"
   - Copy **Key 1** (hoặc Key 2) - đây là API Key
   - Copy **Endpoint** - đây là Endpoint URL
4. Nhập vào Settings của ứng dụng

## Lưu ý

- **yt-dlp** phải được cài đặt và có trong PATH của hệ thống
- Microsoft Computer Vision API có giới hạn request (free tier: 20 requests/phút)
- Subtitle chỉ có sẵn nếu video có subtitle hoặc auto-generated captions
- OCR có thể mất vài giây để xử lý (Microsoft Vision API sử dụng async processing)
- Settings được lưu tự động và sẽ được load lại khi mở ứng dụng

## Troubleshooting

### Lỗi "yt-dlp not found"
- Đảm bảo yt-dlp đã được cài đặt: `yt-dlp --version`
- Trên Windows, đảm bảo yt-dlp.exe có trong PATH hoặc thư mục hiện tại
- Có thể tải yt-dlp từ [GitHub releases](https://github.com/yt-dlp/yt-dlp/releases)

### OCR không hoạt động
- Kiểm tra Settings đã được cấu hình đúng chưa (API Key và Endpoint)
- Kiểm tra API Key còn hợp lệ không
- Kiểm tra endpoint URL đúng format: `https://your-resource.cognitiveservices.azure.com`
- Kiểm tra xem thumbnail có được tải về không (trong thư mục `thumbnails/`)
- Xem console log để biết lỗi chi tiết

### Không tải được subtitle
- Không phải tất cả video YouTube đều có subtitle
- Thử với video khác có subtitle hoặc auto-generated captions
- Kiểm tra yt-dlp có hoạt động không: `yt-dlp --list-subs <video-url>`

### Lỗi API Microsoft Vision
- Kiểm tra API Key và Endpoint đã đúng chưa
- Kiểm tra resource còn active không
- Kiểm tra quota/limit của API (free tier có giới hạn)
- Xem error message chi tiết trong console

## License

MIT

## Tác giả

BNTeam
