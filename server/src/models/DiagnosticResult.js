import mongoose from 'mongoose';
import { writtenAttemptFields } from './writtenFields.js';

const questionDetailSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  selectedIndex: { type: Number }, // MCQ-only; enforced at the submit layer
  correctIndex: { type: Number },  // MCQ-only; enforced at the submit layer
  isCorrect: { type: Boolean, default: false },
  topic: { type: String, default: 'General' },
  explanation: { type: String, default: '' },
  audioQuestionEn: { type: String, default: '' },
  audioQuestionHi: { type: String, default: '' },
  // Workstream A: which blueprint chapter the question came from, and its
  // grade-relative difficulty. Additive — pre-existing results have ''.
  chapterId: { type: String, default: '' },
  difficulty: { type: String, default: '' },
  // Workstream D: optional generated figure, sanitised server-side before storage.
  // Workstream D: distinguishes "the model judged no figure needed" (final) from
  // "never actually tried" (a 429 during the cache write) — only the latter retries.
  diagramAttempted: { type: Boolean, default: false },
  diagram: {
    svg: { type: String, default: '' },
    alt: { type: String, default: '' },
    altHindi: { type: String, default: '' }
  },
  ...writtenAttemptFields
}, { _id: false });

const translatedQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  explanation: { type: String, default: '' },
  diagramAlt: { type: String, default: '' }
}, { _id: false });

const diagnosticResultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, required: true },
  subject: { type: String, required: true },
  subSubject: { type: String, default: '' }, // sub-subject split (additive, '' = flat)
  questions: [questionDetailSchema],
  weakTopics: [{ type: String }],
  strongTopics: [{ type: String }],
  recommendation: { type: String, default: '' },
  translatedHindiQuestions: [translatedQuestionSchema],
  translatedHindiRecommendation: { type: String, default: '' },
  score: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  // Workstream A: how much of the syllabus this result is actually grounded in.
  // Reported per run so the breadth of the sample behind a roadmap is visible
  // rather than assumed. Additive — pre-existing results have zeros/empties.
  chapterCoverage: {
    total: { type: Number, default: 0 },
    touched: { type: Number, default: 0 },
    resolved: { type: Number, default: 0 },
    unresolvedChapters: { type: [String], default: [] },
    untouchedChapters: { type: [String], default: [] }
  },
  corrupted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('DiagnosticResult', diagnosticResultSchema);
