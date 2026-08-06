import express from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import Roadmap from '../models/Roadmap.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import { fetchYoutubeResources } from '../utils/fetchYoutubeResources.js';
import { translateTextWithSarvam, translateQuestionsArray, hindiIsStale, TRANSLATION_REGISTER_VERSION } from '../utils/translateAndCache.js';
import { synthesizeSpeech, saveAudioFile, audioFileExists, generateContentHash, getAudioUrl } from '../utils/textToSpeech.js';
import { recordStudyActivity } from '../utils/recordActivity.js';
import { computeWeakTopics, normalizeTopic, WEAK_TOPIC_THRESHOLD, WEAK_TOPIC_MIN_QUESTIONS } from '../utils/weakTopics.js';
import { gradeWritten } from '../utils/gradeWritten.js';
import { generateWritten, writtenStyleFor } from '../utils/generateWritten.js';
import { normalizeGrade, normalizeSubject, subjectScopeLabel, isWrittenHeavy, subjectDiagramEligible, GRADES } from '../config/taxonomy.js';
import { getBlueprint, chapterForTopic, gradeAnchor } from '../config/syllabusBlueprint.js';
import {
  attachDiagrams, rejectOrphanedFigureQuestions, needsDiagramRetry,
  DIAGRAM_SHARE_MODULE_QUIZ, CACHED_SVG_MAX_BYTES
} from '../utils/generateDiagram.js';
import { callGroqChat } from '../utils/groqClient.js';
import { formatQuestionForTTS, normalizeTextForTTS } from '../utils/ttsNormalize.js';

// Track 3: module quizzes include written questions for English subjects (essay-
// based by nature); other subjects stay MCQ-only. A written answer "passes" at the
// same 70% module-quiz bar (QUIZ_PASS_THRESHOLD), binarised into the existing score.
const MODULE_WRITTEN_COUNT = 2;

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

// The documented roadmap length. Grafting (see graftMissingChapters) and the
// generated plan are both clamped to MAX, because adaptive remediation (Feature 12)
// inserts further days on top of whatever the base plan is.
export const ROADMAP_MIN_DAYS = 10;
export const ROADMAP_MAX_DAYS = 15;

function validateRoadmapJSON(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.days)) return false;
  if (data.days.length < 7 || data.days.length > 25) return false;
  for (const d of data.days) {
    if (typeof d.dayNumber !== 'number' || !d.topic || !d.focus) return false;
  }
  return true;
}

// Call Groq API for Roadmap
async function callGroqForRoadmap(grade, subject, subSubject, weakTopics, strongTopics, notAssessedTopics = [], syllabusChapters = [], omittedLastAttempt = []) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const scope = subjectScopeLabel(subject, subSubject);

  // The adaptive diagnostic (Workstream A) stops as soon as it is confident, so it
  // routinely finishes without reaching every chapter. A chapter it never asked
  // about is NOT a chapter the student knows — it is a chapter with no evidence,
  // and if it is absent from both the weak and strong lists the model has no reason
  // to include it, so it silently disappears from the study plan. It must appear at
  // STANDARD pacing: covered once, without the extra days a weak area earns.
  const notAssessedBlock = notAssessedTopics.length > 0
    ? `- NOT ASSESSED (the diagnostic stopped before reaching these — there is NO evidence either way): ${notAssessedTopics.join(', ')}
  These MUST each appear in the roadmap at NORMAL pacing. Do not skip them, and do not give them the extra depth a weak area gets.`
    : '';

  // The real syllabus for this course, so "breadth" is a concrete list rather than
  // something the model has to reconstruct from the grade name.
  const syllabusBlock = syllabusChapters.length > 0
    ? `\nFULL SYLLABUS for ${grade} ${scope} — the roadmap must span THESE chapters, not only the ones the diagnostic sampled:\n${syllabusChapters.map((c) => `- ${c}`).join('\n')}\n`
    : '';

  const omissionBlock = omittedLastAttempt.length > 0
    ? `\nYOUR PREVIOUS ATTEMPT OMITTED these required topics entirely: ${omittedLastAttempt.join(', ')}. Every one of them must appear as a day's topic this time.\n`
    : '';

  const prompt = `Create a COMPLETE study roadmap for a student in Grade: "${grade}", Subject: "${scope}".

This must be a full course covering the CORE SYLLABUS of ${grade} ${scope}, taught in a sensible progression. It is NOT a remedial course on one topic.
${syllabusBlock}${omissionBlock}
Diagnostic results — use these to WEIGHT emphasis, NOT to limit scope:
- Weaker areas (give MORE days + deeper practice): ${weakTopics.length > 0 ? weakTopics.join(', ') : 'None identified'}
- Stronger areas (still cover, but more briefly as revision): ${strongTopics.length > 0 ? strongTopics.join(', ') : 'General foundation'}
${notAssessedBlock}

CRITICAL SCOPE RULES:
- The roadmap MUST span the BREADTH of ${grade} ${scope}. Do NOT make most days about the weaker areas.
- The diagnostic only sampled a few questions — a topic marked weak from ONE wrong answer means "spend extra time here", NOT "study only this".
- Aim for roughly 30-40% of days giving extra depth to the weaker areas; the REMAINING days must cover the other core syllabus topics of ${grade} ${scope}.
- Every day's topic MUST stay within ${scope} — do not include topics from other areas of ${subject}.
- Do not repeat the same topic on many days; each day should advance to new material (revisit a weak topic at most 2-3 times, with genuinely different angles).

Return ONLY a valid JSON object matching this exact shape:
{
  "totalDays": 14,
  "days": [
    {
      "dayNumber": 1,
      "topic": "Topic Name",
      "focus": "Clear 1-2 sentence focus detailing what to learn today.",
      "estimatedMinutes": 30
    }
  ]
}
Generate between 10 and 15 days of structured, actionable daily study goals covering the syllabus breadth. Ensure dayNumber is 1, 2, 3... sequentially. No markdown formatting, raw JSON only.`;

  // Routed through the shared client so the roadmap gets the same 70b → 8b →
  // OpenAI fallback chain and rate-limit circuit breaker as every other Groq call.
  // It used to fetch Groq directly, which meant a single 429 dropped the student
  // straight to the template fallback while every other feature stayed up.
  const raw = await callGroqChat(
    [{ role: 'user', content: prompt }],
    { jsonMode: true, temperature: 0.3 }
  );
  return JSON.parse(raw);
}

/**
 * Append days for chapters the generated plan left out, using the blueprint's real
 * chapter names and concepts.
 *
 * Used when a regeneration still omits a required chapter: shipping the incomplete
 * plan would be the same silent failure with an extra attempt in front of it, but
 * discarding a good progression wholesale is a worse plan for the student. So the
 * model's ordering is kept and the gaps are filled from config.
 * Returns null when there is nothing real to graft from.
 */
