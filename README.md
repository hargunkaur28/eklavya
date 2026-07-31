# Project Eklavya (एकलव्य) — AI-Powered Learning for Bharat

> **For contributors — keeping this README current:**  
> This README should be updated whenever a feature is added, removed, or meaningfully changed. When implementing a new feature or fixing a significant bug, update the relevant section of this file in the same change — don't let it drift out of date. If you're an AI coding agent working on this repo, treat README.md updates as part of the definition of done for any user-facing feature work, the same way you'd update a model schema or route file.

---

## Project Overview

**Project Eklavya** (*Ek Shikshak, Har Vidhyarthi*) is a personalized, AI-driven learning platform built specifically for Indian students preparing for Class 10 Science, Class 11 JEE Foundation, and Class 12 NEET Biology. The platform assesses a student's current knowledge through an interactive diagnostic quiz, identifies strong and weak concept areas, and automatically constructs a day-by-day study roadmap. Each study day combines curated educational YouTube videos from trusted Indian channels (Physics Wallah, Vedantu, Unacademy, Khan Academy India, Aakash) with AI-generated lesson content and a per-day module quiz — a day is completed only once its video is watched and its quiz passed. Beyond the core roadmap, the dashboard tracks video and quiz progress, flags weak sub-topics from quiz results, adaptively inserts remediation days when a student stays stuck, supports multiple subjects per student (with English, Science, and Social Science further splittable into selectable sub-subjects such as Grammar, Physics, or History, plus a combined/fusion option), offers a standalone practice mode, and keeps students consistent with account-wide study streaks and a "continue where you left off" prompt. The platform features bilingual support (English and Hindi) across UI, quizzes, lessons, and weak-topic labels, voice input and text-to-speech read-aloud, and a floating site-wide AI assistant widget. Quizzes can optionally include **AI-graded written (essay / short-answer) questions** alongside multiple-choice, a persistent **AI tutor chat (Mentor)**, and a **PDF study-notes generator**. It also has a role-based account system — students, an optional **read-only parent login** per student, and an environment-configured **admin console** — plus student profile editing with server-side Cloudinary photo uploads.

---

## Core Features

### 1. Adaptive, Grade-Correct Diagnostic Quiz & Roadmap Generation
- **What it does:** Establishes what a student actually knows across a course, then generates a 10-15 day study roadmap weighted toward their weak topics. The diagnostic is **syllabus-grounded** and **adaptive and variable in length** — it asks between **8 and 20 questions** and stops as soon as it is confident, so two students on the same course routinely get different-length tests.

- **Syllabus blueprint (why questions are now at the right level):** Previously the diagnostic asked Groq for "6 questions on Class 10 Maths" and got back Class 6 arithmetic (*"if r = 4, what is the diameter?"*). Every question is now pinned to a real chapter of the NCERT/CBSE syllabus via `server/src/config/syllabusBlueprint.js`, keyed by `grade → subject → subSubject`. Each entry carries the chapter list (with 3-6 examinable concepts per chapter), a prose **`difficultyAnchor`** describing the expected cognitive level, and three calibration **`exemplars`** — `tooEasy` / `correct` / `tooHard`. All three exemplars go into the prompt with an explicit instruction to hit the `correct` level. Hand-authored for **17 course identities**: Class 10 Science (Physics / Chemistry / Biology / Combined), Maths, English (Writing / Grammar / Reading / Fusion), Social Science (History / Geography / Civics / Economics / Combined) and Hindi; Class 11 JEE Foundation; Class 12 NEET Biology. Any other grade+subject combination falls back to `resolveBlueprint`, which **generates** a blueprint from the real syllabus via Groq (never hardcoded filler) and caches it on the session.

- **Validation & the removal of fallback banks:** Generated questions are rejected and regenerated (up to 3 attempts) if they lack a blueprint `chapterId`, have fewer than 4 distinct options, have no valid `correctIndex`, duplicate a stem already asked, ask the student to *"prove / show that / derive"* (unanswerable as an MCQ), or paste the working into the options. A separate **difficulty audit** call then re-reads each round against the exemplars and rejects anything a student could answer in one step — structural validation cannot catch "What is the HCF of 24 and 30?", which is a well-formed MCQ and a Class 6 question. **The handwritten diagnostic question banks and template filler are deleted**: they were the source of the off-level questions, and a wrong-level diagnostic produces a wrong roadmap, which is worse for a student than no roadmap. If generation genuinely fails, the endpoint returns `503` and asks the student to retry.

- **The adaptive algorithm:** `MIN_QUESTIONS = 8`, `MAX_QUESTIONS = 20`, `ROUND_SIZE = 4`. Round 1 asks 4 `medium` questions across 4 different chapters. After each round, every chapter is classified: a chapter is **RESOLVED** once it has ≥ 2 questions *and* accuracy ≤ 25% (confidently weak) or ≥ 75% (confidently strong); anything nearer 50% is **UNRESOLVED** and earns another question. Each chapter carries a **difficulty ladder** (correct → step up `easy→medium→hard`; incorrect → step down).

  **A resolved chapter releases its budget.** It is finished and never takes another slot, so every question it would have consumed goes to a chapter we know nothing about. Unresolved and newly-opened chapters are then interleaved so neither starves. The practical effect is that a student who answers consistently sweeps **wide** — each chapter resolved in two questions, so the budget buys breadth — while an ambiguous student goes **deep** on fewer chapters, because their unresolved chapters keep consuming the budget that would have opened new ones. A chapter is never opened that the remaining budget cannot afford to *resolve*: one question yields a 0% or 100% accuracy that reads as confident signal and is not.

  The probe set is `mcqMax / 2 − 1` chapters (9 of a possible 10, one held back as slack for a short round), sampled as a **representative spread** across the whole syllabus — evenly-spaced indices, never the first N. **Selection is fully deterministic**: two students on the same course always get the same probe chapters in the same order, and the same answers always produce the same test. There is no randomness in the engine.

  The quiz stops when `asked ≥ MIN`, no chapter is unresolved, and no untouched chapter can still be afforded — or at `MAX`.

- **Ambiguity fails safe toward more teaching.** A chapter that was probed but still sits near 50% when the budget runs out is *not* a chapter the student is known to be fine on. Every such chapter is added to `weakTopics` so it earns roadmap days, rather than being silently dropped on the strength of no conclusion. Untouched chapters are a different case — no evidence at all rather than inconclusive evidence — so they are reported in `chapterCoverage` rather than guessed at. Every result records `chapterCoverage` (`total` / `touched` / `resolved` / `unresolvedChapters` / `untouchedChapters`) so the breadth of the sample behind a roadmap is visible rather than assumed.

- **Coverage hands off to the roadmap in three tiers.** `POST /api/roadmap/generate` *consumes* `chapterCoverage`, it does not merely receive it. The prompt now carries the course's real chapter list from the blueprint (so "cover the breadth" is a concrete list rather than something the model reconstructs from the grade name) and splits topics three ways: **weak** → more days and deeper practice; **strong** → covered briefly as revision; **not assessed** → covered once at *standard* pacing. Without that third tier an unreached chapter appears in neither list, so the model has no reason to include it and the chapter silently disappears from the plan — because the quiz ran out of budget, not because the student knows it. The generated plan is checked for those topics and regenerated once naming whatever it omitted.

- **Duplicate suppression.** Exact-stem matching is not enough — a generator asked twice about one chapter reliably produces pairs like *"…find the length of CD using the basic proportionality theorem"* and *"…find the length of CD"*, which are textually distinct and identically useless. Stems are compared by token **containment** (overlap ÷ the shorter stem, ≥ 0.85), which scores subset-pairs near 1.0 where Jaccard dilutes them to ~0.4.

- **Latency.** Each round is one generation call producing **two candidates per slot** — spare questions cost output tokens on a call already being made, whereas regenerating a rejected question costs a whole round-trip — plus one audit call. While the student answers the round on screen, the server **pre-generates** the chapters that will open next (their identity is deterministic even though the exact round composition is not), so roughly half of each round is already warm when it is requested. Figure generation is capped at 7 s and dropped past it, since every question must be answerable from its text alone. `groqClient.js` carries a 60-second **rate-limit circuit breaker** so a known-429 model is skipped rather than re-tried on every call.

- **Session state & API:** `DiagnosticSession` is now multi-round and stateful (`askedQuestions[]` — aliased to `questions[]` — with `chapterId` / `difficulty` / `wasCorrect`, plus `chapterStats{}`, `roundNumber`, `gradedCount`, `isComplete`). The endpoints are unchanged in name: `POST /api/diagnostic/generate` starts the session and returns round 1; `POST /api/diagnostic/submit` accepts **one round** of answers and replies with either `{ status: 'continue', questions, progress }` or `{ status: 'complete', result }` in the existing `DiagnosticResult` shape. A submission must echo its `round` number — replaying a round would otherwise grade the questions now on screen with the previous round's answers and silently corrupt the weak/strong split.

- **Frontend:** The quiz no longer knows its own length, so it never renders a total. The counter is **indeterminate** — "Question 7 — still getting to know you" with a bar driven by `asked / MAX_QUESTIONS` — and a friendly "Picking your next questions…" state covers the gap between rounds. `Previous` is bounded to the current round, since earlier rounds are already graded server-side.

- **Unchanged downstream:** weak-topic analysis, `POST /api/roadmap/generate`, `DiagnosticReview.jsx`, the Hindi translation path, per-question audio, and Feature 19's `includeWritten` all keep working. Written questions are served as a final round after the stop condition is met (targeted at the least-confident chapters, and blueprint-grounded like the MCQs), and the MCQ budget is reduced by their count so the **total** stays inside 8-20.

- **Components/Pages:**
  - `client/src/components/Onboarding.jsx` (adaptive round-based quiz interface & subject selection)
  - `client/src/pages/DiagnosticReview.jsx` (Detailed quiz score review and topic breakdown)
- **Backend Routes & Utilities:**
  - `POST /api/diagnostic/generate` (starts an adaptive session, returns round 1)
  - `POST /api/diagnostic/submit` (scores a round; returns the next round or the final result)
  - `POST /api/diagnostic/session/:id/translate` (in-place Hindi translation of a live session — a mid-quiz language switch can no longer re-call `/generate`, which would abandon the in-flight session)
  - `POST /api/roadmap/generate` (Roadmap day schedule creation via Groq AI `llama-3.3-70b-versatile`)
  - `server/src/config/syllabusBlueprint.js` (chapters, difficulty anchors, exemplars, diagram eligibility)
  - `server/src/utils/diagnosticEngine.js` (blueprint resolution, question generation + validation, difficulty audit, adaptive round planning)
  - Models: `DiagnosticSession.js`, `DiagnosticResult.js`, `Roadmap.js`

