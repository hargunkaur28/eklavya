// Track 4.1: the single client-side source of truth for the subject + grade
// taxonomy (previously the hardcoded SUBJECTLIST/GRADELIST inside Onboarding.jsx).
// The DATA (SUBJECTS, GRADES, SUB_SUBJECTS, FUSION_SUBSUBJECT) MUST stay byte-
// identical to server/src/config/taxonomy.js — a drift test guards this.

export const SUBJECTS = [
  'Science', 'Maths', 'Physics', 'Chemistry', 'Biology',
  'JEE', 'NEET', 'English', 'Hindi', 'Social Science'
];

export const GRADES = [
  'Nursery', 'KG', 'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
  'Class 11', 'Class 12'
];

// ── Sub-subjects (subject-splitting) ────────────────────────────────────────
// Three subjects split into selectable sub-subjects; the LAST entry of each is
// the "spans all sub-tracks" option (English → Fusion; Science / Social Science
// → Combined). Every other subject stays flat. Mirror of the server.
export const SUB_SUBJECTS = {
  English: ['Writing', 'Grammar', 'Reading', 'Fusion'],
  Science: ['Physics', 'Chemistry', 'Biology', 'Combined'],
  'Social Science': ['Economics', 'Civics', 'Geography', 'History', 'Combined']
};

export const FUSION_SUBSUBJECT = {
  English: 'Fusion',
  Science: 'Combined',
  'Social Science': 'Combined'
};

const normalizeSubject = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
export const normalizeSubSubject = (ss) => (ss || '').toLowerCase().trim().replace(/\s+/g, ' ');

export function canonicalSubject(subject) {
  const n = normalizeSubject(subject);
  return SUBJECTS.find((s) => normalizeSubject(s) === n) || subject;
}

export function hasSubSubjects(subject) {
  return Object.prototype.hasOwnProperty.call(SUB_SUBJECTS, canonicalSubject(subject));
}

export function subSubjectsFor(subject) {
  return SUB_SUBJECTS[canonicalSubject(subject)] || [];
}

export function fusionSubSubjectFor(subject) {
  return FUSION_SUBSUBJECT[canonicalSubject(subject)] || '';
}

export function isFusionSubSubject(subject, ss) {
  const f = fusionSubSubjectFor(subject);
  return !!f && normalizeSubSubject(ss) === normalizeSubSubject(f);
}

// ── Diagram eligibility at the SUBJECT level (mirror of the server) ─────────
// Practice mode gates figures on the SUBJECT, not on a fuzzy match of the freeform
// topic — see the server file for why. MUST stay identical to
// server/src/config/taxonomy.js.
export const DIAGRAM_ELIGIBLE_SUBJECTS = {
  Science: true,
  Physics: true,
  Chemistry: true,
  Biology: true,
  Maths: true,
  JEE: true,
  NEET: true,
  English: false,
  Hindi: false,
  'Social Science': false
};

export function subjectDiagramEligible(subject) {
  return DIAGRAM_ELIGIBLE_SUBJECTS[canonicalSubject(subject)] === true;
}
