// Workstream I acceptance — Previous Year Questions.
//
// The rule this whole workstream exists to enforce is that a real past-paper question
// and an AI-generated one are DIFFERENT THINGS and can never be conflated. Most of
// these checks are about that: the schema refusing the bad shapes, the API refusing
// to substitute one for the other, and the labels a student actually sees.
//
// Needs the server running and MONGODB_URI set. TEST_PORT overrides the port.
//
// Two scopes are deliberately NOT driven over HTTP here:
//   • The admin import ROUTE — this environment has no ADMIN_PASSWORD_HASH, so an
//     admin session cannot be created. Its auth gate is asserted (it must refuse a
//     student token) and the PARSE ITSELF is driven directly, which is the part
//     with the real behaviour. Set PYQ_LIVE_PARSE=1 to include the live OpenAI
//     vision parse; it costs a real API call, so it is off by default.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'node:fs';
import PastPaper from './src/models/PastPaper.js';
import PyqQuestion from './src/models/PyqQuestion.js';
import ExamAttempt, { secondsRemaining, isExpired } from './src/models/ExamAttempt.js';
import User from './src/models/User.js';
import { blueprintFor } from './src/config/examBlueprints.js';

dotenv.config();

const API = `http://localhost:${process.env.TEST_PORT || 5000}/api`;
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

