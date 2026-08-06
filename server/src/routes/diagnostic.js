import express from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import DiagnosticSession from '../models/DiagnosticSession.js';
import { translateQuestionsArray, translateTextWithSarvam } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash } from '../utils/textToSpeech.js';
import { gradeWritten } from '../utils/gradeWritten.js';
import { generateWritten, writtenStyleFor } from '../utils/generateWritten.js';
import { normalizeTopic } from '../utils/weakTopics.js';
import { subjectScopeLabel, isWrittenHeavy, isKnownSubSubject, GRADES } from '../config/taxonomy.js';
import { formatQuestionForTTS } from '../utils/ttsNormalize.js';
import {
  MIN_QUESTIONS, MAX_QUESTIONS, maxQuestionsForGrade,
  resolveBlueprint, selectWorkingChapters, planNextRound, generateRound,
  shouldStop, estimateTotal, chapterAccuracy, coverageOf
} from '../utils/diagnosticEngine.js';
import { attachDiagrams } from '../utils/generateDiagram.js';
import { resolveSpeakPlan, speakLangAfterTranslationFailure } from '../utils/narrationLang.js';
import { callGroqChat } from '../utils/groqClient.js';

const router = express.Router();

// Track 3: opt-in written questions in the diagnostic (per-session, since a
// diagnostic is a fresh session — unlike the cached module quiz). Binarised at
// 60% (the diagnostic bar) so a written miss feeds the weak/strong split exactly
// like a wrong MCQ.
const DIAGNOSTIC_WRITTEN_COUNT = 2;
const DIAGNOSTIC_WRITTEN_THRESHOLD = 60;

// Workstream A: there is deliberately NO handwritten question bank and NO
// template filler here any more. Those banks were the source of the off-level
// questions (a Class 10 Maths diagnostic asking "if r = 4, what is the
// diameter?"), and a wrong-level diagnostic produces a wrong roadmap — which is
// worse for the student than no roadmap. If generation genuinely fails we return
// 503 and ask them to retry.
const GENERATION_UNAVAILABLE =
  'We could not prepare your diagnostic right now. Your roadmap is built from these questions, so we would rather not guess — please try again in a moment.';

// Translate a MIXED question array (MCQ + written) to Hindi, index-aligned.
// MCQ uses the option-order-preserving path; written has no options, so it uses
// the prompt-only Sarvam path (same split as practice.js). Feedback stays English.
// Workstream D: a diagram's alt text is translated too, so read-aloud describes
// the figure in Hindi as well.
async function translateDiagnosticQuestions(questions) {
  const mcqPayload = [];
  const mcqSlot = questions.map(q => {
    if (q.type === 'written') return -1;
    mcqPayload.push({ questionText: q.questionText, options: q.options, explanation: q.explanation || '' });
    return mcqPayload.length - 1;
  });
  const translatedMcq = mcqPayload.length ? await translateQuestionsArray(mcqPayload) : [];

  const out = new Array(questions.length);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    let diagramAlt = '';
    if (q.diagram && q.diagram.alt) {
      // Workstream G: alt text OPTS OUT of maths masking. It feeds TTS and must be
      // PRONOUNCEABLE, so "PQ" wants to become पीक्यू rather than being preserved as
      // Latin letters a Hindi voice will stumble over. Masking is on by default
      // everywhere else; this is the one place the opposite is correct.
      const ta = await translateTextWithSarvam(q.diagram.alt, 'hi-IN', 1, { maskMath: false });
      diagramAlt = (ta && ta.trim()) ? ta : '';
    }
    if (q.type === 'written') {
      const tp = await translateTextWithSarvam(q.questionText);
      out[i] = { questionText: (tp && tp.trim()) ? tp : q.questionText, options: [], diagramAlt };
    } else {
      const base = translatedMcq[mcqSlot[i]] || { questionText: q.questionText, options: q.options };
      out[i] = { ...base, diagramAlt };
    }
  }
  return out;
}

// 1 Batched Groq call for 1-sentence explanations across all questions
async function callGroqForExplanations(questions) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    return questions.map(q => `The correct answer is "${q.options[q.correctIndex]}".`);
  }

  const payload = questions.map((q, idx) => ({
    id: idx + 1,
    question: q.questionText,
    correctOption: q.options[q.correctIndex]
  }));

  const prompt = `For each multiple choice question below, provide a 1-sentence explanation of why the correct option is right.
Input: ${JSON.stringify(payload)}

Return ONLY a valid JSON object matching this shape:
{
  "explanations": ["1-sentence explanation for Q1", "1-sentence explanation for Q2", ...]
}
No extra text, raw JSON only.`;

  try {
    // Shared client → 70b → 8b → OpenAI + rate-limit circuit breaker.
    const raw = await callGroqChat(
      [{ role: 'user', content: prompt }],
      { jsonMode: true, temperature: 0.3 }
    );
    const parsed = JSON.parse(raw || '{}');
    if (Array.isArray(parsed.explanations) && parsed.explanations.length === questions.length) {
      return parsed.explanations;
    }
  } catch (err) {
    console.warn('Batched explanations Groq call failed:', err.message);
  }

  return questions.map(q => `The correct answer is "${q.options[q.correctIndex]}".`);
}

