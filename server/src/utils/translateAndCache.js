import { callGroqChat } from './groqClient.js';
import { classifyProviderError } from './providerError.js';
import { glossaryPromptBlock } from '../config/hindiGlossary.js';

// ── Workstream G: Hindi must be SPOKEN Hindi, not शुद्ध हिंदी ────────────────
//
// The complaint was never the technical vocabulary. A student who has read the NCERT
// Hindi textbook knows कोशिका and प्रकाश संश्लेषण perfectly well. What made the
// narration unusable was the CONNECTIVE TISSUE around those terms — निम्नलिखित,
// उपरोक्त, अभिकथन, तत्पश्चात — textbook-formal register wrapped around words the
// student already knew. And this text is HEARD, not read, so long literary sentences
// are harder still.
//
// Bump this when the register rules below change. Cached Hindi is stored alongside its
// English original, so changing the prompt does NOT retranslate anything already
// cached: the fix would appear to work on new content and do nothing on old, which
// reads as an intermittent bug rather than a stale cache. Callers compare the stored
// version against this and retranslate when it is lower.
export const TRANSLATION_REGISTER_VERSION = 2;

// Sarvam's translate endpoint takes a register hint. It was set to 'formal', which is
// precisely the register being complained about.
//
// UNVERIFIED — Sarvam is out of credits (HTTP 402), so this value has NEVER been
// exercised against the live API. It is written from the documented option set and
// must be confirmed once the key is funded; if Sarvam rejects it the request fails and
// the Groq fallback below serves the translation, so a wrong value degrades rather
// than breaks. Do NOT claim register parity between the two providers on the strength
// of this constant — only the Groq path has actually been run.
/**
 * Should this cached Hindi be thrown away and retranslated?
 *
 * True when it was never translated, or when it was translated under an OLDER register
 * version. `undefined` is deliberately treated as stale: every translation cached
 * before this field existed was produced by the formal-register prompt.
 */
export function hindiIsStale(doc) {
  if (!doc) return false;
  if (!doc.hindiTranslated) return true;
  return (doc.hindiRegisterVersion || 0) < TRANSLATION_REGISTER_VERSION;
}

export const SARVAM_TRANSLATION_MODE = 'modern-colloquial';

// ── Mathematical notation must survive translation as SYMBOLS ───────────────
// A translator handed "2x² − 5x + 3 = 0" prose-translates it into
// "2x वर्ग माइनस 5x प्लस 3 बराबर 0", which is unreadable and unspeakable. Masking
// happens HERE rather than at each call site so every surface benefits — quiz stems,
// options, explanations, lesson prose.
const MATH_TOKEN = (i) => `⟦M${i}⟧`;

// Match a WHOLE expression, not token-by-token. A first attempt grouped
// whitespace-delimited "mathy" tokens and shredded "2x² − 5x + 3 = 0" into three
// fragments (`2x² −`, `+`, `=`), because "5x" and "3" carry no operator of their own —
// and reassembly then lost the spacing too. An expression is one unit; match it as one.
const MATH_RE = /[A-Za-z0-9().,|°²³⁴√]+(?:\s*[=+\-−×÷*/^]\s*[A-Za-z0-9().,|°²³⁴√]+)+/g;

// A hyphen between words is not arithmetic. Require real evidence of maths: an equals
// sign, a superscript or root, or a digit on BOTH sides of an operator. That keeps
// "well-known" and "Class 10 - Science" out while still catching "a/b = 2" and "3 + 4".
function looksLikeMaths(expr) {
  return /=/.test(expr) || /[²³⁴√]/.test(expr) || /\d\s*[+\-−×÷*/^]\s*\d/.test(expr);
}

/** Replace mathematical expressions with opaque tokens. Returns { masked, map }. */
export function maskMath(text) {
  if (!text || typeof text !== 'string') return { masked: text, map: [] };
  const map = [];
  const masked = text.replace(MATH_RE, (m) => {
    if (!looksLikeMaths(m)) return m;
    map.push(m);
    return MATH_TOKEN(map.length - 1);
  });
  return { masked, map };
}

/** Put the original expressions back. Tolerates a model that dropped a space. */
export function unmaskMath(text, map) {
  if (!text || !map?.length) return text;
  let out = text;
  map.forEach((expr, i) => {
    out = out.split(MATH_TOKEN(i)).join(expr);
    // Some models mangle the brackets; recover the common shapes rather than leaving
    // a visible placeholder in front of a student.
    out = out.replace(new RegExp(`[\\[⟦]\\s*M\\s*${i}\\s*[\\]⟧]`, 'g'), expr);
  });
  return out;
}

