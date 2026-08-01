import express from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';
import PastPaper from '../models/PastPaper.js';
import PyqQuestion, { groupByChoice } from '../models/PyqQuestion.js';
import ExamAttempt, { secondsRemaining, isExpired, isPaused, totalPausedMs } from '../models/ExamAttempt.js';
import { blueprintFor } from '../config/examBlueprints.js';
import { generateExamStylePaper, generateExamStylePractice } from '../utils/generateExamStyle.js';
import { recordStudyActivity } from '../utils/recordActivity.js';
import { translateTextWithSarvam, hindiIsStale, TRANSLATION_REGISTER_VERSION } from '../utils/translateAndCache.js';
import {
  boardCode, canonicalBoard, isFusionSubSubject, canonicalSubSubject, normalizeSubSubject
} from '../config/taxonomy.js';
import { BOARD_EXAM_GRADES } from './pyqAdmin.js';

// Workstream I — student-facing Previous Year Questions: practice and exam mode.
//
// ── ISOLATION (I5) ──────────────────────────────────────────────────────────
//
// Feature 11's isolation is not a helper you can import — it is STRUCTURAL, and the
// structure is what gets reused here: practice mode owns its own model and its own
// routes and simply never reaches the roadmap. There is nothing to call; the
// isolation is the absence of the call.
//
// So this file, exactly like routes/practice.js:
//   • never imports Roadmap, never marks a day complete;
//   • never imports computeWeakTopics, never feeds weak-topic aggregation;
//   • records ONLY the account-wide "studied today" streak marker, which is the one
//     signal practice mode already emits and is not roadmap progress.
//
// Because "we didn't call it" is invisible in review and easy to undo by accident,
// ci-invariants.mjs asserts it rather than leaving it to a comment.
//
// ── OWNERSHIP ───────────────────────────────────────────────────────────────
// Every route is requireRole('student') and every attempt lookup is scoped by
// userId, returning 404 (not 403) on a mismatch — the Mentor/Notes pattern: a
// student must not be able to learn that someone else's attempt exists.

const router = express.Router();

const PRACTICE_COUNTS = [10, 20, 30];
const DEFAULT_PRACTICE_COUNT = 10;

const isBoardGrade = (grade) => BOARD_EXAM_GRADES.includes(grade);

/** The student's own board + grade. Never taken from the request. */
async function studentContext(userId) {
  const user = await User.findById(userId).select('profile.studyMedium').lean();
  const board = canonicalBoard(user?.profile?.studyMedium || '');
  return { board };
}

/** Shape a question for the client — with the labelling that I0 requires. */
function presentQuestion(q, { includeAnswer = false, language = 'en' } = {}) {
  const useHi = language === 'hi' && q.hindiTranslated;
  const isReal = q.source === 'pyq';

  return {
    _id: q._id,
    // ── THE LABEL ───────────────────────────────────────────────────────────
    // Built here, server-side, from the source — so a client cannot construct a
    // past-paper label for a generated question by getting its props wrong. A real
    // question reads "CBSE 2023 · Q14"; a generated one reads "Exam-style practice"
    // and HAS NO YEAR TO SHOW, because the field does not exist on it.
    source: q.source,
    sourceLabel: isReal
      ? `${boardCode(q.board) || q.board} ${q.year} · Q${q.questionNumber}`
      : 'EXAM_STYLE_PRACTICE',
    year: isReal ? q.year : null,
    sectionName: q.sectionName,
    questionNumber: q.questionNumber,
    marks: q.marks,
    // Internal choice. The client needs both to render "OR" between alternatives
    // and to stop a student answering both — a real paper says attempt only one.
    choiceGroup: q.choiceGroup || '',
    choiceIndex: q.choiceIndex || 0,
    // Sub-parts. `parentKey` groups a container with its parts so exam mode can keep
    // the family together; `partLabel` is the printed "(i)" / "A" the student sees.
    parentKey: q.parentKey || '',
    isContainer: !!q.isContainer,
    partLabel: q.partLabel || '',
    partsAmbiguous: !!q.partsAmbiguous,
    partsRelation: q.partsRelation || 'all-required',
    questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
    options: (useHi && q.translatedHindiOptions?.length === q.options.length)
      ? q.translatedHindiOptions : q.options,
    // Extracted image for a real paper; generated SVG for a generated question.
    // Two distinct fields so no call site can render one believing it is the other.
    diagramUrl: isReal ? (q.diagramUrl || '') : '',
    diagramSvg: isReal ? '' : (q.diagramSvg || ''),
    diagramAlt: useHi ? (q.diagramAltHindi || q.diagramAlt || '') : (q.diagramAlt || ''),
    ...(includeAnswer ? {
      correctIndex: q.correctIndex,
      correctAnswer: q.correctAnswer,
      explanation: useHi ? (q.translatedHindiExplanation || q.explanation) : q.explanation
    } : {})
  };
}