### 2. Day-by-Day Study Plan & Verified YouTube Resources
- **What it does:** Students follow a daily study schedule. Clicking into any day presents a 2-3 paragraph detailed lesson module generated on first view, alongside real embeddable YouTube video recommendations fetched via YouTube Data API v3 (strictly filtered to exclude low-quality content and brand competitors like BYJU'S). Each day brings together watchable videos (with per-video completion tracking — Feature 8), the lesson module, and a module quiz (Feature 9): a day is only marked **complete** once the student has both watched a video *and* passed that day's quiz, a gate enforced by the backend.
- **Components/Pages:**
  - `client/src/pages/DayDetail.jsx` (Daily study module view, video players, and module quiz)
  - `client/src/components/RoadmapDashboard.jsx` (Roadmap day overview with per-day completion + quiz score indicators)
- **No placeholder lessons.** If lesson generation is unavailable the day returns `contentAvailable: false` and **caches nothing** — the client shows a retry, and revisiting genuinely regenerates. Previously a failure returned `"Welcome to Day's module on {topic}. Focus: {focus}"` *and* set `contentGenerated = true`, so a single transient outage permanently froze a non-lesson in place and the student never received real content even after the provider recovered. Videos and the module quiz keep working meanwhile, so the day is never empty.
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/:id/day/:dayNumber` (Dynamic lesson generation via Groq + YouTube resource fetch; returns `contentAvailable`)
  - `PATCH /api/roadmap/:id/day/:dayNumber` (Update day completion status — rejected with `409` unless the video-watched + quiz-passed gate is satisfied)
  - `server/src/utils/fetchYoutubeResources.js` (YouTube Data API integration)

### 3. Bilingual Support (English & Hindi)
- **What it does:** The site operates seamlessly in both English and Hindi. Toggling the global language switch in the header updates UI translations and triggers server-side translation of quizzes, diagnostic reviews, and study roadmap content into Devanagari Hindi using Sarvam AI Translate (`en-IN` to `hi-IN`), with a Groq AI translation fallback. Module quiz questions, options, and explanations (Feature 9) and weak-topic sub-topic labels (Feature 10) are translated the same way and cached alongside their English originals; option order is preserved so quiz scoring (which is index-based) is unaffected by translation. Failed translations of short technical labels are re-attempted on the next Hindi read rather than cached as English.
- **Components/Pages:**
  - `client/src/context/LanguageContext.jsx` (Global language provider & `localStorage` persistence)
  - `client/src/data/translations.js` (Bilingual string dictionary)
- **Backend Routes & Utilities:**
  - `POST /api/diagnostic/:id/translate` (Translates quiz review into Hindi)
  - `POST /api/roadmap/:id/translate` (Translates study roadmap days into Hindi)
  - `server/src/utils/translateAndCache.js` & `server/src/utils/localizeReply.js`

### 4. Text-to-Speech (Sarvam Bulbul v3 & Web Speech Fallback)
- **What it does:** Allows students to listen to diagnostic quiz questions, diagnostic review explanations, roadmap lesson content, **module quiz questions**, and AI chatbot replies read aloud in either English (`en-IN`) or Hindi (`hi-IN`). Module quiz audio is read from the correct language version of the question (matching what's on screen) and disk-cached by content hash, so it survives day renumbering from adaptive remediation (Feature 12).
- **Implementation:**
  - Server-side synthesis via Sarvam AI Bulbul v3 TTS API (`/text-to-speech`). Long prose is split into sentence chunks (<450 chars) and dynamically concatenated using an in-memory RIFF WAV subchunk parser (`combineWavBase64`).
  - Audio files are saved to `server/uploads/audio/` with MD5 content-hash caching and periodic temporary file sweeps.
  - If Sarvam API is unavailable or rate-limited, frontend controls gracefully fall back to the browser's native `window.speechSynthesis`.
- **Components/Pages:**
  - `client/src/components/SpeakerButton.jsx` (Reusable speaker button used across review & roadmap pages)
- **Backend Routes & Utilities:**
  - `GET /api/diagnostic/:id/question/:questionIndex/audio`
  - `POST /api/diagnostic/live-audio`
  - `GET /api/roadmap/:id/day/:dayNumber/audio`
  - `GET /api/roadmap/:id/day/:dayNumber/quiz/question/:qIndex/audio` (module quiz question audio)
  - `server/src/utils/textToSpeech.js`

### 5. Speech-to-Text & Real-Time Live Dictation
- **What it does:** Students can dictate their questions in English or Hindi by clicking the microphone button inside the AI Chatbot widget.
- **Implementation:**
  - Uses browser native Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) with `interimResults = true` to type words live into the text input as spoken ("hello" ... "I'm" ... "shine").
  - Automatically switches dictation language (`hi-IN` / `en-IN`) matching the current global language toggle.
  - Fallback path for unsupported browsers (e.g. Firefox) records audio via `MediaRecorder` and posts `multipart/form-data` to the backend `/api/chat/stt` endpoint powered by Sarvam AI Speech-to-Text (`saaras:v3` model, with a 15-second `AbortController` timeout).
- **Components/Pages:**
  - `client/src/components/ChatWidget.jsx`
- **Backend Routes & Utilities:**
  - `POST /api/chat/stt`
  - `server/src/utils/sarvamClient.js` (`sarvamSpeechToText`)

### 6. Floating AI Chatbot Assistant ("Eklavya Assistant")
- **What it does:** A site-wide floating assistant widget available on every page (for both logged-in users and anonymous visitors) that handles:
  1. General academic Q&A and explanations grounded in factual site knowledge.
  2. Direct site navigation help (providing React Router clickable buttons to routes like `/signup`, `/dashboard`, `/onboarding`).
  3. Real study video recommendations via YouTube Data API.
  4. Bilingual text replies (English/Hindi) and complete voice I/O (speaker & microphone buttons).
  5. Progressive word-by-word text reveal and typing indicator.
  6. Personalized responses incorporating logged-in student name and current roadmap progress.
- **Components/Pages:**
  - `client/src/components/ChatWidget.jsx` & `client/src/components/ChatWidget.css` (Mounted once in `App.jsx`)
- **Backend Routes & Utilities:**
  - `POST /api/chat/message`, `POST /api/chat/tts`, `POST /api/chat/stt`
  - `server/src/routes/chat.js`
  - `server/src/data/siteRoutes.js` & `server/src/data/siteKnowledge.js`

### 7. Student Dashboard: Navigation, Multi-Subject, Streaks & Continue
- **What it does:** The `/dashboard` is organized by a persistent left sidebar (which collapses to a fixed bottom nav bar on mobile) with sections for **Study Roadmap**, **Practice Mode**, **Progress & Weak Topics**, and **Diagnostic Review**. It shows days-completed and videos-watched progress, the active roadmap schedule, per-day quiz scores, and the diagnostic review.
  - **Multi-subject:** A student can hold several active roadmaps — one per (grade + subject) course. The sidebar's subject switcher (a horizontal chip bar on mobile) swaps the displayed roadmap instantly with no page reload, and the selection persists in `localStorage`. Adding a subject routes through the existing onboarding/diagnostic flow; regenerating a roadmap archives only the prior roadmap for that *same* course (never deletes another subject), preserving progress history.
  - **Study streaks (account-wide):** Current and longest study streaks are shown near the top of the dashboard. A day counts as "active" when the student watches a video to threshold, submits a module quiz, or completes a practice session (not logins). Streaks use the student's **local-time** day boundaries (the client stamps its own local date).
  - **Continue where you left off:** A prominent card links to the first not-yet-complete day of the currently selected subject.
- **Components/Pages:**
  - `client/src/components/RoadmapDashboard.jsx` (`/dashboard` route)
  - `client/src/components/DashboardSidebar.jsx` (sidebar / mobile bottom nav + subject switcher)
  - `client/src/components/StreakWidget.jsx` & `client/src/utils/streak.js` (streak display + client-side current/longest computation)
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/mine` (default active roadmap) & `GET /api/roadmap/list` (all active roadmaps for the subject switcher)
  - `GET /api/activity` (account-wide study dates) & `server/src/utils/recordActivity.js` (records local study dates from quiz/practice/video activity onto `User.studyDates`)

### 8. Video Completion Tracking
- **What it does:** Each day's videos embed via the **YouTube IFrame Player API** behind a click-to-play thumbnail facade, so a real player (and its network cost) only loads once the student chooses to watch that video. Watch progress is tracked per video and a video is marked **watched** at **90%** of its duration. Progress updates the on-screen bar roughly every second and is persisted to the server about every 10 seconds plus on pause/end (furthest point reached; scrubbing back never lowers it). Every video on a day tracks independently, and video completion is a separate signal from day completion (surfaced as a "videos watched" dashboard stat).
- **Components/Pages:**
  - `client/src/components/YouTubePlayer.jsx` (tracked IFrame player) & `client/src/pages/DayDetail.jsx`
- **Backend Routes & Utilities:**
  - `PATCH /api/roadmap/:id/day/:dayNumber/video-progress`
  - `Roadmap.js` day `videoProgress[]` (per-`videoId` records; 90% `VIDEO_WATCH_THRESHOLD`)

### 9. Per-Module Quizzes & Day Completion Gating
- **What it does:** Every roadmap day has a **10-question** multiple-choice quiz generated once from *that day's specific topic and lesson content* via Groq and cached on the day (revisits get the same quiz, not a new random one). Passing requires **≥70%**, and a day is only completed when a video is watched **and** the quiz is passed. Students can retake anytime. After submitting, the score and full per-question review (correct answers + explanations) stay visible on revisit — the day page shows the last attempt with "view full review" and "retake", and each day card shows a score pill. Per-question wrong-answer detail is stored to power weak-topic flagging.
- **Components/Pages:**
  - `client/src/components/ModuleQuiz.jsx` (take → score → review, persistent last-attempt summary) & `client/src/pages/DayDetail.jsx`
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/:id/day/:dayNumber/quiz` (generate + cache; answers withheld)
  - `POST /api/roadmap/:id/day/:dayNumber/quiz/submit` (score, store attempt, gate completion)
  - `GET /api/roadmap/:id/day/:dayNumber/quiz/result` (re-view the stored attempt later)
  - `Roadmap.js` day `moduleQuiz` (cached questions) + `moduleQuizAttempt` (score + per-question detail)

### 10. Weak-Topic Flagging & Progress Insights
- **What it does:** Each day's quiz questions are pinned to a **canonical per-day sub-topic list**. The Progress & Weak Topics dashboard section aggregates per-question results by sub-topic across all days and surfaces the topics the student is weakest in (below **60%** average accuracy, with at least 2 questions answered), each linking back to the relevant day(s). Sub-topic labels are localized in Hindi mode. This is the data adaptive remediation (Feature 12) consumes; practice-mode results are deliberately excluded from it.
- **Components/Pages:**
  - `client/src/components/ProgressWeakTopics.jsx`
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/:id/weak-topics`
  - `Roadmap.js` day `subtopics` / `subtopicsHindi`

### 11. Practice Mode
- **What it does:** A separate practice section where a student picks a subject and a topic (or taps a flagged weak topic as a shortcut) and gets a freshly generated 10-question quiz for open revision. Practice quizzes are generated **fresh every session** (higher Groq temperature + a rotation seed, no per-topic caching), so repeating a topic yields a different set of questions. Practice is intentionally isolated — it never marks roadmap days complete and never feeds the roadmap's weak-topic data. Sessions are ephemeral (24-hour TTL); questions localize to Hindi and support read-aloud.
- **Components/Pages:**
  - `client/src/components/PracticeMode.jsx`
- **Backend Routes & Utilities:**
  - `POST /api/practice/generate`, `POST /api/practice/submit`
  - Model: `PracticeSession.js`

### 12. Adaptive Roadmap Remediation
- **What it does:** When a student retakes a day's quiz (2nd or later attempt) and a sub-topic is *still* weak (<60%), the system inserts a single **remediation day** immediately after that day, with its title and focus generated by a live Groq call grounded in that specific weak sub-topic (no template filler — if generation fails, nothing is inserted). Only *later* days are renumbered; already-completed days are never modified. At most one remediation day is inserted per submission, and never a duplicate for the same sub-topic. Inserted days carry an "Added for you" badge, and the student is notified on the post-quiz screen.
- **Components/Pages:**
  - Surfaced in `client/src/components/RoadmapDashboard.jsx` (badge) & `client/src/components/ModuleQuiz.jsx` (notice)
- **Backend Routes & Utilities:**
  - Triggered inside `POST /api/roadmap/:id/day/:dayNumber/quiz/submit`
  - `Roadmap.js` day `isRemediation`, `remediationForSubtopic`, `remediationFromDay`

### 13. User Authentication, Roles & Session Management
- **What it does:** Secure signup and login using password hashing (bcryptjs) and JSON Web Tokens (JWT), on **dedicated `/login` and `/signup` pages** (the former modal was retired). Includes a **Remember Me** option that extends session lifetime to 90 days (persistent `localStorage`); standard sessions default to 30 days (`sessionStorage`).
  - **Roles:** every account carries a `role` of `student` (default), `parent`, or `admin`. The JWT encodes the role, and a reusable `requireRole()` middleware gates role-specific endpoints (returns `403` on mismatch). Tokens issued before roles existed default safely to `student`.
  - **Password policy:** a shared validator enforces **≥8 characters with an uppercase letter, a number, and a symbol** on signup and every password change.
  - **Brute-force protection:** login is rate-limited per IP on **failed** attempts only (a shared sliding-window limiter), so honest typos and shared IPs aren't penalised while password-guessing is stopped.
  - **Change password:** any session can change its own password after re-verifying the current one; the server never returns which factor was wrong.
  - **Secrets:** `JWT_SECRET` is loaded strictly from the environment (no hardcoded fallback) and the server refuses to boot without it.
- **Components/Pages:**
  - `client/src/pages/AuthPage.jsx` (login / signup page), `client/src/pages/ChangePasswordPage.jsx`
  - `client/src/components/ProtectedRoute.jsx` (route guard; also enforces a forced parent password change — Feature 14)
  - `client/src/context/AuthContext.jsx` (session token + role state)
- **Backend Routes & Utilities:**
  - `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`
  - `server/src/routes/auth.js`, `server/src/middleware/auth.js` (`authMiddleware` + `requireRole`)
  - `server/src/utils/validatePassword.js` (shared policy) & `server/src/utils/rateLimiter.js` (shared limiter)

### 14. Parent Accounts & Read-Only Parent Dashboard
- **What it does:** A student can create a **parent login** on demand from their dashboard **Settings → Parent Login** card. The server generates a memorable, word-based temporary password (e.g. `TigerCloudRiver#4728`) using a CSPRNG, stores only its bcrypt hash, and shows the plaintext **once**. The parent signs in with the **same email as the student** but their own password (Option B: one `User` document, an additional `parentPasswordHash` field) — a match resolves the session to `role: 'parent'`. On first login the parent is **forced to set their own password** before anything else (enforced both client-side and by a server gate). The **parent dashboard is strictly read-only**: it shows the child's roadmap progress, streak, and weak topics, and can change only its *own* password (not the child's email). Scoping is intrinsic — because the parent session shares the student's `userId`, every read is automatically limited to that one child, and all mutating endpoints reject parent sessions.
- **Components/Pages:**
  - `client/src/components/ParentAccessCard.jsx` (generate / regenerate parent access), `client/src/components/ParentDashboard.jsx`
