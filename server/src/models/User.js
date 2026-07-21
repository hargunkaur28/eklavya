import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Phase 2: a document's inherent role. Every real signup is a student; the
  // 'parent' role is a SESSION role resolved at login (Option B, Phase 3) and is
  // not stored here. Default keeps all pre-Phase-2 users as students.
  role: { type: String, enum: ['student', 'parent', 'admin'], default: 'student' },
  // Phase 3 (Option B): the parent logs in with the SAME email as the student.
  // A bcrypt hash of the parent's password lives on the student's own document;
  // its PRESENCE is the "this student has a linked parent" signal (no parentOf).
  // Plaintext is NEVER stored — shown once at creation, then only the hash remains.
  parentPasswordHash: { type: String, default: null },
  // Forces the PARENT to set their own password on first login. Named for the
  // parent specifically so it can never gate the student's own password.
  parentMustChangePassword: { type: Boolean, default: false },
  // Phase 7.5: Cloudinary secure_url of the student's profile photo (null = show
  // the generic icon). Only the URL is stored — never raw image bytes. The asset
  // uses a deterministic public_id keyed to this user so re-upload overwrites in
  // place (no orphaned images accumulate).
  photoUrl: { type: String, default: null },
  // Phase 8: account-wide study streak. Each entry is a 'YYYY-MM-DD' in the
  // student's LOCAL date (sent by the client) — a day counts as "active" when the
  // student watches a video to threshold, submits a module quiz, or does a
  // practice session. Streaks are computed client-side from these local dates.
  studyDates: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('User', userSchema);
