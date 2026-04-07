# Copilot Instructions for AI Agents

## Project Overview
This is an Electron-based desktop app for extracting YouTube video information, including title, thumbnail, OCR text from thumbnails, and transcript/subtitles. The app integrates with external tools and APIs for its core features.

## Key Components
- `main.js`: Electron main process, orchestrates app lifecycle and IPC.
- `preload.js`: Secure bridge between main and renderer processes.
- `renderer.js`: Handles UI logic and user interactions.
- `utils/`: Contains utility modules for cookies, downloads, OCR, video info, and yt-dlp integration.
- `bin/VideoSubFinder_6.10_x64/`: Contains external binaries and settings for advanced video/subtitle processing.
- `thumbnails/`, `subtitles/`: Auto-created folders for storing downloaded assets.

## Data Flow
1. User inputs YouTube links in the UI (`index.html`/`renderer.js`).
2. Video info and subtitles are fetched using `yt-dlp` (must be installed and in PATH).
3. Thumbnails are downloaded and processed with Microsoft Computer Vision API for OCR (API key/endpoint set in settings).
4. Results are displayed in a table; users can view, copy, or open assets.

## Developer Workflows
- **Install dependencies:** `npm install`
- **Run app:** `npm start` (prod) or `npm run dev` (with DevTools)
- **Configure OCR:** Set Microsoft Vision API key/endpoint in app settings UI
- **yt-dlp:** Must be installed and accessible in system PATH
- **Debugging:** Use DevTools in dev mode; check console logs for API/yt-dlp errors

## Project-Specific Conventions
- All settings are managed via the app UI and stored using `electron-store`
- External binaries and config (e.g., VideoSubFinder) are in `bin/`
- Utility functions are modularized in `utils/` and should be reused for related tasks
- OCR and subtitle fetching are asynchronous and may require error handling for API limits/timeouts

## Integration Points
- **yt-dlp:** For video info and subtitle extraction (external dependency)
- **Microsoft Computer Vision API:** For OCR on thumbnails (requires Azure resource)
- **Electron IPC:** Used for communication between renderer and main process

## Examples
- To add a new video info extraction feature, extend `videoUtils.js` and update `renderer.js` for UI integration
- For new OCR providers, add a new module in `utils/` and update settings/config logic

## References
- See `README.md` for setup, troubleshooting, and usage details
- See `bin/VideoSubFinder_6.10_x64/Docs/` for advanced subtitle/image processing

---

**Keep instructions concise and focused on this project's actual structure and workflows. Update this file if major architecture or workflow changes occur.**
