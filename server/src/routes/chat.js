import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { localizeReply } from '../utils/localizeReply.js';
import { sarvamTextToSpeech, sarvamSpeechToText } from '../utils/sarvamClient.js';
import { fetchYoutubeResources } from '../utils/fetchYoutubeResources.js';
import { siteRoutes, navigationKeywords } from '../data/siteRoutes.js';
import siteKnowledge from '../data/siteKnowledge.js';
import User from '../models/User.js';
import Roadmap from '../models/Roadmap.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ── Multer: memory storage for STT audio uploads, max 5MB ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ── Optional Auth Middleware ──
// Does NOT return 401 on missing/invalid token — silently degrades to anonymous.
// jwt.verify is wrapped in try/catch: malformed, expired, bad signature all → req.userId = null.
function optionalAuthMiddleware(req, res, next) {
  req.userId = null;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
  } catch (err) {
    // Malformed, expired, bad signature — all silently degrade to anonymous
    req.userId = null;
  }

  next();
}

// ── IP-based Rate Limiter ──
// Same sliding-window algorithm as diagnostic.js's per-user limiter,
// but keyed by req.ip instead of req.userId (since chat is open to anonymous users).
const chatRateLimitMap = new Map();

function checkChatRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;

  let timestamps = chatRateLimitMap.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    return false;
  }

  timestamps.push(now);
  chatRateLimitMap.set(ip, timestamps);
  return true;
}

// Periodic cleanup of stale rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of chatRateLimitMap.entries()) {
    const active = timestamps.filter(t => now - t < 60000);
    if (active.length === 0) {
      chatRateLimitMap.delete(ip);
    } else {
      chatRateLimitMap.set(ip, active);
    }
  }
}, 5 * 60 * 1000);

// ── Intent Classification (keyword/pattern matching — no LLM call) ──

const navigationTriggers = [
  'how do i get to', 'where is', 'take me to', 'navigate', 'find the',
  'go to', 'open', 'how do i', 'where can i find', 'show me', 'link to'
];

const resourceTriggers = [
  'video', 'youtube', 'resource', 'material', 'recommend', 'suggest',
  'where can i learn', 'explain with a video', 'watch', 'tutorial',
  'study material', 'learning resource'
];

function detectNavigationIntent(message) {
  const lower = message.toLowerCase();
  const hasNavTrigger = navigationTriggers.some(t => lower.includes(t));
  if (!hasNavTrigger) return null;

  // Try to match against known routes via keywords
  const matches = [];
  for (const navKey of navigationKeywords) {
    if (navKey.keywords.some(kw => lower.includes(kw))) {
      matches.push(siteRoutes[navKey.routeIndex]);
    }
  }

  return matches.length > 0 ? matches : null;
}

function detectResourceIntent(message) {
  const lower = message.toLowerCase();
  return resourceTriggers.some(t => lower.includes(t));
}

// ── Groq API Helpers ──

