// Workstream I6 — paper structure for GENERATED exam-style papers.
//
// ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
//
// It is NOT used for Class 10 or Class 12. For a board grade, THE UPLOADED PAPER IS
// THE BLUEPRINT: its sections, question counts, marks and duration come from the
// paper itself as parsed. Board patterns change between years and between boards, and
// laying a generic 2026 pattern over a real 2019 paper would misrepresent the paper a
// student is sitting. If no paper has been uploaded for a Class 10/12 combination the
// app says so — it does not fall back to this file, because a generated paper
// presented where a real one was expected is the conflation I0 forbids.
//
// This file exists for the grades that have NO board exam, where "past paper" is not
// a thing that can exist and exam-style practice is the honest offering.
//
// ── SOURCING — PRIMARY SOURCES ONLY ─────────────────────────────────────────
//
// These figures come from the boards' OWN published sample papers, not from
// coaching or aggregator sites. That distinction is load-bearing for a
// state-government deployment: "our exam pattern came from a coaching blog" is not
// an answer that survives being asked, and the sample paper IS the pattern, so the
// primary source is the same download either way.
//
// An earlier revision of this file cited aggregators. Checking them against the
// official PDFs found one of the three materially WRONG — see Science below. That
// is the whole argument for this rule, so it is recorded rather than tidied away.
//
//   Verified: 31 July 2026, by extracting the official PDFs and reading their
//   General Instructions verbatim.
//
//   CBSE Class X SQP index:  https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html
//   CBSE Class XII SQP index: https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html
//
//   [VERIFIED] CBSE Class 10 Mathematics (Standard), Code 041
//     https://cbseacademic.nic.in/web_material/SQP/ClassX_2025_26/MathsStandard-SQP.pdf
//     Verbatim: "This question paper contains 38 questions", "Section A consists of
//     20 questions of 1 mark each", "Section C consists of 6 questions of 3 marks
//     each", "Section D consists of 4 questions of 5 marks each"; Max Marks 80.
//     Matches SECONDARY_MATHS_80 exactly.
//
//   [VERIFIED] CBSE Class 12 Physics, Code 042
//     https://cbseacademic.nic.in/web_material/SQP/ClassXII_2025_26/Physics-SQP.pdf
//     Verbatim: "There are 33 questions in all", "Section A contains sixteen
//     questions, twelve MCQ and four assertion reasoning based of 1 mark each,
//     Section B contains five questions of two marks each, Section C contains seven
//     questions of three marks each, Section D contains two case study-based
//     questions of four marks each and Section E contains three long answer
//     questions of five marks each"; 70 marks, 3 hours.
//     Matches SENIOR_SCIENCE_70 exactly.
//
//   [CORRECTED] CBSE Class 10 Science, Code 086
//     https://cbseacademic.nic.in/web_material/SQP/ClassX_2025_26/Science-SQP.pdf
//     https://cbseacademic.nic.in/web_material/SQP/ClassX_2025_26/Science-MS.pdf
//     The aggregators described a FIVE-section, question-type structure
//     (A 20x1, B 6x2, C 7x3, D 3x5, E 3x4). The official paper says something
//     different, verbatim:
//        "This question paper consists of 39 questions in 3 sections.
//         Section A is Biology, Section B is Chemistry and Section C is Physics."
//     Real Class 10 Science is sectioned BY DISCIPLINE, not by question type. A mock
//     built on the aggregator shape would not resemble the exam at all — it is not a
//     rounding error, it is the wrong paper. See SECONDARY_SCIENCE_80 for exactly
//     what is verified and what is still assumed.
//
//   [UNVERIFIED] HBSE / BSEH — official model papers + stepwise marking schemes:
//     https://bseh.org.in/model-paper-stepwise-marking-scheme-classwise-202526
//     NOT yet checked against the official PDFs, and the secondary sources
//     CONTRADICT EACH OTHER — one gives Class 10 Science as 60 theory + 20 practical
//     + 20 CCE over 3 hours, another gives every subject as 80 theory + 20 internal
//     over 3 hours 15 minutes. Because that is unresolved, this file no longer
//     encodes an HBSE-specific divergence (see the note on SECONDARY_SCIENCE_80).
//     Resolve it from the BSEH model papers when the corpus is collected.
//
// ── AN HONEST NOTE ABOUT THE NON-BOARD GRADES ───────────────────────────────
//
// Searching for an official CBSE or BSEH paper design for Classes 6-9 and 11 returns
// nothing, and that is not a gap in the research — NEITHER BOARD PUBLISHES ONE.
// Those grades are examined internally by the school, which sets its own paper. There
// is no authority to copy here, so the structures below are DERIVED from the board
// designs above (which is what schools model their internal papers on) and scaled to
// the grade. That derivation is the honest description of what they are, and it is
// why the UI calls these "exam-style practice" and never "your exam".
//
// The board-grade totals ARE authoritative and are used as-is for Class 11, which
// sits the Class 12 pattern a year early in most schools.

