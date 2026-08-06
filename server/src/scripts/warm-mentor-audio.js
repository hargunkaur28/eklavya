#!/usr/bin/env node
// Feature 27 — fill the mentor's speech cache, once, offline.
//
// WHY THIS EXISTS AS A SCRIPT RATHER THAN HAPPENING LAZILY:
//
// Lazily is how it would work by default, and it would work — the first child to reach
// each line pays for it and everyone after replays it free. But "the first child" is a
// real five-year-old sitting in front of a screen waiting several seconds for a
// provider round-trip, at the exact moment the feature is trying to convince them that
// something here talks to them. Warming turns a per-child latency into a one-time,
// known, auditable cost incurred by an operator.
//
// RUN IT ONCE, AND RUN IT LAST.
//
// Every edit to a line changes its content hash and therefore its cache entry. Warming
// before the wording is settled means paying for sentences that are about to be
// replaced — warming twice is paying twice. The content hash makes a LATE wording
// change cheap (only that line re-synthesises); it does not make an EARLY warm free.
//
//   node src/scripts/warm-mentor-audio.js --dry-run    (default: costs nothing)
//   node src/scripts/warm-mentor-audio.js --apply
//
// Dry-run by default, like every other script in this repo that spends something.

import dotenv from 'dotenv';
import { MENTOR_SCRIPT, MENTOR_LINE_IDS, MENTOR_LANGUAGES } from '../config/mentorScript.js';
import {
  synthesizeSpeech, generateContentHash, audioFileExists, saveAudioFile
} from '../utils/textToSpeech.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const filenameFor = (lineId, lang, text) =>
  `mentor-${lineId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${lang}-${generateContentHash(text)}.wav`;

const jobs = [];
for (const lineId of MENTOR_LINE_IDS) {
  for (const lang of MENTOR_LANGUAGES) {
    const text = MENTOR_SCRIPT[lineId][lang];
    const filename = filenameFor(lineId, lang, text);
    jobs.push({ lineId, lang, text, filename, cached: audioFileExists(filename) });
  }
}

const todo = jobs.filter((j) => !j.cached);
const already = jobs.length - todo.length;

console.log(`Mentor script: ${MENTOR_LINE_IDS.length} lines x ${MENTOR_LANGUAGES.length} languages = ${jobs.length} clips.`);
console.log(`Already cached: ${already}.  To synthesise: ${todo.length}.`);
console.log('');

if (!APPLY) {
  // The point of the dry run is the NUMBER. It is the thing to approve before spending
  // anything, and it is the thing that should be surprising if the script table has
  // grown without anyone noticing.
  console.log(`DRY RUN — nothing synthesised, nothing spent. ${todo.length} TTS call(s) would be made.`);
  if (todo.length) {
    console.log('');
    todo.slice(0, 8).forEach((j) => console.log(`  ${j.lang}  ${j.lineId}`));
    if (todo.length > 8) console.log(`  … and ${todo.length - 8} more`);
  }
  console.log('');
  console.log('Re-run with --apply to synthesise. Do this ONCE, after the wording is final:');
  console.log('every edit to a line invalidates that line and warming twice pays twice.');
  process.exit(0);
}

let made = 0;
let failed = 0;

for (const job of todo) {
  const targetLang = job.lang === 'hi' ? 'hi-IN' : 'en-IN';
  try {
    // The same lock key the /speak route uses, so a warm running while the app is live
    // cannot double-synthesise a line a child is requesting at that moment.
    const buf = await synthesizeSpeech(job.text, targetLang, `mentor:${job.lineId}:${job.lang}:${generateContentHash(job.text)}`);
    if (!buf) {
      // Not fatal. A line with no cached audio degrades to the client's Web Speech
      // voice at runtime — worse-sounding, but never silent, and re-running the warm
      // later will pick it up.
      failed++;
      console.log(`  SKIP  ${job.lang}  ${job.lineId}  (all TTS providers exhausted — will use Web Speech at runtime)`);
      continue;
    }
    saveAudioFile(job.filename, buf);
    made++;
    console.log(`  OK    ${job.lang}  ${job.lineId}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${job.lang}  ${job.lineId}  ${err.message}`);
  }
}

console.log('');
console.log(`Synthesised ${made}, failed/skipped ${failed}, already cached ${already}.`);
if (failed) console.log('Re-run to retry the failures; cached lines are skipped and cost nothing.');
process.exit(0);