// ── A student, on CBSE, in Class 10 ─────────────────────────────────────────
const email = `pyq.${Date.now()}@t.test`;
const signup = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'PYQ Test', email, password: 'TestPass1!' })
})).json();
if (!signup.token) { console.error('signup failed', signup); process.exit(1); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${signup.token}` };
const userId = signup.user.id;
await User.updateOne({ _id: userId }, { $set: { 'profile.studyMedium': 'CBSE' } });

const cleanup = [];

// ════ 1. THE SOURCE DISTINCTION IS STRUCTURAL ══════════════════════════════
{
  const reject = async (label, doc) => {
    try { await new PyqQuestion(doc).validate(); return false; } catch { return true; }
  };

  check('a question with NO source is refused',
    await reject('no source', { questionText: 'q' }));
  check('a GENERATED question carrying a year is refused',
    await reject('year', { source: 'generated', questionText: 'q', year: 2023 }));
  check('a GENERATED question carrying a board is refused',
    await reject('board', { source: 'generated', questionText: 'q', board: 'CBSE' }));
  check('a GENERATED question carrying an extracted figure is refused',
    await reject('figure', { source: 'generated', questionText: 'q', diagramUrl: 'https://x/y.png' }));
  check('a PYQ question with no paper is refused',
    await reject('no paper', { source: 'pyq', questionText: 'q', board: 'CBSE', year: 2023 }));

  let ok = true;
  try { await new PyqQuestion({ source: 'generated', questionText: 'q' }).validate(); } catch { ok = false; }
  check('a plain generated question is still valid', ok);
}

// ════ 2. A CLASS 10 SUBJECT WITH NO PAPER SAYS SO ══════════════════════════
{
  const res = await fetch(`${API}/pyq/availability?grade=Class%2010&subject=Biology`, { headers: H });
  const d = await res.json();
  check('an empty Class 10 corpus stays in PYQ mode (no silent substitution)',
    d.mode === 'pyq' && d.paperCount === 0, `mode=${d.mode} papers=${d.paperCount}`);
  check('an empty Class 10 corpus offers no years', (d.years || []).length === 0);

  const start = await fetch(`${API}/pyq/practice/start`, {
    method: 'POST', headers: H, body: JSON.stringify({ grade: 'Class 10', subject: 'Biology' })
  });
  const sd = await start.json();
  check('practice on an empty Class 10 corpus REFUSES rather than generating',
    start.status === 404 && sd.error === 'NO_PAPERS_AVAILABLE', `HTTP ${start.status} ${sd.error}`);
}

// ════ 3. A NON-BOARD GRADE GETS EXAM-STYLE, HONESTLY, WITH NO YEARS ════════
{
  const res = await fetch(`${API}/pyq/availability?grade=Class%208&subject=Maths`, { headers: H });
  const d = await res.json();
  check('a non-board grade is exam-style mode', d.mode === 'exam-style', `mode=${d.mode}`);
  check('a non-board grade says WHY', d.reason === 'GRADE_HAS_NO_BOARD_EXAM', d.reason);
  check('a non-board grade offers NO years (nothing to filter on)', (d.years || []).length === 0);
  check('a non-board grade still gets a real blueprint', !!d.blueprint && d.blueprint.totalMarks > 0,
    d.blueprint ? `${d.blueprint.totalMarks} marks` : 'none');
}

// ════ 4. SEED A REAL PAPER, THEN CHECK WHAT STUDENTS SEE ═══════════════════
// Clear anything a previous run left behind. A suite that fails mid-way cannot run
// its teardown, and the unique index on (board, grade, subject, year, title) then
// makes EVERY later run die on a duplicate-key error at setup — a broken run that
// poisons the next one. Pre-cleaning makes the suite re-runnable after a crash.
{
  const stale = await PastPaper.find({ title: /Test Set|Draft Visibility Probe|Internal Choice Set/ }).select('_id').lean();
  if (stale.length) {
    await PyqQuestion.deleteMany({ paperId: { $in: stale.map((s) => s._id) } });
    await PastPaper.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    console.log(`(cleared ${stale.length} paper(s) left by a previous run)`);
  }
}

const paper = await PastPaper.create({
  board: 'CBSE', grade: 'Class 10', subject: 'Maths', year: 2023,
  title: 'Mathematics (Standard) — Test Set', parseStatus: 'published',
  // A realistic 10-minute sitting. Expiry and elapsed time are induced by BACKDATING
  // startedAt rather than by making the paper absurdly short — which is also the
  // more faithful test, because backdating is exactly what "the student was away"
  // looks like to the server, and it is the only input the deadline depends on.
  durationMinutes: 10,
  totalMarks: 6,
  sections: [
    { name: 'Section A', instruction: '4 questions of 1 mark each.', questionCount: 4, marksPerQuestion: 1, totalMarks: 4 },
    { name: 'Section B', instruction: '1 question of 2 marks.', questionCount: 1, marksPerQuestion: 2, totalMarks: 2 }
  ]
});
cleanup.push(() => PastPaper.deleteOne({ _id: paper._id }));

const seeded = [];
for (let i = 1; i <= 4; i += 1) {
  seeded.push({
    source: 'pyq', paperId: paper._id, board: 'CBSE', year: 2023,
    sectionName: 'Section A', questionNumber: String(i), marks: 1,
    questionText: `Section A question ${i}: what is ${i} + ${i}?`,
    options: [String(i + i), String(i), String(i * 3), String(i - 1)],
    correctIndex: 0, explanation: `Because ${i} + ${i} = ${i + i}.`
  });
}
seeded.push({
  source: 'pyq', paperId: paper._id, board: 'CBSE', year: 2023,
  sectionName: 'Section B', questionNumber: '5', marks: 2,
  questionText: 'In the figure below, PQ is a tangent. Find the radius.',
  options: [], correctIndex: null, correctAnswer: '5 cm',
  figureExpected: true,
  diagramUrl: 'https://res.cloudinary.com/demo/image/upload/c_crop,x_10,y_10,w_200,h_200/sample.png',
  diagramAlt: 'A circle with centre O and a tangent PQ touching at point T.'
});
const inserted = await PyqQuestion.insertMany(seeded);
cleanup.push(() => PyqQuestion.deleteMany({ paperId: paper._id }));

{
  const res = await fetch(`${API}/pyq/availability?grade=Class%2010&subject=Maths`, { headers: H });
  const d = await res.json();
  check('a published paper appears with its year', d.years.includes(2023), JSON.stringify(d.years));
  // Asserted against the DB rather than against the literal 1 this fixture used to be
  // the only paper for. Once real corpus papers are published, a hardcoded count fails
  // for a reason that has nothing to do with the behaviour under test — and the thing
  // actually worth checking is that the reported count is CORRECT, at any corpus size.
  const publishedHere = await PastPaper.countDocuments({
    grade: 'Class 10', subject: 'Maths', board: 'CBSE', parseStatus: 'published'
  });
  check('the paper count is shown, and matches the published corpus',
    d.paperCount === publishedHere && d.paperCount >= 1, `reported=${d.paperCount} actual=${publishedHere}`);
}

// ── Labels: this is what the student actually reads ────────────────────────
{
  const res = await fetch(`${API}/pyq/practice/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', years: [2023], count: 10 })
  });
  const d = await res.json();
  check('practice on a real corpus runs in PYQ mode', d.mode === 'pyq', d.mode);
  check('every practice question is source pyq', d.questions.every((q) => q.source === 'pyq'));
  check('a real question is labelled with board, year and question number',
    /^CBSE 2023 · Q\d+$/.test(d.questions[0].sourceLabel), d.questions[0].sourceLabel);
  check('a real question carries its year', d.questions.every((q) => q.year === 2023));
  check('the extracted figure is served as an IMAGE URL, not an SVG',
    d.questions.some((q) => q.diagramUrl && !q.diagramSvg));
  check('the answer key is NOT shipped with the questions',
    d.questions.every((q) => q.correctIndex === undefined && q.explanation === undefined));

  // Immediate per-question feedback.
  const q0 = d.questions.find((q) => q.options.length);
  const ans = await fetch(`${API}/pyq/practice/answer`, {
    method: 'POST', headers: H, body: JSON.stringify({ questionId: q0._id, selectedIndex: 0 })
  });
  const ad = await ans.json();
  check('practice grades one question at a time and returns the explanation',
    ans.ok && typeof ad.isCorrect === 'boolean' && !!ad.explanation, ad.explanation);
}

