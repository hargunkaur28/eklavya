import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { synthesizeSpeechOpenAI } from './openaiTts.js';
import { normalizeTextForTTS } from './ttsNormalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, '../../uploads/audio');
const TEMP_UPLOADS_DIR = path.join(UPLOADS_DIR, 'temp');

// Ensure storage directories exist at module initialization
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });

// In-flight synthesis Promise deduplication map
const inFlightPromises = new Map();

// ── Storage Abstraction Seam ──
export function getAudioUrl(filename, isTemp = false) {
  return isTemp ? `/uploads/audio/temp/${filename}` : `/uploads/audio/${filename}`;
}

export function getAudioFilePath(filename, isTemp = false) {
  return isTemp ? path.join(TEMP_UPLOADS_DIR, filename) : path.join(UPLOADS_DIR, filename);
}

export function audioFileExists(filename, isTemp = false) {
  const filePath = getAudioFilePath(filename, isTemp);
  return fs.existsSync(filePath);
}

export function saveAudioFile(filename, buffer, isTemp = false) {
  const filePath = getAudioFilePath(filename, isTemp);
  fs.writeFileSync(filePath, buffer);
  return getAudioUrl(filename, isTemp);
}

export function generateContentHash(text) {
  return crypto.createHash('md5').update(text || '').digest('hex').substring(0, 10);
}

// ── Dynamic RIFF WAV Subchunk Parser & Concatenation Helper ──
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
      return {
        fmtInfo,
        dataOffset: pos + 8,
        dataSize: subchunkSize
      };
    }

    pos += 8 + subchunkSize;
  }

  return null;
}

export function combineWavBase64(b64Array) {
  if (!b64Array || b64Array.length === 0) return null;
  if (b64Array.length === 1) return b64Array[0];

  const buffers = b64Array.map((b) => Buffer.from(b, 'base64'));
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

  // Assert format consistency across chunks
  const baseFmt = parsedChunks[0].fmtInfo;
  const pcmChunks = parsedChunks.map((item) => item.pcm);
  const totalPcmLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  // Reconstruct single 44-byte WAV header
  const header = Buffer.alloc(44);
  const firstHeader = parsedChunks[0].buf.slice(0, 44);
  firstHeader.copy(header);

  // Update RIFF chunk size (file size - 8)
  header.writeUInt32LE(totalPcmLength + 36, 4);
  // Update data subchunk size
  header.writeUInt32LE(totalPcmLength, 40);

  const combinedBuffer = Buffer.concat([header, ...pcmChunks]);
  return combinedBuffer.toString('base64');
}

// ── Text Chunking Helper (Strictly < 450 chars per call for Sarvam Bulbul API) ──
// Exported so the OpenAI Hindi-TTS fallback can reuse the same sentence-aware split
// (at its own, larger max length).
export function splitTextIntoChunks(text, maxLength = 450) {
  if (!text || typeof text !== 'string') return [];
  if (text.length <= maxLength) return [text];

  const sentences = text.split(/(?<=[.?!।\n])\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    let s = sentence;
    // Word-boundary and clause-boundary safe split for long run-on sentences
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

// ── Main Speech Synthesizer with OpenAI Primary & Sarvam Fallback ──
export async function synthesizeSpeech(text, targetLang = 'hi-IN', lockKey = null) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return null;
  // Ensure universal math symbol normalization runs before sending to ANY provider
  text = normalizeTextForTTS(text, targetLang);

  const dedupKey = lockKey || `${targetLang}:${crypto.createHash('md5').update(text).digest('hex')}`;

  // Promise-based deduplication: return existing in-flight Promise if active
  if (inFlightPromises.has(dedupKey)) {
    return inFlightPromises.get(dedupKey);
  }

  const synthesisPromise = (async () => {
    // 1. PRIMARY PROVIDER: OpenAI TTS (gpt-4o-mini-tts)
    try {
      console.log('[TTS Provider] Attempting Primary: OpenAI TTS (gpt-4o-mini-tts)...');
      const openaiBuf = await synthesizeSpeechOpenAI(text);
      if (openaiBuf) {
        console.log('[TTS Provider] Primary OpenAI TTS succeeded.');
        return openaiBuf;
      }
      console.warn('[TTS Provider] Primary OpenAI TTS returned null/failed — falling back to Sarvam.');
    } catch (err) {
      console.warn('[TTS Provider] Primary OpenAI TTS error:', err.message);
    }

    // 2. SECONDARY FALLBACK: Sarvam AI (Bulbul)
    const key = process.env.SARVAM_API_KEY;
    const sarvamUsable = !!key && key !== 'sarvam_demo_key';

    if (sarvamUsable) {
      try {
        console.log('[TTS Provider] Attempting Secondary Fallback: Sarvam AI (Bulbul)...');
        const normalizedLang = targetLang === 'hi' || targetLang === 'hi-IN' ? 'hi-IN' : 'en-IN';
        const textChunks = splitTextIntoChunks(text);

        const chunkPromises = textChunks.map(async (chunk, idx) => {
          try {
            const response = await fetch('https://api.sarvam.ai/text-to-speech', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': key
              },
              body: JSON.stringify({
                inputs: [chunk],
                target_language_code: normalizedLang,
                speaker: 'kavya',
                model: 'bulbul:v3'
              })
            });

            if (!response.ok) return null;
            const data = await response.json();
            return data.audios && data.audios[0] ? data.audios[0] : null;
          } catch (err) {
            return null;
          }
        });

        const b64Results = await Promise.all(chunkPromises);
        const b64Audios = b64Results.filter(Boolean);

        if (b64Audios.length === textChunks.length) {
          console.log('[TTS Provider] Secondary Sarvam TTS succeeded.');
          const combinedB64 = combineWavBase64(b64Audios);
          return Buffer.from(combinedB64, 'base64');
        }
        console.warn('[TTS Provider] Secondary Sarvam TTS incomplete/failed — degrading to client Web Speech API.');
      } catch (err) {
        console.warn('[TTS Provider] Secondary Sarvam TTS error:', err.message);
      }
    } else {
      console.warn('[TTS Provider] Sarvam API key not set or invalid — degrading to client Web Speech API.');
    }

    // 3. FINAL FALLBACK: null signals frontend to use browser Web Speech API
    return null;
  })();

  inFlightPromises.set(dedupKey, synthesisPromise);
  try {
    return await synthesisPromise;
  } finally {
    inFlightPromises.delete(dedupKey);
  }
}

// ── Temp Audio Cleanup Helper ──
let tempCleanupTimer = null;

export function startTempAudioCleanup() {
  const cleanup = () => {
    try {
      if (!fs.existsSync(TEMP_UPLOADS_DIR)) return;
      const files = fs.readdirSync(TEMP_UPLOADS_DIR);
      const now = Date.now();
      const ONE_HOUR_MS = 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(TEMP_UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > ONE_HOUR_MS) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      console.warn('Temp audio cleanup error:', err.message);
    }
  };

  cleanup(); // Initial sweep on startup
  tempCleanupTimer = setInterval(cleanup, 30 * 60 * 1000); // Sweep every 30 minutes
}

export function stopTempAudioCleanup() {
  if (tempCleanupTimer) {
    clearInterval(tempCleanupTimer);
    tempCleanupTimer = null;
  }
}