// ── Adaptive session helpers (A3) ───────────────────────────────────────────

// What the client is allowed to see. correctIndex is NEVER included.
function toClientQuestion(q) {
  const base = {
    question: q.questionText,
    questionText: q.questionText,
    topic: q.topic,
    chapterId: q.chapterId || '',
    difficulty: q.difficulty || ''
  };
  if (q.diagram && q.diagram.svg) {
    base.diagram = { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' };
  }
  return q.type === 'written'
    ? { ...base, type: 'written', writtenStyle: q.writtenStyle }
    : { ...base, type: 'mcq', options: q.options };
}

function progressOf(session) {
  return {
    asked: session.questions.length,
    answered: session.gradedCount,
    round: session.roundNumber,
    minQuestions: MIN_QUESTIONS,
    // The BAND's ceiling, not the global constant — a Class 2 student must not be
    // shown "max 20" while their session is capped at 15. Reconstructed from the
    // session's own budget so it can never disagree with the budget actually in force.
    maxQuestions: (session.mcqMax || MAX_QUESTIONS) + (session.includeWritten ? DIAGNOSTIC_WRITTEN_COUNT : 0),
    coverage: coverageOf(session.blueprintChapters, session.chapterStats || {}),
    estimatedTotal: estimateTotal({
      chapters: session.blueprintChapters,
      stats: session.chapterStats || {},
      asked: session.questions.length,
      askedMcq: session.questions.filter(q => q.type !== 'written').length,
      mcqMin: session.mcqMin,
      mcqMax: session.mcqMax,
      pendingWritten: session.includeWritten && !session.writtenServed ? DIAGNOSTIC_WRITTEN_COUNT : 0
    })
  };
}

// ── Round pre-generation ────────────────────────────────────────────────────
//
// Generating a round takes several seconds, and it used to happen entirely
// between the student's last answer and the next question — dead time in the very
// first thing they ever do on the platform. So while they answer the round on
// screen, we speculatively generate questions for the chapters that will open next.
//
// The next round's exact composition depends on answers we do not have yet, but
// its UNTOUCHED chapters do not: an untouched chapter always starts at 'medium',
// and untouched chapters open in deterministic blueprint order. Only *how many*
// open is uncertain. So we warm the next few untouched chapters, and the submit
// path consumes whatever matches and generates only the remainder.
const PREFETCH_TTL_MS = 15 * 60 * 1000;
const PREFETCH_MAX_SESSIONS = 500;
const PREFETCH_CHAPTERS = 2;
const roundPrefetch = new Map(); // sessionId -> { at, promise }

function sweepPrefetch() {
  const cutoff = Date.now() - PREFETCH_TTL_MS;
  for (const [k, v] of roundPrefetch) if (v.at < cutoff) roundPrefetch.delete(k);
  // Hard cap as a backstop against unbounded growth (Map preserves insertion order).
  while (roundPrefetch.size > PREFETCH_MAX_SESSIONS) {
    roundPrefetch.delete(roundPrefetch.keys().next().value);
  }
}

function schedulePrefetch(session) {
  try {
    sweepPrefetch();
    const key = String(session._id);
    roundPrefetch.delete(key);

    const stats = session.chapterStats || {};
    // Chapters that are neither already probed nor part of the round now on screen.
    const onScreen = new Set(session.questions.slice(session.gradedCount).map(q => q.chapterId));
    const untouched = session.blueprintChapters
      .filter(c => !stats[c.id]?.asked && !onScreen.has(c.id))
      .slice(0, PREFETCH_CHAPTERS);
    if (!untouched.length) return;

    const specs = untouched.map(chapter => ({ chapter, difficulty: 'medium' }));
    const promise = generateRound({
      grade: session.grade,
      subject: session.subject,
      subSubject: session.subSubject,
      blueprint: {
        chapters: session.blueprintChapters,
        difficultyAnchor: session.difficultyAnchor,
        exemplars: session.exemplars
      },
      specs,
      askedStems: session.questions.map(q => q.questionText)
    })
      .then(async (questions) => {
        await attachDiagrams(questions, {
          grade: session.grade, subject: session.subject,
          subSubject: session.subSubject, chapters: session.blueprintChapters
        });
        return questions;
      })
      // A failed prefetch is a non-event: the submit path just generates normally.
      .catch((err) => { console.warn('Round prefetch failed (harmless):', err.message); return []; });

    roundPrefetch.set(key, { at: Date.now(), promise });
  } catch (err) {
    console.warn('Round prefetch could not be scheduled (harmless):', err.message);
  }
}

// Consume the warmed questions for a session, if any. Always resolves.
async function takePrefetched(sessionId) {
  const entry = roundPrefetch.get(String(sessionId));
  if (!entry) return [];
  roundPrefetch.delete(String(sessionId));
  try {
    return (await entry.promise) || [];
  } catch {
    return [];
  }
}

// Fold one graded answer into the per-chapter confidence the algorithm reads.
// MCQ only: written questions are served AFTER the stop decision, so counting
// them would retroactively change a decision that has already been made.
function recordChapterAnswer(session, q, wasCorrect) {
  if (q.type === 'written' || !q.chapterId) return;
  const stats = session.chapterStats || {};
  const s = stats[q.chapterId] || { asked: 0, correct: 0, lastDifficulty: 'medium', lastCorrect: false };
  s.asked += 1;
  if (wasCorrect) s.correct += 1;
  s.lastDifficulty = q.difficulty || 'medium';
  s.lastCorrect = !!wasCorrect;
  stats[q.chapterId] = s;
  session.chapterStats = stats;
  session.markModified('chapterStats');
}

// Append a freshly generated round to the session, keeping the Hindi cache
// index-aligned (empty slots for rounds generated while the student is in English —
// filled on demand by the session-translate route).
async function appendRound(session, questions, wantHindi) {
  const startIndex = session.questions.length;
  questions.forEach(q => session.questions.push(q));
  session.roundNumber += 1;

  let translated = [];
  if (wantHindi) {
    translated = await translateDiagnosticQuestions(questions);
  }
  while (session.translatedHindiQuestions.length < startIndex) {
    session.translatedHindiQuestions.push({ questionText: '', options: [], diagramAlt: '' });
  }
  translated.forEach(t => session.translatedHindiQuestions.push(t));
  return { startIndex, translated };
}

// POST /api/diagnostic/generate — starts an adaptive session and returns round 1.
router.post('/generate', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { grade, subject } = req.body;
    const isHindiRequested = req.query.lang === 'hi' || req.body.language === 'hi';

    if (!grade || !subject) {
      return res.status(400).json({ error: 'Grade and subject are required.' });
    }

    // Sub-subject (English/Science/Social Science split). Optional; validated against
    // the parent subject's list when provided. Flat subjects get ''.
    const subSubject = typeof req.body.subSubject === 'string' ? req.body.subSubject.trim() : '';
    if (subSubject && !isKnownSubSubject(subject, subSubject)) {
      return res.status(400).json({ error: `"${subSubject}" is not a valid sub-subject of ${subject}.` });
    }

    // Written-heavy sub-subjects (English Writing/Fusion) auto-include written
    // questions; everything else only when the student opts in via the toggle.
    // The MCQ budget is reduced by the written count so the TOTAL question count
    // is always inside [MIN_QUESTIONS, MAX_QUESTIONS].
    const includeWritten = req.body.includeWritten === true || isWrittenHeavy(subject, subSubject);
    const writtenCount = includeWritten ? DIAGNOSTIC_WRITTEN_COUNT : 0;
    const mcqMin = MIN_QUESTIONS - writtenCount;
    // Banded: 15 for Class 5 and below, 20 above. See maxQuestionsForGrade() for why a
    // global 15 was rejected — the cap doubles as the syllabus-coverage dial.
    const gradeMax = maxQuestionsForGrade(grade, GRADES);
    const mcqMax = gradeMax - writtenCount;

    let blueprint;
    try {
      blueprint = await resolveBlueprint(grade, subject, subSubject);
    } catch (err) {
      console.warn('Diagnostic blueprint resolution failed:', err.message);
      return res.status(503).json({ error: GENERATION_UNAVAILABLE });
    }

    const workingChapters = selectWorkingChapters(blueprint.chapters, mcqMax, mcqMin);
    const specs = planNextRound({ chapters: workingChapters, stats: {}, askedMcq: 0, mcqMax });

    let questions;
    try {
      questions = await generateRound({
        grade, subject, subSubject,
        blueprint: { ...blueprint, chapters: workingChapters },
        specs,
        askedStems: []
      });
    } catch (err) {
      console.warn('Diagnostic round 1 generation failed:', err.message);
      return res.status(503).json({ error: GENERATION_UNAVAILABLE });
    }

    // Workstream D: attach a figure to the subset of questions that genuinely need one.
    await attachDiagrams(questions, { grade, subject, subSubject, chapters: workingChapters });

    const session = new DiagnosticSession({
      userId: req.userId,
      grade,
      subject,
      subSubject,
      questions: [],
      blueprintChapters: workingChapters,
      difficultyAnchor: blueprint.difficultyAnchor,
      exemplars: blueprint.exemplars,
      chapterStats: {},
      roundNumber: 0,
      gradedCount: 0,
      mcqMin,
      mcqMax,
      includeWritten
    });

    const { translated } = await appendRound(session, questions, isHindiRequested);
    await session.save();

    res.json({
      quizSessionId: session._id,
      questions: session.questions.map(toClientQuestion),
      translatedHindiQuestions: isHindiRequested ? translated : [],
      progress: progressOf(session)
    });

    // Warm the next round while the student answers this one. Deliberately after
    // the response and un-awaited — it must never delay what is on screen.
    schedulePrefetch(session);
  } catch (error) {
    console.error('Diagnostic generate error:', error);
    res.status(500).json({ error: 'Server error generating diagnostic quiz.' });
  }
});

