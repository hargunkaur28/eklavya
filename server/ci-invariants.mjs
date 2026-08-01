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
  // BOARDS/BOARD_CODES joined this list in Workstream H. The board list was
  // previously server-only (validateProfile.js) and reached the client over
  // /auth/profile-config, so it could not drift. It is mirrored now because the PYQ
  // UI needs board codes at render time without a round-trip — which reintroduces
  // exactly the drift risk this test exists for.
  const mirrored = ['SUBJECTS', 'GRADES', 'BOARDS', 'BOARD_CODES', 'SUB_SUBJECTS', 'FUSION_SUBSUBJECT', 'DIAGRAM_ELIGIBLE_SUBJECTS'];
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
// ── 11. Only the paper-import pipeline may write source: 'pyq' ─────────────
// Workstream I0. A question is either extracted from a real uploaded paper or it is
// AI-generated, and a student cannot tell the difference by looking — which is
// exactly why the difference has to be structural rather than a convention someone
// remembers. `source: 'pyq'` is a CLAIM OF PROVENANCE: it says this text appeared on
// a real board paper in a real year. Only the code that read that paper is in a
// position to make it.
//
// The realistic regression is not malice, it is convenience: a seed script, a
// "backfill the missing source" migration, or a generated-exam path that copies a
// question object wholesale and carries the source with it. Each looks harmless in
// review and each silently mints counterfeit past papers.
//
// Scanned against `codeOnly`, so the model file's own documentation of the rule —
// and this comment — cannot trip it.
{
  const PYQ_WRITERS = [
    'utils/parsePastPaper.js',   // produces the parse
    'routes/pyqAdmin.js',        // persists the reviewed draft on publish
    'models/PyqQuestion.js'      // declares the enum
  ];
  // Any spelling of the literal: source: 'pyq', source:"pyq", { source: `pyq` }.
  const sourceWriteRe = /source\s*:\s*['"`]pyq['"`]/;
  const offenders = files.filter((f) => sourceWriteRe.test(f.codeOnly) && !PYQ_WRITERS.includes(f.rel));
  if (offenders.length) {
    failures.push({ name: "only the import pipeline writes source: 'pyq'" });
    console.log("*** FAIL ***  only the import pipeline writes source: 'pyq'");
    offenders.forEach((f) => console.log(`                found in ${f.rel}`));
    console.log('                A question may only claim to come from a real paper if it was read from one.');
    console.log('                See models/PyqQuestion.js — generated questions use source: \'generated\' and carry no year.');
  } else {
    console.log("PASS          only the import pipeline writes source: 'pyq'");
  }
}

// ── 12. A generated question can never be given a year ─────────────────────
// The other half of I0, and the one that actually produces the counterfeit: a
// generated question with a year renders as "CBSE 2023 · Q14" because that is what
// the label is built from. The model refuses it at validate-time; this refuses the
// code that would try, so the failure lands in CI rather than in a 500 in front of
// an admin.
//
// Structural check, not a string match: it drives the REAL schema. Any future field
// that ends up carrying a year onto a generated question fails here by name.
{
  const PyqQuestion = (await import('./src/models/PyqQuestion.js')).default;

  const cases = [
    ['a generated question with a year', { source: 'generated', questionText: 'q', year: 2023 }],
    ['a generated question with a board', { source: 'generated', questionText: 'q', board: 'CBSE' }],
    ['a question with NO source at all', { questionText: 'q' }]
  ];

  const accepted = [];
  for (const [label, doc] of cases) {
    const err = new PyqQuestion(doc).validateSync();
    // validateSync returns undefined when the doc is VALID — which for these three is
    // the failure we are testing for.
    if (!err) accepted.push(label);
  }

  // And the legitimate shape must still save, or the guard is just "nothing works".
  const validGenerated = new PyqQuestion({ source: 'generated', questionText: 'q' }).validateSync();
  if (validGenerated) accepted.push(`a plain generated question was REJECTED (${validGenerated.message})`);

  if (accepted.length) {
    failures.push({ name: 'generated questions cannot carry paper provenance' });
    console.log('*** FAIL ***  generated questions cannot carry paper provenance');
    accepted.forEach((c) => console.log(`                schema ACCEPTED: ${c}`));
  } else {
    console.log('PASS          generated questions cannot carry paper provenance (3 shapes refused)');
  }
}

// ── 13. PYQ modes have no roadmap side effects ─────────────────────────────
// Workstream I5/I6 require both PYQ modes to be isolated "exactly like Feature 11".
//
// The thing worth noticing about Feature 11's isolation is that it is not a helper
// anyone can import — routes/practice.js is isolated because it NEVER CALLS the
// roadmap, and that is all. Isolation-by-omission is invisible in review (there is
// nothing on the screen to notice) and one plausible-looking import undoes it: a
// contributor wiring "exam results should show up in weak topics" would be making an
// entirely reasonable-sounding change that silently lets a mock exam rewrite a
// student's study plan.
//
// So the omission is asserted here, by name, for both PYQ routers.
{
  const PYQ_ROUTERS = ['routes/pyq.js', 'routes/pyqAdmin.js'];
  const FORBIDDEN = [
    ['Roadmap', 'a PYQ session must never mark a roadmap day complete'],
    ['computeWeakTopics', 'a PYQ session must never feed roadmap weak-topic aggregation'],
    ['weakTopics', 'a PYQ session must never feed roadmap weak-topic aggregation']
  ];

  const violations = [];
  for (const rel of PYQ_ROUTERS) {
    const f = files.find((x) => x.rel === rel);
    if (!f) continue;
    // Import lines only: `recordStudyActivity` is legitimately shared, and the word
    // "roadmap" appears in this router's explanatory comments on purpose.
    const imports = f.codeOnly.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const [needle, why] of FORBIDDEN) {
      if (imports.includes(needle)) violations.push({ rel, needle, why });
    }
  }

  if (violations.length) {
    failures.push({ name: 'PYQ modes have no roadmap side effects' });
    console.log('*** FAIL ***  PYQ modes have no roadmap side effects');
    violations.forEach((v) => console.log(`                ${v.rel} imports ${v.needle} — ${v.why}`));
  } else {
    console.log('PASS          PYQ modes have no roadmap side effects (2 routers)');
  }
}

