import express from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { callGroqChat } from '../utils/groqClient.js';
import { renderNotesPdf } from '../utils/notesPdf.js';

// Track 2 — PDF Notes Generator. Groq produces structured notes JSON (Feature
// content); @react-pdf renders the PDF (ephemeral — streamed to the student, not
// persisted). Student-only; neither endpoint writes to the DB.
const router = express.Router();
router.use(authMiddleware, requireRole('student'));

// Input + content caps so a pathological input can't produce a runaway PDF.
const MAX_SUBJECT_LEN = 80;
const MAX_TOPIC_LEN = 120;
const MAX_GRADE_LEN = 40;
const MAX_SECTIONS = 12;
const MAX_POINTS = 15;
const MAX_TERMS = 25;
const MAX_TITLE = 160;
const MAX_HEADING = 160;
const MAX_LINE = 600;

const clamp = (s, n) => String(s ?? '').slice(0, n);

// Clamp/normalize notes on BOTH paths — the AI output AND the (student-edited)
// content sent back for rendering — so the server never trusts client sizes.
function sanitizeNotes(n = {}) {
  const sections = (Array.isArray(n.sections) ? n.sections : [])
    .slice(0, MAX_SECTIONS)
    .map((s) => ({
      heading: clamp(s?.heading, MAX_HEADING).trim(),
      points: (Array.isArray(s?.points) ? s.points : [])
        .slice(0, MAX_POINTS)
        .map((p) => clamp(p, MAX_LINE).trim())
        .filter(Boolean)
    }))
    .filter((s) => s.heading || s.points.length);

  const keyTerms = (Array.isArray(n.keyTerms) ? n.keyTerms : [])
    .slice(0, MAX_TERMS)
    .map((k) => ({ term: clamp(k?.term, 120).trim(), definition: clamp(k?.definition, MAX_LINE).trim() }))
    .filter((k) => k.term);

  return {
    title: clamp(n.title, MAX_TITLE).trim() || 'Study Notes',
    subject: clamp(n.subject, MAX_SUBJECT_LEN).trim(),
    topic: clamp(n.topic, MAX_TOPIC_LEN).trim(),
    sections,
    keyTerms
  };
}

// POST /api/notes/generate  { grade?, subject, topic } → structured notes JSON.
router.post('/generate', async (req, res) => {
  try {
    const subject = clamp(req.body?.subject, MAX_SUBJECT_LEN).trim();
    const topic = clamp(req.body?.topic, MAX_TOPIC_LEN).trim();
    const grade = clamp(req.body?.grade, MAX_GRADE_LEN).trim();
    if (!subject || !topic) {
      return res.status(400).json({ error: 'subject and topic are required.' });
    }

    const prompt = `Generate detailed, accurate, exam-focused study notes for an Indian student${grade ? ` in ${grade}` : ''} on the subject "${subject}", topic "${topic}".
Return ONLY valid JSON in exactly this shape:
{
  "title": "Notes title",
  "sections": [ { "heading": "Section heading", "points": ["full explanatory sentence that teaches the concept, with an example where helpful", "..."] } ],
  "keyTerms": [ { "term": "Term", "definition": "clear one-line definition" } ]
}
Requirements:
- Every bullet point MUST be a complete, self-contained explanatory sentence that actually teaches the concept — give the definition/explanation and a concrete example where helpful (e.g., "A transitive verb needs a direct object, as in 'She kicked the ball'."). NEVER output bare labels, single words, or fragments like "Action verbs" or "Present tense".
- The FIRST section must clearly define the topic itself.
- 3 to 6 sections; 3 to 5 substantive points per section; 5 to 8 key terms, each with a clear definition.
- Keep each point under 280 characters. Plain text only, no markdown. Raw JSON only.`;

    let parsed;
    try {
      const raw = await callGroqChat(
        [
          { role: 'system', content: 'You are an expert exam tutor who writes clear, accurate, structured study notes. Output raw JSON only.' },
          { role: 'user', content: prompt }
        ],
        { jsonMode: true, temperature: 0.4 }
      );
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn('Notes generation failed:', err.message);
      return res.status(502).json({ error: 'Could not generate notes right now. Please try again.' });
    }

    const notes = sanitizeNotes({ ...parsed, subject, topic });
    if (notes.sections.length === 0) {
      return res.status(502).json({ error: 'Could not generate notes right now. Please try again.' });
    }
    res.json({ notes });
  } catch (error) {
    console.error('Notes generate error:', error.message);
    res.status(500).json({ error: 'Server error generating notes.' });
  }
});

// POST /api/notes/pdf  { notes } → streams a PDF download (ephemeral, not stored).
router.post('/pdf', async (req, res) => {
  try {
    const notes = sanitizeNotes(req.body?.notes || {});
    if (notes.sections.length === 0 && notes.keyTerms.length === 0) {
      return res.status(400).json({ error: 'No notes content to render.' });
    }

    const base = (notes.topic || notes.title || 'eklavya-notes')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'eklavya-notes';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);

    const stream = await renderNotesPdf(notes);
    stream.on('error', (err) => {
      console.error('PDF stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Server error rendering PDF.' });
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Notes PDF error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: 'Server error rendering PDF.' });
  }
});

export default router;
