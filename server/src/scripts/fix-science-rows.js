#!/usr/bin/env node
/**
 * Row-level corrections for the CBSE Class 10 Science SQP (the review-timing fixture).
 *
 * The paper reconciles at 80/80 marks ONLY because seven rows carry zero. Those rows
 * are real content a student would be shown as worth nothing, so the total being right
 * is hiding the defect rather than proving its absence.
 *
 * The paper is 39 questions in three discipline sections: A Biology (1-16),
 * B Chemistry (17-29), C Physics (30-39). The parse numbered the tail of Chemistry as
 * 30-31, colliding with Physics' genuine 30 and 31 — four rows filed under the wrong
 * section AND mis-paired with each other. Diagnosed row by row before writing this.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   1. "B. Oxygen can combine with both metals and non-metals" is Q29's option B.
 *      Q29 currently holds only option A. Pair them.                    -1 unit
 *   2. "A. A hydrocarbon with the formula CxHy..." duplicates Q29's own option A text.
 *      Delete it.                                                       -1 unit
 *   3. "(e) Write a balanced chemical equation..." is sub-part (e) of that same
 *      hydrocarbon question, not a question. Merge its text into Q29 and delete.
 *   4. "B. The electronic structures of atoms P and Q" is Q26's option B. Pair them.
 *   5. "39 OR" is not a question number. It is Q39's alternative.       -1 unit
 *   6. Four alternatives carry 0 marks; an alternative is worth what its question is
 *      worth. Q34B, Q38D, and the newly paired rows take their sibling's marks.
 *
 * Marks are UNCHANGED by design: alternatives score max(), so a 0-mark alternative was
 * already contributing nothing to the total. This fixes what the student sees, not the
 * arithmetic. Expected landing: 39 units, 80 marks.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const PastPaper = (await import('../models/PastPaper.js')).default;
const M = await import('../models/PyqQuestion.js');
const PyqQuestion = M.default;
const { availableMarks, countQuestionUnits } = M;

const paper = await PastPaper.findOne({ title: /REVIEW TIMING FIXTURE/ });
if (!paper) { console.error('Science fixture not found.'); process.exit(1); }

const all = await PyqQuestion.find({ paperId: paper._id });
const before = all.map((r) => r.toObject());
console.log(`Paper : ${paper.title}`);
console.log(`Before: ${countQuestionUnits(before)} units, ${availableMarks(before)} marks (stated ${paper.totalMarks}), ${before.filter((r) => !r.marks).length} zero-mark rows\n`);

// Located by text prefix rather than by number — the numbers are precisely what is wrong.
const find = (sec, prefix) => all.find((r) => r.sectionName === sec && (r.questionText || '').replace(/\s+/g, ' ').startsWith(prefix));

const q26 = find('Section B', 'Attempt either option A or B. A. An element');
const q29 = find('Section B', 'Attempt either option A or B. A. A hydrocarbon');
const oxygenB = find('Section B', 'B. Oxygen can combine with both metals');
const dupHydro = find('Section B', 'A. A hydrocarbon with the formula');
const subPartE = find('Section B', '(e) Write a balanced chemical equation');
const structuresB = find('Section B', 'B. The electronic structures of atoms P and Q');
const q39 = find('Section C', 'Attempt either option A or B. A. The arrangement of resistors');
const q39or = all.find((r) => String(r.questionNumber).trim() === '39 OR');
const q34b = find('Section C', 'B. A copper wire has a length');
const q38d = find('Section C', 'D. A photographer is using a DSLR');

const missing = Object.entries({ q26, q29, oxygenB, dupHydro, subPartE, structuresB, q39, q39or, q34b, q38d })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Could not locate: ${missing.join(', ')} — aborting rather than half-fixing.`); process.exit(1); }

const save = [];
const remove = [];

// 1 + 6. Q29 gains its real option B.
const pair = (a, b, num, sec, marks, why) => {
  const g = `${sec}|${num}`;
  a.choiceGroup = g; a.choiceIndex = 0; a.questionNumber = num; a.marks = marks;
  b.choiceGroup = g; b.choiceIndex = 1; b.questionNumber = num; b.marks = marks;
  for (const r of [a, b]) {
    r.sectionName = sec; r.parentKey = '';
    r.partsRelation = 'choose-one';
    r.partsRelationEvidence = why;
    r.partsAmbiguous = false;
  }
  save.push(a, b);
};

pair(q29, oxygenB, '29', 'Section B', 5, '"Attempt either option A or B" printed on the question; confirmed against the paper');
pair(q26, structuresB, '26', 'Section B', 3, '"Attempt either option A or B" printed on the question; confirmed against the paper');
console.log('  Q29 <- "B. Oxygen can combine..." paired as option B @ 5m');
console.log('  Q26 <- "B. The electronic structures..." paired as option B @ 3m');

// 3. Sub-part (e) belongs inside the hydrocarbon question's text.
const eText = (subPartE.questionText || '').trim();
if (!(q29.questionText || '').includes(eText)) q29.questionText = `${q29.questionText}\n${eText}`.trim();
remove.push(subPartE);
console.log('  "(e) Write a balanced chemical equation..." merged into Q29 and removed');

// 2. Duplicate of Q29's option A.
remove.push(dupHydro);
console.log('  "A. A hydrocarbon..." removed as a duplicate of Q29 option A');

// 5. "39 OR" is a parse artefact, not a number.
pair(q39, q39or, '39', 'Section C', 5, '"OR" printed between the alternatives; confirmed against the paper');
console.log('  Q39 <- "39 OR" folded as the alternative @ 5m (question number repaired)');

// 6. Alternatives that lost their marks.
q34b.marks = 2; q34b.partsAmbiguous = false; save.push(q34b);
q38d.marks = 4; q38d.partsAmbiguous = false; save.push(q38d);
console.log('  Q34 option B -> 2m, Q38 option D -> 4m (an alternative is worth what the question is worth)');

if (!APPLY) {
  console.log(`\nDRY RUN — ${save.length} row(s) would change, ${remove.length} removed. Re-run with --apply.`);
  await mongoose.disconnect();
  process.exit(0);
}

for (const r of save) await r.save();
for (const r of remove) await r.deleteOne();

const after = await PyqQuestion.find({ paperId: paper._id }).lean();
const units = countQuestionUnits(after);
const marks = availableMarks(after);
const zeros = after.filter((r) => !r.isContainer && !r.marks).length;
console.log(`\nAfter : ${units} units, ${marks} marks (stated ${paper.totalMarks}), ${zeros} zero-mark rows`);

const ok = units === 39 && marks === paper.totalMarks && zeros === 0;
console.log(ok ? '\nRECONCILED — 39 units, 80 marks, no question worth zero.'
               : '\n*** DID NOT RECONCILE — expected 39 units / 80 marks / 0 zero-mark rows. ***');

await mongoose.disconnect();
process.exit(ok ? 0 : 1);
