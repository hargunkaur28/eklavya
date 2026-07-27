import express from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import DiagnosticSession from '../models/DiagnosticSession.js';
import { translateQuestionsArray, translateTextWithSarvam } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash } from '../utils/textToSpeech.js';
import { gradeWritten } from '../utils/gradeWritten.js';
import { generateWritten, writtenStyleFor } from '../utils/generateWritten.js';
import { normalizeTopic } from '../utils/weakTopics.js';
import { subjectScopeLabel, isWrittenHeavy, isKnownSubSubject, hasSubSubjects } from '../config/taxonomy.js';
import { formatQuestionForTTS } from '../utils/ttsNormalize.js';

const router = express.Router();

// Track 3: opt-in written questions in the diagnostic (per-session, since a
// diagnostic is a fresh session — unlike the cached module quiz). Binarised at
// 60% (the diagnostic bar) so a written miss feeds the weak/strong split exactly
// like a wrong MCQ.
const DIAGNOSTIC_WRITTEN_COUNT = 2;
const DIAGNOSTIC_WRITTEN_THRESHOLD = 60;

// Translate a MIXED question array (MCQ + written) to Hindi, index-aligned.
// MCQ uses the option-order-preserving path; written has no options, so it uses
// the prompt-only Sarvam path (same split as practice.js). Feedback stays English.
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
    if (q.type === 'written') {
      const tp = await translateTextWithSarvam(q.questionText);
      out[i] = { questionText: (tp && tp.trim()) ? tp : q.questionText, options: [] };
    } else {
      out[i] = translatedMcq[mcqSlot[i]] || { questionText: q.questionText, options: q.options };
    }
  }
  return out;
}

// Hand-written quiz question banks for exact matches
const handWrittenQuizzes = {
  'class 10_science': [
    { question: 'In a balanced chemical equation, the total number of atoms of each element is equal on both sides because of:', options: ['law of conservation of mass', 'law of reflection', 'law of gravitation', 'law of dominance'], correctIndex: 0, topic: 'Chemical Reactions' },
    { question: 'A solution turns blue litmus red. The solution is most likely:', options: ['acidic', 'basic', 'neutral', 'saline only'], correctIndex: 0, topic: 'Acids & Bases' },
    { question: 'The functional unit of the kidney is called:', options: ['neuron', 'nephron', 'alveolus', 'villus'], correctIndex: 1, topic: 'Life Processes' },
    { question: 'For a metallic conductor at constant temperature, current is directly proportional to:', options: ['resistance', 'voltage', 'length only', 'density'], correctIndex: 1, topic: 'Electricity' },
    { question: 'The image formed by a plane mirror is always:', options: ['real and inverted', 'virtual and erect', 'real and enlarged', 'virtual and diminished'], correctIndex: 1, topic: 'Light & Optics' },
    { question: 'In human digestion, bile helps mainly in the digestion of:', options: ['fats', 'proteins', 'starch', 'vitamins'], correctIndex: 0, topic: 'Digestion' }
  ],
  'class 11_jee': [
    { question: 'The dimensional formula of force is:', options: ['MLT^-2', 'ML^2T^-2', 'ML^-1T^-2', 'M^0LT^-1'], correctIndex: 0, topic: 'Units & Dimensions' },
    { question: 'If acceleration is constant, the graph of velocity versus time is:', options: ['a straight line', 'a circle', 'a parabola always', 'a hyperbola'], correctIndex: 0, topic: 'Kinematics' },
    { question: 'For a projectile launched on level ground, maximum range occurs at:', options: ['30 degrees', '45 degrees', '60 degrees', '90 degrees'], correctIndex: 1, topic: 'Projectile Motion' },
    { question: 'The roots of x^2 - 5x + 6 = 0 are:', options: ['1 and 6', '2 and 3', '-2 and -3', '0 and 5'], correctIndex: 1, topic: 'Quadratic Equations' },
    { question: 'The derivative of x^2 with respect to x is:', options: ['x', '2x', 'x^3', '2'], correctIndex: 1, topic: 'Calculus' },
    { question: 'Work done by a force is zero when force and displacement are:', options: ['parallel', 'anti-parallel', 'perpendicular', 'equal in magnitude'], correctIndex: 2, topic: 'Work & Energy' }
  ],
  'class 12_neet': [
    { question: 'The powerhouse of the cell is the:', options: ['ribosome', 'mitochondrion', 'Golgi body', 'lysosome'], correctIndex: 1, topic: 'Cell Biology' },
    { question: 'The primary pigment involved in photosynthesis is:', options: ['chlorophyll a', 'xanthophyll', 'carotene', 'anthocyanin'], correctIndex: 0, topic: 'Photosynthesis' },
    { question: 'The functional unit of heredity is:', options: ['gene', 'ribosome', 'nucleus', 'chromatid'], correctIndex: 0, topic: 'Genetics' },
    { question: 'In humans, oxygen is transported mainly by:', options: ['plasma water', 'haemoglobin', 'platelets', 'lymphocytes'], correctIndex: 1, topic: 'Human Physiology' },
    { question: 'The enzyme that begins starch digestion in the mouth is:', options: ['pepsin', 'trypsin', 'salivary amylase', 'lipase'], correctIndex: 2, topic: 'Enzymes & Digestion' },
    { question: 'A group of individuals of the same species living in an area is called a:', options: ['community', 'population', 'biome', 'ecosystem'], correctIndex: 1, topic: 'Ecology' }
  ]
};

