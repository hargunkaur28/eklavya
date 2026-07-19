import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, enum: ['youtube', 'article'], default: 'youtube' },
  channel: { type: String, default: 'Educational Channel' }
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
  translatedHindiTopic: { type: String, default: '' },
  hindiTopicTranslated: { type: Boolean, default: false },
  translatedHindiFocus: { type: String, default: '' },
  hindiFocusTranslated: { type: Boolean, default: false },
  translatedHindiContent: { type: String, default: '' },
  hindiContentTranslated: { type: Boolean, default: false },
  audioContentEn: { type: String, default: '' },
  audioContentHi: { type: String, default: '' }
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
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Roadmap', roadmapSchema);
