import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import Roadmap from '../models/Roadmap.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import { fetchYoutubeResources } from '../utils/fetchYoutubeResources.js';
import { translateTextWithSarvam, translateQuestionsArray } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash, getAudioUrl } from '../utils/textToSpeech.js';

const router = express.Router();

// Phase 2: a video counts as "watched" at 90% of its duration.
// Kept as a named constant so quiz-gating (Phase 3) and stats stay consistent.
const VIDEO_WATCH_THRESHOLD = 0.9;

// Lazy, non-destructive migration: if a day predates per-video tracking and only
// has the old scalar fields, seed one videoProgress record from them so existing
// watched progress isn't lost. Returns true if it mutated the day (caller saves).
function migrateLegacyVideoProgress(day) {
  if ((!day.videoProgress || day.videoProgress.length === 0) && day.trackedVideoId) {
    day.videoProgress = [{
      videoId: day.trackedVideoId,
      watchedSeconds: day.videoWatchedSeconds || 0,
      durationSeconds: day.videoDurationSeconds || 0,
      watched: day.videoWatched || false,
      watchedAt: day.videoWatchedAt || null
    }];
    return true;
  }
  return false;
}

// Shape a day's video records for the client (and compute the day-level OR flag).
function serializeVideoProgress(day) {
  const list = (day.videoProgress || []).map(v => ({
    videoId: v.videoId,
    watchedSeconds: v.watchedSeconds || 0,
    durationSeconds: v.durationSeconds || 0,
    watched: v.watched || false
  }));
  return {
    videoThreshold: VIDEO_WATCH_THRESHOLD,
    videoProgress: list,
    anyVideoWatched: list.some(v => v.watched)
  };
}

function validateRoadmapJSON(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.days)) return false;
  if (data.days.length < 7 || data.days.length > 25) return false;
  for (const d of data.days) {
    if (typeof d.dayNumber !== 'number' || !d.topic || !d.focus) return false;
  }
  return true;
}

// Call Groq API for Roadmap
async function callGroqForRoadmap(grade, subject, weakTopics, strongTopics) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const prompt = `Create a customized step-by-step study roadmap for a student in Grade: "${grade}", Subject: "${subject}".
Diagnostic assessment results:
- Weak areas requiring extra focus: ${weakTopics.length > 0 ? weakTopics.join(', ') : 'None identified'}
- Strong areas mastered: ${strongTopics.length > 0 ? strongTopics.join(', ') : 'General foundation'}

Return ONLY a valid JSON object matching this exact shape:
{
  "totalDays": 14,
  "days": [
    {
      "dayNumber": 1,
      "topic": "Topic Name",
      "focus": "Clear 1-2 sentence focus detailing what to learn today and addressing weak areas.",
      "estimatedMinutes": 30
    }
  ]
}
Generate between 10 and 15 days of structured, actionable daily study goals. Ensure dayNumber is 1, 2, 3... sequentially. No markdown formatting, raw JSON only.`;

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

// Call Groq to generate prose explainer text for a single day
async function callGroqForDayContent(grade, subject, topic, focus) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    return `Welcome to Day's module on ${topic}. In this section, you will master ${focus}. Study the foundational concepts carefully and complete the practice exercises to solidify your understanding.`;
  }

  const prompt = `Write a comprehensive, clear, 2-3 paragraph educational explanation for a student in ${grade} studying ${subject}.
Topic: "${topic}"
Focus: "${focus}"

Explain the key theoretical concepts, important rules/formulas, and practical applications in student-friendly tone. Do not use markdown headings. Plain formatted paragraphs only.`;

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
        temperature: 0.4
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content || `Welcome to Day's module on ${topic}. Focus: ${focus}`;
    }
  } catch (err) {
    console.warn('Groq day content call failed:', err.message);
  }

  return `Welcome to Day's module on ${topic}. Focus: ${focus}`;
}

// Helper: Match hand-written course YouTube link
function getResourceLinkForTopic(grade, subject) {
  const key = `${grade.toLowerCase()}_${subject.toLowerCase()}`;
  if (key.includes('10') && key.includes('science')) return 'pw-udaan-class-10';
  if (key.includes('11') || key.includes('jee')) return 'pw-arjuna-jee';
  if (key.includes('neet') || key.includes('biology')) return 'unacademy-neet-biology';
  return null;
}

// Phase 3: module quiz pass mark. 70% (e.g. 7/10) — below this the day is NOT
// marked complete even with the video watched, but the student may retake.
const QUIZ_PASS_THRESHOLD = 0.7;
const MODULE_QUIZ_MIN_QUESTIONS = 10;
// Phase 4: a sub-topic is "weak" below 60% average accuracy (needs >= 2 answered
// questions so a single miss doesn't flag it). Feeds Phase 7 remediation.
const WEAK_TOPIC_THRESHOLD = 0.6;
const WEAK_TOPIC_MIN_QUESTIONS = 2;

