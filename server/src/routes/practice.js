import express from 'express';
import { callGroqChat } from '../utils/groqClient.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import PracticeSession from '../models/PracticeSession.js';
import { translateQuestionsArray, translateTextWithSarvam, hindiIsStale, TRANSLATION_REGISTER_VERSION } from '../utils/translateAndCache.js';
import { recordStudyActivity } from '../utils/recordActivity.js';
import { gradeWritten } from '../utils/gradeWritten.js';
import { generateWritten, writtenStyleFor } from '../utils/generateWritten.js';
import { attachDiagrams, rejectOrphanedFigureQuestions, DIAGRAM_SHARE_PRACTICE } from '../utils/generateDiagram.js';
import { subjectDiagramEligible } from '../config/taxonomy.js';

const router = express.Router();

const PRACTICE_QUESTIONS = 10;
const PRACTICE_WRITTEN_COUNT = 2;       // written questions mixed in when opted-in
const PRACTICE_WRITTEN_THRESHOLD = 60;  // low-stakes revision → lenient pass bar

// Phase 6: practice quizzes are generated FRESH per session (no per-topic cache),
// with a high temperature + a rotation seed so the same topic yields a different
// set each time — the opposite of the module quiz, which is cached per day.
async function callGroqForPracticeQuiz(grade, subject, topic, seed) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const prompt = `Generate a PRACTICE quiz for a student${grade ? ` in ${grade}` : ''} on the subject "${subject}", specifically the topic "${topic}".

This is open practice (revision), NOT a graded test. Variation seed: ${seed}. Produce a FRESH, DIFFERENT set of questions than you would for another seed — vary the specific numbers, scenarios, phrasings, and spread across easy/medium/hard. Every question must genuinely be about "${topic}".

Return ONLY valid JSON in exactly this shape:
{
  "questions": [
    {
      "question": "Clear question about ${topic}",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "topic": "${topic}",
      "explanation": "One sentence explaining why the correct option is right."
    }
  ]
}

Exactly ${PRACTICE_QUESTIONS} questions, exactly 4 options each. correctIndex is the 0-based index (0-3) of the correct option. ACCURACY IS CRITICAL: double-check every fact and that correctIndex points to the truly correct option. No markdown, raw JSON only.`;

  // Shared client → 70b → 8b → OpenAI + rate-limit circuit breaker.
  const raw = await callGroqChat(
    [{ role: 'user', content: prompt }],
    { jsonMode: true, temperature: 0.9 } // high, for practice variety (module quiz uses 0.4)
  );
  return JSON.parse(raw || '{}');
}

function validatePracticeQuizJSON(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) return false;
  if (data.questions.length < PRACTICE_QUESTIONS) return false;
  for (const q of data.questions) {
    if (!q.question || typeof q.question !== 'string') return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) return false;
  }
  return true;
}

// Localize a practice session's questions to Hindi (cached on the session).
// MCQ questions use the option-order-preserving path (translateQuestionsArray).
// Written questions use a DISTINCT branch — they have no options/index to keep
// order-stable, so we translate ONLY the prompt (Track 3). Grading feedback stays
// in English for now (flagged as a follow-on, like the notes-PDF Devanagari case).
async function ensurePracticeHindi(session) {
  // Retranslate anything cached under an OLDER register, not just anything
  // untranslated — otherwise practice keeps serving the formal register forever.
  const pendingAll = session.questions.filter((q) => hindiIsStale(q));
  if (pendingAll.length === 0) return false;

  let changed = false;

  const mcq = pendingAll.filter(q => q.type !== 'written');
  if (mcq.length) {
    const translated = await translateQuestionsArray(
      mcq.map(q => ({ questionText: q.questionText, options: q.options, explanation: q.explanation }))
    );
    mcq.forEach((q, i) => {
      const tr = translated[i];
      if (tr && tr.questionText && tr.questionText.trim() !== q.questionText.trim()) {
        q.translatedHindiQuestionText = tr.questionText;
        q.translatedHindiOptions = (tr.options && tr.options.length === q.options.length) ? tr.options : q.options;
        q.translatedHindiExplanation = tr.explanation || q.explanation || '';
        q.hindiTranslated = true;
        q.hindiRegisterVersion = TRANSLATION_REGISTER_VERSION;
        changed = true;
      }
    });
  }

  for (const q of pendingAll.filter(q => q.type === 'written')) {
    const tp = await translateTextWithSarvam(q.questionText);
    if (tp && tp.trim() !== q.questionText.trim()) {
      q.translatedHindiQuestionText = tp;
      q.hindiTranslated = true;
        q.hindiRegisterVersion = TRANSLATION_REGISTER_VERSION;
      changed = true;
    }
  }

  return changed;
}

function serializePracticeQuestion(q, idx, isHindi) {
  if (q.type === 'written') {
    return {
      index: idx,
      type: 'written',
      writtenStyle: q.writtenStyle,
      questionText: (isHindi && q.translatedHindiQuestionText) ? q.translatedHindiQuestionText : q.questionText,
      topic: q.topic
    };
  }
  const useHi = isHindi && q.hindiTranslated;
  return {
    index: idx,
    type: 'mcq',
    questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
    options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
    topic: q.topic,
    // Workstream D — sanitised server-side, rendered client-side as a data-URI <img>.
    ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {})
  };
}

