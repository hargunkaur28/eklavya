// Workstream B2.2 — AES-256-GCM encryption for Aadhaar at rest.
//
// This project is intended for state-government use, which RAISES the compliance
// bar under India's DPDP Act, 2023. The rules this file exists to enforce:
//
//   1. The plaintext number NEVER reaches the database — not in a temporary field,
//      not in a pre-save hook, not "just until the next tick". `encryptAadhaar`
//      returns a sealed envelope and the caller stores only that.
//   2. There is NO decrypt function exported. Nothing in this task needs to read a
//      number back, so the capability is simply absent — a decrypt endpoint that
//      exists is a decrypt endpoint that can be called.
//   3. The plaintext is never logged. No console output in this module includes it,
//      and errors are raised with fixed strings.
//   4. The server refuses to boot if Aadhaar collection is enabled without a key
//      (see assertAadhaarKeyOrExit, called from server.js).
//
// GCM is chosen over CBC because it is authenticated: a tampered ciphertext fails
// loudly on decrypt rather than yielding garbage plaintext.

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit nonce, the GCM-recommended size
const KEY_BYTES = 32;  // AES-256

/**
 * Is Aadhaar collection switched on for this deployment?
 * Off by default: a deployment that does not want to hold Aadhaar at all should not
 * have to configure a key, and the field is then simply never accepted.
 */
export function aadhaarCollectionEnabled() {
  return String(process.env.AADHAAR_COLLECTION_ENABLED || '').toLowerCase() === 'true';
}

/** Parse and validate the configured key. Returns null when unusable. */
function loadKey() {
  const raw = process.env.AADHAAR_ENCRYPTION_KEY;
  if (!raw) return null;
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  return buf.length === KEY_BYTES ? buf : null;
}

export function aadhaarKeyConfigured() {
  return loadKey() !== null;
}

/**
 * Boot guard. Called from server.js: if Aadhaar collection is enabled, a valid
 * 32-byte base64 key MUST be present, otherwise the process exits rather than
 * starting up in a state where it would accept Aadhaar numbers it cannot protect.
 */
export function assertAadhaarKeyOrExit() {
  if (!aadhaarCollectionEnabled()) {
    console.log('Aadhaar collection: DISABLED (set AADHAAR_COLLECTION_ENABLED=true to enable)');
    return;
  }
  if (!aadhaarKeyConfigured()) {
    console.error(
      'FATAL: AADHAAR_COLLECTION_ENABLED=true but AADHAAR_ENCRYPTION_KEY is missing or invalid.\n' +
      '       Expected a base64-encoded 32-byte key. Generate one with:\n' +
      '         node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
      '       Refusing to start: the server would otherwise accept Aadhaar numbers it cannot encrypt.'
    );
    process.exit(1);
  }
  console.log('Aadhaar collection: ENABLED (AES-256-GCM key loaded)');
}

/**
 * Encrypt an Aadhaar number for storage.
 *
 * Returns `{ ciphertext, iv, authTag }` (all base64) — the ONLY thing a caller may
 * persist. Throws on a missing key rather than returning the input in any form.
 * The plaintext is not retained, echoed, or logged anywhere in this function.
 */
export function encryptAadhaar(plaintextDigits) {
  const key = loadKey();
  if (!key) throw new Error('AADHAAR_ENCRYPTION_KEY is not configured');

  const value = String(plaintextDigits ?? '');
  if (!/^\d{12}$/.test(value)) throw new Error('Aadhaar must be 12 digits before encryption');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

/** The last four digits, kept in plaintext solely so a masked value can be shown. */
export function lastFourOf(plaintextDigits) {
  return String(plaintextDigits ?? '').slice(-4);
}

// NOTE: there is intentionally no decryptAadhaar export. If a future feature
// genuinely needs one (e.g. a government-mandated verification integration), it
// belongs behind its own audited endpoint with its own authorisation, rate limit
// and access log — not as a general-purpose helper importable from anywhere.
