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
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('AdminConfig', adminConfigSchema);
