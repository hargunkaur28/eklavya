## Pre-Production Checklist / Flagged for Later

### External Paid API & Cost Inventory
- **OpenAI TTS (`gpt-4o-mini-tts`) — Primary TTS provider.** Cost: $0.015 per 1,000 characters (~$0.0003 per narrated question).
- **Sarvam AI (Bulbul) — Fallback TTS provider**, used when OpenAI TTS errors. Also remains primary for Translation and STT (unchanged — this swap applies to TTS only, not translation or speech-to-text).
- **Groq AI (Llama/Mixtral LLM & English STT):** Free tier / Paid key.

### Sarvam / Translation & TTS
- [ ] Add paid Sarvam API keys (currently on free tier, exhausted
      during dev testing — running on fallback: Groq translation +
      OpenAI Hindi TTS / Web Speech English TTS)
- [ ] Once paid keys are in: verify the PRIMARY Sarvam translate + TTS
      path end-to-end post-schema-changes (translatedHindiQuestionText,
      subtopicsHindi, audioQuestionEn/Hi) — only fallback path has been
      tested since these fields were added
- [ ] Get a realistic (not synthetic-burst) estimate of translate call
      volume for a student's first Hindi-mode weak-topics page load
      with 10+ completed days — confirm whether Sarvam's real rate
      limits could be hit under actual usage
- [ ] Sarvam TTS concurrency: Promise.all fires all chunks in a day's
      audio simultaneously — check Sarvam's account-level concurrency
      limits for very long day content, consider batching (e.g. 5 at
      a time) if long days become common
- [ ] Confirm YOUTUBE_API_KEY is set on Render (flagged multiple times,
      never explicitly confirmed)

### Phase 6 (Practice Mode) — build-time reminders
- [ ] Do NOT reuse module-quiz temperature (0.4) for practice quizzes —
      practice needs variety/rotation (higher temp and/or rotation
      pool with seed in cache key), module quizzes intentionally stay
      consistent per day
- [ ] Decide explicitly whether practice-quiz results feed into weak-
      topic aggregation (Phase 4) or stay fully separate — don't let
      it happen implicitly

### Phase 5 (Multi-subject) — flagged for later
- [ ] Mobile subject switcher is a horizontal chip bar — fine for 2-3
      subjects, but revisit if students commonly hold 4+ active
      subjects (School + JEE + NEET is realistic for this audience);
      a cramped chip bar should become a bottom-sheet / dropdown picker
      or a dedicated "Subjects" screen on mobile

### Phase 6 (Practice Mode) — flagged for later
- [ ] No permanent practice history — practice sessions are ephemeral
      (24h TTL, just for scoring). For exam-prep students, "am I
      improving on this topic over time?" is a natural want. Consider a
      lightweight PracticeResult store + a per-topic trend view. Out of
      scope today, but a real future feature, not a silent gap.

### Phase 8 (Streaks) — flagged for later
- [ ] Streak current+longest are computed CLIENT-SIDE from User.studyDates,
      and the client SENDS its own localDate when recording activity.
      Fine while a streak is cosmetic (no stakes). BUT if streaks ever
      gate rewards / a leaderboard / anything consequential, move BOTH
      the computation AND the day-stamping server-side (derive the day
      from server time + a stored per-user timezone; stop trusting
      client-sent dates) — otherwise a manipulated client can inflate
      its own streak. Dates themselves are already server-stored; only
      the write-time date source and the aggregation are client-trusting.

### Architecture / Tech Debt
- [ ] sarvamClient.js's TTS chunking (chat widget) duplicates the
      chunking/WAV-header logic in textToSpeech.js (roadmap/diagnostic
      audio) — parallel implementations, not shared. A bug fix in one
      won't propagate to the other. Marked with // TECH DEBT: comments
      in both files pointing at each other.
- [ ] In-memory rate limiter + in-flight promise dedup (chat routes)
      only work correctly on a SINGLE server instance — if ever scaled
      to multi-instance/clustered deployment, needs Redis-backed
      versions instead
- [ ] Disk-based audio storage (server/uploads/audio/) assumes a
      persistent filesystem — confirm the production host has a
      persistent volume, or swap saveAudioFile/audioFileExists in
      textToSpeech.js for S3 (seam already built for this)
- [ ] No disk-cache eviction/cleanup policy — audio files accumulate
      indefinitely; add an LRU or age-based cleanup job before storage
      grows unbounded in production

### Data / Migration
- [ ] Roadmap archive-safety-fix (deleteMany → archived flag) — deploy
      to Render independently if not already done
- [x] Phase 5 (multi-subject) migration — RESOLVED, non-destructive.
      The archive safety-fix already added the schema support
      (archived flag), so existing students each have exactly one
      active roadmap that simply becomes their single subject. No
      backfill script, no data risk. Approved grade+subject course key.

### Known Dev-Data Artifacts
- [ ] Day 1 of the test roadmap has an artificially cached quiz +
      passed attempt from Phase 3 testing — harmless but be aware if
      testing against that same roadmap
      
### Track 2 — PDF Notes: deferred follow-ons (out of current scope)
- [ ] "Saved notes library" — PDF notes are currently generate → review →
      download (ephemeral, not persisted). Persisting them (Cloudinary
      resource_type:'raw' + a browse/delete UI) is a materially bigger
      feature (storage mgmt, cost accumulation). Build only on explicit
      request, not speculatively.