function validateModuleQuizJSON(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) return false;
  if (data.questions.length < MODULE_QUIZ_MIN_QUESTIONS) return false;
  for (const q of data.questions) {
    if (!q.question || typeof q.question !== 'string') return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) return false;
  }
  return true;
}

// Localization: ensure a day's quiz questions have cached Hindi (stem + options
// in the SAME ORDER, + explanation). Reuses translateQuestionsArray (Sarvam →
// Groq fallback). Idempotent per question. Returns true if it mutated the day.
async function ensureQuizHindi(day) {
  const questions = day.moduleQuiz?.questions || [];
  const pending = questions.filter(q => !q.hindiTranslated);
  if (pending.length === 0) return false;

  const translated = await translateQuestionsArray(
    pending.map(q => ({ questionText: q.questionText, options: q.options, explanation: q.explanation }))
  );

  let changed = false;
  pending.forEach((q, i) => {
    const tr = translated[i];
    // Only latch as translated if the stem actually became Hindi. If the service
    // failed (returned the English unchanged), leave hindiTranslated=false so the
    // next Hindi read retries instead of caching the failure forever.
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

// Localization: ensure day.subtopicsHindi mirrors day.subtopics (same order).
// Per-item lazy retry: items whose cached "Hindi" is still just the English source
// are re-attempted on each Hindi read (terse math terms can fail under rate limits),
// so a failed translation is never cached as final.
async function ensureSubtopicsHindi(day) {
  const subs = day.subtopics || [];
  if (subs.length === 0) return false;
  const cur = day.subtopicsHindi || [];

  let changed = false;
  const hi = [];
  for (let i = 0; i < subs.length; i++) {
    const existing = cur[i];
    if (existing && existing.trim() && existing.trim() !== subs[i].trim()) {
      hi.push(existing); // already has a real translation
      continue;
    }
    const t = await translateTextWithSarvam(subs[i]);
    if (t && t.trim() !== subs[i].trim()) { hi.push(t); changed = true; }
    else { hi.push(subs[i]); } // fallback to English; will retry next Hindi read
  }

  if (changed || cur.length !== subs.length) { day.subtopicsHindi = hi; return true; }
  return false;
}

// Client-safe question view (no correctIndex/explanation), localized if Hindi.
function serializeQuizQuestion(q, idx, isHindi) {
  const useHi = isHindi && q.hindiTranslated;
  return {
    index: idx,
    questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
    options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
    topic: q.topic
  };
}

// Phase 4: normalize a sub-topic label so casing/whitespace drift collapses.
function normalizeTopic(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
}

// Pin each question's freeform `topic` to a canonical per-day sub-topic. Returns
// { subtopics, questions } where every question.topic is one of subtopics (exact
// casing). Unmatched question topics are appended so nothing is silently dropped.
function canonicalizeSubtopics(rawSubtopics, questions) {
  const canonicalByNorm = new Map();
  const subtopics = [];
  const addCanonical = (label) => {
    const norm = normalizeTopic(label);
    if (!norm) return null;
    if (!canonicalByNorm.has(norm)) {
      canonicalByNorm.set(norm, label.trim());
      subtopics.push(label.trim());
    }
    return canonicalByNorm.get(norm);
  };

  (rawSubtopics || []).forEach(s => { if (typeof s === 'string') addCanonical(s); });

  // Build explicit plain objects (inputs may be Mongoose subdocs — don't spread).
  const mapped = questions.map(q => {
    const canonical = addCanonical(q.topic || 'General') || (subtopics[0] || 'General');
    return {
      questionText: q.questionText,
      options: q.options,
      correctIndex: q.correctIndex,
      topic: canonical,
      explanation: q.explanation || ''
    };
  });

  return { subtopics, questions: mapped };
}

// Generates a quiz grounded ONLY in this specific day's topic/focus/content.
// Fresh Groq call — no static bank, no reuse of the diagnostic generator.
async function callGroqForModuleQuiz(grade, subject, topic, focus, content) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const grounding = (content || '').trim().slice(0, 4000);
  const prompt = `You are writing a module quiz for ONE specific lesson in a study roadmap.

Grade: "${grade}"
Subject: "${subject}"
Lesson topic: "${topic}"
Lesson focus: "${focus}"
Lesson content to ground the questions in:
"""
${grounding || '(No extended content provided — base questions strictly on the lesson topic and focus above.)'}
"""

First define a SHORT canonical list of 3-5 sub-topics that this lesson breaks into (specific concepts within "${topic}", e.g. for "Quadratic Equations": "Factorization", "Quadratic Formula", "Completing the Square"). Then write EXACTLY ${MODULE_QUIZ_MIN_QUESTIONS} multiple-choice questions, and tag EACH question with exactly one label FROM that sub-topics list (use the identical string — do not invent new labels or vary the wording). Every question MUST be about "${topic}" and answerable from the lesson material above — do NOT ask generic ${subject} questions unrelated to this specific topic.

Return ONLY valid JSON in exactly this shape:
{
  "subtopics": ["Sub-topic 1", "Sub-topic 2", "Sub-topic 3"],
  "questions": [
    {
      "question": "Clear question about ${topic}",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "topic": "must be one of the subtopics strings above, verbatim",
      "explanation": "One sentence explaining why the correct option is right."
    }
  ]
}

3-5 subtopics. Exactly ${MODULE_QUIZ_MIN_QUESTIONS} questions, exactly 4 options each. Each question's "topic" MUST exactly match one of the "subtopics" strings. correctIndex is the 0-based index (0-3) of the correct option. ACCURACY IS CRITICAL: double-check every fact and that correctIndex points to the truly correct option. No markdown, raw JSON only.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API responded with status ${response.status}`);
  }

  const jsonResponse = await response.json();
  const content2 = jsonResponse.choices?.[0]?.message?.content;
  return JSON.parse(content2);
}

