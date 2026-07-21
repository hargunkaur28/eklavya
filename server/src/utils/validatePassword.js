// Phase 4: single source of truth for password strength. Used by every server
// flow that sets a password (signup, change-password). The parent temp-password
// generator (generateTempPassword.js) is built to satisfy these same rules by
// construction (3 Title-cased words + symbol + 4 digits).
//
// Policy: at least 8 characters, an uppercase letter, a number, and a symbol.
const RULES = [
  { test: (pw) => pw.length >= 8, label: 'at least 8 characters' },
  { test: (pw) => /[A-Z]/.test(pw), label: 'an uppercase letter' },
  { test: (pw) => /[0-9]/.test(pw), label: 'a number' },
  { test: (pw) => /[^A-Za-z0-9\s]/.test(pw), label: 'a symbol' }
];

// Returns { valid, errors: string[] }. `errors` lists the unmet requirements.
export function validatePassword(password) {
  if (typeof password !== 'string') {
    return { valid: false, errors: RULES.map((r) => r.label) };
  }
  const errors = RULES.filter((r) => !r.test(password)).map((r) => r.label);
  return { valid: errors.length === 0, errors };
}

// Human-readable message for a failed validation, e.g.
// "Password must contain an uppercase letter, a number."
export function passwordErrorMessage(errors) {
  return `Password must contain ${errors.join(', ')}.`;
}
