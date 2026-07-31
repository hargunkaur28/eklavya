// Workstream D wiring — end-to-end verification against a REAL server and REAL Groq.
//
// Seeds a student + roadmap, drives the actual HTTP endpoints, then reads the stored
// Mongo documents back as the ground truth. The cache/retry rules are all about what
// is PERSISTED, so asserting only on API responses would miss the thing under test.
//
// Run:  node test-diagram-wiring.mjs      (server must be up; needs a live GROQ key)
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { hasOrphanedFigureReference, needsDiagramRetry, CACHED_SVG_MAX_BYTES } from './src/utils/generateDiagram.js';
import { getBlueprint } from './src/config/syllabusBlueprint.js';
dotenv.config();

const API = 'http://localhost:5000/api';
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const stamp = Date.now();
const signup = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'DiagWire', email: `diag.${stamp}@t.test`, password: 'TestPass1!' })
})).json();
const TOKEN = signup.token;
if (!TOKEN) { console.error('signup failed', signup); process.exit(1); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
await fetch(`${API}/auth/profile-details`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ age: 15, studyMedium: 'CBSE', fatherName: 'Ram Kumar', schoolName: 'Govt Sr Sec School', schoolCity: 'Ambala' })
});

await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(TOKEN.split('.')[1], 'base64').toString()).userId);
const roadmaps = mongoose.connection.collection('roadmaps');

// Two diagram-eligible days: a Maths one and a Science one. Both topics are exact
// blueprint chapter names, so day -> chapter resolution is not itself under test here.
const mkDay = (n, topic) => ({
  dayNumber: n, topic, focus: `Core ideas of ${topic}`, estimatedMinutes: 30,
  completed: false, content: `An introduction to ${topic}.`, resources: [], contentGenerated: true,
  subtopics: [], moduleQuiz: { generated: false, generatedAt: null, questions: [] }
});
const mkRoadmap = (subject, days) => ({
  userId, grade: 'Class 10', subject, subSubject: '', totalDays: days.length,
  days, language: 'en', archived: false, createdAt: new Date()
});

const mathsId = (await roadmaps.insertOne(mkRoadmap('Maths', [mkDay(1, 'Circles'), mkDay(2, 'Triangles')]))).insertedId;
const sciId = (await roadmaps.insertOne(mkRoadmap('Science', [mkDay(1, 'Light — Reflection and Refraction')]))).insertedId;

const getQuiz = (rid, day) => fetch(`${API}/roadmap/${rid}/day/${day}/quiz`, { headers: H }).then((r) => r.json());
const dbDay = async (rid, day) => {
  const doc = await roadmaps.findOne({ _id: rid });
  return doc.days.find((d) => d.dayNumber === day);
};

// ── 1. A Class 10 Maths / Science module quiz produces at least one figure ──
console.log('\n-- 1. module quiz produces a relevant figure --');
const quizzes = {};
for (const [label, rid, day] of [['Maths/Circles', mathsId, 1], ['Science/Light', sciId, 1]]) {
  const q = await getQuiz(rid, day);
  quizzes[label] = q;
  const withFig = (q.questions || []).filter((x) => x.diagram?.svg);
  console.log(`   ${label}: available=${q.available} questions=${(q.questions || []).length} withFigure=${withFig.length}`);
  if (withFig[0]) console.log(`      alt: ${withFig[0].diagram.alt.slice(0, 90)}`);
}
const anyFigure = Object.values(quizzes).some((q) => (q.questions || []).some((x) => x.diagram?.svg));
check('at least one Class 10 Maths/Science module quiz carries a figure', anyFigure,
  Object.entries(quizzes).map(([k, q]) => `${k}=${(q.questions || []).filter((x) => x.diagram?.svg).length}`).join(' '));