function graftMissingChapters(roadmapData, missingTopics, grade, subject, subSubject, allRequiredTopics = []) {
  const blueprint = getBlueprint(grade, subject, subSubject);
  if (!blueprint || !blueprint.chapters?.length) return null;

  let days = [...(roadmapData.days || [])];
  // Exact-match-first resolution now lives in the blueprint config and is shared with
  // the module-quiz figure gate — see chapterForTopic() for why the order matters.
  const chapterFor = (topic) => chapterForTopic(blueprint, topic, normalizeTopic);

  const resolved = missingTopics.map(chapterFor).filter(Boolean);
  if (!resolved.length) return null;

  // Respect the day budget. Grafting used to append unconditionally, so a 14-day
  // plan plus 3 missing chapters shipped as 17 — and adaptive remediation
  // (Feature 12) then inserts more days on top of that. Whatever will not fit is
  // merged into a single combined day so every chapter is still named, rather than
  // being silently dropped again by a truncation.
  const appended = [];
  let overflow = [];
  for (const ch of resolved) {
    if (days.length + appended.length < ROADMAP_MAX_DAYS) appended.push(ch);
    else overflow.push(ch);
  }

  for (const ch of appended) {
    const concepts = (ch.concepts || []).slice(0, 3).join('; ');
    days.push({
      dayNumber: days.length + 1,
      topic: ch.name,
      focus: concepts ? `Work through ${concepts}.` : `Study the core ideas of ${ch.name}.`,
      estimatedMinutes: 35
    });
  }

  // Spill overflow across SEVERAL catch-up days rather than collapsing everything
  // into one. A day's module quiz is 10 questions pinned to that day's subtopics,
  // and Feature 10 only flags a sub-topic weak once it has >= 2 questions. Three
  // chapters on a day gives roughly three questions each — above the threshold.
  // Eight would give one apiece, so those chapters could never be flagged weak no
  // matter how the student answered, and the day would teach nothing meaningful.
  const CATCHUP_MAX_CHAPTERS = 3;
  if (overflow.length) {
    const chunks = [];
    for (let i = 0; i < overflow.length; i += CATCHUP_MAX_CHAPTERS) {
      chunks.push(overflow.slice(i, i + CATCHUP_MAX_CHAPTERS));
    }
    // Reclaim every slot we need BEFORE pushing anything (truncating inside the
    // loop would drop the catch-up day the previous iteration just added), and
    // reclaim only from days that are NOT the sole coverage of a required chapter.
    // A blind tail-trim deletes whichever late days happened to cover Statistics or
    // Trigonometry, putting those chapters straight back into the missing list.
    const keepSlots = ROADMAP_MAX_DAYS - chunks.length;
    if (days.length > keepSlots) {
      const covers = (d) => allRequiredTopics.some((t) => {
        const needle = normalizeTopic(t);
        return needle && normalizeTopic(`${d.topic || ''} ${d.focus || ''}`).includes(needle);
      });
      const droppable = days.filter((d) => !covers(d));
      const dropCount = Math.min(days.length - keepSlots, droppable.length);
      const toDrop = new Set(droppable.slice(-dropCount));   // trim from the tail
      days = days.filter((d) => !toDrop.has(d));
      if (dropCount < days.length - keepSlots) {
        console.warn('Roadmap: every remaining day covers a required chapter — plan kept slightly over budget rather than dropping coverage.');
      }
    }
    for (const chunk of chunks) {
      const names = chunk.map((c) => c.name).join(', ');
      days.push({
        dayNumber: days.length + 1,
        topic: `Catch-up: ${names}`,
        focus: `Cover the core ideas of ${names} — these were not assessed in your diagnostic, so work through each one's basics.`,
        estimatedMinutes: 45
      });
    }
    console.warn(`Roadmap day budget reached — spilled ${overflow.length} unassessed chapter(s) across ${chunks.length} catch-up day(s), max ${CATCHUP_MAX_CHAPTERS} per day.`);
  }

  return { totalDays: days.length, days: days.map((d, i) => ({ ...d, dayNumber: i + 1 })) };
}

/**
 * Deterministic roadmap built from the syllabus blueprint, used when generation
 * is unavailable.
 *
 * This replaces a hardcoded twelve-day template ("Foundational Review", "Key
 * Definitions & Terms", "Advanced Topic Exploration") that named no actual
 * syllabus content at all — so an outage silently produced a study plan in which
 * every real chapter was missing, not just the unassessed ones. The blueprint is
 * config, not filler: these are the real NCERT/CBSE chapter names and the real
 * concepts an exam tests, in syllabus order. Weak chapters get a second day;
 * everything else — including chapters the diagnostic never reached — gets one.
 * Returns null when there is no blueprint for the course, so the caller can fall
 * back further rather than inventing content.
 */
function buildBlueprintRoadmap(grade, subject, subSubject, weakTopics) {
  const blueprint = getBlueprint(grade, subject, subSubject);
  if (!blueprint || !blueprint.chapters?.length) return null;

  // Exact match first, for the same reason as chapterFor: a short weak-topic label
  // must not claim a longer chapter that merely contains it.
  const isWeak = (name) => {
    const b = normalizeTopic(name);
    if (!b) return false;
    if (weakTopics.some((w) => normalizeTopic(w) === b)) return true;
    return weakTopics.some((w) => {
      const a = normalizeTopic(w);
      return a && (a.includes(b) || b.includes(a));
    });
  };

  const days = [];
  for (const ch of blueprint.chapters) {
    if (days.length >= 15) break;
    const concepts = (ch.concepts || []).slice(0, 3).join('; ');
    days.push({
      dayNumber: days.length + 1,
      topic: ch.name,
      focus: concepts ? `Work through ${concepts}.` : `Study the core ideas of ${ch.name}.`,
      estimatedMinutes: 35
    });
    // A weak chapter earns a second, deeper day — the same weighting the model is
    // asked for, applied deterministically.
    if (isWeak(ch.name) && days.length < 15) {
      const extra = (ch.concepts || []).slice(3).join('; ') || concepts;
      days.push({
        dayNumber: days.length + 1,
        topic: `${ch.name} — extra practice`,
        focus: extra ? `Targeted practice on ${extra}.` : `Extra practice problems on ${ch.name}.`,
        estimatedMinutes: 45
      });
    }
  }

  return days.length >= 5 ? { totalDays: days.length, days } : null;
}