// True if the day's video requirement (Phase 2, OR logic) is satisfied.
function isAnyVideoWatched(day) {
  return (day.videoProgress || []).some(v => v.watched) || Boolean(day.videoWatched);
}

// POST /api/roadmap/generate
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { diagnosticResultId } = req.body;
    let diagnostic = null;

    if (diagnosticResultId) {
      diagnostic = await DiagnosticResult.findById(diagnosticResultId);
    } else {
      diagnostic = await DiagnosticResult.findOne({ userId: req.userId }).sort({ createdAt: -1 });
    }

    if (!diagnostic) {
      return res.status(404).json({ error: 'No diagnostic result found for this user.' });
    }

    const weakTopics = (diagnostic.weakTopics && diagnostic.weakTopics.length > 0)
      ? diagnostic.weakTopics
      : diagnostic.questions?.filter(a => !a.isCorrect).map(a => a.topic) || [];

    const strongTopics = (diagnostic.strongTopics && diagnostic.strongTopics.length > 0)
      ? diagnostic.strongTopics
      : diagnostic.questions?.filter(a => a.isCorrect).map(a => a.topic) || [];

    let roadmapData = null;
    try {
      roadmapData = await callGroqForRoadmap(diagnostic.grade, diagnostic.subject, weakTopics, strongTopics);
      if (!validateRoadmapJSON(roadmapData)) {
        console.warn('First Groq roadmap validation failed, retrying once...');
        roadmapData = await callGroqForRoadmap(diagnostic.grade, diagnostic.subject, weakTopics, strongTopics);
      }
    } catch (err) {
      console.warn('Groq roadmap generation failed, generating fallback roadmap:', err.message);
    }

    if (!roadmapData || !validateRoadmapJSON(roadmapData)) {
      const fallbackDays = [
        { dayNumber: 1, topic: 'Foundational Review', focus: `Overview of core ${diagnostic.subject} concepts for ${diagnostic.grade}.`, estimatedMinutes: 30 },
        { dayNumber: 2, topic: 'Key Definitions & Terms', focus: `Focus on mastering key terms and foundational definitions in ${diagnostic.subject}.`, estimatedMinutes: 35 },
        { dayNumber: 3, topic: 'Targeting Weak Areas', focus: weakTopics.length > 0 ? `Targeted practice for weak topic: ${weakTopics[0]}.` : `Deep dive into key concepts for ${diagnostic.subject}.`, estimatedMinutes: 40 },
        { dayNumber: 4, topic: 'Core Problem Solving', focus: 'Step-by-step example problem solving and concept application.', estimatedMinutes: 45 },
        { dayNumber: 5, topic: 'Mid-Point Review Quiz', focus: 'Self-assessment quiz covering topics from Days 1 to 4.', estimatedMinutes: 30 },
        { dayNumber: 6, topic: 'Advanced Topic Exploration', focus: `Exploring advanced modules and exam-oriented patterns for ${diagnostic.grade}.`, estimatedMinutes: 40 },
        { dayNumber: 7, topic: 'Formula & Diagram Revision', focus: 'Reviewing key formulas, derivations, and anatomical/conceptual diagrams.', estimatedMinutes: 35 },
        { dayNumber: 8, topic: 'Practice Questions Set 1', focus: 'Interactive practice set testing speed and conceptual accuracy.', estimatedMinutes: 45 },
        { dayNumber: 9, topic: 'Targeting Second Weak Area', focus: weakTopics.length > 1 ? `Targeted revision for weak topic: ${weakTopics[1]}.` : 'In-depth problem solving and topic refinement.', estimatedMinutes: 40 },
        { dayNumber: 10, topic: 'Comprehensive Mock Test', focus: 'Full-length practice test simulating exam conditions.', estimatedMinutes: 50 },
        { dayNumber: 11, topic: 'Error Analysis & Doubt Room', focus: 'Analyzing incorrect answers from Mock Test and clarifying doubts.', estimatedMinutes: 35 },
        { dayNumber: 12, topic: 'Final Mastery & Summary', focus: 'Consolidating all topics learned into a quick-reference summary note.', estimatedMinutes: 30 }
      ];

      roadmapData = {
        totalDays: fallbackDays.length,
        days: fallbackDays
      };
    }

    const defaultResource = getResourceLinkForTopic(diagnostic.grade, diagnostic.subject);

    const formattedDays = roadmapData.days.map((d, index) => ({
      dayNumber: d.dayNumber || index + 1,
      topic: d.topic,
      focus: d.focus,
      resourceLink: defaultResource,
      estimatedMinutes: d.estimatedMinutes || 30,
      completed: false,
      content: '',
      resources: [],
      contentGenerated: false
    }));

    // Phase 5 (multi-subject): archive only the active roadmap for the SAME
    // course (grade + subject) being regenerated — other subjects stay active,
    // so a student can hold e.g. Maths and Science roadmaps at once. Still an
    // archive (never a delete), so prior progress for this course is preserved.
    await Roadmap.updateMany(
      { userId: req.userId, archived: { $ne: true }, grade: diagnostic.grade, subject: diagnostic.subject },
      { $set: { archived: true, archivedAt: new Date() } }
    );

    const newRoadmap = await Roadmap.create({
      userId: req.userId,
      diagnosticResultId: diagnostic._id,
      grade: diagnostic.grade,
      subject: diagnostic.subject,
      totalDays: formattedDays.length,
      days: formattedDays,
      language: 'en'
    });

    res.status(201).json({ roadmap: newRoadmap });
  } catch (error) {
    console.error('Roadmap generate error:', error);
    res.status(500).json({ error: 'Server error generating roadmap.' });
  }
});