// POST /api/diagnostic/submit — accepts ONE ROUND of answers.
// Responds either { status:'continue', questions, progress } or
// { status:'complete', result } (the existing DiagnosticResult shape).
router.post('/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { quizSessionId, answers } = req.body;
    const isHindiRequested = req.query.lang === 'hi' || req.body.language === 'hi';

    if (!quizSessionId) {
      return res.status(400).json({ error: 'quizSessionId is required for submission.' });
    }
    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers array is required.' });
    }

    const session = await DiagnosticSession.findById(quizSessionId);
    if (!session || session.used || session.isComplete || session.userId.toString() !== req.userId) {
      return res.status(410).json({ error: 'Quiz session expired or invalid. Please regenerate and retake your diagnostic test.' });
    }

    // The round on the student's screen is everything after `gradedCount`. A client
    // that resends the whole history is tolerated by taking the tail.
    const pending = session.questions.slice(session.gradedCount);
    if (!pending.length) {
      return res.status(409).json({ error: 'This round has already been submitted.' });
    }
    const roundAnswers = answers.length > pending.length
      ? answers.slice(answers.length - pending.length)
      : answers;

    // Reject a STALE round. Submitting the same round twice (a double-click, a
    // retried request, a back-button replay) would otherwise grade the round that
    // is now on screen using the PREVIOUS round's answers — silently wrong, and it
    // corrupts the weak/strong split the roadmap is built from. `round` is required
    // rather than optional precisely because an absent field cannot prove freshness;
    // the per-question stem check below is a second, independent guard.
    if (!Number.isInteger(req.body.round)) {
      return res.status(400).json({ error: 'round is required — submit the round number returned with these questions.' });
    }
    if (req.body.round !== session.roundNumber) {
      return res.status(409).json({ error: 'This round has already been submitted. Please continue with the questions on screen.' });
    }
    const misaligned = pending.findIndex((q, i) => {
      const sent = roundAnswers[i]?.questionText;
      return typeof sent === 'string' && sent.trim() && sent.trim() !== q.questionText.trim();
    });
    if (misaligned !== -1) {
      return res.status(409).json({ error: 'These answers are for an earlier set of questions. Please continue with the questions on screen.' });
    }

    // Mixed grading. MCQ = index compare (sync); written = AI-graded (async),
    // binarised at the 60% diagnostic bar. We AWAIT ALL gradings before touching
    // chapter stats or the stop decision — the roadmap is generated from the
    // weak/strong split, so an ungraded question leaking through would corrupt it.
    await Promise.all(pending.map(async (sq, i) => {
      const ans = roundAnswers[i] || {};

      if (sq.type === 'written') {
        const studentAnswer = (ans && typeof ans.writtenAnswer === 'string')
          ? ans.writtenAnswer
          : (typeof ans === 'string' ? ans : '');
        const graded = await gradeWritten({
          questionText: sq.questionText,
          expectedPoints: sq.expectedPoints,
          studentAnswer,
          style: sq.writtenStyle
        });
        sq.writtenAnswer = studentAnswer;
        sq.writtenScores = { content: graded.content, grammar: graded.grammar, spelling: graded.spelling };
        sq.writtenOverall = graded.overall;
        sq.writtenFeedback = graded.feedback;
        sq.wasCorrect = graded.overall >= DIAGNOSTIC_WRITTEN_THRESHOLD;
        return;
      }

      const selected = Number.isInteger(ans.selectedIndex) ? ans.selectedIndex : null;
      sq.selectedIndex = selected;
      sq.wasCorrect = selected !== null && selected === sq.correctIndex;
    }));

    pending.forEach(sq => recordChapterAnswer(session, sq, sq.wasCorrect));
    session.gradedCount = session.questions.length;

    const askedMcq = session.questions.filter(q => q.type !== 'written').length;
    const stop = shouldStop({
      chapters: session.blueprintChapters,
      stats: session.chapterStats || {},
      askedMcq,
      mcqMin: session.mcqMin,
      mcqMax: session.mcqMax
    });

    // ── Still gathering information → serve another MCQ round ───────────────
    if (!stop) {
      const specs = planNextRound({
        chapters: session.blueprintChapters,
        stats: session.chapterStats || {},
        askedMcq,
        mcqMax: session.mcqMax
      });

      if (specs.length) {
        try {
          // Consume anything warmed while the student was answering, then generate
          // only the slots it could not cover.
          const warm = await takePrefetched(session._id);
          const used = new Set();
          const fromWarm = new Map();
          for (const spec of specs) {
            const hit = warm.find(q => q.chapterId === spec.chapter.id && !used.has(q));
            if (hit) { used.add(hit); fromWarm.set(spec.chapter.id, hit); }
          }
          const toGenerate = specs.filter(s => !fromWarm.has(s.chapter.id));
          if (fromWarm.size) {
            console.log(`Round prefetch hit: ${fromWarm.size}/${specs.length} question(s) already warm.`);
          }

          let generated = [];
          if (toGenerate.length) {
            generated = await generateRound({
              grade: session.grade,
              subject: session.subject,
              subSubject: session.subSubject,
              blueprint: {
                chapters: session.blueprintChapters,
                difficultyAnchor: session.difficultyAnchor,
                exemplars: session.exemplars
              },
              specs: toGenerate,
              // Include the warmed stems so a generated question cannot duplicate one.
              askedStems: [...session.questions.map(q => q.questionText), ...fromWarm.values()].map(
                q => (typeof q === 'string' ? q : q.questionText)
              )
            });
            await attachDiagrams(generated, {
              grade: session.grade, subject: session.subject,
              subSubject: session.subSubject, chapters: session.blueprintChapters
            });
          }

          // Re-assemble in the planner's chapter order.
          const byChapter = new Map(generated.map(q => [q.chapterId, q]));
          const next = specs
            .map(s => fromWarm.get(s.chapter.id) || byChapter.get(s.chapter.id))
            .filter(Boolean);
          if (!next.length) throw new Error('No questions available for the next round.');

          const { startIndex, translated } = await appendRound(session, next, isHindiRequested);
          await session.save();

          res.json({
            status: 'continue',
            questions: session.questions.slice(startIndex).map(toClientQuestion),
            translatedHindiQuestions: isHindiRequested ? translated : [],
            progress: progressOf(session)
          });
          schedulePrefetch(session);
          return;
        } catch (err) {
          // A mid-quiz generation failure must not discard the student's answers.
          // Everything asked so far is already graded and stored, and we are past
          // the minimum, so completing on what we have is honest and useful.
          console.warn('Diagnostic next-round generation failed:', err.message);
          if (askedMcq === 0) return res.status(503).json({ error: GENERATION_UNAVAILABLE });
        }
      }
    }

    // ── Stop condition met → serve the opt-in written questions once ────────
    if (session.includeWritten && !session.writtenServed) {
      session.writtenServed = true;
      const mcqTopics = [...new Set(session.questions.filter(q => q.type !== 'written').map(q => q.topic).filter(Boolean))];
      // Target the chapters we are least confident about — the written question is
      // the last piece of signal we get, so spend it where it is worth most.
      const stats = session.chapterStats || {};
      const weakest = [...session.blueprintChapters]
        .sort((a, b) => (chapterAccuracy(stats[a.id]) ?? 1) - (chapterAccuracy(stats[b.id]) ?? 1))
        .slice(0, DIAGNOSTIC_WRITTEN_COUNT);

      const written = await generateWritten(
        session.grade, session.subject,
        subjectScopeLabel(session.subject, session.subSubject),
        DIAGNOSTIC_WRITTEN_COUNT,
        writtenStyleFor(session.subject, session.subSubject),
        mcqTopics,
        {
          difficultyAnchor: session.difficultyAnchor,
          exemplars: session.exemplars,
          chapters: weakest
        }
      );

      if (written.length) {
        const writtenQuestions = written.map((w, i) => ({
          type: 'written',
          questionText: w.questionText,
          topic: w.topic || 'General',
          expectedPoints: w.expectedPoints,
          writtenStyle: w.writtenStyle,
          chapterId: weakest[i % Math.max(1, weakest.length)]?.id || '',
          difficulty: 'medium'
        }));
        const { startIndex, translated } = await appendRound(session, writtenQuestions, isHindiRequested);
        await session.save();

        return res.json({
          status: 'continue',
          questions: session.questions.slice(startIndex).map(toClientQuestion),
          translatedHindiQuestions: isHindiRequested ? translated : [],
          progress: progressOf(session)
        });
      }
      // Written generation failed — complete MCQ-only rather than blocking the
      // student. Their MCQ answers are already graded and stored.
      console.warn('Diagnostic written-question generation returned nothing; completing MCQ-only.');
    }

    // ── Complete → build the DiagnosticResult in the existing shape ─────────
    session.isComplete = true;
    session.used = true;
    await session.save();

    const fullQuestions = session.questions.map((sq) => {
      const q = sq.toObject ? sq.toObject() : sq;
      const topic = q.topic || 'General';
      const diagram = (q.diagram && q.diagram.svg)
        ? { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' }
        : undefined;

      if (q.type === 'written') {
        return {
          type: 'written',
          questionText: q.questionText,
          topic,
          chapterId: q.chapterId || '',
          difficulty: q.difficulty || '',
          isCorrect: !!q.wasCorrect,
          writtenAnswer: q.writtenAnswer || '',
          writtenStyle: q.writtenStyle,
          writtenScores: q.writtenScores,
          writtenOverall: q.writtenOverall,
          writtenFeedback: q.writtenFeedback,
          expectedPoints: q.expectedPoints || [],
          explanation: '',
          ...(diagram ? { diagram } : {})
        };
      }
      return {
        type: 'mcq',
        questionText: q.questionText,
        options: q.options,
        selectedIndex: Number.isInteger(q.selectedIndex) ? q.selectedIndex : -1,
        correctIndex: q.correctIndex,
        isCorrect: !!q.wasCorrect,
        topic,
        chapterId: q.chapterId || '',
        difficulty: q.difficulty || '',
        explanation: '',
        ...(diagram ? { diagram } : {})
      };
    });

    // Track 4.1: bucket topics by normalizeTopic (the SAME rule the roadmap's
    // weak-topic aggregation uses) so casing/whitespace variants of one topic MERGE
    // instead of splitting into separate weak/strong entries. The first-seen ORIGINAL
    // label is kept for display — normalized (lowercased) strings are never surfaced.
    let score = 0;
    const topicStats = {}; // normalizedKey -> { label, correct, total }
    for (const fq of fullQuestions) {
      if (fq.isCorrect) score += 1;
      const key = normalizeTopic(fq.topic);
      if (!key) continue;
      if (!topicStats[key]) topicStats[key] = { label: fq.topic || 'General', correct: 0, total: 0 };
      topicStats[key].total += 1;
      if (fq.isCorrect) topicStats[key].correct += 1;
    }

    // Explanations are MCQ-only (written questions carry AI feedback instead).
    const mcqOnly = fullQuestions.filter(q => q.type !== 'written');
    const explanations = await callGroqForExplanations(mcqOnly);
    mcqOnly.forEach((mq, i) => {
      mq.explanation = (explanations && explanations[i])
        ? explanations[i]
        : `The correct answer is Option ${String.fromCharCode(65 + mq.correctIndex)}: "${mq.options[mq.correctIndex]}".`;
    });

    const weakTopics = [];
    const strongTopics = [];
    Object.values(topicStats).forEach(s => {
      const accuracy = s.correct / s.total;
      if (accuracy < 0.5) weakTopics.push(s.label);   // original label, not the key
      if (accuracy >= 0.75) strongTopics.push(s.label);
    });

    // AMBIGUITY MUST FAIL SAFE TOWARD MORE TEACHING.
    // A chapter we probed but ran out of budget on sits near 50% — we are NOT
    // confident the student knows it. Dropping it would silently remove it from the
    // roadmap on the strength of no conclusion, so every unresolved chapter is added
    // to weakTopics and earns roadmap days. Untouched chapters are a different case
    // (no evidence at all, rather than inconclusive evidence) and are reported in
    // `chapterCoverage` instead of being guessed at.
    const coverage = coverageOf(session.blueprintChapters, session.chapterStats || {});
    for (const chapterName of coverage.unresolvedChapters) {
      if (!weakTopics.some(w => normalizeTopic(w) === normalizeTopic(chapterName))) {
        weakTopics.push(chapterName);
      }
    }
    if (coverage.unresolvedChapters.length) {
      console.log(`Diagnostic ${session._id}: ${coverage.unresolvedChapters.length} chapter(s) unresolved at stop — treated as weak.`);
    }
    console.log(
      `Diagnostic ${session._id} complete: ${fullQuestions.length} questions, ` +
      `chapters touched ${coverage.touched}/${coverage.total} (resolved ${coverage.resolved}).`
    );

    const recommendation = weakTopics.length > 0
      ? `Focus on ${weakTopics.join(', ')} — you scored lower in these topics and need extra targeted practice.`
      : `Great performance! You have a solid grasp of foundational ${session.subject} concepts.`;

    const diagnosticResult = await DiagnosticResult.create({
      userId: req.userId,
      grade: session.grade,
      subject: session.subject,
      subSubject: session.subSubject || '',
      questions: fullQuestions,
      weakTopics,
      strongTopics,
      recommendation,
      score,
      totalQuestions: fullQuestions.length,
      chapterCoverage: coverage
    });

    roundPrefetch.delete(String(session._id));   // session is over — drop any warm round
    res.status(201).json({ status: 'complete', result: diagnosticResult });
  } catch (error) {
    console.error('Diagnostic submit error:', error);
    res.status(500).json({ error: 'Server error saving diagnostic result.' });
  }
});

