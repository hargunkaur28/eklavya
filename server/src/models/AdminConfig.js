import mongoose from 'mongoose';

// Phase 7: runtime-editable admin credentials. The admin panel is bootstrapped
// from env vars (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_SECURITY_CODE), but once the
// admin edits any of them from the UI we persist the overrides here so the change
// survives restarts and works on Render (where env vars aren't app-editable).
// A single document (singleton) holds the current values; if it doesn't exist the
// env vars are used. Values are stored as configured (plaintext, per the chosen
// setup) — a DB compromise therefore exposes them, same risk class as the env.
const adminConfigSchema = new mongoose.Schema({
  singleton: { type: String, default: 'admin', unique: true },
  email: { type: String },
  password: { type: String },
  securityCode: { type: String },
  role: { type: String, default: 'Super Admin' },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },

  // ── Feature 27: the Voice Mentor's grade ceiling ────────────────────────
  //
  // The mentor is for children who cannot yet read the UI, which today means roughly
  // nursery through Class 5. That is a SETTING, not a constant, because "which children
  // cannot read the interface" is a question about a deployment's actual students and
  // not something this repo can answer once for every state that installs it.
  //
  // `null` means "no override" and falls through to MENTOR_MAX_GRADE in the env, then
  // to the built-in default — the same precedence the admin credentials above use, and
  // for the same reason: env vars are not app-editable on Render, so an operator with
  // no deploy access could otherwise never change it.
  //
  // Changing this takes effect for NEW SESSIONS without a redeploy. It deliberately
  // does not reach back into a session already running: a mentor that goes silent
  // mid-sentence because an admin saved a form is indistinguishable, to a child, from
  // a mentor that broke.
  mentorMaxGrade: { type: String, default: null },

  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('AdminConfig', adminConfigSchema);
