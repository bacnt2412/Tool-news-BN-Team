const path = require('path');
const fs = require('fs');

/**
 * Split text into sentences supporting multiple languages
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum sentence length (default: 120)
 * @returns {Array<string>} Array of sentences
 */
function splitIntoSentences(text, maxLength = 120) {
  if (!text || typeof text !== 'string') return [];
  
  // Normalize whitespace
  text = text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const sentences = [];
  
  // Step 1: Split by paragraphs/line breaks first
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);
  
  for (const paragraph of paragraphs) {
    // Detect if text contains Japanese/Chinese characters
    const hasCJK = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(paragraph);
    
    // Step 2: Process quotes/quotation marks first to keep them together
    // Japanese quotes: 「」 『』
    // Other quotes: "" '' () [] {}
    const processedParagraph = processQuotes(paragraph, maxLength, hasCJK);
    
    // Step 3: Split by strong sentence endings
    // English, Vietnamese: . ! ?
    // Japanese: 。！？
    // Chinese: 。！？
    const strongEnders = hasCJK ? /([。！？]+)/g : /([.!?]+(?:\s|$))/g;
    const parts = processedParagraph.split(strongEnders);
    
    let currentSentence = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      
      // Check if this is a strong punctuation marker
      const isStrongPunctuation = hasCJK ? /^[。！？]+$/.test(part) : /^[.!?]+$/.test(part);
      
      if (isStrongPunctuation) {
        currentSentence += part;
        
        // Check if we're inside quotes - if so, don't split yet
        const isInsideQuotes = checkInsideQuotes(currentSentence, hasCJK);
        
        if (!isInsideQuotes) {
          // Not inside quotes - safe to split
          if (currentSentence.trim().length > 0) {
            sentences.push(...splitLongSentence(currentSentence.trim(), maxLength, hasCJK));
            currentSentence = '';
          }
        }
        // If inside quotes, continue accumulating until we find closing quote
      } else {
        currentSentence += (currentSentence && !hasCJK ? ' ' : '') + part;
        
        // Note: We don't split immediately when closing quotes
        // We'll wait for the next strong punctuation or end of paragraph
        
        // Check if we're inside quotes (Japanese quotes: 「」 『』)
        const isInsideQuotes = checkInsideQuotes(currentSentence, hasCJK);
        
        // If not inside quotes and we have sentence-ending punctuation, check if we should split
        if (!isInsideQuotes && hasCJK) {
          // Find the last sentence-ending punctuation
          const lastSentenceEnding = Math.max(
            currentSentence.lastIndexOf('。'),
            currentSentence.lastIndexOf('！'),
            currentSentence.lastIndexOf('？')
          );
          
          if (lastSentenceEnding !== -1) {
            // Check if there's text after the last sentence-ending punctuation
            const afterEnding = currentSentence.substring(lastSentenceEnding + 1);
            // Remove closing quotes and whitespace to check for real content
            const afterEndingCleaned = afterEnding.replace(/[」』\s]*$/, '').trim();
            // If there's meaningful text after (not just closing quotes), we can split
            const hasTextAfterEnding = afterEndingCleaned.length > 0 && 
              !(/^[「『]/.test(afterEndingCleaned));
            
            if (hasTextAfterEnding) {
              // Find the position after the last closing quote (if any) after sentence ending
              let splitPos = lastSentenceEnding + 1;
              // Skip closing quotes immediately after sentence ending
              const afterEndingMatch = afterEnding.match(/^[」』\s]*/);
              if (afterEndingMatch) {
                splitPos += afterEndingMatch[0].length;
              }
              
              // Split at the position after closing quotes
              const beforeSplit = currentSentence.substring(0, splitPos);
              const afterSplit = currentSentence.substring(splitPos);
              
              if (beforeSplit.trim().length > 0) {
                sentences.push(...splitLongSentence(beforeSplit.trim(), maxLength, hasCJK));
                currentSentence = afterSplit.trim();
                continue;
              }
            }
          }
        }
        
        // For Japanese/Chinese: Always split on comma (、) if sentence is getting long
        // For other languages: Split on comma if sentence is long enough
        // BUT: Don't split if we're inside quotes (unless quote content is too long)
        if (!isInsideQuotes) {
          const shouldSplitOnComma = hasCJK 
            ? (currentSentence.length > 30) // Japanese: split more aggressively
            : (currentSentence.length > maxLength * 0.6); // Other languages: split at 60% of max
          
          if (shouldSplitOnComma) {
            // Split on Japanese/Chinese comma (、) or regular comma
            // But don't split if comma is inside quotes
            const commaPattern = hasCJK ? /([、，])/g : /([,，])/g;
            const commaParts = currentSentence.split(commaPattern);
            
            if (commaParts.length > 1) {
              let accumulated = '';
              for (let j = 0; j < commaParts.length; j++) {
                const subPart = commaParts[j];
                accumulated += subPart;
                
                // If we hit a comma delimiter
                if (/[、，,]/.test(subPart)) {
                  // Check if this comma is inside quotes
                  const beforeComma = accumulated.substring(0, accumulated.length - subPart.length);
                  const isCommaInQuotes = checkInsideQuotes(beforeComma + subPart, hasCJK);
                  
                  if (!isCommaInQuotes) {
                    const trimmed = accumulated.trim();
                    if (trimmed.length > 10) { // Minimum length before splitting
                      sentences.push(...splitLongSentence(trimmed, maxLength, hasCJK));
                      accumulated = '';
                    }
                  }
                }
              }
              currentSentence = accumulated.trim();
            }
          }
        } else {
          // We're inside quotes - check if quote content is too long
          const quoteContent = extractQuoteContent(currentSentence, hasCJK);
          if (quoteContent && quoteContent.length > maxLength) {
            // Quote is too long, need to split it
            // But keep the quote marks together
            const splitQuote = splitLongQuote(currentSentence, maxLength, hasCJK);
            if (splitQuote.length > 1) {
              // Add all but last part to sentences
              for (let k = 0; k < splitQuote.length - 1; k++) {
                sentences.push(splitQuote[k]);
              }
              currentSentence = splitQuote[splitQuote.length - 1];
            }
          }
        }
        
        // Also check if current sentence is already too long
        if (currentSentence.length > maxLength) {
          sentences.push(...splitLongSentence(currentSentence.trim(), maxLength, hasCJK));
          currentSentence = '';
        }
      }
    }
    
    // Push any remaining text
    if (currentSentence.trim().length > 0) {
      sentences.push(...splitLongSentence(currentSentence.trim(), maxLength, hasCJK));
    }
  }
  
  // If no sentences found, return whole text as one sentence (but split if too long)
  if (sentences.length === 0 && text.trim().length > 0) {
    const hasCJK = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
    sentences.push(...splitLongSentence(text.trim(), maxLength, hasCJK));
  }
  
  // Filter out very short sentences (likely artifacts)
  return sentences.filter(s => s.length > 1);
}

