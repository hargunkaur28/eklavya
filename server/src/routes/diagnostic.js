import express from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import DiagnosticSession from '../models/DiagnosticSession.js';
import { translateQuestionsArray, translateTextWithSarvam } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash } from '../utils/textToSpeech.js';

const router = express.Router();

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

async function callGroqForQuiz(grade, subject) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const prompt = `Generate a diagnostic quiz for Grade: "${grade}" and Subject: "${subject}".
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
Provide exactly 6 multiple choice questions covering foundational concepts for ${grade} ${subject}.
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

    const key = `${grade.toLowerCase()}_${subject.toLowerCase()}`;
    let rawQuestions = null;

    if (handWrittenQuizzes[key]) {
      rawQuestions = handWrittenQuizzes[key];
    } else {
      let quizData = null;
      try {
        quizData = await callGroqForQuiz(grade, subject);
        if (!validateGroqQuizJSON(quizData)) {
          console.warn('First Groq quiz validation failed, retrying once...');
          quizData = await callGroqForQuiz(grade, subject);
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

    const sessionQuestions = rawQuestions.map(q => ({
      questionText: q.questionText || q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      topic: q.topic || 'General'
    }));

    const session = await DiagnosticSession.create({
      userId: req.userId,
      grade,
      subject,
      questions: sessionQuestions
    });

    const clientQuestions = sessionQuestions.map(q => ({
      question: q.questionText,
      questionText: q.questionText,
      options: q.options,
      topic: q.topic
    }));

    let translatedHindiQuestions = [];
    if (isHindiRequested) {
      translatedHindiQuestions = await translateQuestionsArray(sessionQuestions);
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

    let score = 0;
    const topicStats = {};

    const fullQuestions = answers.map((ans, idx) => {
      const sq = session.questions[idx];
      if (!sq) {
        throw new Error(`Question session mismatch at index ${idx}`);
      }

      const questionText = sq.questionText;
      const options = sq.options;
      const correctIndex = sq.correctIndex;
      const userSelected = ans.selectedIndex !== undefined ? ans.selectedIndex : 0;
      const topic = sq.topic || 'General';

      const isCorrect = userSelected === correctIndex;
      if (isCorrect) score += 1;

      if (!topicStats[topic]) {
        topicStats[topic] = { correct: 0, total: 0 };
      }
      topicStats[topic].total += 1;
      if (isCorrect) topicStats[topic].correct += 1;

      return {
        questionText,
        options,
        selectedIndex: userSelected,
        correctIndex,
        isCorrect,
        topic,
        explanation: ''
      };
    });

    const explanations = await callGroqForExplanations(fullQuestions);
    fullQuestions.forEach((fq, idx) => {
      fq.explanation = (explanations && explanations[idx])
        ? explanations[idx]
        : `The correct answer is Option ${String.fromCharCode(65 + fq.correctIndex)}: "${fq.options[fq.correctIndex]}".`;
    });

    const weakTopics = [];
    const strongTopics = [];
    Object.keys(topicStats).forEach(t => {
      const accuracy = topicStats[t].correct / topicStats[t].total;
      if (accuracy < 0.5) weakTopics.push(t);
      if (accuracy >= 0.75) strongTopics.push(t);
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

    const translatedQs = await translateQuestionsArray(result.questions);
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
    const isHindi = req.query.lang === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';
    const fieldName = isHindi ? 'audioQuestionHi' : 'audioQuestionEn';
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
    const hindiQ = (isHindi && result.translatedHindiQuestions && result.translatedHindiQuestions.length > idx)
      ? result.translatedHindiQuestions[idx]
      : null;

    const stem = (isHindi && hindiQ?.questionText) ? hindiQ.questionText : q.questionText;
    const options = (isHindi && hindiQ?.options && hindiQ.options.length > 0) ? hindiQ.options : q.options;

    const optLabels = ['A', 'B', 'C', 'D'];
    const optionsStr = options.map((opt, i) => `${isHindi ? 'विकल्प' : 'Option'} ${optLabels[i] || (i + 1)}: ${opt}`).join('. ');
    const textToSpeak = `${isHindi ? 'प्रश्न' : 'Question'}: ${stem}. ${optionsStr}.`;

    const textHash = generateContentHash(textToSpeak);
    const filename = `diag-${id}-q${idx}-${isHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (q[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: q[fieldName] });
    }

    // Synthesize audio
    const lockKey = `diag:${id}:q${idx}:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      return res.status(500).json({ error: 'Failed to synthesize question audio.' });
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
    const isHindi = language === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';

    // Per-user rate limiting check
    if (!checkLiveAudioRateLimit(req.userId)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before requesting more audio.' });
    }

    if (!questionText) {
      return res.status(400).json({ error: 'questionText is required.' });
    }

    const optLabels = ['A', 'B', 'C', 'D'];
    const optsList = Array.isArray(options) ? options : [];
    const optionsStr = optsList.map((opt, i) => `${isHindi ? 'विकल्प' : 'Option'} ${optLabels[i] || (i + 1)}: ${opt}`).join('. ');
    const textToSpeak = `${isHindi ? 'प्रश्न' : 'Question'}: ${questionText}. ${optionsStr}.`;

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
