import mongoose from 'mongoose';
import { writtenQuestionFields } from './writtenFields.js';

// Workstream A3: a diagnostic session is now MULTI-ROUND and stateful. It used to
// be a write-once bag of 6 questions; it now accumulates questions round by round,
// records how each was answered, and carries the per-chapter confidence the
// adaptive algorithm reads. Every field below is ADDITIVE — a session document
// written before this change still loads and still submits (it simply has empty
// blueprint/stat fields and completes in one round).

const sessionQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  correctIndex: { type: Number }, // MCQ-only; enforced at the generation layer (validators)
  topic: { type: String, default: 'General' },
  ...writtenQuestionFields,

  // Adaptive metadata (A3). `chapterId` pins the question to a blueprint chapter;
  // `difficulty` is relative to the grade, not absolute.
  chapterId: { type: String, default: '' },
  difficulty: { type: String, default: '' },

  // Answer capture — filled when the round containing this question is submitted.
  // `wasCorrect` stays null until then, which is how the engine tells graded
  // questions apart from ones still on the student's screen.
  wasCorrect: { type: Boolean, default: null },
  selectedIndex: { type: Number, default: null },
  writtenAnswer: { type: String, default: '' },
  writtenScores: {
    content: { type: Number, default: 0 },
    grammar: { type: Number, default: 0 },
    spelling: { type: Number, default: 0 }
  },
  writtenOverall: { type: Number, default: 0 },
  writtenFeedback: {
    content: { type: String, default: '' },
    grammar: { type: String, default: '' },
    spelling: { type: String, default: '' }
  },

  // Workstream D: optional generated figure (sanitised server-side before storage).
  // Workstream D: distinguishes "the model judged no figure needed" (final) from
  // "never actually tried" (a 429 during the cache write) — only the latter retries.
  diagramAttempted: { type: Boolean, default: false },
  diagram: {
    svg: { type: String, default: '' },
    alt: { type: String, default: '' },
    altHindi: { type: String, default: '' }
  }
}, { _id: false });

// The working chapter set for this session — a snapshot of the syllabus blueprint
// (or of the generated one), so a session stays reproducible even if the blueprint
// file changes mid-flight.
const sessionChapterSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  concepts: [{ type: String }],
  diagramEligible: { type: Boolean, default: false }
  // `id: false` as well as `_id: false`: `id` is a real blueprint field here, and
  // Mongoose's default `id` virtual (derived from _id) would shadow it.
}, { _id: false, id: false });

const translatedQuestionSchema = new mongoose.Schema({
  questionText: { type: String, default: '' },
  options: [{ type: String }],
  diagramAlt: { type: String, default: '' }
}, { _id: false });

const diagnosticSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, required: true },
  subject: { type: String, required: true },
  subSubject: { type: String, default: '' }, // sub-subject split (additive, '' = flat)

  // Every question served so far, in order. Aliased as `askedQuestions` because
  // that is what the adaptive algorithm calls it — same path, one source of truth.
  questions: { type: [sessionQuestionSchema], alias: 'askedQuestions' },

  // ── Adaptive state (A3) ──────────────────────────────────────────────────
  blueprintChapters: { type: [sessionChapterSchema], default: [] },
  difficultyAnchor: { type: String, default: '' },
  exemplars: {
    tooEasy: { type: String, default: '' },
    correct: { type: String, default: '' },
    tooHard: { type: String, default: '' }
  },
  // chapterId -> { asked, correct, lastDifficulty, lastCorrect }. Mixed because the
  // keys are chapter ids, not a fixed schema.
  chapterStats: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  roundNumber: { type: Number, default: 0 },
  // How many of `questions` have been graded. Everything past this index is the
  // round currently on the student's screen.
  gradedCount: { type: Number, default: 0 },
  isComplete: { type: Boolean, default: false },

  // Question budget for THIS session (MCQ only — written questions are served on
  // top and the budget is reduced to keep the total inside MIN/MAX).
  mcqMin: { type: Number, default: 8 },
  mcqMax: { type: Number, default: 20 },
  includeWritten: { type: Boolean, default: false },
  writtenServed: { type: Boolean, default: false },

  // Cached Hindi text for the questions served so far, index-aligned with
  // `questions` (mid-quiz language switches read this instead of regenerating).
  translatedHindiQuestions: { type: [translatedQuestionSchema], default: [] },

  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24-hour TTL
});

export default mongoose.model('DiagnosticSession', diagnosticSessionSchema);