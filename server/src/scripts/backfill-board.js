// Workstream H — migrate accounts holding a board the platform no longer serves.
//
// The board list went from nine entries (CBSE, ICSE, HBSE, PSEB, UP, MSBSHSE, BSEB,
// RBSE, plus an 'Other' free-text escape) to the two we can actually teach and can
// actually supply past papers for: CBSE and Haryana Board (HBSE). Accounts created
// before that reduction may hold any of the removed values, or an arbitrary string
// typed into the 'Other' box.
//
// ── WHAT THIS DOES WITH THEM, AND WHY ───────────────────────────────────────
//
// The brief offered two options. This script takes the FIRST: empty the field and
// flag the account so the student is asked once on next login. The old value is
// preserved in `profile.legacyStudyMedium` — emptying is not deleting.
//
// Rejected alternative: leave the legacy value in place but non-selectable. It is
// the smaller change and it is wrong here, for one reason that only became true with
// Workstream I. The board is no longer a descriptive label on a profile; it is the
// KEY THE PAST-PAPER CORPUS IS QUERIED BY. An account left on 'ICSE' resolves to
// "no papers available" forever, on every subject, in every year, with no path out
// that the student would ever think to look for — the empty state is honest about
// the corpus and silent about the actual cause, which is their own stale profile.
// A one-time question is a few seconds; the alternative is a permanently degraded
// account that looks like a content gap.
//
// The guessing option was never on the table. ICSE is not CBSE, and a student
// silently re-boarded to CBSE would be shown CBSE papers as if they were theirs —
// the same conflation Workstream I0 forbids for AI-generated questions, arrived at
// from the other direction.
//
// Why NOT reset `onboardingCompleted`: that is the trap. It would push a student who
// completed onboarding months ago back through all five steps — age, father's name,
// school, city — to re-answer one question. `boardNeedsReselect` is a single
// targeted prompt, and it clears on dismiss as well as on choice, so it cannot wedge
// an account.
//
// SAFETY CONTRACT (matches backfill-subsubject.js / backfill-onboarding.js):
//   • Non-destructive — the old value is copied to legacyStudyMedium, never dropped.
//   • Idempotent — an account whose studyMedium is already served, or already empty,
//     is not a candidate; re-running --apply changes nothing.
//   • Dry-run by DEFAULT — writes nothing unless `--apply` is passed.
//   • Reversible — `--apply` logs every modified _id AND the value it moved, and
//     `--rollback` restores studyMedium from the log, clearing the flag.
//   • Reports BEFORE it changes anything — the per-board counts print in every mode,
//     including dry-run, which is the mode you are expected to run first.
//
// Usage:
//   node src/scripts/backfill-board.js             # dry-run (default, no writes)
//   node src/scripts/backfill-board.js --apply     # migrate + write log
//   node src/scripts/backfill-board.js --rollback  # restore from the log
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '../models/User.js';
import { BOARDS, isKnownBoard } from '../config/taxonomy.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'backfill-board.log.json');

const MODE = process.argv.includes('--rollback') ? 'rollback'
  : process.argv.includes('--apply') ? 'apply'
  : 'dry-run';

// A candidate is any account with a NON-EMPTY studyMedium that is not one of the two
// served boards. Derived from the taxonomy rather than a hardcoded removed-boards
// list, so a future reduction needs no edit here — and so this can never disagree
// with what the validator accepts, which is the bug a second list would reintroduce.
// Empty studyMedium is deliberately NOT a candidate: those accounts never answered
// (pre-onboarding backfill), and flagging them would ask a question the profile flow
// already asks.
function isCandidate(doc) {
  const medium = doc.profile?.studyMedium || '';
  return !!medium && !isKnownBoard(medium);
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\n=== backfill-board : MODE=${MODE} ===`);
  console.log(`    served boards: ${BOARDS.join(', ')}`);

  if (MODE === 'rollback') {
    if (!fs.existsSync(LOG_PATH)) throw new Error(`No log at ${LOG_PATH} — nothing to roll back.`);
    const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    let restored = 0;
    // Restored one-by-one because each account gets ITS OWN previous value back — a
    // single updateMany cannot do that, and writing one board to all of them is
    // precisely the guess this migration refused to make going forward.
    for (const entry of log.users || []) {
      const res = await User.updateOne(
        { _id: new mongoose.Types.ObjectId(entry.id) },
        {
          $set: { 'profile.studyMedium': entry.previousBoard },
          $unset: { 'profile.legacyStudyMedium': '', 'profile.boardNeedsReselect': '' }
        }
      );
      restored += res.modifiedCount;
    }
    console.log(`  users: restored ${restored}/${(log.users || []).length}`);
    console.log('Rollback complete. (Log left in place; delete it manually if desired.)');
    await mongoose.disconnect();
    return;
  }

  // `.lean()` — this is a read-and-count pass over every profiled account; full
  // Mongoose documents buy nothing and the writes below are explicit updateOnes.
  const docs = await User.find({
    'profile.studyMedium': { $exists: true, $ne: '' }
  }).select('_id email profile.studyMedium').lean();

  const candidates = docs.filter(isCandidate);

  // ── REPORT FIRST, ALWAYS ──────────────────────────────────────────────────
  // Printed before any write in every mode. The counts are the point of the
  // dry-run: they say how many students this actually disturbs, and a surprising
  // number here is the signal to stop and reconsider rather than to type --apply.
  const perBoard = {};
  for (const d of candidates) {
    const b = d.profile.studyMedium;
    perBoard[b] = (perBoard[b] || 0) + 1;
  }

  console.log(`\n  Accounts with a board set:      ${docs.length}`);
  console.log(`  Holding a REMOVED board:        ${candidates.length}`);
  if (candidates.length) {
    console.log('\n  Breakdown by removed value (before any change):');
    for (const [board, n] of Object.entries(perBoard).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(board).padEnd(28)} ${n}`);
    }
  }

  const log = { generatedFor: 'apply', generatedAt: new Date().toISOString(), users: [] };

  if (MODE === 'apply') {
    for (const d of candidates) {
      const previousBoard = d.profile.studyMedium;
      await User.updateOne({ _id: d._id }, {
        $set: {
          'profile.studyMedium': '',
          'profile.legacyStudyMedium': previousBoard,
          'profile.boardNeedsReselect': true
        }
      });
      // The log carries the previous value because rollback must restore each
      // account's OWN board. The email is deliberately absent — this file sits in
      // the repo tree and a list of addresses does not belong in it.
      log.users.push({ id: String(d._id), previousBoard });
    }
  }

  console.log(MODE === 'dry-run' ? '\n[DRY-RUN — nothing written]' : `\n[APPLIED — ${log.users.length} account(s) migrated]`);

  if (MODE === 'apply') {
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
    console.log(`  Modified-id log written to ${LOG_PATH} (needed for --rollback).`);
    console.log('  Migrated students keep their old answer in profile.legacyStudyMedium');
    console.log('  and are asked to re-pick once on next login.');
  } else {
    console.log('  Re-run with --apply to perform the migration.');
  }

  await mongoose.disconnect();
}

run().catch((e) => { console.error('MIGRATION ERROR:', e); process.exit(1); });
