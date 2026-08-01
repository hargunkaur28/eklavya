#!/usr/bin/env node
/**
 * Record and verify a content baseline for a past paper.
 *
 * Why this exists: the Science SQP is the timing fixture — the paper the human
 * correction-time measurement is taken against. That measurement is only comparable
 * across sessions if the paper itself has not moved. Up to now the claim "the fixture
 * is untouched" rested on nobody having run an import against it, which is an argument
 * about intent, not a check. This turns it into one.
 *
 * The hash covers the parsed CONTENT and nothing else: question text, marks, numbering,
 * structure, section names. It deliberately excludes _id, timestamps and __v, so that a
 * save which changes no content does not read as tampering — and, more importantly, so
 * that an edit which DOES change content cannot hide behind an unchanged __v.
 *
 *   node src/scripts/pyq-baseline.js --record --title "<paper title>"
 *   node src/scripts/pyq-baseline.js --verify            # checks every recorded baseline
 *
 * --record refuses to overwrite an existing baseline unless --force is passed. A
 * baseline you can silently rewrite is not a baseline.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(__dirname, '..', '..', 'pyq-baselines.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

// The fields that make a paper *the paper*. Order-independent within a question, but
// questions are sorted by a stable key first so that a differently-ordered fetch does
// not read as a content change.
function contentHash(paper, questions) {
  const rows = questions
    .map((q) => ({
      section: q.sectionName || '',
      number: q.questionNumber || '',
      type: q.questionType || '',
      marks: q.marks ?? null,
      text: (q.questionText || '').replace(/\s+/g, ' ').trim(),
      options: (q.options || []).map((o) => String(o).replace(/\s+/g, ' ').trim()),
      answer: (q.correctAnswer || '').replace(/\s+/g, ' ').trim(),
      parentKey: q.parentKey || '',
      isContainer: !!q.isContainer,
      partLabel: q.partLabel || '',
      choiceGroup: q.choiceGroup || '',
      choiceIndex: q.choiceIndex ?? null,
      source: q.source || '',
    }))
    .sort((a, b) => `${a.section}|${a.number}|${a.partLabel}|${a.text}`
      .localeCompare(`${b.section}|${b.number}|${b.partLabel}|${b.text}`));

  const body = JSON.stringify({
    title: paper.title,
    board: paper.board,
    grade: paper.grade,
    subject: paper.subject,
    year: paper.year,
    parseStatus: paper.parseStatus,
    sections: (paper.sections || []).map((s) => ({
      name: s.name, discipline: s.discipline || '', disciplinePrinted: !!s.disciplinePrinted,
    })),
    rowCount: rows.length,
    rows,
  });

  return crypto.createHash('sha256').update(body).digest('hex');
}

async function load() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('No MONGO_URI in env.'); process.exit(1); }
  await mongoose.connect(uri);
  const PastPaper = (await import('../models/PastPaper.js')).default;
  const PyqQuestion = (await import('../models/PyqQuestion.js')).default;
  return { PastPaper, PyqQuestion };
}

function readBaselines() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

async function snapshot(PastPaper, PyqQuestion, title) {
  const paper = await PastPaper.findOne({ title }).lean();
  if (!paper) return null;
  const questions = await PyqQuestion.find({ paperId: paper._id }).lean();
  return {
    hash: contentHash(paper, questions),
    rowCount: questions.length,
    parseStatus: paper.parseStatus,
    version: paper.__v,
  };
}

const { PastPaper, PyqQuestion } = await load();

if (has('--record')) {
  const title = val('--title');
  if (!title) { console.error('--record needs --title "<paper title>"'); process.exit(1); }

  const snap = await snapshot(PastPaper, PyqQuestion, title);
  if (!snap) { console.error(`No paper titled ${JSON.stringify(title)}.`); process.exit(1); }

  const baselines = readBaselines();
  if (baselines[title] && !has('--force')) {
    console.error(`A baseline for ${JSON.stringify(title)} already exists (${baselines[title].hash.slice(0, 12)}).`);
    console.error('Refusing to overwrite. Pass --force if the change is intended.');
    process.exit(1);
  }

  // __v is recorded alongside the hash but is NOT part of it: it says how many saves
  // the doc has seen, which is useful context when a hash mismatch turns up, and
  // useless as evidence on its own.
  baselines[title] = { ...snap, recordedAt: new Date().toISOString() };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baselines, null, 2)}\n`, 'utf8');

  console.log(`Recorded baseline for ${JSON.stringify(title)}`);
  console.log(`  content hash : ${snap.hash}`);
  console.log(`  rows         : ${snap.rowCount}`);
  console.log(`  parseStatus  : ${snap.parseStatus}`);
  console.log(`  __v at record: ${snap.version}`);
  console.log(`\nWritten to ${BASELINE_FILE}`);
} else if (has('--verify')) {
  const baselines = readBaselines();
  const titles = Object.keys(baselines);
  if (!titles.length) { console.log('No baselines recorded.'); await mongoose.disconnect(); process.exit(0); }

  let drift = 0;
  for (const title of titles) {
    const want = baselines[title];
    const snap = await snapshot(PastPaper, PyqQuestion, title);
    if (!snap) {
      console.log(`*** GONE ***  ${title}`);
      drift++;
    } else if (snap.hash !== want.hash) {
      console.log(`*** DRIFT *** ${title}`);
      console.log(`                expected ${want.hash.slice(0, 16)} (${want.rowCount} rows, __v ${want.version})`);
      console.log(`                     got ${snap.hash.slice(0, 16)} (${snap.rowCount} rows, __v ${snap.version})`);
      drift++;
    } else {
      const note = snap.version === want.version ? '' : ` (saved since: __v ${want.version} -> ${snap.version}, content identical)`;
      console.log(`UNCHANGED     ${title}${note}`);
    }
  }
  await mongoose.disconnect();
  process.exit(drift ? 1 : 0);
} else {
  console.log('Usage:');
  console.log('  node src/scripts/pyq-baseline.js --record --title "<paper title>" [--force]');
  console.log('  node src/scripts/pyq-baseline.js --verify');
}

await mongoose.disconnect();