// ════ 5. EXAM MODE REPRODUCES THE PAPER'S OWN STRUCTURE ════════════════════
let attemptId;
{
  const res = await fetch(`${API}/pyq/exam/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', paperId: paper._id })
  });
  const d = await res.json();
  attemptId = d.attemptId;
  check('exam mode starts on a real paper', res.status === 201, `HTTP ${res.status}`);
  check('exam mode is labelled pyq, not exam-style', d.mode === 'pyq', d.mode);
  check("exam mode uses the PAPER'S own sections", d.paper.sections.length === 2,
    d.paper.sections.map((s) => s.name).join(', '));
  check("exam mode uses the PAPER'S own marks", d.paper.totalMarks === 6, `${d.paper.totalMarks}`);
  check('exam mode serves every question in the paper', d.questions.length === 5, `${d.questions.length}`);
  check('exam questions keep their printed section and marks',
    d.questions.filter((q) => q.sectionName === 'Section A').length === 4);

  // One active attempt per paper — a second start must not silently abandon it.
  const again = await fetch(`${API}/pyq/exam/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', paperId: paper._id })
  });
  const ad = await again.json();
  check('a second start on the same paper needs an explicit confirm',
    again.status === 409 && ad.error === 'ATTEMPT_ALREADY_IN_PROGRESS', `HTTP ${again.status}`);
}

// ════ 6. RESUME RESTORES EVERY ANSWER, AND THE CLOCK KEPT RUNNING ══════════
{
  const qs = await PyqQuestion.find({ paperId: paper._id, sectionName: 'Section A' }).lean();
  for (const q of qs.slice(0, 3)) {
    await fetch(`${API}/pyq/exam/${attemptId}/answer`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ questionId: q._id, selectedIndex: 0, sectionName: 'Section A' })
    });
  }

  // ── "Closed the browser for four minutes, came back" ────────────────────
  // Backdating startedAt is precisely what that looks like to the server: nothing
  // was sent while they were away, and the ONLY thing that changed is how much
  // wall-clock has passed since the stored start.
  const AWAY_SECONDS = 240;
  const started = await ExamAttempt.findById(attemptId);
  await ExamAttempt.updateOne({ _id: attemptId }, {
    $set: { startedAt: new Date(new Date(started.startedAt).getTime() - AWAY_SECONDS * 1000) }
  });

  const res = await fetch(`${API}/pyq/exam/${attemptId}?lang=en`, { headers: H });
  const d = await res.json();
  check('resume restores every answer already entered', d.answers?.length === 3, `${d.answers?.length}`);
  check('resume restores the selected option, not just the question',
    d.answers?.every((a) => a.selectedIndex === 0));

  const attempt = await ExamAttempt.findById(attemptId);
  const expected = attempt.durationSeconds - AWAY_SECONDS;
  // The number that matters: time kept running while the tab was shut, so the
  // student gets back ~6 minutes of a 10-minute paper, NOT a fresh 10.
  check('resume shows the TRUE remaining time, not a reset timer',
    Math.abs(d.secondsRemaining - expected) <= 3 && d.secondsRemaining < attempt.durationSeconds,
    `remaining=${d.secondsRemaining}s expected≈${expected}s full=${attempt.durationSeconds}s`);
  check('resume agrees with the server-side computation exactly',
    Math.abs(d.secondsRemaining - secondsRemaining(attempt)) <= 2,
    `client=${d.secondsRemaining} server=${secondsRemaining(attempt)}`);
}

