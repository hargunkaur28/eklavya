// Workstream B4 — server-side validation for the student profile.
//
// Never trust the client: every field is re-validated here regardless of what the
// onboarding UI already checked.
//
// THE CRITICAL RULE IN THIS FILE: no validation error ever contains the value that
// failed. "Invalid Aadhaar: 234567890124" would defeat the entire encryption design
// in a single string — it lands in the response body, in the client console, in any
// log that records responses, and in any error tracker.
//
// Errors are returned as CODES, not prose, for two reasons. First, a code cannot
// accidentally interpolate the offending value. Second, field validation errors are
// the highest-frequency text in the whole onboarding flow, and English-only prose
// here would mean a Hindi-mode student sees Devanagari labels and an English error
// the moment they mistype — the wrong failure for a Haryana/Punjab deployment. The
// client maps these codes through translations.js, so they localise like everything
// else. Codes are also stable: rewording the message never breaks a client.

import { isValidAadhaar, normalizeAadhaar } from './verhoeff.js';

// Boards are config, not free text in a route handler. 'Other' unlocks a free-text
// value, which is validated as a plain string rather than against this list.
export const STUDY_MEDIUMS = [
  'CBSE',
  'ICSE',
  'Haryana Board (HBSE)',
  'Punjab Board (PSEB)',
  'UP Board',
  'Maharashtra (MSBSHSE)',
  'Bihar (BSEB)',
  'Rajasthan (RBSE)',
  'Other'
];

const AGE_MIN = 5;
const AGE_MAX = 25;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Letters (incl. Devanagari), spaces and dots only — no digits or punctuation.
const NAME_RE = /^[A-Za-zऀ-ॿ .]+$/;

/**
 * Validate the COMPULSORY fields. Returns { ok, errors } where errors is keyed by
 * field name so the client can highlight the offending step.
 */
export function validateCompulsory(body) {
  const errors = {};

  const age = Number(body.age);
  if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) {
    errors.age = 'AGE_OUT_OF_RANGE';
  }

  const medium = str(body.studyMedium);
  if (!medium) {
    errors.studyMedium = 'BOARD_REQUIRED';
  } else if (!STUDY_MEDIUMS.includes(medium) && medium.length > 60) {
    // 'Other' free text is allowed but bounded.
    errors.studyMedium = 'BOARD_TOO_LONG';
  }

  const father = str(body.fatherName);
  if (father.length < 2 || father.length > 60) {
    errors.fatherName = 'FATHER_NAME_LENGTH';
  } else if (!NAME_RE.test(father)) {
    errors.fatherName = 'FATHER_NAME_CHARS';
  }

  const school = str(body.schoolName);
  if (school.length < 2 || school.length > 120) {
    errors.schoolName = 'SCHOOL_NAME_LENGTH';
  }

  const city = str(body.schoolCity);
  if (city.length < 2 || city.length > 80) {
    errors.schoolCity = 'SCHOOL_CITY_LENGTH';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Indian mobile number: 10 digits starting 6-9, with +91 / 0 / spaces / hyphens
 * stripped before storage. Returns { ok, value, error } — value is '' when the
 * field was skipped, which is always allowed.
 */
export function validatePhone(raw) {
  const input = str(raw);
  if (!input) return { ok: true, value: '' };

  const digits = input.replace(/[\s-()]/g, '').replace(/^\+?91/, '').replace(/^0+/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return { ok: false, value: '', error: 'PHONE_FORMAT_INVALID' };
  }
  return { ok: true, value: digits };
}

/** Optional location text fields, each bounded. Coordinates are never accepted. */
export function validateLocation(raw) {
  const loc = raw && typeof raw === 'object' ? raw : {};
  const out = {
    village: str(loc.village).slice(0, 80),
    city: str(loc.city).slice(0, 80),
    state: str(loc.state).slice(0, 80)
  };
  return { ok: true, value: out };
}

/**
 * Validate Aadhaar WITHOUT ever returning or logging the value.
 *
 * Returns { ok, provided, digits, error }. `digits` is the caller's ONLY handle on
 * the plaintext and is expected to be encrypted immediately and then dropped — see
 * the route, which never puts it on a document.
 */
export function validateAadhaar(raw, consentGiven, collectionEnabled) {
  const input = str(raw);
  // ABSENT means UNCHANGED, never "delete". Removal is an explicit, separate action
  // (DELETE /api/auth/profile/aadhaar) so that editing an unrelated field can never
  // erase a stored number as a side effect.
  if (!input) return { ok: true, provided: false, digits: '' };

  // The MASK must never round-trip. Settings displays "XXXX XXXX 0124"; if that
  // string ever reaches the input's value, a naive submit posts the mask back as the
  // new number. The real fix is client-side — Replace opens an EMPTY field, and the
  // mask is display text, never a form value — but a masked submission is caught
  // here with its own code so the client bug is diagnosable instead of surfacing as
  // a baffling checksum failure to a student.
  if (/[Xx]/.test(input)) {
    return { ok: false, provided: true, digits: '', error: 'AADHAAR_MASKED_VALUE_SUBMITTED' };
  }

  if (!collectionEnabled) {
    // The client hides the field entirely in this case; a submission reaching here
    // means a hand-crafted request, so it is refused rather than silently dropped.
    return { ok: false, provided: true, digits: '', error: 'AADHAAR_NOT_ENABLED' };
  }

  // DPDP Act: consent is a precondition, checked before the number is even examined.
  if (consentGiven !== true) {
    return { ok: false, provided: true, digits: '', error: 'AADHAAR_CONSENT_REQUIRED' };
  }

  const digits = normalizeAadhaar(input);
  if (!isValidAadhaar(digits)) {
    // Note what is NOT here: the value. Only the rule that was broken.
    return { ok: false, provided: true, digits: '', error: 'AADHAAR_CHECKSUM_INVALID' };
  }

  return { ok: true, provided: true, digits };
}