// GET /api/roadmap/mine (Populates diagnosticResultId for Phase 11)
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const roadmap = await Roadmap.findOne({ userId: req.userId, archived: { $ne: true } })
      .populate('diagnosticResultId')
      .sort({ createdAt: -1 });
    res.json({ roadmap });
  } catch (error) {
    console.error('Get active roadmap error:', error);
    res.status(500).json({ error: 'Server error fetching active roadmap.' });
  }
});

// GET /api/roadmap/list (Phase 5) — all of the student's ACTIVE roadmaps, one
// per course (grade+subject), for the sidebar subject switcher. Full documents
// so switching subjects swaps the dashboard panel with no extra fetch.
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const roadmaps = await Roadmap.find({ userId: req.userId, archived: { $ne: true } })
      .populate('diagnosticResultId')
      .sort({ createdAt: -1 });
    res.json({ roadmaps });
  } catch (error) {
    console.error('List roadmaps error:', error);
    res.status(500).json({ error: 'Server error fetching roadmaps.' });
  }
});

// GET /api/roadmap/:id/day/:dayNumber (Phase 9 Day Detail API)
router.get('/:id/day/:dayNumber', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const isHindi = req.query.lang === 'hi';

    const roadmap = await Roadmap.findById(id);
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    if (roadmap.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to roadmap.' });
    }

    const targetDay = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!targetDay) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    // Generate content & resources if not populated yet
    if (!targetDay.contentGenerated) {
      const proseContent = await callGroqForDayContent(roadmap.grade, roadmap.subject, targetDay.topic, targetDay.focus);
      // Fetch real video resources via YouTube Data API v3
      // Note: If fetchYoutubeResources returns [], contentGenerated is still set to true with resources: [] to prevent infinite retries.
      const realResources = await fetchYoutubeResources(targetDay.topic, roadmap.subject, roadmap.grade);

      targetDay.content = proseContent;
      targetDay.resources = realResources;
      targetDay.contentGenerated = true;
      await roadmap.save();
    }

    // Sarvam Hindi translation if lang=hi
    let displayTopic = targetDay.topic;
    let displayFocus = targetDay.focus;
    let displayContent = targetDay.content;

    if (isHindi) {
      if (targetDay.translatedHindiTopic && targetDay.hindiTopicTranslated && targetDay.translatedHindiTopic.trim() !== targetDay.topic.trim()) {
        displayTopic = targetDay.translatedHindiTopic;
      } else {
        const transTopic = await translateTextWithSarvam(targetDay.topic);
        if (transTopic) {
          targetDay.translatedHindiTopic = transTopic;
          targetDay.hindiTopicTranslated = true;
          displayTopic = transTopic;
          await roadmap.save();
        }
      }

      if (targetDay.translatedHindiFocus && targetDay.hindiFocusTranslated && targetDay.translatedHindiFocus.trim() !== targetDay.focus.trim()) {
        displayFocus = targetDay.translatedHindiFocus;
      } else {
        const transFocus = await translateTextWithSarvam(targetDay.focus);
        if (transFocus) {
          targetDay.translatedHindiFocus = transFocus;
          targetDay.hindiFocusTranslated = true;
          displayFocus = transFocus;
          await roadmap.save();
        }
      }

      if (targetDay.translatedHindiContent && targetDay.hindiContentTranslated && targetDay.translatedHindiContent.trim() !== targetDay.content.trim()) {
        displayContent = targetDay.translatedHindiContent;
      } else {
        const transContent = await translateTextWithSarvam(targetDay.content);
        if (transContent) {
          targetDay.translatedHindiContent = transContent;
          targetDay.hindiContentTranslated = true;
          displayContent = transContent;
          await roadmap.save();
        }
      }
    }

    // Phase 2: seed per-video records from legacy scalar data if needed.
    if (migrateLegacyVideoProgress(targetDay)) {
      roadmap.markModified('days');
      await roadmap.save();
    }

    res.json({
      dayNumber: targetDay.dayNumber,
      topic: displayTopic,
      focus: displayFocus,
      content: displayContent,
      resources: targetDay.resources || [],
      completed: targetDay.completed,
      estimatedMinutes: targetDay.estimatedMinutes,
      // Phase 2 per-video watch state (array; empty for days never watched)
      ...serializeVideoProgress(targetDay)
    });
  } catch (error) {
    console.error('Get day detail error:', error);
    res.status(500).json({ error: 'Server error fetching day detail.' });
  }
});

