const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Simple TTS utilities for VoiceVox (local) and Google Cloud Text-to-Speech

async function synthesizeWithVoiceVox({ text, speaker = 1, outputPath, voicevoxUrl = 'http://127.0.0.1:50021', audioConfig = {} }) {
  // VoiceVox expects /audio_query then /synthesis
  try {
    // audio_query
    const qUrl = `${voicevoxUrl}/audio_query`;
    const qResp = await axios.post(qUrl, null, {
      params: { text, speaker },
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });

    const query = qResp.data;

    // Apply audio config parameters to query
    // VoiceVox supports: speedScale, intonationScale, volumeScale, prePhonemeLength, postPhonemeLength
    if (audioConfig) {
      if (typeof audioConfig.speedScale === 'number') query.speedScale = audioConfig.speedScale;
      if (typeof audioConfig.intonationScale === 'number') query.intonationScale = audioConfig.intonationScale;
      if (typeof audioConfig.volumeScale === 'number') query.volumeScale = audioConfig.volumeScale;
      if (typeof audioConfig.prePhonemeLength === 'number') query.prePhonemeLength = audioConfig.prePhonemeLength;
      if (typeof audioConfig.postPhonemeLength === 'number') query.postPhonemeLength = audioConfig.postPhonemeLength;
      if (typeof audioConfig.pitchScale === 'number') query.pitchScale = audioConfig.pitchScale;

      
      // pitchScale: VoiceVox requires modifying pitch in each mora, not a global parameter
      // We need to adjust pitch for each mora in accent_phrases

      // if (typeof audioConfig.pitchScale === 'number' && query.accent_phrases) {
      //   const pitchMultiplier = audioConfig.pitchScale;
        
      //   query.accent_phrases.forEach(phrase => {
      //     console.log(" ######### phrase: ", phrase);
      //     if (phrase.moras) {
      //       phrase.moras.forEach(mora => {
      //         if (typeof mora.pitch === 'number') {
      //           // Adjust pitch: multiply by pitchScale factor
      //           // VoiceVox pitch is typically in range 0-6.5, so we multiply by the scale
      //           mora.pitch = mora.pitch * pitchMultiplier;
                
      //           // Clamp to reasonable range (0-10)
      //           mora.pitch = Math.max(0, Math.min(10, mora.pitch));
      //         }
      //       });
      //     }
          
      //     // Also adjust pause_mora if exists
      //     if (phrase.pause_mora && typeof phrase.pause_mora.pitch === 'number') {
      //       phrase.pause_mora.pitch = phrase.pause_mora.pitch * pitchMultiplier;
      //       phrase.pause_mora.pitch = Math.max(0, Math.min(10, phrase.pause_mora.pitch));
      //     }
      //   });
      // }
    }

    // synthesis
    const sUrl = `${voicevoxUrl}/synthesis`;
    const sResp = await axios.post(sUrl, query, {
      params: { speaker },
      responseType: 'arraybuffer',
      timeout: 60000
    });

    const wavBuffer = Buffer.from(sResp.data);
    fs.writeFileSync(outputPath, wavBuffer);
    return { success: true, filePath: outputPath };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

async function synthesizeWithGoogle({ text, apiKey, voiceName = 'chirrp-3', languageCode = 'en-US', outputPath, audioEncoding = 'MP3', audioConfig = {} }) {
  try {
    if (!apiKey) {
      return { 
        success: false, 
        error: 'Thiếu Google API key. Vui lòng cấu hình trong Settings → Google Cloud Text-to-Speech API Key' 
      };
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;

    // Build audioConfig with custom params
    const googleAudioConfig = { audioEncoding };
    
    // Apply custom audio parameters from config
    if (audioConfig.speakingRate !== undefined) {
      googleAudioConfig.speakingRate = audioConfig.speakingRate;
    }
    if (audioConfig.pitch !== undefined) {
      googleAudioConfig.pitch = audioConfig.pitch;
    }
    if (audioConfig.volumeGainDb !== undefined) {
      googleAudioConfig.volumeGainDb = audioConfig.volumeGainDb;
    }
    
    console.log('Google TTS audioConfig:', googleAudioConfig);

    const body = {
      input: { text },
      voice: {
        name: voiceName,
        languageCode: languageCode
      },
      audioConfig: googleAudioConfig
    };

    const resp = await axios.post(url, body, { timeout: 30000 });
    if (resp.status !== 200) {
      return { success: false, error: `Google TTS HTTP ${resp.status}` };
    }

    const audioContent = resp.data && resp.data.audioContent;
    if (!audioContent) {
      return { success: false, error: 'No audioContent returned from Google TTS' };
    }

    const buffer = Buffer.from(audioContent, 'base64');
    fs.writeFileSync(outputPath, buffer);
    return { success: true, filePath: outputPath };
  } catch (error) {
    // Handle specific error codes
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;
      
      if (status === 403) {
        let errorMsg = 'Google Cloud TTS API - Lỗi 403 (Forbidden):\n\n';
        
        if (errorData && errorData.error && errorData.error.message) {
          errorMsg += errorData.error.message + '\n\n';
        }
        
        errorMsg += 'Nguyên nhân có thể:\n';
        errorMsg += '1. API key không hợp lệ hoặc đã hết hạn\n';
        errorMsg += '2. Cloud Text-to-Speech API chưa được enable trong project\n';
        errorMsg += '3. Billing chưa được kích hoạt cho project\n';
        errorMsg += '4. API key không có quyền truy cập Cloud Text-to-Speech API\n\n';
        errorMsg += 'Hướng dẫn khắc phục:\n';
        errorMsg += '• Vào https://console.cloud.google.com/apis/library/texttospeech.googleapis.com\n';
        errorMsg += '• Click "Enable API" nếu chưa enable\n';
        errorMsg += '• Kiểm tra Billing đã được kích hoạt tại https://console.cloud.google.com/billing\n';
        errorMsg += '• Tạo API key mới tại https://console.cloud.google.com/apis/credentials';
        
        return { success: false, error: errorMsg };
      } else if (status === 400) {
        let errorMsg = 'Google Cloud TTS API - Lỗi 400 (Bad Request):\n\n';
        if (errorData && errorData.error && errorData.error.message) {
          errorMsg += errorData.error.message + '\n\n';
        }
        errorMsg += 'Voice name hoặc language code có thể không hợp lệ.';
        return { success: false, error: errorMsg };
      } else if (status === 429) {
        return { 
          success: false, 
          error: 'Google Cloud TTS API - Lỗi 429: Vượt quá giới hạn request. Vui lòng đợi một chút rồi thử lại.' 
        };
      } else {
        const errorMsg = errorData && errorData.error && errorData.error.message 
          ? errorData.error.message 
          : `HTTP ${status}`;
        return { success: false, error: `Google TTS Error: ${errorMsg}` };
      }
    }
    
    // Network or other errors
    return { success: false, error: `Google TTS Error: ${error.message || String(error)}` };
  }
}

module.exports = {
  synthesizeWithVoiceVox,
  synthesizeWithGoogle
};
