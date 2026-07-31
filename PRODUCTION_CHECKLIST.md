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
