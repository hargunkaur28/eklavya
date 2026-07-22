// Migration: grandfather existing flat English/Science/Social Science roadmaps
// (and their diagnostic results) into the new sub-subject taxonomy as the
// Fusion/Combined equivalent (Phase B.3 Option A). An old flat "English" roadmap
// already spanned writing+grammar+reading = Fusion; "Science"/"Social Science" =
// Combined.
//
// SAFETY CONTRACT (matches the established bar):
//   • Non-destructive — ONLY sets `subSubject` on docs that lack it; touches nothing else.
//   • Idempotent — skips any doc that already has a non-empty `subSubject`.
//   • Dry-run by DEFAULT — writes nothing unless `--apply` is passed.
//   • Reversible — `--apply` records every modified _id to a log file; `--rollback`
//     reads that log and $unsets `subSubject` on exactly those docs (never touches
//     docs created after the migration).
//
// Scope: Roadmap + DiagnosticResult only (the PERSISTENT course-identity + review
// docs). DiagnosticSession/PracticeSession are 24h-TTL ephemeral — deliberately
// excluded; they self-expire and the app handles empty `subSubject` fine.
//
// Usage:
//   node src/scripts/backfill-subsubject.js            # dry-run (default, no writes)
//   node src/scripts/backfill-subsubject.js --apply     # perform the migration + write log
//   node src/scripts/backfill-subsubject.js --rollback  # revert using the log
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Roadmap from '../models/Roadmap.js';
import DiagnosticResult from '../models/DiagnosticResult.js';
import { SUB_SUBJECTS, fusionSubSubjectFor, canonicalSubject, normalizeSubject } from '../config/taxonomy.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'backfill-subsubject.log.json');

const MODE = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--apply') ? 'apply'
  : 'dry-run';

// The subjects that split (canonical spellings from taxonomy).
const SPLIT_SUBJECTS = Object.keys(SUB_SUBJECTS); // ['English','Science','Social Science']

// A doc is a migration candidate if its subject is a split subject and it has no
// sub-subject yet. Case-robust on subject; empty-or-absent on subSubject.
function isCandidate(doc) {
  const known = SPLIT_SUBJECTS.some((s) => normalizeSubject(s) === normalizeSubject(doc.subject));
  const noSub = doc.subSubject === undefined || doc.subSubject === null || doc.subSubject === '';
  return known && noSub;
}

async function collect(Model) {
  // Fetch the empty/absent-subSubject docs whose subject is (case-insensitively) split.
  const rx = SPLIT_SUBJECTS.map((s) => new RegExp(`^${s}$`, 'i'));
  const docs = await Model.find({
    subject: { $in: rx },
    $or: [{ subSubject: { $exists: false } }, { subSubject: '' }, { subSubject: null }]
  }).select('_id subject subSubject');
  return docs.filter(isCandidate);
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\n=== backfill-subsubject : MODE=${MODE} ===`);

  if (MODE === 'rollback') {
    if (!fs.existsSync(LOG_PATH)) throw new Error(`No log at ${LOG_PATH} — nothing to roll back.`);
    const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    for (const [coll, Model] of [['roadmaps', Roadmap], ['diagnosticResults', DiagnosticResult]]) {
      const ids = (log[coll] || []).map((id) => new mongoose.Types.ObjectId(id));
      const res = ids.length
        ? await Model.updateMany({ _id: { $in: ids } }, { $unset: { subSubject: '' } })
        : { modifiedCount: 0 };
      console.log(`  ${coll}: rolled back ${res.modifiedCount}/${ids.length}`);
    }
    console.log('Rollback complete. (Log left in place; delete it manually if desired.)');
    await mongoose.disconnect();
    return;
  }

  const log = { generatedFor: 'apply', roadmaps: [], diagnosticResults: [] };
  const summary = {};

  for (const [coll, Model, logKey] of [
    ['Roadmap', Roadmap, 'roadmaps'],
    ['DiagnosticResult', DiagnosticResult, 'diagnosticResults']
  ]) {
    const candidates = await collect(Model);
    const perSubject = {};
    for (const d of candidates) {
      const target = fusionSubSubjectFor(d.subject); // English→Fusion, Science/SocSci→Combined
      const label = `${canonicalSubject(d.subject)} → ${target}`;
      perSubject[label] = (perSubject[label] || 0) + 1;
      if (MODE === 'apply') {
        await Model.updateOne({ _id: d._id }, { $set: { subSubject: target } });
        log[logKey].push(String(d._id));
      }
    }
    summary[coll] = { candidates: candidates.length, breakdown: perSubject };
  }

  console.log(MODE === 'dry-run' ? '\n[DRY-RUN — nothing written]' : '\n[APPLIED]');
  for (const [coll, s] of Object.entries(summary)) {
    console.log(`  ${coll}: ${s.candidates} candidate(s)`);
    for (const [label, n] of Object.entries(s.breakdown)) console.log(`      ${label}: ${n}`);
  }

  if (MODE === 'apply') {
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
    console.log(`\n  Modified-id log written to ${LOG_PATH} (needed for --rollback).`);
  } else {
    console.log('\n  Re-run with --apply to perform the migration.');
  }
  await mongoose.disconnect();
}

run().catch((e) => { console.error('MIGRATION ERROR:', e); process.exit(1); });
