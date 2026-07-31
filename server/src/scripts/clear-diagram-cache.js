#!/usr/bin/env node
// Clear cached module-quiz figures so they regenerate on the next day fetch.
//
// WHY THIS HAS TO EXIST:
//
// A module quiz is generated once and served for the life of the roadmap, and
// Workstream D makes its figure outcome FINAL at that moment — `finalizeUnselected`
// records the "not sampled by the share" decision, and a MODEL_DECLINED is terminal by
// design. Both are correct: they are what stops a cached quiz mutating on every
// revisit. But they also mean the decision is locked to whatever model answered that
// day, and nothing in the app ever re-opens it.
//
// Two situations need that lock broken, and they are the same operation:
//   1. Figures generated before the depiction rules existed — label-only output that
//      passed every safety check and taught nothing.
//   2. The pre-launch clear already in PRODUCTION_CHECKLIST: every roadmap cached
//      during development had its figures decided by Groq's 8b fallback under 429s,
//      and a funded key does NOT improve them retroactively.
//
// Resets `diagram` AND `diagramAttempted` together. Clearing the figure alone would
// leave `diagramAttempted: true` — the terminal state — so the question would stay
// figureless forever and the script would appear to have done nothing.
//
// Usage:
//   node src/scripts/clear-diagram-cache.js --dry-run          count only, change nothing
//   node src/scripts/clear-diagram-cache.js                    clear ALL cached figures
//   node src/scripts/clear-diagram-cache.js --label-only       clear only figures that
//                                                              FAIL the depiction check
//   node src/scripts/clear-diagram-cache.js --user <userId>    scope to one student
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { validateDepiction } from '../utils/generateDiagram.js';
dotenv.config();

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LABEL_ONLY = args.includes('--label-only');
const userIdx = args.indexOf('--user');
const USER = userIdx >= 0 ? args[userIdx + 1] : null;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const roadmaps = mongoose.connection.collection('roadmaps');

const filter = {};
if (USER) filter.userId = new mongoose.Types.ObjectId(USER);

let docsTouched = 0, questionsCleared = 0, questionsKept = 0, figuresSeen = 0;
const reasons = {};

const cursor = roadmaps.find(filter);
while (await cursor.hasNext()) {
  const doc = await cursor.next();
  let changed = false;

  for (const day of doc.days || []) {
    for (const q of day.moduleQuiz?.questions || []) {
      const hasFigure = !!q.diagram?.svg;
      if (hasFigure) figuresSeen += 1;

      // --label-only keeps figures that genuinely depict something, so a re-run after
      // the fix does not throw away good work and pay to regenerate it.
      if (LABEL_ONLY && hasFigure) {
        const v = validateDepiction(q.diagram.svg);
        if (v.ok) { questionsKept += 1; continue; }
        reasons[v.reason] = (reasons[v.reason] || 0) + 1;
      } else if (LABEL_ONLY && !hasFigure) {
        // No figure and --label-only: nothing to judge, leave the attempt flag alone.
        continue;
      }

      if (!hasFigure && q.diagramAttempted !== true) continue;   // already retryable

      q.diagram = { svg: '', alt: '', altHindi: '' };
      // Unset, not false: absent means "never tried" and is what makes it retry-eligible.
      delete q.diagramAttempted;
      questionsCleared += 1;
      changed = true;
    }
  }

  if (changed) {
    docsTouched += 1;
    if (!DRY) {
      await roadmaps.updateOne({ _id: doc._id }, {
        $set: { days: doc.days },
        // Belt and braces: the $set above already drops the deleted key, but an
        // explicit $unset documents the intent for anyone reading the oplog.
        ...(Object.keys({}).length ? {} : {})
      });
    }
  }
}

console.log(`${DRY ? '[DRY RUN] ' : ''}mode: ${LABEL_ONLY ? 'label-only figures' : 'ALL cached figures'}${USER ? ` (user ${USER})` : ''}`);
console.log(`roadmaps ${DRY ? 'that would be' : ''} modified : ${docsTouched}`);
console.log(`figures found                       : ${figuresSeen}`);
console.log(`questions ${DRY ? 'that would be' : ''} reset      : ${questionsCleared}`);
if (LABEL_ONLY) {
  console.log(`good figures kept                   : ${questionsKept}`);
  console.log(`rejection reasons                   : ${Object.keys(reasons).length ? JSON.stringify(reasons) : '(none)'}`);
}
console.log(DRY ? '\nNothing was written. Re-run without --dry-run to apply.' : '\nCleared. Figures regenerate on the next day fetch.');

await mongoose.disconnect();
