import mongoose from 'mongoose';

const sessionQuestionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctIndex: { type: Number, required: true },
  topic: { type: String, default: 'General' }
}, { _id: false });

const diagnosticSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  grade: { type: String, required: true },
  subject: { type: String, required: true },
  questions: [sessionQuestionSchema],
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24-hour TTL
});

export default mongoose.model('DiagnosticSession', diagnosticSessionSchema);
