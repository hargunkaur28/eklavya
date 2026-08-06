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

// ── 18. MICROPHONE AUDIO HAS NO WRITE PATH ─────────────────────────────────
//
// STATE THE PROPERTY BEFORE THE EXPRESSION (Design Rule 18). Two sentences, and the
// second one is what makes this check non-trivial:
//
//   (i)  No value derived from an UPLOADED audio buffer ever reaches a persistence
//        call, and no multer instance in this server can spill a request body to disk.
//   (ii) Writes of SYNTHESISED audio to uploads/audio/ are CORRECT and must not be
//        caught. The TTS cache is the single biggest cost lever in Feature 27 — a check
//        that forbade it would be reverted within a week, and rightly.
//
// So this cannot be "no audio is ever written". Both kinds of audio are WAV bytes
// heading for the same directory through the same helper; nothing about the byte
// stream distinguishes them. The discriminator is PROVENANCE: where the buffer came
// from. `saveAudioFile(name, synthesizeSpeech(...))` is untainted and passes; the same
// call reached by `req.file.buffer` is a build failure. That is why 18b is a taint
// check and not a needle list — a needle list would have to allow `saveAudioFile`,
// which is precisely the call a regression would use.
//
// WHY THIS IS A BUILD FAILURE AND NOT A CONVENTION:
//
// These are children's voices, recorded in a state-government deployment. The Feature
// 22 Aadhaar policy is enforced by seven CI checks rather than by care, for the reason
// that applies exactly as well here: every violation looks entirely reasonable at the
// call site. "Cache the clip so we can retry the transcription." "Keep the last
// recording for debugging." "Store the audio with the answer for review." Each is a
// sensible sentence and each ends with a child's voice on a disk that has no deletion
// policy, no consent record, and no way for a parent to ask for it back.
//
// A recorded voice is also strictly worse than the transcript it produces: the text is
// the answer the child gave, which is the thing we asked for and the thing they can
// see. The audio additionally carries who they are — it is biometric-adjacent, it
// identifies a specific child across every recording they ever make, and unlike an
// Aadhaar number it cannot be re-issued.
{
  const AUDIO_SINKS = [
    'saveAudioFile', 'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
    'createWriteStream', 'uploadNoteImage', 'uploadBufferToCloudinary', 'upload_stream'
  ];
  // Methods on a handle the code already holds. Checked against tainted identifiers
  // only, so ordinary `res.json(...)` is untouched.
  const AUDIO_METHOD_SINKS = ['write', 'end', 'append', 'put', 'insertOne', 'updateOne', 'create', 'save'];
  // Checked by PRESENCE inside a microphone-upload handler, because none of these has
  // any correct use there.
  const AUDIO_HANDLE_SINKS = [
    ['createWriteStream', 'a file handle in a microphone handler can only be a write'],
    ['openSync', 'a file handle in a microphone handler can only be a write'],
    ['mkdtemp', 'a temp directory for a recording is still storage'],
    ['mkdtempSync', 'a temp directory for a recording is still storage'],
    ['tmpdir', 'NOT TO A TEMP FILE — the most plausible-sounding version of this mistake']
  ];

  // Argument text of every call to `name`, found by walking the parens rather than by
  // regex: a nested call in an argument list defeats `\(([^)]*)\)` and would let
  // `writeFileSync(p, Buffer.from(req.file.buffer))` through — which is exactly the
  // shape a violation takes once someone has to convert a type on the way in.
  const callArgs = (src, name) => {
    const out = [];
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      out.push(src.slice(start, i - 1));
    }
    return out;
  };

  const audioFailures = [];

  // 18a — no multer instance can write to disk. `memoryStorage` is multer's default,
  // so the violation is never "forgot to set it": it is someone ADDING `diskStorage`
  // or `dest:`, both of which are single-line, both of which read as configuration.
  for (const f of files) {
    if (!/\bmulter\b/.test(f.codeOnly)) continue;
    if (/diskStorage/.test(f.codeOnly)) {
      audioFailures.push(`${f.rel}: multer diskStorage — an uploaded body would be written to disk`);
    }
    if (/\bdest\s*:/.test(f.codeOnly)) {
      audioFailures.push(`${f.rel}: multer dest: — an uploaded body would be written to disk`);
    }
  }

  // 18b — the taint check, scoped PER ROUTE HANDLER rather than per file.
  //
  // The first version of this scoped by file and immediately reported myNotes.js, which
  // sends `req.file.buffer` to `uploadNoteImage`. That is a note SCREENSHOT — Feature
  // 23, uploaded deliberately by the student, resized and EXIF-stripped. Nothing to do
  // with a microphone.
  //
  // The property says "uploaded AUDIO buffer"; the expression said "any upload". Rule
  // 18 in one line: suspect the check before the code, especially when the check is
  // newer. Loosening the property to match the expression would have been the wrong
  // repair — image uploads are legitimate and forbidding them protects nobody.
  //
  // So the discriminator is the MULTER FIELD NAME on the route: only a handler that
  // accepts a field called audio/voice/recording/speech has its buffer tainted. The
  // field-name list is deliberately wider than the one field that exists today, so
  // renaming `'audio'` to `'voice'` does not walk out from under the check.
  const AUDIO_UPLOAD_FIELD_RE = /\.\s*(?:single|array)\s*\(\s*['"`](audio|voice|recording|speech|utterance)['"`]|name\s*:\s*['"`](audio|voice|recording|speech|utterance)['"`]/;
  let audioRoutesScanned = 0;

  for (const f of files) {
    if (!/req\.file\b/.test(f.src)) continue;

    // Split the file into route-handler spans. Scanned against `f.src` — which is the
    // COMMENTS-STRIPPED, STRINGS-INTACT view (see the `files` map at the top; the
    // property is named `src`, not `code`) — because the field name that discriminates
    // audio from images IS a string literal, and `codeOnly` blanks it, which would make
    // every upload in the codebase look identical.
    //
    // Reading `f.code` here was the first version's bug: it is `undefined`, every file
    // was skipped, and 18b silently examined nothing. The vacuity guard below is the
    // only reason that surfaced instead of printing PASS.
    const marks = [...f.src.matchAll(/\brouter\s*\.\s*(?:get|post|patch|put|delete|use)\s*\(/g)].map((m) => m.index);
    const spans = marks.map((start, i) => f.src.slice(start, marks[i + 1] ?? f.src.length));

    for (const span of spans) {
      if (!AUDIO_UPLOAD_FIELD_RE.test(span)) continue;
      audioRoutesScanned++;

      // One level of aliasing, which is the level that actually occurs: nobody threads
      // an upload buffer through three helpers, they bind it to a local and pass the
      // local. Deeper indirection is not covered here and is not claimed to be — 18c
      // and 18d close the structural side, where a buffer that reaches a helper still
      // has nowhere to land.
      const tainted = new Set(['req.file.buffer', 'req.file']);
      const bind = [
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*req\.file(?:\.buffer)?\b/g,
        /(?:const|let|var)\s*\{\s*buffer\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*req\.file\b/g,
        /(?:const|let|var)\s*\{\s*file\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*req\b/g
      ];
      for (const re of bind) {
        let m;
        while ((m = re.exec(span))) tainted.add(m[1]);
      }
      // `const { buffer } = req.file` binds the bare name.
      if (/(?:const|let|var)\s*\{[^}]*\bbuffer\b[^}]*\}\s*=\s*req\.file\b/.test(span)) tainted.add('buffer');

      const names = [...tainted].filter((t) => !t.includes('.'));
      const carriesTaint = (args) =>
        [...tainted].some((t) => t.includes('.') && args.includes(t)) ||
        names.some((n) => new RegExp(`\\b${n}\\b`).test(args));

      for (const sink of AUDIO_SINKS) {
        for (const args of callArgs(span, sink)) {
          if (carriesTaint(args)) {
            audioFailures.push(`${f.rel}: ${sink}(...) receives an uploaded audio buffer`);
          }
        }
      }

      // METHOD sinks. The first version checked only the arguments of a NAMED call, and
      // the failure-proof harness walked straight past it with:
      //
      //     const { buffer } = req.file;
      //     createWriteStream('/tmp/clip.wav').end(buffer);
      //
      // The buffer never appears in `createWriteStream`'s arguments — it is handed to a
      // method on the returned handle, so an argument-only check reports nothing. That
      // is not an exotic shape; it is how anyone actually writes a stream.
      for (const sink of AUDIO_METHOD_SINKS) {
        for (const args of callArgs(span, `\\.\\s*${sink}`)) {
          if (carriesTaint(args)) {
            audioFailures.push(`${f.rel}: .${sink}(...) receives an uploaded audio buffer`);
          }
        }
      }

      // PRESENCE, not arguments. Opening a file handle or reaching for a temp directory
      // inside a microphone-upload handler has no legitimate purpose at all — there is
      // nothing correct to do with a file descriptor there — so the mere appearance is
      // the violation and no data-flow argument is needed.
      //
      // This is the clause that closes "not to a temp file". A temp file is the most
      // plausible-sounding version of this mistake ("just while we retry the
      // transcription") and the one least likely to be noticed in review, because it
      // reads as cleanup-adjacent rather than as storage.
      for (const [needle, why] of AUDIO_HANDLE_SINKS) {
        if (new RegExp(`\\b${needle}\\b`).test(span)) {
          audioFailures.push(`${f.rel}: ${needle} inside a microphone-upload handler — ${why}`);
        }
      }
    }
  }

  // A CHECK THAT FINDS NOTHING TO CHECK PASSES REGARDLESS OF BEHAVIOUR (Design Rule
  // 11). If the STT route is renamed, moved behind a helper, or its multer field is
  // called something not in the list above, 18b would quietly scan zero handlers and
  // report PASS forever — green, and blind. So the count is asserted, not assumed, and
  // printed on success so the number is visible rather than inferred.
  if (audioRoutesScanned === 0) {
    audioFailures.push('NO audio-upload route was found to check — 18b scanned nothing. Either the STT route moved, or its multer field name is not in AUDIO_UPLOAD_FIELD_RE. A vacuous pass is not a pass.');
  }

  // 18c — the structural half, exactly like the coordinate invariant (6): recorded
  // audio has NOWHERE to be written, so no careless later code can write it. A
  // `Buffer` field on any model is the general form of the same mistake — binary bytes
  // in a document are how "just keep the clip" ships without anyone naming it audio.
  const AUDIO_FIELD_RE = /\b(audioBlob|audioData|audioBytes|audioBuffer|recordingUrl|recordingData|recordedAudio|voiceRecording|voiceClip|micAudio|speechAudio|utteranceAudio)\s*:/i;
  const BUFFER_FIELD_RE = /\btype\s*:\s*Buffer\b/;
  for (const f of files) {
    if (!f.rel.startsWith('models/')) continue;
    if (AUDIO_FIELD_RE.test(f.codeOnly)) audioFailures.push(`${f.rel}: a model field names recorded audio`);
    if (BUFFER_FIELD_RE.test(f.codeOnly)) audioFailures.push(`${f.rel}: a model declares a Buffer field — binary bytes in a document`);
  }

  // 18d — the client half. In the browser the danger is not a filesystem, it is the
  // three stores that OUTLIVE the tab (IndexedDB, Cache Storage, localStorage) plus
  // `createObjectURL`, which is how a clip becomes a playable or downloadable artefact
  // with a lifetime nobody is tracking.
  //
  // Scoped to files that actually hold a MediaRecorder, so ordinary use of localStorage
  // elsewhere in the app is untouched. That is the point: the rule is about recorded
  // audio, not about storage.
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
    const PERSIST = [
      ['indexedDB', 'IndexedDB survives the tab, the session and the logout'],
      ['caches.open', 'Cache Storage survives the tab, the session and the logout'],
      ['localStorage.setItem', 'localStorage survives logout on a SHARED SCHOOL DEVICE'],
      ['sessionStorage.setItem', 'sessionStorage outlives the utterance'],
      ['createObjectURL', 'a blob URL is a downloadable, replayable artefact with an untracked lifetime'],
      ['showSaveFilePicker', 'writes the recording to the device filesystem']
    ];

    for (const full of walkClient(CLIENT)) {
      const rel = relative(CLIENT, full).split('\\').join('/');
      const raw = readFileSync(full, 'utf8');
      const { code, codeOnly } = scannable(raw);
      if (!/MediaRecorder/.test(codeOnly)) continue;

      for (const [needle, why] of PERSIST) {
        if (codeOnly.includes(needle)) {
          audioFailures.push(`client/src/${rel}: ${needle} in a recording file — ${why}`);
        }
      }
      // Where the recording is allowed to GO. Transcription is the only destination,
      // so every request originating from a recording file must be an STT request.
      // Scanned against `code` (strings intact) because the destination IS the string.
      const urls = [...code.matchAll(/(?:authFetch|fetch)\s*\(\s*[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]);
      for (const u of urls) {
        if (!/\bstt\b/.test(u)) {
          audioFailures.push(`client/src/${rel}: a recording file requests "${u}" — recorded audio goes to transcription and nowhere else`);
        }
      }
    }
  }

  if (audioFailures.length) {
    failures.push({ name: 'microphone audio has no write path' });
    console.log('*** FAIL ***  microphone audio has no write path');
    audioFailures.forEach((h) => console.log(`                ${h}`));
    console.log('                Recorded child audio exists in memory, is transcribed, and is released. Only the TEXT persists.');
  } else {
    console.log(`PASS          microphone audio has no write path (${audioRoutesScanned} audio-upload route(s) scanned; synthesised TTS audio may still be cached)`);
  }
}

// ── 19. The mentor script mirrors, and Aadhaar is never voice-input ────────
//
// Two properties, both structural, in one place because they are both about the same
// table.
//
// (a) DRIFT. The repo is not a monorepo, so the mentor's line ids exist twice —
//     server-side with their text, client-side as ids only. The client asks for a line
//     BY ID; an id the server has dropped resolves to no audio, and the mentor goes
//     silent at exactly one step of a flow with no visible cause. Same guard as the
//     taxonomy mirror (invariant 7), same reason.
//
// (b) AADHAAR IS NEVER VOICE-INPUT. Not the number, not the consent. This is asserted
//     against the DATA rather than the components, because a component check only
//     covers the components that exist today: if the field is absent from
//     VOICE_FILLABLE_FIELDS, no present or future component that iterates that list can
//     render a microphone for it.
//
//     A misheard digit fails the Verhoeff check by construction, so the voice path
//     could only ever produce a rejection — it is not a degraded feature, it is one
//     that cannot work. And a twelve-digit government identifier spoken aloud in a
//     classroom is a disclosure to everyone in the room, which no later DELETE can
//     withdraw. Consent by voice is not consent: the DPDP record is a ticked box with a
//     timestamp, and a spoken "haan" would be a consent record with no artefact behind
//     it — worse than no record.
{
  const srvScript = await import('./src/config/mentorScript.js');
  const cliPath = new URL('../client/src/data/mentorScript.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const cliScript = await import(`file://${cliPath}`);

  const AADHAAR_OPT_OUT_HI = 'आधार और जगह अभी भरना ज़रूरी नहीं है — बाद में सेटिंग्स से भी कर सकते हो।';

  const srvIds = srvScript.MENTOR_LINE_IDS;
  const cliIds = [...cliScript.MENTOR_LINE_IDS].sort();
  const onlyServer = srvIds.filter((k) => !cliIds.includes(k));
  const onlyClient = cliIds.filter((k) => !srvIds.includes(k));

  const incomplete = srvIds.filter((id) => {
    const e = srvScript.MENTOR_SCRIPT[id];
    return !e?.hi?.trim() || !e?.en?.trim();
  });

  // Every line the mentor speaks is a FIXED string. A line carrying a value the child
  // just spoke cannot be cached, so it must never be here — and a placeholder is how
  // one would arrive.
  const templated = srvIds.filter((id) => {
    const e = srvScript.MENTOR_SCRIPT[id];
    return /\$\{|\{\{|%s|\{\d\}/.test(`${e.hi} ${e.en}`);
  });

  // Exactly one line may mention Aadhaar: the one that says it is optional.
  const mentionsAadhaar = srvIds.filter((id) => /आधार|aadhaar/i.test(`${srvScript.MENTOR_SCRIPT[id].hi} ${srvScript.MENTOR_SCRIPT[id].en}`));

  const voiceFields = cliScript.VOICE_FILLABLE_FIELDS || [];
  const readback = cliScript.CONFIRM_READBACK_FIELDS || [];

  const checks = [
    ['the client mirrors every server line id', onlyServer.length === 0, onlyServer.join(', ')],
    ['the client declares no line the server cannot speak', onlyClient.length === 0, onlyClient.join(', ')],
    ['every line exists in BOTH languages', incomplete.length === 0, incomplete.join(', ')],
    ['no line is a template — a fixed string is what makes caching possible', templated.length === 0, templated.join(', ')],
    ['no line id names Aadhaar', srvIds.filter((id) => /aadhaar/i.test(id)).length === 0, ''],
    ['exactly one line mentions Aadhaar, and it is the opt-out',
      mentionsAadhaar.length === 1 && mentionsAadhaar[0] === 'profile.optional', mentionsAadhaar.join(', ')],
    ['the Aadhaar opt-out wording is verbatim',
      srvScript.MENTOR_SCRIPT['profile.optional']?.hi === AADHAAR_OPT_OUT_HI, ''],
    ['aadhaarNumber is NOT voice-fillable', !voiceFields.includes('aadhaarNumber'), ''],
    ['aadhaarConsent is NOT voice-fillable — the checkbox stays a checkbox', !voiceFields.includes('aadhaarConsent'), ''],
    ['no voice-fillable field is Aadhaar-related', voiceFields.filter((f) => /aadhaar/i.test(f)).length === 0, ''],
    ['every read-back field is one the microphone may fill',
      readback.every((f) => voiceFields.includes(f)), readback.filter((f) => !voiceFields.includes(f)).join(', ')]
  ];

  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    failures.push({ name: 'mentor script mirrors, and Aadhaar is never voice-input' });
    console.log('*** FAIL ***  mentor script mirrors, and Aadhaar is never voice-input');
    bad.forEach(([n, , detail]) => console.log(`                ${n}${detail ? ': ' + detail : ''}`));
  } else {
    console.log(`PASS          mentor script mirrors, and Aadhaar is never voice-input (${srvIds.length} lines, ${checks.length} rules)`);
  }
}

// ── 20. A terminal provider state is never classified retryable ────────────
//
// PROPERTY, in words first (Design Rule 18): an error that CANNOT clear on its own must
// never be reported as one that can. Retrying an exhausted key is not caution — it is a
// guaranteed-futile wait, repeated with exponential backoff, that delays the caller's
// real fallback by the whole retry budget.
//
// This is Design Rule 2 made checkable. The rule has now been violated in three places
// (the diagram retry, the mentor cache warm, `callOpenAIChat`'s flat 429), each leaning
// a different way, because the direction is not a decision — it is a consequence of not
// reading the body. So the classification lives in ONE pure function and is asserted
// here rather than being three regexes nobody compares.
//
// It ALSO runs the real `classifyProviderError` against a fake Response, which is the
// only part of this suite that would notice the call sites failing to import it: ESM
// resolves a missing binding at CALL time, not at parse time, so "the module parses"
// proves nothing about whether the function is reachable. (Learned immediately: an
// idempotency guard matched the string `providerError.js` inside a COMMENT and skipped
// the import, leaving a call to an undefined identifier that parsed perfectly.)
{
  const { classifyProviderError, isTerminalProviderError } = await import('./src/utils/providerError.js');

  // A Response-alike. It only needs `status` and `text()`, which is exactly what the
  // classifier consumes — a double that could not represent a body would make this
  // check decorative (Design Rule 9).
  const fakeRes = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  const OPENAI_QUOTA = { error: { message: 'You have no credits remaining. Add credits to continue using the API.', type: 'insufficient_quota', code: 'credit_balance_exhausted' } };
  const OPENAI_RATE = { error: { message: 'Rate limit reached for gpt-4o-mini.', type: 'rate_limit_exceeded', code: 'rate_limit_exceeded' } };
  const BAD_KEY = { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } };
  const SERVER_ERR = { error: { message: 'The server had an error while processing your request.', type: 'server_error', code: null } };

  const results = await Promise.all([
    classifyProviderError(fakeRes(429, OPENAI_QUOTA), 'test'),
    classifyProviderError(fakeRes(429, OPENAI_RATE), 'test'),
    classifyProviderError(fakeRes(401, BAD_KEY), 'test'),
    classifyProviderError(fakeRes(500, SERVER_ERR), 'test'),
    classifyProviderError(fakeRes(502, '<html>Bad Gateway</html>'), 'test'),
    classifyProviderError(fakeRes(429, ''), 'test')
  ]);
  const [quota, rate, badKey, serverErr, html, empty] = results;

  const checks = [
    // THE CENTRAL PAIR. Same status, opposite meanings — this is the whole reason the
    // body has to be read, and the exact case that cost a 92-call run.
    ['429 + insufficient_quota is TERMINAL', quota.terminal === true],
    ['429 + rate_limit_exceeded is RETRYABLE', rate.terminal === false],
    ['the two 429s classify DIFFERENTLY (the point of reading the body)', quota.terminal !== rate.terminal],

    ['a revoked/incorrect key is terminal', badKey.terminal === true],
    ['a 500 server error is retryable', serverErr.terminal === false],

    // Unparseable bodies must not crash and must lean RETRYABLE. Wrongly calling a
    // transient failure terminal DESTROYS something (the original Rule 2 defect: one
    // 429 cost a cached question its figure permanently); wrongly calling an exhausted
    // key retryable merely wastes backoff. Both are wrong, only one is unrecoverable.
    ['a non-JSON body does not throw and leans retryable', html.terminal === false],
    ['an empty body does not throw and leans retryable', empty.terminal === false],
    ['a non-JSON body still keeps something greppable', html.message.length > 0],

    // The summary is what an operator actually reads, so it must carry the fields that
    // make the call — a bare status is what this whole invariant exists to eliminate.
    ['the summary names status, type, code and terminal',
      ['status=', 'type=', 'code=', 'terminal='].every((k) => quota.summary.includes(k))],
    ['the summary states terminal=true for an exhausted key', quota.summary.includes('terminal=true')],
    ['the summary states terminal=false for a rate limit', rate.summary.includes('terminal=false')],

    // The pure form must agree with the Response form, or the two drift and callers
    // holding parsed fields get a different answer from callers holding a Response.
    ['isTerminalProviderError agrees with classifyProviderError',
      isTerminalProviderError({ type: 'insufficient_quota' }) === true &&
      isTerminalProviderError({ code: 'rate_limit_exceeded' }) === false],
    ['a message-only quota signal is caught (providers that send no code)',
      isTerminalProviderError({ message: 'You exceeded your current quota, please check your plan and billing details.' }) === true],
    ['an empty object is not terminal', isTerminalProviderError({}) === false],
    ['no argument does not throw', isTerminalProviderError() === false]
  ];

  // ── The call sites actually REACH the classifier ──
  //
  // Asserted by grep rather than by execution because executing them needs live keys.
  // The pairing is what matters: a file that CALLS `classifyProviderError` must also
  // IMPORT it. That is the missing-import bug, and it is invisible to a parse check.
  const callSites = files.filter((f) => f.codeOnly.includes('classifyProviderError('));
  const unimported = callSites
    .filter((f) => f.rel !== 'utils/providerError.js')
    .filter((f) => !/import\s*\{[^}]*classifyProviderError[^}]*\}\s*from/.test(f.codeOnly));

  checks.push(['every caller of classifyProviderError imports it',
    unimported.length === 0, unimported.map((f) => f.rel).join(', ')]);
  // Vacuity guard, per the practice in PRODUCTION_CHECKLIST: a selector that matches
  // nothing passes regardless of behaviour.
  checks.push(['at least one call site exists to check', callSites.length >= 2, `${callSites.length} found`]);

  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    failures.push({ name: 'terminal provider errors are never classified retryable' });
    console.log('*** FAIL ***  terminal provider errors are never classified retryable');
    bad.forEach(([n, , detail]) => console.log(`                ${n}${detail ? ': ' + detail : ''}`));
  } else {
    console.log(`PASS          terminal provider errors are never classified retryable (${checks.length} rules, ${callSites.length} call sites)`);
  }
}

// ── 21. Narration never speaks text in a language it is not in ─────────────
//
// PROPERTY, stated first: translation is attempted EXACTLY when the language the text
// is actually in differs from the language the student asked to hear — and when a
// translation fails, the text is spoken in ITS OWN language, never in the requested one.
//
// The second half is the defect this exists for. Speaking untranslated English words
// through a Hindi voice is not a degraded result, it is an unintelligible one, and it
// was reached by comparing the requested language against the SITE TOGGLE instead of
// against the text. The toggle says what a student PREFERS; it says nothing about what
// a given string IS. A Hindi-toggle student whose question had no cached translation
// was shown English, the toggle still said 'hi', and the route concluded there was
// nothing to translate.
//
// Asserted here rather than left inline because this path is shared by EVERY grade and
// subject: a regression reaches Class 10 students who have nothing to do with the
// Voice Mentor.
{
  const { resolveSpeakPlan, speakLangAfterTranslationFailure } = await import('./src/utils/narrationLang.js');

  const p = (sourceLang, narrationLang) => resolveSpeakPlan({ sourceLang, narrationLang });

  const checks = [
    // Same language: nothing to do, and nothing paid for.
    ['en text, en wanted -> no translation', p('en', 'en').needsTranslation === false],
    ['hi text, hi wanted -> no translation', p('hi', 'hi').needsTranslation === false],
    ['en text, en wanted -> speaks en', p('en', 'en').speakLang === 'en'],
    ['hi text, hi wanted -> speaks hi', p('hi', 'hi').speakLang === 'hi'],

    // THE CASE THAT WAS BROKEN: English text on a Hindi-preferring session.
    ['en text, hi wanted -> DOES translate', p('en', 'hi').needsTranslation === true],
    ['en text, hi wanted -> translates to hi', p('en', 'hi').translateTo === 'hi'],

    // The unsupported direction degrades to intelligible, not to preferred.
    ['hi text, en wanted -> no translation (one-way translator)', p('hi', 'en').needsTranslation === false],
    ['hi text, en wanted -> speaks the HINDI text in a hi voice, not hi words in an en voice',
      p('hi', 'en').speakLang === 'hi'],

    // Failure ALWAYS falls back to the source, never to the request.
    ['a failed en->hi translation speaks ENGLISH', speakLangAfterTranslationFailure('en') === 'en'],
    ['a failed translation never speaks the requested language when it differs',
      speakLangAfterTranslationFailure('en') !== 'hi'],

    // Garbage in must not silently become Hindi.
    ['an unknown source language is treated as en', p(undefined, 'en').speakLang === 'en'],
    ['an unknown narration language is treated as en', p('en', undefined).needsTranslation === false]
  ];

  // ── EVERY fallback response must carry the language OF ITS TEXT ──────────
  //
  // A3 has now been found at THREE sites and the third was the client filling a gap the
  // server left. When TTS is exhausted a route hands back `fallbackText` for the browser
  // to speak — and if it omits `fallbackLang`, SpeakerButton has nothing to go on and
  // substituted the student's PREFERENCE, which is a proxy for "what language is this
  // text in". Untranslated English then spoke through a Hindi voice, intermittently,
  // exactly tracking which questions had a cached translation.
  //
  // Six of the seven fallback responses omitted it. This asserts the pairing directly:
  // no `fallbackText` without a `fallbackLang` beside it.
  {
    const fallbackRe = /useFallback:\s*true[^}]*}/g;
    for (const f of files) {
      if (!f.rel.startsWith('routes/')) continue;
      for (const m of f.codeOnly.match(fallbackRe) || []) {
        if (!m.includes('fallbackLang')) {
          checks.push([`${f.rel}: a fallback response omits fallbackLang`, false, m.slice(0, 80)]);
        }
      }
    }
    // Vacuity guard: if the shape changes and nothing matches, this check silently
    // covers nothing.
    const total = files.filter((f) => f.rel.startsWith('routes/'))
      .reduce((n, f) => n + (f.codeOnly.match(fallbackRe) || []).length, 0);
    checks.push(['fallback responses were actually found to check', total >= 4, `${total} found`]);
  }

  // The client must NEVER infer the fallback language from the narration preference.
  {
    const CLIENT = new URL('../client/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const sb = readFileSync(join(CLIENT, 'components/SpeakerButton.jsx'), 'utf8');
    const code = scannable(sb).codeOnly;
    checks.push(['SpeakerButton reads fallbackLang from the server', code.includes('data.fallbackLang')]);
    checks.push(['SpeakerButton does not substitute narrationLang for the fallback language',
      !/speakLang\s*=\s*[^;]*narrationLang/.test(code)]);
  }

  // The route must not have gone back to comparing against the site toggle.
  const diag = files.find((f) => f.rel === 'routes/diagnostic.js');
  checks.push(['live-audio decides via resolveSpeakPlan, not an inline language compare',
    !!diag && diag.codeOnly.includes('resolveSpeakPlan(')]);
  checks.push(['live-audio reads sourceLang from the client',
    !!diag && diag.codeOnly.includes('sourceLang')]);

  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length) {
    failures.push({ name: 'narration never speaks text in a language it is not in' });
    console.log('*** FAIL ***  narration never speaks text in a language it is not in');
    bad.forEach(([n]) => console.log(`                ${n}`));
  } else {
    console.log(`PASS          narration never speaks text in a language it is not in (${checks.length} rules)`);
  }
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} invariant(s) violated.`);
  process.exit(1);
}
console.log('All structural invariants hold.');