// Call Groq to generate prose explainer text for a single day.
// Returns null when generation is unavailable — NEVER filler.
//
// This used to return "Welcome to Day's module on {topic}. Focus: {focus}" on any
// failure, and the caller then set `contentGenerated = true` and saved it. So a
// transient outage permanently cached a non-lesson: the student opened the day,
// got one sentence that taught nothing, and never got real content again even
// after Groq recovered. A missing lesson the student can retry is strictly better
// than a fake one that looks delivered.
// ── Grade anchoring (device-testing finding D) ──────────────────────────────
//
// A Class 1 roadmap was teaching whole and rational numbers. The cause was structural,
// not a bad generation: the DIAGNOSTIC is grounded — it gets `GRADE_LEVEL_ANCHORS` plus
// three worked exemplars, which is the whole point of Workstream A1 — but everything
// DOWNSTREAM of it got the grade as a bare string. `Grade: "Class 1"` in a prompt is a
// label, not a constraint, and a model handed a label writes at whatever level the
// topic name suggests to it. "Number System" suggests the Class 6 chapter.
//
// So the same anchor the diagnostic uses is injected here. It is DETERMINISTIC and free
// — `gradeAnchor()` is a table lookup covering every grade including Nursery — which is
// why anchors are reused downstream and exemplars are not: exemplars would mean a
// `resolveBlueprint` call per day for every grade below Class 10.
//
// PRIMARY GRADES GET A HARDER INSTRUCTION THAN AN ANCHOR ALONE, because the failure is
// asymmetric. Writing slightly below level wastes a child's time; writing four years
// above it is content they cannot read at all, and — since a day's lesson is CACHED —
// it is served that way for the life of the roadmap.
const PRIMARY_MAX_GRADE_INDEX = GRADES.indexOf('Class 5');
function isPrimaryGrade(grade) {
  const i = GRADES.findIndex((g) => normalizeGrade(g) === normalizeGrade(grade));
  return i >= 0 && i <= PRIMARY_MAX_GRADE_INDEX;
}

async function callGroqForDayContent(grade, subject, topic, focus) {
  const primary = isPrimaryGrade(grade);
  const anchor = gradeAnchor(grade);

  // THE LENGTH INSTRUCTION IS BANDED, and this is not a stylistic preference. A
  // "comprehensive 2-3 paragraph explanation" is the right shape for Class 10 and the
  // wrong shape for Class 1, where brevity IS the requirement — asking a model for
  // three paragraphs on counting to 100 is asking it to pad, and padding at that age
  // means reaching for material the child has not met.
  const shape = primary
    ? `Write a SHORT, very simple explanation for a young child in ${grade} studying ${subject}.
Use 4 to 6 short sentences in total. Everyday words a small child already knows. One idea per sentence.
Do NOT introduce any concept beyond ${grade}. Do NOT mention advanced terms (for example: whole numbers, natural numbers, rational numbers, integers, prime numbers, place value beyond what ${grade} covers) unless the topic itself is exactly that.`
    : `Write a comprehensive, clear, 2-3 paragraph educational explanation for a student in ${grade} studying ${subject}.
Explain the key theoretical concepts, important rules/formulas, and practical applications in student-friendly tone.`;

  const prompt = `${shape}
Topic: "${topic}"
Focus: "${focus}"

The cognitive level for ${grade} is: ${anchor}
Everything you write must sit AT that level — not above it. If the topic name is also used in higher classes, teach only the ${grade} meaning of it.

Do not use markdown headings. Plain formatted paragraphs only.`;

  try {
    // Shared client → 70b → 8b → OpenAI, plus the rate-limit circuit breaker.
    const text = await callGroqChat([{ role: 'user', content: prompt }], { temperature: 0.4 });
    const trimmed = (text || '').trim();
    // A one-line reply is not a lesson; treat it as a failure rather than cache it.
    //
    // THE FLOOR IS BANDED TOO. At 200 characters it was actively wrong below Class 6:
    // it forced length in the one place brevity is the requirement, so a correct short
    // Class 1 lesson was REJECTED as a failure and the day cached nothing. The primary
    // floor is low enough to catch a genuine one-line non-answer and nothing else.
    const floor = primary ? 80 : 200;
    return trimmed.length >= floor ? trimmed : null;
  } catch (err) {
    console.warn('Groq day content call failed:', err.message);
    return null;
  }
}

// Helper: Match hand-written course YouTube link. Track 4.1: the lowercasing now
// comes from the shared normalizer (also null-safe) instead of ad-hoc .toLowerCase()
// — the substring-matching LOGIC is deliberately unchanged (bit-identical resolution
// for the existing triad; verified by test). Exported for that test. NOTE: the
// substring rules are legacy/fragile (e.g. "Class 11 Biology" resolves to the JEE
// course because '11' is checked before 'biology') — preserved as-is, not "fixed",
// because behaviour-preservation is the 4.1 contract; a real rethink is 4.2.
export function getResourceLinkForTopic(grade, subject, subSubject = '') {
  // Sub-subject courses have no matching static catalog entry, and the substring
  // rules would mis-route them (a Science→Physics day linking the general Science
  // course). Scope the bleed out: no deep-link when a sub-subject is chosen.
  if (subSubject) return null;
  const key = `${normalizeGrade(grade)}_${normalizeSubject(subject)}`;
  if (key.includes('10') && key.includes('science')) return 'pw-udaan-class-10';
  if (key.includes('11') || key.includes('jee')) return 'pw-arjuna-jee';
  if (key.includes('neet') || key.includes('biology')) return 'unacademy-neet-biology';
  return null;
}

// Phase 3: module quiz pass mark. 70% (e.g. 7/10) — below this the day is NOT
// marked complete even with the video watched, but the student may retake.
const QUIZ_PASS_THRESHOLD = 0.7;
const MODULE_QUIZ_MIN_QUESTIONS = 10;
// WEAK_TOPIC_THRESHOLD / WEAK_TOPIC_MIN_QUESTIONS / normalizeTopic now live in
// utils/weakTopics.js (shared by student/parent/admin) and are imported above.
// Phase 7: only insert a remediation day once the student has RETAKEN a day's
// quiz (attemptCount >= 2) and a sub-topic is still weak — first fail never
// churns the roadmap. Option (a): insert one day, never touch completed days.
const REMEDIATION_MIN_ATTEMPTS = 2;

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
  // Workstream G: retranslate anything cached under an older register version, not
  // just anything untranslated — otherwise existing Hindi serves stale forever.
  const pending = questions.filter((q) => hindiIsStale(q));
  if (pending.length === 0) return false;

  let changed = false;

  // MCQ: option-order-preserving path (correctIndex stays valid).
  const mcq = pending.filter(q => q.type !== 'written');
  if (mcq.length) {
    const translated = await translateQuestionsArray(
      mcq.map(q => ({ questionText: q.questionText, options: q.options, explanation: q.explanation }))
    );
    mcq.forEach((q, i) => {
      const tr = translated[i];
      // Only latch as translated if the stem actually became Hindi. If the service
      // failed (returned the English unchanged), leave hindiTranslated=false so the
      // next Hindi read retries instead of caching the failure forever.
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

  // Track 3: written questions have no options/index — distinct branch translating
  // ONLY the prompt (never through the option-order helper).
  for (const q of pending.filter(q => q.type === 'written')) {
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

// Client-safe question view (no correctIndex/explanation/expectedPoints), localized.
function serializeQuizQuestion(q, idx, isHindi) {
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
    // Workstream D. Sanitised at generation; the client renders it as a data-URI
    // <img>, which cannot execute script even if sanitisation were bypassed. Omitted
    // entirely when absent so the payload shape is unchanged for text-only questions.
    ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {})
  };
}

// Pin each question's freeform `topic` to a canonical per-day sub-topic. Returns
// { subtopics, questions } where every question.topic is one of subtopics (exact
// casing). Unmatched question topics are appended so nothing is silently dropped.
// Exported for CI invariant 8, which feeds a fully-populated question through this
// function and fails the build if any schema field is dropped. Do not inline the
// field list into a separate constant for the test to read — the test must observe
// what this function ACTUALLY returns, or it only checks that two lists agree.
export function canonicalizeSubtopics(rawSubtopics, questions) {
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
      explanation: q.explanation || '',
      // Track 3: carry written-question fields through canonicalization so a
      // written question's topic is pinned to a canonical sub-topic EXACTLY like
      // an MCQ's — which is what lets weakTopics.js + remediation treat it the same.
      type: q.type || 'mcq',
      expectedPoints: q.expectedPoints || [],
      writtenStyle: q.writtenStyle || 'short',
      // This allow-list is also run by the LAZY MIGRATION path over questions that
      // are already cached, so anything missing here is silently destroyed on the
      // next fetch rather than merely absent on a fresh generation. Workstream D's
      // figures were being wiped that way; the Hindi/audio caches below were too,
      // which meant a pre-Phase-4 quiz lost its translations and paid to redo them.
      chapterId: q.chapterId || '',
      ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {}),
      ...(q.diagramAttempted === true ? { diagramAttempted: true } : {}),
      translatedHindiQuestionText: q.translatedHindiQuestionText || '',
      translatedHindiOptions: q.translatedHindiOptions || [],
      translatedHindiExplanation: q.translatedHindiExplanation || '',
      hindiTranslated: !!q.hindiTranslated,
      // Added to the schema in Workstream G; CI invariant 8 caught its absence here
      // by name, which is precisely the silent loss it exists to prevent.
      ...(q.hindiRegisterVersion ? { hindiRegisterVersion: q.hindiRegisterVersion } : {}),
      audioQuestionEn: q.audioQuestionEn || '',
      audioQuestionHi: q.audioQuestionHi || ''
    };
  });

  return { subtopics, questions: mapped };
}