/**
 * Check if we're currently inside quotes
 * @param {string} text - Text to check
 * @param {boolean} hasCJK - Whether text contains CJK characters
 * @returns {boolean} True if inside quotes
 */
function checkInsideQuotes(text, hasCJK) {
  if (hasCJK) {
    // Japanese quotes: 「」 『』
    // Count opening and closing quotes
    const openSingle = (text.match(/「/g) || []).length;
    const closeSingle = (text.match(/」/g) || []).length;
    const openDouble = (text.match(/『/g) || []).length;
    const closeDouble = (text.match(/』/g) || []).length;
    
    // If there's an unclosed quote, we're inside quotes
    return (openSingle > closeSingle) || (openDouble > closeDouble);
  } else {
    // Other quotes: "" '' () [] {}
    const quotes = [
      { open: /"/g, close: /"/g },
      { open: /'/g, close: /'/g },
      { open: /\(/g, close: /\)/g },
      { open: /\[/g, close: /\]/g },
      { open: /\{/g, close: /\}/g }
    ];
    
    for (const quote of quotes) {
      const openCount = (text.match(quote.open) || []).length;
      const closeCount = (text.match(quote.close) || []).length;
      if (openCount > closeCount) return true;
    }
    
    return false;
  }
}

/**
 * Extract content inside the last unclosed quote
 * @param {string} text - Text to extract from
 * @param {boolean} hasCJK - Whether text contains CJK characters
 * @returns {string|null} Quote content or null
 */
function extractQuoteContent(text, hasCJK) {
  if (hasCJK) {
    // Find the last opening quote
    const lastOpenSingle = text.lastIndexOf('「');
    const lastOpenDouble = text.lastIndexOf('『');
    const lastOpen = Math.max(lastOpenSingle, lastOpenDouble);
    
    if (lastOpen !== -1) {
      // Extract from opening quote to end (or closing quote if exists)
      const afterOpen = text.substring(lastOpen + 1);
      const closeSingle = afterOpen.indexOf('」');
      const closeDouble = afterOpen.indexOf('』');
      
      let closePos = -1;
      if (closeSingle !== -1 && closeDouble !== -1) {
        closePos = Math.min(closeSingle, closeDouble);
      } else if (closeSingle !== -1) {
        closePos = closeSingle;
      } else if (closeDouble !== -1) {
        closePos = closeDouble;
      }
      
      if (closePos !== -1) {
        return afterOpen.substring(0, closePos);
      } else {
        return afterOpen; // Unclosed quote
      }
    }
  } else {
    // Find the last opening quote
    const patterns = [
      { open: /"/g, close: /"/g },
      { open: /'/g, close: /'/g },
      { open: /\(/g, close: /\)/g },
      { open: /\[/g, close: /\]/g },
      { open: /\{/g, close: /\}/g }
    ];
    
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern.open)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const afterOpen = text.substring(lastMatch.index + 1);
        const closeMatch = afterOpen.match(pattern.close);
        if (closeMatch) {
          return afterOpen.substring(0, closeMatch.index);
        } else {
          return afterOpen; // Unclosed quote
        }
      }
    }
  }
  
  return null;
}

