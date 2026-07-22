import express from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import User from '../models/User.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { callGroqChat } from '../utils/groqClient.js';
import { createFailureRateLimiter } from '../utils/rateLimiter.js';
import siteKnowledge from '../data/siteKnowledge.js';

// Track 1 — "Your Mentor": persistent, long-form academic AI chat. Read-only with
// respect to the rest of the app (never touches roadmap/quiz/streak data), same
// boundary discipline as the parent dashboard. Every route is student-only.
const router = express.Router();

const MAX_MESSAGE_LEN = 4000;
const MAX_CONTEXT_MESSAGES = 20;
const CHAR_BUDGET = 16000;       // ≈ 4000 tokens at ~4 chars/token
const MENTOR_TEMPERATURE = 0.5;  // slightly warmer than the terse chatbot (0.4)

// Per-USER limiter (reuses the shared sliding-window util keyed by userId, not IP —
// Mentor is authenticated, so an IP key would be wrong for shared school networks).
// Used as a general limiter here: we record EVERY message, not just failures.
const mentorLimiter = createFailureRateLimiter({ windowMs: 60 * 1000, max: 30 });

// Whole router is authenticated students only. Parent/admin sessions → 403.
router.use(authMiddleware, requireRole('student'));

// Mentor's system prompt — paragraph-level teaching (not the chatbot's one-liners),
// scoped to academic help, reusing siteKnowledge grounding + the chatbot's safety
// posture (no fabrication, decline off-topic/harmful).
function buildMentorSystemPrompt(studentName) {
  let p = `You are "Mentor", a patient, knowledgeable personal AI tutor on Project Eklavya, an educational platform for Indian students (Class 10 Science, Class 11 JEE foundation, Class 12 NEET Biology, and related school subjects).

Teach thoroughly: explain concepts step by step with worked examples, and structure longer answers into clear paragraphs or short lists. Unlike a quick chat widget, you should give complete, teaching-quality explanations — depth is welcome when it helps understanding.

Stay scoped to academic help for these students — school and exam-prep subjects, understanding concepts, problem-solving, and study skills. Politely decline requests that are clearly off-topic (non-academic personal matters, entertainment, unrelated coding) or unsafe/harmful, and steer the student back to their learning. Never produce disallowed or harmful content just because this interface is open-ended.

SITE KNOWLEDGE (use this to answer questions about the platform accurately — never invent features or pages that don't exist):
${siteKnowledge}

Rules:
- Never fabricate URLs, citations, video titles, or external links.
- If you are unsure, or a question falls outside these subjects, say so honestly rather than guessing.
- Be warm and encouraging, like a dedicated personal tutor.`;
  if (studentName) p += `\n\nThe student's name is ${studentName}. Address them warmly by name when it feels natural.`;
  return p;
}

// Cap the thread sent to Groq: last MAX_CONTEXT_MESSAGES, then trim oldest-first to
// stay under CHAR_BUDGET, then drop a leading assistant turn so the window always
// BEGINS with a user message — keeping user/assistant pairs intact for the model
// (the current user message is appended by the caller, so the window ends on a user
// turn too).
function buildContext(messages) {
  let ctx = messages.slice(-MAX_CONTEXT_MESSAGES);
  let total = ctx.reduce((n, m) => n + (m.content?.length || 0), 0);
  while (ctx.length > 1 && total > CHAR_BUDGET) {
    total -= ctx[0].content?.length || 0;
    ctx = ctx.slice(1);
  }
  if (ctx.length && ctx[0].role === 'assistant') ctx = ctx.slice(1);
  return ctx.map((m) => ({ role: m.role, content: m.content }));
}

// Auto-title from the first user message. Cheap Groq call; never returns blank —
// falls back to a truncated version of the message on any failure.
async function generateTitle(firstUserMessage) {
  const trimmed = firstUserMessage.trim();
  const fallback = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '');
  try {
    const raw = await callGroqChat(
      [
        { role: 'system', content: 'Summarize the student\'s question as a short 3-6 word title. Return ONLY the title — no quotes, no trailing punctuation.' },
        { role: 'user', content: trimmed }
      ],
      { temperature: 0.3, maxTokens: 20 }
    );
    const cleaned = (raw || '').replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 60);
    return cleaned || fallback;
  } catch {
    return fallback;
  }
}