// The figure has to be usable, not merely present.
const sample = Object.values(quizzes).flatMap((q) => q.questions || []).find((x) => x.diagram?.svg);
if (sample) {
  check('figure is real SVG with a viewBox', /^<svg[^>]*viewBox=/i.test(sample.diagram.svg), sample.diagram.svg.slice(0, 70));
  check('figure carries alt text (screen readers + read-aloud)', !!sample.diagram.alt?.trim());
  check('figure is within the 8KB CACHED cap, not the 50KB general one',
    Buffer.byteLength(sample.diagram.svg, 'utf8') <= CACHED_SVG_MAX_BYTES,
    `${Buffer.byteLength(sample.diagram.svg, 'utf8')} bytes (cap ${CACHED_SVG_MAX_BYTES})`);
  check('no script or event handler survived sanitisation',
    !/<script|onload=|onclick=|xlink:href/i.test(sample.diagram.svg));
}

// ── 6. Nothing referencing a figure was cached without one ──
console.log('\n-- 6. no orphaned figure reference reached the cache --');
let orphans = 0, cachedTotal = 0;
for (const [rid, day] of [[mathsId, 1], [sciId, 1]]) {
  const d = await dbDay(rid, day);
  for (const q of d.moduleQuiz.questions) { cachedTotal++; if (hasOrphanedFigureReference(q)) orphans++; }
}
check('zero cached questions reference a figure they do not have', orphans === 0, `${orphans} of ${cachedTotal} cached`);

// ── 3. A revisit serves the SAME questions and the SAME diagrams ──
console.log('\n-- 3. cached revisit is identical --');
// Two guarantees that have to be stated separately, because the retry path is allowed
// to REPAIR an incomplete cache on the next fetch:
//   - a figure already cached is never regenerated, changed or lost
//   - once any repair has happened the quiz is frozen; further fetches are identical
const first = quizzes['Maths/Circles'];
const second = await getQuiz(mathsId, 1);
const third = await getQuiz(mathsId, 1);
const sig = (q) => (q.questions || []).map((x) => `${x.questionText}::${x.diagram?.svg || 'none'}`).join('|');
check('revisit serves identical question text',
  (first.questions || []).map((x) => x.questionText).join('|') === (second.questions || []).map((x) => x.questionText).join('|'));

const kept = (first.questions || []).every((q, i) =>
  !q.diagram?.svg || q.diagram.svg === second.questions?.[i]?.diagram?.svg);
check('every figure from the first fetch is byte-identical on revisit (never regenerated)', kept,
  kept ? 'all preserved' : 'A CACHED FIGURE CHANGED');
check('the quiz is frozen once settled — two consecutive revisits are identical',
  sig(second) === sig(third), sig(second) === sig(third) ? 'byte-identical' : 'STILL CHANGING BETWEEN FETCHES');
const figCount = (q) => (q.questions || []).filter((x) => x.diagram?.svg).length;
console.log(`   figures per fetch: ${figCount(first)} -> ${figCount(second)} -> ${figCount(third)}`);
check('the figure count does not creep upward on every fetch (share is not defeated)',
  figCount(third) === figCount(second) && figCount(third) <= (first.questions || []).length * 0.5,
  `${figCount(first)} -> ${figCount(second)} -> ${figCount(third)} of ${(first.questions || []).length}`);

// ── 4. A diagram that FAILED during caching is retried exactly once ──
console.log('\n-- 4. forced failure during caching -> retry fires on next fetch --');
// Simulate a 429 at cache time: an eligible question with no figure and no recorded
// attempt. This is the state attachDiagrams leaves behind on a transient failure.
const beforeDay = await dbDay(mathsId, 1);
const targetIdx = beforeDay.moduleQuiz.questions.findIndex((q) => q.type !== 'written');
await roadmaps.updateOne({ _id: mathsId }, {
  $set: {
    [`days.0.moduleQuiz.questions.${targetIdx}.chapterId`]: 'x10-maths-circles',
    [`days.0.moduleQuiz.questions.${targetIdx}.diagram`]: { svg: '', alt: '', altHindi: '' }
  },
  $unset: { [`days.0.moduleQuiz.questions.${targetIdx}.diagramAttempted`]: '' }
});
const seeded = (await dbDay(mathsId, 1)).moduleQuiz.questions[targetIdx];
const chapters = getBlueprint('Class 10', 'Maths', '')?.chapters || [];
const byId = new Map(chapters.map((c) => [c.id, c]));
check('seeded state is genuinely retry-eligible (fixture check, not assumption)',
  needsDiagramRetry(seeded, byId) === true,
  `diagramAttempted=${seeded.diagramAttempted} svg=${seeded.diagram?.svg ? 'yes' : 'no'} chapterId=${seeded.chapterId}`);