// Phase 7: generate a SINGLE remediation day via a real Groq call, grounded in
// the student's specific weak sub-topic (no template filler). Returns
// { topic, focus, estimatedMinutes } or null if generation fails (in which case
// we insert NOTHING rather than a placeholder day).
async function callGroqForRemediationDay(grade, subject, weakSubtopic, sourceDayTopic) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') return null;

  const prompt = `A student in ${grade} studying ${subject} is struggling specifically with "${weakSubtopic}" (from the lesson "${sourceDayTopic}"). Design ONE focused remediation study day that re-teaches and reinforces exactly this weak sub-topic.

Return ONLY valid JSON in this shape:
{
  "topic": "Short, specific title for the remediation day about ${weakSubtopic}",
  "focus": "1-2 sentence description of what to review and practise to fix this weakness.",
  "estimatedMinutes": 30
}
No markdown, raw JSON only.`;

  try {
    // Shared client → 70b → 8b → OpenAI + rate-limit circuit breaker.
    const raw = await callGroqChat(
      [{ role: 'user', content: prompt }],
      { jsonMode: true, temperature: 0.3 }
    );
    const parsed = JSON.parse(raw || '{}');
    if (!parsed.topic || !parsed.focus) return null;
    return {
      topic: String(parsed.topic),
      focus: String(parsed.focus),
      estimatedMinutes: Number(parsed.estimatedMinutes) || 30
    };
  } catch (err) {
    console.warn('Remediation day generation failed:', err.message);
    return null;
  }
}

// Phase 7 trigger. After a module quiz submit for `day`, insert ONE remediation
// day iff: the student has retaken this day's quiz (attemptCount >= 2), a
// sub-topic on it is still weak (<60%, >=2 Qs), and no remediation day already
// exists for that sub-topic. Completed days are NEVER modified — the new day is
// spliced in after `day` and only LATER days are renumbered. Returns the
// inserted-day summary or null.
async function maybeInsertRemediationDay(roadmap, day) {
  const attempt = day.moduleQuizAttempt;
  if (!attempt || !attempt.attempted || (attempt.attemptCount || 0) < REMEDIATION_MIN_ATTEMPTS) return null;

  // Aggregate THIS attempt's questions by (day-anchored) sub-topic.
  const agg = {};
  for (const q of attempt.questions || []) {
    const key = q.topic || 'General';
    if (!agg[key]) agg[key] = { correct: 0, total: 0 };
    agg[key].total += 1;
    if (q.isCorrect) agg[key].correct += 1;
  }

  // Pick the weakest eligible sub-topic.
  let weakest = null;
  for (const [sub, s] of Object.entries(agg)) {
    const acc = s.total > 0 ? s.correct / s.total : 1;
    if (s.total >= WEAK_TOPIC_MIN_QUESTIONS && acc < WEAK_TOPIC_THRESHOLD) {
      if (!weakest || acc < weakest.acc) weakest = { sub, acc };
    }
  }
  if (!weakest) return null;

  // Anti-duplicate: never insert a second remediation day for the same sub-topic.
  if (roadmap.days.some(d => d.isRemediation && d.remediationForSubtopic === weakest.sub)) return null;

  // Real Groq generation — if it fails, insert nothing (no template filler).
  const gen = await callGroqForRemediationDay(roadmap.grade, roadmap.subject, weakest.sub, day.topic);
  if (!gen) return null;

  const D = day.dayNumber;
  const insertAt = roadmap.days.findIndex(d => d.dayNumber === D) + 1;

  // Shift ONLY later days' numbers in place; earlier/completed day subdocs are
  // never touched (so they stay byte-identical), then splice the new day in.
  for (const d of roadmap.days) { if (d.dayNumber > D) d.dayNumber += 1; }

  const newDay = {
    dayNumber: D + 1,
    topic: gen.topic,
    focus: gen.focus,
    resourceLink: null,
    estimatedMinutes: gen.estimatedMinutes,
    completed: false,
    content: '',
    resources: [],
    contentGenerated: false,
    isRemediation: true,
    remediationForSubtopic: weakest.sub,
    remediationFromDay: D
  };
  roadmap.days.splice(insertAt, 0, newDay);
  roadmap.totalDays = roadmap.days.length;
  roadmap.markModified('days');

  return { dayNumber: newDay.dayNumber, topic: newDay.topic, subtopic: weakest.sub };
}

