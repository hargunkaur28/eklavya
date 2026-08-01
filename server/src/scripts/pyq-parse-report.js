#!/usr/bin/env node
/**
 * Per-paper parse report. Never pooled — an aggregate pass rate hides exactly the
 * papers that are wrong, which is how "the parser generalises" survived three papers
 * that did not.
 *
 *   node src/scripts/pyq-parse-report.js                 # every paper
 *   node src/scripts/pyq-parse-report.js --match SocSci  # titles matching a substring
 *
 * Counts run through the REAL helpers (`countQuestionUnits`, `availableMarks`) rather
 * than a re-implementation, so the report cannot quietly agree with a bug in a copy of
 * the logic it is supposed to be checking.
 *
 * Every `partsAmbiguous` row is printed WITH its evidence string, not counted. A count
 * tells you abstention happened; only the evidence tells you whether it abstained for a
 * reason, and a stuck field looks identical to a careful parse until you read them.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const matchArg = args.indexOf('--match');
const match = matchArg >= 0 ? args[matchArg + 1] : '';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('No MONGODB_URI in env.'); process.exit(1); }
await mongoose.connect(uri);

const PastPaper = (await import('../models/PastPaper.js')).default;
const M = await import('../models/PyqQuestion.js');
const PyqQuestion = M.default;
const { countQuestionUnits, availableMarks, unitKeyOf } = M;

const filter = match ? { title: new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};
const papers = await PastPaper.find(filter).sort({ title: 1 }).lean();

if (!papers.length) { console.log('No papers match.'); await mongoose.disconnect(); process.exit(0); }

let anyZeroAbstention = false;

for (const p of papers) {
  const qs = await PyqQuestion.find({ paperId: p._id }).lean();
  const units = countQuestionUnits(qs);
  const marks = availableMarks(qs);
  const dMarks = marks - (p.totalMarks || 0);

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`${p.title}`);
  console.log(`${p.board} / ${p.grade} / ${p.subject} / ${p.year}   status: ${p.parseStatus}   model: ${p.parsedWithModel || '?'}`);
  console.log('─'.repeat(78));
  console.log(`  rows stored   : ${qs.length}`);
  console.log(`  UNITS         : ${units}`);
  console.log(`  MARKS         : ${marks} vs stated ${p.totalMarks}   (${dMarks >= 0 ? '+' : ''}${dMarks})`);

  // Per-section, because a total that happens to reconcile can hide two errors that
  // cancel. Physics' Section D was exact everywhere else and wrong in one place.
  const secs = [...new Set(qs.map((q) => q.sectionName))];
  for (const s of secs) {
    const rows = qs.filter((q) => q.sectionName === s);
    console.log(`      ${String(s).padEnd(40)} ${String(countQuestionUnits(rows)).padStart(3)} units  ${String(availableMarks(rows)).padStart(3)} marks`);
  }

  // partsRelation distribution, over FAMILIES rather than rows — a 4-part family is
  // one decision, and counting it four times overstates how much the model decided.
  const famRelation = new Map();
  for (const q of qs) {
    const k = unitKeyOf(q);
    if (!famRelation.has(k)) famRelation.set(k, q.partsRelation || 'all-required');
  }
  const dist = {};
  for (const r of famRelation.values()) dist[r] = (dist[r] || 0) + 1;
  const multi = [...famRelation.keys()].filter((k) => qs.filter((q) => unitKeyOf(q) === k).length > 1).length;
  console.log(`  partsRelation : ${JSON.stringify(dist)}   (${multi} multi-row famil${multi === 1 ? 'y' : 'ies'} of ${famRelation.size})`);

  // Rows with no marks — the shortfall diagnosis starts here every time.
  const zeroMark = qs.filter((q) => !q.isContainer && !q.marks);
  if (zeroMark.length) {
    console.log(`  ZERO-MARK ROWS: ${zeroMark.length}  (each one is a candidate for a marks shortfall)`);
    for (const q of zeroMark) {
      console.log(`      [${q.sectionName}] Q${q.questionNumber}  ${(q.questionText || '').slice(0, 84).replace(/\s+/g, ' ')}`);
    }
  }

  const amb = qs.filter((q) => q.partsAmbiguous);
  if (!amb.length) {
    anyZeroAbstention = true;
    console.log('  ABSTENTIONS   : 0  *** A zero-abstention parse is a FINDING, not a pass. ***');
    console.log('                     Uncertainty is being resolved silently somewhere — find where.');
  } else {
    const ambFams = new Set(amb.map(unitKeyOf));
    console.log(`  ABSTENTIONS   : ${amb.length} row(s) across ${ambFams.size} famil${ambFams.size === 1 ? 'y' : 'ies'} — with evidence:`);
    for (const k of ambFams) {
      const rows = qs.filter((q) => unitKeyOf(q) === k);
      const ev = rows.map((r) => r.partsRelationEvidence).find(Boolean);
      const nums = [...new Set(rows.map((r) => r.questionNumber))].join('/');
      console.log(`      [${rows[0].sectionName}] Q${nums}  relation=${rows[0].partsRelation}  rows=${rows.length}`);
      console.log(`          evidence: ${ev ? JSON.stringify(ev) : '(none quoted — this is why it abstained)'}`);
      for (const r of rows) {
        console.log(`          - ${String(r.marks ?? 0).padStart(2)}m  ${(r.questionText || '').slice(0, 76).replace(/\s+/g, ' ')}`);
      }
    }
  }
}

if (anyZeroAbstention) {
  console.log(`\n${'!'.repeat(78)}`);
  console.log('At least one paper abstained ZERO times. Per PRODUCTION_CHECKLIST, that is');
  console.log('reported as a defect, not as a clean parse.');
}

console.log('');
await mongoose.disconnect();