- **Backend Routes & Utilities:**
  - `POST /api/auth/parent/generate` (student-only) & `server/src/utils/generateTempPassword.js`
  - `User.js` fields `parentPasswordHash`, `parentMustChangePassword`; `parentPasswordChangeGate` in `middleware/auth.js`

### 15. Admin Console
- **What it does:** An environment-configured admin panel (no admin row in the database) for viewing **parent-linkage status** and, per student, exactly what a parent can see (roadmaps, weak topics, activity) — read-only, nothing more. Admin identity comes from env vars; the JWT carries `role: 'admin'` with **no `userId`**, so it structurally cannot address any single user's data through the normal endpoints. Admin sign-in requires **three factors together — email + password + security code** — checked as a unit with one generic error and its own stricter rate limit. Admin can sign in from the regular `/login` (the security-code field appears once the admin email + password are correct) or the dedicated `/admin/login`. From **Settings**, the admin can change its own email / password / security code (gated by the current security code); these overrides are persisted in MongoDB (`AdminConfig`) so they survive restarts, taking precedence over the env bootstrap.
- **Components/Pages:**
  - `client/src/components/AdminDashboard.jsx`, `client/src/components/AdminSettings.jsx`, `client/src/pages/AdminLoginPage.jsx`
- **Backend Routes & Utilities:**
  - `POST /api/admin/login`, `POST /api/admin/precheck`, `PATCH /api/admin/credentials`
  - `GET /api/admin/parent-links`, `GET /api/admin/student/:studentId`, `GET /api/admin/student/:studentId/roadmap/:roadmapId/weak-topics`, `GET /api/admin/student/:studentId/activity`
  - `server/src/routes/admin.js`, `server/src/utils/adminCreds.js`, `server/src/models/AdminConfig.js`re

### 16. Student Profile Editing & Profile Photo
- **What it does:** From **Settings → Edit Profile**, a student can update their **name**, **email**, and **profile photo**. Changing the email re-verifies the current password and is checked for uniqueness server-side (a clean `400`, never a duplicate-key crash); because of Option B, it atomically becomes the parent's login email too, with a clear warning shown when a parent is linked. Profile photos are **uploaded server-side** to Cloudinary (the API secret never reaches the client): the file is validated by its real magic bytes (not the spoofable extension/Content-Type — JPEG/PNG/WebP only), hard-capped at 2 MB, resized and stripped of EXIF metadata, then stored as a URL only (a deterministic per-user public id, so replacing overwrites in place). Parent and admin views render the photo read-only.
- **Components/Pages:**
  - `client/src/pages/ProfilePage.jsx`, `client/src/components/Avatar.jsx`, `client/src/components/DashboardShell.jsx` (shared parent/admin chrome)
- **Backend Routes & Utilities:**
  - `PATCH /api/auth/profile`, `POST /api/auth/profile/photo`, `DELETE /api/auth/profile/photo`
  - `server/src/utils/cloudinary.js`, `server/src/utils/imageSniff.js`; `User.js` field `photoUrl`

### 17. Your Mentor (Persistent AI Tutor Chat)
- **What it does:** A dedicated, ChatGPT-style **long-form AI tutor** (separate from the quick floating chatbot). A student opens **Mentor** from the dashboard sidebar and gets a full page: a conversation list on the left ("+ New chat", past chats by auto-generated title, click to switch, delete) and a message thread on the right. Unlike the one-liner chatbot, Mentor gives **paragraph-level, teaching-quality explanations** (rendered as Markdown, revealed with a typing animation), stays scoped to academic help for the platform's subjects, and **persists** — conversations and their full history are stored server-side and survive reloads. It is **read-only** with respect to the rest of the app (never touches roadmap/quiz/streak data), and every conversation is ownership-checked (a student can never fetch another student's thread — `404` on mismatch).
- **Components/Pages:**
  - `client/src/pages/MentorPage.jsx` (two-panel chat, Markdown + typing animation, reusing the ChatWidget avatar)
- **Backend Routes & Utilities:**
  - `POST/GET /api/mentor/conversations`, `GET/DELETE /api/mentor/conversations/:id`, `POST /api/mentor/conversations/:id/message`
  - `server/src/routes/mentor.js`, `server/src/models/Conversation.js` (embedded messages), `server/src/utils/groqClient.js` (shared Groq call, now used by the chatbot too)
  - Student-only (`requireRole('student')`), per-user rate-limited, context capped to the last 20 messages / ~4000 tokens per request