// GET /api/roadmap/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const roadmap = await Roadmap.findOne({ _id: req.params.id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }
    res.json({ roadmap });
  } catch (error) {
    console.error('Get roadmap by ID error:', error);
    res.status(500).json({ error: 'Server error fetching roadmap.' });
  }
});

// PATCH /api/roadmap/:id/day/:dayNumber
router.patch('/:id/day/:dayNumber', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { completed } = req.body;

    const roadmap = await Roadmap.findOne({ _id: id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    const nextState = typeof completed === 'boolean' ? completed : !day.completed;

    // Phase 3 gate: a day can only be marked COMPLETE once its video is watched
    // AND its module quiz is passed. Un-completing is always allowed.
    if (nextState === true) {
      const anyVideoWatched = isAnyVideoWatched(day);
      const quizPassed = Boolean(day.moduleQuizAttempt?.passed);
      if (!anyVideoWatched || !quizPassed) {
        return res.status(409).json({
          error: 'completion_gate',
          message: 'Watch a video and pass the module quiz to complete this day.',
          requires: { anyVideoWatched, quizPassed }
        });
      }
    }

    day.completed = nextState;
    await roadmap.save();

    res.json({ roadmap });
  } catch (error) {
    console.error('Toggle day completion error:', error);
    res.status(500).json({ error: 'Server error updating day completion status.' });
  }
});

// PATCH /api/roadmap/:id/day/:dayNumber/video-progress (Phase 2, revised)
// Upserts watch progress for ONE video (by videoId) within the day's
// videoProgress array. Each of a day's videos tracks independently. Deliberately
// does NOT touch `completed` — watching a video is a separate signal from
// finishing the day (which also requires the Phase 3 quiz).
router.patch('/:id/day/:dayNumber/video-progress', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { videoId, watchedSeconds, durationSeconds } = req.body;

    const incomingVideoId = typeof videoId === 'string' ? videoId.trim() : '';
    if (!incomingVideoId) {
      return res.status(400).json({ error: 'videoId is required.' });
    }

    const roadmap = await Roadmap.findOne({ _id: id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    // Migrate legacy scalar data before mutating so old progress isn't clobbered.
    migrateLegacyVideoProgress(day);
    if (!day.videoProgress) day.videoProgress = [];

    const incomingWatched = Math.max(0, Number(watchedSeconds) || 0);
    const incomingDuration = Math.max(0, Number(durationSeconds) || 0);

    // Find this video's record (or create it).
    let record = day.videoProgress.find(v => v.videoId === incomingVideoId);
    if (!record) {
      day.videoProgress.push({ videoId: incomingVideoId, watchedSeconds: 0, durationSeconds: 0, watched: false, watchedAt: null });
      record = day.videoProgress[day.videoProgress.length - 1];
    }

    // Keep the furthest point reached (scrubbing back shouldn't lower it).
    record.watchedSeconds = Math.max(record.watchedSeconds || 0, incomingWatched);
    if (incomingDuration > 0) {
      record.durationSeconds = incomingDuration;
    }

    // Latch `watched` on at threshold; never un-watch.
    if (record.durationSeconds > 0) {
      const ratio = record.watchedSeconds / record.durationSeconds;
      if (!record.watched && ratio >= VIDEO_WATCH_THRESHOLD) {
        record.watched = true;
        record.watchedAt = new Date();
      }
    }

    roadmap.markModified('days');
    await roadmap.save();

    res.json(serializeVideoProgress(day));
  } catch (error) {
    console.error('Video progress update error:', error);
    res.status(500).json({ error: 'Server error updating video progress.' });
  }
});