function validateGroqQuizJSON(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) return false;
  if (data.questions.length < 5 || data.questions.length > 8) return false;
  for (const q of data.questions) {
    if (!q.question || typeof q.question !== 'string') return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) return false;
  }
  return true;
}

async function callGroqForQuiz(grade, subject, subSubject) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  // Scope the quiz to the chosen sub-subject (or all areas for Fusion/Combined).
  const scope = subjectScopeLabel(subject, subSubject);
  const prompt = `Generate a diagnostic quiz for Grade: "${grade}" and Subject: "${scope}".
Return ONLY a valid JSON object matching this exact shape:
{
  "questions": [
    {
      "question": "Clear multiple choice question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "topic": "Short topic name"
    }
  ]
}
Provide exactly 6 multiple choice questions covering foundational concepts for ${grade} ${scope}. Every question must be about ${scope} — do NOT drift to other areas of ${subject}.
CRITICAL ACCURACY RULE: Double check all math and facts. correctIndex MUST be the exact 0-based integer index (0, 1, 2, or 3) of the option containing the mathematically and scientifically true correct answer. No markdown formatting, raw JSON only.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API responded with status ${response.status}`);
  }

  const jsonResponse = await response.json();
  const content = jsonResponse.choices?.[0]?.message?.content;
  return JSON.parse(content);
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
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      if (Array.isArray(parsed.explanations) && parsed.explanations.length === questions.length) {
        return parsed.explanations;
      }
    }
  } catch (err) {
    console.warn('Batched explanations Groq call failed:', err.message);
  }

  return questions.map(q => `The correct answer is "${q.options[q.correctIndex]}".`);
}

