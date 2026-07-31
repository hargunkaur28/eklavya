// Workstream G — does the pinned termbase actually fix the two failures?
//
// The two errors that survived the register fix were NOT fluency problems:
//   "concave mirror" → वक्र दर्पण   (NCERT decides this: अवतल दर्पण)
//   "playing audio"  → खेलने        (खेलना is play-a-game; audio is चलाना)
// Neither improves on a bigger model. A glossary is deterministic, so unlike the rest
// of this build's measurements it should hold across a substrate change.
import dotenv from 'dotenv';
import { callGroqChat } from './src/utils/groqClient.js';
import { HINDI_REGISTER_RULES, maskMath, unmaskMath } from './src/utils/translateAndCache.js';
import { glossaryPromptBlock, glossaryFor } from './src/config/hindiGlossary.js';
dotenv.config();

const CASES = [
  { en: 'The above statement is true only for a concave mirror.', expect: 'अवतल दर्पण', avoid: ['वक्र दर्पण'] },
  { en: 'Please wait a moment before playing more audio.', expect: 'चला', avoid: ['खेल'] },
  { en: 'A convex lens forms an image at the focus.', expect: 'उत्तल लेंस', avoid: [] },
  { en: 'The angle of incidence equals the angle of reflection.', expect: 'परावर्तन', avoid: [] },
  { en: 'Electric current flows through the conductor.', expect: 'विद्युत धारा', avoid: ['वर्तमान'] },
  { en: 'Find the mean of the values given in the table.', expect: 'माध्य', avoid: ['मतलब'] },
  { en: 'Find the root of the quadratic equation.', expect: 'मूल', avoid: ['जड़'] },
  { en: 'The cell uses energy during photosynthesis.', expect: 'प्रकाश संश्लेषण', avoid: [] },
  { en: 'Draw a tangent to the circle at the given point.', expect: 'स्पर्श रेखा', avoid: [] },
  { en: 'A right angle measures 90 degrees.', expect: 'समकोण', avoid: [] }
];

const run = async (text, withGlossary) => {
  const { masked, map } = maskMath(text);
  const sys = HINDI_REGISTER_RULES + (withGlossary ? glossaryPromptBlock(masked) : '');
  const out = await callGroqChat(
    [{ role: 'system', content: sys }, { role: 'user', content: masked }],
    { temperature: 0.2 }
  );
  return unmaskMath((out || '').trim().replace(/\s+/g, ' '), map);
};

let pass = 0;
console.log('Hindi glossary — without vs with the pinned termbase (Groq path; Sarvam unfunded)\n');
for (const c of CASES) {
  let without = '(failed)', withG = '(failed)';
  try { without = await run(c.en, false); } catch (e) { without = `(failed: ${e.message.slice(0, 30)})`; }
  try { withG = await run(c.en, true); } catch (e) { withG = `(failed: ${e.message.slice(0, 30)})`; }
  const ok = withG.includes(c.expect) && !c.avoid.some((w) => withG.includes(w));
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${c.en}`);
  console.log(`   terms   : ${JSON.stringify(glossaryFor(c.en).map((t) => t.en))}`);
  console.log(`   WITHOUT : ${without}`);
  console.log(`   WITH    : ${withG}`);
  console.log(`   expect "${c.expect}"${c.avoid.length ? `, avoid ${JSON.stringify(c.avoid)}` : ''}\n`);
}
console.log(`${pass}/${CASES.length} glossary terms landed correctly`);
if (pass < CASES.length) process.exit(1);
