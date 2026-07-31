// Workstream B2.1 — Verhoeff checksum, the algorithm UIDAI uses for Aadhaar.
//
// Purpose here is data quality, not identity verification: 12 digits that fail the
// checksum are a typo or junk, and rejecting them client- AND server-side keeps
// unverifiable numbers out of the database in the first place. Passing the checksum
// does NOT mean the number belongs to this student — nothing in this codebase
// claims otherwise, and there is deliberately no verification API call.
//
// Standard Verhoeff tables (dihedral group D5).

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Strip spaces/hyphens so "1234 5678 9012" and "1234-5678-9012" both validate. */
export function normalizeAadhaar(input) {
  return String(input ?? '').replace(/[\s-]/g, '');
}

/** Verhoeff checksum validity of a digit string (any length). */
export function verhoeffValid(digits) {
  const s = String(digits ?? '');
  if (!/^\d+$/.test(s)) return false;
  let c = 0;
  const reversed = s.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][reversed[i]]];
  }
  return c === 0;
}

/**
 * Is this a structurally plausible Aadhaar number?
 *   - exactly 12 digits after stripping separators
 *   - does not start with 0 or 1 (UIDAI never issues those)
 *   - passes the Verhoeff checksum
 * Never logs or echoes the input.
 */
export function isValidAadhaar(input) {
  const n = normalizeAadhaar(input);
  if (!/^\d{12}$/.test(n)) return false;
  if (n[0] === '0' || n[0] === '1') return false;
  return verhoeffValid(n);
}

/** The only representation any client is ever allowed to see. */
export function maskAadhaar(last4) {
  const l = String(last4 ?? '').replace(/\D/g, '').slice(-4);
  return l.length === 4 ? `XXXX XXXX ${l}` : '';
}

/** Compute the Verhoeff check digit for an 11-digit base (test fixtures only). */
export function verhoeffCheckDigit(base) {
  const s = String(base ?? '');
  if (!/^\d+$/.test(s)) throw new Error('digits only');
  let c = 0;
  const reversed = s.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[(i + 1) % 8][reversed[i]]];
  }
  return INV[c];
}