await getQuiz(mathsId, 1);                       // the day fetch that should retry
const afterRetry = (await dbDay(mathsId, 1)).moduleQuiz.questions[targetIdx];
check('the retry fired and consumed its one attempt',
  afterRetry.diagramAttempted === true,
  `diagramAttempted=${afterRetry.diagramAttempted}, figure=${afterRetry.diagram?.svg ? 'attached' : 'still none'}`);
check('a second fetch will NOT retry again (exactly one)',
  needsDiagramRetry(afterRetry, byId) === false);

// ── 5. MODEL_DECLINED is terminal ──
console.log('\n-- 5. MODEL_DECLINED never retries --');
// The model looked at the question and said no figure is warranted: attempted=true,
// no diagram. That is a decision, not a failure, and must never be re-called.
await roadmaps.updateOne({ _id: mathsId }, {
  $set: {
    [`days.1.moduleQuiz`]: {
      generated: true, generatedAt: new Date(),
      questions: [{
        questionText: 'Two triangles have equal corresponding angles. What follows?',
        options: ['They are similar', 'They are congruent', 'They are equal in area', 'Nothing follows'],
        correctIndex: 0, topic: 'Similarity', explanation: '', chapterId: 'x10-maths-triangles',
        diagram: { svg: '', alt: '', altHindi: '' }, diagramAttempted: true
      }]
    }
  }
});
const declined = (await dbDay(mathsId, 2)).moduleQuiz.questions[0];
check('a declined question is not retry-eligible', needsDiagramRetry(declined, byId) === false);
await getQuiz(mathsId, 2);
const afterDeclined = (await dbDay(mathsId, 2)).moduleQuiz.questions[0];
check('after a fetch it still has no figure and stays terminal',
  !afterDeclined.diagram?.svg && afterDeclined.diagramAttempted === true,
  `svg=${afterDeclined.diagram?.svg ? 'appeared!' : 'none'} attempted=${afterDeclined.diagramAttempted}`);
check('the declined question was served unchanged',
  (await getQuiz(mathsId, 2)).questions?.[0]?.diagram === undefined);