/**
 * Lazily translate a question into Hindi and cache it.
 *
 * REAL PYQ TEXT IS TRANSLATED, NEVER REGENERATED. A regenerated Hindi "equivalent"
 * of a 2023 board question is not that question — it is a new question wearing its
 * number, which is the conflation this workstream exists to prevent, arriving by the
 * back door. So this goes through the same Sarvam translation path (with the
 * maths-masking rule) that every other question uses.
 */
async function ensureHindi(q) {
  if (q.hindiTranslated && !hindiIsStale(q)) return q;
  try {
    q.translatedHindiQuestionText = (await translateTextWithSarvam(q.questionText)) || q.questionText;
    const opts = [];
    for (const o of q.options || []) opts.push((await translateTextWithSarvam(o)) || o);
    q.translatedHindiOptions = opts;
    if (q.explanation) {
      q.translatedHindiExplanation = (await translateTextWithSarvam(q.explanation)) || q.explanation;
    }
    // Extracted-figure alt text is admin-written English; translating it keeps
    // read-aloud working in Hindi without inventing a description.
    if (q.diagramAlt && !q.diagramAltHindi) {
      q.diagramAltHindi = (await translateTextWithSarvam(q.diagramAlt)) || q.diagramAlt;
    }
    q.hindiTranslated = true;
    q.hindiRegisterVersion = TRANSLATION_REGISTER_VERSION;
    await q.save();
  } catch (err) {
    console.warn('PYQ Hindi translation failed (serving English):', err.message);
  }
  return q;
}

async function localiseAll(questions, language) {
  if (language !== 'hi') return questions;
  for (const q of questions) await ensureHindi(q);
  return questions;
}

// ── I4/I7: what is actually available ───────────────────────────────────────
/**
 * GET /api/pyq/availability?subject=Maths&grade=Class%2010
 *
 * The honest-empty-state endpoint. It answers three different questions depending on
 * the grade, and the client renders three different screens from the answer:
 *
 *   board grade + papers exist   → real PYQs, with the year list
 *   board grade + NO papers      → SAY SO. Never substitute generated questions;
 *                                  that is precisely the conflation I0 forbids.
 *   non-board grade              → exam-style only, no year selector at all
 */
router.get('/availability', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { board } = await studentContext(req.userId);
    const grade = String(req.query.grade || '').trim();
    const subject = String(req.query.subject || '').trim();
    if (!grade || !subject) return res.status(400).json({ error: 'GRADE_AND_SUBJECT_REQUIRED' });

    // A migrated or never-set board (Workstream H) cannot select a corpus. Named, so
    // the client can send them to set it rather than showing an empty year list.
    if (!board) return res.json({ mode: 'no-board', board: '', years: [], papers: [] });

    if (!isBoardGrade(grade)) {
      const blueprint = blueprintFor(grade, board, subject);
      return res.json({
        // 'exam-style' is a different MODE, not a degraded version of 'pyq'. The
        // client renders a different screen, with no year selector, because a
        // generated question has no year to filter on.
        mode: 'exam-style',
        board,
        reason: 'GRADE_HAS_NO_BOARD_EXAM',
        examAvailable: !!blueprint,
        blueprint: blueprint
          ? { totalMarks: blueprint.totalMarks, durationMinutes: blueprint.durationMinutes, sections: blueprint.sections }
          : null,
        years: [],
        papers: []
      });
    }

    const papers = await PastPaper.find({ board, grade, subject, parseStatus: 'published' })
      .select('_id year title totalMarks durationMinutes sections')
      .sort({ year: -1 })
      .lean();

    const counts = await PyqQuestion.aggregate([
      { $match: { paperId: { $in: papers.map((p) => p._id) } } },
      { $group: { _id: '$paperId', n: { $sum: 1 } } }
    ]);
    const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

    const years = [...new Set(papers.map((p) => p.year))].sort((a, b) => b - a);

    res.json({
      // Even with zero papers this stays mode 'pyq'. The empty state belongs to the
      // real-paper screen and says "no papers yet for this subject" — it does not
      // become an exam-style offer, because the student asked for past papers and
      // the honest answer is that we do not have them.
      mode: 'pyq',
      board,
      years,
      papers: papers.map((p) => ({ ...p, questionCount: byId[String(p._id)] || 0 })),
      paperCount: papers.length
    });
  } catch (err) {
    console.error('PYQ availability error:', err.message);
    res.status(500).json({ error: 'AVAILABILITY_FAILED' });
  }
});