// POST /api/practice/generate  { grade, subject, topic }
// Generates a fresh practice quiz and stores it as a session for later scoring.
router.post('/generate', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { grade, subject, topic } = req.body;
    const subSubject = typeof req.body.subSubject === 'string' ? req.body.subSubject.trim() : '';
    const isHindi = req.query.lang === 'hi' || req.body.language === 'hi';
    if (!subject || !topic) {
      return res.status(400).json({ error: 'subject and topic are required.' });
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    let quizData = null;
    try {
      quizData = await callGroqForPracticeQuiz(grade, subject, topic, seed);
      if (!validatePracticeQuizJSON(quizData)) {
        quizData = await callGroqForPracticeQuiz(grade, subject, topic, seed + 1);
      }
    } catch (err) {
      console.warn('Practice quiz generation failed:', err.message);
    }

    if (!quizData || !validatePracticeQuizJSON(quizData)) {
      return res.status(200).json({ available: false, reason: 'generation_failed' });
    }

    // Track 3: opt-in written questions (the toggle is wired in Phase 3.3).
    // Generate a couple of written questions and swap them in for MCQs so the
    // total stays PRACTICE_QUESTIONS. Falls back to MCQ-only if generation fails.
    const includeWritten = req.body.includeWritten === true;
    let writtenQs = [];
    if (includeWritten) {
      writtenQs = await generateWritten(grade, subject, topic, PRACTICE_WRITTEN_COUNT, writtenStyleFor(subject, subSubject));
    }
    const mcqCount = PRACTICE_QUESTIONS - writtenQs.length;
    const mcqQs = quizData.questions.slice(0, mcqCount).map(q => ({
      type: 'mcq',
      questionText: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      topic: topic,
      explanation: q.explanation || ''
    }));

    // ── Workstream D: figures, gated at SUBJECT level ──
    // Practice takes a free-text topic from the student, so there is nothing reliable
    // to resolve a chapter from — and guessing one via substring matching is the bug
    // that already bit the roadmap graft. Grammar and Economics contain no
    // diagram-eligible chapters, so they gate out here and never pay for a call.
    // Share is 0.20, below the module quiz's 0.35: practice regenerates every session,
    // so the cost is paid again on every attempt and is never amortised.
    let questions = [...mcqQs, ...writtenQs];
    if (subjectDiagramEligible(subject, subSubject)) {
      await attachDiagrams(questions, {
        grade, subject, subSubject,
        isEligible: () => true,          // subject-level decision, already made above
        topicLabel: topic,
        share: DIAGRAM_SHARE_PRACTICE
      });
    }
    // Same guard as the module quiz. A practice session is stored and re-read on
    // submit and review, so an orphaned figure reference persists here too.
    const { safe } = rejectOrphanedFigureQuestions(questions);
    questions = safe;

    const session = await PracticeSession.create({
      userId: req.userId,
      grade: grade || '',
      subject,
      subSubject,
      topic,
      questions
    });

    if (isHindi) {
      const changed = await ensurePracticeHindi(session);
      if (changed) await session.save();
    }

    res.status(201).json({
      available: true,
      sessionId: session._id,
      subject,
      topic,
      questions: session.questions.map((q, idx) => serializePracticeQuestion(q, idx, isHindi))
    });
  } catch (error) {
    console.error('Practice generate error:', error);
    res.status(500).json({ error: 'Server error generating practice quiz.' });
  }
});

// POST /api/practice/submit  { sessionId, answers }
// Scores the practice attempt and returns a full review. Does NOT touch any
// roadmap, day completion, or weak-topic aggregation.
router.post('/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { sessionId, answers, localDate } = req.body;
    const isHindi = req.query.lang === 'hi' || req.body.language === 'hi';
    if (!sessionId || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'sessionId and answers are required.' });
    }

    const session = await PracticeSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.userId) {
      return res.status(410).json({ error: 'Practice session expired or invalid. Please generate a new one.' });
    }

    // Mixed scoring: MCQ = index compare; written = AI-graded, binarised against
    // the practice threshold (grading is async, so this maps to promises).
    const review = await Promise.all(session.questions.map(async (q, idx) => {
      if (q.type === 'written') {
        const ans = answers[idx];
        const studentAnswer = (ans && typeof ans.writtenAnswer === 'string')
          ? ans.writtenAnswer
          : (typeof ans === 'string' ? ans : '');
        const graded = await gradeWritten({
          questionText: q.questionText,
          expectedPoints: q.expectedPoints,
          studentAnswer,
          style: q.writtenStyle
        });
        return {
          type: 'written',
          questionText: (isHindi && q.translatedHindiQuestionText) ? q.translatedHindiQuestionText : q.questionText,
          writtenStyle: q.writtenStyle,
          writtenAnswer: studentAnswer,
          expectedPoints: q.expectedPoints,
          scores: { content: graded.content, grammar: graded.grammar, spelling: graded.spelling },
          overall: graded.overall,
          feedback: graded.feedback,
          isCorrect: graded.overall >= PRACTICE_WRITTEN_THRESHOLD, // "reached threshold", not "right/wrong"
          threshold: PRACTICE_WRITTEN_THRESHOLD
        };
      }

      const selectedIndex = (answers[idx] && typeof answers[idx].selectedIndex === 'number')
        ? answers[idx].selectedIndex
        : (typeof answers[idx] === 'number' ? answers[idx] : -1);
      const isCorrect = selectedIndex === q.correctIndex;
      const useHi = isHindi && q.hindiTranslated;
      return {
        type: 'mcq',
        questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
        options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: useHi ? (q.translatedHindiExplanation || q.explanation || '') : (q.explanation || ''),
        // Workstream D — same figure in review as during the attempt.
        ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {})
      };
    }));

    const score = review.filter(r => r.isCorrect).length;

    session.used = true;
    await session.save();

    // Phase 8: a practice session counts as studying today.
    await recordStudyActivity(req.userId, localDate);

    res.json({ score, total: session.questions.length, subject: session.subject, topic: session.topic, questions: review });
  } catch (error) {
    console.error('Practice submit error:', error);
    res.status(500).json({ error: 'Server error submitting practice quiz.' });
  }
});

export default router;