// The register rules, stated once and shared by the prompt below. Written as
// INSTRUCTIONS ABOUT REGISTER, not as a glossary: swapping a few words inside the same
// formal sentence structure is not the fix — the sentences themselves have to get
// shorter and more spoken, because this text is heard.
// The register rules. FIDELITY IS STATED FIRST AND HARDEST, because the first draft
// of this prompt led with "write the way a teacher speaks in class" and the model took
// that as licence to TEACH: it answered the quiz questions instead of translating them,
// invented a whole passage plus five comprehension questions for "Read the following
// paragraph", tried (wrongly) to solve the quadratic, and rewrote "You answered 7 out
// of 10" as the student asking for help. A register instruction that loosens the task
// definition is worse than the formal register it replaces — a wrong translation is a
// wrong question in front of a student.
//
// So: fidelity constraints first, register second, and the temperature stays low.
const HINDI_REGISTER_RULES = `You are a TRANSLATOR. Translate the user's text from English into Hindi (Devanagari script).

ABSOLUTE RULES — these override everything else:
- Translate ONLY. Never answer a question, solve a problem, explain, teach, or add any information that is not in the input.
- If the input is a question, the output is that SAME question in Hindi. Do not answer it.
- If the input is an instruction (e.g. "Read the paragraph below"), translate the instruction. Do not carry it out.
- Output exactly the same information as the input — nothing added, nothing removed.
- One input sentence may become two short Hindi sentences, but no new content.

REGISTER — how to word the translation:
- Simple spoken Hindi that a 12-year-old Indian student understands. This text is READ ALOUD.
- Short, plain sentences. Avoid literary or heavily Sanskritised words.
- Everyday connectives: "नीचे दिए गए" not "निम्नलिखित"; "ऊपर" not "उपरोक्त"; "इसके बाद" not "तत्पश्चात"; "कथन" not "अभिकथन"; "जवाब" often reads better than "उत्तर".

WHAT MUST NOT CHANGE:
- Technical terms keep their NCERT Hindi textbook form (कोशिका, प्रकाश संश्लेषण, अपवर्तन). Do not invent a more Sanskritised alternative.
- English words Indian students actually say stay as they are: graph, energy, current, cell, focus, angle, ratio.
- A placeholder like ⟦M0⟧ is a mathematical expression. Copy it through EXACTLY and unchanged. Never translate, expand, solve or reword it.

Return ONLY the Hindi translation. No commentary, no quotation marks, no working.`;

export { HINDI_REGISTER_RULES };

// ── C2: EASY HINDI FOR CLASS 5 AND BELOW ────────────────────────────────────
//
// A six-year-old and a Class 10 student need different Hindi, and the register above is
// written for the older one — "simple spoken Hindi that a 12-year-old understands" is
// still too much for a child who is learning to read.
//
// THIS IS AN ADDENDUM, APPENDED AFTER THE FIDELITY RULES — NEVER A REPLACEMENT FOR
// THEM, AND NEVER PLACED FIRST.
//
// Design Rule 13 is the whole reason for that ordering. The first draft of the register
// prompt LED with "write the way a teacher speaks in class", and the model read it as
// licence to teach: it answered the quiz questions instead of translating them, invented
// a passage plus five comprehension questions for "Read the following paragraph", tried
// (wrongly) to solve a quadratic, and rewrote a score line as the student asking for
// help. Every one of those is a wrong question in front of a student, which is strictly
// worse than a stiffly-worded right one.
//
// So this block says only HOW TO WORD a translation, never what to produce. It contains
// no instruction to explain, simplify the CONTENT, shorten the meaning, or help. The
// register comes from the instruction; the task definition is untouched above.
const PRIMARY_REGISTER_ADDENDUM = `

THIS READER IS A SMALL CHILD (about 5 to 10 years old). Keep the translation faithful — the ABSOLUTE RULES above still apply exactly — but choose the simplest possible words:
- Everyday spoken words a small child already uses at home. Never a literary or Sanskritised synonym when a common one exists.
- Very short sentences. One idea per sentence. Split a long English sentence into two or three short Hindi ones rather than using clauses.
- Use तुम, not आप.
- Do NOT add explanation, examples, or anything not present in the input. Simpler WORDING only — never simpler CONTENT.`;

/**
 * Grades whose translations use the easy register. Matches the mentor's own band.
 *
 * Written as an explicit alternation rather than `class\s*[1-5]` because that pattern
 * was mangled twice by shell escaping while being written, silently becoming
 * `classs*[1-5]` — which matched "Nursery" and "KG" but NOT "Class 1", so the easy
 * register applied to exactly the two grades that cannot enrol and to none of the
 * grades that can. Caught by asserting each grade label individually rather than
 * trusting one representative case.
 */
const PRIMARY_GRADE_LABELS = ['nursery', 'kg', 'class 1', 'class 2', 'class 3', 'class 4', 'class 5'];