// POST /api/diagnostic/session/:id/translate
// Mid-quiz language switch. Before the adaptive rewrite the client re-called
// /generate with lang=hi, which now would abandon the in-flight session and
// re-roll the whole quiz — so an in-place session translation is unavoidable.
// Ownership-checked; caches onto the session so a second switch is free.
router.post('/session/:id/translate', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const session = await DiagnosticSession.findById(req.params.id);
    if (!session || session.userId.toString() !== req.userId) {
      return res.status(404).json({ error: 'Diagnostic session not found.' });
    }

    const cached = session.translatedHindiQuestions || [];
    const complete = cached.length === session.questions.length
      && cached.every(t => t && t.questionText);
    if (!complete) {
      session.translatedHindiQuestions = await translateDiagnosticQuestions(session.questions);
      await session.save();
    }

    res.json({ translatedHindiQuestions: session.translatedHindiQuestions });
  } catch (error) {
    console.error('Translate diagnostic session error:', error);
    res.status(500).json({ error: 'Server error translating diagnostic questions.' });
  }
});

// POST /api/diagnostic/:id/translate (Phase 10 Sarvam Translate for Review)
router.post('/:id/translate', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const result = await DiagnosticResult.findById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Diagnostic result not found.' });
    }
    if (result.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to diagnostic result.' });
    }

    if (result.translatedHindiQuestions && result.translatedHindiQuestions.length === result.questions.length && result.translatedHindiRecommendation) {
      return res.json(result);
    }

    const translatedQs = await translateDiagnosticQuestions(result.questions);
    const translatedRec = await translateTextWithSarvam(result.recommendation);

    result.translatedHindiQuestions = translatedQs;
    result.translatedHindiRecommendation = translatedRec;
    await result.save();

    res.json(result);
  } catch (error) {
    console.error('Translate diagnostic result error:', error);
    res.status(500).json({ error: 'Server error translating diagnostic result.' });
  }
});

