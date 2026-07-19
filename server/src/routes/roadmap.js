import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import Roadmap from '../models/Roadmap.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import { fetchYoutubeResources } from '../utils/fetchYoutubeResources.js';
import { translateTextWithSarvam } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash, getAudioUrl } from '../utils/textToSpeech.js';

const router = express.Router();

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

    await Roadmap.deleteMany({ userId: req.userId });

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
    const roadmap = await Roadmap.findOne({ userId: req.userId })
      .populate('diagnosticResultId')
      .sort({ createdAt: -1 });
    res.json({ roadmap });
  } catch (error) {
    console.error('Get active roadmap error:', error);
    res.status(500).json({ error: 'Server error fetching active roadmap.' });
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
      if (targetDay.translatedHindiTopic && targetDay.hindiTopicTranslated) {
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

      if (targetDay.translatedHindiFocus && targetDay.hindiFocusTranslated) {
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

      if (targetDay.translatedHindiContent && targetDay.hindiContentTranslated) {
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

    res.json({
      dayNumber: targetDay.dayNumber,
      topic: displayTopic,
      focus: displayFocus,
      content: displayContent,
      resources: targetDay.resources || [],
      completed: targetDay.completed,
      estimatedMinutes: targetDay.estimatedMinutes
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

    day.completed = typeof completed === 'boolean' ? completed : !day.completed;
    await roadmap.save();

    res.json({ roadmap });
  } catch (error) {
    console.error('Toggle day completion error:', error);
    res.status(500).json({ error: 'Server error updating day completion status.' });
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

    if (roadmap.userId.toString() !== req.userId) {
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
      return res.status(500).json({ error: 'Failed to synthesize speech audio.' });
    }

    // Save audio file to disk and update MongoDB pointer
    const audioUrl = saveAudioFile(filename, audioBuffer);
    targetDay[fieldName] = audioUrl;
    await roadmap.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Roadmap day audio error:', error.message);
    if (error.response) {
      console.error('Sarvam API Error Status:', error.response.status);
      console.error('Sarvam API Error Data:', JSON.stringify(error.response.data));
    }
    res.status(500).json({ error: 'Server error generating day audio.' });
  }
});

export default router;
