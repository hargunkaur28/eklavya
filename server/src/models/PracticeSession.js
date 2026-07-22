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
  ...writtenQuestionFields
}, { _id: false });

const practiceSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, default: '' },
  subject: { type: String, required: true },
  topic: { type: String, required: true },
  questions: [practiceQuestionSchema],
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24-hour TTL
});

export default mongoose.model('PracticeSession', practiceSessionSchema);