// ── I5: practice mode ───────────────────────────────────────────────────────
/**
 * POST /api/pyq/practice/start { grade, subject, subSubject, years[], count }
 * Untimed, low-stakes, immediate feedback. No roadmap side effects.
 */
router.post('/practice/start', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { board } = await studentContext(req.userId);
    if (!board) return res.status(400).json({ error: 'BOARD_NOT_SET' });

    const grade = String(req.body.grade || '').trim();
    const subject = String(req.body.subject || '').trim();
    const subSubject = String(req.body.subSubject || '').trim();
    const language = req.body.language === 'hi' ? 'hi' : 'en';
    const years = Array.isArray(req.body.years) ? req.body.years.map(Number).filter(Number.isInteger) : [];

    // 'all' is offered when the filtered pool is small, so a thin corpus is usable
    // rather than rounded down to nothing.
    const wantAll = req.body.count === 'all';
    const count = wantAll ? 0
      : (PRACTICE_COUNTS.includes(Number(req.body.count)) ? Number(req.body.count) : DEFAULT_PRACTICE_COUNT);

    if (!grade || !subject) return res.status(400).json({ error: 'GRADE_AND_SUBJECT_REQUIRED' });

    // ── Non-board grade: exam-style, clearly labelled, no year ──────────────
    if (!isBoardGrade(grade)) {
      const generated = await generateExamStylePractice({
        grade, subject, subSubject, topics: req.body.topics, count: count || DEFAULT_PRACTICE_COUNT
      });
      const docs = await PyqQuestion.insertMany(generated);
      await localiseAll(docs, language);
      return res.json({
        mode: 'exam-style',
        reason: 'GRADE_HAS_NO_BOARD_EXAM',
        questionIds: docs.map((d) => d._id),
        questions: docs.map((q) => presentQuestion(q, { language }))
      });
    }

    // ── Board grade: REAL questions only ───────────────────────────────────
    const paperFilter = { board, grade, subject, parseStatus: 'published' };
    if (years.length) paperFilter.year = { $in: years };
    const papers = await PastPaper.find(paperFilter).select('_id').lean();

    if (!papers.length) {
      // The honest empty state. NOT a silent substitution of generated questions.
      return res.status(404).json({
        error: 'NO_PAPERS_AVAILABLE',
        mode: 'pyq',
        detail: years.length ? 'NO_PAPERS_FOR_SELECTED_YEARS' : 'NO_PAPERS_FOR_SUBJECT'
      });
    }

    let pool = await PyqQuestion.find({ paperId: { $in: papers.map((p) => p._id) } });
    if (!pool.length) return res.status(404).json({ error: 'NO_PAPERS_AVAILABLE', mode: 'pyq' });

    // ── PRACTICE FILTERS BY DISCIPLINE ────────────────────────────────────
    // Class 10 Science and Social Science are ONE paper sectioned by discipline, but
    // Feature 20 gives a student a course per sub-subject. A "Social Science →
    // Geography" student practising Geography questions is exactly right, and matches
    // Feature 11's targeted-revision model.
    //
    // EXAM MODE DELIBERATELY DOES NOT DO THIS — see /exam/start. A "Geography-only
    // exam" does not exist; presenting a subset of a real paper as an exam would be
    // neither the real paper nor an honest generated one, which is the I0 rule.
    //
    // The Fusion/Combined option means "all areas", so it never filters.
    let disciplineFilter = '';
    if (subSubject && !isFusionSubSubject(subject, subSubject)) {
      const wanted = canonicalSubSubject(subject, subSubject);
      // Only filter when the corpus actually carries discipline data. A paper
      // imported before disciplines were captured has none, and silently returning
      // an empty set would look like a missing corpus rather than a missing field.
      const anyTagged = pool.some((q) => q.sectionDiscipline);
      if (anyTagged && wanted) {
        const filtered = pool.filter((q) => normalizeSubSubject(q.sectionDiscipline) === normalizeSubSubject(wanted));
        if (filtered.length) { pool = filtered; disciplineFilter = wanted; }
      }
    }

    // ── PRACTICE SERVES PARTS, NOT CONTAINERS ─────────────────────────────
    // A container is a stimulus ("Read the following passage..."), not something to
    // answer, so it is never served as a question on its own. Its parts ARE
    // answerable individually, which is what practice mode is for.
    //
    // But a reading-comprehension part is only answerable WITH its passage, so the
    // container's text travels with each part as `stimulus`. Serving the part alone
    // would be a question about a passage the student cannot see.
    const containerText = new Map();
    for (const q of pool) if (q.isContainer && q.parentKey) containerText.set(q.parentKey, q.questionText);
    pool = pool.filter((q) => !q.isContainer);
    const stimulusFor = (q) => (q.parentKey ? containerText.get(q.parentKey) || '' : '');

    // Fisher-Yates over the pool; `count` 0 means every question available.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = count ? pool.slice(0, count) : pool;
    await localiseAll(picked, language);

    res.json({
      mode: 'pyq',
      // Non-empty when the set was narrowed to one discipline, so the UI can say
      // "Geography questions from the Social Science papers" rather than leaving the
      // student to wonder why a Social Science paper produced only Geography.
      disciplineFilter,
      poolSize: pool.length,
      questionIds: picked.map((q) => q._id),
      questions: picked.map((q) => ({ ...presentQuestion(q, { language }), stimulus: stimulusFor(q) }))
    });
  } catch (err) {
    console.error('PYQ practice start error:', err.message);
    res.status(500).json({ error: 'PRACTICE_START_FAILED' });
  }
});

