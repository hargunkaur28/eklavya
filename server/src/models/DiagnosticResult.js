import mongoose from 'mongoose';

const questionDetailSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  selectedIndex: { type: Number, required: true },
  correctIndex: { type: Number, required: true },
  isCorrect: { type: Boolean, required: true },
  topic: { type: String, default: 'General' },
  explanation: { type: String, default: '' },
  audioQuestionEn: { type: String, default: '' },
  audioQuestionHi: { type: String, default: '' }
}, { _id: false });

const translatedQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  explanation: { type: String, default: '' }
}, { _id: false });

const diagnosticResultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, required: true },
  subject: { type: String, required: true },
  questions: [questionDetailSchema],
  weakTopics: [{ type: String }],
  strongTopics: [{ type: String }],
  recommendation: { type: String, default: '' },
  translatedHindiQuestions: [translatedQuestionSchema],
  translatedHindiRecommendation: { type: String, default: '' },
  score: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  corrupted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('DiagnosticResult', diagnosticResultSchema);
