import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import PracticeSession from '../models/PracticeSession.js';
import { translateQuestionsArray } from '../utils/translateAndCache.js';
import { recordStudyActivity } from '../utils/recordActivity.js';

const router = express.Router();

const PRACTICE_QUESTIONS = 10;

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

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9, // high, for practice variety (module quiz uses 0.4)
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) throw new Error(`Groq API responded with status ${response.status}`);
  const jsonResponse = await response.json();
  return JSON.parse(jsonResponse.choices?.[0]?.message?.content || '{}');
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
async function ensurePracticeHindi(session) {
  const pending = session.questions.filter(q => !q.hindiTranslated);
  if (pending.length === 0) return false;

  const translated = await translateQuestionsArray(
    pending.map(q => ({ questionText: q.questionText, options: q.options, explanation: q.explanation }))
  );

  let changed = false;
  pending.forEach((q, i) => {
    const tr = translated[i];
    if (tr && tr.questionText && tr.questionText.trim() !== q.questionText.trim()) {
      q.translatedHindiQuestionText = tr.questionText;
      q.translatedHindiOptions = (tr.options && tr.options.length === q.options.length) ? tr.options : q.options;
      q.translatedHindiExplanation = tr.explanation || q.explanation || '';
      q.hindiTranslated = true;
      changed = true;
    }
  });
  return changed;
}

function serializePracticeQuestion(q, idx, isHindi) {
  const useHi = isHindi && q.hindiTranslated;
  return {
    index: idx,
    questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
    options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
    topic: q.topic
  };
}

// POST /api/practice/generate  { grade, subject, topic }
// Generates a fresh practice quiz and stores it as a session for later scoring.
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { grade, subject, topic } = req.body;
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

    const session = await PracticeSession.create({
      userId: req.userId,
      grade: grade || '',
      subject,
      topic,
      questions: quizData.questions.slice(0, PRACTICE_QUESTIONS).map(q => ({
        questionText: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        topic: topic,
        explanation: q.explanation || ''
      }))
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
router.post('/submit', authMiddleware, async (req, res) => {
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

    let score = 0;
    const review = session.questions.map((q, idx) => {
      const selectedIndex = (answers[idx] && typeof answers[idx].selectedIndex === 'number')
        ? answers[idx].selectedIndex
        : (typeof answers[idx] === 'number' ? answers[idx] : -1);
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) score += 1;
      const useHi = isHindi && q.hindiTranslated;
      return {
        questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
        options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: useHi ? (q.translatedHindiExplanation || q.explanation || '') : (q.explanation || '')
      };
    });

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