// ── 14. The PYQ import mapping must cover its schema ───────────────────────
// Same failure as invariant 8, in a second place, and it had already happened:
// `choiceGroup`/`choiceIndex` were added to PyqQuestion and to the parser, and the
// import mapping — an explicit field list — did not carry them. Nothing failed. The
// import would have succeeded and stored every "OR" alternative as an independent
// question, which is exactly the over-counting the choice modelling exists to
// prevent. A right parse and a wrong database, silently.
//
// Drives the REAL function with a fully-populated parsed question rather than
// comparing two hand-written lists, so it cannot pass by having the test and the
// code agree on the same omission.
{
  // These invariants deliberately do NOT load dotenv — a structural check that only
  // runs when CI has secrets is a check that quietly stops running. The side effect
  // is that importing the route chain pulls in utils/cloudinary.js, which logs
  // "Cloudinary: NOT configured" at module load.
  //
  // That line is TRUE of this process and FALSE of the application, and it has
  // already cost someone time — read in CI output it looks exactly like broken
  // credentials. Same defect as an empty list rendering as "nothing imported": a
  // message that states something untrue about the system. Silenced here, with the
  // reason stated, rather than left to alarm the next reader.
  const realLog = console.log;
  console.log = () => {};
  const { toPyqDocument } = await import('./src/routes/pyqAdmin.js');
  const PyqQuestion = (await import('./src/models/PyqQuestion.js')).default;
  console.log = realLog;
  console.log('              (Cloudinary/env warnings above are suppressed — these checks run without secrets by design)');

  // Fields whose ABSENCE is meaningful and which must therefore NOT be initialised.
  // Listed explicitly, with the reason, rather than silently excluded — an
  // unexplained exemption list is how a real omission hides inside a passing test.
  const INTENTIONALLY_ABSENT = {
    // `hindiRegisterVersion` has no schema default on purpose: absent means
    // "translated before the register was versioned", which hindiIsStale() must be
    // able to tell apart from any version number. A freshly imported question has no
    // Hindi at all, so initialising it would assert a translation that never
    // happened. Absence must stay distinguishable from a verdict.
    hindiRegisterVersion: 'no default by design — absent means pre-versioning, see translateAndCache.hindiIsStale'
  };

  const schemaFields = Object.keys(PyqQuestion.schema.paths)
    .map((k) => k.split('.')[0])
    .filter((k) => !k.startsWith('_') && k !== 'createdAt')
    .filter((k) => !(k in INTENTIONALLY_ABSENT));

  // A parsed question with EVERY field the parser can produce set to something
  // truthy — a conditionally-carried field is only observable when its source is set.
  const parsed = {
    sectionName: 'Section A', questionNumber: '31', marks: 5,
    questionText: 'text', options: ['a', 'b'], correctIndex: 0, correctAnswer: 'ans',
    choiceGroup: 'Section A|31', choiceIndex: 1,
    figureExpected: true, figureIndex: 7, pageNumber: 2
  };
  const doc = toPyqDocument(parsed, {
    paper: { _id: 'pid' }, board: 'CBSE', year: 2023,
    pageAssets: { 2: { url: 'https://cdn/page-2.png', publicId: 'eklavya/pyq/pid/page-2' } },
    figureAssets: { 7: { url: 'https://cdn/figure-7.png', publicId: 'eklavya/pyq/pid/figure-7' } }
  });

  const dropped = [...new Set(schemaFields)].filter((f) => doc[f] === undefined);
  if (dropped.length) {
    failures.push({ name: 'PYQ import mapping carries every schema field' });
    console.log('*** FAIL ***  PYQ import mapping carries every schema field');
    dropped.forEach((f) => console.log(`                DROPPED: ${f} — add it to toPyqDocument() in src/routes/pyqAdmin.js`));
    console.log('                A dropped field means a correct parse silently stored wrong.');
  } else {
    console.log(`PASS          PYQ import mapping carries every schema field (${new Set(schemaFields).size} fields)`);
  }

  // And the values that carry MEANING must survive, not merely be present. The
  // figure now arrives as an already-uploaded asset keyed by `figureIndex`, so this
  // also asserts the RIGHT figure was attached — index 7 must resolve to figure-7,
  // not to the page asset it used to be cropped from.
  const carried = doc.choiceGroup === parsed.choiceGroup
    && doc.choiceIndex === parsed.choiceIndex
    && doc.source === 'pyq'
    && doc.diagramUrl === 'https://cdn/figure-7.png'
    && doc.diagramPublicId === 'eklavya/pyq/pid/figure-7'
    && doc.sourcePageUrl === 'https://cdn/page-2.png';
  if (!carried) {
    failures.push({ name: 'PYQ import mapping preserves choice + provenance' });
    console.log('*** FAIL ***  PYQ import mapping preserves choice + provenance');
    console.log(`                choiceGroup=${doc.choiceGroup} choiceIndex=${doc.choiceIndex} source=${doc.source} publicId=${doc.diagramPublicId}`);
  } else {
    console.log('PASS          PYQ import mapping preserves choice + provenance');
  }
}

