// Hindi-TTS fallback via OpenAI (`gpt-4o-mini-tts`). Used ONLY when Sarvam Bulbul is
// unavailable/erroring/out of quota for HINDI narration — Groq's TTS can't do Hindi
// at all, so OpenAI is the fallback here. The English path never routes through this.
//
// Returns a WAV Buffer in the SAME shape `synthesizeSpeech` produces, so downstream
// (combineWavBase64 chunk-stitching, disk caching) doesn't care which provider made it.
import { splitTextIntoChunks, combineWavBase64 } from './textToSpeech.js';
import { classifyProviderError } from './providerError.js';

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
          // ── READ THE PROVIDER'S ERROR BODY. Design Rule 2. ──
          //
          // The status alone is not a diagnosis. HTTP 429 from this provider means two
          // OPPOSITE things and the correct response to each is the opposite of the
          // other:
          //
          //   type: 'rate_limit_exceeded'  -> RETRYABLE. Slow down and try again.
          //   type: 'insufficient_quota'   -> TERMINAL.  The key has no credits; no
          //                                   amount of patience will ever help.
          //
          // Logging only `res.status` collapsed them, and the collapse was not free: a
          // 92-call cache-warming run was attempted against a key with a zero balance,
          // reported 92 identical "failed with status 429" lines, and looked exactly
          // like a run worth retrying. It could never have succeeded. One call reading
          // this body would have said so before the first ninety-two.
          //
          // This is the same defect as the diagram retry (Design Rule 2), one layer
          // down: a caller that discards a provider's error body cannot tell a terminal
          // state from a retryable one, and treats them identically in whichever
          // direction the code happens to lean.
          //
          // ONLY THE RESPONSE IS LOGGED, never the request. The input to this function
          // is user-facing content and, in the mentor's case, a sentence a child was
          // about to hear — it has no business in a log stream. That is the same rule
          // as "req.body is never logged" (CI invariant 5).
          // Classification lives in ONE place (utils/providerError.js). It was written
          // inline here first; by the time `groqClient` and `translateAndCache` needed
          // the same call there would have been three copies of a judgement that must
          // not disagree, which is exactly the shape `sourceScan.js` exists to prevent.
          const err = await classifyProviderError(res, `OpenAI TTS chunk ${idx}`);
          if (err.terminal) {
            console.error(`${err.summary} — TERMINAL (this will not clear on its own).`);
          } else {
            console.warn(err.summary);
          }
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
