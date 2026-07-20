// Shared Sarvam AI API client for chat-specific use cases (translate, TTS, STT).
//
// TECH DEBT: The TTS chunking + combineWavBase64 logic here mirrors the pattern in
// textToSpeech.js (which serves roadmap/diagnostic audio). They are deliberately
// separate to avoid refactoring working code. A bug fix in either file's chunking
// or WAV-header reconstruction MUST be checked against the other.
// See also: server/src/utils/textToSpeech.js

/**
 * Translate text via Sarvam Translate API.
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language code (e.g. 'en-IN')
 * @param {string} targetLang - Target language code (e.g. 'hi-IN')
 * @returns {Promise<string|null>} Translated text or null on failure
 */
export async function sarvamTranslate(text, sourceLang = 'en-IN', targetLang = 'hi-IN') {
  if (!text || typeof text !== 'string') return null;

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'sarvam_demo_key') {
    return null;
  }

  try {
    const response = await fetch('https://api.sarvam.ai/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': apiKey
      },
      body: JSON.stringify({
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        speaker_gender: 'Female',
        mode: 'formal'
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.translated_text && data.translated_text.trim() !== text.trim()) {
        return data.translated_text;
      }
    } else {
      console.warn(`Sarvam Translate API returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('Sarvam Translate error:', error.message);
  }

  return null;
}

// ── TTS: Text Chunking (strictly < 450 chars for Sarvam Bulbul API) ──
// TECH DEBT: This is a copy of the chunking logic in textToSpeech.js.
// Any fix here must be mirrored there, and vice versa.
function splitTextIntoChunks(text, maxLength = 450) {
  if (!text || typeof text !== 'string') return [];
  if (text.length <= maxLength) return [text];

  const sentences = text.split(/(?<=[.?!।\n])\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    let s = sentence;
    while (s.length > maxLength) {
      const sub = s.substring(0, maxLength);
      let lastBoundary = Math.max(
        sub.lastIndexOf(' '),
        sub.lastIndexOf(','),
        sub.lastIndexOf('।'),
        sub.lastIndexOf(';'),
        sub.lastIndexOf('-')
      );
      const splitAt = lastBoundary > 100 ? lastBoundary + 1 : maxLength;
      chunks.push(s.substring(0, splitAt).trim());
      s = s.substring(splitAt).trim();
    }

    if ((currentChunk + ' ' + s).length > maxLength) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = s;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + s;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ── WAV concatenation helper ──
// TECH DEBT: Mirrors combineWavBase64 in textToSpeech.js
function findDataSubchunk(buf) {
  let pos = 12;
  let fmtInfo = null;

  while (pos < buf.length - 8) {
    const subchunkId = buf.toString('ascii', pos, pos + 4);
    const subchunkSize = buf.readUInt32LE(pos + 4);

    if (subchunkId === 'fmt ') {
      fmtInfo = {
        audioFormat: buf.readUInt16LE(pos + 8),
        numChannels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        byteRate: buf.readUInt32LE(pos + 16),
        blockAlign: buf.readUInt16LE(pos + 20),
        bitsPerSample: buf.readUInt16LE(pos + 22)
      };
    } else if (subchunkId === 'data') {
      return { fmtInfo, dataOffset: pos + 8, dataSize: subchunkSize };
    }

    pos += 8 + subchunkSize;
  }

  return null;
}

function combineWavBase64(b64Array) {
  if (!b64Array || b64Array.length === 0) return null;
  if (b64Array.length === 1) return b64Array[0];

  const buffers = b64Array.map(b => Buffer.from(b, 'base64'));
  const parsedChunks = [];

  for (const buf of buffers) {
    const parsed = findDataSubchunk(buf);
    if (parsed && parsed.dataOffset) {
      parsedChunks.push({
        buf,
        fmtInfo: parsed.fmtInfo,
        pcm: buf.slice(parsed.dataOffset, parsed.dataOffset + parsed.dataSize)
      });
    }
  }

  if (parsedChunks.length === 0) return b64Array[0];

  const pcmChunks = parsedChunks.map(item => item.pcm);
  const totalPcmLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const header = Buffer.alloc(44);
  const firstHeader = parsedChunks[0].buf.slice(0, 44);
  firstHeader.copy(header);

  header.writeUInt32LE(totalPcmLength + 36, 4);
  header.writeUInt32LE(totalPcmLength, 40);

  const combinedBuffer = Buffer.concat([header, ...pcmChunks]);
  return combinedBuffer.toString('base64');
}

/**
 * Synthesize speech via Sarvam Bulbul v3 TTS API.
 * Returns base64-encoded WAV audio string (no disk I/O).
 * For chat use: input is typically short (≤500 chars), so multi-chunk is rare
 * but handled correctly via the same WAV concatenation path as textToSpeech.js.
 *
 * @param {string} text - Text to synthesize (should be ≤500 chars for chat)
 * @param {string} targetLang - 'hi-IN' or 'en-IN'
 * @returns {Promise<string|null>} Base64 WAV audio or null on failure
 */
export async function sarvamTextToSpeech(text, targetLang = 'hi-IN') {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return null;

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'sarvam_demo_key') {
    return null;
  }

  try {
    const normalizedLang = targetLang === 'hi' || targetLang === 'hi-IN' ? 'hi-IN' : 'en-IN';
    const textChunks = splitTextIntoChunks(text);

    const chunkPromises = textChunks.map(async (chunk, idx) => {
      try {
        const response = await fetch('https://api.sarvam.ai/text-to-speech', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-subscription-key': apiKey
          },
          body: JSON.stringify({
            inputs: [chunk],
            target_language_code: normalizedLang,
            speaker: 'kavya',
            model: 'bulbul:v3'
          })
        });

        if (!response.ok) {
          console.warn(`Sarvam TTS chunk ${idx} failed with status ${response.status}`);
          return null;
        }

        const data = await response.json();
        return data.audios && data.audios[0] ? data.audios[0] : null;
      } catch (err) {
        console.warn(`Sarvam TTS chunk ${idx} error:`, err.message);
        return null;
      }
    });

    const b64Results = await Promise.all(chunkPromises);
    const b64Audios = b64Results.filter(Boolean);

    if (b64Audios.length !== textChunks.length) {
      console.warn(`TTS chunk synthesis incomplete: ${b64Audios.length}/${textChunks.length}`);
      return null;
    }

    return combineWavBase64(b64Audios);
  } catch (error) {
    console.warn('sarvamTextToSpeech error:', error.message);
    return null;
  }
}

/**
 * Transcribe audio via Sarvam Speech-to-Text API (REST, synchronous).
 * Expects audio ≤30 seconds. Uses AbortController with 15s timeout to prevent
 * hung connections from holding multer's in-memory buffer indefinitely.
 *
 * @param {Buffer} audioBuffer - Raw audio file buffer (from multer memory storage)
 * @param {string} originalName - Original filename (for MIME type hint)
 * @returns {Promise<{transcript: string}|null>} Transcript or null on failure
 */
export async function sarvamSpeechToText(audioBuffer, originalName = 'audio.wav') {
  if (!audioBuffer || audioBuffer.length === 0) return null;

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey === 'sarvam_demo_key') {
    return null;
  }

  // 15-second timeout to prevent stalled Sarvam calls from holding memory
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    // Build multipart/form-data manually using native FormData (Node 18+)
    const formData = new FormData();

    // Create a Blob from the audio buffer for the file field
    const audioBlob = new Blob([audioBuffer], { type: getMimeType(originalName) });
    formData.append('file', audioBlob, originalName);
    formData.append('model', 'saaras:v3');
    formData.append('mode', 'transcribe');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey
      },
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn(`Sarvam STT API returned HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const transcript = data.transcript || data.text || null;
    return transcript ? { transcript } : null;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Sarvam STT call timed out after 15s');
    } else {
      console.warn('Sarvam STT error:', error.message);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Infer MIME type from filename extension for audio uploads.
 */
function getMimeType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const mimeMap = {
    'wav': 'audio/wav',
    'mp3': 'audio/mpeg',
    'ogg': 'audio/ogg',
    'webm': 'audio/webm',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4'
  };
  return mimeMap[ext] || 'audio/wav';
}