// ── 15. A paper titled as a fixture can never be published ─────────────────
// A "REVIEW TIMING FIXTURE" paper, year 2026, half-corrected, was published by
// accident and was reachable by every real student account until someone noticed.
// Publishing it took no override and produced no signal — it looked exactly like
// publishing real content.
//
// Drives the REAL schema rather than re-implementing the title rule, so the test
// cannot pass by agreeing with a bug. Also asserts the NEGATIVE case, because a
// guard that rejects everything would satisfy the positive one on its own: CBSE's
// own Sample Question Papers are legitimate corpus content and must still publish.
{
  const PastPaper = (await import('./src/models/PastPaper.js')).default;

  const mk = (title, parseStatus) => new PastPaper({
    board: 'CBSE', grade: 'Class 10', subject: 'Science', year: 2024,
    title, parseStatus, durationMinutes: 180, totalMarks: 80
  }).validateSync();

  const mustReject = [
    'Science (SQP 2025-26) — REVIEW TIMING FIXTURE',
    'Maths DO NOT USE',
    'Physics do-not-use',
    'Chemistry DUMMY paper'
  ];
  const wronglyAccepted = mustReject.filter((t) => !mk(t, 'published'));

  // The other direction: real papers, including official SAMPLE papers, must publish.
  const mustAccept = [
    'Science (SQP 2025-26)',
    'Mathematics (Standard) — Set 1',
    'Sample Question Paper — Science'
  ];
  const wronglyRejected = mustAccept.filter((t) => !!mk(t, 'published'));

  // And a fixture must still be storable as a DRAFT — that is how it gets reviewed.
  const draftBlocked = mk('REVIEW TIMING FIXTURE', 'draft') ? ['draft blocked'] : [];

  const problems = [
    ...wronglyAccepted.map((t) => `ACCEPTED as published: "${t}"`),
    ...wronglyRejected.map((t) => `REJECTED a real paper: "${t}"`),
    ...draftBlocked.map((t) => `a fixture cannot even be saved as a ${t}`)
  ];

  if (problems.length) {
    failures.push({ name: 'fixture papers cannot be published' });
    console.log('*** FAIL ***  fixture papers cannot be published');
    problems.forEach((p) => console.log(`                ${p}`));
  } else {
    console.log(`PASS          fixture papers cannot be published (${mustReject.length} refused, ${mustAccept.length} real titles still allowed)`);
  }
}