// ════ 6b. PAUSE STOPS THE CLOCK AND STOPS THE WORK ═════════════════════════
// A learning app, so the clock can be stopped. Two properties make that a real
// pause rather than a way to make the timer meaningless:
//   • the deadline slides by exactly the paused time (verified by backdating), and
//   • answering is refused while paused, server-side.
{
  const before = await ExamAttempt.findById(attemptId).lean();
  const remainingBefore = secondsRemaining(before);

  const p = await fetch(`${API}/pyq/exam/${attemptId}/pause`, { method: 'POST', headers: H });
  const pb = await p.json();
  check('an attempt can be paused', p.ok && pb.paused === true, `HTTP ${p.status}`);

  // Simulate 3 minutes of WALL CLOCK passing while paused.
  //
  // BOTH timestamps move back, and getting this wrong is easy: pushing only
  // `pausedAt` back models "the pause began 3 minutes ago" while `now` stays put,
  // which credits 3 minutes of pause against zero minutes of elapsed time and makes
  // the remaining clock GROW. That is a broken simulation, not a broken pause — the
  // first version of this check failed for exactly that reason.
  //
  // Moving `startedAt` back too advances elapsed time by the same 3 minutes, so the
  // two cancel and remaining should be UNCHANGED, which is the actual property
  // under test.
  const AWAY = 180 * 1000;
  const paused = await ExamAttempt.findById(attemptId);
  paused.startedAt = new Date(new Date(paused.startedAt).getTime() - AWAY);
  paused.pausedAt = new Date(new Date(paused.pausedAt).getTime() - AWAY);
  await paused.save();

  const during = await ExamAttempt.findById(attemptId).lean();
  check('the clock does NOT run while paused',
    Math.abs(secondsRemaining(during) - remainingBefore) <= 2,
    `before=${remainingBefore}s after 3min paused=${secondsRemaining(during)}s`);
  check('a paused attempt can never expire', !isExpired(during));

  const q = await PyqQuestion.findOne({ paperId: paper._id }).lean();
  const blocked = await fetch(`${API}/pyq/exam/${attemptId}/answer`, {
    method: 'POST', headers: H, body: JSON.stringify({ questionId: q._id, selectedIndex: 1 })
  });
  const bb = await blocked.json();
  check('answers are REFUSED while paused (else pause is just the timer off)',
    blocked.status === 409 && bb.error === 'ATTEMPT_PAUSED', `HTTP ${blocked.status} ${bb.error}`);

  // ── Pause and exit, then come back ──────────────────────────────────────
  // Exiting is a CLIENT action — it unmounts the component and calls nothing. So the
  // thing to assert is that walking away from a paused attempt and returning finds it
  // exactly as it was: same clock, same answers, and told plainly that it is paused.
  // Asserted through the resume endpoints a returning student actually hits, because
  // reading the document directly would pass even if the routes never reported it.
  {
    // The student has "left". Time passes while they are gone — modelled the same way
    // as above, moving startedAt and pausedAt together so wall-clock advances without
    // crediting pause against zero elapsed time.
    const AWAY2 = 7 * 60 * 1000;
    const gone = await ExamAttempt.findById(attemptId);
    const clockOnLeaving = secondsRemaining(gone.toObject());
    gone.startedAt = new Date(new Date(gone.startedAt).getTime() - AWAY2);
    gone.pausedAt = new Date(new Date(gone.pausedAt).getTime() - AWAY2);
    await gone.save();

    // Coming back the way the UI does: re-request the paper, which 409s with the open
    // attempt rather than starting a second one.
    const back = await fetch(`${API}/pyq/exam/start`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', paperId: paper._id })
    });
    const bb = await back.json();
    check('returning to a paused paper offers the SAME attempt, not a new one',
      back.status === 409 && bb.error === 'ATTEMPT_ALREADY_IN_PROGRESS' && String(bb.attemptId) === String(attemptId),
      `HTTP ${back.status} ${bb.error}`);
    // Without this the resume card cannot tell a stopped clock from a running one, and
    // shows the same "N minutes left" for both.
    check('the resume offer SAYS the attempt is paused', bb.paused === true, `paused=${bb.paused}`);
    check('no time was lost while the student was away',
      Math.abs(bb.secondsRemaining - clockOnLeaving) <= 3,
      `on leaving=${clockOnLeaving}s, on return=${bb.secondsRemaining}s after 7min away`);

    // "Where they left off" is the answers, not just the clock.
    const resumed = await fetch(`${API}/pyq/exam/${attemptId}`, { headers: H });
    const rs = await resumed.json();
    const answered = rs.answers || [];
    check('the answers given before pausing are still there on return',
      resumed.ok && answered.length >= 1, `${answered.length} answered question(s) restored`);
    check('the resumed attempt is still paused, not silently restarted',
      rs.paused === true, `paused=${rs.paused}`);
  }

  // Resuming banks the paused time — the student gets those 3 minutes back, and no more.
  const r = await fetch(`${API}/pyq/exam/${attemptId}/resume`, { method: 'POST', headers: H });
  const rb = await r.json();
  check('an attempt can be resumed', r.ok && rb.paused === false, `HTTP ${r.status}`);

  const after = await ExamAttempt.findById(attemptId).lean();
  check('the paused time is banked, not forgotten', after.pausedMs >= 179000,
    `pausedMs=${Math.round(after.pausedMs / 1000)}s`);
  // Duration alone cannot distinguish one long break from twelve short ones, and
  // the results claim to report both.
  check('the number of pauses is counted', after.pauseCount === 1, `${after.pauseCount}`);
  check('resuming restores the SAME remaining time, not a fresh clock',
    Math.abs(secondsRemaining(after) - remainingBefore) <= 3,
    `before=${remainingBefore}s after resume=${secondsRemaining(after)}s`);
  check('answering works again after resume',
    (await fetch(`${API}/pyq/exam/${attemptId}/answer`, {
      method: 'POST', headers: H, body: JSON.stringify({ questionId: q._id, selectedIndex: 0 })
    })).ok);
}

// ════ 7. ANSWERS AFTER EXPIRY ARE REJECTED SERVER-SIDE ═════════════════════
{
  // Push startedAt past the deadline. The client is not consulted about expiry, so
  // this is the only thing that has to change for the exam to be over.
  //
  // The banked pause has to be subtracted out, because the deadline SLIDES by it —
  // an attempt that spent 3 minutes paused genuinely expires 3 minutes later, and a
  // fixed "10m30s ago" would no longer be past the deadline. Read from the attempt
  // rather than hardcoded, so this survives a change to the pause above.
  const beforeExpiry = await ExamAttempt.findById(attemptId).lean();
  const pastDeadlineMs = (beforeExpiry.durationSeconds * 1000) + (beforeExpiry.pausedMs || 0) + 30_000;
  await ExamAttempt.updateOne({ _id: attemptId }, {
    $set: { startedAt: new Date(Date.now() - pastDeadlineMs), pausedAt: null }
  });

  const q = await PyqQuestion.findOne({ paperId: paper._id, sectionName: 'Section A' }).lean();
  const res = await fetch(`${API}/pyq/exam/${attemptId}/answer`, {
    method: 'POST', headers: H, body: JSON.stringify({ questionId: q._id, selectedIndex: 1 })
  });
  const d = await res.json();
  check('an answer after expiry is REJECTED server-side',
    res.status === 409 && d.error === 'ATTEMPT_EXPIRED', `HTTP ${res.status} ${d.error}`);

  const after = await ExamAttempt.findById(attemptId);
  check('expiry auto-submits with whatever was answered', after.status === 'expired', after.status);
  check('the auto-submit scored the answers that WERE given', after.marksAwarded === 3,
    `${after.marksAwarded}/${after.marksAvailable}`);
  check('the late answer was not recorded', after.answers.every((a) => a.selectedIndex === 0));
}

