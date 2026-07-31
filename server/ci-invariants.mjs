#!/usr/bin/env node
// Structural invariants that must hold regardless of what any single change does.
// Each one exists because it was violated in practice, and greppable only becomes
// enforced when something actually greps. Run in CI: `node ci-invariants.mjs`.
//
// Exits 1 on any violation.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { scannable } from './src/utils/sourceScan.js';

const ROOT = new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

// Scanning uses the SHARED helper (src/utils/sourceScan.js) rather than a local copy —
// writing this twice is exactly what produced a false positive in a second scanner.
const files = walk(ROOT).map((f) => {
  const raw = readFileSync(f, 'utf8');
  const { code, codeOnly } = scannable(raw);
  return { path: f, rel: relative(ROOT, f).split('\\').join('/'), src: code, codeOnly };
});

const failures = [];

function invariant(name, why, needle, allowedFiles) {
  const hits = files
    .filter((f) => f.src.includes(needle))
    .filter((f) => !allowedFiles.includes(f.rel));
  if (hits.length) {
    failures.push({ name, why, needle, hits: hits.map((h) => h.rel) });
    console.log(`*** FAIL ***  ${name}`);
    hits.forEach((h) => console.log(`                found "${needle}" in ${h.rel}`));
    console.log(`                ${why}`);
  } else {
    console.log(`PASS          ${name}`);
  }
}

// ── 1. Every Groq call goes through the shared client ───────────────────────
// Eight call sites once bypassed it, so none had the 70b -> 8b -> OpenAI fallback
// chain or the rate-limit circuit breaker. The Hindi translation fallback was one
// of them, which meant Hindi silently shipped as English on a single 429.
invariant(
  'Groq is only called via groqClient.js',
  'Add the call to utils/groqClient.js (callGroqChat) instead of fetching Groq directly.',
  'api.groq.com',
  ['utils/groqClient.js']
);

// ── 2. The Aadhaar envelope escape hatch is unused ─────────────────────────
// models/User.js excludes profile.aadhaarEncrypted from every read path; this option
// is the single documented way past that. It is only safe while provably unused.
// When the audited offline export tool is built (see PRODUCTION_CHECKLIST), add ONLY
// that script's path here — never a route.
invariant(
  'Aadhaar envelope escape hatch is unused',
  'includeAadhaarEnvelope must only appear in the audited offline export tool. See PRODUCTION_CHECKLIST "THE INTENDED READ PATH".',
  'includeAadhaarEnvelope',
  ['models/User.js']
);

// ── 3. No decrypt capability exists for Aadhaar ────────────────────────────
// Deliberate: a general-purpose decrypt helper means every future route is one
// import away from exposing plaintext Aadhaar.
invariant(
  'No Aadhaar decrypt function exists',
  'Aadhaar is write-only by design. A verification requirement is met by an audited offline export tool, not a decrypt helper.',
  'decryptAadhaar',
  []
);

// ── 4. Aadhaar plaintext is never logged ───────────────────────────────────
// Scan for log statements that reference an aadhaar-ish variable. Heuristic, but it
// catches the obvious regression (`console.log(aadhaarNumber)`).
// Scanned against codeOnly, so a string literal that merely mentions Aadhaar (a
// status line, an error message) is not a hit — only an actual identifier is.
const SAFE_AADHAAR_IDENTIFIERS = /^aadhaar(Last4|Masked|Consent|ConsentAt|Encrypted|Enabled|OnFile|Collection\w*|Crypto|Key\w*)$/i;
const logRe = /console\.(?:log|warn|error|info|debug)\s*\(([^;]*)\)/g;
const logHits = [];
for (const f of files) {
  for (const m of f.codeOnly.matchAll(logRe)) {
    const idents = (m[1].match(/\baadhaar\w*/gi) || []).filter((id) => !SAFE_AADHAAR_IDENTIFIERS.test(id));
    if (idents.length) logHits.push({ rel: f.rel, samples: idents.slice(0, 2) });
  }
}
if (logHits.length) {
  failures.push({ name: 'Aadhaar is never logged' });
  console.log('*** FAIL ***  Aadhaar is never logged');
  logHits.forEach((h) => console.log(`                ${h.rel}: ${h.samples.join(' | ')}`));
} else {
  console.log('PASS          Aadhaar is never logged');
}