const notFound = (res) => res.status(404).json({ error: 'Conversation not found.' });

// POST /api/mentor/conversations — create a new (empty) conversation.
router.post('/conversations', async (req, res) => {
  try {
    const convo = await Conversation.create({ userId: req.userId, title: '', messages: [] });
    res.status(201).json({ id: convo._id, title: convo.title, createdAt: convo.createdAt, updatedAt: convo.updatedAt });
  } catch (error) {
    console.error('Mentor create error:', error.message);
    res.status(500).json({ error: 'Server error creating conversation.' });
  }
});

// GET /api/mentor/conversations — the student's own conversations, most recent first.
router.get('/conversations', async (req, res) => {
  try {
    const list = await Conversation.find({ userId: req.userId }).select('title updatedAt').sort({ updatedAt: -1 });
    res.json({ conversations: list.map((c) => ({ id: c._id, title: c.title || '', updatedAt: c.updatedAt })) });
  } catch (error) {
    console.error('Mentor list error:', error.message);
    res.status(500).json({ error: 'Server error fetching conversations.' });
  }
});

// GET /api/mentor/conversations/:id — full message history (ownership-checked → 404).
router.get('/conversations/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const convo = await Conversation.findOne({ _id: req.params.id, userId: req.userId });
    if (!convo) return notFound(res); // 404 (not 403) on another student's id — no enumeration
    res.json({
      id: convo._id,
      title: convo.title,
      messages: convo.messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      createdAt: convo.createdAt,
      updatedAt: convo.updatedAt
    });
  } catch (error) {
    console.error('Mentor fetch error:', error.message);
    res.status(500).json({ error: 'Server error fetching conversation.' });
  }
});

// POST /api/mentor/conversations/:id/message — send a message, persist both turns,
// return the assistant reply (and the generated title on the first exchange).
router.post('/conversations/:id/message', async (req, res) => {
  try {
    if (mentorLimiter.isLimited(req.userId)) {
      return res.status(429).json({ error: 'You\'re sending messages too quickly. Please wait a moment.' });
    }

    const { message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const convo = await Conversation.findOne({ _id: req.params.id, userId: req.userId });
    if (!convo) return notFound(res);

    mentorLimiter.record(req.userId);

    // Light personalization (read-only): the student's name.
    let studentName = null;
    try {
      const user = await User.findById(req.userId).select('name');
      studentName = user?.name || null;
    } catch { /* non-fatal */ }

    const groqMessages = [
      { role: 'system', content: buildMentorSystemPrompt(studentName) },
      ...buildContext(convo.messages),
      { role: 'user', content: message.trim() }
    ];

    let reply;
    try {
      reply = await callGroqChat(groqMessages, { temperature: MENTOR_TEMPERATURE });
    } catch (err) {
      console.error('Mentor Groq call failed:', err.message);
      return res.status(502).json({ error: 'Mentor is having trouble responding right now. Please try again.' });
    }
    if (!reply) {
      return res.status(502).json({ error: 'Mentor is having trouble responding right now. Please try again.' });
    }

    // Persist both turns only on success (no half-saved threads).
    convo.messages.push({ role: 'user', content: message.trim(), createdAt: new Date() });
    convo.messages.push({ role: 'assistant', content: reply, createdAt: new Date() });

    // Title on the first exchange (returned so the client updates the sidebar).
    let newTitle = null;
    if (!convo.title) {
      newTitle = await generateTitle(message.trim());
      convo.title = newTitle;
    }

    await convo.save(); // timestamps:true bumps updatedAt → thread rises to the top of the list

    res.json({ reply, title: newTitle || undefined, conversationId: convo._id });
  } catch (error) {
    console.error('Mentor message error:', error.message);
    res.status(500).json({ error: 'Server error sending message.' });
  }
});

// DELETE /api/mentor/conversations/:id — delete (ownership-checked → 404).
router.delete('/conversations/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const result = await Conversation.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) return notFound(res);
    res.json({ success: true });
  } catch (error) {
    console.error('Mentor delete error:', error.message);
    res.status(500).json({ error: 'Server error deleting conversation.' });
  }
});

export default router;