// GET /api/roadmap/:id/day/:dayNumber/quiz (Phase 3)
// Returns the day's module quiz, generating + caching it on first request.
// Answers (correctIndex / explanation) are NOT sent — only questions + options.
router.get('/:id/day/:dayNumber/quiz', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;

    const roadmap = await Roadmap.findOne({ _id: id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    // Generate + cache once. Consistent quiz on every revisit thereafter.
    if (!day.moduleQuiz?.generated || !(day.moduleQuiz.questions || []).length) {
      let quizData = null;
      try {
        quizData = await callGroqForModuleQuiz(roadmap.grade, roadmap.subject, day.topic, day.focus, day.content);
        if (!validateModuleQuizJSON(quizData)) {
          console.warn('First module quiz validation failed, retrying once...');
          quizData = await callGroqForModuleQuiz(roadmap.grade, roadmap.subject, day.topic, day.focus, day.content);
        }
      } catch (groqErr) {
        console.warn('Module quiz generation failed:', groqErr.message);
      }

      if (!quizData || !validateModuleQuizJSON(quizData)) {
        // Don't break the day — signal the UI to show a graceful retry.
        return res.status(200).json({ available: false, reason: 'generation_failed' });
      }

      const built = quizData.questions.slice(0, MODULE_QUIZ_MIN_QUESTIONS + 5).map(q => ({
        questionText: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        topic: q.topic || 'General',
        explanation: q.explanation || ''
      }));
      // Phase 4: pin question topics to the canonical per-day sub-topic list.
      const { subtopics, questions: canonQuestions } = canonicalizeSubtopics(quizData.subtopics, built);
      day.subtopics = subtopics;
      day.moduleQuiz = { generated: true, generatedAt: new Date(), questions: canonQuestions };
      roadmap.markModified('days');
      await roadmap.save();
    } else if (!(day.subtopics || []).length && (day.moduleQuiz.questions || []).length) {
      // Lazy migration: a quiz cached before Phase 4 has no subtopics — derive
      // them from the existing question topics (normalized, deduped).
      const { subtopics, questions: canonQuestions } = canonicalizeSubtopics([], day.moduleQuiz.questions);
      day.subtopics = subtopics;
      day.moduleQuiz.questions = canonQuestions;
      roadmap.markModified('days');
      await roadmap.save();
    }

    // Localize quiz questions to Hindi on demand (cached on the question subdocs).
    const isHindi = req.query.lang === 'hi';
    if (isHindi) {
      const changed = await ensureQuizHindi(day);
      if (changed) { roadmap.markModified('days'); await roadmap.save(); }
    }

    const attempt = day.moduleQuizAttempt || {};
    res.json({
      available: true,
      passThreshold: QUIZ_PASS_THRESHOLD,
      anyVideoWatched: isAnyVideoWatched(day),
      // Client-safe questions — no correctIndex / explanation until submit.
      questions: (day.moduleQuiz.questions || []).map((q, idx) => serializeQuizQuestion(q, idx, isHindi)),
      previousAttempt: attempt.attempted ? {
        score: attempt.score,
        total: attempt.total,
        passed: attempt.passed,
        attemptCount: attempt.attemptCount
      } : null
    });
  } catch (error) {
    console.error('Get module quiz error:', error);
    res.status(500).json({ error: 'Server error loading module quiz.' });
  }
});

// POST /api/roadmap/:id/day/:dayNumber/quiz/submit (Phase 3)
// Scores an attempt against the cached answers, stores per-question detail
// (for Phase 4), and — if passed AND a video is watched — completes the day.
router.post('/:id/day/:dayNumber/quiz/submit', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'answers array is required.' });
    }

    const roadmap = await Roadmap.findOne({ _id: id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    const quizQuestions = day.moduleQuiz?.questions || [];
    if (!day.moduleQuiz?.generated || quizQuestions.length === 0) {
      return res.status(409).json({ error: 'No quiz has been generated for this day yet.' });
    }

    let score = 0;
    const resultQuestions = quizQuestions.map((q, idx) => {
      const selectedIndex = (answers[idx] && typeof answers[idx].selectedIndex === 'number')
        ? answers[idx].selectedIndex
        : (typeof answers[idx] === 'number' ? answers[idx] : -1);
      const isCorrect = selectedIndex === q.correctIndex;
      if (isCorrect) score += 1;
      return {
        questionText: q.questionText,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        topic: q.topic || 'General'
      };
    });

    const total = quizQuestions.length;
    const passed = total > 0 && (score / total) >= QUIZ_PASS_THRESHOLD;
    const prevCount = day.moduleQuizAttempt?.attemptCount || 0;

    day.moduleQuizAttempt = {
      attempted: true,
      score,
      total,
      passed,
      passThreshold: QUIZ_PASS_THRESHOLD,
      attemptCount: prevCount + 1,
      lastAttemptAt: new Date(),
      questions: resultQuestions
    };

    // Completion gate: pass + any video watched → mark the day complete.
    const anyVideoWatched = isAnyVideoWatched(day);
    let dayCompleted = day.completed;
    if (passed && anyVideoWatched) {
      day.completed = true;
      dayCompleted = true;
    }

    // Localize the review to Hindi if requested (cached on the question subdocs).
    // Scoring above used option INDEX only, so translation can't affect the score.
    const isHindi = req.query.lang === 'hi';
    if (isHindi) await ensureQuizHindi(day);

    roadmap.markModified('days');
    await roadmap.save();

    res.json({
      score,
      total,
      passed,
      passThreshold: QUIZ_PASS_THRESHOLD,
      anyVideoWatched,
      dayCompleted,
      attemptCount: prevCount + 1,
      // Full review (with correct answers + explanations) is fine post-submit.
      questions: quizQuestions.map((q, idx) => {
        const useHi = isHindi && q.hindiTranslated;
        return {
          questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
          options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
          selectedIndex: resultQuestions[idx].selectedIndex,
          correctIndex: q.correctIndex,
          isCorrect: resultQuestions[idx].isCorrect,
          topic: q.topic || 'General',
          explanation: useHi ? (q.translatedHindiExplanation || q.explanation || '') : (q.explanation || '')
        };
      })
    });
  } catch (error) {
    console.error('Submit module quiz error:', error);
    res.status(500).json({ error: 'Server error submitting module quiz.' });
  }
});

