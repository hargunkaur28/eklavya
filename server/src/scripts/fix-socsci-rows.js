#!/usr/bin/env node
/**
 * Row-level corrections for the CBSE Class 10 Social Science paper.
 *
 * These are ADMIN CORRECTIONS, not parser changes — the same edits a human would make
 * in the review UI, applied in one pass because they were diagnosed row by row first.
 * Each is justified against the printed paper, and each is stated as an expected
 * arithmetic effect so the run either lands on the paper's own totals or fails loudly.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   1. Six A/B pairs are internal choices printed with "OR" between them and were left
 *      as two independent questions: Q5, Q6, Q7, Q17, Q27, Q38. Each currently counts
 *      twice and contributes twice its marks.            -> -6 units, -20 marks
 *   2. Q19 (map work) was folded AS a choice and is not one. Its two rows are
 *      both-required parts, so max() took 1 where they sum to 3.   -> +2 marks
 *   3. Q8's sub-parts 8.2 and 8.3 lost their parentKey and stand as their own units.
 *      Their marks are right; only the grouping is wrong.          -> -2 units
 *
 * Expected landing: 38 units, 80 marks — the paper's own stated totals.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
await mongoose.connect(uri);

const PastPaper = (await import('../models/PastPaper.js')).default;
const M = await import('../models/PyqQuestion.js');
const PyqQuestion = M.default;
const { availableMarks, countQuestionUnits } = M;

const paper = await PastPaper.findOne({ subject: 'Social Science', grade: 'Class 10', board: 'CBSE' });
if (!paper) { console.error('Social Science paper not found.'); process.exit(1); }

const before = await PyqQuestion.find({ paperId: paper._id }).lean();
console.log(`Paper : ${paper.title}`);
console.log(`Before: ${countQuestionUnits(before)} units, ${availableMarks(before)} marks (stated ${paper.totalMarks})\n`);

const edits = [];

// ── 1. Fold the A/B internal-choice pairs ────────────────────────────────────
// Evidence is the printed "OR" between the two alternatives. Marked NOT ambiguous
// because a human has now read the page — that is exactly the review step's job, and
// an admin-confirmed relation is the one case where certainty is earned rather than
// guessed.
for (const n of ['5', '6', '7', '17', '27', '38']) {
  const rows = await PyqQuestion.find({ paperId: paper._id, questionNumber: { $in: [`${n}A`, `${n}B`] } });
  if (rows.length !== 2) { console.log(`  !! Q${n}: expected 2 rows, found ${rows.length} — skipped`); continue; }
  const group = `${rows[0].sectionName}|${n}`;
  const marks = Math.max(...rows.map((r) => r.marks || 0));
  for (const [i, r] of rows.entries()) {
    r.choiceGroup = group;
    r.choiceIndex = i;
    r.parentKey = '';
    r.marks = marks;                    // an alternative is worth what the question is worth
    r.partsRelation = 'choose-one';
    r.partsRelationEvidence = 'OR (printed between the alternatives; confirmed against the paper)';
    r.partsAmbiguous = false;
    edits.push(r);
  }
  console.log(`  Q${n}A/${n}B -> choice group "${group}" @ ${marks}m each`);
}

// ── 2. Unfold Q19: map work is both-required parts, not alternatives ─────────
{
  const rows = await PyqQuestion.find({ paperId: paper._id, questionNumber: '19' });
  const key = rows.length ? `${rows[0].sectionName}|19` : null;
  // Printed as 1 mark for the located dam plus 2 for "Any two of the following".
  const marksByIndex = [1, 2];
  for (const [i, r] of rows.entries()) {
    r.choiceGroup = '';
    r.choiceIndex = 0;
    r.parentKey = key;
    r.partLabel = r.partLabel || String(i + 1);
    r.marks = marksByIndex[i] ?? r.marks;
    r.partsRelation = 'all-required';
    r.partsRelationEvidence = 'Map work: both items are located and labelled; no separator printed between them';
    r.partsAmbiguous = false;
    edits.push(r);
  }
  console.log(`  Q19 -> all-required parts under "${key}" (${rows.length} rows, marks ${marksByIndex.join('+')})`);
}

// ── 3. Reattach Q8's orphaned sub-parts ──────────────────────────────────────
{
  const rows = await PyqQuestion.find({ paperId: paper._id, questionNumber: { $in: ['8.2', '8.3'] } });
  for (const r of rows) {
    r.parentKey = `${r.sectionName}|8`;
    r.partsRelation = 'all-required';
    r.partsAmbiguous = false;
    edits.push(r);
  }
  console.log(`  Q8.2/8.3 -> reattached to "Section A|8" (${rows.length} rows)`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${edits.length} row(s) would change. Re-run with --apply.`);
  await mongoose.disconnect();
  process.exit(0);
}

for (const r of edits) await r.save();

const after = await PyqQuestion.find({ paperId: paper._id }).lean();
const units = countQuestionUnits(after);
const marks = availableMarks(after);
console.log(`\nAfter : ${units} units, ${marks} marks (stated ${paper.totalMarks})`);

// The check that makes this script worth running rather than trusting: the paper's own
// printed totals are the target, and a near miss is a failure, not a rounding issue.
const ok = units === 38 && marks === paper.totalMarks;
console.log(ok ? '\nRECONCILED — units and marks both match the paper.' : '\n*** DID NOT RECONCILE — expected 38 units / 80 marks. ***');

await mongoose.disconnect();
process.exit(ok ? 0 : 1);