- [ ] Hindi notes content in the PDF — Phase 2.1 generates English notes
      (react-pdf's built-in Helvetica). Rendering Devanagari requires
      registering a Noto Sans Devanagari TTF in the PDF (Font.register)
      + generating Hindi content from Groq. The Notes UI strings are
      already bilingual; only the generated PDF *content* is English-only
      for now. Accepted limitation — add the font asset to enable Hindi.
- [ ] Richer, exam-ready notes — the generated notes are currently
      solid-but-basic (definitions + examples per point, key terms).
      Later, deepen them for exam prep: worked examples, common
      mistakes/misconceptions, diagrams/tables where relevant,
      previous-year-question style callouts, and per-section summaries.
      Would likely need a longer/structured Groq prompt + a richer PDF
      template (and possibly multi-pass generation).
- [ ] "Export Mentor chat → Notes" — let a student turn a Mentor
      conversation into a downloadable PDF note (feed the thread through
      the notes-structuring + PDF pipeline). Clean follow-on that reuses
      Track 1 (Mentor) + Track 2 (notes/PDF); not built now.

### Track 3 — Written / Essay Questions: accepted limitations
- [ ] AI feedback text is ENGLISH even in Hindi mode. Written answers are
      graded by Groq, and the per-criterion feedback strings
      (content/grammar/spelling) are generated in English; only the
      criterion LABELS are translated, and a Hindi-mode note tells the
      student the feedback itself is in English. Same shape as the
      notes-Devanagari gap. To fully localize, generate the feedback in
      the target language (or translate it post-grade) — deferred.
- [ ] Written grading is NON-DETERMINISTIC — the same answer can score
      slightly differently run-to-run (LLM grading). Accepted trade-off,
      NOT a bug: the review UI frames below-threshold as "Below threshold"
      (never "Incorrect") precisely because the score is a judgement, not
      a hard key. If this ever needs to feel more stable, options are a
      lower grading temperature (already 0.2), or averaging N grade passes
      (cost trade-off). Do not present written scores as exact/appealable.
- [ ] Written questions each translate via a SEPARATE prompt-only Sarvam
      call (MCQs batch into one). Under flaky network / rate limits this
      makes partial-Hindi more likely for written than MCQ — one question
      can show English while another shows Hindi. It self-heals (failed
      translations aren't cached; retried on next Hindi read) and never
      affects scoring, but if it becomes common, batch the written prompts
      into one call or add per-question retry-with-backoff.

### Auth — flagged for later
- [ ] No email verification on signup — accounts are usable immediately
      with any (even fake) email. Fine for now (no email-dependent
      features, password reset is admin/temp-password based), but before
      any email-gated feature (self-serve password reset, notifications,
      parent-invite by email), add a verification step. No PII/security
      dependency on email correctness today; don't build email flows on
      the assumption addresses are verified until this is done.

### Track 4 — Phase 4.2 (subject-taxonomy REMODEL): DEFERRED, not built
Phase 4.1 (cleanup) shipped — single source of truth (`server/src/config/taxonomy.js`
+ `client/src/data/taxonomy.js`), shared subject/grade normalizers, and two bug
fixes (doubled "class Class 10" YouTube query; diagnostic weak/strong split now
normalizes topics like the roadmap does). Phase 4.2 — the CONCEPTUAL remodel — was
scoped and planned but **deliberately NOT built**. It's the highest-risk piece
(touches the roadmap identity key + needs a data migration). Logged here for
whoever picks it up. NOTHING in the current codebase has a `track` field.

**The smell it addresses:** exam tracks JEE/NEET currently live in the same flat
subject list as school subjects (Physics/Chemistry/…) and "Science" overlaps
Physics/Chemistry/Biology — see the Phase 4.0 audit. JEE/NEET are not subjects,
they're cross-subject exam tracks.

- [ ] **Proposed model (strawman — NOT finalized):** add a `track` dimension
      ∈ {School, JEE, NEET}; remove JEE/NEET from the subject list (they become
      tracks). Subjects scoped per track: School → Science, Maths, Physics,
      Chemistry, Biology, English, Hindi, Social Science; JEE → Physics,
      Chemistry, Maths; NEET → Physics, Chemistry, Biology. A "Track optional /
      School-default" variant was also floated (track shown only as an opt-in so
      the common school path stays a 2-step onboarding). Neither was chosen.
- [ ] **Course identity key change:** `{userId, grade, subject}` →
      `{userId, grade, track, subject}`. Blast radius (from the 4.0 audit): the
      archive-on-regen filter (`roadmap.js` ~537-540), `/roadmap/list` grouping,
      the chat active-roadmap pick, and multi-subject switching all key on
      `{grade, subject}` and would each need `track` added.
- [ ] **Schema:** add `track: { type: String, default: 'School' }` to Roadmap,
      DiagnosticSession, DiagnosticResult, PracticeSession (additive, no hard
      enum — consistent with 4.1). Onboarding becomes 3-step (grade → track →
      subject, subject options depending on track).
- [ ] **MIGRATION — OPEN, NOT DECIDED.** Existing "JEE"/"NEET" roadmaps are today
      monolithic single-value-subject roadmaps; the remodel wants per-subject
      roadmaps within a track, so their migration is genuinely ambiguous. Three
      options were discussed and NONE was chosen — must be revisited if this is
      picked up:
        1. **Grandfather** — RECOMMENDED default if/when built. Backfill adds
           `track=JEE/NEET` but leaves `subject='JEE'/'NEET'` as a legacy value;
           old roadmaps stay functional, new students get per-subject. Non-
           destructive, reversible, no ambiguous mapping.
        2. **Split into per-subject** — convert each monolithic roadmap into
           per-subject ones. Destructive + ambiguous (one roadmap's days/progress
           can't cleanly divide across Physics/Chem/Maths). Higher risk.
        3. **Lazy, no script** — add `track` with a derived default, resolve
           on-read; no backfill. Purely additive but the derivation logic scatters
           across every key-use site (easy to miss one).
      If a migration IS written, it must be non-destructive, idempotent (2nd run =
      no change), dry-runnable, and reversible; and verification must prove an
      existing JEE/NEET roadmap loads byte-identical (plus the added `track`) and
      that regen archives only the same `{grade, track, subject}`.
- [ ] **Also still open:** `topicResources.js` is dead code (no importers as of
      4.1) — a candidate for deletion, left in place deliberately. And `courses.js`
      (static 3-item catalog) is reachable from live roadmaps via
      `day.resourceLink → /courses/:id`; any restructuring of its ids or of
      `getResourceLinkForTopic` must preserve that deep-link (for FLAT subjects —
      see the sub-subject note below).

### Sub-subject splitting (English/Science/Social Science) — accepted limitations
Shipped: English→Writing/Grammar/Reading/Fusion, Science→Physics/Chemistry/Biology/
Combined, Social Science→Economics/Civics/Geography/History/Combined, each its own
`{userId,grade,subject,subSubject}` course. This is SEPARATE from the deferred
JEE/NEET "track" remodel above — do not conflate.
- [ ] **Practice mode picker stays FLAT** — the practice setup screen has no
      sub-subject selector (practice is free-text-topic driven). The backend
      accepts an optional `subSubject` (defaults `''`), and English practice with
      no sub-subject resolves to essay written-style via the legacy-safe
      `writtenStyleFor('English','')` branch (verified). Add a sub-subject selector
      to practice only if sub-subject-scoped practice sessions become a real want.
- [ ] **Sub-subject scoping is prompt-enforced, not hard-constrained** — generation
      is scoped by injecting `subjectScopeLabel()` into the Groq prompt (e.g. "the
      Grammar area of English"). Groq overwhelmingly honours it, but like all Groq
      generation it could occasionally drift; there is no post-generation validator
      that a question is strictly in-scope. Same accepted-limitation class as
      quiz-accuracy in general.
- [ ] **Sub-subject roadmaps have NO static-course deep-link** — `getResourceLinkForTopic`
      returns `null` when a `subSubject` is set (deliberate: the `courses.js` triad
      is subject-level and would mis-link a Physics day to the general Science
      course). So sub-subject roadmap days simply have no `day.resourceLink`. If a
      per-sub-subject course catalog is ever built, wire it in here.
- [ ] **Migration log is committed** (`server/src/scripts/backfill-subsubject.log.json`)
      as the durable rollback record + audit trail of exactly which docs were
      grandfathered. `--rollback` depends on it; a fresh clone must retain it to be
      able to reverse the migration that already ran in production.

### Voice Narration & Voice I/O — accepted design decisions & costs
- [ ] **OpenAI TTS cost tracking (`gpt-4o-mini-tts`):** Hindi TTS uses OpenAI as the primary fallback when Sarvam credits/quota fail. Model cost is ~$0.015 / 1k characters. Monitor OpenAI API usage on the dashboard if Hindi traffic grows significantly.
- [ ] **Groq TTS non-support:** Groq Orpheus/PlayAI TTS only supports English and Arabic — it cannot speak Devanagari/Hindi. Groq TTS is explicitly excluded from the Hindi fallback path.
- [ ] **English vs Hindi fallback chain asymmetry:** English uses `Sarvam -> Web Speech` (no OpenAI fallback). Hindi uses `Sarvam -> OpenAI TTS -> Web Speech` (since Web Speech Hindi voices vary wildly across operating systems).
- [ ] **Mentor narration is manual-only:** Mentor assistant replies do NOT auto-narrate on load, unlike quiz questions. Auto-playing variable-length conversational replies would be intrusive. The speaker button on Mentor messages is manual-trigger only.
- [ ] **Autoplay policy graceful degradation:** Browsers blocking programmatic audio playback (`NotAllowedError`) cause `SpeakerButton` to enter an `.autoplay-blocked` pulsing highlight state ("Tap to listen") rather than throwing unhandled errors or silently failing.

### Workstream A — Adaptive Diagnostic: accepted limitations & flagged items
- [ ] **BLOCKER: the free-tier Groq key cannot sustain this workload.** During
      testing the key was persistently rate limited (40-60 x HTTP 429 per full
      diagnostic), so most traffic fell through to OpenAI `gpt-4o-mini`. Measured
      per-round generation was **1.9 s on a healthy key** versus **10-34 s while
      rate limited** — the wall-clock cost is the provider, not the algorithm.
      Two knock-on effects make this worse than it first looks:
        1. the 8b fallback writes easier questions, so the difficulty audit
           rejects more, which triggers retries, which consumes more quota;
        2. asking for two candidates per slot doubles output tokens per call,
           which reaches a tokens-per-minute cap sooner.
      Get a paid Groq tier before launch and re-measure end-to-end latency. Until
      then the between-round wait is NOT representative.
- **Latency design (what is already off the critical path).** One generate call
  (2 candidates/slot) + one audit call per round; the next round's untouched
  chapters are pre-generated while the student answers the current one (observed
  1-2 of 4 slots already warm even with a test client that answers instantly — a
  real student's think time should cover more); figures capped at 7 s and dropped
  past it; `groqClient.js` skips a known-429 model for 60 s.
- [ ] Consider pre-generating BOTH difficulty branches for unresolved chapters
      (step-up and step-down) so the reactive half of a round is warm too. Costs
      roughly 2x background tokens — only worth it on a paid tier.
- **Difficulty audit must stay a SEPARATE call.** It was folded into the
  generation call to save a round-trip and that measurably broke it: with only an
  in-prompt self-check, a Class 10 Maths run produced "Find the HCF of 48 and 18",
  "if sin θ = 3/5 find cos(90° − θ)" and five other single-step questions, and the
  model declared stepsRequired: 2 for every one of them — ZERO self-rejections. A
  generator asked to grade its own output rubber-stamps it. The self-check is
  retained as a free first filter only.
- **The audit is advisory, not absolute.** If every candidate is flagged below
  level after 3 attempts, the flagged questions are served anyway (logged) rather
  than blocking the student — they are valid, on-syllabus questions, just easy
  ones. Failing the student outright is the worse outcome.
- **Question quality still varies with model output.** The blueprint pins the
  chapter and the level, and the validator + audit reject the clearly-bad cases,
  but an under-determined question occasionally survives (e.g. "two tangents from
  an external point are 8 cm and 10 cm" — impossible, they are always equal), and
  a model self-correction can leak into a Hindi stem. A per-question solvability
  check would mean another call per question.
- **Chapter coverage is 9 chapters, not the whole blueprint.** Class 10 Maths has
  14; a 20-question budget can resolve at most 10. The 9 are a deterministic even
  spread across the syllabus, and chapterCoverage records exactly which were
  touched, resolved, unresolved and untouched. Raising coverage means raising
  MAX_QUESTIONS — a product decision about how long a first-run diagnostic may be.
- **Blueprint coverage is 17 course identities.** Everything else (e.g. Class 7
  Maths, Class 11 flat Physics) synthesises a blueprint via Groq at session start.
  That path is validated but is one extra call and is not hand-checked against the
  syllabus.
- [ ] Hindi translation of generated questions still degrades to English on Sarvam
      failure (pre-existing) — more visible now simply because there are more
      questions to translate.
- [x] **~~BLOCKER~~: Sarvam HTTP 402 — DOWNGRADED after re-testing. The original
      diagnosis was wrong.** Hindi was degrading to English not because Sarvam was
      out of credits, but because `translateWithGroqFallback` fetched Groq directly
      and so had no fallback of its own: Sarvam 402 + Groq-70b 429 = give up and
      pass English through. Routed through `callGroqChat`, Hindi returns Devanagari
      3/3 on the exact same failing credentials (Sarvam still 402, 70b still rate
      limited). **This was a code problem wearing a billing problem's clothes** —
      a purchase order would not have fixed it, and it would have been "fixed" by
      the paid key in a way that hid the real defect.
- [ ] Sarvam paid keys are now a QUALITY upgrade, not a deployment blocker. Sarvam
      is a dedicated en→hi translator and should beat a general LLM on technical and
      mathematical phrasing — re-compare output quality once keys land. But Hindi is
      no longer shipping as English, so this does not gate a state deployment.

### Workstream B — one physical-device check before launch
- [ ] **Open the profile flow on a real Android phone and check the soft keyboard.**
      Playwright cannot raise a real IME, so this is the one B item verified only by
      proxy: at a simulated 360x400 viewport (a ~320px keyboard) the Finish button
      stays reachable by scrolling and the page scrolls rather than clipping. That is
      inference, not observation. Everything else in the flow IS browser-verified at
      360px — see  (21 checks: gate redirect,
      hardware Back between steps, focus after the slide transition, auto-advance +
      Back on the board picker, typing-does-not-gate-input, prefers-reduced-motion,
      and a full Hindi render including a validation error).
- Back from step 1 EXITS the flow by design — the draft holds the answers and any
  protected route redirects straight back in. The acceptance test asserts the exit
  specifically, so adding a trap later fails the suite instead of silently passing.
### Repo hygiene — LINE ENDINGS (bit us three times, will bite C and D)
- [ ] **This repo is CRLF.** Exact-match string edits into existing files fail with a
      trailing `` on every line. `cat -A` is NOT how to see it: it renders the
      line as though it were clean and hides it — only
      `JSON.stringify(line)` reveals `"    onboarding: {"`. Three separate edits
      failed this way. Workstreams C and D both involve heavy insertion into
      existing files, so either normalise line endings repo-wide now (cheap today,
      a large diff later) or always match with `.trim()` and diagnose with
      `JSON.stringify`, never `cat -A`.
- Related harness lesson: a mock that does not model the real API makes broken code
  look correct (an `Object.keys(localStorage)` stub hid a draft-clearing bug), and a
  wrong test fixture makes correct code look broken (a 1-character school name failed
  validation and produced four cascading false failures). Check the harness before
  changing the code.

### Aadhaar — consent withdrawal (DPDP right, implemented)
- `DELETE /api/auth/profile/aadhaar` unsets the envelope, `aadhaarLast4` and
  `aadhaarConsentAt` together. Removal is TOTAL and IRREVERSIBLE — there is no
  decrypt, so nothing is archived. The confirm dialog must say so plainly.
- The masked value is **student-only**: `publicProfile()` omits the Aadhaar keys
  entirely for parent and admin sessions. Under Option B a parent shares the
  student's User document, so a parent seeing "XXXX XXXX 0124" would be a
  disclosure the student never consented to — consent was for verification, not
  family visibility. Verified: a parent session's `/me` profile contains no
  `aadhaarMasked`, `aadhaarOnFile` or `aadhaarConsentAt` key at all.
- **Replace re-collects consent.** A new number is a new disclosure, so the consent
  checkbox reappears unticked and `aadhaarConsentAt` is written fresh. Verified: a
  replace without consent is rejected `AADHAAR_CONSENT_REQUIRED`, and the stored
  timestamp is strictly newer than the previous one, never reused.
### DEPLOY RUNBOOK — Workstream B (profile onboarding). ORDER IS LOAD-BEARING.

**If the redirect ships before the backfill runs, every existing student is thrown
into the profile flow on their next login.** The backfill is `--dry-run` by default,
so it does not happen unless a person consciously runs it — which means it will be
missed unless it is a numbered step. It is a numbered step.

1. **Deploy the SERVER first, with `AADHAAR_COLLECTION_ENABLED` unset (or `false`).**
   The server boots, `/api/auth/me` starts returning `onboardingCompleted`, and
   nothing changes for anyone. The client redirect is not live yet.
   - Boot guard check: the log must read `Aadhaar collection: DISABLED`.
2. **Run the backfill as a DRY RUN and read the output.**
   `node src/scripts/backfill-onboarding.js`
   - Confirm the matched count is roughly your existing student count.
   - Confirm the `$ne: true` divergence note. If it reports MORE documents than the
     run targets, those are post-launch students mid-onboarding and are correctly
     excluded — do not "fix" the filter to include them.
3. **Run the backfill for real.**
   `node src/scripts/backfill-onboarding.js --apply`
   - Verify `Idempotency check — documents still matching the filter: 0`.
   - Keep `src/scripts/backfill-onboarding.log.json`; `--rollback` needs it.
4. **Spot-check one pre-existing student:** log in, confirm they land on the
   dashboard and are NOT redirected to `/onboarding/profile`.
5. **Only now deploy the CLIENT** (the `ProtectedRoute` redirect + the
   `/onboarding/profile` route). The gate is inert until this step because it keys on
   `onboardingCompleted === false` strictly, and every legacy student is now `true`.
6. **Verify a NEW signup** is routed into the profile flow and can complete it.
7. **Enabling Aadhaar collection is a SEPARATE, LATER step**, done only once legal
   sign-off on the DPDP consent wording exists:
   - Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - Set `AADHAAR_COLLECTION_ENABLED=true` and `AADHAAR_ENCRYPTION_KEY=<that key>`.
   - The server refuses to boot if the flag is on and the key is missing/wrong-length.
   - **Back the key up before any Aadhaar is collected.** Losing it makes every
     stored envelope permanently unreadable — which is survivable only because
     nothing reads them today.
   - Set `NOMINATIM_CONTACT` to a real contact address (their usage policy requires
     an identifying User-Agent).

**Rollback:** `node src/scripts/backfill-onboarding.js --rollback` unsets the field
on exactly the recorded ids, restoring the pre-backfill state. Roll the CLIENT back
first, then the backfill — the reverse of the deploy order.

### Aadhaar — THE INTENDED READ PATH (read this before adding a decrypt function)

**There is deliberately no `decryptAadhaar` anywhere in this codebase.** That is a
design decision, not an omission, and this section exists so it is not "corrected"
by someone acting in good faith later.

Write-only encrypted PII is close to a hash with extra steps, so the obvious
objection is real: a state government WILL eventually ask to verify a stored number
against UIDAI. When that request arrives, the natural move is to add a
`decryptAadhaar` next to `encryptAadhaar`, because that is where it obviously goes.
**Do not do that.** A general-purpose decrypt helper importable from anywhere means
every future route is one import away from exposing plaintext Aadhaar, and nothing
in review will flag it because the function looks like it belongs there.

The intended path, if and when it is genuinely needed:

- [ ] **An offline export tool, not a live API route.** A script under
      `server/src/scripts/`, run deliberately by an operator, never mounted on Express
      and never reachable over HTTP. No request can trigger a decryption.
- [ ] **Admin-gated at the operator level**, requiring the admin security code
      (Feature 15) — not merely an admin JWT, which is a session and can be stolen.
- [ ] **Audit-logged per access**, to a separate append-only collection: who ran it,
      when, which userIds, and why. A decryption that leaves no trace is the thing
      the DPDP Act's accountability principle is aimed at.
- [ ] **Scoped to specific userIds passed explicitly.** No "export all" mode.
- [ ] **The key stays out of the app process** — read from the operator's environment
      at run time, not from the server's `.env`, so a compromised web process cannot
      decrypt even if it obtains the ciphertext.
- [ ] Until all of the above exists, the correct answer to "can we read the number
      back?" is **no**, and the correct response to a verification requirement is to
      collect consent for a live UIDAI verification at capture time instead of
      storing a number to verify later.

Enforcement already in place: `models/User.js` excludes `profile.aadhaarEncrypted`
via query middleware (which applies to `.lean()`, unlike document transforms), an
aggregation `$unset` guard, and `toJSON`/`toObject` transforms. The single escape
hatch is `.setOptions({ includeAadhaarEnvelope: true })` — grep for it; it should
only ever appear in the offline export tool described above.

### Workstream B punch list — carried in, not part of A
- [ ] **Mathematical notation is being prose-translated.** Found in the Hindi
      re-test output: `Find the roots of 2x² − 5x + 3 = 0` came back as
      `2x वर्ग माइनस 5x प्लस 3 = 0 के मूल का पता लगाएं` — "x squared minus 5x plus 3"
      rendered as Hindi *words* where the equation should have survived as symbols.
      Maths notation is language-neutral. A Class 10 student sees a sentence where an
      equation belongs, and it degrades further with fractions, roots and subscripts.
      **Fix:** mask maths expressions before translation and restore them after, in
      `translateAndCache.js` so every surface benefits at once (diagnostic, module
      quiz, practice, lesson prose, weak-topic labels). The prompt is what has to
      leave them alone, so the same masking works on both the Sarvam and the Groq
      path. Verify placeholders survive the round trip and fall back to the unmasked
      translation if any placeholder goes missing.
      **Do NOT apply this to diagram `alt` text.** In the same sample, `tangent PQ`
      became `स्पर्शी पीक्यू` — phonetic Devanagari, which is CORRECT there, because
      alt text feeds TTS and a narrating student needs to hear "PQ" pronounced. So
      masking must be opt-out per call site (default on for question/lesson text,
      off for the alt-text translation in `diagnostic.js`), not global.

### Shared-Groq-client sweep — every direct fetch converted
`grep -rn "api.groq.com" server/src` now returns exactly ONE hit, inside
`groqClient.js`. Seven call sites were bypassing the shared client, so none of
them had the 70b -> 8b -> OpenAI fallback chain or the rate-limit circuit breaker:

| Call site | What it does |
| --- | --- |
| `roadmap.js` callGroqForRoadmap | roadmap generation |
| `roadmap.js` callGroqForDayContent | daily lesson prose |
| `roadmap.js` callGroqForModuleQuiz | module quiz (F9) |
| `roadmap.js` remediation day | adaptive remediation (F12) |
| `diagnostic.js` callGroqForExplanations | per-question explanations |
| `practice.js` callGroqForPracticeQuiz | practice quiz (F11) |
| `translateAndCache.js` | **Hindi translation fallback** |
| `localizeReply.js` | chatbot reply localisation |

- **`translateAndCache.js` was the consequential one.** It is the Groq fallback for
  Hindi when Sarvam fails — but it fetched Groq directly, so when Sarvam returned
  402 and Groq 70b returned 429 (exactly the state a free tier reaches) it gave up
  and the caller passed English through. The 8b and OpenAI tiers can both produce
  Devanagari, so part of the observed "Hindi degrades to English" was self-inflicted
  rather than purely a Sarvam credit problem. Re-check Hindi coverage after this.
- [ ] Add a lint rule or CI grep asserting `api.groq.com` appears only in
      `groqClient.js`, so a future direct fetch is caught at review time. Three of
      these were found incidentally before the sweep was run.

### Roadmap day budget
- `ROADMAP_MIN_DAYS = 10` / `ROADMAP_MAX_DAYS = 15` are now explicit and exported.
  `validateRoadmapJSON` still tolerates 7-25 so a slightly-off model response is not
  discarded, but what is STORED is clamped to 15 — previously a 20-day response
  shipped as 20 despite the documented 10-15, and adaptive remediation (F12) then
  inserts further days on top of that.
- Grafting unassessed chapters respects the budget: it appends while there is room,
  then spills the remainder across catch-up days of **at most 3 chapters each**.
  The cap comes from Feature 10: a day's quiz is 10 questions pinned to that day's
  subtopics, and a sub-topic is only flagged weak once it has >= 2 questions. Three
  chapters gives ~3 questions each (above the threshold); eight would give one
  apiece, so those chapters could never be flagged weak however the student
  answered, and the day would teach nothing. Regression: `node test-graft-budget.mjs`.
- **Two bugs the graft test caught, both re-creating the silent truncation that the
  graft exists to prevent:**
  1. Truncating INSIDE the spill loop dropped the catch-up day the previous
     iteration had just added — 6 of 8 chapters lost. Slots are now reclaimed once,
     up front.
  2. Reclaiming slots from the tail deleted whichever late days happened to cover a
     required chapter (the model had put Statistics and Trigonometry near the end),
     putting those chapters straight back into the missing list. Trimming now skips
     any day that is the sole coverage for a required chapter.
- Also fixed: `chapterFor` matched by substring, so "Areas Related to Circles"
  resolved to the shorter chapter "Circles" and grafted the wrong one. Exact match
  is tried first now (same fix applied to the weak-chapter matcher). Verified across
  overflow sizes 2/3/5/8/9.
- The graft RE-VERIFIES its own result and logs an error if a chapter is still
  missing, rather than assuming the append worked.
- `day.subtopics` is populated at MODULE-QUIZ generation, not at roadmap creation, so
  a grafted day is not a special case — verified end to end: a grafted/combined day
  produced `["Surface Areas and Volumes of Solids","Statistics","Probability"]` with
  all 10 quiz questions pinned to that list, keeping the F10 weak-topic and F12
  remediation chain intact.
- [ ] Possible enhancement: seed a grafted day's quiz prompt with the blueprint
      chapter's `concepts` so its subtopics derive from the real syllabus rather than
      being re-invented by the quiz generator. Not built — current chain is sound.

### Silent-filler audit — every Groq-dependent generation path
Triggered by the roadmap-fallback find: a generation path that ships plausible
placeholder content on failure looks fine in a demo and is worthless to a student.
Feature 12's remediation already had the right pattern (insert nothing rather than
something fake); this audit converged the rest on it. Test: `node test-filler-audit.mjs`
against a server started with an invalid Groq key.

| Path | Behaviour when generation is down | Verdict |
| --- | --- | --- |
| Diagnostic (WS-A) | `503`, no questions | correct |
| Roadmap generate | Deterministic plan from the syllabus blueprint | **FIXED** |
| Daily lesson prose | `contentAvailable:false`, nothing cached, retries on revisit | **FIXED** |
| Module quiz (F9) | `available:false`, caches nothing | already correct |
| Practice mode (F11) | `available:false` | already correct |
| Notes (F18) | `502` with a real error | already correct |
| Mentor (F17) | `502`, no half-saved turn | already correct |
| Chatbot | Honest "having trouble responding" message | acceptable |

- **Daily lesson prose was the worst offender and is now fixed.** It returned
  "Welcome to Day's module on {topic}. Focus: {focus}" on any failure, AND the
  caller then set `contentGenerated = true` and saved it — so one transient outage
  permanently cached a non-lesson, and the student never got real content again
  even after Groq recovered. It now returns null, the day is not marked generated,
  and the client shows a retry while videos and the quiz keep working.
- **Roadmap retry no longer ships an incomplete plan.** A regenerated plan that was
  structurally valid but still omitted required chapters used to pass validation and
  ship with only a console warning — the same silent failure with an extra attempt in
  front of it. Missing chapters are now grafted on from the blueprint (keeping the
  model's ordering), or the plan is discarded for the deterministic one when there is
  nothing real to graft from.
- [ ] The chatbot failure string is honest but generic; consider a retry affordance
      in ChatWidget rather than a plain message.

### Workstream A — fixed during review (was silently wrong)
- **`chapterCoverage` was written but never read.** The adaptive diagnostic stops
  as soon as it is confident, so it routinely never reaches some chapters. Those
  chapters appeared in neither `weakTopics` nor `strongTopics`, so the roadmap
  generator had no reason to include them and they vanished from the study plan —
  because the quiz ran out of budget, not because the student knew the material.
  `POST /api/roadmap/generate` now consumes the field as a third tier ("not
  assessed → standard pacing"), passes the blueprint's real chapter list as the
  definition of syllabus breadth, and re-generates once naming any topic omitted.
  Regression: `node test-coverage-handoff.mjs`.
- **Roadmap generation bypassed the shared Groq client.** It called `fetch`
  directly, so it got neither the 70b → 8b → OpenAI fallback chain nor the
  rate-limit circuit breaker: a single 429 dropped the student to the template
  fallback while every other feature stayed up. Now routed through `callGroqChat`.
- **The roadmap fallback was pure template filler.** Twelve hardcoded days
  ("Foundational Review", "Key Definitions & Terms", "Advanced Topic Exploration")
  naming no actual syllabus content, shipped silently on any generation failure —
  so an outage produced a plan in which every real chapter was missing. Replaced
  with a deterministic plan built from the syllabus blueprint (real chapter names
  in syllabus order, weak chapters given an extra practice day). The generic
  template survives only for courses that have no blueprint at all.

### Workstream D — Diagram/Figure Questions: accepted limitations
- **SVG figure quality varies by model output.** Geometry is usually right for
  circles/tangents/triangles but is not verified programmatically — a figure can
  be drawn to non-exact proportions. The figure is decorative-but-relevant, and
  every question is required to be answerable from its text alone, so a poor
  figure degrades comprehension rather than correctness.
- **`currentColor` is resolved client-side, not server-side.** A data-URI `<img>`
  is an isolated document and cannot inherit the page's colour, so the stored SVG
  keeps `stroke="currentColor"` and `QuestionDiagram.jsx` substitutes the resolved
  `--diagram-ink` token immediately before base64-encoding. This is a deliberate
  deviation from "inject the colour server-side": one stored figure then serves
  both light and dark themes instead of being baked to one.
- [ ] Diagram generation adds one Groq call per eligible question (~30-40% of
      questions on diagram-eligible chapters). Include in the call-volume estimate.
- **Figures are capped at 7 s and dropped past it.** Every question must be
  answerable from its text alone, so a slow figure is never worth making a student
  wait for. Under a degraded provider the observed figure rate drops accordingly.

### BLOCKER: credentials — one procurement decision (Cloudinary now RESOLVED)

Each converts a **verified failure path** into an **unverified success path** — the same
shape of gap in each case. Listed together because they are one purchase order, not
scattered notes. **Cloudinary is now resolved**, leaving two.

| Service | State | What cannot be verified until it is paid |
| --- | --- | --- |
| **Groq** | Free tier, 40-60 x HTTP 429 per diagnostic | End-to-end round latency; and question quality, since nearly all output so far came from the 8b fallback after a 429, not the 70b path production will use |
| **Sarvam** | HTTP 402, out of credits | Primary translation quality. No longer blocks Hindi — that was a code bug (the Groq fallback had no fallback), now fixed — so this is a quality upgrade |
| **Cloudinary** | ✅ **RESOLVED** — working keys in place | Nothing. Notes image paste is now verified END TO END in a real browser: placeholder → upload → real `res.cloudinary.com` URL → persisted → byte-identical on reload. The original 403 was **not** a code fault — the account was provisioned as Media Optimizer rather than Programmable Media, which the SDK reports only as a bare `403`. `npm run diag:cloudinary` is what surfaced it |

- [ ] Provision all three, then re-run: `server/regress-wsA.mjs`, `server/test-mynotes.mjs`,
      `server/test-reorder.mjs`, `client/acceptance-mynotes.mjs`, `client/acceptance-onboarding.mjs`.
- Re-running is not a confirmation run. A paid Groq tier changes model routing, so
  results move to a different substrate rather than merely being repeated.


### EVERY NUMBER IN THIS REPO IS PROVISIONAL — they were measured on the wrong substrate
- **What was measured, and on what.** Groq’s free tier returned 40-60 HTTP 429s per
  diagnostic, so `groqClient.js` fell through to the **8b** model (and sometimes to
  OpenAI) for the large majority of generations. Nearly every figure quoted anywhere in
  this repo was produced that way, including:
  - **question difficulty** and the level the exemplars actually land on;
  - the **difficulty-audit rejection rate** — the 8b model writes easier questions, so
    the audit rejects more, and that rate says as much about the substrate as the audit;
  - **SVG size** (~550 bytes, min 402, max 619) — which is what both size caps were
    chosen against;
  - **figure rate per subject**, and the frequency of `MODEL_DECLINED`;
  - **round latency** end to end.
- [ ] **Treat all of the above as provisional, not as baselines.** They describe how a
      degraded free tier behaved on a given afternoon. A stronger model writes harder
      questions, declines figures at a different rate, and emits differently sized SVG —
      so the caps and shares may want re-tuning, and the audit rejection rate should be
      expected to move.
- [ ] **A re-run on a paid tier is a RE-MEASUREMENT, not a confirmation.** This is the
      distinction that matters and the easiest one to lose: paying changes model
      routing, so the second run samples a *different substrate*. If the numbers agree,
      that is a finding about two substrates agreeing — not the first run being
      validated. If they disagree, the first set was never wrong; it was answering a
      different question. Record both, with which model produced each.
- **What is NOT provisional:** anything structural. The sanitiser allow-list, the
  orphan guard’s asymmetry, the retry state machine, the cache-write ordering, the
  privacy invariants and every CI invariant are properties of the code and hold on any
  substrate. Only the *numbers* are substrate-dependent. Do not re-litigate the rules
  on the strength of a re-measurement.

### Workstream D — measured before wiring

- **Real generated SVGs are ~550 bytes** (min 402, avg 547, max 619 across circles,
  solids and circuits). The 50KB cap is a runaway backstop, not a typical size, so a
  separate collection for diagrams is unnecessary — at the measured average a whole
  15-day roadmap holds ~32KB of SVG, 0.2% of the 16MB BSON limit.
- **The tail is the risk, not the mean.** At the 50KB cap a pathological figure x4 per
  day x15 days would be 3MB inside one Roadmap document that also holds lesson prose,
  questions, attempts and video progress. So cached module-quiz figures use
  `CACHED_SVG_MAX_BYTES = 8KB` (worst case 480KB, ~3%), which rejects nothing that
  actually occurs. `attachDiagrams` now takes `maxBytes` and `share` per call.
- [x] Practice mode regenerates every session, so diagram cost is per-session and never
      amortised, so it uses a LOWER share. **Done: `DIAGRAM_SHARE_PRACTICE = 0.20`**
      against the module quiz’s 0.35. Chosen on the amortisation argument rather than
      measured latency — the number is therefore provisional like every other, and
      worth revisiting once a paid key makes round latency measurable.
- [x] A cached module-quiz question whose diagram fails must cache WITHOUT one and read
      as complete on its own — never "in the figure below" with no figure. **Done:**
      `rejectOrphanedFigureQuestions()` runs on the final array immediately before the
      cache write, and figures are attached BEFORE that write so the question and its
      figure are cached as one unit. Verified: 0 orphans across 20 cached questions.
      See README “Design Rules” 1 for the asymmetry, and note the guard covers
      Devanagari phrasings because a translated question takes the same caching path.

### Workstream C — KNOWN GAP: orphaned Cloudinary assets (not built, deliberately)

Notes images use a **unique public id per upload** by design — a page holds many, so a
deterministic id would make each paste overwrite the previous one. The consequence is
that nothing ever deletes them. **Storage grows monotonically and never shrinks.**

Every one of these currently orphans an asset:
- a student pastes an image, then deletes it from the document;
- a student deletes a page;
- a student deletes a PARENT page, cascading N children, orphaning every image on all
  of them;
- undo after a paste.

Two reasons this matters beyond tidiness:
1. **Cost.** Invisible at one school, a bill nobody budgeted for at state scale.
2. **Privacy.** A "deleted" page's images remain publicly fetchable by URL. For a
   deployment holding minors' data that is a weaker deletion guarantee than the
   Aadhaar withdrawal path elsewhere in this codebase, and the inconsistency is worth
   naming.

Deliberately NOT built now — it is out of scope for C and needs care: an image
referenced twice, a delete racing an in-flight upload, an undo that restores a node
whose asset was just destroyed.

**The folder path already encodes what a sweep needs.** Confirmed from the live
upload: assets land at `eklavya/notes/{userId}/{noteId}/{timestamp}-{rand}`. So no
tagging and no document-walking is required — the note id is in the prefix.

- [ ] **Preferred: prefix reconciliation.** List assets under `eklavya/notes/{userId}/`,
      extract the noteId segment, and destroy anything whose note no longer exists in
      Mongo. This is the stronger option because it also catches the cases a
      document-walk misses: an image DELETED FROM A PAGE but still in the folder, and
      an INTERRUPTED CASCADE DELETE that removed some notes but not all their assets.
      Idempotent, so a failed run is simply re-run.
- [ ] Weaker alternative (previously recommended here — superseded): destroy on
      page-delete by walking the stored document for image URLs. It cannot see
      assets the student removed from the document, and a Cloudinary failure either
      blocks the delete or leaves the orphan anyway.
- [ ] Either way, deletion is best-effort and logged, never a precondition for the
      page delete succeeding.
- [ ] Profile photos need NO sweep: deterministic per-user public id with
      `overwrite: true`, verified — one asset per student, replaced in place.

**Confirmed live, not theoretical:** the e2e run left two real assets in Cloudinary
under a note that was then deleted. They are still there.
### Note-image size expectation (a prediction to check against)

Images are stored as **URLs, not bytes** — so an image node should add roughly a
Cloudinary URL's worth to the document, on the order of ~150 bytes including the
ProseMirror node wrapper. Against the 500 KB page cap that is negligible.

**So if the 80% `NOTE_APPROACHING_LIMIT` warning starts firing early once real uploads
work, that is a signal, not a nuisance:** it would mean something larger than a URL is
landing in the document — a base64 fallback, an inlined data URI, or a placeholder that
was never swapped. Treat an early warning as a bug report about the paste path, not as
a cap that needs raising.

### Workstream D — cached artefacts bake in the substrate they were generated on
- [ ] **Clear dev-generated roadmap module-quiz caches before launch.** A module quiz
      is generated ONCE and served for the life of the roadmap, and Workstream D makes
      its figure outcome final at that moment: `finalizeUnselected` records the
      "not sampled by the 0.35 share" decision, and a MODEL_DECLINED is terminal by
      design. Both are correct — they are what stops a cached quiz mutating on every
      revisit — but they mean the decision is locked to whatever model answered that
      day. Every roadmap cached during development had its figures decided by an 8b
      fallback after a 429, including a verification run where Class 10 Maths/Circles
      produced ZERO figures while Science/Light produced two on the same code.
- [ ] **A paid Groq key does NOT improve those retroactively.** Nothing re-opens a
      terminal decision; the one retry only covers questions whose generation errored
      or timed out, and it is consumed on first fetch. So dev-era roadmaps stay
      figureless permanently. Plan to drop `days.*.moduleQuiz` on dev roadmaps (or
      archive them) once the key is funded, rather than assuming the upgrade reaches
      already-cached content. Practice mode is unaffected — it regenerates every
      session and never caches.
- The general rule this is an instance of: **anything generated once and cached is a
      snapshot of the provider that answered at that moment.** The daily-lesson filler
      bug and this are the same shape — the fix there was to stop caching absent
      content; the fix here is to not assume a cache improves when the substrate does.

### Module-quiz lazy migration silently dropped Hindi translations and audio (FIXED)
- **Pre-existing, user-facing, unrelated to Workstream D** — found incidentally while
  wiring figures. `canonicalizeSubtopics()` in `server/src/routes/roadmap.js` rebuilds
  each question from an explicit field allow-list. Building explicit objects is the
  right call (the inputs are Mongoose subdocs and must not be spread), but the
  allow-list omitted `translatedHindiQuestionText`, `translatedHindiOptions`,
  `translatedHindiExplanation`, `hindiTranslated`, `audioQuestionEn` and
  `audioQuestionHi`.
- **Why it mattered:** that function is not only run on fresh generation. The LAZY
  MIGRATION branch runs it over questions that are ALREADY CACHED — any quiz cached
  before Phase 4 introduced `subtopics`. So a single quiz fetch wiped that day’s
  Hindi cache and its TTS audio URLs. A Hindi student silently paid to re-translate
  and re-synthesise the same questions, and the audio files already on disk were
  orphaned. Nothing surfaced it: the quiz still worked, just in English until
  re-translated.
- **Verified, not inferred.** Seeded a cached quiz carrying all six fields with
  `subtopics: []` (the migration trigger), fetched the day once in ENGLISH, and read
  the stored document back: all six were gone. With the allow-list extended they
  survive byte-identical. Reverting the fix reproduces the loss.
- **Swept for other instances — none found.** The failure mode is generic: a function
  that reconstructs a document from a named field set becomes silently destructive the
  moment a field is added to the schema and not to the list, and doubly so when it also
  runs over PERSISTED data. Every other `questions.map(...)` rebuild in `src/routes` is
  read-only response shaping. The one other explicit rebuild,
  `diagnostic.js` (session → DiagnosticResult), is safe for three separate reasons: it
  goes through `toObject()`, it already carries `diagram` through, and it BUILDS A NEW
  document rather than overwriting the one it read. That last property is the real
  distinction — `canonicalizeSubtopics` was dangerous because its output was written
  back over its own input.
- [ ] **Re-check this when adding any field to `moduleQuizQuestionSchema`.** The
      allow-list in `canonicalizeSubtopics` has to grow with the schema; there is no
      test that will fail if it does not, because the loss is silent and only on the
      lazy-migration path.

### A MISSING BLUEPRINT ROW IS NOT A DECISION (architectural constraint)
- **The two tables have different coverage.** `syllabusBlueprint.js` covers the exam
  grades (Class 10/11/12) with per-chapter detail. `taxonomy.js` covers all 280
  grade/subject/sub-subject identities, Nursery upward. So any decision derived
  synchronously from the blueprint answers a confident **false** for every lower grade,
  when the correct answer is "no entry here — fall through to the coarser table".
- **Two instances found, both fixed.** A duplicate `subjectDiagramEligible()` derived
  from chapter flags disagreed with the real taxonomy gate on 135 of 280 identities.
  Separately, the module-quiz figure gate resolved the day to a blueprint chapter and
  skipped figures entirely when it could not — so a Class 6 Maths module quiz never
  attempted a figure while a Class 6 Maths PRACTICE quiz did. Same student, same
  subject, silently different, and the retry path inherited it twice more (an empty
  chapter map in `needsDiagramRetry`, then again in `attachDiagrams`’ own filter).
- [ ] **Audit every `getBlueprint(` call site when adding one.** The test is simple:
      does the null branch produce a FALLBACK or a DECISION? A fallback is fine —
      `resolveBlueprint` generates one, `graftMissingChapters` and
      `buildBlueprintRoadmap` return null so the caller degrades, and the roadmap
      prompt just loses its chapter list. A decision is the bug. All current sites were
      swept and are clean; `npm run test:lowergrade` guards the module-quiz one.
- The general form, and the third time this shape has appeared in this build: **absent
  data being recorded as a negative answer.** The daily-lesson filler cached "no
  content" as final content; `generateDiagramFor` returned the same `null` for "no
  figure needed" and "generation failed"; a missing blueprint row read as "not
  eligible". In each case the fix is the same — make absence distinguishable from a
  verdict, and never let the first masquerade as the second.

### Workstream F — narration lifecycle
- **Fixed:** narration survived navigation. `window.speechSynthesis` is a browser
  singleton no component unmounts, an HTMLAudioElement is not on the DOM lifecycle,
  and playback was owned per-component so nothing could stop "whatever is speaking".
  All playback now lives in `client/src/utils/narrationController.js`; CI invariant
  10 fails the build on a second owner.
- [ ] **Verify on a real device with a real screen reader.** Headless Chromium has
      voices, but it is not a phone: Android WebView and iOS Safari both suspend
      audio on backgrounding with their own timing, and iOS in particular restricts
      `speechSynthesis` after the page loses focus. The `visibilitychange` and
      `pagehide` paths are verified in Chromium only.
- [ ] **Watch for a THIRD narration surface.** Invariant 10 catches `new Audio(` and
      `speechSynthesis.speak(`, but not a `<video>` element, an embedded YouTube
      player unmuting, or an `AudioContext`. The YouTube player on a day page is
      already a second sound source the controller does not own — it is not
      narration, so it is out of scope, but a student CAN currently have a video and
      a narration playing together.

### Dev tooling — the watcher restarts on every TTS write (cost us a whole session)
- **Symptom:** browser requests intermittently failed with `ERR_FAILED` and what
  looked like a CORS rejection, while `curl` to the same endpoint succeeded. The app
  then had no authenticated user, `ProtectedRoute` redirected, and a browser test
  reported "no speaker button on the page". Three plausible-looking wrong diagnoses
  came out of this: an origin mismatch, the rate limiter, and missing Groq content.
  All three were investigated and disproved.
- **Cause:** `npm run dev` used `node --watch src/server.js`. TTS writes WAV files
  under `server/uploads/audio/`, and every synthesis restarted the server — killing
  whatever request was in flight. The server log shows it directly:
  `[TTS Provider] Primary OpenAI TTS succeeded.` immediately followed by
  `Restarting 'src/server.js'`, **92 times** in one log.
- **A failed connection reads as a CORS error in the browser.** A preflight that
  gets no response at all is reported as "No 'Access-Control-Allow-Origin' header
  is present". So a restarting server and a genuine CORS misconfiguration look
  identical from the console. Check for a restart line timestamped near the failure
  before touching CORS config.
- **Partially fixed:** `dev` is now `node --watch-path=./src src/server.js`, which
  narrows it. That did NOT eliminate it — restarts still followed TTS writes even
  though `UPLOADS_DIR` resolves outside `src` and nothing under `src` changed. The
  residual trigger is NOT diagnosed.
- [ ] **Run acceptance suites against `npm start`, not `npm run dev`.** With no
      watcher: 0 restarts and 21/21 on `accept:narration`, immediately after the
      same suite had been failing at check 0. Worth fixing the watcher properly, but
      no browser test should depend on it.

#### AMENDED (Workstream I): part of this now HAS a cause — but not the part labelled undiagnosed
- **New evidence: duplicate dev servers demonstrably accumulate in this environment.**
  Observed directly while debugging something else — **two `npm run dev` processes,
  two vite processes, and seven orphaned `src/server.js` processes**, each holding a
  different port and its own Mongo connection. The reason they accumulated is that
  every cleanup command issued was `pkill`, **which does not exist in this Git Bash
  environment**; it failed silently (stderr swallowed by `2>/dev/null`) and reported
  success while doing nothing.
- **This DOES explain the connection-failure symptom class.** With several servers
  alive, a request can reach a *different process* than the one just restarted —
  including a stale build or one dying from `EADDRINUSE`. A request to a process that
  is going away is exactly the "`ERR_FAILED` / no `Access-Control-Allow-Origin`"
  signature already documented above, and it is intermittent for the same reason.
  Proven in this workstream: a browser talking to a server that predated the feature
  returned 404s that looked like missing code.
- **It does NOT explain the TTS-write correlation, so this entry is AMENDED, not
  CLOSED.** Re-verified today: `UPLOADS_DIR` is
  `path.join(__dirname, '../../uploads/audio')` from `src/utils`, i.e.
  `server/uploads/audio`, which is genuinely outside `./src`. A correctly-scoped
  `--watch-path=./src` should not fire on a TTS write, and the recorded observation
  that it still did remains unaccounted for. Do not mark it solved.
- [ ] **FIRST diagnostic step next time, before touching CORS, the watcher, or the
      rate limiter: count the processes.**
      `Get-NetTCPConnection -LocalPort 5000 -State Listen` for the owner, and
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` for the full list with
      command lines. If more than one server is alive, fix that before diagnosing
      anything else — three plausible-looking wrong diagnoses already came out of this
      symptom once.

### Shell commands in this environment need VERIFYING, not assuming — it is Windows
- **`pkill` is not available** in the Git Bash environment here, and neither are
  several other Unix reflexes. It does not error usefully; combined with `2>/dev/null`
  it reports success and has no effect.
- **This is the same class as the harness bugs recorded elsewhere in this file**: an
  operation that reports success and does nothing. A cleanup command is exactly where
  that is most expensive, because the whole point is to leave a known-good state, and
  "I already cleaned that up" then becomes a false premise for everything after it.
- **Rule: verify the effect, not the exit code.** After stopping a process, check the
  port is actually free. After deleting rows, count them. The check is one command and
  it is the difference between a clean state and a confidently-asserted wrong one.
- Windows equivalents that do work here:
  | intent | do not use | use |
  | :--- | :--- | :--- |
  | kill by port | `pkill -f ...` | `Get-NetTCPConnection -LocalPort <p> -State Listen` then `Stop-Process -Id <pid> -Force` |
  | list processes | `ps aux \| grep node` | `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` (gives full command lines) |
  | confirm a port is free | assume | `curl` the health endpoint, or re-query `Get-NetTCPConnection` |
- **Also recorded here because it cost real time:** ports **5060 and 5061** are SIP/SIPS
  and sit on the WHATWG Fetch **blocked-ports list**. Node's `fetch()` refuses them
  with an opaque `bad port` while `curl` connects happily — which reads as a broken
  test suite rather than a bad port choice.

### Workstream G — diagnostic results still serve the OLD Hindi register (USER-FACING, do next)
- **This is not tech debt. It is the first Hindi a student ever sees.** The diagnostic
  is the entry point — it runs before any roadmap, module quiz or practice session
  exists. So the one surface still serving the formal, textbook register is the one
  that decides whether a student thinks "this app talks like a textbook". Everything
  downstream now speaks the new register, which makes the inconsistency worse, not
  better: friendly Hindi in the roadmap, निम्नलिखित in the test that introduced them
  to the product.
- **What is already done:** module-quiz questions (`hindiRegisterVersion`), practice
  sessions (`hindiRegisterVersion`), roadmap day content/topic/focus
  (`hindiDayRegisterVersion`). All three retranslate once on first read and are
  proven end-to-end by `npm run test:register`.
- **What is not:** `DiagnosticResult.translatedHindiQuestions`. It is a PARALLEL
  ARRAY indexed against `questions[]`, not a per-question subdocument with its own
  flags — so `hindiIsStale()` has nothing to attach to and the fix needs a real
  schema change plus a migration that keeps the two arrays aligned. Genuinely more
  surgery than the others, which is why it was deferred, not because it matters less.
- [ ] **Do this next, not last.** Add a version to the result-level Hindi cache and
      retranslate on read, the same shape as the other three. Reuse
      `hindiIsStale()` — do not write a second predicate.
- [ ] Weak-topic labels need no work: they translate through `translateAndCache` and
      hold no persistent cache, so they pick up the new register automatically.

### The glossary is fixing a WIDER class than the two errors that prompted it
- The two failures that motivated `hindiGlossary.js` were वक्र दर्पण for "concave
  mirror" and खेलने for "playing audio". Widening the sample to ten strings
  immediately surfaced a third and worse one: **"Draw a tangent to the circle"
  translated as क्रिकेट पर एक टैंजेंट ड्रॉ करें — "draw a tangent on cricket".**
  The model resolved the sporting sense of the surrounding words and produced
  something a student reads as gibberish.
- **The lesson is about sample size, not about that string.** It had been happening
  the whole time and was invisible because nobody had looked at more than two
  examples. The two originally-reported regressions were the visible edge of a class,
  not the extent of it.
- [ ] **Widen `test:glossary` when adding terms, and read the WITHOUT column.** Its
      value is not the pass count — it is that the untreated output is printed next to
      the treated one, which is how the cricket case was found. A version that only
      asserted pass/fail would have hidden it.

### Diagrams now run on a PAID substrate — an exception to the provisional-numbers rule
- **What changed.** `generateDiagram.js` now calls **OpenAI first** (`DIAGRAM_MODEL`,
  currently `gpt-4o`) with Groq as the fallback — the inverse of the app-wide chain.
  Rationale is in the file header: diagrams are low-volume, tiny output, and the one
  task here needing genuine spatial reasoning, so this is the highest
  quality-per-rupee use of the paid key. **Do not "harmonise" this path** with the
  rest of the app.
- **Consequence for the substrate caveat.** Two numbers are NO LONGER PROVISIONAL,
  because they are now measured on the substrate production will actually use:
  - **SVG size** — new baseline below.
  - **Figure rate / MODEL_DECLINED frequency** — 8 of 10 probe questions produced a
    figure; 2 were declined as self-sufficient, which is the intended behaviour.
- **Still provisional, unchanged:** question difficulty, difficulty-audit rejection
  rate, round latency, translation register quality. Those all still run through the
  rate-limited Groq chain and must be re-measured when that key is funded.

#### SVG size — NEW BASELINE (not a confirmation of the old one)
| | old (Groq 8b under 429s) | new (`gpt-4o`) |
| :--- | :--- | :--- |
| min | 402 B | 559 B |
| avg | 547 B | 1018 B |
| max | 1318 B | **1545 B** |
| sample | 8 figures | 8 of 10 probes, across geometry / optics / circuits / biology |

- [x] **`CACHED_SVG_MAX_BYTES` stays at 8KB.** The largest real figure is 1545 B, so
      the cap carries **5.3x headroom**. Raising it was considered and deliberately
      not done — the tail risk the cap exists for (a pathological figure x4 per day
      x15 days inside one Roadmap document) is unchanged, and 5x headroom is not a
      constraint on detailed figures.
- **Growth was much smaller than expected (1.2x, not several times).** The reason is
      worth recording: better figures are not mostly BIGGER, they are better
      COMPOSED — shapes went from 1 to 6-16 per figure while bytes barely moved,
      because the old output wasted its size on labels rather than geometry.
- [ ] **Re-measure again if `DIAGRAM_MODEL` changes.** This baseline belongs to
      `gpt-4o`. A different model is a different substrate, and the same reasoning
      that invalidated the 8b numbers applies.

#### The truncation was a RUNAWAY, not a large figure — and raising maxTokens treated the symptom
- **First read of this was wrong and is corrected here.** Responses truncating
  mid-JSON (`Unterminated string...`) looked like detailed figures outgrowing the
  token ceiling, so `maxTokens` went 4000 → 8000. Truncation did not stop; it just
  moved, from ~11.7 KB of JSON to ~23.5 KB. That should have been the tell.
- **What is actually in a truncated response** (captured directly):
  `{"svg":1,"path":1,"line":249}` — **249 `<line>` elements, zero labels**, bouncing
  between the same four coordinates. The model gets stuck in a repetition loop. It is
  degenerate output, roughly 16-20x the size of a real figure, not detail.
- **Frequency:** 2 of 8 repeated runs on one optics question (~25%). The retry
  normally succeeds, so a student never sees it — the cost is a wasted large call.
- **The real fix is `MAX_DRAWING_ELEMENTS = 60`** in `validateDepiction()`
  (`DEGENERATE_REPETITION`), ~4x the largest legitimate figure. A token ceiling can
  only bound the waste; it cannot tell good detail from a loop.

#### Does this bias the size baseline? NO — checked, not assumed
- The concern is real in general: if the largest figures were the ones failing, then
  `max = 1545 B` would be the max of SURVIVORS and the 5.3x headroom claim would be
  weaker than it looks.
- **It does not apply here.** The two probes that produced no figure were both
  `needed: false` — **MODEL_DECLINED**, verified by inspecting the raw responses
  (19 bytes each). Neither was a truncation. And the truncations that do occur
  discard degenerate loops, not large legitimate figures.
- **Response composition is healthy**, which rules out the other explanation for a
  large payload: SVG is ~79% of a normal response, alt text ~100 characters, no
  extra keys, no prose before the JSON. Nothing hidden is eating the budget.
- [ ] **Re-check this if `DIAGRAM_MODEL` changes.** A model that produces genuinely
      larger figures WOULD bias the baseline the way described above, and the check
      is the same one: confirm every non-figure is a decline rather than a drop.

### Workstream H — board reduction: what was decided about existing accounts
- **The board list is now CBSE + Haryana Board (HBSE).** Seven boards and the `Other`
  free-text escape were removed. This is a product statement, not a cleanup: offering
  a board we cannot supply a syllabus for was already a false promise, and once
  Features 25/26 exist it becomes a promise of specific past papers that will never
  appear.
- **The migration EMPTIES rather than guesses, and preserves rather than deletes.**
  `server/src/scripts/backfill-board.js` sets `profile.studyMedium = ''`, copies the
  student's original answer to `profile.legacyStudyMedium`, and sets
  `profile.boardNeedsReselect` so they are asked **once** on next login.
  - *Why not leave the legacy value in place, non-selectable?* Because the board is
    now the key the past-paper corpus is queried by. An account left on `ICSE`
    resolves to "no papers available" on every subject, in every year, forever — and
    the empty state is honest about the corpus while being silent about the real
    cause, which is the stale profile.
  - *Why not map ICSE to CBSE?* They are different boards. A silently re-boarded
    student would be shown CBSE papers as if they were theirs — Design Rule 16 from
    the other direction.
  - *Why not reset `onboardingCompleted`?* That would push someone through all five
    profile steps to re-answer one question. The flag drives a single prompt instead,
    and it clears on dismiss as well as on choice so it cannot wedge an account.
- [ ] **Run the dry-run against production data before applying.** It reports
      per-board counts **before** it writes. A surprising number there is the signal
      to stop and reconsider, not to type `--apply`.
- [ ] **`backfill-board.log.json` is required for `--rollback`.** It records each
      account's own previous board, because rollback restores per-account — a single
      `updateMany` cannot, and writing one board to all of them is exactly the guess
      the migration refused to make going forward.

### Workstream I — PYQ corpus coverage: THE FEATURE'S VALUE IS BOUNDED BY CONTENT, NOT CODE
- **This is the honest framing and it should not be softened.** Every acceptance
  criterion for Features 25/26 passes against a corpus of **one seeded test paper**.
  The code is complete; the feature is not *useful* until real papers are imported.
  A Class 10 student opening Past Papers today sees the honest empty state, which is
  correct behaviour and zero value.
- **Import status — UPDATE THIS TABLE AS PAPERS ARE ADDED.**

  | Board | Grade | Subject | Years imported | Status |
  | :--- | :--- | :--- | :--- | :--- |
  | CBSE | Class 10 | Maths | — | **none imported** |
  | CBSE | Class 10 | Science | — | **none imported** |
  | CBSE | Class 10 | Social Science | — | **none imported** |
  | CBSE | Class 12 | Physics / Chemistry / Biology / Maths | — | **none imported** |
  | HBSE | Class 10 | Maths / Science / Social Science | — | **none imported** |
  | HBSE | Class 12 | core subjects | — | **none imported** |

- [ ] **Target the realistic starting corpus: ~5 years across the core subjects for
      both boards.** Both boards publish past papers publicly. At roughly 5 years x 4
      subjects x 2 grades x 2 boards this is on the order of 80 papers — an
      afternoon of admin work per board, not an engineering task.
- [ ] **Budget the import calls.** One `PYQ_MODEL` (gpt-4o, vision, `detail: high`)
      call **per page**. A 30-page paper is 30 calls; 80 papers is roughly 2,000-2,500
      vision calls **one time**. This is a one-off content cost, not a per-student
      runtime cost — price it before starting the bulk import rather than discovering
      it midway.
- [ ] **Every paper must be reviewed before publish, and the review is the point.**
      A parse that is wrong looks exactly like a parse that is right. Publication is
      already blocked when a question references a figure it does not have, or a
      figure has no admin-written alt text — but nothing can block a *plausible wrong
      transcription*, and only the admin can catch it.
- [ ] **Check the `fallback` flag on every imported paper.** A paper parsed by the
      Groq text-only fallback (OpenAI unavailable at import time) is flagged in the
      review UI. Structure — sections, figure placement, marks in margins — is much
      more likely to be wrong on that path. Prefer to **delete and re-import** such a
      paper once OpenAI is reachable rather than hand-correcting it.

### PYQ import runs on a PAID substrate — extend the diagram exception to it
- **What changed.** `utils/parsePastPaper.js` calls **OpenAI first** (`PYQ_MODEL`,
  currently `gpt-4o`, with vision) and uses Groq only as a text-only availability
  fallback — the same inversion as `DIAGRAM_MODEL` and `JUDGE_MODEL`. Rationale is in
  the file header. **Do not "harmonise" this path.**
- **Consequence for the substrate caveat.** Parse quality joins diagrams and judges as
  **NOT provisional**: it is measured on the substrate production will use. The other
  numbers in this repo — question difficulty, difficulty-audit rejection rate, round
  latency, translation register — are unchanged and still provisional, because they
  still run through the rate-limited Groq chain.
- **Measured so far (small sample, be honest about it).** One synthetic single-page
  paper: 3 of 3 questions extracted, both sections identified, wording verbatim
  (`"The HCF of 96 and 404 is: (a) 2 (b) 4 (c) 8 (d) 12"`), the figure-referencing
  question correctly flagged `figureExpected`. **This is a smoke test on a clean
  digitally-generated PDF, not a quality baseline** — a real scanned board paper with
  multi-column layout and margin annotations is a materially harder input.
- [x] **Establish the real baseline on the first genuine board paper.** DONE —
      measured against the official CBSE Class 10 Science SQP. See "Parse quality on
      a REAL board paper" near the end of this file. **The result is worse than this
      section's synthetic smoke test implies: 71 questions extracted from a
      39-question paper.** Read that section before planning the bulk import.
- [ ] **Re-measure if `PYQ_MODEL` changes.** Same reasoning that invalidated the 8b
      numbers: a different model is a different substrate. Parse accuracy is also the
      one number here where a regression is silently cached as ground truth.

### ~~PYQ figure crops are Cloudinary TRANSFORM URLs~~ — SUPERSEDED, the trade-off is GONE
> **This section is obsolete. Figures are no longer crops of a rendered page.** They
> are extracted from the PDF's own embedded image objects and uploaded as their own
> assets, so there are no crop parameters to strip and no way to walk back up to the
> full page. The exposure described below **no longer exists** — it was not mitigated,
> it was designed out. See "Figures now come from the PDF's embedded image objects".
>
> Kept rather than deleted because the reasoning in the last bullet still stands on
> its own: a crop is a presentation instruction, not an access control, and that
> remains true for anything that might reach for the pattern later.


- **What it is.** A figure's `diagramUrl` is a crop transformation over the stored
  **full rendered page image**, not a separately-uploaded cropped asset. This is what
  makes the I3 re-crop requirement cheap: correcting a bad automatic crop changes four
  numbers on a document, with no re-upload and no re-processing, and the full page is
  always still there to crop again.
- **THE TRADE-OFF, stated deliberately: anyone who strips the crop parameters from
  the URL gets the whole rendered page.** A crop is a presentation instruction, not an
  access control.
- **Why it is acceptable here, and only here.** These are published past papers —
  documents the boards themselves put in public. Nothing is disclosed that was not
  already public, so the exposure is of a public document to someone who already has
  a link to it.
- [ ] **DO NOT REUSE THIS PATTERN FOR ANYTHING PRIVATE** without revisiting it.
      Student work, uploaded ID documents, note images, anything user-authored: a
      transform URL would leak the surrounding page. Those need a separately-uploaded
      derived asset or a signed URL. The reasoning above depends entirely on the
      source document already being public, and that property does not travel.

### Workstream I — accepted limitations (not defects, but write them down)
- **Written answers are not machine-marked.** Exam results auto-score MCQs only;
  written answers are shown for self-review. The existing essay grader is tuned to
  short revision answers, and scoring a 5-mark board answer with it would put a
  number on the paper that the real marking scheme would not recognise. A student
  sees `marksAwarded` over the MCQ portion, clearly labelled.
- **"Time spent per section" is a lower bound, not a stopwatch.** It is the interval
  between the first and last answer stamped in that section, so a student who reads a
  section and answers nothing registers zero. The UI prefixes it with `~` for that
  reason. Real per-question timing would need client-side focus tracking, which is
  both more invasive and less trustworthy than the thing it would measure.
- **The generated exam-style path is per-student runtime cost on OpenAI.** Workstream
  I routes every model call to OpenAI, and `generateExamStyle.js` follows that — but
  the "volume is low" argument that justifies `PYQ_MODEL` **does not transfer** to it,
  because generating a paper is a per-session cost. It therefore uses the cheaper
  `PYQ_GENERATION_MODEL` (`gpt-4o-mini`, the same model the app-wide chain already
  falls back to). If this path becomes hot, revisit **it** specifically — do not move
  the parse back onto Groq. A bad generated question wastes a student's time; a bad
  parse is cached as ground truth.
- **JEE and NEET get no exam mode.** They are competitive entrance exams, not board
  exams, and their paper patterns are nothing like a board paper's.
  `blueprintFor()` returns `null` and the UI says exam mode is unavailable — better
  than rehearsing the wrong exam.
- **Classes Nursery-5 get no exam mode either.** A timed, sectioned mock paper is not
  a meaningful artefact for a six-year-old; inventing one would be template filler.
- **Non-board-grade blueprints are DERIVED, not authoritative.** Neither CBSE nor
  BSEH publishes a paper design for Classes 6-9 and 11 — those grades are examined
  internally by the school. The structures in `examBlueprints.js` are scaled from the
  published Class 10/12 designs (which schools model internal exams on), and the file
  header says so along with its sources and search date. This is why the UI calls
  them "exam-style practice" and never "your exam".
- [ ] **Board patterns change. Re-check `examBlueprints.js` against current CBSE/HBSE
      sample papers each academic year** — the header records that the current values
      were web-searched on 31 July 2026.

### Blueprint sources are now PRIMARY — and checking them found a real error
- **What changed.** `examBlueprints.js` cited coaching/aggregator sites
  (vidyarohi, collegedekho, selfstudys, oswal, studocu, kollegeapply). For a
  state-government deployment that is not a defensible provenance answer, and the
  fix costs nothing: **the sample paper IS the pattern**, so the official PDF is the
  same download. Citations are now the boards' own:
  - CBSE Class X: https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html
  - CBSE Class XII: https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html
  - BSEH model papers + stepwise marking schemes:
    https://bseh.org.in/model-paper-stepwise-marking-scheme-classwise-202526
- **The check was not a formality — one of three was materially wrong.** The
  aggregators described CBSE Class 10 Science as five question-type sections
  (A 20x1, B 6x2, C 7x3, D 3x5, E 3x4). The official SQP says verbatim: *"This
  question paper consists of 39 questions in 3 sections. Section A is Biology,
  Section B is Chemistry and Section C is Physics."* Sectioned **by discipline**, not
  by question type. A Class 9 mock built on the aggregator shape would not have
  resembled the exam at all. Maths (38 q / 80 marks) and Class 12 Physics
  (33 q / 70 marks) were checked the same way and were correct as encoded.
- **Confidence is now recorded per figure rather than uniformly.** Verified verbatim:
  section structure, question counts, totals, duration. Verified by two independent
  official documents agreeing (SQP and Marking Scheme): Science Section A = 30 marks
  as 9x1 + 3x2 + 2x3 + 1x4 + 1x5. **Still assumed:** the Chemistry/Physics split of
  the remaining 50 marks (an even 25/25). Extracting the marks column for those two
  sections gave *inconsistent* results between the SQP and the MS, so nothing from
  that heuristic was encoded.
- [ ] **Confirm the Chemistry/Physics mark split** from the official Science Marking
      Scheme when the corpus is collected.
- [ ] **HBSE IS STILL UNVERIFIED, and its secondary sources contradict each other.**
      One says Class 10 Science is 60 theory + 20 practical + 20 CCE over 3 hours;
      another says every subject is 80 theory + 20 internal over 3 hours 15 minutes.
      The HBSE-specific 60-mark Science pattern was **removed** rather than kept —
      encoding a contested number as settled is worse than using one shape for both
      boards at a non-board grade. Reintroduce a divergence only once the BSEH model
      paper confirms one. **Download the BSEH model papers at the same time as the
      HBSE past-paper corpus** — same site, same trip.

### Parse quality on a REAL board paper — first measurement, and it is not good enough to trust
- **Measured 31 July 2026** against the official CBSE Class 10 Science SQP
  (`Science-SQP.pdf`, 15 pages), using the real `parsePastPaper()` on `PYQ_MODEL`
  (gpt-4o, vision, `detail: high`). This replaces the earlier synthetic-PDF smoke
  test as the baseline.
- **Results:** 15/15 pages parsed, no page failures, no fallback. Duration (180 min)
  and total marks (80) read correctly. **But: 71 questions extracted from a
  39-question paper**, and the section assignment drifted badly — 27/8/3 against a
  true 16/13/10. ~129 seconds wall clock for 15 pages.
- **What this means.** Over-extraction is the dominant failure mode on a real paper:
  sub-parts `(a)/(b)`, internal-choice `OR` alternatives, and questions spanning a
  page boundary each get counted as separate questions. Section drift follows from
  the same cause. **This is exactly why the admin review step is mandatory and why
  the draft is not student-visible** — but it also means reviewing a real paper is
  substantial work, not a rubber stamp: an admin must delete roughly half the rows
  and re-assign sections.
- [ ] **Improve the parser before the bulk import, or budget the review time
      honestly.** Two cheap, high-value changes to try first, in this order:
      (1) feed the model the running question-number sequence so far and instruct it
      that sub-parts and `OR` alternatives belong to the CURRENT question rather than
      starting a new one; (2) pass the paper's stated question count and section
      structure (read once from page 1) into every page's prompt as a constraint, so
      section assignment is anchored instead of re-guessed per page.
- [ ] **Re-measure against the same paper after any parser change.** `Science-SQP.pdf`
      is a good regression fixture precisely because it is hard: 3 discipline
      sections, internal choice throughout, and figures interleaved with text.
- **Do not read the earlier synthetic-PDF result as a quality signal.** A clean
  single-page digitally-generated PDF exercised the plumbing, not the parsing.

### Parse baseline v2 — after the structural fixes. THE REVIEW STEP IS A COST MODEL.
- **Same fixture, same model, measured 31 July 2026.** Official CBSE Class 10 Science
  SQP (15 pages), real `parsePastPaper()` on `PYQ_MODEL` (gpt-4o vision).

  | | v1 (isolated pages) | v2 (anchored + folded) | truth |
  | :--- | ---: | ---: | ---: |
  | questions | 71 | **41** | 39 |
  | Section A (Biology) | 27 | **16** | 16 |
  | Section B (Chemistry) | 8 | **15** | 13 |
  | Section C (Physics) | 3 | **10** | 10 |
  | marks A / B / C | — | **30 / 25 / 25** | 30 / 25 / 25 |
  | total marks | 80 | 80 | 80 |
  | duration | 180 | 180 | 180 |
  | pages failed | 0 | 0 | — |
  | wall clock | 129 s | 144 s | — |

- **What fixed it.** Three changes, all structural rather than prompt-polish:
  1. **Anchoring.** The paper's own General Instructions are read once from page 1 and
     carried into every later page as a constraint, along with the last question
     number and the section in progress. Previously each page was parsed in
     isolation, so a page in the middle of Chemistry had no local evidence it was
     Chemistry — the heading was ten pages back. This is quoting the paper at itself,
     not feeding the model its own earlier guesses.
  2. **Folding.** Continuations, repeated numbers and `OR` alternatives are folded
     after parsing, in code. The prompt also instructs it, but a prompt is a request
     and the fold is a guarantee.
  3. **`OR` modelled, not excluded.** See the schema note below.
- **A self-check now ships with every parse.** The paper states its own question
  count; the parse compares against it and returns a `discrepancy`. "This paper says
  39 questions, we extracted 41" is immediately actionable in a way that 41 unlabelled
  rows is not. It is a warning, never a rejection — a disagreeing paper is the one
  that most needs review, not the one to discard.
- **Two incidental fixes, both measured rather than guessed:** `PARSE_MAX_TOKENS`
  8000 -> 12000 after a real truncation on page 11 (`Unterminated string in JSON at
  position 16256`); and `choiceKeyOf()` fell back to `String(q._id)`, which is
  `"undefined"` for un-persisted parser output, so every non-choice question keyed to
  one bucket and a 39-question paper counted as **5**. A distinctness helper that
  silently makes everything identical is worse than no helper — it now falls back to
  object identity.

- [ ] **TIME A REAL CORRECTION BEFORE COMMITTING TO A CORPUS SIZE. This is the
      number that decides the feature's scope.** The parse is now reviewable rather
      than a from-scratch rebuild — Sections A and C are exact, marks are exact, and
      the residual is +2 questions in one section — but "reviewable" is still not
      free. Sit an admin down with `Science-SQP.pdf`, have them correct the draft to
      publishable, and record the wall-clock minutes here:

      Measured correction time for one paper: ______ minutes

      At 15 min/paper an 80-paper corpus is ~20 hours — a week of afternoons, fine.
      At 90 min/paper it is ~120 hours, and the honest plan is **15 papers covering
      the highest-traffic subject/year combinations**, not 80. Do not choose the
      corpus size before this number exists.
- [ ] **Re-measure against `Science-SQP.pdf` after ANY parser or model change.** It
      is the regression fixture precisely because it is hard: 3 discipline sections,
      internal choice throughout, figures interleaved with text, and a known correct
      answer. A real paper with a known answer is worth more than any synthetic test
      here.
- **Residual, known:** +2 questions in Section B (Chemistry). Not chased further
  because the remaining error is now within what review comfortably absorbs, and the
  next measurement that matters is the human one above, not another parser round.

### Internal choice ("Q31 ... OR ...") is now modelled, not papered over
- **It was not representable at all.** `PyqQuestion` had no notion of an either/or
  pair — and worse, the schema comment offered `"31 OR"` as an example
  `questionNumber`, which is the phenomenon being *noticed* and then encoded as a
  string suffix. That representation cannot answer any question the app actually
  asks (how many questions is this paper, how many marks are available, which
  alternative did the student attempt) and it silently inflated the question count,
  which was one cause of the 71-from-39 over-extraction.
- **How it works now.** Each alternative is its own document — it has its own text,
  options, figure and Hindi translation — tied by a shared `choiceGroup`, with
  `choiceIndex` 0 for the alternative printed first. Counting questions means
  counting distinct choice groups; a group contributes its marks **once**.
  `countChoiceGroups()` / `availableMarks()` / `groupByChoice()` centralise that so
  no call site re-derives it.
- **Scoring rule, stated deliberately:** if a student somehow answered both
  alternatives, the **first in paper order** is marked. That is what an examiner does
  with a script that answers both, and marking the higher-scoring one would reward
  ignoring the rubric. The exam UI locks the other alternative once one is answered,
  so this is a server-side backstop for a hand-crafted request rather than a normal
  path — but the two must agree, and they do.
- [ ] **Verify against a paper with heavy internal choice at import time.** The
      Science fixture has 7 choice groups; a Maths paper typically has more.

### THE FIXTURE IS IMPORTED AND WAITING. The human number is the next action.
- **A real draft now exists in the database**, imported through the real pipeline
  (same parse, same uploads, same `toPyqDocument` mapping the HTTP route uses):

      CBSE / Class 10 / Science / year 2026
      "Science (SQP 2025-26) — REVIEW TIMING FIXTURE"
      parsed with: gpt-4o (vision)   status: draft (NOT student-visible)

  Year 2026 and the shouty title are deliberate — it must be impossible to mistake
  this for real corpus content. **Delete it when the measurement is done:**

      node src/scripts/import-paper.js --delete --board CBSE --grade "Class 10" \
        --subject Science --year 2026 --title "Science (SQP 2025-26) — REVIEW TIMING FIXTURE"

- **Its content is now baselined, so "the fixture is unchanged" is a check rather
  than an assumption.** Recorded 31 July 2026, after eleven other papers had been
  imported around it:

      content hash : 6729fe7556bf9be1c00bdf279be87dd5e32447cb15154bc23d9a0759310329fc
      rows         : 47      status: draft      __v at record: 3

      node src/scripts/pyq-baseline.js --verify     # exit 1 on drift

  The hash covers parsed content only — question text, marks, numbering, structure,
  section names — and deliberately excludes `_id`, timestamps and `__v`. Excluding
  `__v` is the point: a save that changes nothing must not read as tampering, and an
  edit that changes content must not be able to hide behind an unchanged counter.
  `--record` refuses to overwrite an existing baseline without `--force`, because a
  baseline you can silently rewrite is not one.

  **Why this was needed:** before it, the claim rested entirely on nobody having run
  an import against the fixture — an argument about intent, not evidence. `PastPaper`
  has no `timestamps: true`, so there is no `updatedAt` and no audit trail; the only
  historical signal is `__v`, and see the note below on how little it can tell you.

#### What the fixture's three `__v` saves were

The fixture sits at `__v: 3`. Mongoose's version counter is not a save counter — it
increments only on writes that could shift array indexes — so the first step was to
measure the rules rather than recall them. Against the real `PastPaper` model, on a
throwaway row (deleted after):

      create                                          -> __v 0
      save() changing a scalar only                   -> +0
      save() assigning sections[]                     -> +1
      save() assigning publishedWithWarnings[]        -> +1   (the publish route)
      findByIdAndUpdate, no array in the update       -> +0   (the unpublish route)
      save() assigning pageTrust[]                    -> +1   (a re-parse)

Two stored facts then pin the history, because every array field on `PastPaper`
defaults to `[]` and is therefore written by any full `save()` once it exists in the
schema. The fixture **has** `publishedWithWarnings` and **does not have** `pageTrust`.
So its last write happened after `publishedWithWarnings` was added (the warn-don't-block
work) and before `pageTrust` was added (the per-page text-trust work) — which brackets
it to before the parser evaluation began. Reconstruction:

  1. **Import completion** — `paper.sections = parsed.sections; save()`. Certain: the
     paper is `uploadedBy: 'cli'`, and this is the only array write on the CLI path.
  2. **Publish** — assigns `publishedWithWarnings[]`. High confidence: the field is
     present on the doc, and the fixture was published (then unpublished on request).
  3. **A second publish** — the warn-don't-block flow returns warnings first and needs
     a confirming re-POST, which re-assigns the same array. Plausible, not proven.

  The **unpublish contributed nothing** (measured +0), which is why the counter sits at
  3 rather than 4 despite the paper having round-tripped through published.

Three things are established beyond inference, and they are the ones that matter:
`_id` still equals `createdAt` (19:41:51), and `--replace` deletes and recreates with a
fresh `_id`, so **the paper has never been re-imported**; `pageTrust` is absent, so **no
re-parse has ever touched it**; and all 47 questions are at `__v: 0` with identical
`_id` timestamps, so **not one question has ever been edited** — which also confirms the
human correction-time measurement is still outstanding, not merely unrecorded.

Save 3 is a reconstruction, not a record, and it cannot be made into one retrospectively.
That is the argument for the baseline above: from here the question "has it changed?" is
answered by a hash, and `__v` goes back to being what it is — a concurrency token that
makes a poor audit log.

- **Its correction worklist, as printed by the import:**

      40 questions vs 39 expected     -> delete ~1 spurious row
      Section A  16 questions, 30 marks   (matches truth)
      Section B  15 questions, 25 marks   (truth 13 — 2 spurious)
      Section C   9 questions, 21 marks   (truth 10 / 25 — page 11 failed, see below)
      11 figures need admin-written alt text   BLOCKS PUBLISH
       1 question references a figure not extracted (Q27)  BLOCKS PUBLISH
      11 crops to eyeball
       7 questions carry no marks value
       4 internal-choice (OR) groups to verify
      ~20 discrete edits over 44 rows

- [ ] **CORRECT THIS PAPER AND TIME IT. Nothing downstream should be decided first.**

      Measured correction time for one paper: ______ minutes

      Then choose scope from the number, not from ambition:
      - **~15 min/paper** -> 80 papers is ~20 hours, a fortnight of evenings. Do it.
      - **~90 min/paper** -> 80 papers is ~120 hours. The honest plan is a focused
        **15**: Class 10 Science, Maths and Social Science, last three years, both
        boards. That is a genuinely useful product and much better than 80
        half-corrected papers.

      A bulk import is now one command per paper (`src/scripts/import-paper.js`), so
      the machine half of the cost is not the constraint — the human half is, and it
      is the only half that has never been measured.

### Known parse defect: page 11 fails on this fixture, and it is NOT the count drift
- **Symptom.** Page 11 of the Science SQP returns `PARSE_MODEL_RETURNED_INVALID_JSON`
  on every run, at both `maxTokens` 8000 and 12000. It costs a page of Section C:
  9 questions / 21 marks against a true 10 / 25.
- **NOT chased, deliberately.** It is queued behind the human timing measurement,
  which is the number that decides whether more parser work is worth doing at all.
  Recording it so it is not rediscovered as a mystery.
- [ ] **Likeliest cheap fix, to try when parser work resumes:** retry ONCE on a JSON
      parse failure. The retry logic added to `callOpenAIChat` covers transient HTTP
      failures but deliberately not malformed JSON, because a 400 should never be
      retried — a JSON failure is a different case and probably is recoverable. Try
      that before anything structural.
- **Note for the timing measurement:** a failed page is realistic correction work —
  real imports will have them — so time the fixture AS IS rather than waiting for
  this fix.

### `callOpenAIChat` now retries transient failures — found by an import degrading silently
- **What happened.** An import fell all the way to the text-only fallback while
  `PYQ_MODEL` was perfectly healthy. Diagnosed afterwards: ~60 high-detail vision
  calls in quick succession tripped a rate limit, `callOpenAIChat` returned `null`
  (it cannot distinguish a transient 429 from a hard failure at its boundary), and
  the parse degraded. **A whole paper was parsed on the weak path because of a
  momentary limit** — and would then have been cached as ground truth and reviewed by
  an admin trusting it.
- **A bulk corpus import makes this a certainty, not a risk.** 80 papers is thousands
  of vision calls; rate limits WILL be hit.
- **Fix.** `callOpenAIChat` takes an optional `retries` (default **0**, so every
  existing caller is byte-for-byte unchanged) with exponential backoff, honouring
  `Retry-After`. Retried only on genuinely transient statuses
  (408/409/429/500/502/503/504). **400 is never retried** — retrying a request the API
  rejected on its merits just triples the latency before the same failure. The PYQ
  parse opts in with `retries: 3`, because falling back there costs a whole paper
  rather than one worse figure.
- **`maxTokens` ceiling recorded:** gpt-4o accepts at most **16384** completion
  tokens and returns a hard 400 above it (verified directly). Since 400 is not
  retried and returns null, exceeding it would silently degrade every paper to the
  text-only path and would LOOK like a rate-limit problem while being a
  configuration one.
- **Mislabelling fixed.** `parsedWithModel` used to report `"groq-fallback
  (text-only)"`. `callGroqChat` has its own internal chain ending at OpenAI
  gpt-4o-mini, so a fallback parse may never have touched Groq — the label named the
  wrong provider to precisely the reader who depends on it (the admin deciding
  whether to re-import). It now reports `"fallback: text-only (no vision)"`, which is
  what actually matters and is true either way.

### Import mapping is now guarded by CI — it had already silently dropped a field
- `choiceGroup` / `choiceIndex` were added to the schema and the parser, and the
  import mapping (an explicit field list, inline in the route handler) did not carry
  them. **Nothing failed.** The import would have succeeded and stored every "OR"
  alternative as an independent question — exactly the over-counting the choice
  modelling exists to prevent. A right parse and a wrong database.
- This is the same failure as `canonicalizeSubtopics` (CI invariant 8), in a second
  place. The mapping is now an exported `toPyqDocument()` driven by CI invariant 14
  with a fully-populated parsed question, so any field added to `PyqQuestion` and not
  carried fails the build **by name**. Do not inline it back into the handler.
- One field is exempt, listed explicitly with its reason:
  `hindiRegisterVersion` must stay absent on a fresh import, because absence means
  "pre-versioning" and initialising it would assert a translation that never
  happened. An unexplained exemption list is how a real omission hides in a passing
  test, so the reason is in the invariant.

### Two small environment traps recorded so they are not rediscovered
- **`import 'dotenv/config'` must be the FIRST import in any script touching
  Cloudinary.** `utils/cloudinary.js` reads env at MODULE LOAD, and ESM evaluates all
  imports before the body runs — so a `dotenv.config()` call further down leaves it
  initialised as unconfigured and the script dies with "Cloudinary is not configured"
  on a machine where it plainly is. `server.js` already documents this; the other
  backfill scripts get away with body-level config() only because they read
  `MONGODB_URI` at call time. `src/scripts/import-paper.js` follows the server.
- **Do not run the test server on port 5060 or 5061.** They are SIP/SIPS and sit on
  the WHATWG Fetch **blocked-ports list**, so Node's `fetch()` refuses them with an
  opaque `bad port` while `curl` connects happily — which reads as a broken test
  suite rather than a bad port choice. `TEST_PORT=5070` is fine.

### The admin console reported "no papers imported yet" for a paper that HAD imported
- **Root cause: the running server predated the feature.** The process serving port
  5000 was started before Workstream I existed and 404s both `/api/pyq-admin/*` and
  `/api/pyq/*`. Nothing was wrong with the database, the query or the environment —
  the document was present with `parseStatus: 'draft'`, the admin list query has **no
  filter at all** (`PastPaper.find()`), and the import script and server share one
  `MONGODB_URI` and one `eklavya` database. All three were checked by dumping rather
  than asserting. **Fix: restart the server.**
- [ ] **Restart any long-running dev server after pulling this workstream.** Obvious
      in hindsight, invisible at the time, and it cost a full misdiagnosis cycle.

### A FAILED REQUEST IS NOT AN EMPTY LIST (fixed)
- **What made the above hard to see.** `PyqAdminPanel` did
  `const d = await res.json(); setPapers(d.papers || [])` with no status check, and
  rendered "No papers imported yet." whenever the list was empty. A 404 therefore
  rendered as a confident, false statement **about content**.
- **Why that is worse than an unhandled error.** The two states demand opposite
  responses: "no papers imported" says re-import, "cannot reach the server" says fix
  the server. Conflating them sends someone to debug a pipeline that is working.
- **Fixed:** the status is checked, a 404 is named specifically ("the running server
  may predate this feature — restart it"), and the "none imported" row now renders
  only when the request actually SUCCEEDED and came back empty. Same principle as the
  student-side empty-corpus rule: absence of data and failure to load are different
  states and must never render identically.

### The 56/56 suite could not see the review screen being unreachable — Rule 11 again
- **The blind spot, precisely.** Every existing check verified that the import WROTE
  correctly — by reading the database. Not one verified that the admin could then
  FIND what was written, by calling the route the review UI actually calls. The
  harness observed the system from outside its real mechanism, so it passed at 56/56
  while the feature was unusable end to end. That is Design Rule 11 in a new place.
- **Now asserted, and proven sensitive.** `test:pyq` drives `GET /pyq-admin/papers`
  and `GET /pyq-admin/papers/:id` with a minted admin token (signed with the app's own
  JWT_SECRET in the exact shape `routes/admin.js` issues, so the real middleware and
  the real route run — admin login is env-configured and impossible in a test
  environment). It asserts a draft appears in the list, carries `parseStatus:'draft'`
  so the UI can mark it, reports its question count, and that the review screen opens
  and returns its questions.
- **The test was verified to FAIL against the broken condition** — pointed at the
  stale server it returns 404 and the assertion fails; against the current build it
  returns 200 and passes. A check that has never been observed failing is not yet
  known to be a check (Design Rule 9's "a test double must be able to represent the
  failure").
- **The counterpart is asserted SEPARATELY, not inferred.** Students must not see
  drafts — but the admin list has no filter at all, so student invisibility is a
  property of a *different query in a different router*. Deriving one from the other
  would assume the thing worth checking. Four independent assertions: a draft is
  absent from `availability`, contributes no year to the selector, cannot be
  practised (404 `NO_PAPERS_AVAILABLE`), and cannot be started as an exam — plus a
  fifth showing that flipping the SAME paper to `published` makes it appear, which
  proves both views are driven by status rather than coincidentally both empty.

### Figures now come from the PDF's embedded image objects — no crop, no crop editor
- **The hypothesis was right.** Figures in these papers are embedded IMAGE OBJECTS
  placed by the authoring tool, not ink on a rendered page. Measured on the CBSE
  Class 10 Science SQP: **13 embedded images across 15 pages**, every sampled one a
  genuine question figure (digestive system, atomic shells, ray optics, circuits,
  a camera/lens diagram).
- **Better than any crop, on every axis:**
  - **Exact bounds**, from the PDF's own structure — no model-guessed pixel box, so
    nothing to re-crop and no crop editor to build or maintain.
  - **Original resolution** — up to 814x350 and 794x641, against ~230x240 for the
    same figure cropped from a 150 DPI page render. The screen-density question
    stops existing.
  - **No crop-URL exposure.** The figure is its own asset. The trade-off recorded
    earlier in this file is designed out, not accepted.
- **The model's job shrank to the part it is good at.** It no longer guesses a
  bounding box; it is handed the page's already-extracted figures (numbered, with
  their position down the page) and only decides WHICH QUESTION each belongs to.
  Reading-order judgement instead of pixel geometry.
- **Unassigned figures are surfaced, not dropped.** A figure no question claimed is
  either decorative or a question's figure that was missed, and only review can tell.
  The import reports them by number.

#### THE TRAP: mupdf's `toPixmap()` does not apply a PDF soft mask
- An image whose transparency lives in a separate `/SMask` decodes to its raw RGB —
  which for these figures is a **black background**, because the artwork is drawn
  white-on-transparent. Rendering that gives a black rectangle with barely-visible
  strokes. `getMask()` returns the mask as its own image and it must be composited by
  hand.
- **A version that ignores masks looks like it works**: on page 11 of the fixture,
  one figure has a mask and the other does not.
- A `DrawDevice` was tried first and was worse — black background AND a vertical flip,
  because `fillImage`'s matrix maps the unit square with an inverted y-axis and it
  does not apply the SMask either. Manual pixel compositing is explicit and has no
  orientation to get wrong.

#### THE WORSE TRAP: `getPixels()` returns a VIEW into the WASM heap
- Allocating anything in mupdf afterwards can GROW that heap, which **detaches every
  existing view**. Reads then silently return zeros, which composite to a solid black
  rectangle — indistinguishable from a content problem.
- **It bit twice, in the same function.** First on the source pixels (fixed by copying
  them out with `Uint8Array.from` before allocating the destination). Then again on
  the way out: the uniform-colour sanity check ran AFTER `asPNG()`, which allocates —
  so it read a detached array, saw all zeros, and declared every figure blank. Two
  figures vanished from an otherwise correct run.
- **Whether it triggers depends on image size and prior allocations**, so it is
  intermittent: two figures with identical structure (RGBA + soft mask) behaved
  differently in the same run — page 11's came out perfect, page 13's came out solid
  black. **A run that works proves nothing.**
- **Rule for `pdfExtract.js`: treat any mupdf call as capable of invalidating every
  view obtained before it.** Copy pixels out immediately; never hold a view across an
  allocation.
- A figure that composites to a single flat colour is now returned as `null` rather
  than shipped, so the I3 rule holds the question back from publication instead of
  publishing a blank rectangle.

#### Correction is paste, not crop
- `POST /pyq-admin/questions/:id/figure` accepts a pasted screenshot, a drop, or a
  file pick. Same validated path as My Notes: memory storage, 5MB cap, magic-byte
  sniff (extension and Content-Type are both spoofable), re-encode strips metadata.
  The client reuses My Notes' `imageFilesFrom()` for clipboard/drop extraction — no
  second upload path.
- The auto-attached figure stays the DEFAULT, so a correct one needs no action;
  pasting only replaces the wrong ones. Roughly 10 per paper, seconds each.
- The review row also shows the **source page**, so an admin can confirm the
  assignment and snip from it when the PDF drew a figure with vector operators rather
  than embedding it.

#### Parse baseline v3 (same fixture, after the switch)
| | v1 | v2 | v3 | truth |
| :--- | ---: | ---: | ---: | ---: |
| questions | 71 | 41 | 41 | 39 |
| Section A | 27 | 16 | **16** | 16 |
| Section B | 8 | 15 | 15 | 13 |
| Section C | 3 | 9 | **10** | 10 |
| marks A/B/C | — | 30/25/21 | **30/25/25** | 30/25/25 |
| figures attached | 11 crops | 11 crops | **10 exact assets** | — |
- Section C recovered fully (page 11 no longer fails), and all three section mark
  totals now match the paper exactly. The residual is unchanged: +2 questions in
  Section B. Still not chased — the human timing measurement is still the next action.

### Also fixed while here: `pkill` does not exist in this shell
- Every `pkill -f "src/server.js"` issued during development reported success and did
  **nothing** — the command is absent from the Git Bash environment and the failure was
  swallowed by `2>/dev/null`. Seven test servers accumulated across the session, one
  per port, all still holding their ports and their Mongo connections.
- **Use PowerShell to stop processes on Windows**: find the owner with
  `Get-NetTCPConnection -LocalPort <p> -State Listen` and `Stop-Process -Id`. Verify
  the port is actually free afterwards rather than trusting the kill command.

### The count discrepancy is a RECONCILIATION, not a deletion — worklist advice corrected
- The import worklist used to print "delete ~N spurious row(s)" on a count mismatch.
  **That advice was wrong on the first real paper and would have destroyed content.**
- What the +2 on the CBSE Science fixture actually is, checked row by row:
  - The tail of the CHEMISTRY section was numbered 30-31 by the parse, colliding with
    the PHYSICS section's genuine Q30 and Q31. Four rows, all real questions, filed
    under the wrong section — not extras.
  - One of those pairs is additionally a MIS-GROUPING: a sub-part
    "(e) Write a balanced chemical equation..." and a separate question
    "B. The electronic structures of atoms P and Q..." were folded together as OR
    alternatives. They are not alternatives of each other.
  - The other pair ("A. A hydrocarbon..." / "B. Oxygen can combine...") IS a
    genuine internal choice and must stay paired.
- **So the real residual is a numbering/section-boundary problem, not surplus
  questions.** Every row is real content. Deleting to make the count match would have
  removed two genuine questions and looked like success.
- Worklist now prints a reconciliation order instead: repeated numbers across a
  section boundary, then sub-parts mis-folded as OR alternatives, then genuine
  duplicates last.
- [ ] **Parser follow-up, queued behind the timing measurement:** the fold keys on
      "section|number", so a number reused in a different section survives as two
      rows — correct — but a number reused because the parse put a question in the
      WRONG section produces exactly this collision. Feeding the section's true
      question-number RANGE into the prompt (available from the paper's own
      instructions) would likely close it.

### Missing figures and missing alt text now WARN at publish — they no longer block
- **Changed at the operator request**, from the hard gate the I3 rule originally
  specified. Recorded rather than quietly swapped, because the reasoning that
  produced the gate has not stopped being true:
  - A question whose text says *in the figure below* with no figure is
    **unanswerable**, and unlike a generated question it cannot be repaired by
    dropping the reference — the reference is what the real paper said.
  - A figure with no alt text is skipped by read-aloud, so a student relying on
    narration loses that question entirely.
- **What justifies it:** a hard gate on a 40-question paper stops the entire import
  over one row, and a corpus nobody can publish is worth less than a corpus with a
  few known-imperfect questions in it.
- **What protects against it:** publishing past these is EXPLICIT and RECORDED.
  The first publish attempt returns the warnings and refuses (HTTP 409,
  requiresConfirmation) so the console can show them with the exact question
  numbers; only a confirmed retry publishes. The paper is then stamped with
  publishedWithWarnings, surfaced as a *known issues* badge in the paper list and a
  banner on the review screen. Nothing is silent and nothing is unattributable.
- **Still HARD blocks:** PAPER_STILL_PARSING and PAPER_HAS_NO_QUESTIONS. Those are
  not quality judgements — there is simply nothing to publish.
- [ ] **Sweep publishedWithWarnings before any real launch.** Query:
      db.pastpapers.find({ "publishedWithWarnings.0": { : true } }).
      Every entry is a question a student can already reach and may not be able to
      answer. This is the list that stops known-imperfect content becoming invisible
      debt, and it is only useful if somebody actually reads it.
- **Wording matters and was fixed too:** the import worklist said *BLOCKS PUBLISH*
  for both. An admin who reads that and then publishes successfully learns to
  distrust the worklist, so it now says *warns at publish*. A checklist that
  overstates its own severity is one people stop reading.

### Exam focus mode + fullscreen + the pause decision (Workstream I addendum)

#### Focus mode — automatic, and it had a real hazard in it
- Starting an attempt hides the dashboard rail (and its mobile bottom-nav form), the
  dashboard header, the site header, the marketing footer, and the floating Eklavya
  Assistant. Restored when the exam component unmounts, so submit / exit / teardown
  all go through ONE path rather than each remembering to undo it.
- **The assistant is hidden deliberately.** A student should not have an AI tutor a
  tap away mid-exam; leaving it there makes exam mode meaningless.
- Driven by a class on `<body>`, not by props, because the chat widget is mounted
  globally in `App.jsx` **outside the dashboard tree** — there is no prop path from
  the exam to it, and threading one through would couple the exam to the app shell
  for a purely presentational concern.
- **THE HAZARD, which was real:** the app stops narration on a PATHNAME change
  (`App.jsx`) and on a dashboard SECTION change (`RoadmapDashboard`). Entering an
  exam is **neither** — the student is already on `/dashboard` with the PYQ section
  open, and starting an attempt only changes what that section renders. A speaker
  button left playing in PYQ practice would have carried straight into the exam.
  `PyqExam` now calls `stopNarration()` on mount, because entering the attempt IS
  the transition. Safe unconditionally here, unlike the pathname case, since exam
  mode has no auto-narration of its own to kill.

#### Fullscreen — opt-in, and every constraint is load-bearing
- **A button, never automatic.** `requestFullscreen()` requires a user gesture and is
  rejected without one, so an automatic call on exam start would fail silently on
  every browser and leave a control that looks broken.
- **Support is detected, not assumed.** iOS Safari on iPhone has no Fullscreen API
  (iPad does), so the button is HIDDEN there rather than shown and inert. Focus mode
  already delivers most of the benefit on a phone.
- **Escape cannot be intercepted**, so the browser's `fullscreenchange` event is the
  only source of truth — nothing is set optimistically. Leaving fullscreen drops back
  to focus mode with the layout intact.
- **Fullscreen and the exam are independent.** Exiting fullscreen does not exit the
  exam and does not touch the clock. Unmounting exits fullscreen so the browser is
  never left stranded in it.
- The fullscreened element carries its own background — a fullscreened element with a
  transparent background renders against black.
- **The timer stays visible, including with a soft keyboard open.** The bar is
  `sticky`, not `fixed`: a fixed bar gets repositioned by the on-screen keyboard on
  both iOS and Android and can end up off-screen or floating over the very input
  being typed into. The mobile rule that made it `static` is deliberately not applied
  in focus mode.

#### Pause — the conflict, resolved deliberately
- Pause DOES conflict with the earlier rule that exiting leaves the clock running
  "because that is what a real exam does". Resolved in favour of pause, on the
  grounds that this is a **learning app**: a student who must stop for dinner should
  not lose the paper, and refusing that mostly teaches them not to start one.
- Kept honest rather than merely permitted:
  - Server-authoritative. `pausedAt` / `pausedMs` / `pauseCount` live on the attempt;
    the deadline SLIDES by the paused time. Nothing is ever decremented and stored,
    which is what kept the original timer untamperable.
  - **Answering is refused while paused** (HTTP 409 `ATTEMPT_PAUSED`) and the
    questions are hidden, not merely disabled. Otherwise "pause" is the timer
    switched off while the work continues — a timed-looking result that was not
    timed, and the person it misleads is the student.
  - A paused attempt can never expire.
  - Pause survives a reload: paused when you left, paused when you return.
  - Results state it plainly under the mark: *"2h 58m of exam time · paused 3 times
    for 41m total"*, or *"no pauses"* — which is itself the useful signal.
- **Exit and Pause are now different actions and the copy says so.** The old string
  ("The clock keeps running if you leave — just like a real exam") was ambiguous
  enough that it was misread as "the exam is not paused?", and it is now wrong as
  well, since a Pause button exists. Replaced.

#### Explicitly NOT built (and should stay that way)
- No proctoring: no tab-switch detection, no blur penalties, no forced fullscreen, no
  copy-paste blocking, no webcam anything. This is practice, not invigilation — it is
  a rabbit hole with no end and real privacy problems, and it would be the wrong
  promise for a school deployment.

#### Manual checks still worth doing on a real device
- [ ] Start an exam on a 360px phone: chrome gone, timer pinned, options full width.
- [ ] Focus a written answer with the soft keyboard open — the timer must stay on
      screen. This is the case `sticky` was chosen for and it cannot be verified in a
      desktop browser.
- [ ] iPhone: confirm the Fullscreen button is ABSENT, not present and inert.
- [ ] Escape out of fullscreen mid-exam: layout intact, clock unchanged, still in the
      exam.

### Fixture papers can no longer be published — three layers, because one was not enough
- **It happened.** A paper titled "REVIEW TIMING FIXTURE", year 2026, half-corrected,
  was published by accident and was reachable by seven real accounts. Publishing it
  required no override and produced no signal — it looked exactly like publishing
  real content. Now unpublished; 0 papers are student-visible.
- **Guarded at three levels, deliberately, because each has a hole the others cover:**
  1. **Schema validator** on `parseStatus` — refuses `published` when the title is
     marked as a fixture. Runs in `validateSync()` and on `save()`, so any path that
     goes through the model is caught.
  2. **Publish route** — a HARD 409 `FIXTURE_PAPER_CANNOT_BE_PUBLISHED`. Unlike the
     missing-figure and missing-alt-text warnings, `confirm: true` does NOT override
     it. Those are quality judgements an operator may accept; this is a paper
     labelled as a throwaway.
  3. **CI invariant 15 + acceptance checks** — the invariant drives the real schema
     (4 fixture titles refused, 3 real titles still allowed); the suite drives the
     real HTTP route including the confirm-override attempt.
- **The remaining hole, stated rather than pretended away:** `updateOne` /
  `updateMany` skip validators by default, so a raw status update still bypasses the
  schema layer. That is exactly how the accident happened (a script), and it is why
  the route and the tests exist as separate layers rather than trusting the model.
- **Markers are NARROW on purpose:** `FIXTURE`, `DO NOT USE`, `DUMMY`, `SCRATCH`.
  **"SAMPLE" is deliberately NOT one** — CBSE's own Sample Question Papers are
  legitimate corpus content and are titled as such, so blocking that word would
  refuse the very papers this feature exists to serve. The invariant asserts both
  directions so a guard that rejected everything could not pass.

### Narration across in-section view swaps — the audit, and the one real gap
- **The question:** the app stops narration on a PATHNAME change and on a dashboard
  SECTION change. Which other transitions are neither, i.e. the student stays on
  `/dashboard`, the section stays the same, but what is rendered changes completely?
- **Most such swaps are covered, but by ACCIDENT rather than by those hooks.**
  `SpeakerButton` stops playback on unmount if it owns it, so replacing a view full
  of speaker buttons takes its audio with it. That covers PYQ practice -> exam,
  practice quiz -> review -> setup, and similar.
- **THE ONE GENUINELY UNCOVERED CASE — the chat widget.** It is mounted globally in
  `App.jsx`, outside `Routes` and outside the dashboard tree, and exam focus mode
  hides it with `display: none`, **which does not unmount it**. An assistant reply
  being read aloud therefore keeps playing — with its stop button now invisible — for
  the entire exam. No unmount fires, no pathname changes, no section changes.
- **Fixed** by `stopNarration()` on `PyqExam` mount.
- **The generalisable rule:** narration is only self-cleaning where the OWNING
  component unmounts. Any transition that hides a narration source without
  unmounting it (CSS, `visibility`, a portal left mounted) strands its audio. Hiding
  is not stopping.
- [ ] **Applies to any future full-screen or focus-style view.** If a new one hides
      the chat widget or any other globally-mounted narration source, it must stop
      narration explicitly — the two existing hooks will not do it.

### PARSER EVALUATION — 9 official CBSE papers + a 2-paper HBSE sample
- **Purpose was evaluation, not corpus building.** Every paper imported as a DRAFT
  titled "... PARSER EVAL DO NOT USE", which makes it structurally unpublishable via
  the fixture guard. Nothing published. The Science-SQP timing fixture was not touched.
- **Sources: official only**, per Design Rule 17 — cbseacademic.nic.in and bseh.org.in.
  Marking schemes downloaded alongside every SQP.

#### CBSE per-paper results (question counts are CHOICE GROUPS, not rows)
| Paper | q stated/parsed | marks stated/parsed | figures | fig refs missing |
| :--- | :--- | :--- | ---: | ---: |
| Cl12 Biology | 33 / **33** (+0) | 70 / **70** | 5 | 2 |
| Cl10 Maths (Std) | 38 / **38** (+0) | 80 / 78 | 4 | 0 |
| Cl12 Chemistry | 33 / 34 (+1) | 70 / 74 | 6 | 1 |
| Cl10 Social Science | 38 / 40 (+2) | 80 / 83 | 2 | 1 |
| Cl12 Physics | 33 / 35 (+2) | 70 / **64** | 11 | **5** |
| Cl12 Maths | 38 / 43 (+5) | 80 / **97** | 6 | 0 |
| Cl12 English Core | 13 / **36** (+23) | 80 / 81 | 1 | 2 |
| Cl10 English L&L | 11 / **39** (+28) | 80 / **110** | 0 | 0 |
| Cl10 Hindi (B) | — | 80 / — | 0 | 0 |

- **No paper degraded to the text-only fallback.** The retry logic added last session
  held across ~105 vision calls.
- **One page-level failure:** Cl12 English Core page 9,
  `PARSE_MODEL_RETURNED_INVALID_JSON`. Every other page across all 9 papers parsed.
- **MATHS WAS NOT THE HARDEST — ENGLISH WAS**, and by a wide margin. The prediction
  that notation and geometry would dominate was wrong; Cl10 Maths came out exact on
  question count. Language papers are the failure case.

#### The three over-extraction shapes are DIFFERENT, and one fix does not cover them
Checked before assuming, because they looked alike in the aggregate:
- **English (+28 / +23): container-and-children.** `Q1` is a 10-mark container
  ("Read the following passage...") followed by `QI`-`QVIII` sub-parts of 1-2 marks
  each. Both the container AND every child are emitted as questions, and the
  container's marks double-count its children — which is exactly how 80 becomes 110.
- **Social Science (+2): lettered siblings.** Questions `17A`/`17B` and `27A`/`27B`
  are map-work parts of one numbered question, both compulsory, counted as four.
- **Physics (+2): siblings folded as a CHOICE.** `(I)`/`(II)` parts of a case study
  were folded into `choiceGroup` as OR alternatives. This is the opposite error and
  the most damaging of the three: it UNDER-counts marks (70 -> 64, because a group
  contributes once) and it would tell a student "attempt any one" on a question where
  both parts are compulsory. Wrong instruction on a real paper is worse than a
  miscount.
- [ ] **A parent/child model fixes English and Social Science. Physics additionally
      needs the parser to distinguish a genuine "OR" from both-required "(I)/(II)"** —
      it currently guesses, and guesses wrong.

#### Mathematical notation survives PARTIALLY, and fails silently
- Preserved: operators, Greek, set/limit symbols, italic math variables —
  `𝑓(𝑥)`, `≤`, `𝜋`, `−∞`, `√3`, `∫`, `0°≤ x ≤90°`.
- **Lost, in the same papers:**
  - `10 − 𝑥 − 2𝑥2` for a printed `2x²` — superscript flattened, and the result is
    genuinely AMBIGUOUS (x·2 or x²?).
  - `cos 67𝑜` — the DEGREE SIGN became the letter "o".
  - `∫ from 0 to 1 ... (1+x^2) dx` — integral survived, limits became prose, `²`
    became ASCII `^2`. This one is the VISION fallback rather than the text layer.
- Cl10 Maths kept `cos²A` and `sin⁴A` in Q20 while flattening `ax²` in Q12 — same
  paper, same run. That is not model inconsistency: it is the text layer encoding one
  as a real superscript character and the other as a positioned glyph.
- [ ] **Notation loss is silent and unflagged.** An ambiguous `2x2` reaching a student
      is a wrong question. Worth a validator before any maths paper is published.

#### CBSE Hindi: the text layer is CORRUPT, and the fix is now partial
- The PDF uses a legacy-encoded Devanagari font with no usable ToUnicode map. The
  RENDERED PAGE IS PERFECT; the extracted text is wrong letters —
  `णनम्नणिखिर् गद्ाांश` for a page plainly printing `निम्नलिखित गद्यांश`.
- The prompt rule "use the TEXT for exact wording, do not fix what looks like a typo"
  is correct for English and actively destructive here: it instructed the model to
  propagate the corruption. **First pass: 17 questions, 0 usable.**
- After making the rule conditional (image wins on disagreement) and adding per-page
  trust: **13 of 25 questions clean (52%), 12 still corrupt, all 4 section names still
  corrupt.** A real improvement, NOT a solve.
- [ ] **Remaining Hindi work:** the model still trusts the text layer on about half
      the pages, and `pageSections` is not covered by the transcription instruction at
      all — which is why every section heading is still mojibake.
- **This is the same bug as the Maths superscript loss**, not a Hindi special case:
  printed glyphs that do not survive extraction. Fixed as one thing, deliberately.

#### HBSE — the site DOES publish usable PDFs. Sampled, not exhaustive.
- All 8 Class 10/12 model papers download cleanly from bseh.org.in with real text
  layers. **A 2-paper SAMPLE was imported** (Cl10 Maths, Cl10 Science) rather than all
  8 — stated explicitly, not presented as coverage.
- **Cl12 Physics deliberately NOT imported: it is an OCR'd scan.** 319 "embedded
  figures", all 167px-tall horizontal strips up to 3608px wide — a scanned page sliced
  into bands. Importing it would upload 319 junk images to Cloudinary.
- [ ] **Embedded-figure extraction needs a scan guard** before any HBSE bulk import:
      a page yielding dozens of uniform-height full-width strips is a scan, not a page
      with figures.
- **Every HBSE paper is BILINGUAL** (`[Hindi and English Medium]`) — each question
  appears twice. Expect roughly double extraction, and note the Devanagari half is
  subject to the same corruption risk as the CBSE Hindi paper.
- **HBSE Cl10 Maths result: 40 questions vs 38 stated (+2, comparable to CBSE), but
  MARKS COLLAPSED** — Section A reported 20 questions worth 3 marks against a true 20,
  whole paper ~10 marks against 80. Question structure generalises across boards;
  marks extraction does not.
- Resolved an open question from earlier: **HBSE Class 10 Science states 30 questions
  over 12 pages** (CBSE's is 39).

#### Marks self-consistency is now checked (and it catches what counts miss)
- The parse compares the paper's own stated total against the sum of its sections and
  returns `marksDiscrepancy`. Cl10 Maths is exactly why: **38/38 questions PERFECT
  while 2 marks were missing** (Section E came out 10 against 12). A count-only check
  called that paper clean. One number agreeing is not the paper agreeing.

#### HBSE sample results (2 papers, stated as a sample not coverage)
| Paper | q stated/parsed | marks parsed | figures | fig refs missing |
| :--- | :--- | ---: | ---: | ---: |
| HBSE Cl10 Science | 30 / **30** (+0) | 72 | 0 | 2 |
| HBSE Cl10 Maths | 38 / 40 (+2) | **10** | 7 | 0 |
- **Question structure generalises across boards.** HBSE Science matched exactly;
  HBSE Maths was +2, the same delta as CBSE Social Science.
- **Marks extraction does NOT generalise.** HBSE Maths reported ~10 marks against a
  true 80 (Section A: 20 questions worth 3 marks). HBSE Science reached 72, but the
  true theory total is still unconfirmed — the paper does not state Max Marks in a
  form the text layer yields, which is the same open question as the 60-vs-80
  contradiction recorded earlier. Still unresolved; do not treat 72 as settled.
- **HBSE Science draws its figures with vector operators, not embedded images.**
  0 figures extracted while 2 questions reference one. This is the predicted case
  where embedded extraction finds nothing and the figure must be pasted by hand —
  confirmed in the pre-scan (0 embedded images) before the import was even run.
- Per-page trust is now persisted: the Science import stored 12 page verdicts. The
  Maths import predates that change and stored none, which is itself the evidence
  that the persistence works.

---

## PYQ parser: mark-shortfall diagnosis, and the standing rules for a parser re-run

### A count error and a marks error are DIFFERENT DEFECTS. Diagnose them separately.

Two papers came back "+1 question, −3 marks" and it is tempting to read that as one
fault. It is not, and on both papers the over-count and the shortfall were **different
rows**. Attributing a post-fix change to the sub-part model without splitting them first
would have credited the fix with something it did not do.

Diagnosed 1 August 2026 against the stored pre-fix rows, before any re-parse:

**Cl12 Physics — 34 units / 67 marks vs 33 / 70.** Sections A (16), B (10), C (21) and
E (15) are all exactly right. The entire defect is Section D, parsed at 3 units / 5 marks
where the paper has 2 case studies worth 4 each:
  - **Q29 carries 1 mark and should carry 4.** Its sub-parts were never emitted, so only
    the stem's mark survived. This is the whole −3.
  - **One orphaned sub-part** — `"(I) Ge and Si diodes start conducting at 0.3 V…"` — was
    emitted as its own unit with **0 marks** and no `parentKey`. This is the whole +1.
  - The two are unrelated to each other. The +1 row contributes no marks; the −3 row is
    correctly counted as one unit.

**Cl10 SocSci — 39 units / 77 marks vs 38 / 80.** The two errors here point in
**opposite directions**, which is the clearest evidence available that the OR-scope rule
was the right thing to fix:
  - **Q17A / Q17B is a genuine printed choice that was NOT folded** (5 marks and 0 marks,
    no `choiceGroup`). That is the +1 unit. Folding it changes marks by zero, since
    `max(5, 0) = 5` — so it cannot be the shortfall.
  - **Q19, the map question, was folded AS a choice and is not one.** Its two rows are
    both-required parts (`"(p) The dam in the Sutlej-Beas river basin…"` and
    `"…Mahanadi basin… II. Any two of the following…"`), so `availableMarks` took
    `max(1,1) = 1` where the parts should sum to 3. **−2.**
  - **Q8's case study parts read 1, 1, 1 against a container printed 4.** One sub-part
    is undermarked. **−1.** Compare Q18 in the same paper, which prints "(1+2+1=4)" and
    parsed 1+2+1 correctly.
  - −2 and −1 account for the −3 exactly.

**Q19 is the marks-losing direction of Design Rule 19 caught in the wild** — required
parts scored as alternatives, which in a real exam tells a student to skip work that
counts. It is also why the asymmetric default is not a stylistic preference.

The Q8 finding produced a prompt change with a stated reason rather than a nudge: when a
paper prints its own split ("(1+2+1=4)"), the parts take those numbers in order and must
sum to the parent; parts must not default to 1 mark each. A lost mark is invisible to the
student until the paper fails to add up.

**Also removed in the same pass: two directly contradictory lines in the parse prompt.**
One said sub-parts must be kept inside the parent's `questionText` and "Do NOT emit one
entry per sub-part"; the next said to emit a container plus one entry per part. The first
predated the sub-part model and was never deleted when the model landed. Any measurement
taken across that contradiction is measuring the model's choice between two instructions,
not the parser. **Check the prompt for stale instructions before attributing a result to
a code change.**

### Per-paper reporting requirement for any parser re-run

An aggregate pass rate hides exactly the failures that matter. Every re-run reports, per
paper and never pooled:

- [ ] **Units and marks against the paper's own stated totals**, with the delta signed.
      Units via `countQuestionUnits`, marks via `availableMarks` — the real helpers, so
      the report cannot agree with a bug in a copy of the logic.
- [ ] **The `partsRelation` distribution** — how many families resolved `all-required`,
      `choose-one`, `unclear`.
- [ ] **Every `partsAmbiguous` row, with its `partsRelationEvidence` string.** Not a
      count. The evidence is what makes an abstention checkable against the page, and
      reading them is the only way to tell a real abstention from a stuck field.
- [ ] **A zero-abstention parse is a finding, not a success.** Zero `partsAmbiguous`
      across 56 rows is what prompted this whole rule: it means uncertainty is being
      resolved silently somewhere. Report it as a defect and look for the cause.
- [ ] **Where a count and a marks error both appear, say which rows caused each** before
      claiming any structural fix moved either.

### Verify the fixture baseline AFTER every run

- [ ] `node src/scripts/pyq-baseline.js --verify` after any batch import, and report the
      result alongside the numbers. Runs that use `--replace` operate on papers sharing a
      board/grade/subject key with the fixture, and `--replace` deletes before it writes.
      The window in which that goes wrong is small and entirely silent — the fixture is
      the paper the human correction-time measurement depends on, and it has no
      `updatedAt` to reconstruct from afterwards. Checking costs one command.

---

## Named gaps from the 1 August 2026 parser run (carried forward, not fixed)

### GAP 1 — "answer any N of M" has no representation in the schema
`partsRelation` offers `all-required` and `choose-one`. Real papers routinely print a
third thing: **"Complete any ten of twelve of the following tasks"**, **"Answer ANY FOUR
of the following five questions"**, **"answer ANY ONE of the two"**. Those exact strings
came back as `partsRelationEvidence` on the Class 10 English paper, attached to
`choose-one` — because it is the closest word available, not because it is right.

Why it matters: `choose-one` makes the family worth `max()` of its members. "Any ten of
twelve" is worth ten members' marks, not one. Both the unit count and the mark total are
wrong, in opposite directions, and no warning fires.

This is the whole of the English paper's residual — **33 units against 11 stated**. It is
the reason English is out of the publish path and stays a parser problem.
- [ ] Add an N-of-M relation carrying the required count (`chooseN`, `n`), or decide
      explicitly that such papers are out of corpus scope. Do not encode it as a choice.

### GAP 2 — the model never abstains, on any paper
Across three papers and 148 stored rows, `partsRelation` came back **only** as
`all-required` or `choose-one`. `unclear` was returned **zero** times, so
`partsAmbiguous` was zero everywhere — which is what the zero-abstention alarm in
`pyq-parse-report.js` exists to catch.

One cause was ours and is fixed: `foldQuestions()` built families from `parentKey` only,
while a choice pair is folded on `choiceIndex` and has no `parentKey`. Those families
never reached the evidence check at all, so abstention was **structurally impossible on
the commonest multi-row shape**. Fixed, with two regression checks in CI invariant 17.

The remaining cause is not ours: the model appears unwilling to say `unclear` even when
told it is free. The evidence strings show it would rather quote something loosely
related — "Below are excerpts from their letters." was offered as evidence for a choice.
- [ ] **A quoted evidence string is not yet checked against the question's own text.**
      An evidence string that does not appear near the rows it justifies should force
      `unclear`. Until then, evidence proves the model wrote something, not that it read
      something.

### GAP 3 — letter-suffixed alternatives are never linked
`17A` / `17B` are printed with `OR` between them and are alternatives, but they carry
**different question numbers**, so the fold — which keys on `section|number` — sees two
unrelated questions and no family is ever formed. The prompt makes this worse by listing
`"17A ... 17B"` under SUB-PARTS, i.e. as all-required parts, which is wrong for this
paper and right for others.

On Social Science this accounted for **six pairs, +6 units and +20 marks**, and was
corrected by hand (`src/scripts/fix-socsci-rows.js`).
- [ ] Decide how a family is identified when the paper does not repeat the number.
      Stripping a trailing letter is the obvious move and is exactly the kind of
      label-based inference the prompt already forbids — `A`/`B` are alternatives in this
      paper and required parts in others. It needs the printed separator, not the label.

### GAP 4 — Physics could not be re-imported: rate limit, and --replace had already deleted
The Class 12 Physics re-run **failed on OpenAI 429 across every page**, with both
fallbacks unavailable (Groq 413 — the page payload exceeds the 6000 TPM free-tier limit).
The paper is `parseStatus: failed` with **0 questions**.

The part worth recording: `--replace` deletes the existing paper *before* it parses, so a
mid-run provider failure loses the previous parse with nothing to fall back to. Physics
had 42 usable rows before this run and has none now. It is hard-blocked from publication
by `PAPER_HAS_NO_QUESTIONS`, which is correct, but the data loss was avoidable.
- [ ] **Make `--replace` parse first and swap last.** Delete the old rows only once the
      new parse has succeeded. A destructive flag should not widen its blast radius when
      the provider is down.
- [ ] Re-run `scratchpad/reimport-physics.sh` when the rate limit clears. It targets the
      NEW title; the old scripts now error on no-match by design.

### GAP 5 — these are SAMPLE papers, filed as past papers (product decision, unresolved)
Everything in the corpus is a CBSE **Sample Question Paper**, not a paper any student
sat. They are published by the board, so Design Rule 17 is satisfied and `source: 'pyq'`
is defensible — an SQP is a real primary-source document, not generated content.

But the feature is called Previous Year Questions, and a student practising an SQP under
that label is being told something slightly untrue. `isFixtureTitle()` deliberately
excludes the word "SAMPLE", so titles carry the distinction; nothing else does.
- [ ] Decide whether `PastPaper` needs a `paperKind` (`sat-paper` | `sample-paper`) and
      whether the student-facing label should distinguish them. Titles are currently the
      only signal, and a title is not a queryable field.
