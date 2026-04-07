/**
 * ========================================
 * 📋 CONFIG FILE - CENTRAL CONFIGURATION
 * ========================================
 * 
 * Tất cả các config quan trọng của app nằm ở đây
 * Chỉ cần sửa file này thay vì tìm nhiều file
 */

module.exports = {
  // ========================================
  // 🔐 LICENSE & GITHUB CONFIG
  // ========================================
  
  /**
   * API endpoints thay thế cho GitHub
   */

  /**
   * API check license
   * POST: localhost:3000/api/tool-news/check-license
   * Body: {"licenseKey": "11111"}
   */
  // URL_GITHUB_RELEASES: 'https://github.com/tientuan1m-png/Youtube-Tool-News/releases',
  URL_GITHUB_RELEASES: 'https://github.com/bacnt2412/Tool-news-BN-Team/releases',


  LICENSE_CHECK_API: 'http://bn.proeditor.vn/api/tool-news/check-license',

  /**
   * API lấy settings và cookies
   * GET: localhost:3000/api/tool-news/get-settings?type=BAC
   */
  SETTINGS_API: 'http://bn.proeditor.vn/api/tool-news/get-settings',

  /**
   * Type parameter cho API settings (theo user request)
   */
  SETTINGS_TYPE: 'BAC',

    /**
   * Tự động tải cookies và settings từ API khi khởi động app
   * true = Bật auto-sync
   * false = Tắt auto-sync
   */
    AUTO_SYNC_ENABLED: true,
    
    /**
     * Timeout cho auto-sync (milliseconds)
     */
    AUTO_SYNC_TIMEOUT: 30000, // 30 seconds
    
  /**
   * GitHub owner và repo sẽ được tự động parse từ LICENSE_FILE_URL
   * Dùng cho auto-update
   */
  
  // ========================================
  // 🎤 TTS (TEXT TO SPEECH) CONFIG
  // ========================================
  
  /**
   * Số lượng bài TTS xử lý đồng thời
   * Giá trị thấp = ổn định hơn, CPU thấp hơn
   * Giá trị cao = nhanh hơn nhưng CPU cao
   */
  MAX_TTS_CONCURRENT: 2,
  
  /**
   * Số lượng câu xử lý song song cho mỗi bài TTS
   * - VoiceVox: 20 câu đồng thời
   * - Google/Others: 10 câu đồng thời
   */
  MAX_CONCURRENT_SENTENCES_VOICEVOX: 20,
  MAX_CONCURRENT_SENTENCES_OTHER: 10,
  
  /**
   * Độ dài câu tối đa mặc định (ký tự)
   * Tool sẽ tự động tách câu dài
   */
  DEFAULT_MAX_SENTENCE_LENGTH: 120,
  
  // ========================================
  // 📹 VIDEO PROCESSING CONFIG
  // ========================================
  
  /**
   * Số lượng video xử lý song song (Video -> Text tab)
   * Giá trị cao = nhanh hơn nhưng RAM cao
   */
  MAX_CONCURRENT_VIDEO_PROCESSING: 5,
  
  /**
   * Số luồng OCR song song = số API keys / 3
   * Tự động tính theo số API keys có sẵn
   */
  OCR_THREADS_DIVIDER: 3,
  
  // ========================================
  // ⬇️ DOWNLOAD CONFIG
  // ========================================
  
  /**
   * Số lượng video download đồng thời
   * Giá trị cao = nhanh hơn nhưng băng thông cao
   */
  MAX_CONCURRENT_DOWNLOADS: 5,
  
  /**
   * Timeout cho yt-dlp download (milliseconds)
   * 0 = không timeout
   */
  DOWNLOAD_TIMEOUT: 0,
  
  // ========================================
  // 🌐 NETWORK CONFIG
  // ========================================
  
  /**
   * Timeout cho license check (milliseconds)
   */
  LICENSE_CHECK_TIMEOUT: 30000, // 30 seconds
  
  /**
   * Timeout cho update check (milliseconds)
   */
  UPDATE_CHECK_TIMEOUT: 30000, // 30 seconds
  
  /**
   * Retry count cho các request bị lỗi
   */
  MAX_RETRY_COUNT: 3,
  
  // ========================================
  // 🎨 UI CONFIG
  // ========================================
  
  /**
   * Thời gian hiển thị toast notification (milliseconds)
   */
  TOAST_DURATION_SUCCESS: 3000,
  TOAST_DURATION_ERROR: 5000,
  TOAST_DURATION_INFO: 3000,
  
  /**
   * Auto-tích checkbox "Tự động tách câu và tạo subtitle"
   */
  AUTO_SPLIT_SENTENCES_DEFAULT: true,
  
  // ========================================
  // 🔧 VOICEVOX CONFIG
  // ========================================
  
  /**
   * VoiceVox server URL
   */
  VOICEVOX_SERVER_URL: 'http://127.0.0.1:50021',
  
  /**
   * Timeout cho VoiceVox server check (milliseconds)
   */
  VOICEVOX_CHECK_TIMEOUT: 5000,
  
  // ========================================
  // 🔄 AUTO-SYNC FROM GITHUB
  // ========================================
  

  // ========================================
  // 📱 APP INFO
  // ========================================
  
  /**
   * App name hiển thị trong UI
   */
  APP_DISPLAY_NAME: 'YouTube Video Info Extractor',
  
  /**
   * App description
   */
  APP_DESCRIPTION: 'Lấy thông tin video YouTube nhanh chóng',
  
  /**
   * Window size mặc định
   */
  DEFAULT_WINDOW_WIDTH: 1920,
  DEFAULT_WINDOW_HEIGHT: 1080,
};