// One reusable pattern. `sections` is the printed structure a student should
// recognise; marks and counts are what the generator is held to.
const PATTERNS = {
  // Derived from CBSE Class 10 Mathematics (see sourcing). Used for Class 9, which
  // is the year schools most closely rehearse the board pattern.
  SECONDARY_MATHS_80: {
    durationMinutes: 180,
    totalMarks: 80,
    sections: [
      { name: 'Section A', instruction: 'Section A consists of 20 multiple choice questions of 1 mark each.', questionCount: 20, marksPerQuestion: 1 },
      { name: 'Section B', instruction: 'Section B consists of 5 very short answer questions of 2 marks each.', questionCount: 5, marksPerQuestion: 2 },
      { name: 'Section C', instruction: 'Section C consists of 6 short answer questions of 3 marks each.', questionCount: 6, marksPerQuestion: 3 },
      { name: 'Section D', instruction: 'Section D consists of 4 long answer questions of 5 marks each.', questionCount: 4, marksPerQuestion: 5 },
      { name: 'Section E', instruction: 'Section E consists of 3 case study based questions of 4 marks each.', questionCount: 3, marksPerQuestion: 4 }
    ]
  },

  // Derived from CBSE Class 10 Science, Code 086 — sectioned BY DISCIPLINE.
  //
  // WHAT IS VERIFIED, verbatim from the official SQP's General Instructions:
  //   - "39 questions in 3 sections"
  //   - "Section A is Biology, Section B is Chemistry and Section C is Physics"
  //   - 80 marks, 3 hours
  // Verified from the question numbering in the official PDF (deterministic, from
  // the section headings' positions rather than a model's opinion):
  //   - Section A = Q1-16 (16), Section B = Q17-29 (13), Section C = Q30-39 (10)
  // Verified by TWO independent official documents agreeing exactly (the SQP and its
  // Marking Scheme both yield the same composition for this section):
  //   - Section A totals 30 marks as 9x1 + 3x2 + 2x3 + 1x4 + 1x5
  //
  // WHAT IS STILL ASSUMED, and should be confirmed against the Marking Scheme:
  //   - The split of the remaining 50 marks between Chemistry and Physics. An even
  //     25/25 is assumed. Extracting the marks column for those two sections gave
  //     INCONSISTENT results between the SQP and the MS (21/22 vs 24/19, neither
  //     totalling 80), so the text-layer heuristic is not trustworthy there and no
  //     number from it is encoded. The `marksMix` for B and C below is therefore a
  //     plausible composition matching the verified question count and the assumed
  //     section total — not a transcription.
  //
  //   CORROBORATION (still not proof, but two independent methods now agree): the
  //   VISION parse of the same official PDF — a different mechanism entirely from
  //   the text-layer heuristic above — independently produced Section A = 30,
  //   Section B = 25, Section C = 25, total 80. That is the assumed split arrived at
  //   from the other direction. It stays labelled "assumed" rather than promoted to
  //   "verified" because both methods are extractions rather than readings of a
  //   stated figure, and the Marking Scheme states it outright. Confirm it there.
  //
  // This imprecision is acceptable *here specifically* because this pattern is only
  // ever used for CLASS 9, a non-board grade with no published design of its own —
  // it is already a derivation, and the thing that matters is the shape.
  SECONDARY_SCIENCE_80: {
    durationMinutes: 180,
    totalMarks: 80,
    sections: [
      {
        name: 'Section A — Biology',
        instruction: 'Section A is Biology. All questions are compulsory; an internal choice is provided in some questions.',
        questionCount: 16,
        marksPerQuestion: 0,          // mixed — see marksMix
        marksMix: [{ marks: 1, count: 9 }, { marks: 2, count: 3 }, { marks: 3, count: 2 }, { marks: 4, count: 1 }, { marks: 5, count: 1 }]
      },
      {
        name: 'Section B — Chemistry',
        instruction: 'Section B is Chemistry. All questions are compulsory; an internal choice is provided in some questions.',
        questionCount: 13,
        marksPerQuestion: 0,
        marksMix: [{ marks: 1, count: 7 }, { marks: 2, count: 3 }, { marks: 3, count: 1 }, { marks: 4, count: 1 }, { marks: 5, count: 1 }]
      },
      {
        name: 'Section C — Physics',
        instruction: 'Section C is Physics. All questions are compulsory; an internal choice is provided in some questions.',
        questionCount: 10,
        marksPerQuestion: 0,
        marksMix: [{ marks: 1, count: 3 }, { marks: 2, count: 2 }, { marks: 3, count: 3 }, { marks: 4, count: 1 }, { marks: 5, count: 1 }]
      }
    ]
  },

  // Language / Social Science papers are written-answer heavy and carry far fewer
  // objective questions than Maths or Science. Same 80-mark envelope.
  SECONDARY_THEORY_80: {
    durationMinutes: 180,
    totalMarks: 80,
    sections: [
      { name: 'Section A', instruction: 'Section A consists of 20 objective type questions of 1 mark each.', questionCount: 20, marksPerQuestion: 1 },
      { name: 'Section B', instruction: 'Section B consists of 8 very short answer questions of 2 marks each.', questionCount: 8, marksPerQuestion: 2 },
      { name: 'Section C', instruction: 'Section C consists of 8 short answer questions of 3 marks each.', questionCount: 8, marksPerQuestion: 3 },
      { name: 'Section D', instruction: 'Section D consists of 4 long answer questions of 5 marks each.', questionCount: 4, marksPerQuestion: 5 }
    ]
  },

  // Middle school (Classes 6-8). Schools examine these internally over a shorter
  // sitting; a three-hour paper for a Class 6 student is not a realistic rehearsal
  // of anything, so the envelope is 60 marks over 2.5 hours.
  MIDDLE_60: {
    durationMinutes: 150,
    totalMarks: 60,
    sections: [
      { name: 'Section A', instruction: 'Section A consists of 15 objective type questions of 1 mark each.', questionCount: 15, marksPerQuestion: 1 },
      { name: 'Section B', instruction: 'Section B consists of 8 very short answer questions of 2 marks each.', questionCount: 8, marksPerQuestion: 2 },
      { name: 'Section C', instruction: 'Section C consists of 6 short answer questions of 3 marks each.', questionCount: 6, marksPerQuestion: 3 },
      { name: 'Section D', instruction: 'Section D consists of 2 long answer questions of 5.5 marks each.', questionCount: 2, marksPerQuestion: 5.5 }
    ]
  },

  // Class 11, sitting the Class 12 science pattern a year early. Authoritative
  // totals (70 marks / 33 questions), taken as-is from the CBSE Class 12 design.
  SENIOR_SCIENCE_70: {
    durationMinutes: 180,
    totalMarks: 70,
    sections: [
      { name: 'Section A', instruction: 'Section A consists of 16 objective type questions of 1 mark each.', questionCount: 16, marksPerQuestion: 1 },
      { name: 'Section B', instruction: 'Section B consists of 5 very short answer questions of 2 marks each.', questionCount: 5, marksPerQuestion: 2 },
      { name: 'Section C', instruction: 'Section C consists of 7 short answer questions of 3 marks each.', questionCount: 7, marksPerQuestion: 3 },
      { name: 'Section D', instruction: 'Section D consists of 2 case study based questions of 4 marks each.', questionCount: 2, marksPerQuestion: 4 },
      { name: 'Section E', instruction: 'Section E consists of 3 long answer questions of 5 marks each.', questionCount: 3, marksPerQuestion: 5 }
    ]
  }
};