/**
 * Split a long quote into multiple parts while keeping quote marks
 * @param {string} text - Text containing quote
 * @param {number} maxLength - Maximum length
 * @param {boolean} hasCJK - Whether text contains CJK characters
 * @returns {Array<string>} Array of text parts
 */
function splitLongQuote(text, maxLength, hasCJK) {
  if (hasCJK) {
    // Find the quote boundaries
    const lastOpenSingle = text.lastIndexOf('「');
    const lastOpenDouble = text.lastIndexOf('『');
    const lastOpen = Math.max(lastOpenSingle, lastOpenDouble);
    
    if (lastOpen === -1) {
      // No quote found, use regular split
      return splitLongSentence(text, maxLength, hasCJK);
    }
    
    const beforeQuote = text.substring(0, lastOpen);
    const quoteChar = text[lastOpen];
    const afterOpen = text.substring(lastOpen + 1);
    
    // Check if quote is closed
    const closeChar = quoteChar === '「' ? '」' : '』';
    const closePos = afterOpen.indexOf(closeChar);
    
    if (closePos !== -1) {
      // Quote is closed
      const quoteContent = afterOpen.substring(0, closePos);
      const afterQuote = afterOpen.substring(closePos + 1);
      
      // Split quote content if too long
      if (quoteContent.length > maxLength) {
        const splitContent = splitLongSentence(quoteContent, maxLength, hasCJK);
        const result = [];
        
        // First part: before quote + opening quote + first part of content
        if (beforeQuote.trim()) {
          result.push(beforeQuote + quoteChar + splitContent[0]);
        } else {
          result.push(quoteChar + splitContent[0]);
        }
        
        // Middle parts: just content
        for (let i = 1; i < splitContent.length - 1; i++) {
          result.push(splitContent[i]);
        }
        
        // Last part: last content + closing quote + after quote
        const lastPart = splitContent[splitContent.length - 1] + closeChar;
        if (afterQuote.trim()) {
          result.push(lastPart + afterQuote);
        } else {
          result.push(lastPart);
        }
        
        return result;
      } else {
        // Quote is not too long, return as-is
        return [text];
      }
    } else {
      // Quote is not closed yet - don't split
      return [text];
    }
  } else {
    // For non-CJK, use regular split
    return splitLongSentence(text, maxLength, hasCJK);
  }
}

/**
 * Process quotes to keep them together, only split if quote content is too long
 * @param {string} text - Text to process
 * @param {number} maxLength - Maximum sentence length
 * @param {boolean} hasCJK - Whether text contains CJK characters
 * @returns {string} Processed text
 */
function processQuotes(text, maxLength, hasCJK) {
  // For now, just return text as-is
  // The quote handling is done in the main splitting logic
  // This function can be extended later if needed for more complex quote processing
  return text;
}

/**
 * Split a long sentence into smaller chunks if it exceeds maxLength
 * @param {string} sentence - Sentence to split
 * @param {number} maxLength - Maximum length
 * @param {boolean} hasCJK - Whether text contains CJK characters
 * @returns {Array<string>} Array of sentence chunks
 */
