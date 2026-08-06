// Feature 27 — who the Voice Mentor is for, and which subjects it may name aloud.
//
// Two questions live here, both of which the SERVER answers and the client only reads:
//
//   1. Is this student eligible for the mentor at all?
//   2. Which subjects may it speak?
//
// Neither is decided client-side. The pattern is `GET /api/auth/profile-config` for
// Aadhaar (Feature 22): the client must never render an entry point the server would
// refuse, because a control that appears and then fails is worse than one that never
// appeared — and this control is operated by a child who cannot read the error.

import AdminConfig from '../models/AdminConfig.js';
import { GRADES, normalizeGrade } from '../config/taxonomy.js';

// The built-in default: nursery through Class 5. Overridden by MENTOR_MAX_GRADE in the
// env, and by AdminConfig.mentorMaxGrade above that.
const BUILTIN_MAX_GRADE = 'Class 5';

/** Index of a grade in the canonical ordering, or -1. Ordering IS the taxonomy's order. */
export function gradeIndex(grade) {
  const n = normalizeGrade(grade);
  return GRADES.findIndex((g) => normalizeGrade(g) === n);
}

/**
 * The effective max grade: DB override -> env -> built-in.
 *
 * An unrecognised value falls through to the next source rather than being honoured.
 * A typo in the admin form would otherwise resolve to index -1, which compares below
 * every grade and would silently disable the mentor for EVERY student — a total
 * feature outage produced by a spelling mistake, with no error anywhere.
 */
export async function getMentorMaxGrade() {
  const candidates = [];
  try {
    const cfg = await AdminConfig.findOne({ singleton: 'admin' }).select('mentorMaxGrade');
    if (cfg?.mentorMaxGrade) candidates.push(cfg.mentorMaxGrade);
  } catch {
    // A DB hiccup must not take the mentor down; fall through to env/built-in.
  }
  if (process.env.MENTOR_MAX_GRADE) candidates.push(process.env.MENTOR_MAX_GRADE);
  candidates.push(BUILTIN_MAX_GRADE);

  for (const c of candidates) {
    if (gradeIndex(c) >= 0) return GRADES[gradeIndex(c)];
  }
  return BUILTIN_MAX_GRADE;
}

/**
 * Is a student of this grade eligible?
 *
 * THE ORDERING PROBLEM, stated plainly: at signup the grade is UNKNOWN. Age is
 * collected inside profile onboarding and the grade only at the course picker after
 * that — so the offer is necessarily made before the answer exists.
 *
 * An unknown grade therefore resolves to ELIGIBLE. The alternative (withhold the offer
 * until the grade is known) would put the offer after onboarding, which is exactly the
 * flow the mentor exists to narrate — a child who cannot read would have to complete
 * the whole thing silently before being offered help with it.
 *
 * Eligibility is then RE-CHECKED once age and grade are known. A student above the
 * threshold has the mentor finish the flow with them and say goodbye (`mentor.farewell`)
 * rather than vanishing mid-question. Dropping out mid-flow strands a child exactly as
 * badly as a wrong navigation does, and for the same reason: they cannot read the screen
 * they are stranded on and cannot describe where they are.
 */
export function isGradeEligible(grade, maxGrade) {
  if (!grade) return true;                      // unknown at signup — see above
  const gi = gradeIndex(grade);
  const mi = gradeIndex(maxGrade);
  if (gi < 0 || mi < 0) return false;           // a grade outside the taxonomy is not a child we know how to serve
  return gi <= mi;
}

// ── Which subjects the mentor may say out loud ──────────────────────────────
//
// A VISUAL list is scanned and mostly ignored. A SPOKEN list is a sequence of
// recommendations, and every item in it carries the authority of a guide the child has
// just been told to trust. Reading "NEET" to a seven-year-old is the mentor proposing
// NEET — a harm the voice path CREATES, which the picker never did.
//
// So the spoken list is filtered by grade. The visual picker is deliberately left
// alone: this is not a fix for the fact that grade and subject are independent lists
// (a Class 2 student can still tap JEE and get there). It only stops the mentor from
// being the one who suggests it.
//
// THE SAME LIST GOVERNS WHAT THE MATCHER ACCEPTS. If the mentor offers five subjects
// but matches against ten, it accepts a subject it never offered — which is the same
// defect one step later, and harder to see because the child's own words appear to
// have caused it.
const PRIMARY_SPOKEN_SUBJECTS = ['Maths', 'Science', 'English', 'Hindi', 'Social Science'];

// The band boundary. Below and including this grade, only the five school subjects are
// spoken; above it, the full taxonomy. Two bands rather than a per-grade list because
// an assembled sentence is a NEW STRING PER GRADE, and a new string is a synthesis that
// has to be paid for — two fixed lines stay cached forever.
const PRIMARY_BAND_MAX = 'Class 8';

export function spokenSubjectsFor(grade) {
  const gi = gradeIndex(grade);
  const bi = gradeIndex(PRIMARY_BAND_MAX);
  // Unknown grade is treated as PRIMARY: at the point the mentor first asks, the grade
  // may genuinely not be known yet, and the safe direction is the narrower list. Naming
  // too few subjects costs a child one tap on the visual picker; naming too many puts
  // NEET in front of a seven-year-old. Design Rule 19 — guess in the direction whose
  // failure is recoverable.
  if (gi < 0 || gi <= bi) return { subjects: PRIMARY_SPOKEN_SUBJECTS, lineId: 'course.subject.primary' };
  return { subjects: null, lineId: 'course.subject.senior' };   // null = the full taxonomy
}