// GET /api/diagnostic/:id (JWT Protected + Ownership Check)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await DiagnosticResult.findById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Diagnostic result not found.' });
    }
    if (result.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to diagnostic result.' });
    }
    res.json(result);
  } catch (error) {
    console.error('Get diagnostic result error:', error);
    res.status(500).json({ error: 'Server error fetching diagnostic result.' });
  }
});

// Per-user sliding-window rate limiter for live audio (max 15 req/min per user)
const liveAudioRateLimitMap = new Map();

function checkLiveAudioRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 15;

  let userTimestamps = liveAudioRateLimitMap.get(userId) || [];
  userTimestamps = userTimestamps.filter(t => now - t < windowMs);

  if (userTimestamps.length >= maxRequests) {
    return false;
  }

  userTimestamps.push(now);
  liveAudioRateLimitMap.set(userId, userTimestamps);
  return true;
}

// GET /api/diagnostic/:id/question/:questionIndex/audio (Review Page Cached Audio)
router.get('/:id/question/:questionIndex/audio', authMiddleware, async (req, res) => {
  try {
    const { id, questionIndex } = req.params;
    const wantHindi = req.query.lang === 'hi';
    const idx = parseInt(questionIndex, 10);

    const result = await DiagnosticResult.findById(id);
    if (!result) {
      return res.status(404).json({ error: 'Diagnostic result not found.' });
    }

    if (result.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to diagnostic audio.' });
    }

    if (idx < 0 || idx >= result.questions.length) {
      return res.status(404).json({ error: 'Question index out of bounds.' });
    }

    const q = result.questions[idx];
    let hindiQ = (wantHindi && result.translatedHindiQuestions && result.translatedHindiQuestions.length > idx)
      ? result.translatedHindiQuestions[idx]
      : null;
    let effectiveHindi = wantHindi;

    // Hindi narration requested but no cached Hindi text (e.g. narrating Hindi over an
    // English-displayed review) → translate on demand and PERSIST it so later reads
    // skip the call. If the translate itself fails, degrade to English narration + log
    // (rather than speaking English text with a Hindi voice).
    if (wantHindi && !(hindiQ && hindiQ.questionText)) {
      try {
        const tStem = await translateTextWithSarvam(q.questionText);
        if (tStem && tStem.trim()) {
          const tOpts = await Promise.all((q.options || []).map((o) => translateTextWithSarvam(o)));
          const tAlt = (q.diagram && q.diagram.alt) ? await translateTextWithSarvam(q.diagram.alt, 'hi-IN', 1, { maskMath: false }) : '';   // alt text: pronounceable, see line ~58
          hindiQ = {
            questionText: tStem,
            options: (q.options || []).map((o, i) => (tOpts[i] && tOpts[i].trim()) ? tOpts[i] : o),
            explanation: '',
            diagramAlt: (tAlt && tAlt.trim()) ? tAlt : ''
          };
          if (!Array.isArray(result.translatedHindiQuestions)) result.translatedHindiQuestions = [];
          result.translatedHindiQuestions[idx] = hindiQ;
          result.markModified('translatedHindiQuestions');
        } else {
          console.warn(`diag audio q${idx}: en→hi translation failed — narrating English instead of Hindi.`);
          effectiveHindi = false;
        }
      } catch (err) {
        console.warn(`diag audio q${idx}: en→hi translation error — narrating English.`, err.message);
        effectiveHindi = false;
      }
    }

    const targetLang = effectiveHindi ? 'hi-IN' : 'en-IN';
    const fieldName = effectiveHindi ? 'audioQuestionHi' : 'audioQuestionEn';
    const stem = (effectiveHindi && hindiQ?.questionText) ? hindiQ.questionText : q.questionText;
    // Written questions have no options — read only the prompt (guard the .map).
    const options = (effectiveHindi && hindiQ?.options && hindiQ.options.length > 0) ? hindiQ.options : (q.options || []);

    // Workstream D: a student using narration must hear the figure described, so the
    // diagram's alt text is prepended to the spoken text.
    const altText = effectiveHindi
      ? ((hindiQ?.diagramAlt || q.diagram?.altHindi || q.diagram?.alt) || '')
      : (q.diagram?.alt || '');
    const spokenStem = altText ? `${altText}. ${stem}` : stem;

    const textToSpeak = formatQuestionForTTS(spokenStem, options, effectiveHindi ? 'hi' : 'en');

    const textHash = generateContentHash(textToSpeak);
    const filename = `diag-${id}-q${idx}-${effectiveHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (q[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: q[fieldName] });
    }

    // Synthesize audio
    const lockKey = `diag:${id}:q${idx}:${effectiveHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // fallbackLang IS REQUIRED, NOT OPTIONAL. The client speaks this text with the
      // browser voice, and without a language it defaults to the student PREFERENCE —
      // which is a proxy for "what language is this text in", and wrong exactly when the
      // text could not be translated. That is the A3 defect (English words in a Hindi
      // voice) at its third site. Send the language of the TEXT, always.
      return res.json({ useFallback: true, fallbackText: textToSpeak, fallbackLang: effectiveHindi ? 'hi' : 'en' });
    }

    const audioUrl = saveAudioFile(filename, audioBuffer);
    q[fieldName] = audioUrl;
    await result.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Diagnostic question audio error:', error);
    res.status(500).json({ error: 'Server error generating question audio.' });
  }
});

