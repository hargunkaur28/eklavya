// Consolidated Workstream A regression suite: algorithm (no Groq), security /
// error paths, and backwards compatibility with pre-change data.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {
  MIN_QUESTIONS, MAX_QUESTIONS, selectWorkingChapters, planNextRound, shouldStop, coverageOf
} from './src/utils/diagnosticEngine.js';
import { getBlueprint } from './src/config/syllabusBlueprint.js';
import { sanitizeSvg } from './src/utils/generateDiagram.js';

dotenv.config();
const API = 'http://localhost:5000/api';
const results = [];
const check = (name, pass, detail = '') => { results.push([name, pass, detail]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${name}${detail ? '  ' + detail : ''}`); };

// ── 1. Algorithm (deterministic, no network) ───────────────────────────────
function run(bp, answerFn, written = 0) {
  const mcqMin = MIN_QUESTIONS - written, mcqMax = MAX_QUESTIONS - written;
  const chapters = selectWorkingChapters(bp.chapters, mcqMax, mcqMin);
  const stats = {}; let asked = 0;
  for (;;) {
    const specs = planNextRound({ chapters, stats, askedMcq: asked, mcqMax });
    if (!specs.length) break;
    for (const { chapter, difficulty } of specs) {
      const ok = answerFn(chapter, difficulty, asked);
      const s = stats[chapter.id] || { asked: 0, correct: 0 };
      s.asked++; if (ok) s.correct++; s.lastDifficulty = difficulty; s.lastCorrect = ok;
      stats[chapter.id] = s; asked++;
    }
    if (shouldStop({ chapters, stats, askedMcq: asked, mcqMin, mcqMax })) break;
  }
  return { total: asked + written, cov: coverageOf(chapters, stats) };
}

console.log('\n── ALGORITHM ──');
const courses = [
  ['Class 10 Maths', getBlueprint('Class 10', 'Maths', '')],
  ['Class 10 Physics', getBlueprint('Class 10', 'Science', 'Physics')],
  ['Class 11 JEE', getBlueprint('Class 11', 'JEE', '')],
  ['Class 12 NEET', getBlueprint('Class 12', 'NEET', '')],
  ['Cl10 Eng Grammar', getBlueprint('Class 10', 'English', 'Grammar')]
];
const students = {
  perfect: () => true,
  wrong: () => false,
  alternating: (() => { let i = 0; return () => i++ % 2 === 0; })(),
  coinflip: (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 16) % 2 === 0; }; })()
};
let inRange = true, consistentTouchedAll = true, untouchedAlwaysReported = true, lengths = new Set();
for (const [, bp] of courses) {
  for (const [sn, fn] of Object.entries(students)) {
    for (const w of [0, 2]) {
      const r = run(bp, fn, w);
      if (r.total < MIN_QUESTIONS || r.total > MAX_QUESTIONS) inRange = false;
      // A CONSISTENT student (always right / always wrong) resolves each chapter in
      // two questions, so the budget must reach every probed chapter. An AMBIGUOUS
      // student legitimately may not: their unresolved chapters keep consuming the
      // budget, and opening a chapter we cannot afford to resolve would manufacture
      // false-confident signal from a single question. What must always hold is that
      // anything left untouched is REPORTED rather than silently assumed strong.
      if ((sn === 'perfect' || sn === 'wrong') && r.cov.untouchedChapters.length) consistentTouchedAll = false;
      if (r.cov.touched + r.cov.untouchedChapters.length !== r.cov.total) untouchedAlwaysReported = false;
      lengths.add(r.total);
    }
  }
}
check('question count always within [8,20]', inRange);
check('consistent student reaches every probed chapter', consistentTouchedAll);
check('untouched chapters are always reported, never assumed strong', untouchedAlwaysReported);
check('students get different question counts', lengths.size > 1, `observed: ${[...lengths].sort((a, b) => a - b).join(', ')}`);

const mathsBp = getBlueprint('Class 10', 'Maths', '');
const perfect = run(mathsBp, () => true, 0);
check('consistent student sweeps wide', perfect.cov.resolved === perfect.cov.total,
  `${perfect.cov.resolved}/${perfect.cov.total} chapters resolved in ${perfect.total} questions`);
const flip = run(mathsBp, students.coinflip, 0);
check('ambiguous student goes deep (fewer resolved)', flip.cov.resolved < perfect.cov.resolved,
  `${flip.cov.resolved}/${flip.cov.total} resolved`);

const a = JSON.stringify(run(mathsBp, () => true, 0));
const b = JSON.stringify(run(mathsBp, () => true, 0));
check('same answers produce the same test (deterministic)', a === b);
const p1 = selectWorkingChapters(mathsBp.chapters, 20, 8).map(c => c.id).join(',');
const p2 = selectWorkingChapters(mathsBp.chapters, 20, 8).map(c => c.id).join(',');
check('probe chapters stable across sessions (no randomness)', p1 === p2);
check('probe set is a spread, not the first N',
  p1.split(',').length > 4 && p1.includes('probability') && p1.includes('real-numbers'),
  `${p1.split(',').length} chapters spanning first..last`);

// ── 2. SVG sanitiser ───────────────────────────────────────────────────────
console.log('\n── SVG SANITISER ──');
const DANGER = /<\s*(script|foreignObject|image|use|animate|set|iframe|a)\b|\son[a-z]+\s*=|javascript\s*:|xlink:href|href\s*=|url\s*\(/i;
const attacks = [
  ['<svg viewBox="0 0 9 9"><script>alert(1)</script><circle cx="1" cy="1" r="1"/></svg>', 'strip'],
  ['<svg viewBox="0 0 9 9" onload="alert(1)"><circle cx="1" cy="1" r="1"/></svg>', 'strip'],
  ['<svg viewBox="0 0 9 9"><foreignObject><script>x</script></foreignObject><line x1="0" y1="0" x2="9" y2="9"/></svg>', 'strip'],
  ['<svg viewBox="0 0 9 9"><image href="https://evil.test/x.png"/><circle cx="1" cy="1" r="1"/></svg>', 'strip'],
  ['<svg width="9" height="9"><circle cx="1" cy="1" r="1"/></svg>', 'reject'],
  ['<svg viewBox="0 0 9 9"><script>alert(1)</script></svg>', 'reject']
];
let svgOk = true;
for (const [svg, mode] of attacks) {
  const out = sanitizeSvg(svg);
  const ok = mode === 'reject' ? !out : (!out || !DANGER.test(out));
  if (!ok) svgOk = false;
}
check('SVG attack vectors neutralised (script/onload/foreignObject/image, no-viewBox, empty)', svgOk);

// ── 3. API security & error paths ──────────────────────────────────────────
console.log('\n── API ──');
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const mk = async (n) => (await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: n, email: `${n}.${Date.now()}@t.test`, password: 'TestPass1!' }) })).body.token;
const tokA = await mk('regA'), tokB = await mk('regB');

const gen = await j('/diagnostic/generate?lang=en', { method: 'POST', body: JSON.stringify({ grade: 'Class 10', subject: 'Maths' }) }, tokA);
check('generate returns round 1', gen.status === 200, `${gen.body.questions?.length} questions`);
check('answer key withheld from client', !JSON.stringify(gen.body).includes('correctIndex'));
check('coverage reported in progress', typeof gen.body.progress?.coverage?.total === 'number',
  `touched ${gen.body.progress?.coverage?.touched}/${gen.body.progress?.coverage?.total}`);
const sid = gen.body.quizSessionId;

const tr = await j(`/diagnostic/session/${sid}/translate`, { method: 'POST' }, tokA);
const trText = tr.body.translatedHindiQuestions?.[0]?.questionText || '';
const devanagari = /[ऀ-ॿ]/.test(trText);
// The endpoint must respond and return one entry per served question. Whether the
// text is actually Devanagari depends on Sarvam credit / Groq quota — the
// documented fallback chain degrades to English rather than failing, so a
// degraded translation is reported, not treated as a code regression.
check('mid-quiz session translate responds, index-aligned',
  tr.status === 200 && tr.body.translatedHindiQuestions?.length === gen.body.questions.length,
  devanagari ? '(Devanagari OK)' : '(DEGRADED to English — Sarvam 402 / Groq 429, see PRODUCTION_CHECKLIST)');
check('cross-student session read blocked', (await j(`/diagnostic/session/${sid}/translate`, { method: 'POST' }, tokB)).status === 404);
check('unauthenticated generate blocked', (await j('/diagnostic/generate', { method: 'POST', body: JSON.stringify({ grade: 'Class 10', subject: 'Maths' }) })).status === 401);
check('invalid sub-subject rejected', (await j('/diagnostic/generate', { method: 'POST', body: JSON.stringify({ grade: 'Class 10', subject: 'Science', subSubject: 'Astrology' }) }, tokA)).status === 400);
check('submit without answers rejected', (await j('/diagnostic/submit', { method: 'POST', body: JSON.stringify({ quizSessionId: sid, round: 1 }) }, tokA)).status === 400);
check('submit without round rejected', (await j('/diagnostic/submit', { method: 'POST', body: JSON.stringify({ quizSessionId: sid, answers: [] }) }, tokA)).status === 400);
check('unknown session rejected', (await j('/diagnostic/submit', { method: 'POST', body: JSON.stringify({ quizSessionId: '000000000000000000000000', answers: [], round: 1 }) }, tokA)).status === 410);

const ans = gen.body.questions.map(q => ({ questionText: q.questionText, selectedIndex: 0 }));
const s1 = await j('/diagnostic/submit', { method: 'POST', body: JSON.stringify({ quizSessionId: sid, answers: ans, round: gen.body.progress.round }) }, tokA);
check('round submit accepted', s1.status === 200 && s1.body.status === 'continue');
const s2 = await j('/diagnostic/submit', { method: 'POST', body: JSON.stringify({ quizSessionId: sid, answers: ans, round: gen.body.progress.round }) }, tokA);
check('stale round replay rejected (409)', s2.status === 409);

// ── 4. Backwards compatibility with pre-change data ────────────────────────
console.log('\n── BACKWARDS COMPATIBILITY ──');
await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(tokA.split('.')[1], 'base64').toString()).userId);
const legacy = await mongoose.connection.collection('diagnosticresults').insertOne({
  userId, grade: 'Class 10', subject: 'Science',
  questions: [
    { questionText: 'The functional unit of the kidney is called:', options: ['neuron', 'nephron', 'alveolus', 'villus'], selectedIndex: 1, correctIndex: 1, isCorrect: true, topic: 'Life Processes', explanation: 'The nephron.' },
    { questionText: 'The image formed by a plane mirror is always:', options: ['real and inverted', 'virtual and erect', 'real and enlarged', 'virtual and diminished'], selectedIndex: 0, correctIndex: 1, isCorrect: false, topic: 'Light & Optics', explanation: 'Virtual and erect.' }
  ],
  weakTopics: ['Light & Optics'], strongTopics: ['Life Processes'],
  recommendation: 'Focus on Light & Optics.', score: 1, totalQuestions: 2, createdAt: new Date()
});
const lid = legacy.insertedId.toString();
const lg = await j(`/diagnostic/${lid}`, {}, tokA);
check('legacy (pre-change) result still loads', lg.status === 200 && lg.body.questions?.length === 2);
check('legacy result gains no fabricated diagram', !lg.body.questions?.[0]?.diagram?.svg);
check('legacy result still translates', (await j(`/diagnostic/${lid}/translate`, { method: 'POST' }, tokA)).status === 200);
const rm = await j('/roadmap/generate', { method: 'POST', body: JSON.stringify({ diagnosticResultId: lid, grade: 'Class 10', subject: 'Science', weakTopics: lg.body.weakTopics }) }, tokA);
check('roadmap still generates from a legacy result', rm.status === 201 || rm.status === 200);
await mongoose.connection.collection('diagnosticresults').deleteOne({ _id: legacy.insertedId });
await mongoose.disconnect();

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