/**
 * POST /api/pyq/practice/answer { questionId, selectedIndex }
 * Immediate per-question feedback, same as existing practice mode. Graded one at a
 * time server-side so the answer key never ships to the client up front.
 */
router.post('/practice/answer', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.body.questionId)) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
    const q = await PyqQuestion.findById(req.body.questionId);
    if (!q) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });

    const language = req.body.language === 'hi' ? 'hi' : 'en';
    if (language === 'hi') await ensureHindi(q);

    const selectedIndex = Number.isInteger(req.body.selectedIndex) ? req.body.selectedIndex : -1;
    const isCorrect = q.correctIndex !== null && selectedIndex === q.correctIndex;

    res.json({
      isCorrect,
      correctIndex: q.correctIndex,
      correctAnswer: q.correctAnswer,
      explanation: language === 'hi'
        ? (q.translatedHindiExplanation || q.explanation || '')
        : (q.explanation || '')
    });
  } catch (err) {
    console.error('PYQ practice answer error:', err.message);
    res.status(500).json({ error: 'PRACTICE_ANSWER_FAILED' });
  }
});

/** POST /api/pyq/practice/finish — streak marker only. No roadmap side effects. */
router.post('/practice/finish', authMiddleware, requireRole('student'), async (req, res) => {
  // recordStudyActivity is the ONLY progress signal this router emits. It is
  // account-wide "studied today", not roadmap progress — the same single call
  // routes/practice.js makes, and for the same reason.
  await recordStudyActivity(req.userId, req.body?.localDate);
  res.json({ recorded: true });
});

// ── I6: exam mode ───────────────────────────────────────────────────────────
/**
 * POST /api/pyq/exam/start { grade, subject, paperId?, confirmAbandon? }
 *
 * For a board grade the UPLOADED PAPER IS THE BLUEPRINT — its own sections, counts,
 * marks and duration, as parsed. No generic pattern is imposed over a real paper.
 */