function splitLongSentence(sentence, maxLength, hasCJK = false) {
  if (sentence.length <= maxLength) {
    return [sentence];
  }
  
  const chunks = [];
  let remaining = sentence;
  
  while (remaining.length > maxLength) {
    // Check if we're inside quotes - if so, don't split until quote closes
    const isInsideQuotes = checkInsideQuotes(remaining.substring(0, maxLength), hasCJK);
    
    if (isInsideQuotes && hasCJK) {
      // Find the closing quote
      const searchArea = remaining.substring(0, maxLength + 50);
      const closeSingle = searchArea.indexOf('」');
      const closeDouble = searchArea.indexOf('』');
      
      let closePos = -1;
      if (closeSingle !== -1 && closeDouble !== -1) {
        closePos = Math.min(closeSingle, closeDouble);
      } else if (closeSingle !== -1) {
        closePos = closeSingle;
      } else if (closeDouble !== -1) {
        closePos = closeDouble;
      }
      
      if (closePos !== -1) {
        // Split after closing quote
        const breakPoint = closePos + 1;
        const chunk = remaining.substring(0, breakPoint).trim();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
        remaining = remaining.substring(breakPoint).trim();
        continue;
      } else {
        // Quote not closed yet - don't split, return as-is
        chunks.push(remaining);
        remaining = '';
        break;
      }
    }
    
    // Try to find a good break point
    let breakPoint = maxLength;
    
    // Look for natural break points near maxLength
    // For CJK: look from 50% to 100% of maxLength
    // For others: look from 60% to 100% of maxLength
    const searchStart = hasCJK ? Math.floor(maxLength * 0.5) : Math.floor(maxLength * 0.6);
    const searchEnd = maxLength + (hasCJK ? 30 : 20);
    const searchStr = remaining.substring(searchStart, searchEnd);
    
    // Priority order for break points:
    // 1. Japanese/Chinese comma (、，)
    // 2. Regular comma (,)
    // 3. Space (for non-CJK)
    // 4. Period (.)
    let breakMatch = null;
    
    if (hasCJK) {
      // For CJK: prioritize comma, but avoid splitting inside quotes
      // Check if there's an opening quote before the comma
      const commaMatch = searchStr.match(/[、，]/);
      if (commaMatch) {
        const commaPos = searchStart + commaMatch.index;
        const beforeComma = remaining.substring(0, commaPos);
        // Check if there's an unclosed quote before this comma
        const openSingle = (beforeComma.match(/「/g) || []).length;
        const closeSingle = (beforeComma.match(/」/g) || []).length;
        const openDouble = (beforeComma.match(/『/g) || []).length;
        const closeDouble = (beforeComma.match(/』/g) || []).length;
        
        if (openSingle <= closeSingle && openDouble <= closeDouble) {
          // No unclosed quotes, safe to split
          breakMatch = commaMatch;
        }
      }
      
      if (!breakMatch) {
        breakMatch = searchStr.match(/[。！？]/);
      }
      if (!breakMatch) {
        breakMatch = searchStr.match(/[\s]/);
      }
    } else {
      // For non-CJK: prioritize space, then comma
      breakMatch = searchStr.match(/[\s]/);
      if (!breakMatch) {
        breakMatch = searchStr.match(/[,，]/);
      }
      if (!breakMatch) {
        breakMatch = searchStr.match(/[.!?]/);
      }
    }
    
    if (breakMatch) {
      let candidateBreakPoint = searchStart + breakMatch.index + (hasCJK && /[、，]/.test(breakMatch[0]) ? 1 : 0);
      
      // Check if break point is inside quotes - if so, find closing quote first
      if (hasCJK) {
        const beforeBreak = remaining.substring(0, candidateBreakPoint);
        const isBreakInQuotes = checkInsideQuotes(beforeBreak, hasCJK);
        
        if (isBreakInQuotes) {
          // Find closing quote after break point
          const afterBreak = remaining.substring(candidateBreakPoint);
          const closeSingle = afterBreak.indexOf('」');
          const closeDouble = afterBreak.indexOf('』');
          
          let closePos = -1;
          if (closeSingle !== -1 && closeDouble !== -1) {
            closePos = Math.min(closeSingle, closeDouble);
          } else if (closeSingle !== -1) {
            closePos = closeSingle;
          } else if (closeDouble !== -1) {
            closePos = closeDouble;
          }
          
          if (closePos !== -1) {
            // Split after closing quote
            breakPoint = candidateBreakPoint + closePos + 1;
          } else {
            // Quote not closed, don't split here - try to find next break point
            // For now, just use the candidate break point
            breakPoint = candidateBreakPoint;
          }
        } else {
          breakPoint = candidateBreakPoint;
        }
      } else {
        breakPoint = candidateBreakPoint;
      }
    } else {
      // No good break point found, split at maxLength
      breakPoint = maxLength;
    }
    
    const chunk = remaining.substring(0, breakPoint).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.substring(breakPoint).trim();
  }
  
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  
  return chunks.filter(c => c.length > 0);
}

/**
 * Format time in SRT format (HH:MM:SS,mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time
 */
function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Generate SRT content from sentences with timing
 * @param {Array<Object>} items - Array of {text, startTime, endTime, duration}
 * @returns {string} SRT content
 */
function generateSrt(items) {
  let srtContent = '';
  
  items.forEach((item, index) => {
    const startTime = formatSrtTime(item.startTime || 0);
    const endTime = formatSrtTime(item.endTime || (item.startTime + item.duration) || 0);
    
    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${item.text}\n`;
    srtContent += `\n`;
  });
  
  return srtContent;
}

/**
 * Save SRT file
 * @param {string} filePath - Path to save SRT file
 * @param {string} content - SRT content
 */
function saveSrtFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = {
  splitIntoSentences,
  formatSrtTime,
  generateSrt,
  saveSrtFile
};