// Generates a quiz grounded ONLY in this specific day's topic/focus/content.
// Fresh Groq call — no static bank, no reuse of the diagnostic generator.
async function callGroqForModuleQuiz(grade, subject, topic, focus, content) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API Key not configured');
  }

  const grounding = (content || '').trim().slice(0, 4000);
  // Finding D again, one layer on: the quiz got `Grade: "Class 1"` as a bare label with
  // no cognitive anchor, so it wrote whatever the topic name suggested. A quiz is worse
  // than a lesson to get wrong — the child is graded on it, and the module-quiz pass is
  // half the Feature 9 completion gate, so an off-level quiz can lock a day permanently.
  const anchor = gradeAnchor(grade);
  const primaryRule = isPrimaryGrade(grade)
    ? `\nThis is a YOUNG CHILD. Every question must use short everyday words, one step only, and nothing beyond ${grade}. Do NOT use advanced vocabulary (whole numbers, natural numbers, rational numbers, integers, prime numbers) unless the lesson itself is exactly about it.`
    : '';

  const prompt = `You are writing a module quiz for ONE specific lesson in a study roadmap.

Grade: "${grade}"
Cognitive level for this grade (questions must sit AT this level, never above it): ${anchor}${primaryRule}
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

  // Shared client → 70b → 8b → OpenAI + rate-limit circuit breaker.
  const raw = await callGroqChat(
    [{ role: 'user', content: prompt }],
    { jsonMode: true, temperature: 0.4 }
  );
  return JSON.parse(raw || '{}');
}

// True if the day's video requirement (Phase 2, OR logic) is satisfied.
//
// ── A DAY WITH NO VIDEO HAS NO VIDEO REQUIREMENT ────────────────────────────
//
// The Feature 9 gate is "a video watched AND the quiz passed". That is correct while a
// day HAS videos. When it has none, the first half is unsatisfiable and the day becomes
// permanently uncompletable — the student passes the quiz, the day stays open, and
// nothing on screen explains why. There is no action available to them that closes it.
//
// Days legitimately arrive with no video: `fetchYoutubeResources` returns `[]` when the
// API key is unset, when the quota is spent, when the request errors, and — since the
// grade-banded ranking was added (finding D) — whenever a search yields nothing this
// grade should be shown. That last one is a FEATURE working correctly, and it must not
// produce a dead end.
//
// The Voice Mentor made this urgent rather than theoretical: it now tells a child with
// no video to "read the lesson and answer the questions", and before this change that
// instruction led them into a day that could never be completed. Instructing a child
// who cannot read the screen into a dead end is the worst failure this feature can have.
//
// So the requirement is VACUOUSLY SATISFIED when there is nothing to watch. This
// deliberately does NOT weaken the gate where it applies: a day with videos still
// requires one to be watched. It only stops the gate applying to something that is not
// there.
export function dayHasVideos(day) {
  return (day?.resources || []).some((r) => r?.type === 'youtube');
}

function isAnyVideoWatched(day) {
  if (!dayHasVideos(day)) return true;   // nothing to watch — see above
  return (day.videoProgress || []).some(v => v.watched) || Boolean(day.videoWatched);
}

// POST /api/roadmap/generate
router.post('/generate', authMiddleware, requireRole('student'), async (req, res) => {
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

    const subSubject = diagnostic.subSubject || '';

    // Workstream A: chapters the adaptive diagnostic never reached. No evidence
    // either way — they must still be taught, at standard pacing. Without this the
    // chapter is in neither the weak nor the strong list and quietly vanishes from
    // the student's plan because the quiz ran out of budget, not because they know it.
    const notAssessedTopics = Array.isArray(diagnostic.chapterCoverage?.untouchedChapters)
      ? diagnostic.chapterCoverage.untouchedChapters.filter(Boolean)
      : [];

    // The real chapter list for this course, so "cover the breadth" is a concrete
    // instruction rather than something the model reconstructs from the grade name.
    const blueprint = getBlueprint(diagnostic.grade, diagnostic.subject, subSubject);
    const syllabusChapters = blueprint ? blueprint.chapters.map((c) => c.name) : [];

    // Did the generated plan actually mention a required topic anywhere?
    const mentions = (data, topic) => {
      const needle = normalizeTopic(topic);
      if (!needle) return true;
      return (data.days || []).some((d) =>
        normalizeTopic(`${d.topic || ''} ${d.focus || ''}`).includes(needle)
      );
    };
    const omissionsIn = (data) => notAssessedTopics.filter((t) => !mentions(data, t));

    let roadmapData = null;
    try {
      roadmapData = await callGroqForRoadmap(
        diagnostic.grade, diagnostic.subject, subSubject,
        weakTopics, strongTopics, notAssessedTopics, syllabusChapters
      );

      let omitted = validateRoadmapJSON(roadmapData) ? omissionsIn(roadmapData) : [];
      if (!validateRoadmapJSON(roadmapData) || omitted.length) {
        console.warn(
          omitted.length
            ? `Roadmap omitted unassessed topic(s): ${omitted.join(', ')} — retrying once.`
            : 'First Groq roadmap validation failed, retrying once...'
        );
        const retry = await callGroqForRoadmap(
          diagnostic.grade, diagnostic.subject, subSubject,
          weakTopics, strongTopics, notAssessedTopics, syllabusChapters, omitted
        );
        // Keep the retry only if it is valid; a valid-but-still-incomplete retry is
        // still better than an invalid one, so prefer whichever covers more.
        if (validateRoadmapJSON(retry)) {
          if (!validateRoadmapJSON(roadmapData) || omissionsIn(retry).length <= omitted.length) {
            roadmapData = retry;
          }
        }
        // If the retry ALSO omits chapters, do not ship the incomplete plan — that
        // is the same silent failure with an extra attempt in front of it. Graft the
        // missing chapters on using real blueprint content, which keeps the model's
        // (usually better) progression instead of discarding it wholesale.
        const stillMissing = validateRoadmapJSON(roadmapData) ? omissionsIn(roadmapData) : notAssessedTopics;
        if (stillMissing.length && validateRoadmapJSON(roadmapData)) {
          const grafted = graftMissingChapters(roadmapData, stillMissing, diagnostic.grade, diagnostic.subject, subSubject, notAssessedTopics);
          if (grafted) {
            console.warn(`Roadmap still omitted ${stillMissing.join(', ')} after retry — appended them from the syllabus blueprint.`);
            roadmapData = grafted;
            // Verify the graft actually closed the gap rather than assuming it did.
            const afterGraft = omissionsIn(roadmapData);
            if (afterGraft.length) {
              console.error(`Roadmap STILL omits ${afterGraft.join(', ')} after grafting — blueprint chapter names may not match the coverage labels.`);
            }
          } else {
            // No blueprint content to graft from → discard the incomplete plan and
            // let the deterministic fallback below build a complete one.
            console.warn(`Roadmap still omits ${stillMissing.join(', ')} and no blueprint is available — discarding the incomplete plan.`);
            roadmapData = null;
          }
        }
      }
    } catch (err) {
      console.warn('Groq roadmap generation failed, generating fallback roadmap:', err.message);
    }

    // Generation unavailable → build the plan from the real syllabus blueprint
    // before considering the generic template, so an outage still produces a
    // roadmap made of actual chapters rather than placeholder day titles.
    if (!roadmapData || !validateRoadmapJSON(roadmapData)) {
      const fromBlueprint = buildBlueprintRoadmap(diagnostic.grade, diagnostic.subject, subSubject, weakTopics);
      if (fromBlueprint) {
        console.warn(`Roadmap generation unavailable — built a ${fromBlueprint.days.length}-day plan from the syllabus blueprint.`);
        roadmapData = fromBlueprint;
      }
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

    const defaultResource = getResourceLinkForTopic(diagnostic.grade, diagnostic.subject, subSubject);

    // Clamp to the documented range. validateRoadmapJSON tolerates 7-25 so a
    // slightly-off model response is not thrown away, but what we STORE stays
    // inside 10-15 — remediation (Feature 12) grows the plan from here.
    const formattedDays = roadmapData.days.slice(0, ROADMAP_MAX_DAYS).map((d, index) => ({
      dayNumber: index + 1,
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
    // Identity key is now {userId, grade, subject, subSubject}: archive only the
    // active roadmap for the SAME sub-subject course. Regenerating "English·Grammar"
    // never touches "English·Fusion" or any other subject. Match subSubject exactly
    // (including '' for flat subjects, so flat courses archive as before).
    await Roadmap.updateMany(
      {
        userId: req.userId, archived: { $ne: true },
        grade: diagnostic.grade, subject: diagnostic.subject,
        subSubject: subSubject || { $in: ['', null] }
      },
      { $set: { archived: true, archivedAt: new Date() } }
    );

    const newRoadmap = await Roadmap.create({
      userId: req.userId,
      diagnosticResultId: diagnostic._id,
      grade: diagnostic.grade,
      subject: diagnostic.subject,
      subSubject,
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

      targetDay.resources = realResources;
      // Only mark the day generated when there is a REAL lesson to cache. Marking it
      // on failure is what used to freeze a placeholder in place forever; leaving it
      // unset means the next visit tries again, and the videos are still shown
      // meanwhile so the day is not empty.
      if (proseContent) {
        targetDay.content = proseContent;
        targetDay.contentGenerated = true;
      } else {
        console.warn(`Day ${targetDay.dayNumber} lesson generation unavailable — not caching, will retry on next view.`);
      }
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
      // False when the lesson could not be generated. The client shows a retry
      // rather than an empty panel, and the day is NOT cached, so revisiting
      // regenerates. Videos and the quiz still work in the meantime.
      contentAvailable: !!targetDay.contentGenerated,
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
router.patch('/:id/day/:dayNumber', authMiddleware, requireRole('student'), async (req, res) => {
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
router.patch('/:id/day/:dayNumber/video-progress', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { videoId, watchedSeconds, durationSeconds, localDate } = req.body;

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

    // Phase 8: watching to threshold IN THIS SESSION counts as studying today —
    // including re-watching a video that was already completed on a prior day.
    // (Uses this call's position, not the persisted max, so merely re-opening a
    // finished video without watching doesn't count.)
    const watchedToThresholdNow = record.durationSeconds > 0
      && incomingWatched / record.durationSeconds >= VIDEO_WATCH_THRESHOLD;
    if (watchedToThresholdNow) await recordStudyActivity(req.userId, localDate);

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
    const wasCached = !!day.moduleQuiz?.generated && !!(day.moduleQuiz.questions || []).length;
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

      // Track (sub-subjects): auto-include written questions only for WRITTEN-HEAVY
      // courses — English Writing & Fusion. English Grammar/Reading (and every other
      // subject) stay MCQ-only in the cached module quiz (there's no per-attempt
      // toggle here; the includeWritten toggle applies to diagnostic + practice).
      if (isWrittenHeavy(roadmap.subject, roadmap.subSubject)) {
        // Pass the MCQ's canonical sub-topic list so written questions tag from the
        // SAME labels (not free-generated) — minimizes the synonym-drift that would
        // otherwise split written topics into their own weak-topic buckets.
        const written = await generateWritten(
          roadmap.grade, roadmap.subject, day.topic, MODULE_WRITTEN_COUNT,
          writtenStyleFor(roadmap.subject, roadmap.subSubject), quizData.subtopics
        );
        if (written.length) {
          built.splice(built.length - written.length, written.length, ...written);
        }
      }

      // Phase 4: pin question topics to the canonical per-day sub-topic list
      // (type-agnostic — MCQ and written alike).
      const { subtopics, questions: canonQuestions } = canonicalizeSubtopics(quizData.subtopics, built);
      day.subtopics = subtopics;

      // ── Workstream D: figures are attached BEFORE the cache write ──
      // A module quiz is generated once and served for the life of the roadmap, so
      // the question and its figure have to be cached as ONE unit. Writing the
      // questions first and attaching afterwards would mean a revisit could serve a
      // figureless question that the orphan guard had already waved through against
      // the figure it expected to be there.
      const dayChapter = chapterForTopic(
        getBlueprint(roadmap.grade, roadmap.subject, roadmap.subSubject), day.topic, normalizeTopic
      );
      // Absence of a blueprint entry is NOT a decision that this course gets no
      // figures. The blueprint covers the exam grades only; the taxonomy covers all
      // 280 course identities. Gating solely on the chapter meant a Class 6 Maths
      // module quiz silently never attempted a figure while a Class 6 Maths PRACTICE
      // quiz did — same student, same subject, different behaviour, nothing surfacing
      // it. So the chapter is used when it exists, and otherwise this falls through to
      // the subject-level gate rather than answering `false` from a missing row.
      const subjectEligible = subjectDiagramEligible(roadmap.subject, roadmap.subSubject);
      if (dayChapter || subjectEligible) {
        // With a chapter, every question on the day belongs to it (no per-question
        // topic matching). Without one, eligibility was already decided at subject
        // level, so the predicate says yes and the day's topic labels the prompt.
        if (dayChapter) {
          canonQuestions.forEach((q) => { if (q.type !== 'written') q.chapterId = dayChapter.id; });
        }
        await attachDiagrams(canonQuestions, {
          grade: roadmap.grade,
          subject: roadmap.subject,
          subSubject: roadmap.subSubject,
          ...(dayChapter
            ? { chapters: [dayChapter] }
            : { isEligible: () => true, topicLabel: day.topic }),
          // 8KB, not the 50KB general cap: this SVG lives inside the Roadmap document
          // for good, alongside lesson prose, attempts and video progress.
          maxBytes: CACHED_SVG_MAX_BYTES,
          share: DIAGRAM_SHARE_MODULE_QUIZ,
          // This quiz is cached for the life of the roadmap, so the sampling decision
          // is final. Without this the retry pass on the next day fetch would treat
          // every unsampled question as a failed one.
          finalizeUnselected: true
        });
      }

      // Immediately before the write, and after diagrams are attached — a question
      // that says "in the figure below" without one is unanswerable, and cached that
      // way it stays unanswerable forever.
      const { safe: cacheable } = rejectOrphanedFigureQuestions(canonQuestions);

      day.moduleQuiz = { generated: true, generatedAt: new Date(), questions: cacheable };
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

    // ── Workstream D: one retry for a figure that was never actually attempted ──
    // Only on an ALREADY-cached quiz. A quiz generated a few lines above has just had
    // its one shot; retrying inside the same request would double the cost of a
    // provider that is currently failing, which is precisely when not to.
    if (wasCached) {
      const chapters = getBlueprint(roadmap.grade, roadmap.subject, roadmap.subSubject)?.chapters || [];
      const byId = new Map(chapters.map((c) => [c.id, c]));
      // Same subject-level fall-through as the generate path above: an empty chapter
      // map means "this course is not in the blueprint", not "this course gets no
      // figures". Without it the retry is unreachable for every non-exam grade.
      const subjEligible = subjectDiagramEligible(roadmap.subject, roadmap.subSubject);
      const retryable = (day.moduleQuiz.questions || []).filter((q) => needsDiagramRetry(q, byId, subjEligible));
      if (retryable.length) {
        console.log(`Module quiz day ${day.dayNumber}: retrying ${retryable.length} unattempted figure(s).`);
        await attachDiagrams(retryable, {
          grade: roadmap.grade,
          subject: roadmap.subject,
          subSubject: roadmap.subSubject,
          // The same fall-through once more, because attachDiagrams applies its OWN
          // chapter-based eligibility filter: handing it an empty chapter list would
          // discard every question needsDiagramRetry just selected, and the retry
          // would silently do nothing for non-blueprint courses.
          ...(chapters.length
            ? { chapters }
            : { isEligible: () => true, topicLabel: day.topic }),
          maxBytes: CACHED_SVG_MAX_BYTES,
          // Not DIAGRAM_SHARE_MODULE_QUIZ: this list was ALREADY filtered down to the
          // questions that should have a figure and do not. Re-applying the 0.35 share
          // would sample a third of an already-sampled set, so most retries would
          // silently never happen.
          share: 1
        });
        // EXACTLY one retry. Burn the attempt whatever the outcome, including another
        // timeout — otherwise a persistently degraded provider is re-called on every
        // single day view, forever, and the student pays that latency for a figure
        // that is not coming.
        retryable.forEach((q) => { q.diagramAttempted = true; });
        roadmap.markModified('days');
        await roadmap.save();
      }
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
router.post('/:id/day/:dayNumber/quiz/submit', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { answers, localDate } = req.body;

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

    // Mixed scoring: MCQ = index compare; written = AI-graded, binarised at the SAME
    // 70% module bar. Written grading is async, so this awaits ALL of them before
    // score/pass/weak-topics are computed. Every result carries a canonical `topic`
    // + `isCorrect`, so weakTopics.js aggregation + remediation treat written and
    // MCQ identically. expectedPoints is snapshotted from the graded question.
    const resultQuestions = await Promise.all(quizQuestions.map(async (q, idx) => {
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
          questionText: q.questionText,
          topic: q.topic || 'General',
          isCorrect: graded.overall >= QUIZ_PASS_THRESHOLD * 100,
          writtenAnswer: studentAnswer,
          writtenStyle: q.writtenStyle,
          writtenScores: { content: graded.content, grammar: graded.grammar, spelling: graded.spelling },
          writtenOverall: graded.overall,
          writtenFeedback: graded.feedback,
          expectedPoints: q.expectedPoints || []
        };
      }

      const selectedIndex = (answers[idx] && typeof answers[idx].selectedIndex === 'number')
        ? answers[idx].selectedIndex
        : (typeof answers[idx] === 'number' ? answers[idx] : -1);
      const isCorrect = selectedIndex === q.correctIndex;
      return {
        type: 'mcq',
        questionText: q.questionText,
        options: q.options,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        topic: q.topic || 'General',
        // Carry the figure into the attempt record. The orphan guard only rejects a
        // question that references a figure it does NOT have — a question that HAS one
        // and says "as shown" passes correctly, and would then be reviewed with the
        // figure missing. Copied rather than looked up so the review still renders if
        // the cached quiz is ever regenerated.
        ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {})
      };
    }));

    const score = resultQuestions.filter(r => r.isCorrect).length;
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

    // Phase 7: adaptive remediation. Runs AFTER the attempt is recorded on `day`;
    // may splice in one new day and renumber LATER days (completed days untouched).
    const remediation = await maybeInsertRemediationDay(roadmap, day);

    roadmap.markModified('days');
    await roadmap.save();

    // Phase 8: submitting a module quiz counts as studying today.
    await recordStudyActivity(req.userId, localDate);

    res.json({
      score,
      total,
      passed,
      passThreshold: QUIZ_PASS_THRESHOLD,
      anyVideoWatched,
      dayCompleted,
      attemptCount: prevCount + 1,
      remediationInserted: remediation, // { dayNumber, topic, subtopic } or null
      // Full review (with correct answers + explanations) is fine post-submit.
      questions: quizQuestions.map((q, idx) => {
        const r = resultQuestions[idx];
        if (q.type === 'written') {
          return {
            type: 'written',
            questionText: (isHindi && q.translatedHindiQuestionText) ? q.translatedHindiQuestionText : q.questionText,
            topic: q.topic || 'General',
            writtenStyle: q.writtenStyle,
            writtenAnswer: r.writtenAnswer,
            scores: r.writtenScores,
            overall: r.writtenOverall,
            feedback: r.writtenFeedback,
            expectedPoints: r.expectedPoints,
            isCorrect: r.isCorrect,             // "reached threshold" — the UI frames it as such
            threshold: Math.round(QUIZ_PASS_THRESHOLD * 100)
          };
        }
        const useHi = isHindi && q.hindiTranslated;
        return {
          type: 'mcq',
          questionText: useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText,
          options: (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options,
          selectedIndex: r.selectedIndex,
          correctIndex: q.correctIndex,
          isCorrect: r.isCorrect,
          topic: q.topic || 'General',
          explanation: useHi ? (q.translatedHindiExplanation || q.explanation || '') : (q.explanation || ''),
          // Workstream D — the review must show the same figure the question was answered with.
          ...(q.diagram?.svg ? { diagram: { svg: q.diagram.svg, alt: q.diagram.alt || '', altHindi: q.diagram.altHindi || '' } } : {})
        };
      })
    });
  } catch (error) {
    console.error('Submit module quiz error:', error);
    res.status(500).json({ error: 'Server error submitting module quiz.' });
  }
});

// GET /api/roadmap/:id/day/:dayNumber/quiz/result
// Returns the student's LAST stored module-quiz attempt (score + full per-question
// review) so it's visible on revisit — not just on the one-time post-submit screen.
// Purely surfaces already-persisted moduleQuizAttempt data (what Phase 4 reads).
router.get('/:id/day/:dayNumber/quiz/result', authMiddleware, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const isHindi = req.query.lang === 'hi';

    const roadmap = await Roadmap.findOne({ _id: id, userId: req.userId });
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found.' });

    const day = roadmap.days.find(d => d.dayNumber === parseInt(dayNumber, 10));
    if (!day) return res.status(404).json({ error: 'Day not found in roadmap.' });

    const attempt = day.moduleQuizAttempt;
    if (!attempt || !attempt.attempted) return res.json({ attempted: false });

    // Combine stored attempt (selections/correctness) with the cached quiz
    // (explanations + Hindi text) for a full, localized review.
    if (isHindi) {
      const changed = await ensureQuizHindi(day);
      if (changed) { roadmap.markModified('days'); await roadmap.save(); }
    }
    const quizQs = day.moduleQuiz?.questions || [];
    const questions = (attempt.questions || []).map((aq, idx) => {
      const mq = quizQs[idx];
      if (aq.type === 'written') {
        return {
          type: 'written',
          questionText: (isHindi && mq?.translatedHindiQuestionText) ? mq.translatedHindiQuestionText : (mq?.questionText || aq.questionText),
          topic: aq.topic,
          writtenStyle: aq.writtenStyle,
          writtenAnswer: aq.writtenAnswer,
          scores: aq.writtenScores,
          overall: aq.writtenOverall,
          feedback: aq.writtenFeedback,
          expectedPoints: aq.expectedPoints,
          isCorrect: aq.isCorrect,
          threshold: Math.round((attempt.passThreshold || QUIZ_PASS_THRESHOLD) * 100)
        };
      }
      const useHi = isHindi && mq?.hindiTranslated;
      return {
        type: 'mcq',
        questionText: useHi ? (mq.translatedHindiQuestionText || mq.questionText) : (mq?.questionText || aq.questionText),
        options: (useHi && mq?.translatedHindiOptions?.length === (mq?.options || []).length) ? mq.translatedHindiOptions : (mq?.options || aq.options),
        selectedIndex: aq.selectedIndex,
        correctIndex: aq.correctIndex,
        isCorrect: aq.isCorrect,
        topic: aq.topic,
        explanation: useHi ? (mq?.translatedHindiExplanation || mq?.explanation || '') : (mq?.explanation || '')
      };
    });

    res.json({
      attempted: true,
      score: attempt.score,
      total: attempt.total,
      passed: attempt.passed,
      passThreshold: attempt.passThreshold || QUIZ_PASS_THRESHOLD,
      attemptCount: attempt.attemptCount,
      anyVideoWatched: isAnyVideoWatched(day),
      questions
    });
  } catch (error) {
    console.error('Get quiz result error:', error);
    res.status(500).json({ error: 'Server error loading quiz result.' });
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
    // `useHi` degrades to false if Hindi was requested but ensureQuizHindi couldn't
    // translate it — so voice + labels match the actual text (no English-with-Hindi-voice).
    const useHi = isHindi && q.hindiTranslated;
    const targetLang = useHi ? 'hi-IN' : 'en-IN';
    const fieldName = useHi ? 'audioQuestionHi' : 'audioQuestionEn';
    const stem = useHi ? (q.translatedHindiQuestionText || q.questionText) : q.questionText;
    const options = (useHi && q.translatedHindiOptions?.length === q.options.length) ? q.translatedHindiOptions : q.options;

    const textToSpeak = formatQuestionForTTS(stem, options, useHi ? 'hi' : 'en');

    const textHash = generateContentHash(textToSpeak);
    // Renumbering-proof cache key: content hash only, NOT dayNumber. The audio
    // is defined by its text; when Phase 7 renumbers a day the audio moves with
    // the subdoc and its hash is unchanged, so the cache still hits at the new number.
    const filename = `quiz-${id}-${useHi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (q[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: q[fieldName] });
    }

    const lockKey = `quiz:${id}:${useHi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // fallbackLang IS REQUIRED, NOT OPTIONAL. The client speaks this text with the
      // browser voice, and without a language it defaults to the student PREFERENCE —
      // which is a proxy for "what language is this text in", and wrong exactly when the
      // text could not be translated. That is the A3 defect (English words in a Hindi
      // voice) at its third site. Send the language of the TEXT, always.
      return res.json({ useFallback: true, fallbackText: textToSpeak, fallbackLang: useHi ? 'hi' : 'en' });
    }

    const audioUrl = saveAudioFile(filename, audioBuffer);
    q[fieldName] = audioUrl;
    roadmap.markModified('days');
    await roadmap.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Quiz question audio error:', error.message);
    return res.json({ useFallback: true, fallbackText: 'Quiz question', fallbackLang: 'en' });
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
    // Shared aggregation (utils/weakTopics.js). Parents are read-only: they never
    // trigger the lazy Hindi translate+save — they serve whatever the student's
    // own viewing already cached (pre-translate-on-student-side).
    const result = await computeWeakTopics(roadmap, { isHindi, allowSave: req.role !== 'parent' });
    res.json(result);
  } catch (error) {
    console.error('Weak topics error:', error);
    res.status(500).json({ error: 'Server error computing weak topics.' });
  }
});

// POST /api/roadmap/:id/translate (Translates roadmap day topics & focus to Hindi)
router.post('/:id/translate', authMiddleware, requireRole('student'), async (req, res) => {
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

    // Determine text to speak. `effectiveHindi` degrades to false if Hindi is
    // requested but no Hindi text can be produced (translate failed) — so we never
    // speak English content with a Hindi voice.
    let effectiveHindi = isHindi;
    let textToSpeak = isHindi ? (targetDay.translatedHindiContent || '') : targetDay.content;

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

    textToSpeak = normalizeTextForTTS(textToSpeak, effectiveHindi ? 'hi' : 'en');
    if (isHindi && (!textToSpeak || !textToSpeak.trim())) {
      console.warn(`day audio ${id}/${dayNumber}: no Hindi content (translation failed?) — narrating English instead.`);
      effectiveHindi = false;
      textToSpeak = targetDay.content;
    }

    const targetLang = effectiveHindi ? 'hi-IN' : 'en-IN';
    const fieldName = effectiveHindi ? 'audioContentHi' : 'audioContentEn';

    if (!textToSpeak || textToSpeak.trim().length === 0) {
      return res.status(400).json({ error: 'No content available to synthesize.' });
    }

    const textHash = generateContentHash(textToSpeak);
    // Renumbering-proof cache key: content hash only, NOT dayNumber (see the quiz
    // audio endpoint). Day content moves with the subdoc on a Phase 7 insertion,
    // so the cached audio stays valid at the day's new number.
    const filename = `roadmap-${id}-${effectiveHindi ? 'hi' : 'en'}-${textHash}.wav`;

    // Self-healing disk cache check
    if (targetDay[fieldName] && audioFileExists(filename)) {
      return res.json({ audioUrl: targetDay[fieldName] });
    }

    // Synthesize speech via Sarvam Bulbul API
    const lockKey = `roadmap:${id}:${isHindi ? 'hi' : 'en'}:${textHash}`;
    const audioBuffer = await synthesizeSpeech(textToSpeak, targetLang, lockKey);

    if (!audioBuffer) {
      // fallbackLang IS REQUIRED, NOT OPTIONAL. The client speaks this text with the
      // browser voice, and without a language it defaults to the student PREFERENCE —
      // which is a proxy for "what language is this text in", and wrong exactly when the
      // text could not be translated. That is the A3 defect (English words in a Hindi
      // voice) at its third site. Send the language of the TEXT, always.
      return res.json({ useFallback: true, fallbackText: textToSpeak, fallbackLang: isHindi ? 'hi' : 'en' });
    }

    // Save audio file to disk and update MongoDB pointer
    const audioUrl = saveAudioFile(filename, audioBuffer);
    targetDay[fieldName] = audioUrl;
    await roadmap.save();

    res.json({ audioUrl });
  } catch (error) {
    console.error('Roadmap day audio error:', error.message);
    return res.json({ useFallback: true, fallbackText: 'Lesson content', fallbackLang: 'en' });
  }
});

export default router;