// ════ 8. SECTION-WISE RESULTS MIRROR THE PAPER ═════════════════════════════
{
  const res = await fetch(`${API}/pyq/exam/${attemptId}/results`, { headers: H });
  const d = await res.json();
  const secA = d.results.sectionScores.find((s) => s.name === 'Section A');
  const secB = d.results.sectionScores.find((s) => s.name === 'Section B');
  check('results break down by the paper\'s own sections', !!secA && !!secB);
  check('section A scores 3/4 attempted', secA.questionsAttempted === 3 && secA.questionsTotal === 4,
    `${secA.questionsAttempted}/${secA.questionsTotal}`);
  check('a written question is shown but NOT machine-marked',
    d.results.questions.find((q) => !q.options.length)?.autoScored === false);
  check('review keeps the real-paper label', d.results.questions[0].sourceLabel.startsWith('CBSE 2023'));

  // The honesty half of pause: a strong score reached with heavy pausing must be
  // visibly not a straight sitting, so the results carry both numbers.
  check('results report how many times the paper was paused',
    d.results.pauseCount === 1, `${d.results.pauseCount}`);
  check('results report the total paused duration',
    d.results.pausedSeconds >= 179, `${d.results.pausedSeconds}s`);
  // THE property, rather than a number pulled from the air: active time plus paused
  // time must reconstruct the wall-clock the attempt was open for. The first version
  // of this check asserted `active < paused + 60`, which has no basis at all and
  // failed against perfectly correct output — the test backdates `startedAt` to force
  // expiry, so the attempt legitimately spans far longer than the pause.
  {
    const a = await ExamAttempt.findById(attemptId).lean();
    const wallSeconds = Math.round((new Date(a.finalisedAt) - new Date(a.startedAt)) / 1000);
    check('active time + paused time reconstructs the wall clock',
      Math.abs((d.results.activeSeconds + d.results.pausedSeconds) - wallSeconds) <= 2,
      `active=${d.results.activeSeconds}s + paused=${d.results.pausedSeconds}s vs wall=${wallSeconds}s`);
    check('active time EXCLUDES the pause (it is not just wall clock)',
      d.results.activeSeconds < wallSeconds,
      `active=${d.results.activeSeconds}s wall=${wallSeconds}s`);
  }
}