// GET /api/roadmap/:id/day/:dayNumber/quiz/question/:qIndex/audio (Phase 3 TTS)
// Reads a quiz question aloud, disk-cached per (day, questionIndex, language).
// Mirrors the diagnostic question-audio endpoint; reads the LOCALIZED text so the
// audio always matches what's on screen (Hindi audio for Hindi display).
router.get('/:id/day/:dayNumber/quiz/question/:qIndex/audio', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber, qIndex } = req.params;
    const isHindi = req.query.lang === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';
    const fieldName = isHindi ? 'audioQuestionHi' : 'audioQuestionEn';
    const idx = parseInt(qIndex, 10);

    const roadmap = await Roadmap.findById(id);
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found.' });
    if (roadmap.userId && roadmap.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to quiz audio.' });
    }

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) return res.status(404).json({ error: 'Day not found in roadmap.' });

    const questions = day.moduleQuiz?.questions || [];
    if (idx < 0 || idx >= questions.length) {
      return res.status(404).json({ error: 'Question index out of bounds.' });
    }

    // Ensure the localized text exists first, so audio matches the display.
    if (isHindi) {
      const changed = await ensureQuizHindi(day);
      if (changed) { roadmap.markModified('days'); await roadmap.save(); }
    }

    const q = questions[idx];
    const useHi = isHindi && q.hindiTranslated;
    const stem = useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText;
    const options = (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options;

    const optLabels = ['A', 'B', 'C', 'D'];
    const optionsStr = options.map((opt, i) => `${isHindi ? 'विकल्प' : 'Option'} ${optLabels[i] || (i + 1)}: ${opt}`).join('. ');
    const textToSpeak = `${isHindi ? 'प्रश्न' : 'Question'}: ${stem}. ${optionsStr}.`;

    const textHash = generateContentHash(textToSpeak);
    const filename = `quiz-${id}-day-${dayNumber}-q${idx}-${isHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (q[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: q[fieldName] });
    }

    const lockKey = `quiz:${id}:${dayNumber}:q${idx}:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // Sarvam unavailable -> signal frontend to use its Web Speech fallback.
      return res.json({ useFallback: true, fallbackText: textToSpeak });
    }

    const audioUrl = saveAudioFile(filename, audioBuffer);
    q[fieldName] = audioUrl;
    roadmap.markModified('days');
    await roadmap.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Quiz question audio error:', error.message);
    return res.json({ useFallback: true, fallbackText: 'Quiz question' });
  }
});