router.post('/exam/start', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { board } = await studentContext(req.userId);
    if (!board) return res.status(400).json({ error: 'BOARD_NOT_SET' });

    const grade = String(req.body.grade || '').trim();
    const subject = String(req.body.subject || '').trim();
    const subSubject = String(req.body.subSubject || '').trim();
    const language = req.body.language === 'hi' ? 'hi' : 'en';

    let paper = null;
    let questions = [];
    let durationSeconds;
    let source;
    let blueprintKey = '';

    if (isBoardGrade(grade)) {
      if (!mongoose.isValidObjectId(req.body.paperId)) return res.status(400).json({ error: 'PAPER_REQUIRED' });
      paper = await PastPaper.findOne({ _id: req.body.paperId, board, grade, subject, parseStatus: 'published' });
      if (!paper) return res.status(404).json({ error: 'NO_PAPERS_AVAILABLE' });

      // ── One active attempt per paper ───────────────────────────────────────
      const open = await ExamAttempt.findOne({ userId: req.userId, paperId: paper._id, status: 'in_progress' });
      if (open) {
        if (!isExpired(open)) {
          // Starting fresh DESTROYS work, so it takes an explicit confirm.
          if (req.body.confirmAbandon !== true) {
            return res.status(409).json({
              error: 'ATTEMPT_ALREADY_IN_PROGRESS',
              attemptId: open._id,
              secondsRemaining: secondsRemaining(open),
              // Sent so the resume card can say the clock is STOPPED. Without it a
              // paused attempt and a running one are indistinguishable — both just
              // show "N minutes left" — and the student is left choosing between
              // resuming and starting over without knowing whether time is draining.
              paused: isPaused(open)
            });
          }
          open.status = 'expired';
          open.finalisedAt = new Date();
          await open.save();
        } else {
          // Its clock ran out while nobody was looking. Finalise it rather than
          // leaving a zombie that blocks every future attempt on this paper.
          await finaliseAttempt(open, 'expired');
        }
      }

      // THE WHOLE PAPER, always — never narrowed to the student's sub-subject.
      //
      // Practice mode DOES filter by discipline, and the asymmetry is deliberate. A
      // "Geography-only exam" does not exist: presenting Section B of a real Social
      // Science paper as an exam would be neither the real paper (it is a fragment)
      // nor an honest generated one (it is real questions), which is exactly the
      // conflation the I0 rule forbids. A student sitting an exam simulation must sit
      // the paper their board actually sets.
      questions = await PyqQuestion.find({ paperId: paper._id }).sort({ sectionName: 1, _id: 1 });
      // The paper's own duration. Falls back to 3 hours only when the parse could not
      // read one off the header — the common Indian board sitting.
      durationSeconds = (paper.durationMinutes || 180) * 60;
      source = 'pyq';
    } else {
      const blueprint = blueprintFor(grade, board, subject);
      if (!blueprint) return res.status(404).json({ error: 'NO_BLUEPRINT_FOR_GRADE_SUBJECT' });

      const built = await generateExamStylePaper({ grade, subject, subSubject, blueprint, topics: req.body.topics });
      questions = await PyqQuestion.insertMany(built.questions);
      durationSeconds = blueprint.durationMinutes * 60;
      source = 'generated';
      blueprintKey = blueprint.key;
    }

    if (!questions.length) return res.status(404).json({ error: 'NO_PAPERS_AVAILABLE' });

    const attempt = await ExamAttempt.create({
      userId: req.userId,
      paperId: paper?._id || null,
      source,
      blueprintKey,
      questionIds: questions.map((q) => q._id),
      startedAt: new Date(),
      durationSeconds,
      status: 'in_progress'
    });

    await localiseAll(questions, language);

    res.status(201).json({
      attemptId: attempt._id,
      // A mixed or generated sitting is labelled exam-style, never as a past paper.
      mode: source === 'pyq' ? 'pyq' : 'exam-style',
      paper: paper ? {
        title: paper.title, year: paper.year, board: paper.board,
        totalMarks: paper.totalMarks, durationMinutes: paper.durationMinutes, sections: paper.sections
      } : null,
      blueprintKey,
      // Set when the student studies one discipline of a multi-discipline paper.
      // The UI uses it to explain, up front, why an exam covers more than their
      // course does — otherwise a Geography student meets History questions and
      // reasonably concludes the app served the wrong paper.
      fullPaperNotice: (paper && subSubject && !isFusionSubSubject(subject, subSubject)
        && (await PyqQuestion.exists({ paperId: paper._id, sectionDiscipline: { $ne: '' } })))
        ? { subSubject: canonicalSubSubject(subject, subSubject) || subSubject, subject }
        : null,
      durationSeconds,
      secondsRemaining: secondsRemaining(attempt),
      questions: questions.map((q) => presentQuestion(q, { language }))
    });
  } catch (err) {
    console.error('PYQ exam start error:', err.message);
    res.status(500).json({ error: 'EXAM_START_FAILED' });
  }
});

/**
 * GET /api/pyq/exam/:id — RESUME.
 *
 * Returns the true remaining time computed from startedAt, plus every answer already
 * entered. A student who closed their laptop gets back exactly what they had, and a
 * clock that kept running while they were gone — which is what an exam does.
 */
