import mongoose from 'mongoose';
import { BOARDS, GRADES, SUBJECTS } from '../config/taxonomy.js';

// Workstream I — a real past examination paper, uploaded by an admin.
//
// This document is the PROVENANCE RECORD. Its existence is what entitles a question
// to carry `source: 'pyq'`: a PyqQuestion with that source must point at a published
// PastPaper, and PastPaper is only ever created by the admin import route. There is
// no other way for a real-paper question to come into being, which is the structural
// half of the I0 rule (the CI invariant is the other half).
//
// The raw PDF and the parsed draft are stored SEPARATELY and both are kept. A
// re-parse (better model, fixed prompt, admin caught a systematic error) overwrites
// `sections` and the draft questions; it never touches `sourcePdfUrl`. Losing the
// original to a bad re-parse would mean the paper has to be found and re-uploaded,
// and for an older year that may simply not be possible.

// One section of the paper AS PRINTED — "Section A", "Very Short Answer", 20
// questions of 1 mark. This is parsed from the paper, not imposed from a blueprint:
// for Class 10/12 the uploaded paper is authoritative for its own year, because
// board patterns change between years and a generic pattern laid over a real 2019
// paper would misrepresent it.
const paperSectionSchema = new mongoose.Schema({
  name: { type: String, required: true },          // "Section A", exactly as printed
  instruction: { type: String, default: '' },      // "All questions are compulsory."

  // ── The DISCIPLINE this section covers ────────────────────────────────────
  // Class 10 Science and Social Science are single papers sectioned by discipline:
  // "Section A is Biology, Section B is Chemistry and Section C is Physics", and
  // "A-History, B-Geography, C-Political Science, D-Economics". That mapping lives in
  // the General Instructions prose, NOT in the section heading — the heading is
  // literally "Section – A".
  //
  // It used to be dropped entirely, which made a whole product question
  // unanswerable: a student studying "Social Science → Geography" could not be shown
  // Geography questions, because nothing recorded which section was Geography.
  //
  // BOTH are kept on purpose. `name` is what an admin sees on the page in front of
  // them; `discipline` is the taxonomy term the app filters on, resolved through
  // SUBSUBJECT_ALIASES (the board says "Political Science", we say "Civics"). Empty
  // for papers that are not discipline-sectioned, which is most of them.
  discipline: { type: String, default: '' },
  questionCount: { type: Number, default: 0 },
  marksPerQuestion: { type: Number, default: 0 },
  // Some sections genuinely vary marks per question (internal choice, case studies).
  // 0 in marksPerQuestion plus a non-zero total is how that is represented.
  totalMarks: { type: Number, default: 0 }
}, { _id: false });

/**
 * Is this paper's title marking it as a throwaway that must never reach a student?
 *
 * Exists because it already happened: a paper titled "REVIEW TIMING FIXTURE", filed
 * under year 2026 and only half-corrected, was published by accident and was
 * reachable by every real account until someone noticed. Publishing it required no
 * override and produced no signal — it looked exactly like publishing real content.
 *
 * The markers are deliberately NARROW. "SAMPLE" is NOT one of them: CBSE's own
 * Sample Question Papers are legitimate corpus content and are titled as such
 * ("Science (SQP 2025-26)"), so blocking that word would refuse the very papers this
 * feature exists to serve. Only phrases nobody would put on a genuine paper qualify.
 */
const FIXTURE_TITLE_RE = /\b(FIXTURE|DO[-\s]?NOT[-\s]?USE|DUMMY|SCRATCH)\b/i;

export function isFixtureTitle(title) {
  return FIXTURE_TITLE_RE.test(String(title || ''));
}