// ════ 8b. INTERNAL CHOICE COUNTS AND SCORES ONCE ═══════════════════════════
// A real board paper prints "31. <a> OR <b>" and says attempt only one. Two
// documents, one question, one lot of marks. Getting this wrong reports a
// 39-question/80-mark paper as 46/95 and lets a student score twice.
{
  const choicePaper = await PastPaper.create({
    board: 'CBSE', grade: 'Class 10', subject: 'Science', year: 2022,
    title: 'Science — Internal Choice Set', parseStatus: 'published',
    durationMinutes: 60, totalMarks: 8,
    sections: [{ name: 'Section A', instruction: '', questionCount: 2, marksPerQuestion: 0, totalMarks: 8 }]
  });
  const group = 'Section A|2';
  const made = await PyqQuestion.insertMany([
    { source: 'pyq', paperId: choicePaper._id, board: 'CBSE', year: 2022, sectionName: 'Section A',
      questionNumber: '1', marks: 3, questionText: 'Plain question.', options: ['a', 'b'], correctIndex: 0 },
    { source: 'pyq', paperId: choicePaper._id, board: 'CBSE', year: 2022, sectionName: 'Section A',
      questionNumber: '2', marks: 5, questionText: 'Alternative A.', options: ['a', 'b'], correctIndex: 0,
      choiceGroup: group, choiceIndex: 0 },
    { source: 'pyq', paperId: choicePaper._id, board: 'CBSE', year: 2022, sectionName: 'Section A',
      questionNumber: '2', marks: 5, questionText: 'Alternative B.', options: ['a', 'b'], correctIndex: 1,
      choiceGroup: group, choiceIndex: 1 }
  ]);

  const { countChoiceGroups, availableMarks } = await import('./src/models/PyqQuestion.js');
  check('an OR pair counts as ONE question, not two',
    countChoiceGroups(made) === 2, `${countChoiceGroups(made)} (3 documents)`);
  check('an OR pair contributes its marks ONCE',
    availableMarks(made) === 8, `${availableMarks(made)} (3 documents summing 13)`);

  const start = await fetch(`${API}/pyq/exam/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Science', paperId: choicePaper._id })
  });
  const sd = await start.json();
  check('exam serves both alternatives so the student can choose',
    sd.questions.filter((q) => q.choiceGroup).length === 2);
  check('alternatives carry their choiceIndex for the OR rendering',
    sd.questions.filter((q) => q.choiceGroup).map((q) => q.choiceIndex).sort().join(',') === '0,1');

  // Answer the PLAIN question correctly, then BOTH alternatives — the second is the
  // hand-crafted case the UI prevents, and the server must still mark only one.
  const plain = made[0]; const altA = made[1]; const altB = made[2];
  for (const [q, idx] of [[plain, 0], [altA, 1], [altB, 1]]) {
    await fetch(`${API}/pyq/exam/${sd.attemptId}/answer`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ questionId: q._id, selectedIndex: idx, sectionName: 'Section A' })
    });
  }
  const done = await fetch(`${API}/pyq/exam/${sd.attemptId}/submit`, {
    method: 'POST', headers: H, body: JSON.stringify({})
  });
  const res = (await done.json()).results;
  check('marksAvailable counts the choice group once', res.marksAvailable === 8, `${res.marksAvailable}`);
  check('the section reports 2 questions, not 3', res.sectionScores[0].questionsTotal === 2,
    `${res.sectionScores[0].questionsTotal}`);
  // Plain answered correctly = 3. Alternative A was answered WRONG (correctIndex 0,
  // chose 1); B would have been right. Marking the first attempted gives 3, not 8 —
  // answering both must not let the student harvest the better outcome.
  check('answering both alternatives marks the FIRST, not the better one',
    res.marksAwarded === 3, `${res.marksAwarded} (8 would mean the second was marked too)`);

  await PyqQuestion.deleteMany({ paperId: choicePaper._id });
  await PastPaper.deleteOne({ _id: choicePaper._id });
}

// ════ 9. OWNERSHIP: 404, NEVER 403 ═════════════════════════════════════════
{
  const other = await (await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Other', email: `pyq.other.${Date.now()}@t.test`, password: 'TestPass1!' })
  })).json();
  const res = await fetch(`${API}/pyq/exam/${attemptId}`, {
    headers: { Authorization: `Bearer ${other.token}` }
  });
  check("another student's attempt is 404, not 403 (its existence is not confirmed)",
    res.status === 404, `HTTP ${res.status}`);
  cleanup.push(() => User.deleteOne({ _id: other.user.id }));
}

// ════ 10. ADMIN IMPORT IS ADMIN-ONLY ═══════════════════════════════════════
{
  const res = await fetch(`${API}/pyq-admin/papers`, { headers: H });   // student token
  check('a student cannot reach the import console', res.status === 403, `HTTP ${res.status}`);
  const anon = await fetch(`${API}/pyq-admin/papers`);
  check('an anonymous request cannot reach the import console', anon.status === 401, `HTTP ${anon.status}`);
}

// ════ 10b. THE REVIEW SCREEN CAN ACTUALLY SEE A DRAFT ══════════════════════
//
// WHY THIS EXISTS. The suite was 56/56 while the admin console showed "no papers
// imported yet" for a paper that had imported successfully. Every check verified
// that the import WROTE correctly; not one verified that the admin could then FIND
// it. That is the blind-harness failure of Design Rule 11 — the harness observed the
// system from outside its actual mechanism (the database) instead of through the
// mechanism that matters (the HTTP route the review UI calls), so it passed
// regardless of whether the review step was reachable.
//
// The review screen exists to review DRAFTS. A draft that the admin list cannot
// return makes the entire import pipeline unusable no matter how good the parse is.
//
// Driven with a MINTED admin token: admin auth is env-configured (email + password
// hash + security code) and this environment has no ADMIN_PASSWORD_HASH, so logging
// in is impossible here. The token is signed with the app's own JWT_SECRET in the
// exact shape routes/admin.js issues ({ role:'admin', adm:true }, no userId), so it
// exercises the real middleware and the real route rather than bypassing them.
{
  const jwt = (await import('jsonwebtoken')).default;
  const adminToken = jwt.sign({ role: 'admin', adm: true }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const AH = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

  const draft = await PastPaper.create({
    board: 'CBSE', grade: 'Class 12', subject: 'Physics', year: 2019,
    title: 'Physics — Draft Visibility Probe', parseStatus: 'draft',
    durationMinutes: 180, totalMarks: 70,
    sections: [{ name: 'Section A', instruction: '', questionCount: 1, marksPerQuestion: 1, totalMarks: 1 }]
  });
  const draftQ = await PyqQuestion.create({
    source: 'pyq', paperId: draft._id, board: 'CBSE', year: 2019,
    sectionName: 'Section A', questionNumber: '1', marks: 1,
    questionText: 'Draft probe question.', options: ['a', 'b'], correctIndex: 0
  });

  const listRes = await fetch(`${API}/pyq-admin/papers`, { headers: AH });
  check('the admin paper list responds 200 to an admin', listRes.status === 200, `HTTP ${listRes.status}`);
  const list = await listRes.json();
  const found = (list.papers || []).find((p) => String(p._id) === String(draft._id));

  // THE assertion this suite was missing.
  check('an imported DRAFT appears in the admin list', !!found,
    found ? `status=${found.parseStatus}` : `${(list.papers || []).length} paper(s) returned, none matching`);
  check('the draft is returned WITH its draft status, so the UI can mark it',
    found?.parseStatus === 'draft', found?.parseStatus);
  check('the draft carries its question count for the review screen',
    found?.questionCount === 1, `${found?.questionCount}`);

  // The review screen itself must open, not just the list.
  const detail = await fetch(`${API}/pyq-admin/papers/${draft._id}`, { headers: AH });
  const detailBody = await detail.json();
  check('the review screen opens for a draft', detail.status === 200, `HTTP ${detail.status}`);
  check('the review screen returns the draft\'s questions to correct',
    detailBody.questions?.length === 1, `${detailBody.questions?.length}`);

  // ── Publish WARNS on missing figures / alt text, but does not block ─────
  // Changed from a hard gate at the operator's request. What must remain true is
  // that it is never SILENT: the first attempt refuses and reports, and the paper
  // stays a draft until an explicit confirm. A regression to "publishes quietly"
  // would put unanswerable questions in front of students with no trace.
  {
    const wq = await PyqQuestion.create({
      source: 'pyq', paperId: draft._id, board: 'CBSE', year: 2019,
      sectionName: 'Section A', questionNumber: '99', marks: 2,
      questionText: 'In the figure below, identify the part labelled X.',
      figureExpected: true            // ...and deliberately no diagramUrl
    });
    await PastPaper.updateOne({ _id: draft._id }, { $set: { parseStatus: 'draft' } });

    const first = await fetch(`${API}/pyq-admin/papers/${draft._id}/publish`, {
      method: 'POST', headers: AH, body: JSON.stringify({})
    });
    const fb = await first.json();
    check('publish without confirm REFUSES and returns warnings',
      first.status === 409 && fb.requiresConfirmation === true, `HTTP ${first.status}`);
    check('the missing-figure warning is marked high severity',
      fb.warnings?.some((w) => w.code === 'QUESTIONS_MISSING_FIGURES' && w.severity === 'high'));
    check('the warning names the offending question numbers',
      fb.warnings?.some((w) => w.questionNumbers?.includes('99')));
    check('an unconfirmed publish leaves the paper a DRAFT',
      (await PastPaper.findById(draft._id).lean()).parseStatus === 'draft');

    const second = await fetch(`${API}/pyq-admin/papers/${draft._id}/publish`, {
      method: 'POST', headers: AH, body: JSON.stringify({ confirm: true })
    });
    const sb = await second.json();
    check('a CONFIRMED publish goes through despite the warnings',
      second.status === 200 && sb.paper?.parseStatus === 'published', `HTTP ${second.status}`);
    check('what was overridden is RECORDED on the paper, not forgotten',
      sb.paper?.publishedWithWarnings?.some((w) => w.code === 'QUESTIONS_MISSING_FIGURES'),
      JSON.stringify(sb.paper?.publishedWithWarnings?.map((w) => w.code)));

    await PyqQuestion.deleteOne({ _id: wq._id });
    await PastPaper.updateOne({ _id: draft._id }, { $set: { parseStatus: 'draft', publishedWithWarnings: [] } });
  }

  // ── A fixture-titled paper cannot be published, and cannot be forced ─────
  // A "REVIEW TIMING FIXTURE" paper reached seven real accounts once. Unlike the
  // figure/alt-text warnings this is a HARD block: those are quality judgements an
  // operator may override, this is a paper labelled as a throwaway.
  {
    const fixture = await PastPaper.create({
      board: 'CBSE', grade: 'Class 12', subject: 'Chemistry', year: 2018,
      title: 'Chemistry — REVIEW TIMING FIXTURE', parseStatus: 'draft',
      durationMinutes: 180, totalMarks: 70
    });
    await PyqQuestion.create({
      source: 'pyq', paperId: fixture._id, board: 'CBSE', year: 2018,
      sectionName: 'Section A', questionNumber: '1', marks: 1,
      questionText: 'Fixture question.', options: ['a', 'b'], correctIndex: 0
    });

    const r1 = await fetch(`${API}/pyq-admin/papers/${fixture._id}/publish`, {
      method: 'POST', headers: AH, body: JSON.stringify({})
    });
    const b1 = await r1.json();
    check('a fixture-titled paper is refused at publish',
      r1.status === 409 && b1.error === 'FIXTURE_PAPER_CANNOT_BE_PUBLISHED', `HTTP ${r1.status} ${b1.error}`);

    // confirm:true clears the figure/alt warnings — it must NOT clear this one.
    const r2 = await fetch(`${API}/pyq-admin/papers/${fixture._id}/publish`, {
      method: 'POST', headers: AH, body: JSON.stringify({ confirm: true })
    });
    check('confirm:true does NOT override the fixture block',
      r2.status === 409, `HTTP ${r2.status}`);
    check('the fixture is still a draft afterwards',
      (await PastPaper.findById(fixture._id).lean()).parseStatus === 'draft');
    check('a fixture is invisible to students',
      !((await (await fetch(`${API}/pyq/availability?grade=Class%2012&subject=Chemistry`, { headers: H })).json()).papers || [])
        .some((p) => String(p._id) === String(fixture._id)));

    await PyqQuestion.deleteMany({ paperId: fixture._id });
    await PastPaper.deleteOne({ _id: fixture._id });
  }

  // ── THE COUNTERPART, asserted separately ────────────────────────────────
  // Deliberately NOT inferred from the admin filter. The admin list has no filter at
  // all, so "students cannot see drafts" is a property of a DIFFERENT query in a
  // different router, and deriving it from this one would be assuming exactly the
  // thing worth checking. Both directions have to be observed independently.
  const avail = await fetch(`${API}/pyq/availability?grade=Class%2012&subject=Physics`, { headers: H });
  const availBody = await avail.json();
  check('a DRAFT paper is invisible to students in availability',
    !(availBody.papers || []).some((p) => String(p._id) === String(draft._id)),
    `${(availBody.papers || []).length} paper(s) offered`);
  check('a DRAFT paper contributes no year to the student year selector',
    !(availBody.years || []).includes(2019), JSON.stringify(availBody.years));

  const practice = await fetch(`${API}/pyq/practice/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 12', subject: 'Physics', years: [2019], count: 10 })
  });
  const practiceBody = await practice.json();
  check('a student cannot practise a draft paper\'s questions',
    practice.status === 404 && practiceBody.error === 'NO_PAPERS_AVAILABLE',
    `HTTP ${practice.status} ${practiceBody.error}`);

  const examStart = await fetch(`${API}/pyq/exam/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 12', subject: 'Physics', paperId: draft._id })
  });
  check('a student cannot start an exam on a draft paper', examStart.status === 404,
    `HTTP ${examStart.status}`);

  // And publishing flips exactly one of those, which proves the two views are
  // genuinely driven by status rather than coincidentally both empty.
  await PastPaper.updateOne({ _id: draft._id }, { $set: { parseStatus: 'published' } });
  const after = await (await fetch(`${API}/pyq/availability?grade=Class%2012&subject=Physics`, { headers: H })).json();
  check('publishing makes the SAME paper visible to students',
    (after.papers || []).some((p) => String(p._id) === String(draft._id)),
    `${(after.papers || []).length} paper(s) offered after publish`);

  await PyqQuestion.deleteOne({ _id: draftQ._id });
  await PastPaper.deleteOne({ _id: draft._id });
}

// ════ 11. HINDI ════════════════════════════════════════════════════════════
{
  const res = await fetch(`${API}/pyq/practice/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', years: [2023], count: 10, language: 'hi' })
  });
  const d = await res.json();
  const withFigure = d.questions.find((q) => q.diagramUrl);
  const anyHindi = d.questions.some((q) => /[ऀ-ॿ]/.test(q.questionText));
  check('practice questions localise to Hindi', anyHindi,
    anyHindi ? d.questions.find((q) => /[ऀ-ॿ]/.test(q.questionText)).questionText.slice(0, 50) : 'no Devanagari returned');
  check('the extracted figure still has alt text in Hindi mode', !!withFigure?.diagramAlt,
    withFigure?.diagramAlt?.slice(0, 60));

  // The stored English must be untouched — a translation is a translation, never a
  // regeneration of a real past-paper question.
  const stored = await PyqQuestion.findById(d.questions[0]._id).lean();
  check('the ENGLISH original is preserved, not overwritten by the translation',
    /Section [AB] question|In the figure below/.test(stored.questionText), stored.questionText.slice(0, 45));
}

