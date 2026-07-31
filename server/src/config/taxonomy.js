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

// ── Sub-subjects (Track: subject-splitting) ─────────────────────────────────
// Three subjects split into selectable sub-subjects; the LAST entry of each is
// the "spans all sub-tracks" option (English → Fusion; Science / Social Science
// → Combined). Every OTHER subject stays flat (no sub-subjects). Keyed by the
// canonical subject spelling. This EXTENDS the single source — it is not a fork.
export const SUB_SUBJECTS = {
  English: ['Writing', 'Grammar', 'Reading', 'Fusion'],
  Science: ['Physics', 'Chemistry', 'Biology', 'Combined'],
  'Social Science': ['Economics', 'Civics', 'Geography', 'History', 'Combined']
};

// The "spans all sub-tracks" sub-subject for each split subject.
export const FUSION_SUBSUBJECT = {
  English: 'Fusion',
  Science: 'Combined',
  'Social Science': 'Combined'
};

// Map an any-cased subject to its canonical spelling so SUB_SUBJECTS lookups are
// casing-robust. Returns the input unchanged if not a known subject.
export function canonicalSubject(subject) {
  const n = normalizeSubject(subject);
  return SUBJECTS.find((s) => normalizeSubject(s) === n) || subject;
}

export function normalizeSubSubject(ss) {
  return (ss || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Does this subject split into sub-subjects (English / Science / Social Science)?
export function hasSubSubjects(subject) {
  return Object.prototype.hasOwnProperty.call(SUB_SUBJECTS, canonicalSubject(subject));
}

// Ordered sub-subject list for a subject (empty array for flat subjects).
export function subSubjectsFor(subject) {
  return SUB_SUBJECTS[canonicalSubject(subject)] || [];
}

// Is `ss` a valid sub-subject of `subject`?
export function isKnownSubSubject(subject, ss) {
  const n = normalizeSubSubject(ss);
  return subSubjectsFor(subject).some((x) => normalizeSubSubject(x) === n);
}

// The Fusion/Combined "spans all" sub-subject for a split subject ('' if flat).
export function fusionSubSubjectFor(subject) {
  return FUSION_SUBSUBJECT[canonicalSubject(subject)] || '';
}

// Is (subject, ss) the Fusion/Combined "spans all sub-tracks" option?
export function isFusionSubSubject(subject, ss) {
  const f = fusionSubSubjectFor(subject);
  return !!f && normalizeSubSubject(ss) === normalizeSubSubject(f);
}

// Written-heavy combos: English's Writing & Fusion (essay grading + auto written
// questions). Everything else — including English Grammar/Reading — is NOT
// written-heavy. Consumed by writtenStyleFor (Phase D) so being "English" no
// longer implies essay treatment on its own.
export function isWrittenHeavy(subject, subSubject) {
  if (!isEnglish(subject)) return false;
  const ss = normalizeSubSubject(subSubject);
  return ss === 'writing' || ss === 'fusion';
}

// Natural-language scope phrase for Groq prompts, so generation is scoped to the
// chosen sub-subject. Flat subject → the subject itself; Fusion/Combined → "all
// areas"; a specific sub-subject → "specifically the X area".
export function subjectScopeLabel(subject, subSubject) {
  const canon = canonicalSubject(subject);
  if (!subSubject || !hasSubSubjects(canon)) return canon;
  if (isFusionSubSubject(canon, subSubject)) {
    const parts = subSubjectsFor(canon).filter((x) => !isFusionSubSubject(canon, x));
    return `${canon} (covering all areas: ${parts.join(', ')})`;
  }
  return `${canon} — specifically the "${subSubject}" area of ${canon}`;
}

// ── Diagram eligibility at the SUBJECT level (Workstream D3, practice mode) ──
//
// The diagnostic and module quizzes read `diagramEligible` per CHAPTER from the
// syllabus blueprint. Practice mode cannot: its topic is freeform student input, not
// a blueprint chapter, so there is no chapter flag to read.
//
// The tempting fix is to fuzzy-match the typed topic to the nearest chapter. This
// codebase already has direct evidence against that: `chapterFor` matched by
// substring and resolved "Areas Related to Circles" to the shorter chapter "Circles",
// grafting the wrong one. Practice topics are worse input still — misspellings,
// Devanagari, off-syllabus topics, "trig" for "Introduction to Trigonometry" — and a
// matcher's failures are SILENT IN BOTH DIRECTIONS: a Grammar topic that happens to
// match a Geometry chapter gets figures, and a legitimate Physics topic that matches
// nothing gets none.
//
// So practice gates on the SUBJECT, which is a value the student picked from a fixed
// list rather than typed. It is robust to every one of those input problems and
// satisfies D's acceptance criterion directly: Grammar practice gets no figures
// because Grammar is not eligible, whatever the student typed in the topic box.
//
// Accepted cost: a Maths practice quiz on a non-visual topic (Real Numbers) may get
// one figure attempt that the model correctly declines. That is cheap — MODEL_DECLINED
// is already a terminal state, so it costs a single call and never repeats.
export const DIAGRAM_ELIGIBLE_SUBJECTS = {
  Science: true,          // and every sub-subject: Physics, Chemistry, Biology, Combined
  Physics: true,
  Chemistry: true,
  Biology: true,
  Maths: true,
  JEE: true,
  NEET: true,
  English: false,         // Writing, Grammar, Reading, Fusion — none are visual
  Hindi: false,
  'Social Science': false // Economics, Civics, Geography, History, Combined
};

/**
 * Can PRACTICE MODE attach figures for this course identity?
 * Unknown subjects default to FALSE — a subject nobody has classified should not
 * start generating figures on the strength of an omission.
 */
export function subjectDiagramEligible(subject, subSubject = '') {
  const canon = canonicalSubject(subject);
  return DIAGRAM_ELIGIBLE_SUBJECTS[canon] === true;
}
