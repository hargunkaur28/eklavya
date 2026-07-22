import mongoose from 'mongoose';
import { writtenQuestionFields, writtenAttemptFields } from './writtenFields.js';

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, enum: ['youtube', 'article'], default: 'youtube' },
  channel: { type: String, default: 'Educational Channel' }
}, { _id: false });

// Phase 2 (revised): one tracking record per video on a day, keyed by videoId,
// so every video card tracks independently (not just the primary one).
const videoProgressSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  watchedSeconds: { type: Number, default: 0 },
  durationSeconds: { type: Number, default: 0 },
  watched: { type: Boolean, default: false },
  watchedAt: { type: Date, default: null }
}, { _id: false });

// Phase 3: a cached module-quiz question (correctIndex + explanation are
// server-only and never sent to the client before submission).
const moduleQuizQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  correctIndex: { type: Number }, // MCQ-only; enforced at the generation layer (validators)
  topic: { type: String, default: 'General' },
  explanation: { type: String, default: '' },
  // Localization + TTS cache (mirrors day-content translatedHindi*/audio* fields).
  // Options are translated IN THE SAME ORDER — correctIndex is never touched.
  translatedHindiQuestionText: { type: String, default: '' },
  translatedHindiOptions: { type: [String], default: [] },
  translatedHindiExplanation: { type: String, default: '' },
  hindiTranslated: { type: Boolean, default: false },
  audioQuestionEn: { type: String, default: '' },
  audioQuestionHi: { type: String, default: '' },
  ...writtenQuestionFields
}, { _id: false });

// Phase 3: per-question record of a student's attempt (the wrong-answer detail
// Phase 4 aggregates for weak-topic flagging).
const quizAttemptQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  selectedIndex: { type: Number, default: -1 },
  correctIndex: { type: Number }, // MCQ-only; enforced at the submit layer
  isCorrect: { type: Boolean, default: false },
  topic: { type: String, default: 'General' },
  ...writtenAttemptFields
}, { _id: false });

const daySchema = new mongoose.Schema({
  dayNumber: { type: Number, required: true },
  topic: { type: String, required: true },
  focus: { type: String, required: true },
  resourceLink: { type: String, default: null },
  estimatedMinutes: { type: Number, default: 30 },
  completed: { type: Boolean, default: false },
  content: { type: String, default: '' },
  resources: [resourceSchema],
  contentGenerated: { type: Boolean, default: false },
  // Phase 7: inserted remediation days (adaptive). Grounded in a real weak
  // sub-topic via a live Groq call — never a template. Marks let the UI badge
  // them and prevent inserting a duplicate for the same sub-topic.
  isRemediation: { type: Boolean, default: false },
  remediationForSubtopic: { type: String, default: '' },
  remediationFromDay: { type: Number, default: null },
  translatedHindiTopic: { type: String, default: '' },
  hindiTopicTranslated: { type: Boolean, default: false },
  translatedHindiFocus: { type: String, default: '' },
  hindiFocusTranslated: { type: Boolean, default: false },
  translatedHindiContent: { type: String, default: '' },
  hindiContentTranslated: { type: Boolean, default: false },
  audioContentEn: { type: String, default: '' },
  audioContentHi: { type: String, default: '' },
  // ── Phase 2: per-video watch tracking ──
  // One record per video on the day (up to 3), percentage-based via the YouTube
  // IFrame Player API. A record's `watched` flips true at VIDEO_WATCH_THRESHOLD
  // (90%). The DAY's video requirement uses OR logic: satisfied when ANY record
  // is watched. This is DISTINCT from `completed` (Phase 3 also gates on quiz).
  videoProgress: [videoProgressSchema],

  // DEPRECATED (pre-revision scalar fields). No longer written. Retained only so
  // the lazy, non-destructive migration can seed videoProgress from old data for
  // students who tracked a primary video before per-video tracking existed.
  trackedVideoId: { type: String, default: '' },
  videoWatchedSeconds: { type: Number, default: 0 },
  videoDurationSeconds: { type: Number, default: 0 },
  videoWatched: { type: Boolean, default: false },
  videoWatchedAt: { type: Date, default: null },

  // Phase 4: canonical per-day sub-topic list (~3-5). Quiz questions are pinned
  // to these labels, so weak-topic aggregation is exact within a day (no casing/
  // synonym drift) and Phase 7 gets a precise (day, subtopic) remediation target.
  subtopics: { type: [String], default: [] },
  // Hindi versions of subtopics, same order (translated lazily on Hindi read).
  subtopicsHindi: { type: [String], default: [] },

  // ── Phase 3: module quiz ──
  // Generated ONCE per (student, day) from THIS day's topic+content via Groq,
  // then cached here so revisits get the same quiz (not a fresh random one).
  // Never shared across students, even for an identical topic title.
  moduleQuiz: {
    generated: { type: Boolean, default: false },
    generatedAt: { type: Date, default: null },
    questions: { type: [moduleQuizQuestionSchema], default: [] }
  },
  // The student's latest attempt. `passed` (>= passThreshold) is combined with
  // "any video watched" (Phase 2) to gate `completed`. Retakes overwrite this.
  moduleQuizAttempt: {
    attempted: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    passThreshold: { type: Number, default: 0.7 },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    questions: { type: [quizAttemptQuestionSchema], default: [] }
  }
}, { _id: false });

const translatedDaySchema = new mongoose.Schema({
  dayNumber: { type: Number, required: true },
  topic: { type: String, required: true },
  focus: { type: String, required: true }
}, { _id: false });

const roadmapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  diagnosticResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiagnosticResult', default: null },
  grade: { type: String, required: true },
  subject: { type: String, required: true },
  totalDays: { type: Number, required: true },
  days: [daySchema],
  translatedHindiDays: [translatedDaySchema],
  language: { type: String, enum: ['en', 'hi'], default: 'en' },
  // Minimal safety flag (pre-Phase 5): regenerating a roadmap archives the old
  // one instead of deleting it, so a student's prior progress is never lost.
  // Existing docs created before this field are treated as active ({ $ne: true }).
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Roadmap', roadmapSchema);