// POST /api/diagnostic/generate
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

    const key = `${grade.toLowerCase()}_${subject.toLowerCase()}`;
    let rawQuestions = null;

    // Bypass the legacy static bank whenever a sub-subject is chosen — its key is
    // subject-level ('class 10_science'), so it would bleed the general-Science bank
    // into a Physics/Chemistry diagnostic. Sub-subject requests always generate fresh.
    if (!subSubject && handWrittenQuizzes[key]) {
      rawQuestions = handWrittenQuizzes[key];
    } else {
      let quizData = null;
      try {
        quizData = await callGroqForQuiz(grade, subject, subSubject);
        if (!validateGroqQuizJSON(quizData)) {
          console.warn('First Groq quiz validation failed, retrying once...');
          quizData = await callGroqForQuiz(grade, subject, subSubject);
        }
      } catch (groqErr) {
        console.warn('Groq quiz generation failed, using fallback bank:', groqErr.message);
      }

      if (quizData && validateGroqQuizJSON(quizData)) {
        rawQuestions = quizData.questions;
      } else {
        rawQuestions = [
          { question: `What is a fundamental concept in ${subject} for ${grade}?`, options: ['Basic Foundation', 'Advanced Theory', 'Hypothetical Model', 'Unrelated Topic'], correctIndex: 0, topic: 'Fundamentals' },
          { question: `Which method is most effective when studying ${subject}?`, options: ['Consistent Practice', 'Memorization only', 'Skipping exercises', 'Guesswork'], correctIndex: 0, topic: 'Study Methods' },
          { question: `When solving a complex problem in ${subject}, what is the first step?`, options: ['Identify given parameters', 'Write final answer immediately', 'Skip analysis', 'Guess option'], correctIndex: 0, topic: 'Problem Solving' },
          { question: `Why is active recall important in ${subject}?`, options: ['Enhances long-term memory retention', 'Wastes time', 'Decreases understanding', 'Makes tests harder'], correctIndex: 0, topic: 'Active Recall' },
          { question: `What is the role of periodic revision in ${subject}?`, options: ['Consolidates weak topics', 'Causes confusion', 'Is unnecessary', 'Replaces learning'], correctIndex: 0, topic: 'Revision' },
          { question: `How should quiz results in ${subject} be used?`, options: ['Target weak areas for improvement', 'Ignore feedback', 'Only celebrate correct answers', 'Stop practicing'], correctIndex: 0, topic: 'Self Assessment' }
        ];
      }
    }

    const mcqQuestions = rawQuestions.map(q => ({
      type: 'mcq',
      questionText: q.questionText || q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      topic: q.topic || 'General'
    }));

    // Track 3: opt-in written questions. Pass the MCQ topic labels as the canonical
    // list so written questions tag FROM those labels (verbatim) — they merge into
    // the same topic buckets as MCQs in the weak/strong split instead of creating
    // drift singletons that could over-weight the roadmap from one data point.
    // Written-heavy sub-subjects (English Writing/Fusion) auto-include written
    // questions; everything else only when the student opts in via the toggle.
    const includeWritten = req.body.includeWritten === true || isWrittenHeavy(subject, subSubject);
    let writtenQuestions = [];
    if (includeWritten) {
      const mcqTopics = [...new Set(mcqQuestions.map(q => q.topic).filter(Boolean))];
      const written = await generateWritten(
        grade, subject, subjectScopeLabel(subject, subSubject),
        DIAGNOSTIC_WRITTEN_COUNT, writtenStyleFor(subject, subSubject), mcqTopics
      );
      writtenQuestions = written.map(w => ({
        type: 'written',
        questionText: w.questionText,
        topic: w.topic || 'General',
        expectedPoints: w.expectedPoints,
        writtenStyle: w.writtenStyle
      }));
    }

    const sessionQuestions = [...mcqQuestions, ...writtenQuestions];

    const session = await DiagnosticSession.create({
      userId: req.userId,
      grade,
      subject,
      subSubject,
      questions: sessionQuestions
    });

    const clientQuestions = sessionQuestions.map(q => q.type === 'written'
      ? { type: 'written', question: q.questionText, questionText: q.questionText, writtenStyle: q.writtenStyle, topic: q.topic }
      : { type: 'mcq', question: q.questionText, questionText: q.questionText, options: q.options, topic: q.topic });

    let translatedHindiQuestions = [];
    if (isHindiRequested) {
      translatedHindiQuestions = await translateDiagnosticQuestions(sessionQuestions);
    }

    res.json({
      quizSessionId: session._id,
      questions: clientQuestions,
      translatedHindiQuestions
    });
  } catch (error) {
    console.error('Diagnostic generate error:', error);
    res.status(500).json({ error: 'Server error generating diagnostic quiz.' });
  }
});