const pastPaperSchema = new mongoose.Schema({
  // Board/grade/subject are validated against the taxonomy, not free strings — the
  // student-facing query joins on exactly these three plus year, so a paper filed
  // under "cbse" or "Class X" is invisible forever and looks like a missing paper.
  board: { type: String, required: true, enum: BOARDS },
  grade: { type: String, required: true, enum: GRADES },
  subject: { type: String, required: true, enum: SUBJECTS },
  year: { type: Number, required: true },
  title: { type: String, required: true },         // "Mathematics (Standard) — Set 1"

  // Cloudinary URL of the ORIGINAL upload. Never overwritten by a re-parse.
  sourcePdfUrl: { type: String, default: '' },
  sourcePdfPublicId: { type: String, default: '' },
  pageCount: { type: Number, default: 0 },

  sections: [paperSectionSchema],
  durationMinutes: { type: Number, default: 0 },   // from the paper's own header
  totalMarks: { type: Number, default: 0 },

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  // 'parsing'  — import running
  // 'draft'    — parsed, awaiting admin review. NOT queryable by students.
  // 'published'— admin approved. This is the ONLY status students can reach.
  // 'failed'   — parse died; parseError says at which named stage.
  parseStatus: {
    type: String,
    enum: ['parsing', 'draft', 'published', 'failed'],
    required: true,
    default: 'parsing',
    // Structural, not just a route check. The publish ROUTE refuses a fixture too,
    // but the accident that prompted this was a SCRIPT writing the status directly —
    // and a guard that only lives in the request path does not cover the way it
    // actually happened. Runs in validateSync() and on save(), so any code path that
    // builds or mutates the document through the model is caught.
    //
    // NOTE the remaining hole, stated rather than pretended away: `updateOne` /
    // `updateMany` skip validators by default, so a raw status update still bypasses
    // this. That is why the CI invariant drives the model AND the acceptance test
    // drives the HTTP route — three layers because no single one closes it.
    validate: {
      validator: function (v) { return !(v === 'published' && isFixtureTitle(this.title)); },
      message: 'FIXTURE_PAPER_CANNOT_BE_PUBLISHED'
    }
  },
  // Named drop-stage, same instrumentation pattern as the diagram pipeline: a failed
  // parse must say WHICH stage failed, or the admin is debugging a blank screen.
  parseError: { type: String, default: '' },

  // TRUE when the parse came from the Groq fallback rather than PYQ_MODEL. Surfaced
  // in the review UI so the admin knows this one came off the weaker substrate and
  // deserves a harder look — see the PYQ_MODEL comment in utils/parsePastPaper.js.
  parsedByFallback: { type: Boolean, default: false },
  parsedWithModel: { type: String, default: '' },

  // ── Per-page text-layer trust ────────────────────────────────────────────
  // PER PAGE, not per paper: a bilingual or mixed-font paper can have a clean English
  // page and a corrupt Devanagari one, and a paper-level verdict would either condemn
  // the good pages or excuse the bad ones. Measured on the CBSE Hindi paper, where
  // roughly half the pages carry a legacy-encoded font whose extracted text is wrong
  // while the page itself is perfectly legible.
  //
  // 'trusted'   — the model found the text layer matched the rendered page
  // 'untrusted' — it disagreed, so the text was transcribed from the image instead
  // 'suspect'   — a cheap local heuristic smelled corruption but the model did not
  //               say so. Advisory only; it can raise suspicion, never clear a page.
  //
  // Stored so the review UI can point an admin at the pages that need harder reading,
  // rather than leaving them to notice mojibake themselves.
  pageTrust: [{
    pageNumber: { type: Number },
    trust: { type: String, enum: ['trusted', 'suspect', 'untrusted'] },
    heuristicSuspect: { type: Boolean }
  }],

  publishedAt: { type: Date, default: null },

  // What was knowingly overridden at publish time. Missing figures and missing alt
  // text used to block publication outright; they now warn and require an explicit
  // confirmation instead. This is what keeps that from becoming invisible debt — an
  // imperfect paper stays findable ("which papers went out with unanswerable
  // questions?") rather than being indistinguishable from a clean one. Empty on a
  // paper published with nothing outstanding, and rewritten on every publish.
  publishedWithWarnings: [{
    code: { type: String },
    questionNumbers: [{ type: String }],
    acknowledgedAt: { type: Date }
  }],
  uploadedBy: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

// The student-facing lookup is always (board, grade, subject, published) and then a
// year filter, which is exactly this index. `published` is in it rather than applied
// after, so a draft paper cannot be reached by a query that forgets to filter.
pastPaperSchema.index({ board: 1, grade: 1, subject: 1, year: 1, parseStatus: 1 });

// One paper per (board, grade, subject, year, title). Title is in the key because a
// board can publish several sets for one subject-year ("Set 1", "Set 2"), and those
// are genuinely different papers rather than a duplicate upload.
pastPaperSchema.index({ board: 1, grade: 1, subject: 1, year: 1, title: 1 }, { unique: true });

export default mongoose.model('PastPaper', pastPaperSchema);
