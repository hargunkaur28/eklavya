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