// Which pattern each (grade, subject) uses. Board is the outer key because HBSE
// Science genuinely differs; where the two boards agree the same pattern is named
// twice rather than one falling through to the other, so a future divergence is a
// one-line edit at the place it applies.
//
// Classes 10 and 12 are ABSENT ON PURPOSE — see the header. Nursery/KG/Classes 1-5
// are absent too: a timed sectioned mock paper is not a meaningful artefact for a
// six-year-old, and inventing one would be template filler.
const SUBJECT_PATTERNS = {
  Maths: 'MATHS', Science: 'SCIENCE', Physics: 'SCIENCE', Chemistry: 'SCIENCE',
  Biology: 'SCIENCE', English: 'THEORY', Hindi: 'THEORY', 'Social Science': 'THEORY'
};

const GRADE_TIERS = {
  'Class 6': 'MIDDLE', 'Class 7': 'MIDDLE', 'Class 8': 'MIDDLE',
  'Class 9': 'SECONDARY',
  'Class 11': 'SENIOR'
};

function patternKeyFor(grade, board, subject) {
  const tier = GRADE_TIERS[grade];
  const family = SUBJECT_PATTERNS[subject];
  if (!tier || !family) return null;

  if (tier === 'MIDDLE') return 'MIDDLE_60';
  if (tier === 'SENIOR') {
    // Class 11 languages/humanities sit an 80-mark paper; the sciences sit 70.
    return family === 'SCIENCE' ? 'SENIOR_SCIENCE_70' : 'SECONDARY_THEORY_80';
  }
  // SECONDARY (Class 9)
  if (family === 'MATHS') return 'SECONDARY_MATHS_80';
  // Both boards get the same Science pattern. There WAS an HBSE-specific 60-mark
  // variant here, on the strength of a secondary source saying HBSE Science is
  // 60 theory + 20 practical + 20 CCE. It was removed rather than kept, because a
  // second secondary source says every HBSE subject is 80 theory + 20 internal and
  // neither has been checked against the BSEH model papers. Encoding a contested
  // number as though it were settled is worse than encoding one shape for both:
  // this is a non-board grade either way, and a divergence should be reintroduced
  // only when the official BSEH paper confirms it. See the sourcing header.
  if (family === 'SCIENCE') return 'SECONDARY_SCIENCE_80';
  return 'SECONDARY_THEORY_80';
}