async function callGroqChat(messages, jsonMode = false) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API key not configured');
  }

  const body = {
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.4
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Groq API responded with status ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Extract the study topic from a user message using Groq (narrow, low-risk use).
 * Returns a short topic string like "photosynthesis" or "quadratic equations".
 */
async function extractTopicFromMessage(message) {
  try {
    const content = await callGroqChat([
      {
        role: 'system',
        content: 'Extract the main academic topic or subject from the user\'s message as a short search phrase (1-5 words). Return ONLY the topic, nothing else. Examples: "photosynthesis", "quadratic equations", "Newton\'s laws of motion".'
      },
      { role: 'user', content: message }
    ]);
    return content || message;
  } catch (err) {
    console.warn('Topic extraction failed, using raw message:', err.message);
    return message;
  }
}

/**
 * Build the system prompt for general Q&A, with optional user personalization.
 */
function buildSystemPrompt(userContext = null) {
  let prompt = `You are Eklavya Assistant, a friendly and helpful AI tutor for Project Eklavya, an educational platform for Indian students. You help students with academic questions, explain concepts clearly, and guide them through the platform.

SITE KNOWLEDGE (use this to answer questions about the platform accurately — never make up features or pages that don't exist):
${siteKnowledge}

IMPORTANT RULES:
- Keep answers concise — this is a chat widget, not an essay generator. Use 2-4 sentences unless the student explicitly asks for a detailed explanation.
- Be warm and encouraging in tone, like a supportive tutor.
- If asked about subjects or grades not currently supported by the platform, be honest about the limitations.
- NEVER fabricate YouTube URLs, video titles, or any external links. If a student asks for videos, say you can help find them (the system will handle the actual search).
- If you don't know something, say so honestly rather than guessing.
- You can answer general academic questions (math problems, science concepts, etc.) even if they're not directly related to a course on the platform.`;

  if (userContext) {
    prompt += `\n\nCURRENT USER CONTEXT (use this to personalize your responses):`;
    if (userContext.name) prompt += `\n- Student name: ${userContext.name}`;
    if (userContext.grade) prompt += `\n- Grade/Level: ${userContext.grade}`;
    if (userContext.subject) prompt += `\n- Subject: ${userContext.subject}`;
    if (userContext.currentDay) prompt += `\n- Currently on Day ${userContext.currentDay} of their study roadmap`;
    if (userContext.completedDays) prompt += `\n- Completed ${userContext.completedDays} days so far`;
    if (userContext.totalDays) prompt += `\n- Total days in roadmap: ${userContext.totalDays}`;

    if (userContext.subject) {
      prompt += `\n\nCRITICAL: This student's roadmap is for ${userContext.grade ? userContext.grade + ' ' : ''}${userContext.subject}. When you refer to THEIR studies or roadmap, use exactly this subject and grade. The SITE KNOWLEDGE course list above describes what the platform OFFERS in general — it is NOT what this student is enrolled in. Do NOT tell this student they are studying Science, or any subject other than "${userContext.subject}", unless they explicitly ask about a different subject.`;
    }
  }

  return prompt;
}

// ── POST /api/chat/message ──

router.post('/message', optionalAuthMiddleware, async (req, res) => {
  try {
    // Rate limit by IP
    if (!checkChatRateLimit(req.ip)) {
      return res.status(429).json({
        type: 'text',
        reply: 'You\'re sending messages too quickly. Please wait a moment and try again.'
      });
    }

    const { message, conversationHistory = [], language = 'en', userContext: clientContext } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Fetch user context for personalization if authenticated
    let userContext = null;
    if (req.userId) {
      try {
        const user = await User.findById(req.userId).select('name');

        // Prefer the roadmap the student is actually VIEWING (the widget sends its
        // selected roadmapId), so the chatbot reflects the selected subject in a
        // multi-subject account. Fall back to the newest ACTIVE roadmap. Never use
        // archived roadmaps. The subject/grade come from the DB (ownership-checked),
        // not from the client, so they can't be spoofed.
        let roadmap = null;
        if (clientContext?.roadmapId) {
          try {
            roadmap = await Roadmap.findOne({ _id: clientContext.roadmapId, userId: req.userId, archived: { $ne: true } });
          } catch { /* malformed id — fall through to newest active */ }
        }
        if (!roadmap) {
          roadmap = await Roadmap.findOne({ userId: req.userId, archived: { $ne: true } }).sort({ createdAt: -1 });
        }

        if (user || roadmap) {
          userContext = {};
          if (user?.name) userContext.name = user.name;
          if (roadmap) {
            userContext.grade = roadmap.grade;
            userContext.subject = roadmap.subject;
            userContext.totalDays = roadmap.totalDays;
            userContext.completedDays = roadmap.days?.filter(d => d.completed)?.length || 0;
            // Find current day (first uncompleted)
            const currentDay = roadmap.days?.find(d => !d.completed);
            if (currentDay) userContext.currentDay = currentDay.dayNumber;
            userContext.roadmapId = roadmap._id;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch user context for chat personalization:', err.message);
        // Non-fatal — continue without personalization
      }
    }

    // Anonymous users: accept client-side context as-is.
    if (clientContext && !userContext) {
      userContext = clientContext;
    }

    // ── Sequential intent classification ──
    // Each check runs independently. A message can match multiple intents.

    const navMatches = detectNavigationIntent(message);
    const wantsResources = detectResourceIntent(message);

    // Build response parts
    let replyParts = [];
    let responseType = 'text';
    let route = null;
    let routeLabel = null;
    let resources = null;

    // ── Navigation intent ──
    if (navMatches) {
      if (navMatches.length === 1) {
        const matched = navMatches[0];

        if (matched.dynamic) {
          // Dynamic route — can't generate a specific link without an ID
          if (matched.path.includes('roadmap') && userContext?.roadmapId) {
            // We have a roadmap ID from context — link to their actual roadmap
            route = `/roadmap/${userContext.roadmapId}/day/1`;
            routeLabel = language === 'hi' ? 'अपनी रोडमैप देखें' : 'View Your Roadmap';
            replyParts.push('You can access your study roadmap from here:');
          } else {
            // No specific ID available — give a text description instead
            replyParts.push(`You can find ${matched.label} from your Dashboard. Navigate to your Dashboard first, then look for it there.`);
            route = '/dashboard';
            routeLabel = language === 'hi' ? matched.labelHi || 'डैशबोर्ड' : 'Go to Dashboard';
          }
        } else {
          route = matched.path;
          routeLabel = language === 'hi' ? matched.labelHi : `Go to ${matched.label}`;
          replyParts.push('You can find that here:');

          // Auth warning for anonymous users
          if (matched.requiresAuth && !req.userId) {
            replyParts.push('Note: You\'ll need to log in first to access this page.');
          }
        }

        responseType = 'navigation';
      } else {
        // Ambiguous — multiple matches, ask for clarification
        const options = navMatches.map(m => m.label).join(', ');
        replyParts.push(`I found a few possible pages: ${options}. Could you tell me which one you're looking for?`);
      }
    }

    // ── Resource/study material intent ──
    if (wantsResources) {
      try {
        const topic = await extractTopicFromMessage(message);
        const grade = userContext?.grade || '';
        const subject = userContext?.subject || '';

        const ytResources = await fetchYoutubeResources(topic, subject, grade);

        if (ytResources && ytResources.length > 0) {
          resources = ytResources.map(r => ({
            title: r.title,
            url: r.url,
            channel: r.channel
          }));
          replyParts.push('Here are some videos I found for you:');
          responseType = 'resources';
        } else {
          replyParts.push('I couldn\'t find specific videos for that topic right now. Try rephrasing your request, or check the Courses page for available study materials.');
        }
      } catch (err) {
        console.warn('Resource fetch failed:', err.message);
        replyParts.push('I had trouble finding videos right now. Please try again in a moment.');
      }
    }

    // ── General Q&A (fallback, or supplement for resource requests) ──
    if (!navMatches && !wantsResources) {
      // Pure general Q&A — call Groq
      try {
        const systemPrompt = buildSystemPrompt(userContext);

        // Cap conversation history at last 10 messages
        const recentHistory = conversationHistory.slice(-10);

        const messages = [
          { role: 'system', content: systemPrompt },
          ...recentHistory,
          { role: 'user', content: message }
        ];

        const groqReply = await callGroqChat(messages);
        replyParts.push(groqReply);
      } catch (err) {
        console.error('Groq Q&A call failed:', err.message);
        replyParts.push('Sorry, I\'m having trouble responding right now. Please try again in a moment.');
      }
    } else if (wantsResources && replyParts.length <= 1) {
      // Resource request but could benefit from supplementary explanation
      // Only if the message seems to also be asking for an explanation
      const lower = message.toLowerCase();
      if (lower.includes('explain') || lower.includes('what is') || lower.includes('help me understand')) {
        try {
          const systemPrompt = buildSystemPrompt(userContext);
          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Give a brief 2-3 sentence explanation of: ${message}` }
          ];
          const explanation = await callGroqChat(messages);
          // Prepend explanation before the "Here are some videos" part
          replyParts.unshift(explanation);
        } catch (err) {
          // Non-fatal — videos alone are sufficient
          console.warn('Supplementary explanation failed:', err.message);
        }
      }
    }

    // Combine reply parts
    const englishReply = replyParts.join('\n\n');

    // ── Language localization (shared step for ALL reply types) ──
    const localizedReply = await localizeReply(englishReply, language);

    // Build final response.
    // Note on type: The frontend renders route (nav button) and resources (video cards)
    // based on the PRESENCE of those fields in the response object, not by switching on
    // the type field. So a combined nav+resources response works correctly — both the
    // nav button and resource cards render. The type field is a semantic hint only.
    const response = {
      type: resources ? 'resources' : responseType,
      reply: localizedReply
    };

    if (route) {
      response.route = route;
      response.label = routeLabel;
    }

    if (resources) {
      response.resources = resources;
    }

    res.json(response);
  } catch (error) {
    console.error('Chat message handler error:', error);
    res.status(500).json({
      type: 'text',
      reply: 'Sorry, something went wrong. Please try again.'
    });
  }
});

// ── POST /api/chat/tts ──

router.post('/tts', optionalAuthMiddleware, async (req, res) => {
  try {
    if (!checkChatRateLimit(req.ip)) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded.' });
    }

    const { text, language = 'en' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text is required.' });
    }

    // Cap text length at 500 characters for cost/latency control
    const truncatedText = text.length > 500 ? text.substring(0, 500) + '...' : text;
    const targetLang = language === 'hi' ? 'hi-IN' : 'en-IN';

    const audioBase64 = await sarvamTextToSpeech(truncatedText, targetLang);

    if (audioBase64) {
      res.json({ success: true, audio: audioBase64 });
    } else {
      // Sarvam TTS failed — frontend will handle browser fallback
      res.status(502).json({ success: false });
    }
  } catch (error) {
    console.error('Chat TTS error:', error.message);
    res.status(500).json({ success: false });
  }
});

// ── POST /api/chat/stt ──

router.post('/stt', optionalAuthMiddleware, upload.single('audio'), async (req, res) => {
  try {
    if (!checkChatRateLimit(req.ip)) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Audio file is required.' });
    }

    const result = await sarvamSpeechToText(req.file.buffer, req.file.originalname || 'audio.webm');

    if (result && result.transcript) {
      res.json({ success: true, transcript: result.transcript });
    } else {
      // Sarvam STT failed — frontend will handle browser fallback
      res.status(502).json({ success: false });
    }
  } catch (error) {
    console.error('Chat STT error:', error.message);
    res.status(500).json({ success: false });
  }
});

export default router;
