# Hướng dẫn tạo Icon cho App

## Chuẩn bị Icon

### 1. Tạo icon từ ảnh

**Online Tools (Dễ nhất):**
- https://www.icoconverter.com/ - Convert ảnh → .ico
- https://convertio.co/png-ico/ - Convert PNG/JPG → ICO
- https://cloudconvert.com/png-to-ico - Convert với nhiều size

**Yêu cầu:**
- **Windows**: File `.ico` (khuyến nghị 256x256)
- **Mac**: File `.icns` (nếu build cho Mac)
- **Linux**: File `.png` (512x512)

### 2. Sizes khuyến nghị cho .ico

Icon nên chứa nhiều kích thước:
- 16x16
- 32x32
- 48x48
- 64x64
- 128x128
- 256x256

## Cách tạo Icon nhanh

### Online (Khuyến nghị):

1. Vào: https://www.icoconverter.com/
2. Upload ảnh logo của bạn (PNG hoặc JPG)
3. Chọn sizes: 16, 32, 48, 64, 128, 256
4. Click "Convert"
5. Download file `icon.ico`

### Hoặc dùng GIMP (Free):

1. Download GIMP: https://www.gimp.org/downloads/
2. Mở ảnh logo
3. Image → Scale Image → Set 256x256
4. File → Export As
5. Chọn tên file: `icon.ico`
6. Click Export

### Hoặc dùng ImageMagick (CLI):

```bash
# Install ImageMagick
# Windows: choco install imagemagick
# Mac: brew install imagemagick

# Convert
magick convert logo.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## Đặt file icon

```
project/
├── build/           # Tạo thư mục này
│   └── icon.ico    # Đặt file icon ở đây
├── assets/         # Hoặc đặt ở đây
│   └── icon.ico
├── main.js
└── package.json
```

## Sau khi có icon

App đã được config sẵn để dùng icon từ thư mục `build/`:
- `build/icon.ico` - Windows
- `build/icon.png` - Linux (nếu cần)
- `build/icon.icns` - Mac (nếu cần)

## Test

### Development:
```bash
npm start
```
→ Sẽ thấy icon trên window và taskbar

### Production (Build):
```bash
npm run build:win
```
→ Installer và exe sẽ có icon

## Icon Generator Tools

### Free Online:
1. **ICO Converter**: https://www.icoconverter.com/
2. **Favicon Generator**: https://realfavicongenerator.net/
3. **CloudConvert**: https://cloudconvert.com/png-to-ico

### Desktop Apps:
1. **GIMP** (Free): https://www.gimp.org/
2. **IcoFX** (Trial): https://icofx.ro/
3. **Greenfish Icon Editor** (Free): http://greenfishsoftware.org/

## Tips

### Thiết kế Icon tốt:
- ✅ Đơn giản, dễ nhận diện
- ✅ Rõ ràng ở kích thước nhỏ (16x16)
- ✅ Nền trong suốt (transparent)
- ✅ Màu sắc nổi bật
- ❌ Tránh chi tiết quá nhiều
- ❌ Tránh chữ quá nhỏ

### Ví dụ icon phù hợp:
- 📹 Video player icon
- 🔊 Audio icon  
- 📊 Data icon
- ⬇️ Download icon

### Test icon:
Sau khi tạo, test với các size:
- 16x16 - System tray
- 32x32 - Taskbar
- 48x48 - Desktop shortcut
- 256x256 - Windows properties

## Tài nguyên Icon miễn phí

### Icon Libraries:
- **Icons8**: https://icons8.com/ (Free với credit)
- **Flaticon**: https://www.flaticon.com/ (Free & Premium)
- **The Noun Project**: https://thenounproject.com/
- **Material Icons**: https://fonts.google.com/icons

### Logo Makers:
- **Canva**: https://www.canva.com/ (Free tier)
- **Looka**: https://looka.com/
- **Hatchful**: https://www.shopify.com/tools/logo-maker

## Troubleshooting

### Icon không hiển thị:
- ✓ Đảm bảo file tên đúng: `icon.ico`
- ✓ Đặt đúng thư mục: `build/`
- ✓ Build lại app: `npm run build:win`
- ✓ Xóa cache: Delete `dist/` folder

### Icon bị vỡ/mờ:
- ✓ Dùng ảnh gốc chất lượng cao (PNG)
- ✓ Tạo lại với tool khác
- ✓ Bao gồm nhiều size trong .ico

### Icon chỉ hiển thị trong dev:
- ✓ Kiểm tra `package.json` build config
- ✓ Đảm bảo `build/icon.ico` tồn tại
- ✓ Build lại production

