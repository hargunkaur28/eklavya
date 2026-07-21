import AdminConfig from '../models/AdminConfig.js';

// Phase 7: the effective admin credentials — the DB override if it exists,
// otherwise the env bootstrap. Used by admin login, /me, and the credential
// editor so there is ONE source of truth.
export async function getAdminCreds() {
  try {
    const cfg = await AdminConfig.findOne({ singleton: 'admin' });
    if (cfg) {
      return { email: cfg.email || '', password: cfg.password || '', securityCode: cfg.securityCode || '' };
    }
  } catch {
    // fall through to env on any DB hiccup
  }
  return {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
    securityCode: process.env.ADMIN_SECURITY_CODE || ''
  };
}

// Upsert the admin-config override with only the provided fields.
export async function setAdminCreds(update) {
  const fields = { updatedAt: new Date() };
  if (update.email !== undefined) fields.email = update.email;
  if (update.password !== undefined) fields.password = update.password;
  if (update.securityCode !== undefined) fields.securityCode = update.securityCode;

  // Ensure any fields NOT being changed are carried over from the current
  // effective creds, so a partial edit doesn't blank the others on first insert.
  const current = await getAdminCreds();
  const doc = {
    singleton: 'admin',
    email: fields.email !== undefined ? fields.email : current.email,
    password: fields.password !== undefined ? fields.password : current.password,
    securityCode: fields.securityCode !== undefined ? fields.securityCode : current.securityCode,
    updatedAt: fields.updatedAt
  };
  await AdminConfig.findOneAndUpdate({ singleton: 'admin' }, { $set: doc }, { upsert: true, new: true });
}