// POST /api/diagnostic/submit
router.post('/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { quizSessionId, grade, subject, answers } = req.body;
    if (!quizSessionId) {
      return res.status(400).json({ error: 'quizSessionId is required for submission.' });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers array is required.' });
    }

    const session = await DiagnosticSession.findById(quizSessionId);
    if (!session || session.used || session.userId.toString() !== req.userId) {
      return res.status(410).json({ error: 'Quiz session expired or invalid. Please regenerate and retake your diagnostic test.' });
    }

    session.used = true;
    await session.save();

    let finalGrade = grade || session.grade;
    let finalSubject = subject || session.subject;
    const finalSubSubject = session.subSubject || ''; // carried from the session (never client-trusted)

    // Track 3: mixed grading. MCQ = index compare (sync); written = AI-graded
    // (async), binarised at the 60% diagnostic bar. We AWAIT ALL gradings to
    // resolve BEFORE computing score, per-topic stats, and the weak/strong split —
    // because the roadmap is later generated FROM that split, an ungraded written
    // question leaking into the split would silently corrupt the whole roadmap.
    // This is the highest-stakes seam in the diagnostic path.
    const fullQuestions = await Promise.all(session.questions.map(async (sq, idx) => {
      const ans = answers[idx] || {};
      const topic = sq.topic || 'General';

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
        return {
          type: 'written',
          questionText: sq.questionText,
          topic,
          isCorrect: graded.overall >= DIAGNOSTIC_WRITTEN_THRESHOLD,
          writtenAnswer: studentAnswer,
          writtenStyle: sq.writtenStyle,
          writtenScores: { content: graded.content, grammar: graded.grammar, spelling: graded.spelling },
          writtenOverall: graded.overall,
          writtenFeedback: graded.feedback,
          expectedPoints: sq.expectedPoints || [],
          explanation: ''
        };
      }

      const userSelected = ans.selectedIndex !== undefined ? ans.selectedIndex : 0;
      return {
        type: 'mcq',
        questionText: sq.questionText,
        options: sq.options,
        selectedIndex: userSelected,
        correctIndex: sq.correctIndex,
        isCorrect: userSelected === sq.correctIndex,
        topic,
        explanation: ''
      };
    }));

    // Every grading above is resolved — now it is safe to compute score + split.
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
    // Filtering avoids callGroqForExplanations dereferencing options[correctIndex]
    // on a written question. References are shared, so this mutates fullQuestions.
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

    let recommendation = '';
    if (weakTopics.length > 0) {
      recommendation = `Focus on ${weakTopics.join(', ')} — you scored lower in these topics and need extra targeted practice.`;
    } else {
      recommendation = `Great performance! You have a solid grasp of foundational ${finalSubject} concepts.`;
    }

    const diagnosticResult = await DiagnosticResult.create({
      userId: req.userId,
      grade: finalGrade,
      subject: finalSubject,
      subSubject: finalSubSubject,
      questions: fullQuestions,
      weakTopics,
      strongTopics,
      recommendation,
      score,
      totalQuestions: fullQuestions.length
    });

    res.status(201).json(diagnosticResult);
  } catch (error) {
    console.error('Diagnostic submit error:', error);
    res.status(500).json({ error: 'Server error saving diagnostic result.' });
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
          hindiQ = {
            questionText: tStem,
            options: (q.options || []).map((o, i) => (tOpts[i] && tOpts[i].trim()) ? tOpts[i] : o),
            explanation: ''
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

    const textToSpeak = formatQuestionForTTS(stem, options, effectiveHindi ? 'hi' : 'en');

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
      // Sarvam (+ OpenAI for Hindi) all failed → hand the text to the client so it can
      // Web-Speak it, rather than erroring with no fallback text.
      return res.json({ useFallback: true, fallbackText: textToSpeak });
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
    const displayedLang = language === 'hi' ? 'hi' : 'en';
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

    // Translate-on-demand when the narration language differs from the supplied text.
    if (narrateLang !== displayedLang) {
      if (narrateLang === 'hi') {
        // en → hi is supported. On failure, degrade to narrating the displayed text
        // (still reaches SOMETHING for the student) and log it.
        try {
          const tStem = await translateTextWithSarvam(questionText);
          if (tStem && tStem.trim()) {
            const tOpts = await Promise.all(optsList.map((o) => translateTextWithSarvam(o)));
            stem = tStem;
            optsList = optsList.map((o, i) => (tOpts[i] && tOpts[i].trim()) ? tOpts[i] : o);
          } else {
            console.warn('live-audio: en→hi translation failed — narrated in displayed language (en) instead of requested (hi).');
            narrateLang = displayedLang;
          }
        } catch (err) {
          console.warn('live-audio: en→hi translation error — narrated in displayed language (en).', err.message);
          narrateLang = displayedLang;
        }
      } else {
        // hi → en is NOT supported (translateTextWithSarvam is en→hi only). Known,
        // documented gap: the student chose English narration but the live content is
        // Hindi. Degrade to the displayed (hi) text and log it EXPLICITLY so it leaves
        // a clear trail (see PRODUCTION_CHECKLIST — this actively differs from the
        // student's stated preference, unlike a plain translate failure).
        console.warn('live-audio: hi→en translation unsupported for live-audio; narrated in displayed language (hi) instead of requested preference (en).');
        narrateLang = displayedLang;
      }
    }

    const isHindi = narrateLang === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';
    const textToSpeak = formatQuestionForTTS(stem, optsList, isHindi ? 'hi' : 'en');

    const textHash = generateContentHash(textToSpeak);
    const filename = `live-q-${isHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Check temp disk cache first
    if (audioFileExists(filename, true)) {
      return res.json({ audioUrl: `/uploads/audio/temp/${filename}` });
    }

    const lockKey = `live:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // Sarvam API out of credits or unavailable -> signal frontend to use Web Speech API fallback
      return res.json({ useFallback: true, fallbackText: textToSpeak });
    }

    const audioUrl = saveAudioFile(filename, audioBuffer, true);
    res.json({ audioUrl });
  } catch (error) {
    console.error('Live audio synthesis error:', error);
    res.status(500).json({ error: 'Server error generating live audio.' });
  }
});

export default router;
