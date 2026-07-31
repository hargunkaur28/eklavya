import mongoose from 'mongoose';
import { writtenQuestionFields } from './writtenFields.js';

// Phase 6: a practice-mode quiz session. Mirrors DiagnosticSession — holds the
// generated questions (with answers) between /generate and /submit, with a 24h
// TTL so ephemeral practice sessions self-clean. Deliberately its OWN model,
// fully separate from Roadmap: practice never touches roadmap progress or the
// weak-topic aggregation Phase 7 consumes.
const practiceQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String }],
  correctIndex: { type: Number }, // MCQ-only; enforced at the generation layer (validators)
  topic: { type: String, default: 'General' },
  explanation: { type: String, default: '' },
  // Cached Hindi (options translated in the same order — correctIndex untouched)
  translatedHindiQuestionText: { type: String, default: '' },
  translatedHindiOptions: { type: [String], default: [] },
  translatedHindiExplanation: { type: String, default: '' },
  hindiTranslated: { type: Boolean, default: false },
  // Workstream G: which register this cached Hindi was produced under. Absent on
  // every pre-existing translation, which is the point — absent reads as stale and
  // earns one retranslation. Without it the register fix applies to new content only
  // and looks intermittent to a student who sees friendly Hindi in one place and
  // formal Hindi in another.
  hindiRegisterVersion: { type: Number },
  // Workstream D: optional generated figure, sanitised server-side before storage.
  // Additive — pre-existing sessions read back with no diagram. Must be a declared
  // schema path or Mongoose discards the figure silently on save. No
  // `diagramAttempted` here: practice regenerates from scratch every session, so
  // there is no cached question for a retry to ever apply to.
  diagram: {
    svg: { type: String, default: '' },
    alt: { type: String, default: '' },
    altHindi: { type: String, default: '' }
  },
  ...writtenQuestionFields
}, { _id: false });

const practiceSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, default: '' },
  subject: { type: String, required: true },
  subSubject: { type: String, default: '' }, // sub-subject split (additive, '' = flat)
  topic: { type: String, required: true },
  questions: [practiceQuestionSchema],
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24-hour TTL
});

export default mongoose.model('PracticeSession', practiceSessionSchema);