/**
 * The blueprint for a generated exam-style paper, or NULL when there is no honest
 * structure to offer.
 *
 * Null is a real answer and callers must handle it rather than substituting a
 * default:
 *   • Class 10 / 12 — the real paper is the blueprint. A generated paper here would
 *     be presented where a past paper was expected.
 *   • Nursery-Class 5 — no meaningful exam artefact at this age.
 *   • JEE / NEET — competitive entrance exams, not board exams. They have their own
 *     patterns which are nothing like a board paper, and pretending otherwise would
 *     rehearse the wrong exam. Better to offer nothing than the wrong thing.
 */
export function blueprintFor(grade, board, subject) {
  const key = patternKeyFor(grade, board, subject);
  if (!key) return null;
  const pattern = PATTERNS[key];
  if (!pattern) return null;

  return {
    key: `${grade}|${board}|${subject}`,
    patternName: key,
    durationMinutes: pattern.durationMinutes,
    totalMarks: pattern.totalMarks,
    sections: pattern.sections.map((s) => ({ ...s, totalMarks: sectionMarks(s) }))
  };
}

/**
 * Marks in a section. A section is either UNIFORM (`marksPerQuestion`, the common
 * case) or MIXED (`marksMix`, e.g. real Class 10 Science, whose discipline sections
 * each run from 1-mark MCQs to a 5-mark long answer). Mixed sections carry
 * `marksPerQuestion: 0` — the same convention PastPaper.sections uses for a parsed
 * paper whose section genuinely varies, so the two agree on what 0 means.
 */
export function sectionMarks(section) {
  if (Array.isArray(section.marksMix) && section.marksMix.length) {
    return section.marksMix.reduce((a, m) => a + m.marks * m.count, 0);
  }
  return section.questionCount * section.marksPerQuestion;
}

/** Question count in a section, from whichever representation it uses. */
export function sectionQuestionCount(section) {
  if (Array.isArray(section.marksMix) && section.marksMix.length) {
    return section.marksMix.reduce((a, m) => a + m.count, 0);
  }
  return section.questionCount;
}

/** Does this (grade, board, subject) get a generated exam-style paper at all? */
export function hasBlueprint(grade, board, subject) {
  return blueprintFor(grade, board, subject) !== null;
}

/** Total question count a blueprint asks the generator for. */
export function blueprintQuestionCount(blueprint) {
  return (blueprint?.sections || []).reduce((a, s) => a + sectionQuestionCount(s), 0);
}

export { PATTERNS };
