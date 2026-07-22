// Track 4.1: the AUTHORITATIVE subject + grade taxonomy for the server.
// Before this, the canonical lists lived only in the client (Onboarding.jsx) and
// were re-declared, unsynced, in several places. This is the single server-side
// source of truth. Values are the EXACT current set — 4.1 is cleanup only, it does
// NOT add/remove subjects or change the conceptual model (that is Phase 4.2).
//
// NOTE: the repo is not a monorepo, so the client keeps its own mirror at
// client/src/data/taxonomy.js. The two MUST stay identical — a drift test guards it.

export const SUBJECTS = [
  'Science', 'Maths', 'Physics', 'Chemistry', 'Biology',
  'JEE', 'NEET', 'English', 'Hindi', 'Social Science'
];

export const GRADES = [
  'Nursery', 'KG', 'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
  'Class 11', 'Class 12'
];

// Shared normalizers — collapse casing/whitespace so ad-hoc `.toLowerCase()`
// concatenation and scattered comparisons resolve one consistent way. Mirrors the
// shape of normalizeTopic (weakTopics.js) but for subject/grade.
export function normalizeSubject(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function normalizeGrade(g) {
  return (g || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Whether two subject strings refer to the same subject (normalized, non-empty).
export function subjectMatches(a, b) {
  const na = normalizeSubject(a);
  return !!na && na === normalizeSubject(b);
}

// Central home for the one subject-branching predicate that already existed
// (writtenStyleFor's /english/i test) — same semantics, one place.
export function isEnglish(subject) {
  return /english/i.test(subject || '');
}

export function isKnownSubject(s) {
  const n = normalizeSubject(s);
  return SUBJECTS.some((x) => normalizeSubject(x) === n);
}

export function isKnownGrade(g) {
  const n = normalizeGrade(g);
  return GRADES.some((x) => normalizeGrade(x) === n);
}
