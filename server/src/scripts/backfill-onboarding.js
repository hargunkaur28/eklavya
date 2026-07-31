// Workstream B — one-time backfill: mark students who existed BEFORE profile
// onboarding as already onboarded, so they are never thrown into the new flow.
//
// Matches the Feature 20 backfill convention: dry-run by default, --apply writes,
// --rollback reverts using the recorded id log, and every modified _id is logged.
//
//   node src/scripts/backfill-onboarding.js            # dry-run (default, no writes)
//   node src/scripts/backfill-onboarding.js --apply    # perform the backfill
//   node src/scripts/backfill-onboarding.js --rollback # revert using the log
//
// ── THE FILTER IS `$exists: false`, DELIBERATELY, AND MUST STAY THAT WAY ─────
//
// The tempting filter is `{ onboardingCompleted: { $ne: true } }`. TODAY the two
// select the same set, because no document has the field yet. AFTER LAUNCH they
// diverge, and the divergence is harmful:
//
//   A student signs up post-launch, gets `onboardingCompleted: false`, starts the
//   profile flow and abandons it halfway. Their field EXISTS and is `false`, so
//   `$ne: true` matches them — and a re-run of this script would mark them complete.
//   They would never be asked for a profile again, and their record would be
//   permanently missing the compulsory fields.
//
// `$exists: false` matches only documents written before the field was introduced,
// which is precisely the population this backfill is for. It is also what makes the
// script idempotent: after a successful --apply, every targeted document HAS the
// field, so a second run matches nothing.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'backfill-onboarding.log.json');

const MODE = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--apply') ? 'apply'
    : 'dry-run';

// Pre-existing students only: the field is ABSENT, not merely false.
const TARGET_FILTER = {
  onboardingCompleted: { $exists: false },
  // Never touch a parent/admin document — onboarding is student-only, and under
  // Option B a parent shares the student's document, so filtering on role keeps
  // the intent explicit even though the shared doc is a student's.
  role: { $ne: 'admin' }
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('FATAL: MONGODB_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${MODE.toUpperCase()}\n`);

  if (MODE === 'rollback') {
    if (!fs.existsSync(LOG_PATH)) {
      console.error(`No log at ${LOG_PATH} — nothing to roll back.`);
      process.exit(1);
    }
    const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    const ids = (log.modifiedIds || []).map((id) => new mongoose.Types.ObjectId(id));
    console.log(`Rolling back ${ids.length} document(s) recorded at ${log.appliedAt}...`);
    // Unset rather than set-to-false, restoring the exact pre-backfill state so a
    // subsequent --apply targets the same population again.
    const res = await User.updateMany(
      { _id: { $in: ids } },
      { $unset: { onboardingCompleted: '', onboardingCompletedAt: '' } }
    );
    console.log(`  Reverted ${res.modifiedCount} document(s).`);
    await mongoose.disconnect();
    return;
  }

  const targets = await User.find(TARGET_FILTER).select('_id name email createdAt').lean();
  console.log(`Students predating profile onboarding (field absent): ${targets.length}\n`);

  if (targets.length) {
    console.log('  First 10:');
    targets.slice(0, 10).forEach((u) => {
      console.log(`    ${u._id}  ${String(u.name || '').padEnd(22).slice(0, 22)}  ${u.email}`);
    });
    if (targets.length > 10) console.log(`    ... and ${targets.length - 10} more`);
  }

  // Report the population the WRONG filter would have hit, so the difference is
  // visible at run time rather than only in this comment.
  const wrongFilterCount = await User.countDocuments({ onboardingCompleted: { $ne: true }, role: { $ne: 'admin' } });
  if (wrongFilterCount !== targets.length) {
    console.log(
      `\n  NOTE: a \`$ne: true\` filter would match ${wrongFilterCount} document(s) — ` +
      `${wrongFilterCount - targets.length} more than this run.\n` +
      '        Those are post-launch students mid-onboarding; marking them complete\n' +
      '        would permanently skip their profile. This script does NOT touch them.'
    );
  }

  if (MODE === 'dry-run') {
    console.log('\nDRY RUN — no writes performed. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  const ids = targets.map((u) => u._id);
  const now = new Date();
  const res = await User.updateMany(
    { _id: { $in: ids } },
    { $set: { onboardingCompleted: true, onboardingCompletedAt: now } }
  );
  console.log(`\nApplied. Modified ${res.modifiedCount} document(s).`);

  fs.writeFileSync(LOG_PATH, JSON.stringify({
    appliedAt: now.toISOString(),
    filter: 'onboardingCompleted: { $exists: false }',
    matched: targets.length,
    modified: res.modifiedCount,
    modifiedIds: ids.map(String)
  }, null, 2));
  console.log(`  Modified-id log written to ${LOG_PATH} (needed for --rollback).`);

  const remaining = await User.countDocuments(TARGET_FILTER);
  console.log(`  Idempotency check — documents still matching the filter: ${remaining} (expect 0).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
