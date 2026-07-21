import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Phase 8: account-wide study streak. Each entry is a 'YYYY-MM-DD' in the
  // student's LOCAL date (sent by the client) — a day counts as "active" when the
  // student watches a video to threshold, submits a module quiz, or does a
  // practice session. Streaks are computed client-side from these local dates.
  studyDates: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('User', userSchema);
