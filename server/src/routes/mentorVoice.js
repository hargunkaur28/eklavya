// Feature 27 — the Voice Mentor's server surface.
//
// Four routes, and the interesting one is POST /speak.
//
// NOTE WHAT IS ABSENT: there is no STT route here. Recorded child audio goes to the
// EXISTING `/api/chat/stt`, which holds it in `multer.memoryStorage()`, hands the buffer
// to Sarvam, and releases it. A second upload path would be a second place for that
// buffer to be mishandled, and CI invariant 18 would have to learn about it. One path,
// one invariant, one thing to get right.

import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { mentorLine, MENTOR_LANGUAGES, DEFAULT_MENTOR_LANGUAGE } from '../config/mentorScript.js';
import { getMentorMaxGrade, isGradeEligible, spokenSubjectsFor } from '../utils/mentorConfig.js';
import { buildMentorContext } from '../utils/mentorContext.js';
import {
  synthesizeSpeech, generateContentHash, audioFileExists, saveAudioFile, getAudioUrl
} from '../utils/textToSpeech.js';
import Roadmap from '../models/Roadmap.js';

const router = express.Router();

// Students only, whole router. A parent shares the student's User document under Option
// B (Feature 14), so `requireRole` is what keeps a parent session from flipping the
// child's mentor preferences or hearing their progress read aloud.
router.use(authMiddleware, requireRole('student'));

/** The grade we know about, if any. Age lives on the profile; grade lives on a roadmap. */
async function knownGradeFor(userId) {
  const r = await Roadmap.findOne({ userId, archived: { $ne: true } }).select('grade').sort({ createdAt: -1 }).lean();
  return r?.grade || '';
}

// ── GET /api/mentor-voice/config ────────────────────────────────────────────
//
// Deliberately the same shape as GET /api/auth/profile-config, which exists so the
// client can HIDE the Aadhaar field rather than render one guaranteed to fail on
// submit. Identical reasoning, higher stakes: a mentor button that appears and then
// refuses is operated by a child who cannot read the refusal.
router.get('/config', async (req, res) => {
  try {
    const [user, maxGrade, grade] = await Promise.all([
      User.findById(req.userId).select('mentorVoice hasSeenNarrationPrompt'),
      getMentorMaxGrade(),
      knownGradeFor(req.userId)
    ]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const mv = user.mentorVoice || {};

    // ── The grade HINT ──────────────────────────────────────────────────────
    //
    // Grade normally comes from the student's roadmap, which does not exist yet at the
    // course picker — and the picker is exactly where the child first states a grade.
    // Without this, eligibility could only be re-checked AFTER a roadmap was generated,
    // which is one screen too late: the mentor would have narrated the whole picker to
    // a Class 9 student and then vanished.
    //
    // It is a HINT and not an authority: it only ever narrows which grade is being asked
    // about. The server still decides the answer, and once a roadmap exists the stored
    // grade wins — a client cannot grant itself a mentor by claiming to be in Class 1.
    const hinted = typeof req.query.grade === 'string' ? req.query.grade : '';
    const effectiveGrade = grade || hinted;

    const band = spokenSubjectsFor(effectiveGrade);

    res.json({
      // Whether the mentor applies AT ALL for this student. The client never computes
      // this and never caches it across sessions.
      available: isGradeEligible(effectiveGrade, maxGrade),
      maxGrade,
      knownGrade: grade,
      // Echoed back so the client can tell a stored grade from one it just asked about.
      hintedGrade: grade ? '' : hinted,
      // `offered` and `enabled` are separate states — see the model comment. "Never
      // asked" and "asked and declined" must not collapse, or a child who said no is
      // asked again on every login.
      offered: !!mv.offered,
      enabled: !!mv.enabled,
      language: mv.language || DEFAULT_MENTOR_LANGUAGE,
      tourSeen: !!mv.tourSeen,
      // Which subjects the mentor may NAME, and which cached line asks the question.
      // Server-decided so the two can never disagree, and so there is no third mirror
      // of the taxonomy to drift.
      spokenSubjects: band.subjects,
      subjectLineId: band.lineId
    });
  } catch (error) {
    console.error('Mentor voice config error:', error.message);
    res.status(500).json({ error: 'Server error reading mentor config.' });
  }
});

// ── PATCH /api/mentor-voice/prefs ───────────────────────────────────────────
// The only write path in the feature, and it writes four booleans and an enum.
router.patch('/prefs', async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.mentorVoice) user.mentorVoice = {};

    const { offered, enabled, language, tourSeen } = req.body || {};
    let changed = false;

    if (offered !== undefined) {
      if (typeof offered !== 'boolean') return res.status(400).json({ error: 'offered must be a boolean.' });
      user.mentorVoice.offered = offered; changed = true;
    }
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean.' });
      user.mentorVoice.enabled = enabled; changed = true;
    }
    if (tourSeen !== undefined) {
      if (typeof tourSeen !== 'boolean') return res.status(400).json({ error: 'tourSeen must be a boolean.' });
      user.mentorVoice.tourSeen = tourSeen; changed = true;
    }
    if (language !== undefined) {
      if (!MENTOR_LANGUAGES.includes(language)) return res.status(400).json({ error: 'Invalid mentor language.' });
      user.mentorVoice.language = language; changed = true;

      // ── THE WRITE-THROUGH, AND THE GUARD ON IT ──
      //
      // A child asked "which language?" by the mentor has answered the narration
      // question too, as far as they are concerned; asking again in a different flow is
      // the same question twice. So the mentor's choice sets `narrationLanguagePref`.
      //
      // ONLY when `hasSeenNarrationPrompt` is still false. Once a student has answered
      // the narration prompt explicitly, that answer is theirs and the mentor does not
      // get to overwrite it — a Class 10 student who deliberately chose English
      // narration must not have it flipped by a language choice made for a different
      // purpose. The flag is the record of "they have answered", which is exactly the
      // question being asked here.
      if (!user.hasSeenNarrationPrompt) {
        user.narrationLanguagePref = language === 'hi' ? 'hindi' : 'english';
      }
    }

    if (!changed) return res.status(400).json({ error: 'No mentor preference changes to save.' });
    await user.save();

    res.json({
      mentorVoice: {
        offered: !!user.mentorVoice.offered,
        enabled: !!user.mentorVoice.enabled,
        language: user.mentorVoice.language || DEFAULT_MENTOR_LANGUAGE,
        tourSeen: !!user.mentorVoice.tourSeen
      },
      narrationLanguagePref: user.narrationLanguagePref
    });
  } catch (error) {
    console.error('Mentor voice prefs error:', error.message);
    res.status(500).json({ error: 'Server error saving mentor preferences.' });
  }
});