// ── 5. req.body is never logged ────────────────────────────────────────────
// PATCH /profile-details carries a plaintext Aadhaar and reverse-geocode carries
// coordinates, so ANY body logging leaks PII into the log stream.
const bodyLogRe = /console\.(log|warn|error|info|debug)\s*\([^;]*req\.body/g;
const bodyHits = files.filter((f) => { bodyLogRe.lastIndex = 0; return bodyLogRe.test(f.codeOnly); }).map((f) => f.rel);
if (bodyHits.length) {
  failures.push({ name: 'req.body is never logged' });
  console.log('*** FAIL ***  req.body is never logged');
  bodyHits.forEach((r) => console.log(`                ${r}`));
} else {
  console.log('PASS          req.body is never logged');
}

// ── 6. No latitude/longitude field on any schema ───────────────────────────
// The privacy guarantee is structural: coordinates have nowhere to be written.
const coordFieldRe = /(latitude|longitude|\blat\b|\blng\b|\blon\b)\s*:\s*\{\s*type\s*:/i;
const coordHits = files.filter((f) => f.rel.startsWith('models/') && coordFieldRe.test(f.src)).map((f) => f.rel);
if (coordHits.length) {
  failures.push({ name: 'No coordinate field on any model' });
  console.log('*** FAIL ***  No coordinate field on any model');
  coordHits.forEach((r) => console.log(`                ${r}`));
} else {
  console.log('PASS          No coordinate field on any model');
}



// ── 7. Client/server taxonomy mirrors must not drift ───────────────────────
// The repo is not a monorepo, so the taxonomy is duplicated. The comment in both
// files says "a drift test guards it" — this is that test. Without it, a subject
// added server-side silently never appears in the picker, and DIAGRAM_ELIGIBLE_SUBJECTS
// diverging means practice mode gates figures differently from what the UI implies.
{
  const srv = await import('./src/config/taxonomy.js');
  const cli = await import('../client/src/data/taxonomy.js');
  const mirrored = ['SUBJECTS', 'GRADES', 'SUB_SUBJECTS', 'FUSION_SUBSUBJECT', 'DIAGRAM_ELIGIBLE_SUBJECTS'];
  const drifted = mirrored.filter((k) => JSON.stringify(srv[k]) !== JSON.stringify(cli[k]));
  if (drifted.length) {
    failures.push({ name: 'taxonomy mirrors in sync' });
    console.log('*** FAIL ***  taxonomy mirrors in sync');
    drifted.forEach((k) => console.log(`                ${k} differs between server/src/config/taxonomy.js and client/src/data/taxonomy.js`));
  } else {
    console.log(`PASS          taxonomy mirrors in sync (${mirrored.length} exports)`);
  }
}


// ── 8. Rebuild allow-lists must cover their schema ─────────────────────────
// canonicalizeSubtopics() reconstructs each module-quiz question from an explicit
// field list. Building explicit objects is correct (the inputs are Mongoose subdocs
// and must not be spread) but the list has to grow with the schema, and it already
// failed to once: it omitted the Hindi translation and TTS audio fields, and because
// the LAZY MIGRATION path runs the same function over ALREADY-CACHED questions, one
// English quiz fetch silently wiped that day’s translations and audio URLs. A Hindi
// student re-paid for translation and TTS and nothing surfaced it.
//
// This drives the REAL function with a fully-populated question rather than
// comparing two hand-written lists, so it cannot pass by having the test and the code
// agree on the same omission. Any field added to moduleQuizQuestionSchema and not to
// the rebuild now fails the build, by name.
{
  const { canonicalizeSubtopics } = await import('./src/routes/roadmap.js');
  const Roadmap = (await import('./src/models/Roadmap.js')).default;
  const qSchema = Roadmap.schema.path('days').schema.path('moduleQuiz.questions').schema;

  const topLevel = [...new Set(Object.keys(qSchema.paths).map((k) => k.split('.')[0]))]
    .filter((k) => !k.startsWith('_'));

  // Populate EVERY field with something truthy — a conditionally-carried field
  // (`...(q.diagram?.svg ? {...} : {})`) is only observable when its source is set.
  const probe = { type: 'mcq' };
  for (const f of topLevel) {
    const t = qSchema.paths[f]?.instance || (f === 'diagram' ? 'Embedded' : '');
    if (f === 'diagram') probe.diagram = { svg: '<svg/>', alt: 'a', altHindi: 'b' };
    else if (t === 'Array') probe[f] = ['x'];
    else if (t === 'Boolean') probe[f] = true;
    else if (t === 'Number') probe[f] = 1;
    else probe[f] = 'x';
  }
  probe.options = ['a', 'b', 'c', 'd'];
  probe.correctIndex = 0;
  probe.type = 'mcq';

  const { questions: [rebuilt] } = canonicalizeSubtopics(['Some Topic'], [probe]);
  const dropped = topLevel.filter((f) => rebuilt[f] === undefined);

  if (dropped.length) {
    failures.push({ name: 'canonicalizeSubtopics carries every schema field' });
    console.log('*** FAIL ***  canonicalizeSubtopics carries every schema field');
    dropped.forEach((f) => console.log(`                DROPPED: ${f} — add it to the rebuild in src/routes/roadmap.js`));
    console.log('                Silent data loss: the lazy-migration path runs this over cached questions.');
  } else {
    console.log(`PASS          canonicalizeSubtopics carries every schema field (${topLevel.length} fields)`);
  }
}

// ── 9. One subject-level diagram gate, and it lives in the taxonomy ────────
// `subjectDiagramEligible()` belongs to src/config/taxonomy.js: it is mirrored to the
// client and drift-guarded by invariant 7. A second, blueprint-derived copy was
// written in utils/generateDiagram.js during Workstream D and wired into practice
// mode. It looked more principled ("derive it from the chapters") and was wrong — the
// blueprint only covers the exam grades, so it returned false for 135 of 280 course
// identities and would have silently disabled figures for Class 6 Maths practice.
// Two gates answering one question is the parallel taxonomy the project rules forbid.
{
  // `codeOnly` has comments AND string literals stripped, so a doc comment that merely
  // NAMES the function (there is one in generateDiagram.js explaining why the second
  // copy was removed) cannot trip this.
  const offenders = files.filter((f) =>
    f.rel !== 'config/taxonomy.js'          // rel is relative to src/
    && /(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+subjectDiagramEligible/.test(f.codeOnly));
  if (offenders.length) {
    failures.push({ name: 'subjectDiagramEligible defined only in taxonomy.js' });
    console.log('*** FAIL ***  subjectDiagramEligible defined only in taxonomy.js');
    offenders.forEach((f) => console.log(`                second definition in ${f.rel}`));
  } else {
    console.log('PASS          subjectDiagramEligible defined only in taxonomy.js');
  }
}

// ── 10. Audio playback is centralised in narrationController.js ───────────
// Narration used to be owned per-component, which is why it outlived the page that
// started it: `window.speechSynthesis` is a browser singleton that no component
// unmounts, and an HTMLAudioElement keeps playing after the component that made it is
// gone. With two owners (SpeakerButton and ChatWidget) there was no single place that
// could stop "whatever is speaking", so a route change could not fix it centrally.
//
// A THIRD owner would silently reintroduce the overlap, and it would look completely
// reasonable at the call site — which is exactly why this is a build failure and not a
// convention. `.jsx` is included in the walk: the client is where the bug lived.
{
  const CLIENT = new URL('../client/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const walkClient = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walkClient(full, out);
      else if (/\.(js|jsx)$/.test(entry)) out.push(full);
    }
    return out;
  };

  // `new Audio(` is allowed in audioPriming.js because that module exists to hold the
  // ONE shared element — browsers block play() on an element created after an await,
  // so a single pre-unlocked element is a hard requirement of the autoplay policy.
  // The controller plays THROUGH it; it does not construct its own.
  const rules = [
    { needle: 'new Audio(', allow: ['utils/audioPriming.js'], why: 'a second audio element is a second thing that can play over the first' },
    { needle: 'speechSynthesis.speak(', allow: ['utils/narrationController.js'], why: 'speechSynthesis is a global singleton; a second caller cannot be stopped by the first' }
  ];

  let audioViolations = 0;
  for (const { needle, allow, why } of rules) {
    const hits = walkClient(CLIENT)
      .map((f) => ({ rel: relative(CLIENT, f).split('\\').join('/'), code: scannable(readFileSync(f, 'utf8')).codeOnly }))
      .filter((f) => f.code.includes(needle))
      .filter((f) => !allow.includes(f.rel));
    if (hits.length) {
      audioViolations += hits.length;
      console.log(`*** FAIL ***  ${needle} appears only in ${allow.join(', ')}`);
      hits.forEach((h) => console.log(`                found in client/src/${h.rel}`));
      console.log(`                ${why}`);
    }
  }
  if (audioViolations) failures.push({ name: 'audio playback centralised' });
  else console.log('PASS          audio playback centralised in narrationController.js');
}
console.log('');
if (failures.length) {
  console.log(`${failures.length} invariant(s) violated.`);
  process.exit(1);
}
console.log('All structural invariants hold.');