// ── 16. Sub-parts count as one question and their marks do not double ──────
// Built against three shapes seen on REAL papers, because they fail differently and
// one of them fails dangerously:
//   English Cl10   Q1 stimulus (10 marks) + parts I..VIII (1-2 marks each)
//   SocSci Cl10    17A / 17B, both required, no container
//   Physics Cl12   (I) / (II), both required — was being folded as an OR, which both
//                  under-counted marks AND would tell a student "attempt any one" on
//                  a compulsory question. That is a wrong rubric on a real paper.
// Driven through the REAL helpers so the test cannot agree with a bug in a copy.
{
  const { countQuestionUnits, availableMarks } = await import('./src/models/PyqQuestion.js');

  // English: one container worth 10, four parts worth 10 between them.
  const english = [
    { _id: 'e0', sectionName: 'A', questionNumber: '1', marks: 10, isContainer: true, parentKey: 'A|1' },
    { _id: 'e1', sectionName: 'A', questionNumber: 'I', marks: 1, parentKey: 'A|1' },
    { _id: 'e2', sectionName: 'A', questionNumber: 'II', marks: 1, parentKey: 'A|1' },
    { _id: 'e3', sectionName: 'A', questionNumber: 'III', marks: 4, parentKey: 'A|1' },
    { _id: 'e4', sectionName: 'A', questionNumber: 'IV', marks: 4, parentKey: 'A|1' }
  ];
  // Both-required siblings with no container (SocSci 17A/17B).
  const siblings = [
    { _id: 's1', sectionName: 'B', questionNumber: '17A', marks: 3, parentKey: 'B|17' },
    { _id: 's2', sectionName: 'B', questionNumber: '17B', marks: 2, parentKey: 'B|17' }
  ];
  // A GENUINE choice: one question, offered two ways, worth its marks once.
  const choice = [
    { _id: 'c1', sectionName: 'C', questionNumber: '31', marks: 5, choiceGroup: 'C|31', choiceIndex: 0 },
    { _id: 'c2', sectionName: 'C', questionNumber: '31', marks: 5, choiceGroup: 'C|31', choiceIndex: 1 }
  ];

  const checks = [
    ['a container plus its parts is ONE question', countQuestionUnits(english) === 1, countQuestionUnits(english)],
    ['the container does NOT double the marks', availableMarks(english) === 10, availableMarks(english)],
    ['both-required siblings are ONE question', countQuestionUnits(siblings) === 1, countQuestionUnits(siblings)],
    ['both-required siblings SUM their marks', availableMarks(siblings) === 5, availableMarks(siblings)],
    ['a genuine OR pair is ONE question', countQuestionUnits(choice) === 1, countQuestionUnits(choice)],
    ['a genuine OR pair counts its marks ONCE', availableMarks(choice) === 5, availableMarks(choice)],
    // The discrimination itself: same two rows, different relationship, different marks.
    ['sub-parts and an OR pair are scored DIFFERENTLY',
      availableMarks(siblings) === 5 && availableMarks([
        { _id: 'x1', marks: 3, choiceGroup: 'g', choiceIndex: 0 },
        { _id: 'x2', marks: 2, choiceGroup: 'g', choiceIndex: 1 }
      ]) === 3, 'siblings sum to 5, alternatives take max 3'],
    ['a whole paper reconciles', countQuestionUnits([...english, ...siblings, ...choice]) === 3
      && availableMarks([...english, ...siblings, ...choice]) === 20, 'units + marks']
  ];

  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    failures.push({ name: 'sub-parts count once and do not double marks' });
    console.log('*** FAIL ***  sub-parts count once and do not double marks');
    bad.forEach(([n, , got]) => console.log(`                ${n} — got ${got}`));
  } else {
    console.log(`PASS          sub-parts count once and do not double marks (${checks.length} shapes)`);
  }
}

