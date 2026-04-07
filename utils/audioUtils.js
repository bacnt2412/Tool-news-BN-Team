const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Get audio duration using ffprobe
 * @param {string} audioPath - Path to audio file
 * @returns {Promise<number>} Duration in seconds
 */
async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    // Tìm ffprobe trong resources (khi build) hoặc bin (khi dev)
    let ffprobePath = process.resourcesPath 
      ? path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
      : path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    
    // Fallback nếu không tìm thấy
    if (!fs.existsSync(ffprobePath)) {
      ffprobePath = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
    }
    
    if (!fs.existsSync(ffprobePath)) {
      return reject(new Error('ffprobe.exe not found'));
    }
    
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ];
    
    const ffprobe = spawn(ffprobePath, args);
    let output = '';
    let errorOutput = '';
    
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe failed: ${errorOutput}`));
      }
      
      const duration = parseFloat(output.trim());
      if (isNaN(duration)) {
        return reject(new Error('Could not parse duration'));
      }
      
      resolve(duration);
    });
    
    ffprobe.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Concatenate audio files using ffmpeg
 * @param {Array<string>} audioFiles - Array of audio file paths
 * @param {string} outputPath - Output file path
 * @param {Function} progressCallback - Progress callback (progress, total)
 * @returns {Promise<Object>} Result {success, filePath}
 */
async function concatenateAudioFiles(audioFiles, outputPath, progressCallback = null) {
  return new Promise((resolve, reject) => {
    if (!audioFiles || audioFiles.length === 0) {
      return reject(new Error('No audio files provided'));
    }
    
    // Tìm ffmpeg trong resources (khi build) hoặc bin (khi dev)
    let ffmpegPath = process.resourcesPath 
      ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
      : path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
    
    // Fallback nếu không tìm thấy
    if (!fs.existsSync(ffmpegPath)) {
      ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
    }
    
    if (!fs.existsSync(ffmpegPath)) {
      return reject(new Error('ffmpeg.exe not found'));
    }
    
    // Create a temporary file list for ffmpeg concat
    const listPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
    const listContent = audioFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent, 'utf8');
    
    // ffmpeg concat command
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-y',
      outputPath
    ];
    
    const ffmpeg = spawn(ffmpegPath, args);
    let errorOutput = '';
    
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
      
      // Parse progress if callback provided
      if (progressCallback) {
        const timeMatch = errorOutput.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          progressCallback(currentTime);
        }
      }
    });
    
    ffmpeg.on('close', (code) => {
      // Clean up temp file
      try {
        if (fs.existsSync(listPath)) {
          fs.unlinkSync(listPath);
        }
      } catch (e) {
        console.warn('Could not delete temp concat list:', e);
      }
      
      if (code !== 0) {
        return reject(new Error(`ffmpeg concat failed: ${errorOutput}`));
      }
      
      resolve({ success: true, filePath: outputPath });
    });
    
    ffmpeg.on('error', (err) => {
      // Clean up temp file
      try {
        if (fs.existsSync(listPath)) {
          fs.unlinkSync(listPath);
        }
      } catch (e) {
        console.warn('Could not delete temp concat list:', e);
      }
      
      reject(err);
    });
  });
}

module.exports = {
  getAudioDuration,
  concatenateAudioFiles
};