router.get('/exam/:id', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });

    const language = req.query.lang === 'hi' ? 'hi' : 'en';

    // Expired while away: auto-submit with whatever was answered, then show results.
    if (attempt.status === 'in_progress' && isExpired(attempt)) {
      await finaliseAttempt(attempt, 'expired');
      return res.json({ status: attempt.status, expired: true, secondsRemaining: 0, results: await buildResults(attempt, language) });
    }

    if (attempt.status !== 'in_progress') {
      return res.json({ status: attempt.status, secondsRemaining: 0, results: await buildResults(attempt, language) });
    }

    const questions = await PyqQuestion.find({ _id: { $in: attempt.questionIds } });
    // Preserve THIS attempt's stored order — a re-sorted resume is a different paper.
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const ordered = attempt.questionIds.map((id) => byId.get(String(id))).filter(Boolean);
    await localiseAll(ordered, language);

    res.json({
      attemptId: attempt._id,
      status: 'in_progress',
      mode: attempt.source === 'pyq' ? 'pyq' : 'exam-style',
      // Server-computed. The client displays it and never owns it.
      secondsRemaining: secondsRemaining(attempt),
      durationSeconds: attempt.durationSeconds,
      // Pause survives a reload: a student who paused and closed the tab comes back
      // to a paused paper, not a running one.
      paused: isPaused(attempt),
      questions: ordered.map((q) => presentQuestion(q, { language })),
      answers: attempt.answers.map((a) => ({
        questionId: a.questionId, selectedIndex: a.selectedIndex, writtenAnswer: a.writtenAnswer
      }))
    });
  } catch (err) {
    console.error('PYQ exam resume error:', err.message);
    res.status(500).json({ error: 'EXAM_RESUME_FAILED' });
  }
});

/**
 * POST /api/pyq/exam/:id/answer — persist ONE answer as it is entered.
 *
 * Per-answer rather than on submit, because a closed laptop must not lose an hour of
 * work. Every call is checked against the SERVER deadline: an answer that arrives
 * after expiry is rejected, and the attempt is finalised on the spot.
 */
router.post('/exam/:id/answer', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
    if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'ATTEMPT_ALREADY_FINALISED' });

    // THE DEADLINE CHECK. Server clock against server-stored startedAt — nothing the
    // client sends participates in this decision.
    if (isExpired(attempt)) {
      await finaliseAttempt(attempt, 'expired');
      return res.status(409).json({ error: 'ATTEMPT_EXPIRED', secondsRemaining: 0 });
    }

    // A paused attempt does not accept answers. Otherwise pausing is simply the
    // timer switched off while the work continues, which produces a timed-looking
    // result that was not timed. The UI disables the inputs; this is the enforcement.
    if (isPaused(attempt)) {
      return res.status(409).json({ error: 'ATTEMPT_PAUSED', paused: true });
    }

    if (!mongoose.isValidObjectId(req.body.questionId)) return res.status(400).json({ error: 'QUESTION_REQUIRED' });
    const qid = String(req.body.questionId);
    if (!attempt.questionIds.some((id) => String(id) === qid)) {
      // Not part of this attempt — answering a question from another paper.
      return res.status(404).json({ error: 'QUESTION_NOT_IN_ATTEMPT' });
    }

    const existing = attempt.answers.find((a) => String(a.questionId) === qid);
    const patch = {
      selectedIndex: Number.isInteger(req.body.selectedIndex) ? req.body.selectedIndex : null,
      writtenAnswer: typeof req.body.writtenAnswer === 'string' ? req.body.writtenAnswer : '',
      sectionName: String(req.body.sectionName || ''),
      answeredAt: new Date()   // server-stamped; the client does not time itself
    };

    if (existing) Object.assign(existing, patch);
    else attempt.answers.push({ questionId: qid, ...patch });

    await attempt.save();
    res.json({ saved: true, secondsRemaining: secondsRemaining(attempt) });
  } catch (err) {
    console.error('PYQ exam answer error:', err.message);
    res.status(500).json({ error: 'EXAM_ANSWER_FAILED' });
  }
});

/**
 * POST /api/pyq/exam/:id/pause  and  /resume
 *
 * This is a learning app, so a student can stop the clock and come back. Both are
 * server state changes — a client-side pause would either be ignored by the server's
 * deadline or, if the server trusted the client, be a timer the student could stop
 * by editing a variable.
 *
 * PAUSING BLOCKS ANSWERING (see the answer route). Without that, "pause" is just
 * unlimited thinking time with the clock off, which is not a pause — it is a way to
 * make the timer meaningless while still producing a timed-looking result. Stopping
 * the clock and stopping the work have to be the same action.
 */
router.post('/exam/:id/pause', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
    if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'ATTEMPT_ALREADY_FINALISED' });

    // Expiry is checked BEFORE the pause lands, so a pause cannot rescue an attempt
    // whose time already ran out while the tab was closed.
    if (isExpired(attempt)) {
      await finaliseAttempt(attempt, 'expired');
      return res.status(409).json({ error: 'ATTEMPT_EXPIRED', secondsRemaining: 0 });
    }
    if (isPaused(attempt)) {
      return res.json({ paused: true, secondsRemaining: secondsRemaining(attempt) });
    }

    attempt.pausedAt = new Date();
    attempt.pauseCount = (attempt.pauseCount || 0) + 1;
    await attempt.save();
    res.json({ paused: true, secondsRemaining: secondsRemaining(attempt) });
  } catch (err) {
    console.error('PYQ exam pause error:', err.message);
    res.status(500).json({ error: 'EXAM_PAUSE_FAILED' });
  }
});