// POST /api/diagnostic/live-audio (Live Quiz On-Demand Audio)
router.post('/live-audio', authMiddleware, async (req, res) => {
  try {
    const { questionText, options, language } = req.body;
    // ── A3: what language the SUPPLIED TEXT is actually in ───────────────────
    //
    // `language` is the site toggle, and using it here was the defect: the toggle says
    // what the student PREFERS, not what this string IS. A student on the Hindi toggle
    // whose question has no cached Hindi is shown English text, so the toggle said 'hi'
    // about an English sentence, translation was skipped as unnecessary, and the
    // narration spoke English words — on some questions and not others, tracking which
    // ones happened to have a cached translation.
    //
    // `sourceLang` is sent by the client, which KNOWS: it chose between the Hindi and
    // the English string one line before building this payload.
    //
    // Falls back to the toggle when absent, so an older client (or a cached bundle
    // mid-deploy) behaves exactly as it does today rather than breaking.
    const displayedLang = (req.body.sourceLang === 'hi' || req.body.sourceLang === 'en')
      ? req.body.sourceLang
      : (language === 'hi' ? 'hi' : 'en');
    // Resolved narration language (Phase 2 table, sent by the client). Defaults to
    // the displayed language when absent.
    let narrateLang = (req.body.narrationLang === 'hi' || req.body.narrationLang === 'en')
      ? req.body.narrationLang : displayedLang;

    // Per-user rate limiting check
    if (!checkLiveAudioRateLimit(req.userId)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before requesting more audio.' });
    }

    if (!questionText) {
      return res.status(400).json({ error: 'questionText is required.' });
    }

    let stem = questionText;
    let optsList = Array.isArray(options) ? options : [];
    // Workstream D: the client sends the figure's alt text so narration describes it.
    let altText = typeof req.body.diagramAlt === 'string' ? req.body.diagramAlt.trim() : '';

    // Translate-on-demand when the narration language differs from the LANGUAGE THE
    // TEXT IS ACTUALLY IN. The decision is a pure function (utils/narrationLang.js) and
    // is asserted in CI, because this path is shared by every grade and every subject.
    const plan = resolveSpeakPlan({ sourceLang: displayedLang, narrationLang: narrateLang });
    if (plan.needsTranslation) {
      if (narrateLang === 'hi') {
        // en → hi is supported. On failure, degrade to narrating the displayed text
        // (still reaches SOMETHING for the student) and log it.
        try {
          const tStem = await translateTextWithSarvam(questionText);
          if (tStem && tStem.trim()) {
            const tOpts = await Promise.all(optsList.map((o) => translateTextWithSarvam(o)));
            stem = tStem;
            optsList = optsList.map((o, i) => (tOpts[i] && tOpts[i].trim()) ? tOpts[i] : o);
            if (altText) {
              const tAlt = await translateTextWithSarvam(altText);
              if (tAlt && tAlt.trim()) altText = tAlt;
            }
          } else {
            console.warn('live-audio: en→hi translation failed — narrating the text in its own language instead of the requested one.');
            narrateLang = speakLangAfterTranslationFailure(displayedLang);
          }
        } catch (err) {
          console.warn('live-audio: en→hi translation error — narrating the text in its own language.', err.message);
          narrateLang = speakLangAfterTranslationFailure(displayedLang);
        }
      } else {
        // hi → en is NOT supported (translateTextWithSarvam is en→hi only). Known,
        // documented gap: the student chose English narration but the live content is
        // Hindi. Degrade to the displayed (hi) text and log it EXPLICITLY so it leaves
        // a clear trail (see PRODUCTION_CHECKLIST — this actively differs from the
        // student's stated preference, unlike a plain translate failure).
        console.warn('live-audio: hi→en translation unsupported; narrating the Hindi text in a Hindi voice rather than Hindi words in an English voice.');
        narrateLang = plan.speakLang;
      }
    }

    const isHindi = narrateLang === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';
    const textToSpeak = formatQuestionForTTS(altText ? `${altText}. ${stem}` : stem, optsList, isHindi ? 'hi' : 'en');

    const textHash = generateContentHash(textToSpeak);
    const filename = `live-q-${isHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Check temp disk cache first
    if (audioFileExists(filename, true)) {
      return res.json({ audioUrl: `/uploads/audio/temp/${filename}` });
    }

    const lockKey = `live:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // fallbackLang IS REQUIRED, NOT OPTIONAL. The client speaks this text with the
      // browser voice, and without a language it defaults to the student PREFERENCE —
      // which is a proxy for "what language is this text in", and wrong exactly when the
      // text could not be translated. That is the A3 defect (English words in a Hindi
      // voice) at its third site. Send the language of the TEXT, always.
      return res.json({ useFallback: true, fallbackText: textToSpeak, fallbackLang: isHindi ? 'hi' : 'en' });
    }

    const audioUrl = saveAudioFile(filename, audioBuffer, true);
    res.json({ audioUrl });
  } catch (error) {
    console.error('Live audio synthesis error:', error);
    res.status(500).json({ error: 'Server error generating live audio.' });
  }
});

export default router;