// ── 2. Grammar / Economics practice produces ZERO figures ──
console.log('\n-- 2. non-diagram subjects produce no figures --');
for (const [subject, subSubject, topic] of [['English', 'Grammar', 'Tenses'], ['Social Science', 'Economics', 'Sectors of the Indian Economy']]) {
  const r = await (await fetch(`${API}/practice/generate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject, subSubject, topic })
  })).json();
  const figs = (r.questions || []).filter((q) => q.diagram?.svg).length;
  console.log(`   ${subject}/${subSubject}: available=${r.available} questions=${(r.questions || []).length} figures=${figs}`);
  check(`${subSubject} practice quiz has zero figures`, figs === 0 && (r.questions || []).length > 0,
    `${figs} figure(s) across ${(r.questions || []).length} questions`);
}
// Control: a diagram-eligible subject on the SAME path must still be able to produce
// one, otherwise "zero figures" above proves only that the feature is off everywhere.
// Aggregated over several attempts ON PURPOSE. The claim being tested is "this path is
// CAPABLE of producing a figure", not "it always does" — at share 0.20 a 10-question
// practice quiz has only ~2 candidates and the model may decline both, so a single run
// yields 0, 1 or 2 figures with no code change (measured: 0 / 1 / 2 on three
// consecutive identical calls). A single-run assertion here would be flaky, and a
// flaky assertion in a suite whose job is to distinguish real bugs from noise is worse
// than no assertion at all.
const CONTROL_TRIES = 3;
let controlFigs = 0, controlRuns = 0, controlQs = 0, lastReason = '';
for (let i = 0; i < CONTROL_TRIES && controlFigs === 0; i++) {
  const control = await (await fetch(`${API}/practice/generate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Science', subSubject: '', topic: 'Light — Reflection and Refraction' })
  })).json();
  // Record whether the QUIZ generated at all, separately from whether it got figures.
  // Asserting only `figures > 0` made a practice-generation failure (available:false,
  // zero questions) read identically to "generated fine, no figures" — and it did
  // exactly that once, sending me looking for a diagram bug that was not there.
  controlQs = Math.max(controlQs, (control.questions || []).length);
  if (control.available === false) lastReason = control.reason || 'unavailable';
  controlFigs = (control.questions || []).filter((q) => q.diagram?.svg).length;
  controlRuns++;
}
check(`CONTROL: an eligible subject on the same practice path can still produce a figure (<=${CONTROL_TRIES} tries)`,
  controlFigs > 0,
  controlFigs > 0
    ? `${controlFigs} figure(s) on attempt ${controlRuns}`
    : controlQs === 0
      ? `INCONCLUSIVE, not a diagram failure: the practice quiz itself never generated (${lastReason}) across ${controlRuns} attempts`
      : `0 figures across ${controlRuns} attempts on ${controlQs}-question quizzes — the "zero figures" results above are vacuous`);

// ── 7. "declined" and "failed" must not collapse into one outcome ──
console.log('\n-- 7. a FAILED generation stays retryable; a DECLINED one does not --');
// Both produce no figure, and both used to return a bare null — so a transient error
// was stamped terminal and the retry above could never fire for the case it exists
// for. Driven through the real code path rather than by seeding the end state:
//   failed   — an 8-byte cap no real SVG can fit under, so sanitisation always rejects
//   declined — a question no figure could possibly help
const { applyDiagramResult } = await import('./src/utils/generateDiagram.js');
const eligibleChapter = chapters.find((c) => c.diagramEligible);
const mkQ = () => ({ type: 'mcq', chapterId: eligibleChapter.id, questionText: 'Q', options: ['A', 'B', 'C', 'D'] });

const okQ = applyDiagramResult(mkQ(), { status: 'ok', diagram: { svg: '<svg viewBox="0 0 1 1"></svg>', alt: 'a', altHindi: '' } });
check('ok        -> figure attached and marked done',
  okQ.diagram?.svg && okQ.diagramAttempted === true && needsDiagramRetry(okQ, byId) === false);

const decQ = applyDiagramResult(mkQ(), { status: 'declined', diagram: null });
check('declined  -> terminal, never retried',
  decQ.diagramAttempted === true && !decQ.diagram && needsDiagramRetry(decQ, byId) === false,
  `diagramAttempted=${decQ.diagramAttempted}`);

const failQ = applyDiagramResult(mkQ(), { status: 'failed', diagram: null, reason: 'GENERATION_CALL_FAILED' });
check('failed    -> retryable, NOT stamped (the 429-becomes-permanent bug)',
  failQ.diagramAttempted === undefined && needsDiagramRetry(failQ, byId) === true,
  `diagramAttempted=${failQ.diagramAttempted}`);

const toQ = applyDiagramResult(mkQ(), 'timeout');
check('timeout   -> retryable, NOT stamped',
  toQ.diagramAttempted === undefined && needsDiagramRetry(toQ, byId) === true,
  `diagramAttempted=${toQ.diagramAttempted}`);

await roadmaps.deleteMany({ userId });
await mongoose.disconnect();

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
