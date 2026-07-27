// Hindi-TTS fallback via OpenAI (`gpt-4o-mini-tts`). Used ONLY when Sarvam Bulbul is
// unavailable/erroring/out of quota for HINDI narration — Groq's TTS can't do Hindi
// at all, so OpenAI is the fallback here. The English path never routes through this.
//
// Returns a WAV Buffer in the SAME shape `synthesizeSpeech` produces, so downstream
// (combineWavBase64 chunk-stitching, disk caching) doesn't care which provider made it.
import { splitTextIntoChunks, combineWavBase64 } from './textToSpeech.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
// gpt-4o-mini-tts accepts up to 4096 input chars; stay well under and stitch.
const OPENAI_MAX_CHARS = 2000;

export function isOpenAiTtsConfigured() {
  const k = process.env.OPENAI_API_KEY;
  return !!k && k !== 'openai_demo_key';
}

export async function synthesizeSpeechOpenAI(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return null;
  if (!isOpenAiTtsConfigured()) {
    console.warn('OPENAI_API_KEY not set — Hindi TTS OpenAI fallback unavailable.');
    return null;
  }
  const key = process.env.OPENAI_API_KEY;

  try {
    const chunks = splitTextIntoChunks(text, OPENAI_MAX_CHARS);

    const b64Results = await Promise.all(chunks.map(async (chunk, idx) => {
      try {
        const res = await fetch(OPENAI_TTS_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini-tts',
            voice: 'nova',            // clear multilingual female voice (parallels Sarvam 'kavya')
            input: chunk,
            response_format: 'wav'    // WAV so combineWavBase64 + disk cache work unchanged
          })
        });
        if (!res.ok) {
          console.warn(`OpenAI TTS chunk ${idx} failed with status ${res.status}`);
          return null;
        }
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf).toString('base64');
      } catch (err) {
        console.warn(`OpenAI TTS chunk ${idx} fetch error:`, err.message);
        return null;
      }
    }));

    if (b64Results.some((x) => x === null)) return null; // all-or-nothing, like Sarvam

    const combined = combineWavBase64(b64Results);
    return combined ? Buffer.from(combined, 'base64') : null;
  } catch (err) {
    console.warn('synthesizeSpeechOpenAI error:', err.message);
    return null;
  }
}
