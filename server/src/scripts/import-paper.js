// Workstream I — import a past paper from the command line.
//
// The admin console has an upload form, and for one paper it is the right surface.
// For BULK CORPUS WORK it is the wrong shape: ~80 papers across two boards, four
// subjects and five years is 80 trips through a browser form, each holding the tab
// open for the two-to-three minutes a vision parse takes. This does the same import
// — the same parse, the same uploads, the same `toPyqDocument` mapping — from a
// terminal, so a directory of PDFs can be worked through in one sitting.
//
// It is NOT a second implementation of the route. It imports the route's own mapping
// function; if that changes, this changes with it, and the CI invariant that guards
// the mapping guards this too.
//
// SAFETY: everything it creates is a DRAFT. There is no publish path here on
// purpose. Publication requires the human review step (routes/pyqAdmin.js), and a
// CLI flag that skipped it would defeat the one control that makes the corpus
// trustworthy.
//
// Usage:
//   node src/scripts/import-paper.js --pdf <path> --board CBSE --grade "Class 10" \
//        --subject Science --year 2023 --title "Science — Set 1"
//
//   --expect-questions N   compare the parse against a known question count and
//                          print the correction worklist (see below)
//   --replace              delete and re-import an existing paper with the same key
//   --delete               remove a paper (and its questions and Cloudinary assets)
//
// MUST BE THE FIRST IMPORT — same hazard server.js documents. `utils/cloudinary.js`
// reads its env vars at MODULE LOAD, and ESM evaluates every import before the body
// of this file runs, so a `dotenv.config()` call further down leaves Cloudinary
// initialised as unconfigured and the import dies with "Cloudinary is not
// configured" on a machine where it plainly is. The other backfill scripts get away
// with calling config() in the body because they only read MONGODB_URI, which is
// read at call time.
import 'dotenv/config';

import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import PastPaper from '../models/PastPaper.js';
import PyqQuestion, { countQuestionUnits, availableMarks, groupByChoice } from '../models/PyqQuestion.js';
import { parsePastPaper } from '../utils/parsePastPaper.js';
import { isPdfBuffer } from '../utils/pdfExtract.js';
import { toPyqDocument } from '../routes/pyqAdmin.js';
import {
  cloudinaryConfigured, uploadPastPaperPdf, uploadPyqPageImage, uploadPyqFigure, deletePyqAssets
} from '../utils/cloudinary.js';
import { BOARDS, GRADES, SUBJECTS } from '../config/taxonomy.js';


const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const opts = {
  pdf: arg('pdf'),
  board: arg('board'),
  grade: arg('grade'),
  subject: arg('subject'),
  year: Number(arg('year')),
  title: arg('title'),
  // Kept RAW so a non-integer can be rejected rather than silently becoming NaN.
  // `Number("Cl10-English")` is NaN, every comparison against it is false, and the
  // worklist then reports "no expected count given" — the check silently switches
  // itself off exactly when an argument slip means you most need it to complain.
  expectQuestionsRaw: arg('expect-questions', ''),
  replace: flag('replace'),
  remove: flag('delete')
};

function usage(msg) {
  console.error(`\n${msg}\n`);
  console.error('  node src/scripts/import-paper.js --pdf <path> --board <board> --grade <grade> \\');
  console.error('       --subject <subject> --year <year> --title "<title>" [--expect-questions N] [--replace]');
  console.error(`\n  boards:   ${BOARDS.join(' | ')}`);
  console.error('  grades:   Class 10 | Class 12   (only board-exam grades have past papers)');
  console.error(`  subjects: ${SUBJECTS.join(' | ')}\n`);
  process.exit(1);
}

/**
 * The correction worklist.
 *
 * Printed after every import, because the number that decides this feature's scope
 * is HOW LONG A HUMAN TAKES TO CORRECT ONE PAPER, and that measurement is much
 * cheaper to take when the admin starts from an itemised list of what is wrong
 * rather than from N undifferentiated rows.
 *
 * Everything here is objectively checkable — counts, missing alt text, blocked
 * figures. It deliberately does NOT estimate a time: the whole point is that the
 * human number has to be measured, not modelled.
 */