router.post('/exam/:id/resume', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
    if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'ATTEMPT_ALREADY_FINALISED' });

    if (isPaused(attempt)) {
      // Bank the elapsed pause, then clear it. Done in this order so a crash between
      // the two leaves the attempt paused (safe) rather than silently un-banked,
      // which would hand the student back time they had already spent stopped.
      attempt.pausedMs = (attempt.pausedMs || 0) + (Date.now() - new Date(attempt.pausedAt).getTime());
      attempt.pausedAt = null;
      await attempt.save();
    }
    res.json({ paused: false, secondsRemaining: secondsRemaining(attempt) });
  } catch (err) {
    console.error('PYQ exam resume error:', err.message);
    res.status(500).json({ error: 'EXAM_RESUME_FAILED' });
  }
});

/** POST /api/pyq/exam/:id/submit — finalise and score. */
router.post('/exam/:id/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });

    const language = req.body.language === 'hi' ? 'hi' : 'en';
    if (attempt.status === 'in_progress') {
      await finaliseAttempt(attempt, isExpired(attempt) ? 'expired' : 'submitted');
      // Streak marker only — never roadmap completion, never weak-topic data.
      await recordStudyActivity(req.userId, req.body?.localDate);
    }
    res.json({ status: attempt.status, results: await buildResults(attempt, language) });
  } catch (err) {
    console.error('PYQ exam submit error:', err.message);
    res.status(500).json({ error: 'EXAM_SUBMIT_FAILED' });
  }
});

/** GET /api/pyq/exam/:id/results — section-wise breakdown + per-question review. */
router.get('/exam/:id/results', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const attempt = await findOwnedAttempt(req);
    if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
    if (attempt.status === 'in_progress') return res.status(409).json({ error: 'ATTEMPT_NOT_FINALISED' });
    res.json({ results: await buildResults(attempt, req.query.lang === 'hi' ? 'hi' : 'en') });
  } catch (err) {
    console.error('PYQ exam results error:', err.message);
    res.status(500).json({ error: 'EXAM_RESULTS_FAILED' });
  }
});