// GET /api/roadmap/:id/weak-topics (Phase 4)
// Aggregates per-question quiz results by canonical sub-topic across ALL days,
// producing the weak-topic list the Progress dashboard shows and Phase 7 consumes.
router.get('/:id/weak-topics', authMiddleware, async (req, res) => {
  try {
    const roadmap = await Roadmap.findOne({ _id: req.params.id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    const isHindi = req.query.lang === 'hi';

    // topicKey -> { label, correct, total, days:Set }
    const agg = new Map();
    let hasAttempts = false;
    let mutated = false;
    // normalized English sub-topic -> Hindi label (built lazily for Hindi mode).
    const hiMap = new Map();

    for (const day of roadmap.days) {
      if (isHindi && (day.subtopics || []).length) {
        if (await ensureSubtopicsHindi(day)) mutated = true;
        (day.subtopics || []).forEach((s, i) => {
          const hi = (day.subtopicsHindi || [])[i];
          if (hi) hiMap.set(normalizeTopic(s), hi);
        });
      }

      const attempt = day.moduleQuizAttempt;
      if (!attempt?.attempted || !(attempt.questions || []).length) continue;
      hasAttempts = true;

      for (const q of attempt.questions) {
        const key = normalizeTopic(q.topic || 'General');
        if (!key) continue;
        if (!agg.has(key)) {
          agg.set(key, { label: (q.topic || 'General').trim(), correct: 0, total: 0, days: new Set() });
        }
        const entry = agg.get(key);
        entry.total += 1;
        if (q.isCorrect) entry.correct += 1;
        entry.days.add(day.dayNumber);
      }
    }

    if (mutated) { roadmap.markModified('days'); await roadmap.save(); }

    const allTopics = Array.from(agg.entries()).map(([key, e]) => ({
      subtopic: e.label, // English canonical (stable key)
      label: isHindi ? (hiMap.get(key) || e.label) : e.label, // localized display
      correct: e.correct,
      total: e.total,
      wrong: e.total - e.correct,
      accuracy: e.total > 0 ? e.correct / e.total : 0,
      days: Array.from(e.days).sort((a, b) => a - b)
    }));

    const weakTopics = allTopics
      .filter(tpc => tpc.total >= WEAK_TOPIC_MIN_QUESTIONS && tpc.accuracy < WEAK_TOPIC_THRESHOLD)
      .sort((a, b) => a.accuracy - b.accuracy);

    res.json({
      hasAttempts,
      threshold: WEAK_TOPIC_THRESHOLD,
      weakTopics,
      allTopics: allTopics.sort((a, b) => a.accuracy - b.accuracy)
    });
  } catch (error) {
    console.error('Weak topics error:', error);
    res.status(500).json({ error: 'Server error computing weak topics.' });
  }
});

// POST /api/roadmap/:id/translate (Translates roadmap day topics & focus to Hindi)
router.post('/:id/translate', authMiddleware, async (req, res) => {
  try {
    const roadmap = await Roadmap.findOne({ _id: req.params.id, userId: req.userId });
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    if (roadmap.translatedHindiDays && roadmap.translatedHindiDays.length === roadmap.days.length) {
      return res.json({ roadmap });
    }

    const translatedDays = [];
    for (const day of roadmap.days) {
      const topic = await translateTextWithSarvam(day.topic);
      const focus = await translateTextWithSarvam(day.focus);
      translatedDays.push({
        dayNumber: day.dayNumber,
        topic,
        focus
      });
    }

    roadmap.translatedHindiDays = translatedDays;
    await roadmap.save();

    res.json({ roadmap });
  } catch (error) {
    console.error('Translate roadmap error:', error);
    res.status(500).json({ error: 'Server error translating roadmap.' });
  }
});

// GET /api/roadmap/:id/day/:dayNumber/audio (Audio TTS Endpoint)
router.get('/:id/day/:dayNumber/audio', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const isHindi = req.query.lang === 'hi';
    const targetLang = isHindi ? 'hi-IN' : 'en-IN';
    const fieldName = isHindi ? 'audioContentHi' : 'audioContentEn';

    const roadmap = await Roadmap.findById(id);
    if (!roadmap) {
      return res.status(404).json({ error: 'Roadmap not found.' });
    }

    if (roadmap.userId && roadmap.userId.toString() !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized access to roadmap audio.' });
    }

    const targetDay = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!targetDay) {
      return res.status(404).json({ error: 'Day not found in roadmap.' });
    }

    // Determine text to speak
    let textToSpeak = isHindi ? (targetDay.translatedHindiContent || targetDay.content) : targetDay.content;

    // If Hindi content not translated yet and requested in Hindi, generate translation first
    if (isHindi && !targetDay.hindiContentTranslated && targetDay.content) {
      const transText = await translateTextWithSarvam(targetDay.content);
      if (transText) {
        targetDay.translatedHindiContent = transText;
        targetDay.hindiContentTranslated = true;
        await roadmap.save();
        textToSpeak = transText;
      }
    }

    if (!textToSpeak || textToSpeak.trim().length === 0) {
      return res.status(400).json({ error: 'No content available to synthesize.' });
    }

    const textHash = generateContentHash(textToSpeak);
    const filename = `roadmap-${id}-day-${dayNumber}-${isHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (targetDay[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: targetDay[fieldName] });
    }

    // Synthesize speech via Sarvam Bulbul API
    const lockKey = `roadmap:${id}:${dayNumber}:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // Sarvam API out of credits or unavailable -> signal frontend to use Web Speech API fallback
      return res.json({ useFallback: true, fallbackText: textToSpeak });
    }

    // Save audio file to disk and update MongoDB pointer
    const audioUrl = saveAudioFile(filename, audioBuffer);
    targetDay[fieldName] = audioUrl;
    await roadmap.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Roadmap day audio error:', error.message);
    return res.json({ useFallback: true, fallbackText: 'Lesson content' });
  }
});

export default router;