// ── 17. A choice is only honoured when the paper PRINTED one ────────────────────
// The parser asks the model for `partsRelation` plus the printed words that justify
// it. This checks what the fold does with the answer — in particular that it refuses
// to act on a choice claim with no quoted evidence.
//
// The rule is asymmetric ON PURPOSE, and the asymmetry is the invariant:
//   • a real choice scored as all-required  -> the student answers both. Time lost.
//   • required parts scored as a choice     -> the student answers one, skips the
//     other, and loses marks on a compulsory question, with the app's encouragement.
// Only the second is unrecoverable, so every uncertain case falls to all-required
// and raises partsAmbiguous. Abstaining must stay cheap: an 'unclear' costs an admin
// one review, a wrong 'choose-one' costs a student marks silently.
{
  const { foldQuestions } = await import('./src/utils/parsePastPaper.js');
  const mk = (o) => ({ sectionName: 'A', questionNumber: '1', questionText: 't', marks: 5,
    options: [], correctAnswer: '', questionType: 'short', partOf: '', partLabel: '',
    isContainer: false, partsRelation: '', partsRelationEvidence: '', ...o });
  const fam = (n, extra) => [
    mk({ questionNumber: n, partOf: n, partLabel: 'i', ...extra }),
    mk({ questionNumber: n, partOf: n, partLabel: 'ii', ...extra })
  ];

  const cited   = foldQuestions(fam('18', { partsRelation: 'choose-one', partsRelationEvidence: 'OR' }));
  const uncited = foldQuestions(fam('18', { partsRelation: 'choose-one' }));
  const unclear = foldQuestions(fam('9',  { partsRelation: 'unclear' }));
  const plain   = foldQuestions(fam('3',  { partsRelation: 'all-required' }));
  const split   = foldQuestions([
    ...fam('7', { partsRelation: 'choose-one', partsRelationEvidence: 'OR' }),
    mk({ questionNumber: '7', partOf: '7', partLabel: 'iii', partsRelation: 'all-required' })
  ]);
  const withStimulus = foldQuestions([
    mk({ questionNumber: '2', isContainer: true, partsRelation: 'choose-one', partsRelationEvidence: 'OR' }),
    ...fam('2', { partsRelation: 'choose-one', partsRelationEvidence: 'OR' })
  ]);

  const checks = [
    ['a choice WITH printed evidence becomes a choice group', cited.every((q) => q.choiceGroup && !q.parentKey)],
    ['a choice with NO evidence is not acted on', uncited.every((q) => !q.choiceGroup)],
    ['an unevidenced choice is flagged for review', uncited.every((q) => q.partsAmbiguous)],
    ['unclear keeps the parts and does not split them', unclear.every((q) => q.parentKey && !q.choiceGroup)],
    ['unclear is flagged for review', unclear.every((q) => q.partsAmbiguous)],
    ['parts that disagree abstain rather than take a majority', split.every((q) => !q.choiceGroup && q.partsAmbiguous)],
    ['a clean all-required family is NOT flagged', plain.every((q) => !q.partsAmbiguous && !q.choiceGroup && q.parentKey)],
    ['a stimulus is never one of the alternatives',
      !withStimulus.find((q) => q.isContainer).choiceGroup &&
      withStimulus.filter((q) => q.choiceGroup).length === 2],
    // The whole point: uncertainty must never cost the student marks.
    ['every uncertain family scores as all-required',
      [...uncited, ...unclear, ...split].every((q) => q.partsRelation !== 'choose-one')],
    // REGRESSION: a pair folded by `choiceIndex` alone (no partOf, so no parentKey)
    // must still reach the evidence check. It did not, and because that is the
    // commonest multi-row shape, abstention was structurally impossible on every real
    // paper — three parses reported ZERO ambiguity and read as clean.
    ['a choiceIndex-folded pair is still evidence-checked and unfolded without it',
      (() => {
        const pair = foldQuestions([
          mk({ questionNumber: '31', choiceIndex: 0, partsRelation: 'choose-one' }),
          mk({ questionNumber: '31', choiceIndex: 1, partsRelation: 'choose-one' })
        ]);
        return pair.every((q) => !q.choiceGroup && q.partsAmbiguous && q.parentKey);
      })()],
    ['the same pair WITH evidence stays a choice group',
      (() => {
        const pair = foldQuestions([
          mk({ questionNumber: '31', choiceIndex: 0, partsRelation: 'choose-one', partsRelationEvidence: 'OR' }),
          mk({ questionNumber: '31', choiceIndex: 1, partsRelation: 'choose-one', partsRelationEvidence: 'OR' })
        ]);
        return pair.every((q) => q.choiceGroup && !q.partsAmbiguous);
      })()]
  ];

  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    failures.push({ name: 'a choice is only honoured when the paper printed one' });
    console.log('*** FAIL ***  a choice is only honoured when the paper printed one');
    bad.forEach(([n]) => console.log(`                ${n}`));
  } else {
    console.log(`PASS          a choice is only honoured when the paper printed one (${checks.length} rules)`);
  }
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} invariant(s) violated.`);
  process.exit(1);
}
console.log('All structural invariants hold.');