// ════ 12. NO ROADMAP SIDE EFFECTS ══════════════════════════════════════════
{
  const before = await User.findById(userId).lean();
  await fetch(`${API}/pyq/practice/finish`, {
    method: 'POST', headers: H, body: JSON.stringify({ localDate: '2026-07-31' })
  });
  const after = await User.findById(userId).lean();

  const Roadmap = (await import('./src/models/Roadmap.js')).default;
  const roadmaps = await Roadmap.countDocuments({ userId });
  check('PYQ activity creates no roadmap and touches no roadmap document', roadmaps === 0, `${roadmaps}`);
  check('PYQ activity DOES record the account-wide streak marker (the one allowed signal)',
    (after.studyDates || []).includes('2026-07-31'),
    `before=${(before.studyDates || []).length} after=${(after.studyDates || []).length}`);
}

// ════ 13. LIVE PARSE (opt-in — costs a real OpenAI vision call) ════════════
if (process.env.PYQ_LIVE_PARSE === '1' && fs.existsSync(process.env.PYQ_TEST_PDF || '')) {
  const { parsePastPaper } = await import('./src/utils/parsePastPaper.js');
  const buf = fs.readFileSync(process.env.PYQ_TEST_PDF);
  const parsed = await parsePastPaper(buf);
  check('the parse reads questions out of a real PDF', parsed.questions.length > 0, `${parsed.questions.length} questions`);
  check('the parse finds the paper\'s sections', parsed.sections.length > 0,
    parsed.sections.map((s) => s.name).join(', '));
  check('the parse ran on the vision model, not the fallback', !parsed.usedFallback, parsed.parsedWithModel);
  check('the parse copies wording verbatim rather than paraphrasing',
    parsed.questions.some((q) => /HCF of 96 and 404/.test(q.questionText)),
    parsed.questions[0]?.questionText?.slice(0, 60));
  check('the parse flags a question that refers to a figure',
    parsed.questions.some((q) => q.figureExpected));
} else {
  console.log('SKIP          live parse (set PYQ_LIVE_PARSE=1 and PYQ_TEST_PDF=<path>)');
}

// ── teardown ────────────────────────────────────────────────────────────────
await ExamAttempt.deleteMany({ userId });
await PyqQuestion.deleteMany({ source: 'generated' });
for (const fn of cleanup) await fn();
await User.deleteOne({ _id: userId });
await mongoose.disconnect();

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
