// Workstream G — show the register actually moved, don't assert it.
//
// Runs the SAME real strings through the OLD system prompt and the NEW one on the live
// Groq path, and prints them side by side. Sarvam is out of credits (402), so Groq is
// the only path that can actually be exercised — no claim is made here about Sarvam.
import dotenv from 'dotenv';
import { callGroqChat } from './src/utils/groqClient.js';
import { HINDI_REGISTER_RULES, maskMath, unmaskMath, TRANSLATION_REGISTER_VERSION } from './src/utils/translateAndCache.js';
dotenv.config();

const OLD_PROMPT = 'You are an expert Hindi educational translator. Translate the given text into clear, natural Hindi in Devanagari script. Preserve all mathematical formulas (e.g. P(A|B) = P(A and B) / P(B)). Return ONLY the translated Hindi text without any English commentary, intro, or quotation marks.';

// Real strings: quiz stems and options, lesson prose, and UI feedback.
const STRINGS = [
  { src: 'quiz stem',   en: 'Which of the following statements about the reflection of light is correct?' },
  { src: 'quiz stem',   en: 'In the given figure, the angle of incidence is 40 degrees. Find the angle of reflection.' },
  { src: 'quiz stem + MATHS', en: 'Solve the quadratic equation 2x² − 5x + 3 = 0 and hence find the value of x.' },
  { src: 'quiz stem + TECHNICAL', en: 'During photosynthesis, the cell uses light energy to convert carbon dioxide and water into glucose.' },
  { src: 'quiz option', en: 'The above statement is true only for a concave mirror.' },
  { src: 'lesson prose', en: 'Light travels in a straight line. When a ray of light strikes a smooth polished surface such as a mirror, it bounces back. This bouncing back of light is called reflection.' },
  { src: 'lesson prose', en: 'Read the following paragraph carefully and then answer the questions that follow it.' },
  { src: 'UI feedback', en: 'You answered 7 out of 10 questions correctly. Review the explanations below before you try again.' },
  { src: 'UI feedback', en: 'Please wait a moment before playing more audio.' },
  { src: 'weak-topic label', en: 'Your weak topics are listed below. Study these first.' }
];

const translate = async (systemPrompt, text, temperature) => {
  const out = await callGroqChat(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
    { temperature }
  );
  return (out || '').trim().replace(/\s+/g, ' ');
};

console.log(`Hindi register — before/after (TRANSLATION_REGISTER_VERSION = ${TRANSLATION_REGISTER_VERSION})`);
console.log('Sarvam is at HTTP 402, so every line below is the GROQ path. Sarvam is unverified.\n');

const rows = [];
for (const s of STRINGS) {
  // The new path masks maths; the old one did not, which is the point of that row.
  const { masked, map } = maskMath(s.en);
  let before = null, after = null;
  try { before = await translate(OLD_PROMPT, s.en, 0.2); } catch (e) { before = `(failed: ${e.message.slice(0, 40)})`; }
  try {
    const raw = await translate(HINDI_REGISTER_RULES, masked, 0.2);
    after = unmaskMath(raw, map);
  } catch (e) { after = `(failed: ${e.message.slice(0, 40)})`; }
  rows.push({ ...s, before, after, masked: map.length });
  console.log(`── ${s.src} ─────────────────────────────`);
  console.log(`EN     : ${s.en}`);
  if (map.length) console.log(`MASKED : ${masked}`);
  console.log(`BEFORE : ${before}`);
  console.log(`AFTER  : ${after}`);
  console.log('');
}

// Two mechanical signals, so the table is not judged on impression alone.
console.log('── signals ─────────────────────────────');
const FORMAL = ['निम्नलिखित', 'उपरोक्त', 'अभिकथन', 'तत्पश्चात', 'कृपया अवलोकन', 'प्रस्तुत'];
const count = (t, list) => list.filter((w) => (t || '').includes(w)).length;
const bFormal = rows.reduce((n, r) => n + count(r.before, FORMAL), 0);
const aFormal = rows.reduce((n, r) => n + count(r.after, FORMAL), 0);
console.log(`formal-register markers  before=${bFormal}  after=${aFormal}   (${FORMAL.join(', ')})`);

const avgSentence = (rs, k) => {
  const lens = rs.flatMap((r) => (r[k] || '').split(/[।?!]/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+/).length));
  return lens.length ? (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1) : 'n/a';
};
console.log(`avg words per sentence   before=${avgSentence(rows, 'before')}  after=${avgSentence(rows, 'after')}`);

const mathRow = rows.find((r) => r.src.includes('MATHS'));
console.log(`maths survived as symbols: ${/2x²\s*−\s*5x\s*\+\s*3\s*=\s*0/.test(mathRow?.after || '')}`);
console.log(`  after: ${mathRow?.after}`);