/** GET /api/pyq/exam — this student's attempts, so a resume is findable. */
router.get('/exam', authMiddleware, requireRole('student'), async (req, res) => {
  const attempts = await ExamAttempt.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(30)
    .populate('paperId', 'title year board subject grade').lean();
  res.json({
    attempts: attempts.map((a) => ({
      _id: a._id, status: a.status, source: a.source,
      mode: a.source === 'pyq' ? 'pyq' : 'exam-style',
      paper: a.paperId || null, blueprintKey: a.blueprintKey,
      startedAt: a.startedAt, durationSeconds: a.durationSeconds,
      secondsRemaining: a.status === 'in_progress' ? secondsRemaining(a) : 0,
      marksAwarded: a.marksAwarded, marksAvailable: a.marksAvailable
    }))
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Ownership-checked lookup. Scoped by userId in the QUERY, so a mismatch is
 * indistinguishable from a nonexistent id — 404, never 403. Following Mentor/Notes:
 * a 403 would confirm that someone else's attempt exists.
 */
async function findOwnedAttempt(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return ExamAttempt.findOne({ _id: req.params.id, userId: req.userId });
}

/** Score and close an attempt. Idempotent — a finalised attempt is left alone. */
async function finaliseAttempt(attempt, status) {
  if (attempt.status !== 'in_progress') return attempt;

  const questions = await PyqQuestion.find({ _id: { $in: attempt.questionIds } }).lean();
  const byId = new Map(questions.map((q) => [String(q._id), q]));

  const sections = new Map();
  const ensure = (name) => {
    if (!sections.has(name)) {
      sections.set(name, {
        name, marksAwarded: 0, marksAvailable: 0,
        questionsAttempted: 0, questionsTotal: 0, secondsSpent: 0, _times: []
      });
    }
    return sections.get(name);
  };

  // ── Score by CHOICE GROUP, not by document ──────────────────────────────
  // An internal-choice question ("31. ... OR ...") is stored as two documents but is
  // ONE question worth its marks ONCE — the student is instructed to attempt only
  // one. Iterating documents would report a 39-question/80-mark paper as 46
  // questions and 95 marks, and would let a student who answered both alternatives
  // score twice.
  const ordered = attempt.questionIds.map((id) => byId.get(String(id))).filter(Boolean);
  for (const group of groupByChoice(ordered)) {
    const primary = group[0];
    const s = ensure(primary.sectionName || 'Paper');
    s.questionsTotal += 1;
    // Max across the group: alternatives are the same marks offered two ways, and a
    // mis-parsed alternative carrying 0 must not deflate the paper's total.
    s.marksAvailable += Math.max(...group.map((q) => q.marks || 0));

    // The alternative the student actually attempted. If somehow both were answered
    // (the UI prevents it; a hand-crafted request would not), the FIRST in paper
    // order is marked — that is what an examiner does with a script that answers
    // both, and picking the higher-scoring one would reward ignoring the rubric.
    const answeredFor = group
      .map((q) => ({ q, ans: attempt.answers.find((a) => String(a.questionId) === String(q._id)) }))
      .filter(({ ans }) => ans && (ans.selectedIndex !== null || (ans.writtenAnswer || '').trim().length > 0));

    if (!answeredFor.length) continue;
    const { q, ans } = answeredFor[0];

    s.questionsAttempted += 1;
    if (ans.answeredAt) s._times.push(new Date(ans.answeredAt).getTime());

    // Only MCQs are auto-scored. A written answer is NOT machine-marked here: the
    // existing essay grader is tuned to short revision answers, and silently scoring
    // a 5-mark board answer with it would put a number on this paper that the real
    // marking scheme would not recognise. Written answers are shown for self-review
    // and are excluded from marksAvailable-vs-awarded on the MCQ line.
    if (q.correctIndex !== null && ans.selectedIndex === q.correctIndex) {
      s.marksAwarded += q.marks || 0;
    }
  }

  attempt.sectionScores = [...sections.values()].map((s) => {
    const times = s._times;
    return {
      name: s.name,
      marksAwarded: s.marksAwarded,
      marksAvailable: s.marksAvailable,
      questionsAttempted: s.questionsAttempted,
      questionsTotal: s.questionsTotal,
      // First-to-last answer in the section. A lower bound, not a stopwatch — see
      // the model. Zero when a section got one answer or none.
      secondsSpent: times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : 0
    };
  });

  attempt.marksAwarded = attempt.sectionScores.reduce((a, s) => a + s.marksAwarded, 0);
  attempt.marksAvailable = attempt.sectionScores.reduce((a, s) => a + s.marksAvailable, 0);
  attempt.status = status;
  attempt.finalisedAt = new Date();
  await attempt.save();
  return attempt;
}

/** Full results payload: section breakdown mirroring the paper + per-question review. */
async function buildResults(attempt, language = 'en') {
  const questions = await PyqQuestion.find({ _id: { $in: attempt.questionIds } });
  if (language === 'hi') await localiseAll(questions, language);
  const byId = new Map(questions.map((q) => [String(q._id), q]));

  return {
    status: attempt.status,
    mode: attempt.source === 'pyq' ? 'pyq' : 'exam-style',
    marksAwarded: attempt.marksAwarded,
    marksAvailable: attempt.marksAvailable,
    sectionScores: attempt.sectionScores,
    startedAt: attempt.startedAt,
    finalisedAt: attempt.finalisedAt,
    // Reported so a result is honest about how it was produced. A paper finished
    // with two hours of pauses is a different achievement from one done straight
    // through, and the student is the person most entitled to know which they did.
    pausedSeconds: Math.round(totalPausedMs(attempt) / 1000),
    pauseCount: attempt.pauseCount || 0,
    // Wall-clock from start to finalisation, MINUS the paused time — the time
    // actually spent on the paper, which is the honest denominator for the score.
    activeSeconds: Math.max(0, Math.round(
      (((attempt.finalisedAt ? new Date(attempt.finalisedAt).getTime() : Date.now())
        - new Date(attempt.startedAt).getTime()) - totalPausedMs(attempt)) / 1000
    )),
    questions: attempt.questionIds.map((id) => {
      const q = byId.get(String(id));
      if (!q) return null;
      const ans = attempt.answers.find((a) => String(a.questionId) === String(id));
      return {
        ...presentQuestion(q, { includeAnswer: true, language }),
        selectedIndex: ans?.selectedIndex ?? null,
        writtenAnswer: ans?.writtenAnswer || '',
        isCorrect: q.correctIndex !== null && ans?.selectedIndex === q.correctIndex,
        // Written answers are shown, not scored — see finaliseAttempt.
        autoScored: q.correctIndex !== null
      };
    }).filter(Boolean)
  };
}

export default router;
