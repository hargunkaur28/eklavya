import mongoose from 'mongoose';

// Track 1 (Mentor): a persistent long-form AI-tutor thread. Messages are EMBEDDED
// (not a separate collection) — the only read pattern is "load the whole thread",
// ownership is a single-document check, and it matches the codebase's existing
// convention of embedding subdocuments (Roadmap.days[], moduleQuiz, etc.).
// Paragraph-length messages keep a thread far under Mongo's 16MB doc limit.
const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Set after the first exchange (auto-summarized, with a truncated-message fallback).
  title: { type: String, default: '' },
  messages: { type: [messageSchema], default: [] }
}, { timestamps: true }); // updatedAt auto-bumps on every new message → drives the "most recent first" list

export default mongoose.model('Conversation', conversationSchema);