export function isPrimaryGradeLabel(grade) {
  const g = String(grade || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return PRIMARY_GRADE_LABELS.includes(g);
}

/** The register rules for a grade. Identical to before when no grade is supplied. */
export function registerRulesFor(grade) {
  return isPrimaryGradeLabel(grade)
    ? HINDI_REGISTER_RULES + PRIMARY_REGISTER_ADDENDUM
    : HINDI_REGISTER_RULES;
}
// Groq AI Fallback Translator when Sarvam is out of credits or unavailable.
//
// Routed through the shared client so THIS fallback has a fallback of its own.
// It used to fetch Groq directly, which meant that when Sarvam returned 402 and
// Groq's 70b returned 429 — exactly the state a free tier ends up in — it gave up
// and the caller passed the English text through. The 8b and OpenAI tiers can both
// translate to Devanagari, so that was a self-inflicted degradation of Hindi.
async function translateWithGroqFallback(text, targetLang = 'hi', grade = '') {
  if (!text || typeof text !== 'string') return null;

  try {
    const translated = await callGroqChat(
      [
        {
          role: 'system',
          // Only the terms present in THIS string are appended. Injecting the whole
          // glossary would bury the register rules under a wall of vocabulary and cost
          // tokens on every translation in the app.
          content: registerRulesFor(grade) + glossaryPromptBlock(text)
        },
        { role: 'user', content: text }
      ],
      { temperature: 0.2 }   // low: register comes from the prompt, not from sampling drift
    );
    const out = (translated || '').trim();
    if (out && out !== text.trim()) return out;
  } catch (error) {
    console.warn('Groq translation fallback error:', error.message);
  }
  return null;
}

// Shared Sarvam Translate helper with Groq fallback, paragraph chunking, and retry logic
/**
 * @param {object} [opts]
 * @param {boolean} [opts.maskMath]
 * @param {string}  [opts.grade]  when supplied and primary, selects the easy register.
 *                                Optional and defaulted, so every existing call site
 *                                behaves EXACTLY as before.
 */
export async function translateTextWithSarvam(text, targetLang = 'hi-IN', retries = 1, opts = {}) {
  if (!text || typeof text !== 'string') return null;

  // Masking is ON by default and opted OUT per call site. Diagram alt text is the
  // exception: it feeds TTS and must stay PRONOUNCEABLE, so "PQ" wants to become पीक्यू
  // rather than being preserved as Latin letters a Hindi voice will stumble over.
  if (opts.maskMath !== false) {
    const { masked, map } = maskMath(text);
    if (map.length) {
      const translated = await translateTextWithSarvam(masked, targetLang, retries, { ...opts, maskMath: false });
      return translated ? unmaskMath(translated, map) : null;
    }
  }
  const sarvamApiKey = process.env.SARVAM_API_KEY;

  // Handle long prose by splitting by paragraphs (\n\n or \n) to comply with Sarvam / Groq length limits
  if (text.length > 300 && text.includes('\n')) {
    const lines = text.split('\n');
    const translatedLines = [];
    for (const line of lines) {
      if (line.trim().length > 0) {
        const transLine = await translateTextWithSarvam(line.trim(), targetLang, retries);
        translatedLines.push(transLine || line.trim());
      } else {
        translatedLines.push('');
      }
    }
    const joined = translatedLines.join('\n');
    if (joined && joined.trim() !== text.trim()) {
      return joined;
    }
  }

  // Try Sarvam AI first if API key is provided
  if (sarvamApiKey && sarvamApiKey !== 'sarvam_demo_key') {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch('https://api.sarvam.ai/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-subscription-key': sarvamApiKey
          },
          body: JSON.stringify({
            input: text,
            source_language_code: 'en-IN',
            target_language_code: targetLang,
            speaker_gender: 'Female',
            mode: SARVAM_TRANSLATION_MODE   // was 'formal' — the register being complained about
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.translated_text && data.translated_text.trim() !== text.trim()) {
            return data.translated_text;
          }
        } else {
          // The old line here read `(likely out of credits or rate limited)` — the code
          // naming BOTH possibilities in its own log message because it could not tell
          // them apart. That parenthetical was an admission, and the answer was sitting
          // in the response body it never read.
          //
          // This path matters more than most: it is the Hindi translation fallback, and
          // without one a single 429 passed ENGLISH straight through to a Hindi-mode
          // student. So it is the path where guessing wrong is most visible to a user,
          // and it was the one guessing hardest.
          const err = await classifyProviderError(response, 'Sarvam translate');
          console.warn(err.summary);
          if (err.terminal) {
            // Retrying an exhausted key is not caution, it is latency: every attempt
            // delays the Groq fallback that WILL work. Break to it immediately.
            console.warn('Sarvam translate: terminal (quota/billing) — not retrying; falling back to Groq.');
            break;
          }
        }
      } catch (error) {
        console.warn(`Sarvam translation attempt ${attempt + 1} failed:`, error.message);
      }
    }
  }

  // Fallback to Groq AI if Sarvam fails or is out of credits
  // `opts.grade` reaches the register selection here. Absent on every existing call
  // site, which is why the default is 'no grade' = the unchanged Class-10 register.
  const groqTranslated = await translateWithGroqFallback(text, targetLang, opts.grade);
  if (groqTranslated) {
    return groqTranslated;
  }

  return null;
}

export async function translateQuestionsArray(questions) {
  const translated = [];
  for (const q of questions) {
    const rawStem = q.questionText || q.question;
    const questionText = (await translateTextWithSarvam(rawStem)) || rawStem;
    const options = [];
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const transOpt = await translateTextWithSarvam(opt);
        options.push(transOpt || opt);
      }
    }
    const explanation = q.explanation ? ((await translateTextWithSarvam(q.explanation)) || q.explanation) : '';

    translated.push({
      questionText,
      options,
      explanation
    });
  }
  return translated;
}