// ── POST /api/mentor-voice/speak ────────────────────────────────────────────
//
// THE COST MODEL OF THIS ENTIRE FEATURE IS THIS ROUTE.
//
// The body carries a LINE ID, never text. That single choice is what makes the mentor
// affordable: an id resolves to a fixed string, a fixed string hashes to a stable
// filename, and a stable filename means the first child to hear a sentence pays for it
// and every child afterwards replays a WAV off disk for nothing.
//
// Accepting free text here would quietly undo all of it — every caller would send
// slightly different wording, every request would miss the cache, and the bill would
// become per-child-per-utterance forever. So the route cannot be MISUSED that way,
// rather than merely being documented not to be.
//
// The content hash in the filename is what makes editing a line cheap: changing the
// wording changes the hash, so the old WAV is simply never requested again and the new
// one is synthesised once. Nothing to invalidate by hand.
router.post('/speak', async (req, res) => {
  try {
    const { lineId, lang } = req.body || {};
    if (!lineId || typeof lineId !== 'string') {
      return res.status(400).json({ error: 'lineId is required.' });
    }
    const language = MENTOR_LANGUAGES.includes(lang) ? lang : DEFAULT_MENTOR_LANGUAGE;

    const text = mentorLine(lineId, language);
    if (!text) {
      // A stale client asking for a line that has since been removed. 404 and silence,
      // not a 500 — the child is waiting on this response, and an error page is not
      // something they can read.
      return res.status(404).json({ error: 'Unknown mentor line.' });
    }

    const hash = generateContentHash(text);
    // The id is slugged into the filename purely so the cache directory is readable by
    // a human debugging it; the HASH is what identifies the content.
    const slug = lineId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const filename = `mentor-${slug}-${language}-${hash}.wav`;

    // THE CACHE HIT. No provider is contacted, nothing is billed, and this is the path
    // taken by essentially every request after the warm run.
    if (audioFileExists(filename)) {
      return res.json({ audioUrl: getAudioUrl(filename), cached: true });
    }

    const targetLang = language === 'hi' ? 'hi-IN' : 'en-IN';
    // The lock key dedupes concurrent misses on the same line — thirty children opening
    // the dashboard at once in a computer lab must produce ONE synthesis, not thirty.
    const audioBuffer = await synthesizeSpeech(text, targetLang, `mentor:${lineId}:${language}:${hash}`);

    if (!audioBuffer) {
      // Every provider exhausted. Hand the text back so the client can speak it with the
      // browser's own voice — the same graceful degradation the quiz narration path uses
      // (Feature 21), and the only branch where the mentor's text ever reaches the client.
      return res.json({ useFallback: true, fallbackText: text, fallbackLang: language });
    }

    res.json({ audioUrl: saveAudioFile(filename, audioBuffer), cached: false });
  } catch (error) {
    console.error('Mentor voice speak error:', error.message);
    res.status(500).json({ error: 'Server error producing mentor speech.' });
  }
});

// ── GET /api/mentor-voice/context ───────────────────────────────────────────
//
// What the mentor knows. Assembled per request from Roadmap / PracticeSession / Note —
// see utils/mentorContext.js for why there is no stored copy.
//
// Eligibility is re-checked HERE as well as at /config, so a client holding a stale
// config (an admin lowered the ceiling, or the student's grade turned out to be above
// it) cannot keep the mentor alive by not asking again.
router.get('/context', async (req, res) => {
  try {
    const [maxGrade, grade] = await Promise.all([getMentorMaxGrade(), knownGradeFor(req.userId)]);
    if (!isGradeEligible(grade, maxGrade)) {
      return res.status(403).json({ error: 'MENTOR_NOT_AVAILABLE', maxGrade });
    }
    res.json({ context: await buildMentorContext(req.userId) });
  } catch (error) {
    console.error('Mentor voice context error:', error.message);
    res.status(500).json({ error: 'Server error assembling mentor context.' });
  }
});

export default router;