function printWorklist(stored, parsed, expectQuestions) {
  const bySection = {};
  for (const q of stored) (bySection[q.sectionName || '(unassigned)'] ||= []).push(q);

  console.log('\n──────── CORRECTION WORKLIST ────────');
  console.log('Edits required to reach publishable. Times are NOT estimated here —');
  console.log('the point of this list is to make the human measurement cheap to take.\n');

  let edits = 0;

  const parsedCount = countQuestionUnits(stored);
  if (expectQuestions) {
    const delta = parsedCount - expectQuestions;
    if (delta === 0) console.log(`[OK]      ${parsedCount} questions — matches the expected ${expectQuestions}`);
    else {
      edits += Math.abs(delta);
      // Deliberately NOT "delete N spurious rows". That advice was wrong on the first
      // real paper and would have destroyed content: the surplus turned out to be
      // genuine questions whose NUMBERS collided across a section boundary (the tail
      // of Chemistry numbered 30-31, colliding with Physics' real 30-31), plus one
      // sub-part "(e)" mis-folded as an OR alternative. Nothing was spurious.
      // A count mismatch is a reconciliation task, and the reviewer has to look
      // before deleting anything.
      console.log(`[COUNT]   ${parsedCount} questions vs expected ${expectQuestions} (${delta > 0 ? '+' : ''}${delta})`);
      console.log('          -> RECONCILE, do not delete on sight. Check in this order:');
      console.log('             1. numbers repeated across a SECTION BOUNDARY (same number in two sections)');
      console.log('             2. sub-parts "(a)/(b)/(e)" wrongly folded as OR alternatives');
      console.log('             3. only then, genuinely duplicated rows');
    }
  } else {
    console.log(`[COUNT]   ${parsedCount} questions (no --expect-questions given; read the paper's own header to check)`);
  }

  for (const [name, qs] of Object.entries(bySection)) {
    console.log(`          ${name.padEnd(24)} ${String(countQuestionUnits(qs)).padStart(3)} questions, ${availableMarks(qs)} marks`);
  }
  if (parsed.discrepancy) {
    console.log(`[SELF]    the paper states ${parsed.discrepancy.declaredQuestions} questions; parse produced ${parsed.discrepancy.parsedQuestions}`);
  }

  const withFigure = stored.filter((q) => q.diagramUrl);
  const needAlt = withFigure.filter((q) => !q.diagramAlt);
  edits += needAlt.length;
  // These two WARN at publish; they no longer block it. The wording matters — an
  // admin who reads "BLOCKS PUBLISH" and then publishes successfully learns to
  // distrust the worklist, and a checklist that overstates its own severity is one
  // people stop reading.
  console.log(`\n[ALT]     ${needAlt.length} figure(s) need admin-written alt text  — warns at publish`);

  const blocked = stored.filter((q) => q.figureExpected && !q.diagramUrl);
  edits += blocked.length;
  console.log(`[FIGURE]  ${blocked.length} question(s) refer to a figure that is not attached — warns at publish`);
  if (blocked.length) {
    console.log(`          Q${blocked.map((q) => q.questionNumber).join(', Q')}`);
    console.log('          A student sees "in the figure below" with no figure — fix or accept knowingly.');
  }

  // Figures come out of the PDF's own image objects, so the FIGURE is exact — the
  // only thing left to check is whether it landed on the right question.
  console.log(`[FIGURES] ${withFigure.length} figure(s) attached; check each is on the RIGHT question (paste to replace)`);
  if (parsed.unassignedFigures?.length) {
    console.log(`          ${parsed.unassignedFigures.length} extracted figure(s) matched no question: #${parsed.unassignedFigures.join(', #')}`);
    console.log('          (decorative, or a question whose figure was missed — only review can tell)');
  }

  const noMarks = stored.filter((q) => !q.marks);
  edits += noMarks.length;
  if (noMarks.length) console.log(`[MARKS]   ${noMarks.length} question(s) carry no marks value -> fill in`);

  const choiceGroups = groupByChoice(stored).filter((g) => g.length > 1);
  console.log(`[CHOICE]  ${choiceGroups.length} internal-choice (OR) group(s) — verify each is a real pair`);

  const unassigned = bySection['(unassigned)']?.length || 0;
  if (unassigned) { edits += unassigned; console.log(`[SECTION] ${unassigned} question(s) with no section -> assign`); }

  console.log(`\nDiscrete edits (lower bound): ~${edits}`);
  console.log(`Rows to review in the UI    : ${stored.length}`);
  console.log('\nNEXT: correct this paper in Admin -> Past Papers, and record the');
  console.log('wall-clock minutes in PRODUCTION_CHECKLIST.md ("Measured correction time").');
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

  if (opts.remove) {
    const key = { board: opts.board, grade: opts.grade, subject: opts.subject, year: opts.year, title: opts.title };
    const paper = await PastPaper.findOne(key);
    if (!paper) { console.log('No such paper.'); await mongoose.disconnect(); return; }
    await PyqQuestion.deleteMany({ paperId: paper._id });
    if (cloudinaryConfigured) await deletePyqAssets(paper._id);
    await paper.deleteOne();
    console.log(`Deleted "${paper.title}" (${paper.year}) and its questions and assets.`);
    await mongoose.disconnect();
    return;
  }

  if (!opts.pdf || !fs.existsSync(opts.pdf)) usage(`PDF not found: ${opts.pdf || '(none given)'}`);
  if (!BOARDS.includes(opts.board)) usage(`--board must be one of: ${BOARDS.join(' | ')}`);
  if (!GRADES.includes(opts.grade)) usage('--grade invalid');
  if (!['Class 10', 'Class 12'].includes(opts.grade)) usage('Only Class 10 and Class 12 have board exams, so only they have past papers.');
  if (!SUBJECTS.includes(opts.subject)) usage(`--subject must be one of: ${SUBJECTS.join(' | ')}`);
  if (!Number.isInteger(opts.year)) usage('--year must be a year');
  if (!opts.title) usage('--title is required (a board can publish several sets per subject-year)');
  // Reject a non-integer rather than letting Number() turn it into NaN, which
  // silently disables the count check at exactly the moment it would have caught
  // the argument slip that produced it.
  if (opts.expectQuestionsRaw !== '' && !/^[0-9]+$/.test(opts.expectQuestionsRaw)) {
    usage('--expect-questions must be a whole number, got "' + opts.expectQuestionsRaw + '"');
  }
  opts.expectQuestions = opts.expectQuestionsRaw === '' ? 0 : Number(opts.expectQuestionsRaw);
  if (!cloudinaryConfigured) usage('Cloudinary is not configured — the source PDF and page images cannot be stored.');

  const buffer = fs.readFileSync(opts.pdf);
  if (!isPdfBuffer(buffer)) usage(`Not a PDF (magic bytes): ${opts.pdf}`);

  const key = { board: opts.board, grade: opts.grade, subject: opts.subject, year: opts.year, title: opts.title };
  const existing = await PastPaper.findOne(key);

  // ── --replace MUST NOT SILENTLY CREATE ────────────────────────────────────
  // It used to fall through to a plain insert when nothing matched the key, which
  // makes a DESTRUCTIVE-INTENT flag quietly do a CREATIVE action. That is dangerous
  // in its own right, and it bit: one mistyped title turned "replace the English
  // paper" into "import a second paper called '11 SQP 2025-26'", costing an import
  // and leaving a junk row that had to be found and deleted by hand.
  //
  // The operator asked to replace something. If there is nothing to replace, the
  // command they wrote does not describe what would happen, so it stops — and lists
  // the near-misses, because a wrong title is the likeliest cause and guessing which
  // one they meant would be the same class of error.
  //
  // This matters more than usual here: the database holds a RESERVED FIXTURE that
  // must not be disturbed, and "replace" silently meaning "create" is exactly how a
  // reserved row gets shadowed by a near-duplicate.
  if (opts.replace && !existing) {
    const near = await PastPaper.find({ board: opts.board, grade: opts.grade, subject: opts.subject })
      .select('title year').lean();
    console.error(`\n--replace was given, but no paper matches:\n  ${opts.board} / ${opts.grade} / ${opts.subject} / ${opts.year} / "${opts.title}"`);
    console.error('\nRefusing to create a new paper from a --replace. Drop --replace to import it as new.');
    if (near.length) {
      console.error('\nExisting papers for that board/grade/subject:');
      near.forEach((p) => console.error(`  ${p.year}  "${p.title}"`));
    }
    console.error('');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (existing && !opts.replace) {
    console.error(`\nThat paper already exists (status: ${existing.parseStatus}). Pass --replace to re-import it.\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── PARSE FIRST, SWAP LAST ────────────────────────────────────────────────
  // --replace used to delete the existing paper HERE, before parsing. That made a
  // provider outage destructive: the Class 12 Physics re-import hit OpenAI 429 on every
  // page with both fallbacks unavailable, and because the old rows were already gone,
  // a paper that had 42 usable questions ended the run with none and nothing to roll
  // back to. The flag's job is to replace content, not to widen its blast radius when
  // the network is down.
  //
  // So the new paper is parsed alongside the old one, and the old one is deleted only
  // once there is something to put in its place. The two coexist for the length of the
  // parse; that is safe because the new paper is `parsing` until the very last step and
  // students only ever see `published`.
  // There is a UNIQUE INDEX on {board, grade, subject, year, title}, so the old and new
  // papers cannot both hold the real title while the parse runs — creating the second
  // one fails E11000 before a single page is read. (Found by testing the rollback rather
  // than reasoning about it; the first version of this fix was broken for that reason.)
  //
  // So the new paper parses under a TEMPORARY title and takes the real one only after
  // the old row is gone. The suffix is deliberately one that `isFixtureTitle()` matches:
  // if a run is killed at the wrong moment, the leftover row is publish-blocked by the
  // guard that already exists, rather than being a plausible-looking half-paper.
  const IMPORT_SUFFIX = ' — IMPORTING DO NOT USE';
  const workingTitle = existing ? `${opts.title}${IMPORT_SUFFIX}` : opts.title;

  if (existing) {
    console.log(`Replacing "${existing.title}" — the existing paper is kept until the new parse succeeds.`);
    // A previous kill could have left one of these behind; it is never real content.
    const stale = await PastPaper.find({ ...key, title: workingTitle });
    for (const s of stale) {
      await PyqQuestion.deleteMany({ paperId: s._id });
      await deletePyqAssets(s._id).catch(() => {});
      await s.deleteOne();
      console.log(`  (cleared a leftover in-progress row from an earlier interrupted run)`);
    }
  }

  const paper = await PastPaper.create({ ...key, title: workingTitle, parseStatus: 'parsing', uploadedBy: 'cli' });
  console.log(`\nImporting ${path.basename(opts.pdf)} -> ${opts.board} ${opts.grade} ${opts.subject} ${opts.year}`);
  console.log('One vision call per page; a 15-page paper takes a couple of minutes.\n');

  const t0 = Date.now();
  try {
    // Original first, so a parse failure still leaves a re-parseable paper.
    const pdfAsset = await uploadPastPaperPdf(buffer, paper._id);
    const parsed = await parsePastPaper(buffer);

    const pageAssets = {};
    for (const page of parsed.pages) {
      const asset = await uploadPyqPageImage(page.png, paper._id, page.pageNumber);
      pageAssets[page.pageNumber] = { ...asset, width: page.width, height: page.height };
    }

    // Each extracted figure becomes its own asset — exact bounds from the PDF, no crop.
    const figureAssets = {};
    for (const fig of parsed.figures || []) {
      figureAssets[fig.figureIndex] = await uploadPyqFigure(fig.png, paper._id, fig.figureIndex);
    }

    const docs = parsed.questions.map((q) => toPyqDocument(q, {
      paper, board: opts.board, year: opts.year, pageAssets, figureAssets
    }));
    await PyqQuestion.insertMany(docs);

    // The parse produced questions, so the old paper is now safe to drop. Last
    // destructive act, not the first.
    if (existing) {
      await PyqQuestion.deleteMany({ paperId: existing._id });
      await deletePyqAssets(existing._id);
      await existing.deleteOne();
      console.log(`Replaced the previous paper (${existing._id}) — new parse succeeded first.`);
    }

    Object.assign(paper, {
      // The real title is claimed only now, once the row that held it is gone.
      title: opts.title,
      sourcePdfUrl: pdfAsset.url || '',
      sourcePdfPublicId: pdfAsset.publicId || '',
      pageCount: parsed.pageCount,
      sections: parsed.sections,
      durationMinutes: parsed.durationMinutes,
      totalMarks: parsed.totalMarks,
      parsedByFallback: parsed.usedFallback,
      parsedWithModel: parsed.parsedWithModel,
      pageTrust: parsed.pageTrust || [],
      parseStatus: 'draft'
    });
    await paper.save();

    console.log(`Imported as a DRAFT in ${Math.round((Date.now() - t0) / 1000)}s.`);
    console.log(`  paper id   : ${paper._id}`);
    console.log(`  model      : ${parsed.parsedWithModel}`);
    if (parsed.usedFallback) {
      console.log('  *** PARSED BY THE GROQ TEXT-ONLY FALLBACK — structure is much more');
      console.log('      likely to be wrong. Prefer --replace once OpenAI is reachable. ***');
    }
    if (parsed.failedPages.length) console.log(`  failed pages: ${JSON.stringify(parsed.failedPages)}`);
    if (parsed.truncated) console.log('  *** paper was truncated at the page cap ***');

    const stored = await PyqQuestion.find({ paperId: paper._id }).lean();
    printWorklist(stored, parsed, opts.expectQuestions);
  } catch (err) {
    const stage = String(err.message || '').split(':')[0];
    console.error(`\nIMPORT FAILED [${stage}]: ${err.message}`);

    if (existing) {
      // A --replace that failed must leave NO trace: the previous paper is still the
      // real one, and a half-parsed duplicate sharing its board/grade/subject/year/title
      // would make the next --replace ambiguous about which row it is replacing.
      await PyqQuestion.deleteMany({ paperId: paper._id }).catch(() => {});
      await deletePyqAssets(paper._id).catch(() => {});
      await paper.deleteOne().catch(() => {});
      console.error(`The PREVIOUS paper is intact (id ${existing._id}, ${existing.parseStatus}) — nothing was replaced.`);
      console.error('The failed attempt was rolled back. Re-run when the cause is cleared.');
    } else {
      // A first-time import has nothing to preserve, so the partial record is KEPT
      // deliberately: it carries the uploaded PDF and the named failure stage, so a
      // retry does not need a re-upload and the admin can see which stage died.
      paper.parseStatus = 'failed';
      paper.parseError = stage;
      await paper.save().catch(() => {});
      console.error(`The paper record and its source PDF are kept (id ${paper._id}) so a re-parse does not need a re-upload.`);
    }

    await mongoose.disconnect();
    process.exit(1);
  }

  await mongoose.disconnect();
}

run().catch((e) => { console.error('IMPORT ERROR:', e); process.exit(1); });