### 18. PDF Notes Generator
- **What it does:** From the dashboard **Notes** section, a student enters a subject + topic; Groq generates **structured study notes** (a title, sections of explanatory bullet points with definitions/examples, and key terms), which the student can **edit in an inline review** and then **download as a branded PDF**. The PDF is rendered **server-side with `@react-pdf/renderer`** (pure Node, no headless browser — reliable on any host), carries the **vector Eklavya logo**, a header/footer, and page numbers, and is **streamed on-demand — ephemeral, never stored**. Sizes are clamped server-side on **both** the AI output and the edited input (plus Express's body limit as an outer cap). Student-only.
- **Components/Pages:**
  - `client/src/components/NotesGenerator.jsx` (inline dashboard panel: generate → editable review → download)
- **Backend Routes & Utilities:**
  - `POST /api/notes/generate` (structured notes JSON), `POST /api/notes/pdf` (renders + streams the download)
  - `server/src/routes/notes.js`, `server/src/utils/notesPdf.js` (React-PDF document + ported vector logo)
  - *Accepted limitation:* notes content is generated in **English** (react-pdf's built-in Helvetica); Hindi content needs a registered Devanagari font — logged in `PRODUCTION_CHECKLIST.md`. A Hindi-mode UI notice tells the student up front.

### 19. Written / Essay Questions (AI-Graded)
- **What it does:** Quizzes can include **written (essay / short-answer) questions** alongside multiple-choice, across all three quiz surfaces — the **diagnostic**, **module quizzes**, and **practice mode**. The student answers in a free-text box, and each answer is **graded by Groq on three criteria** — content, grammar, and spelling (each 0–100) — combined into a weighted overall score (essay-weighted `50/30/20` for English writing, content-weighted `80/10/10` for short answers). That overall is **binarised against the same threshold each quiz already uses** (70% module / 60% diagnostic / 60% practice), so a written question feeds **weak-topic aggregation and adaptive remediation identically to an MCQ** — its topic is pinned to the same canonical sub-topic list the MCQs use, so scores merge into the same buckets rather than drifting into singletons.
- **How it's offered:** an **opt-in toggle** ("Include written questions") on the diagnostic and practice setup screens; **English Writing & Fusion sub-subjects auto-include** essay questions (they're inherently writing-based — see Feature 20), while English Grammar/Reading and every other subject stay MCQ-only unless the toggle is used. This is driven by `isWrittenHeavy(subject, subSubject)`, so "being English" no longer implies essay treatment on its own. Existing documents (no `type`) are treated as MCQ with zero migration.
- **Review UX:** the post-submit and revisit review shows **per-criterion score bars + the AI's feedback per criterion**, the **overall vs. threshold**, and the **grading key** ("a strong answer covers…"). Below-threshold written answers are framed as **"Below threshold," never "Incorrect"** (with distinct amber, not red, styling) — a written answer isn't wrong, it's under-developed.
- **Components/Pages:**
  - `client/src/components/WrittenQuestion.jsx` (shared answer `textarea` + threshold-framed review with score bars/feedback, reused by practice, module quiz, diagnostic take + review, and the dashboard's embedded diagnostic review)
- **Backend Routes & Utilities:**
  - No new endpoints — the existing `diagnostic/practice/roadmap` generate + submit routes carry an `includeWritten` flag and mixed (MCQ + written) grading.
  - `server/src/utils/generateWritten.js` (writes the questions + grading anchor), `server/src/utils/gradeWritten.js` (the 3-criterion grader — blank→zero without a Groq call, never throws, degrades to a 0-score with a note), `server/src/models/writtenFields.js` (additive schema fields shared across all five quiz/attempt sub-schemas; `writtenStyle` is snapshotted onto the attempt so an ephemeral-session diagnostic can still render it on revisit)
  - Student-only, reuses the shared `groqClient.js` and the existing translation-cache path (written prompts translate via the prompt-only Sarvam path, since they have no options to keep order-stable)
  - *Accepted limitations:* AI grading is **non-deterministic** (the same answer can score slightly differently run-to-run — an accepted trade-off); AI **feedback text is English** even in Hindi mode (criterion *labels* are translated, and a Hindi-mode note says so) — both logged in `PRODUCTION_CHECKLIST.md`.

### 20. Sub-Subjects (English / Science / Social Science splitting)
- **What it does:** Three subjects split into selectable **sub-subjects**, each its own independent course: **English** → Writing, Grammar, Reading, **Fusion**; **Science** → Physics, Chemistry, Biology, **Combined**; **Social Science** → Economics, Civics, Geography, History, **Combined**. The **Fusion/Combined** option spans all of that subject's areas. Every other subject (Maths, Hindi, JEE, NEET) stays flat. Onboarding / "add a subject" becomes a **hierarchical picker** (subject → area); the diagnostic, roadmap, module quizzes, and weak-topic tracking are all **scoped to the chosen area** — a student on "English → Grammar" gets a Grammar-only diagnostic, a Grammar-only roadmap, and a Progress view showing only Grammar weak topics.
- **Course identity:** extended from `{userId, grade, subject}` to **`{userId, grade, subject, subSubject}`**. Each area is a separate roadmap, switched/archived independently via the exact multi-subject machinery (Feature 7) — so `English · Grammar` and `English · Fusion` are two distinct switchable courses, and regenerating one never touches another.
- **Written questions interaction:** English **Writing & Fusion** are written-heavy (auto-include essay questions, essay `50/30/20` grading — Feature 19); Grammar/Reading and all others are not, unless the `includeWritten` toggle is used.
- **Taxonomy source:** the single source of truth (`server/src/config/taxonomy.js` + `client/src/data/taxonomy.js`, Feature-map §Tech) was **extended, not forked** — `SUB_SUBJECTS`, `FUSION_SUBSUBJECT`, and helpers (`hasSubSubjects`, `subSubjectsFor`, `isWrittenHeavy`, `subjectScopeLabel`, …), mirrored client↔server (drift-guarded).
- **Migration:** existing flat English/Science/Social Science roadmaps + diagnostic results were **grandfathered** to their Fusion/Combined equivalent (an old flat "English" already spanned writing+grammar+reading = Fusion) via `server/src/scripts/backfill-subsubject.js` — non-destructive, idempotent, `--dry-run` default, reversible via `--rollback` (logs modified ids). Non-split subjects and legacy docs (no `subSubject`) keep working unchanged (`''` default).
- **Backend:** no new endpoints — the existing diagnostic/roadmap/practice generate + submit routes are sub-subject-aware (scoped Groq generation, static-bank bypass for split subjects, identity-key archiving, `getResourceLinkForTopic` scoped out for sub-subjects), all keeping their `requireRole('student')` gating.

### 21. Voice Narration Preferences & Mentor Voice I/O
- **What it does:** Adds account-wide **voice-narration preferences** and **voice I/O across the app**:
  - **Account-wide preferences:** `narrationLanguagePref` ('hindi', 'english', 'match-toggle') and `autoNarrateQuizzes` (boolean) persisted on the `User` model, hydrated on login, synced across devices, and editable in **Settings → Profile**.
  - **First-run narration prompt:** A one-time modal prompt (`hasSeenNarrationPrompt`) shown on the student's first quiz encounter (Diagnostic, Module Quiz, or Practice). Yes/No choice with language sub-choice. "No" or "Yes" marks the prompt as seen so it never nags again.
  - **Auto-narrate quiz questions:** Questions auto-narrate on load when enabled, using an `autoPlay` prop on `SpeakerButton`. Browser autoplay-policy blocks (`NotAllowedError`) degrade gracefully to a pulsing visual highlight ("Tap to listen"). In multi-question renders (ModuleQuiz, PracticeMode), auto-play is restricted to Q1 to prevent audio overlap.
  - **Language resolution & fallback chain:** Hindi narration is default site-wide except for English-subject content (exempt rule). English uses `Sarvam -> Web Speech`. Hindi uses `Sarvam -> OpenAI TTS (gpt-4o-mini-tts) -> Web Speech` (since Groq TTS doesn't support Devanagari).
  - **Mentor voice I/O:** Adds a manual speaker button to Mentor assistant replies (using `SpeakerButton` with `ttsText` via the upgraded `/api/chat/tts` endpoint) and a microphone button to the Mentor input area (reusing the shared `useSpeechInput` hook for SpeechRecognition live dictation + MediaRecorder/Sarvam STT fallback). Note: Mentor replies are manual-only (no auto-play).
- **Components/Pages:**
  - `client/src/components/NarrationPrompt.jsx` (one-time prompt modal)
  - `client/src/components/SpeakerButton.jsx` (extended with `autoPlay`, `ttsText`, autoplay-blocked handling)
  - `client/src/hooks/useSpeechInput.js` (reusable STT hook for ChatWidget and MentorPage)
  - `client/src/pages/MentorPage.jsx`, `client/src/components/ChatWidget.jsx`, `client/src/pages/ProfilePage.jsx`
- **Backend Routes & Utilities:**
  - `PATCH /api/auth/preferences` (account-level preference saving)
  - `POST /api/chat/tts` (upgraded to use `synthesizeSpeech` with Sarvam -> OpenAI Hindi fallback)
  - `server/src/utils/openaiTts.js` (OpenAI TTS fallback), `server/src/utils/narration.js` / `client/src/utils/narration.js` (language resolution logic)

### 22. Student Profile Onboarding (with DPDP-grade Aadhaar handling)
- **What it does:** On a student's **first login**, before the subject picker and diagnostic, a multi-step animated flow collects their profile. The existing avatar (`public/chatbot-avatar.png`) asks one question per screen conversationally, with a segmented spring-animated progress bar, horizontal slide transitions (`framer-motion`), auto-advance on the board picker, Enter-to-continue on text fields, and a visible Back button. Optional fields are grouped into a final clearly-labelled step with a prominent **Skip**. It finishes with a scale-in checkmark and routes into the existing diagnostic flow.
- **Fields — compulsory:** `age` (5-25), `studyMedium` (board: CBSE, ICSE, Haryana/HBSE, Punjab/PSEB, UP, Maharashtra/MSBSHSE, Bihar/BSEB, Rajasthan/RBSE, or Other → free text), `fatherName`, `schoolName`, `schoolCity` (labelled "City / Village").
- **Fields — optional, every one skippable in one tap:** `phoneNumber` (Indian 10-digit, `+91`/spaces stripped before storage), `location` (`{village, city, state}`), `aadhaarNumber`.

#### AADHAAR HANDLING — THE POLICY
This project is intended for **state-government use**, which *raises* the compliance bar under India's **DPDP Act, 2023**. The following is the complete policy, not a summary of one — it is the answer to a privacy review, and each point is enforced in code with a named test.

| Requirement | How it is enforced | Where |
| :--- | :--- | :--- |
| **Validated, not merely accepted** | UIDAI's **Verhoeff checksum**, client- *and* server-side. 12 digits that fail it are rejected, which keeps typos and junk out of the database. Passing the checksum is **not** identity verification and is never presented as such. | `utils/verhoeff.js` |
| **Encrypted at rest** | **AES-256-GCM** (authenticated, so tampering fails loudly rather than yielding garbage plaintext). Stored as `{ciphertext, iv, authTag}` with a random 12-byte IV per encryption. | `utils/aadhaarCrypto.js` |
| **Plaintext is NEVER stored** | Not in a temporary field, not in a pre-save hook. The route encrypts **at the request boundary** — validate → encrypt → release the plaintext handle → *only then* touch a Mongoose document. There is no ordering mistake that could persist it, because no plaintext exists by the time a document is in scope. | `routes/auth.js` |
| **Only `aadhaarLast4` is plaintext** | Kept solely so a masked value can be displayed. | `models/User.js` |
| **Never returned to any client, in any role** | All reads return `XXXX XXXX 1234`. `publicProfile()` enumerates allowed fields rather than deleting disallowed ones, so a schema field added later is invisible until added deliberately. | `routes/auth.js` |
| **Not even the mask reaches a parent or admin** | Under Option B (Feature 14) a parent shares the student's `User` document, so this was reachable. Consent was given for *verification*, not family visibility — so the Aadhaar keys are **omitted entirely** from a non-student session's payload. An absent key cannot be rendered by a client that forgets to check the role. | `publicProfile(user, role)` |
| **There is NO decrypt function** | Deliberate. A general-purpose decrypt helper means every future route is one import away from exposing plaintext. See *"THE INTENDED READ PATH"* in `PRODUCTION_CHECKLIST.md`: if a UIDAI verification requirement ever arrives, it is met by an **offline, admin-gated, per-access-audit-logged export tool** — never a live API route, and with the key read from the operator's environment rather than the server's. | absent by design |
| **Read paths are sealed against `.lean()` too** | Document `toJSON`/`toObject` transforms strip the envelope, but Mongoose skips those on `.lean()` and aggregation — so **query middleware** (`pre(/^find/)`) projects it away, plus an aggregation `$unset` guard. The single escape hatch is `.setOptions({includeAadhaarEnvelope: true})`, and CI asserts it appears nowhere. | `models/User.js` |
| **Explicit consent, recorded** | An unticked checkbox — *"I agree to share my Aadhaar number for verification purposes."* Aadhaar is not accepted without it, and `aadhaarConsentAt` stores the timestamp. Consent is checked **per submission**: a **Replace** is a new disclosure, so the box reappears unticked and the timestamp is written fresh, never reused. | `utils/validateProfile.js` |
| **Consent can be withdrawn (a DPDP right)** | `DELETE /api/auth/profile/aadhaar` `$unset`s the envelope, `aadhaarLast4` **and** `aadhaarConsentAt` together — a stranded last4 is still identifying, and a stranded timestamp records consent for data no longer held. Removal is **total and irreversible** (nothing is archived, because nothing can be decrypted), and the confirm dialog says so. | `routes/auth.js` |
| **Never logged** | Not in console output, error messages or analytics. Validation errors return **codes** (`AADHAAR_CHECKSUM_INVALID`), never prose containing the value — so the response shape makes echoing the input *unrepresentable* rather than merely discouraged. `req.body` is never logged on any path, since that body carries the plaintext. | CI-enforced |
| **Collection is opt-in per deployment** | Off unless `AADHAAR_COLLECTION_ENABLED=true`. The server **refuses to boot** if it is enabled without a valid 32-byte `AADHAAR_ENCRYPTION_KEY`, and the client **hides the field entirely** when disabled rather than showing one that must fail on submit. | `assertAadhaarKeyOrExit()` |

- **Location privacy stance:** "Use my location" posts coordinates to `POST /api/auth/reverse-geocode`, which returns **only** `{village, city, state}`. Coordinates are **never stored** — `profile.location` has no latitude/longitude field at all, so they have nowhere to be written even by careless later code (CI asserts no coordinate field exists on any model) — and never logged, on success or failure. Uses free **Nominatim (OpenStreetMap)**: no API key, but its usage policy is a *condition* of the tier, so an identifying `User-Agent` (`NOMINATIM_CONTACT`) and a ~1 req/sec delay are enforced in the util, with the shared `rateLimiter.js` capping lookups per user and a coarse ~1 km cache key. Permission-denied falls back to manual text entry with no error modal.
- **The onboarding draft is not a leak either.** A five-step flow needs a draft, but a draft holding a plaintext Aadhaar in `localStorage` would survive logout on a shared school device and undo the encryption entirely. So the draft is an **allow-list** — Aadhaar and its consent flag are absent by construction and re-entered on reload — it is keyed **per `userId`** so one student never sees another's prefilled details, it is re-filtered **on read** so an older build's draft cannot resurrect a field now considered unsafe, and it is cleared on confirmed submit and on logout beside the session token.
- **Route gating:** `ProtectedRoute.jsx` sends a student with `onboardingCompleted === false` to `/onboarding/profile`. The parent forced-password-change gate (Feature 14) is checked **first** and onboarding is `role === 'student'` only — both because the shared document makes the flag reachable from a parent session. The route **exempts its own path**, and `saveProfileDetails` sets the flag optimistically, so neither the guard nor the completion handler can loop.
- **Accessibility & mobile:** mobile-first from 360px; `inputMode="numeric"` on age/phone/Aadhaar; `autoComplete="off"` on Aadhaar so password managers do not retain it; focus moves to each step's input on transition (so the mobile keyboard opens and keyboard users need not tab back in); the avatar's typed question sits in an `aria-live` region; the typing animation **never gates input**; Android hardware Back moves between steps rather than exiting the flow; `prefers-reduced-motion` cross-fades instead of sliding.
- **Fully bilingual:** every label, board name, placeholder, helper string and **error** goes through `translations.js`. Server validation returns codes precisely so the highest-frequency text in the flow localises like everything else — a Hindi-mode student never sees an English error the moment they mistype.
- **Existing students are unaffected:** `scripts/backfill-onboarding.js` marks pre-existing accounts complete, filtering on `onboardingCompleted: {$exists: false}` (**not** `$ne: true`, which would also catch post-launch students mid-flow and permanently skip their profile). Dry-run by default, `--apply` to commit, `--rollback` to revert via a recorded id log. **Deploy order is load-bearing** — see the runbook in `PRODUCTION_CHECKLIST.md`.
- **Components/Pages:**
  - `client/src/pages/ProfileOnboarding.jsx` (the animated flow) + `client/src/utils/onboardingDraft.js` (draft allow-list) + `client/src/utils/onboardingSteps.js` (step map; routes a server field error back to the step that owns the field, since an error about step 1 is unactionable rendered on step 5)
  - `client/src/pages/ProfilePage.jsx` (Settings → Edit Profile: masked Aadhaar with **Replace** and **Remove**)
- **Backend Routes & Utilities:**
  - `PATCH /api/auth/profile-details`, `GET /api/auth/profile-config`, `POST /api/auth/reverse-geocode`, `DELETE /api/auth/profile/aadhaar`
  - `server/src/utils/verhoeff.js`, `aadhaarCrypto.js`, `validateProfile.js`, `reverseGeocode.js`
  - `server/ci-invariants.mjs` (asserts the escape hatch is unused, no decrypt exists, Aadhaar and `req.body` are never logged, and no model has a coordinate field), `test-aadhaar-privacy.mjs` (dumps the raw stored document, the `/me` payload and a log grep as proof rather than assertion)

---

### 23. My Notes (Notion-style personal notebook)

- **What it does:** A student's own nested notebook, separate from the AI-generated **PDF Notes Generator** (Feature 18) — that one produces study material *for* them, this one is theirs to write. Pages nest to a bounded depth, can be renamed, reordered and dragged between parents, and a rich-text editor (TipTap/ProseMirror) supports headings, lists, checklists, code and pasted screenshots. Autosave is debounced; the indicator states plainly whether work is saved.
- **Images are uploaded, never embedded.** Pasting a screenshot inserts a **placeholder node** and uploads the file server-side to Cloudinary; only the returned URL enters the document. The reason is not document size: the server hard-rejects any document containing a `data:` URI (`NOTE_INLINE_IMAGE_REJECTED`), so an inlined base64 image would make **every subsequent save of that page fail silently** until the student happened to undo it. The interception is at the ProseMirror level (`editorProps.handlePaste`/`handleDrop` returning `true`), so the base64 node is never created rather than being created and cleaned up — cleanup would be a race. Paste, drop and the file picker share one path, so all three behave identically. Uploads are re-encoded and resized, which strips EXIF — including GPS tags a phone camera may have written into a photo of a textbook page.
- **A paste inserts *after* the selection, never into it.** `insertContent` replaces a non-empty selection, and inserting an atom leaves a NodeSelection **on** the node just inserted — so a second paste arriving while the first placeholder was still selected replaced it. The first upload then resolved against a node that no longer existed: its image never appeared, no error was raised anywhere, and its Cloudinary asset was left orphaned. Silent loss on an ordinary two-screenshot paste. The position is therefore re-read from the selection and passed explicitly (`insertContentAt`) on every insert, which also covers two images in a single paste.
- **A page mid-upload cannot be saved.** While a placeholder is unresolved the save manager is blocked, and it releases only once **every** in-flight upload settles — a second paste must not unblock saving for the first. A failed upload **removes** its placeholder rather than leaving it behind, because a stranded placeholder would block autosave forever while corrupting nothing visibly, which is the hardest kind of failure for a student to explain.
- **Deleting a parent states the cost.** The cascade-delete confirmation names the number of child pages that will go with it, and is tested from the **collapsed** state — the case where the student cannot see what they are about to lose.
- **Components/Pages:** `client/src/components/MyNotesPanel.jsx`, `client/src/components/notes/`, `client/src/utils/noteSaveManager.js` (the autosave state machine), `client/src/utils/noteImagePaste.js` (the interception + upload path)
- **The page tree.** Pages nest to a bounded depth (a deeper `parentId` is rejected, not silently flattened) and each page knows only its parent, so the tree is derived rather than stored — there is no second structure that can disagree with the pages themselves. Titles come from the document: renaming the page and editing its first heading are the same act, because two independent names for one page is a state where the sidebar and the page can disagree and neither is wrong. Full-text search runs server-side over the student’s own pages only.
- **Reorder requires the COMPLETE sibling list.** A drag sends every sibling of the target parent in its new order, and a partial list is rejected rather than applied. Accepting a partial list meant the omitted siblings kept their old order values and collided with the new ones — observed as two pages both claiming position 0 (`Two:0 Four:0`), which silently reshuffled pages the student had never touched. A rejected reorder is visible and recoverable; a silent reshuffle of someone’s notebook is neither.
- **Ownership is enforced as 404, not 403.** Every read and write is scoped to the requesting student and a miss returns *not found* rather than *forbidden*, because `403` confirms the page exists and leaks that another student has it.
- **Autosave rules.** Debounced, and a save is never issued for a document the student did not type — opening a page calls `setContent`, which fires `onUpdate` exactly like a keystroke, so the manager tracks the id it captured at schedule time and discards a response tagged with a different one. Switching pages mid-debounce flushes to the page being left, never to the one being opened. Saving is blocked while an image upload is in flight and the pending payload is discarded on unblock, since it still describes a document containing the placeholder. On unmount and on `beforeunload` a pending save is flushed with `fetch(keepalive)` — `sendBeacon` cannot set headers, so it cannot authenticate.
- **The formatting toolbar is fixed to the bottom on mobile.** A floating bubble anchored to the selection is the desktop idiom and is unusable at 360px: the soft keyboard occupies the lower half of the screen and the bubble lands under it. Verified in a real browser at 360x400 (a ~320px keyboard) with the toolbar still reachable.
- **Backend Routes & Utilities:** `server/src/routes/myNotes.js`, `server/src/models/Note.js`, `server/src/utils/tiptapDoc.js` (document validation, `data:` and placeholder rejection), `uploadNoteImage()` in `server/src/utils/cloudinary.js`


### 24. Diagram / Figure Questions (generated SVG)

- **What it does:** Quiz questions in visual chapters can carry a **figure** — a circle with a labelled chord, a ray striking a mirror, a labelled cross-section. Figures appear in the adaptive diagnostic (Feature 1), cached per-day module quizzes (Feature 9) and practice mode (Feature 11), on the question, in the post-submit review, and in the read-aloud path.

- **Why generated SVG and not image search.** Search results are copyrighted, frequently mislabelled, and the free tiers are far too small for per-question lookups. Groq emits the figure as inline SVG alongside the question: it costs nothing extra, always matches the question it was generated for, is a few KB of text rather than a binary, scales to any screen, and can be recoloured for dark mode via `currentColor`.

- **Model-generated SVG is treated as hostile.** SVG is executable. Sanitisation is a strict **allow-list** — unknown tags and unknown attributes are *dropped, not escaped* — and `script`, `foreignObject`, `image`, `use`, `style`, `a` and every `animate*` element are absent from it by construction. The client then renders the result as a **data-URI `<img>`**, which cannot execute script even if sanitisation were bypassed. That is deliberate defence in depth: sanitisation is not a single point of failure. If a figure cannot be made safe it is dropped and the question ships text-only, because a question without a figure is acceptable and an unsafe one is not.

- **Two size caps, for two different reasons.** Real output measures ~550 bytes (min 402, max 619 across circles / solids / circuits). The general cap is **50KB** as a runaway backstop. Figures that get **cached** on a Roadmap day use a tighter **8KB** cap (`CACHED_SVG_MAX_BYTES`) — the risk there is not the mean but the tail: at 50KB, four pathological figures a day across 15 days would put ~3MB of SVG inside a single Roadmap document that already holds lesson prose, questions, attempts and video progress, against MongoDB's 16MB limit. At 8KB the same worst case is ~480KB, and since real figures are ~550 bytes it rejects nothing that actually occurs.

- **Eligibility is decided at the coarsest level that can be answered honestly.** Where a question has a resolved blueprint chapter, that chapter's `diagramEligible` flag decides. Where it does not — practice mode takes a free-text topic from the student — the decision falls to `subjectDiagramEligible()` in `taxonomy.js`. Matching student text against chapter names was considered and rejected: that same fuzzy-substring approach already caused a real bug in the roadmap graft, where *"Areas Related to Circles"* matched *"Circles"* and the requested chapter went missing. A wrong chapter would silently apply the wrong eligibility, so the coarser question gets asked instead. Grammar and Economics contain no eligible chapters and never pay for a figure call.

- **A missing blueprint row is not a decision.** The blueprint covers the exam grades; the taxonomy covers all 280 course identities. So an unresolved chapter falls *through* to the subject-level gate rather than answering "not eligible". Gating a module quiz on the chapter alone meant a Class 6 Maths module quiz silently never attempted a figure while a Class 6 Maths *practice* quiz did — same student, same subject, different behaviour, nothing surfacing it.

- **Accessibility is a hard requirement of the figure, not a nicety.** A figure is only accepted if the model also returns one plain-sentence `alt` description; a valid SVG with no alt text is **rejected**. The alt text is what a screen reader announces, and it is prepended to the spoken text in the read-aloud path so a student using narration hears what is drawn rather than silence. Alt text is translated for Hindi through the same cache as question text. Figures are also zoomable, since a labelled diagram at 360px is otherwise unreadable.

- **A figure must DEPICT the structure, not label it.** A cell-nucleus figure once shipped as four labels stacked inside an empty oval — no envelope, no nucleolus, no chromatin, no leader lines. It passed every check that existed (valid SVG, correct viewBox, under the cap, sanitises clean, alt text present) because all of those check **safety and well-formedness**, and none of them ask whether the figure teaches anything. Three rules now apply, stated in the prompt and **enforced** by `validateDepiction()`: every named part is drawn as its own shape; labels sit outside the figure with a `<line>`/`<polyline>` leader to the part; and the figure must remain interpretable with **every `<text>` element deleted**. A figure failing any of them is rejected and the question caches text-only, per the existing rule. The validator ships independently of the model choice, because a stronger model makes label-only output rarer without making it impossible — and "rarer" is not a property you can cache for the life of a roadmap.
- **Diagram generation deliberately prefers OpenAI**, inverting the app-wide Groq-first chain — see `DIAGRAM_MODEL`. Diagrams are low-volume, produce ~1KB of output, and are the one task in the app requiring genuine spatial reasoning, which makes this the highest quality-per-rupee use of the paid key. Groq remains the fallback so an outage degrades the figure rather than removing it.
- **The figure must never give away the answer.** The generation prompt forbids labelling the quantity the question asks for, and questions that ask the student to *"prove / show that"* or that reference a figure they were not given are rejected upstream.

- **Expected variance, not a bug.** The per-subject figure rate is **not deterministic**. The share sets a ceiling on *candidates*, and the model independently declines any question whose text is self-sufficient — which is the intended direction. Measured: three identical practice calls returned 0, 1 and 2 figures with no code change, and a Class 10 Maths module quiz has returned 0, 2 and 4 across runs. A quiz showing no figures is therefore not evidence of a fault. What *is* checkable is that the path was attempted — `diagramAttempted` records a decision on every candidate.

- **Components/Pages:** `client/src/components/QuestionDiagram.jsx` (data-URI render, `currentColor` theming, zoom, `diagramAltFor`), wired into `Onboarding.jsx`, `DiagnosticReview.jsx`, `ModuleQuiz.jsx` and `PracticeMode.jsx` — question surface and review surface alike.
- **Backend Routes & Utilities:** `server/src/utils/generateDiagram.js` (prompt, allow-list sanitiser with named drop stages, `attachDiagrams`, `applyDiagramResult`, the orphan guard, `needsDiagramRetry`), `diagramEligible` flags in `server/src/config/syllabusBlueprint.js`, `subjectDiagramEligible()` in `server/src/config/taxonomy.js`. No new endpoints — figures ride on the existing diagnostic, module-quiz and practice responses.


---

## Design Rules (and why they exist)

Each of these is a rule that looks arbitrary until you know what went wrong without it. They are recorded here with their reasons rather than only as code comments, because a constraint stated as prose erodes — but a reason written down is at least **contestable**: someone who disagrees has to argue with it, instead of not knowing it existed. Every one of these was a real defect first.

**1. A figure never mentioned is fine; a mention with no figure is broken.**
The orphan guard is deliberately asymmetric. A question carrying a diagram that never refers to it is *supporting context* and is perfectly valid. A question that says *"in the figure below"* with no figure is **unanswerable**, and `rejectOrphanedFigureQuestions()` drops it rather than storing it. Why it is a validation rule and not a checklist note: a module quiz is cached once and served for the life of the roadmap, so an orphaned reference that reaches the cache is served that way *forever*. This is the daily-lesson filler bug in a new location, and prose does not stop it recurring — a rule that rejects the question cannot be forgotten. The check covers Devanagari phrasings too, because a translated question travels the same caching path and a Hindi figure reference is exactly as orphaned as an English one.

**2. `MODEL_DECLINED` is terminal. A timeout or an error is not.**
All three produce no figure and look identical in the output; two of them mean the opposite of the third. *Declined* is a decision the model made about this specific question — it read the text and judged a figure unnecessary — and it will not change on a retry. *Failed* and *timed out* say nothing about whether a figure is warranted. Collapsing them into one bare `null` (which is what the code originally did) made a 429 **permanent**: the caller stamped `diagramAttempted = true`, the terminal state, so one transient provider blip cost that cached question its figure for the life of the roadmap. `generateDiagramFor` therefore returns a discriminated `{status: 'ok' | 'declined' | 'failed'}`, and `applyDiagramResult()` — a pure function, so the rule can be asserted directly for all four outcomes — stamps only on outcomes that cannot change. A retryable state gets **exactly one** retry on the next day fetch, and that attempt is burned whatever happens, because a persistently degraded provider must not be re-called on every single day view forever.

**3. "Deliberately not sampled" is not "sampled and failed".**
Only ~35% of eligible questions are chosen to carry a figure; the rest are skipped *on purpose*. Without recording that, the two states are indistinguishable and the retry pass grabs every unsampled question. Measured without `finalizeUnselected`: **0 → 6 → 6** figures across three consecutive fetches of the same cached quiz. Two separate failures at once — a supposedly immutable cached artefact mutating on revisit, and the sampling share driven to 60% against a 35% target, fetch by fetch. For a cached artefact the sampling decision *is* final, so it is recorded as one.

**4. Practice share is 0.20; module quizzes are 0.35.**
Not a tuning preference. A module quiz is generated once per day and cached, so its figures are paid for once and amortised over every revisit. Practice mode regenerates **every session**, so the same ten questions pay for figures again on every attempt — on a rate-limited key that is the difference between a practice quiz taking ~8s and ~30s. Practice is for volume and repetition; the module quiz is the once-per-day artefact worth spending on.

**5. Reorder requires the complete sibling list.**
A partial list is rejected rather than applied. Accepting one left the omitted siblings holding their old order values, colliding with the newly assigned ones — observed as two pages both claiming position 0 (`Two:0 Four:0`), which silently reshuffled pages the student never touched. A rejected reorder is visible and recoverable; a silent reshuffle of someone's notebook is neither.

**6. Image insertion re-reads the selection every time.**
`insertContent` inserts *into* the current selection and replaces it when non-empty — and inserting an atom leaves a **NodeSelection on the node just inserted**. So a second paste arriving while the first placeholder was still selected *replaced* it. The first upload then resolved against a node that no longer existed: no image appeared, no error was raised anywhere, and its Cloudinary asset was left orphaned. Silent data loss on an ordinary two-screenshot paste. The position is therefore re-read from the selection and passed explicitly via `insertContentAt`, which also covers two images in a single paste.

**7. The diagnostic has no content fallback, on purpose.**
The handwritten question banks and every template filler string were **deleted**, not kept as a safety net. They were the source of the off-level questions (*"if r = 4, what is the diameter?"* for Class 10). A wrong-level diagnostic produces a wrong roadmap, and a student studying the wrong things for two weeks is worse off than a student who saw an honest error and retried. So when generation genuinely fails the endpoint returns **503** and asks the student to retry. The same rule governs daily lessons: a failed generation returns `contentAvailable: false` and **caches nothing**, because the earlier behaviour cached filler *and* set `contentGenerated = true`, freezing a non-lesson in place permanently — the student never received real content even after the provider recovered.

**8. The onboarding backfill filters on `$exists: false`, not `$ne: true`.**
`$ne: true` matches documents where the field is absent **and** documents where it is explicitly `false`. A student who has begun onboarding and legitimately holds `onboardingCompleted: false` would be matched and have their in-progress state overwritten by the backfill. `$exists: false` matches only the documents that predate the field — which is the entire population the backfill is for. The distinction is invisible in a passing run against fresh data and destructive against real data.

**10. Narration is owned by one module, and starting a narration IS stopping the previous one.**
Audio used to outlive the page that started it: a student began a quiz question, navigated away mid-sentence, and the audio kept talking over the next page's auto-narration. Three causes had to be closed together. `window.speechSynthesis` is a **browser-level singleton** that no component unmounts, so a route change does not touch it. An `HTMLAudioElement` is **not part of the DOM lifecycle** — once handed to the audio pipeline it keeps playing after its component is gone. And playback was owned **per component**, so nothing could stop "whatever is speaking right now". So playback lives in `narrationController.js` at module scope, and `playNarration()` calls `stopNarration()` first, unconditionally — which removes most overlap cases without any caller cooperation. `stopNarration()` must pause **and** clear `src` (an element with a live source can resume), cancel `speechSynthesis` **unconditionally** (the fallback may have started without the caller knowing), abort the in-flight fetch, and bump the token. Aborting is necessary but not sufficient: the abort can lose the race, and the Web Speech path has no fetch to abort — so a token captured before the request is compared after it, exactly as `noteSaveManager` does for stale saves, and playback is discarded if it differs. Unmount stops **only if that button owns the playback**: an unconditional stop would be worse than the bug, because quiz auto-narration unmounts question N's button as N+1's mounts. And because the sidebar swaps `activeSection` **without changing the route**, a `pathname`-only stopper misses every dashboard section change — that path needs its own stop. CI invariant 10 keeps `new Audio(` and `speechSynthesis.speak(` out of every other file, because a third owner would look entirely reasonable at the call site.

**12. A route or state effect that stops something must skip its first run.**
`useEffect(..., [pathname])` fires on **mount** as well as on change, and on mount there is by definition nothing to stop — but there IS something about to start. React runs effects bottom-up, so a page's `autoPlay` effect has already scheduled its narration by the time a parent stopper runs. Without a `useRef` first-run guard, both `NarrationStopper` and the dashboard's `activeSection` effect kill auto-narration on **every page load**, and the symptom is nasty: manual speaker buttons work perfectly, autoplay silently never plays, and nothing errors anywhere.

The important part is *why this was not already failing*. `SpeakerButton`'s autoPlay effect defers by 300 ms, so the mount-time stop happened to land **before** narration started. That is not protection — it is a race that was already broken and merely losing slowly. A faster mount, a slower stop, or anyone "tidying up" that 300 ms delay flips it, and it flips into a silent failure with no error to trace. **The `useRef` guard is what makes autoplay correct; the delay was masking the defect, not preventing it.** Do not remove the guard on the grounds that autoplay currently works.

The suite that should have caught this could not: all twelve of its checks verified *cessation*, so it would have stayed green with auto-narration entirely dead. It now has an INITIATION section that asserts `isNarrating()` after a load, plus a fixture check that the `autoNarrateQuizzes` preference is actually **on** — otherwise "autoplay did not fire" is indistinguishable from "autoplay is broken". Rule 11, one more time.

**11. A harness that observes the system from outside its actual mechanism will pass regardless of behaviour.**
This is Rule 9's sharper form, and Workstream F produced three instances in one sitting. The narration suite measured `document.querySelectorAll('audio')` — but the shared element is created with `new Audio()` and **never attached to the DOM**, which is precisely *why* it survives a route change. So the check was structurally blind to the thing it existed to test, and reported "0 playing" while audio played perfectly. Likewise a glob pattern missed the parameterised `/diagnostic/:id/question/:i/audio` route, so a run labelled "Web Speech fallback" silently exercised the server path; and a stubbed 502 omitted the `fallbackText` the real server sends, testing a situation that cannot occur in production. All three produced green results that proved nothing. The corollary: **when a bug exists because something escapes the normal mechanism, the test must observe the escape route, not the mechanism.** The three fixes are commented in place in `acceptance-narration.mjs` — do not "simplify" `querySelectorAll` back in.

**9. A test double must be able to represent the failure, or the test is decorative.**
The paste-handler's fake editor implemented `insertContent` as `doc.content.push(node)`. It could not express *replacement*, so it passed no matter what the code did — and it did pass, while two real pastes destroyed one another in the browser. **If the fake is simpler than the contract, the test can only verify what you already believed.** The double now models selection semantics (insert replaces a non-empty range; inserting an atom leaves a NodeSelection on it) and performs the placeholder swap. Making it honest immediately broke two existing assertions that had asserted a placeholder *remained* after a successful upload — they had been encoding the broken behaviour. Two corollaries, both learned the hard way: **check the fixture before blaming the code** (a 1-character school name failed validation and produced four cascading false failures), and **assert the thing the bug made impossible, not the downstream effect** — with a non-deterministic generator, asserting "a figure appeared" is flaky, while asserting "a decision was recorded" is exact.

**13. A register instruction that loosens the task definition is worse than the formal register it replaces.**
The first draft of the Hindi register prompt led with *"write the way a teacher SPEAKS in class"*. The model read that as licence to **teach**: asked to translate *"Read the following paragraph carefully and then answer the questions"* it invented an entire passage plus five comprehension questions; asked to translate a quadratic equation it tried to solve it, and got the answer wrong; asked to translate *"You answered 7 out of 10 questions correctly"* it produced the **student** speaking — *"कृपया मुझे विस्तार से समझाएं कि मैं क्या गलत कर रहा था"*. Every one of those is a wrong question in front of a student, which is strictly worse than a stiffly-worded right one. The fix is ordering, not content: **fidelity constraints first and hardest** ("You are a TRANSLATOR… never answer, solve, explain or add"), register second, and temperature left low — the register must come from the instruction, not from sampling drift.

**14. Fixed terminology belongs in a glossary, not in a better model.**
Two errors survived the register fix: *concave mirror* → वक्र दर्पण (NCERT settles this: **अवतल दर्पण**) and *playing audio* → खेलने (खेलना is play-a-game; audio is **चलाना**). Neither is a fluency failure, so neither improves on a stronger model — one is a term the textbook decides, the other an English homonym where the model picked the wrong sense. `server/src/config/hindiGlossary.js` pins both classes, and only the terms **present in the source string** are injected, so the register rules are not buried under 90 lines of vocabulary.

Applied by **prompt injection, not post-translation substitution** — deliberately. Substituting afterwards is deterministic and tempting, and it breaks Hindi: the language inflects around the noun (अवतल दर्पण **से** / **का** / **में**, with verb and adjective agreement following the noun's gender), so blind replacement of a translated term yields ungrammatical output — and broken Hindi read aloud is worse than a slightly-off term, because the student cannot parse it at all. The trade is that injection is advisory: a model *can* ignore it. If a term is persistently ignored, assert it in `test:glossary` rather than switching to substitution.

One thing worth stating plainly: a glossary is **deterministic**, which makes it the rare part of this build that is *not* substrate-dependent. Every measured number here is provisional pending a funded key (see PRODUCTION_CHECKLIST); a pinned termbase produces the same answer on 8b, on 70b, and on whatever replaces them.

**15. Judges must batch, and a judge is not a substitute for a gate.**
Two rules about judge design, learned from the subject-competency audit. They sit alongside the one already recorded in Feature 1 — *a generator asked to grade its own output rubber-stamps it* (7 single-step questions, zero self-rejections), which is why every judge here is a separate call that is told it did not write the questions.

**Batch, do not judge one item at a time.** A judge given a single item has no contrast to calibrate against and its verdicts drift; the same items presented together are stable. Measured: **5 identical verdicts across 5 runs** on a 4-question batch, versus run-to-run disagreement on the same questions judged individually — the same conceptual question was kept in one run and rejected in the next. Batch composition still shifts genuinely marginal items, so a single re-judge disagreeing with an earlier one is noise rather than a defect; if a verdict must be trusted absolutely, take a majority of independent passes rather than one.

**A test that judges with a different prompt than production is not measuring production.** The acceptance test re-judged with `scope: 'Science'` while the app builds `'Science (covering all areas: Physics, Chemistry, Biology)'`. Different prompt, different verdict, and the disagreement looked like a bug in the app. Judge with the exact string production constructs — here, `subjectScopeLabel(subject, subSubject)`.

**And prefer a gate to a judge whenever the property is decidable.** The recurrence that survived the subject judge — a Science question labelled *[Area of Rectangle]* — was not a judge-reliability problem at all. `chapterId` was gated against the blueprint; `topic` was taken verbatim from the model and never checked. One deterministic rule (`TOPIC_NOT_IN_CHAPTER`: the topic must share a content word with its chapter's name or concepts) made it structurally impossible, at the cost of one comparison rather than two extra model calls — and closed the residual completely, taking the suite from 8/9 to 9/9. **`topic` is not cosmetic downstream**: `weakTopics.js` aggregates by it and Feature 12 inserts remediation days targeting those labels, so a mislabelled topic corrupts the roadmap *even when the question itself is fine* — a student who misses a Crop Production question would get a remediation day for "Area of Rectangle".

---

## Client-Facing Feature Overview PDF

A polished, non-technical **Feature Overview** document for prospective clients (state education departments) lives at **`docs/Eklavya-Feature-Overview.pdf`** and is generated by a standalone script:

```bash
node server/src/scripts/generateFeaturePdf.mjs
```

- **No server, no database, no API key, no network.** It runs offline on a clean checkout and overwrites the PDF in place, so the document can be regenerated as features land.
- **Reuses the product's own PDF stack** — `@react-pdf/renderer` plus the ported vector Eklavya logo from `server/src/utils/notesPdf.js`. All colours and radii come from a `tokens` object at the top of the script whose values are lifted from `client/src/styles.css`; nothing is hardcoded inline and no palette is invented.
- **Contents (11 pages):** full-bleed cover with a verifiable stat strip → 01 What Eklavya Is → 02 the student journey → 03 how the AI works for each student → 04 the learning core (two pages) → 05 language, access and support → 06 built for Indian classrooms → 07 parents, administrators and accounts → 08 privacy and data protection → full-bleed closing page. Each section opens with a numbered, coloured banner; features render as consistent icon/title/summary/bullet cards, one- or two-up.
- **Editorial rules baked into the script's header comment — keep them when editing:** every claim must be verifiable in this repo; no invented statistics, testimonials, partnerships or compliance certifications; no roadmap or future promises. **Sarvam AI is the only provider named** (it is the reason the Hindi capability is worth citing to a state client); every other provider, model name, endpoint, schema field and file name is deliberately absent, as are all known limitations, fallback chains and test/CI details.
- **Reproducibility:** re-running produces a **visually identical** document — all 11 pages rasterise to identical pixels — but **not a byte-identical file**. `@react-pdf/renderer` emits its page-content objects in a nondeterministic order, so the object numbering (and therefore the file hash) varies between runs even with the document dates pinned. Don't treat a changed hash as a changed document; compare rendered pages instead.
- **Devanagari caveat:** react-pdf's built-in Helvetica has no Devanagari coverage and no font file ships in the repo, so the document is Latin-script only (the tagline is romanised, exactly as `notesPdf.js` renders it). If Hindi text is ever added, register `Noto Sans Devanagari` via `Font.register` first — otherwise it renders as blank boxes.

### react-pdf pitfalls this script works around

Each of these fails **silently** — the PDF still generates, it just renders wrong. All were found by rasterising the output, not by reading the code.

- **Never anchor an absolutely-positioned box by `bottom`.** With no explicit height the layout engine stretches it to a six-figure height and draws its contents far off the top of the page; with an explicit height its `Text` children collapse to zero width and emit no glyphs at all. The running footer is anchored by `top` instead (A4 is 841.89pt tall), which is why the same pattern works for running headers.
- **A `render`-driven `Text` has no content at layout time**, so it has no intrinsic size to fall back on — it is the element most likely to be swallowed by the rule above.
- **`rgba()` works for fills and text but not for borders**, where it renders as an unrelated colour. Borders on coloured panels use an opaque `mix()` of the panel colour with white.
- **Hyphenation is on by default** and breaks headings mid-word ("Each Stu-dent"). `Font.registerHyphenationCallback(w => [w])` disables it.
- **No `box-shadow`, no CSS gradients, no CSS grid.** Cards use a hairline border plus a warm surface; two-column rows are `flexDirection: 'row'` with `width: '48%'` and a spacer.
- **Full-bleed pages need `padding: 0` on the `<Page>`**, with padding applied to an inner view.
- Cards and section banners carry `wrap={false}` so they are never split across a page break.

---

## Tech Stack

### Frontend
- **Framework:** React 19.0.0 (with `vite` 7.0.0 bundler)
- **Routing:** `react-router-dom` 7.18.1
- **Icons:** `lucide-react` 0.468.0
- **Markdown:** `react-markdown` (renders the Mentor tutor's formatted replies)
- **PDF (server-side):** `@react-pdf/renderer` (renders downloadable study-notes PDFs — pure Node, no headless browser)
- **Animations:** `framer-motion` 12.42.2, `motion` 12.42.2, `gsap` 3.15.0, `ogl` 1.0.11 (3D WebGL visuals)
- **Styling:** Vanilla CSS3 with root design tokens, Devanagari font overrides (`Noto Sans Devanagari`), and custom animations

### Backend
- **Runtime:** Node.js (ES Modules `type: "module"`)
- **Web Framework:** Express 4.21.2
- **Database:** MongoDB with Mongoose 8.12.0 ODM
- **Authentication:** `jsonwebtoken` 9.0.2 & `bcryptjs` 3.0.2 (roles + `requireRole` middleware)
- **File Uploads:** `multer` 2.2.0 (memory storage for STT audio and profile-photo processing)
- **Media Storage:** `cloudinary` (server-side profile-photo upload, resize & EXIF stripping)
- **CORS & Config:** `cors` 2.8.5 & `dotenv` 16.4.7

### External APIs & Integrations
- **Groq Cloud API (`llama-3.3-70b-versatile`):** Quiz generation, explanation synthesis, roadmap creation, daily lesson prose writing, chatbot general Q&A, and translation fallback.
- **Sarvam AI API:**
  - Translation (`POST https://api.sarvam.ai/translate` — `en-IN` to `hi-IN`)
  - Text-to-Speech (`POST https://api.sarvam.ai/text-to-speech` — Bulbul v3 model)
  - Speech-to-Text (`POST https://api.sarvam.ai/speech-to-text` — saaras v3 model)
- **YouTube Data API v3:** Real-time search for curated educational video resources in India (`regionCode=IN`, `relevanceLanguage=hi`).

---

## Project Structure

```
project-eklavya/
├── client/                     # Frontend Vite + React application
│   ├── public/                 # Static public assets (e.g. chatbot-avatar.png)
│   ├── src/
│   │   ├── assets/             # Component image assets
│   │   ├── components/         # Reusable React components (Header, ChatWidget, SpeakerButton, RoadmapDashboard, DashboardSidebar, YouTubePlayer, ModuleQuiz, ProgressWeakTopics, PracticeMode, StreakWidget, ParentAccessCard, ParentDashboard, AdminDashboard, AdminSettings, DashboardShell, Avatar, NotesGenerator, WrittenQuestion, QuestionDiagram, MyNotesPanel, ProfileDetailsSection, etc.)
│   │   ├── components/notes/   # My Notes editor surface (page tree, TipTap editor, bottom formatting toolbar, upload placeholder node view)
│   │   ├── context/            # React Context providers (AuthContext.jsx, LanguageContext.jsx)
│   │   ├── data/               # Course catalog (courses.js) and translation dictionary (translations.js)
│   │   ├── pages/              # Top-level page views (DiagnosticReview.jsx, DayDetail.jsx, AuthPage.jsx, ChangePasswordPage.jsx, ProfilePage.jsx, AdminLoginPage.jsx, MentorPage.jsx, ProfileOnboarding.jsx)
│   │   ├── utils/              # Client utility helpers (subject & topic translation mappers, streak.js, noteSaveManager.js — the autosave state machine, noteImagePaste.js — ProseMirror-level paste/drop interception, onboardingDraft.js — the field allow-list that keeps Aadhaar out of localStorage, onboardingSteps.js — maps a server field error back to the step that owns it)
│   │   ├── App.jsx             # Main Router configuration & global ChatWidget mount
│   │   ├── main.jsx            # React root entry point
│   │   └── styles.css          # Global design tokens and component styling
│   └── package.json            # Client dependencies and Vite scripts
│
├── docs/                       # Generated documents (Eklavya-Feature-Overview.pdf — see "Client-Facing Feature Overview PDF")
│
├── server/                     # Backend Node.js + Express API server
│   ├── uploads/                # Disk cache for generated audio WAV files (uploads/audio/ & uploads/audio/temp/)
│   ├── src/
│   │   ├── config/             # Single source of truth for the subject/grade/sub-subject taxonomy (taxonomy.js) + the NCERT/CBSE syllabus blueprint driving diagnostic difficulty (syllabusBlueprint.js)
│   │   ├── data/               # Static route catalog (siteRoutes.js) & grounding knowledge (siteKnowledge.js)
│   │   ├── middleware/         # Auth middleware (auth.js — authMiddleware, requireRole, parentPasswordChangeGate)
│   │   ├── models/             # Mongoose schemas (User, DiagnosticSession, DiagnosticResult, Roadmap, PracticeSession, AdminConfig, Conversation, Note) + writtenFields.js (shared written-question schema fields)
│   │   ├── routes/             # Express API routes (auth.js, admin.js, mentor.js, notes.js, diagnostic.js, roadmap.js, practice.js, activity.js, chat.js, myNotes.js)
│   │   ├── scripts/            # Database remediation and utility maintenance scripts (backfill-onboarding.js — filters on `$exists: false`, never `$ne: true`; see Design Rule 8)
│   │   ├── utils/              # Backend integrations & helpers (sarvamClient.js, localizeReply.js, fetchYoutubeResources.js, textToSpeech.js, translateAndCache.js, recordActivity.js, validatePassword.js, rateLimiter.js, generateTempPassword.js, weakTopics.js, cloudinary.js, imageSniff.js, adminCreds.js, groqClient.js, notesPdf.js, generateWritten.js, gradeWritten.js, diagnosticEngine.js, generateDiagram.js, aadhaarCrypto.js — encrypt-only, NO decrypt export, verhoeff.js, validateProfile.js, reverseGeocode.js, tiptapDoc.js, sourceScan.js — the shared comment/string stripper used by the CI invariants)
│   │   └── server.js           # Server entry point, MongoDB connection, & graceful shutdown
│   ├── ci-invariants.mjs       # 9 STRUCTURAL invariants: Groq only via groqClient, the Aadhaar escape hatch unused, no decrypt exists, Aadhaar and req.body never logged, no coordinate field on any model, client/server taxonomy mirrors in sync, canonicalizeSubtopics covers its schema, one subjectDiagramEligible
│   ├── regress-wsA.mjs         # Adaptive-diagnostic regression suite (algorithm, SVG sanitiser, API auth/error paths, backwards compatibility). Run with the server up
│   ├── test-coverage-handoff.mjs # Asserts POST /api/roadmap/generate CONSUMES chapterCoverage — unassessed chapters must appear at standard pacing, weak ones with more depth
│   ├── test-filler-audit.mjs   # Forces generation down and asserts NO path ships placeholder content, and that nothing fake is cached. Run against a server with an invalid GROQ_API_KEY
│   ├── test-graft-budget.mjs   # Asserts the roadmap stays within 10-15 days when unassessed chapters are grafted in, and that a grafted day still gets subtopics
│   ├── test-mynotes.mjs        # My Notes CRUD, base64/placeholder/size rejections, nesting depth, ownership 404s, cascade delete
│   ├── test-reorder.mjs        # Reorder ownership, the existence-oracle property, and that a partial sibling list is REFUSED rather than colliding
│   ├── test-aadhaar-privacy.mjs # DUMPS the raw stored User document, the /me payload and a log grep — proof rather than assertion that Aadhaar and coordinates never leak
│   ├── test-diagram-wiring.mjs # Workstream D end-to-end: cache-write ordering, the retry state machine, subject gating (with a control), orphan rejection
│   ├── test-lowergrade-figures.mjs # That a course absent from the blueprint still attempts figures (the missing-row-is-not-a-decision rule)
│   ├── test-cloudinary-keys.mjs # Hand-signed direct Upload API probe. Run this FIRST when Cloudinary misbehaves — the SDK swallows the provider error body
│   └── package.json            # Server dependencies and scripts
│
└── README.md                   # Comprehensive repository documentation
```

---

## API Endpoints

| Method | Path | Auth Required | Purpose |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/auth/signup` | No | Register new user — student role (accepts `name`, `email`, `password`, `rememberMe`; enforces the password policy) |
| `POST` | `/api/auth/login` | No (Rate limited) | Authenticate a student **or** parent (same email, different password); returns the session `role` and a `mustChangePassword` flag for a parent on a temp password |
| `GET` | `/api/auth/me` | Yes | Get the current session's profile (role, `parentLinked`, `photoUrl`, `mustChangePassword`) |
| `POST` | `/api/auth/change-password` | Yes | Change the current session's own password (re-verifies the current one) |
| `POST` | `/api/auth/parent/generate` | Yes (student) | Create/regenerate parent access — returns a one-time word-based temp password |
| `PATCH` | `/api/auth/profile` | Yes (student) | Update own name and/or email (email change re-verifies password + uniqueness) |
| `POST` | `/api/auth/profile/photo` | Yes (student) | Upload/replace profile photo (server-side Cloudinary; magic-byte + 2 MB validation) |
| `DELETE` | `/api/auth/profile/photo` | Yes (student) | Remove the profile photo |
| `GET` | `/api/auth/profile-config` | Yes (student) | Whether Aadhaar collection is enabled server-side, so the client never renders a field the server will refuse |
| `PATCH` | `/api/auth/profile-details` | Yes (student) | Save onboarding profile details. Aadhaar is Verhoeff-validated and encrypted (AES-256-GCM) **at the request boundary**, before the document is constructed — the plaintext never reaches a model instance |
| `DELETE` | `/api/auth/profile/aadhaar` | Yes (student) | Withdraw Aadhaar consent and `$unset` the ciphertext, IV and auth tag (DPDP right to withdraw) |
| `POST` | `/api/auth/reverse-geocode` | Yes (student, rate limited) | Resolve coordinates to a city/state label. **Coordinates are used for the lookup and discarded** — never stored, never logged, and no model has a coordinate field (CI-enforced) |
| `POST` | `/api/diagnostic/generate` | Yes (student) | Start an adaptive diagnostic session — returns round 1 (4 blueprint-grounded questions) + `progress` |
| `POST` | `/api/diagnostic/submit` | Yes (student) | Submit **one round** of answers → `{status:'continue', questions, progress}` or `{status:'complete', result}`. Requires the `round` number (stale-round guard) |
| `POST` | `/api/diagnostic/session/:id/translate` | Yes (student) | Translate a **live** diagnostic session's questions into Hindi in place (mid-quiz language switch; ownership-checked → 404) |
| `POST` | `/api/diagnostic/:id/translate` | Yes | Translate a completed diagnostic **result** into Hindi via Sarvam AI |
| `GET` | `/api/diagnostic/:id` | Yes | Fetch diagnostic result details by ID |
| `GET` | `/api/diagnostic/:id/question/:questionIndex/audio` | Yes | Synthesize/fetch cached audio WAV for diagnostic question stem & options |
| `POST` | `/api/diagnostic/live-audio` | Yes (Rate limited) | On-demand audio synthesis for live quiz questions |
| `POST` | `/api/roadmap/generate` | Yes | Generate personalized 10-15 day study roadmap based on diagnostic weak areas |
| `GET` | `/api/roadmap/mine` | Yes | Fetch current user's default active study roadmap |
| `GET` | `/api/roadmap/list` | Yes | List all of the user's active roadmaps (multi-subject switcher) |
| `GET` | `/api/roadmap/:id` | Yes | Fetch roadmap by ID |
| `GET` | `/api/roadmap/:id/day/:dayNumber` | Yes | Fetch daily study module content & YouTube resources |
| `PATCH` | `/api/roadmap/:id/day/:dayNumber` | Yes | Toggle completion status for a study day |
| `POST` | `/api/roadmap/:id/translate` | Yes | Translate study roadmap topics & focus items into Hindi |
| `GET` | `/api/roadmap/:id/day/:dayNumber/audio` | Yes | Synthesize/fetch cached audio WAV for roadmap day content |
| `PATCH` | `/api/roadmap/:id/day/:dayNumber/video-progress` | Yes | Record per-video watch progress (90% = watched) |
| `GET` | `/api/roadmap/:id/day/:dayNumber/quiz` | Yes | Generate/fetch the cached module quiz for a day |
| `POST` | `/api/roadmap/:id/day/:dayNumber/quiz/submit` | Yes | Submit module quiz — score, gate day completion, trigger remediation |
| `GET` | `/api/roadmap/:id/day/:dayNumber/quiz/result` | Yes | Fetch the stored last module-quiz attempt + full review |
| `GET` | `/api/roadmap/:id/day/:dayNumber/quiz/question/:qIndex/audio` | Yes | Synthesize/fetch cached audio for a module quiz question |
| `GET` | `/api/roadmap/:id/weak-topics` | Yes | Aggregated weak sub-topics across the roadmap's quiz results |
| `POST` | `/api/practice/generate` | Yes | Generate a fresh practice quiz for a subject + topic |
| `POST` | `/api/practice/submit` | Yes | Score a practice quiz (no roadmap/weak-topic side effects) |
| `GET` | `/api/my-notes` | Yes (student) | List own notes pages (tree derived from `parentId`) |
| `GET` | `/api/my-notes/search` | Yes (student) | Full-text search across own pages only |
| `POST` | `/api/my-notes` | Yes (student) | Create a page (depth-bounded; a deeper `parentId` is rejected, not flattened) |
| `POST` | `/api/my-notes/reorder` | Yes (student) | Reorder siblings. Requires the **complete** sibling list — a partial list is rejected (see Design Rule 5) |
| `GET` | `/api/my-notes/:id` | Yes (student) | Fetch one page (ownership-checked → 404, never 403) |
| `PATCH` | `/api/my-notes/:id` | Yes (student) | Autosave a page. Rejects any document containing a `data:` URI or an unresolved upload placeholder |
| `DELETE` | `/api/my-notes/:id` | Yes (student) | Delete a page and cascade to its descendants |
| `POST` | `/api/my-notes/:id/image` | Yes (student) | Upload a pasted/dropped image to Cloudinary; returns the URL only. `503` when Cloudinary is unconfigured (text editing unaffected) |
| `GET` | `/api/activity` | Yes | Account-wide study-activity dates (for streak display) |
| `POST` | `/api/admin/login` | No (Rate limited) | Admin sign-in — requires email + password + security code together |
| `POST` | `/api/admin/precheck` | No (Rate limited) | Returns whether an email+password match the admin (used by `/login` to reveal the security-code field) |
| `PATCH` | `/api/admin/credentials` | Yes (admin) | Change admin email/password/security code (gated by the current security code) |
| `GET` | `/api/admin/parent-links` | Yes (admin) | Parent-linkage status across all students |
| `GET` | `/api/admin/student/:studentId` | Yes (admin) | A student's active roadmaps (read-only) |
| `GET` | `/api/admin/student/:studentId/roadmap/:roadmapId/weak-topics` | Yes (admin) | A student's weak topics (read-only) |
| `GET` | `/api/admin/student/:studentId/activity` | Yes (admin) | A student's study-activity dates (read-only) |
| `POST` | `/api/mentor/conversations` | Yes (student) | Create a new Mentor conversation |
| `GET` | `/api/mentor/conversations` | Yes (student) | List own conversations (most recent first) |
| `GET` | `/api/mentor/conversations/:id` | Yes (student) | Full message history (ownership-checked → 404) |
| `POST` | `/api/mentor/conversations/:id/message` | Yes (student, rate limited) | Send a message, persist both turns, return the reply |
| `DELETE` | `/api/mentor/conversations/:id` | Yes (student) | Delete a conversation (ownership-checked → 404) |
| `POST` | `/api/notes/generate` | Yes (student) | Generate structured study notes (JSON) for a subject + topic |
| `POST` | `/api/notes/pdf` | Yes (student) | Render the (edited) notes to a PDF and stream it as a download |
| `POST` | `/api/chat/message` | Optional (Rate limited) | Process AI Chatbot query (intent detection, Q&A, navigation, video search, localization) |
| `POST` | `/api/chat/tts` | Optional (Rate limited) | Synthesize base64 audio for chatbot response via Sarvam Bulbul v3 |
| `POST` | `/api/chat/stt` | Optional (Rate limited) | Speech-to-text audio upload processing via Sarvam saaras v3 |
| `GET` | `/api/health` | No | Health check endpoint returning server status |

---

## Environment Variables Required

Create a `.env` file in the `server/` directory containing the following variables:

```env
# Server Port & Database
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/project_eklavya

# Security — generate a long random value, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
JWT_SECRET=replace_with_a_long_random_secret

# External AI & Data APIs
GROQ_API_KEY=gsk_your_groq_api_key_here
SARVAM_API_KEY=your_sarvam_api_key_here
YOUTUBE_API_KEY=your_youtube_data_api_v3_key_here

# Admin console (optional). Setting ADMIN_EMAIL enables /api/admin/*; if set, the
# server refuses to boot unless ADMIN_PASSWORD and ADMIN_SECURITY_CODE are also set.
# (Once changed from the admin Settings UI, a MongoDB override takes precedence.)
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_SECURITY_CODE=

# Cloudinary — server-side profile-photo uploads (the secret never reaches the client)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
# Optional. An account provisioned outside the default region serves the Upload API
# from api-ap./api-eu.cloudinary.com; a region mismatch surfaces as a PERMISSION
# error, indistinguishable from a bad key without the provider's own error body.
# Set it explicitly from the console rather than relying on the default.
CLOUDINARY_UPLOAD_PREFIX=

# Aadhaar encryption (Feature 22). Required ONLY if Aadhaar collection is enabled —
# the server REFUSES TO BOOT if collection is on and this is absent, because the
# alternative is silently storing government ID in plaintext. 32 bytes, base64:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# There is no decrypt path in the codebase (CI-enforced): the value is written and
# never read back, so losing this key costs the ciphertext and nothing else.
AADHAAR_COLLECTION_ENABLED=false
AADHAAR_ENCRYPTION_KEY=

# Frontend URL (for Production CORS setup)
FRONTEND_URL=http://localhost:5173
```

## Tests

No framework — each file is a plain Node script that exits non-zero on failure, so it
runs anywhere without a runner. Every one exists because the bug it checks for
actually happened during development.

### Server (`cd server`)

| Script | What it protects |
| :--- | :--- |
| `npm run test:invariants` | Structural rules one careless change could break: Groq called only via `groqClient.js`; the Aadhaar escape hatch unused; no decrypt function; Aadhaar and `req.body` never logged; no coordinate field on any model; client/server taxonomy mirrors in sync; `canonicalizeSubtopics` carries every field of the module-quiz schema (it drives the real function and fails **by field name**, so there is no second list to drift); `subjectDiagramEligible` is defined only in `taxonomy.js` |
| `npm run test:diagnostic` | The adaptive algorithm, the SVG sanitiser, API auth/error paths, and backwards compatibility with pre-change documents |
| `npm run test:coverage` | That `POST /api/roadmap/generate` **consumes** `chapterCoverage` — chapters the diagnostic never reached must still appear, at standard pacing |
| `npm run test:filler` | With generation forced down, that no path ships placeholder content and nothing fake is cached. Needs a server started with an invalid `GROQ_API_KEY` |
| `npm run test:graft` | The roadmap stays inside 10-15 days when chapters are grafted in, and a grafted day still gets its `subtopics` |
| `npm run test:notes` | My Notes CRUD, the base64 / placeholder / size rejections, nesting depth, ownership 404s, cascade delete |
| `npm run test:reorder` | Reorder ownership, the existence-oracle property, and that a partial sibling list is refused rather than colliding |
| `npm run test:privacy` | **Dumps** the raw stored `User` document, the `/me` payload and a log grep — proof rather than assertion that Aadhaar and GPS coordinates never leak. Needs `AADHAAR_COLLECTION_ENABLED=true` and a key |
| `npm run test:diagrams` | End-to-end figure wiring against a real server and a live Groq key: a Class 10 Maths/Science module quiz produces a figure within the 8KB cached cap; Grammar and Economics produce none (**with a control proving an eligible subject on the same path still can**, so the zeros are not vacuous); a cached figure is byte-identical on revisit and the count does not creep; a forced caching failure retries exactly once; `MODEL_DECLINED` never retries; nothing referencing a figure caches without one |
| `npm run test:lowergrade` | That a course with **no blueprint entry** (Class 6 Maths) still attempts figures — the blueprint covers exam grades, the taxonomy covers all 280 course identities, and a missing row must fall through rather than decide. Asserts a recorded `diagramAttempted`, not that a figure appeared, since generation is non-deterministic |
| `npm run test:hindi` | Prints the Hindi register **before/after** for real quiz stems, lesson prose and UI strings, plus two mechanical signals (formal-marker count, average sentence length). A table to be read, not an assertion — register is judged by reading it |
| `npm run test:glossary` | That pinned NCERT terms and homonym traps land: *concave mirror* → अवतल दर्पण not वक्र, *playing audio* → चला not खेल. **Deterministic**, so unlike the rest of these numbers it should survive a substrate change |
| `npm run test:register` | END TO END: seeds a Hindi cache in the shape that exists in the database today (translated, **no** version field), reads it through the real route, and proves it retranslates once, is stamped with the current version, and does NOT retranslate on the next read |
| `npm run test:nucleus` | Regenerates the figure that started this — a nucleus rendered as four labels in an empty oval — and prints **before/after** with shape, label and leader counts, plus what survives when every `<text>` is stripped |
| `npm run test:svgsize` | Measures the SVG size distribution across geometry / optics / circuits / biology and reports min/avg/max as a **baseline for the current `DIAGRAM_MODEL`**. Re-run it if that model changes — a different model is a different substrate |
| `npm run test:subject` | That every diagnostic question actually tests its subject. Covers the real failure (*"a farmer sows 2 hectares at 40 kg/hectare, how many kg?"* — arithmetic in costume that passed every structural validator), the compound-question guard, the topic-to-chapter gate, and the Maths exemption. Generates live Science and Social Science diagnostics and re-judges everything served, taking a **majority of three** because batch composition shifts marginal verdicts |
| `npm run test:server` | Everything above except `test:filler` and `test:privacy`, which need special env |
| `npm run diag:cloudinary` | Direct Upload API probe, signed by hand. **Run this first when Cloudinary misbehaves** — the SDK swallows the provider error body, so the server log only ever says `403`. This is what revealed the account was Media Optimizer rather than Programmable Media. Uploads one small asset per run |

### Client (`cd client`)

| Script | What it protects |
| :--- | :--- |
| `npm run test:units` | The notes autosave state machine — debounce race, stale in-flight response, the `setContent`-fires-`onUpdate` footgun, delete-while-pending, navigate-away, upload blocking, sticky error — and the paste handler, which must never let a `data:` URI into the document and must not let one paste overwrite another. Its editor double **models selection**, since the overwrite bug lived there and a double that merely appends reports a pass while two real pastes destroy each other |
| `npm run accept:onboarding` | Real browser at 360px: the onboarding gate, Android hardware Back, focus after the slide transition, auto-advance + Back on the board picker, typing-does-not-gate-input, reduced motion, a full Hindi render |
| `npm run accept:notes` | Real browser: paste a screenshot end to end, fast page-switching while typing, the sticky error state, the bottom toolbar at 360px |
| `npm run accept:notes-tree` | The cascade-delete dialog states the child count, tested from the **collapsed** state where the student cannot see what they are deleting |
| `npm run accept:narration` | Real browser: narration stops on route change, on an in-app section change (asserted against a `/dashboard -> /dashboard` fixture check, since the sidebar does not change the route), when a second button is pressed, when the tab is backgrounded, and when the student navigates **while the TTS request is still in flight** (network throttled to force it). Runs twice — once on the server audio path and once with `ACC_FORCE_FALLBACK=1`, which fails every TTS route to exercise Web Speech, the surface most likely to survive |
| `npm run verify:narration` | Proves the suite can actually CATCH the bug. Asserts `isNarrating()` directly after a programmatic in-app navigation rather than driving real audio — two attempts through a real TTS round-trip were inconclusive on provider latency. Revert the route-change effect and this reports `narration SURVIVED the route change` |

Start the API with **`npm start` (or `npm run serve:test`), NOT `npm run dev`** before any
acceptance run. The dev watcher restarts the server on every TTS write — TTS writes WAV
files under `server/uploads/` — which kills whatever request is in flight and surfaces
in the browser as a CORS error, because a preflight that gets no response is reported
that way. That cost a full session of misdiagnosis; see PRODUCTION_CHECKLIST.

The acceptance scripts need both servers running, playwright installed
(`npm i --no-save playwright`), and a seeded token in `ACC_TOKEN` — each file header
shows the seeding command.

---

## Setup & Running Locally

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB running locally at `mongodb://127.0.0.1:27017` or a MongoDB Atlas connection string

### 1. Backend Setup
```bash
cd server
npm install

# Create server/.env file and fill in API keys
cp .env.example .env

# Start backend server in development mode (auto-reload via node --watch)
npm run dev
```
The server will run on `http://localhost:5000`.

### 2. Frontend Setup
In a new terminal window:
```bash
cd client
npm install

# Start Vite development server
npm run dev
```
The client will run on `http://localhost:5173`. Open your browser and navigate to `http://localhost:5173`.

---

## Graceful Degradation & Fallback Behavior

Project Eklavya is built with multi-tiered fallback architecture to ensure uninterrupted user experience even when third-party services fail or API credits are exhausted:

1. **Translation Fallback:**  
   `Sarvam AI Translate API` $\rightarrow$ `Groq AI Hindi Translation Prompt` $\rightarrow$ `Original English text with disclaimer`
2. **Text-to-Speech (TTS) Fallback:**  
   `Sarvam Bulbul v3 API` $\rightarrow$ `Browser Native window.speechSynthesis` $\rightarrow$ `Graceful UI notification`
3. **Speech-to-Text (STT) Fallback:**  
   `Browser Web Speech API (Real-time Live Dictation)` $\rightarrow$ `Server MediaRecorder + Sarvam saaras v3 STT` $\rightarrow$ `Inline typing prompt`
4. **Quiz & Roadmap Generation Fallback:**  
   `Groq AI llama-3.3-70b-versatile` $\rightarrow$ `llama-3.1-8b-instant` $\rightarrow$ `OpenAI gpt-4o-mini` $\rightarrow$ **`Syllabus-blueprint roadmap`** (roadmap only).  
   A 60-second **rate-limit circuit breaker** in `groqClient.js` skips a model already known to be returning `429` instead of re-paying for the error on every call. **Every Groq call in the codebase now routes through this shared client** — eight call sites (roadmap generation, daily lesson prose, module quiz, remediation days, diagnostic explanations, practice quizzes, the Hindi translation fallback and chatbot localisation) previously called `fetch` directly and so had no fallback chain at all. The Hindi one mattered most: it is the fallback *for* Sarvam, and without its own fallback a single `429` meant English passed straight through.  
   The roadmap's last resort is built **from the syllabus blueprint**: real NCERT chapter names in syllabus order, with weak chapters given an extra practice day. It replaced a hardcoded twelve-day template ("Foundational Review", "Key Definitions & Terms", "Advanced Topic Exploration") that named no actual syllabus content, so an outage silently produced a plan in which *every* real chapter was missing. The generic template remains only for courses with no blueprint at all.  
   **The diagnostic deliberately has no content fallback.** Its handwritten question banks and template filler were removed in the adaptive-diagnostic work: they produced off-level questions, and the roadmap is generated from the diagnostic result, so a wrong-level diagnostic silently yields a wrong roadmap. If generation fails after retries, `/api/diagnostic/generate` returns `503` with a retry message rather than asking a fabricated question.
5. **Database Fallback:**  
   If MongoDB is unreachable at server startup, the server logs a warning and enters offline demo mode without crashing.
6. **Optional feature gating:**  
   The **admin console** is disabled (its routes return `404`) unless `ADMIN_EMAIL` is configured; if it *is* set, the server fails fast at boot when the password/code are missing. **Profile-photo upload** returns `503` when Cloudinary isn't configured, and the UI falls back to a generic avatar icon whenever a user has no photo.
