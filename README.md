# Project Eklavya (एकलव्य) — AI-Powered Learning for Bharat

> **For contributors — keeping this README current:**  
> This README should be updated whenever a feature is added, removed, or meaningfully changed. When implementing a new feature or fixing a significant bug, update the relevant section of this file in the same change — don't let it drift out of date. If you're an AI coding agent working on this repo, treat README.md updates as part of the definition of done for any user-facing feature work, the same way you'd update a model schema or route file.

---

## Project Overview

**Project Eklavya** (*Ek Shikshak, Har Vidhyarthi*) is a personalized, AI-driven learning platform built specifically for Indian students preparing for Class 10 Science, Class 11 JEE Foundation, and Class 12 NEET Biology. The platform assesses a student's current knowledge through an interactive diagnostic quiz, identifies strong and weak concept areas, and automatically constructs a day-by-day study roadmap. Each study day combines curated educational YouTube videos from trusted Indian channels (Physics Wallah, Vedantu, Unacademy, Khan Academy India, Aakash) with AI-generated lesson content and a per-day module quiz — a day is completed only once its video is watched and its quiz passed. Beyond the core roadmap, the dashboard tracks video and quiz progress, flags weak sub-topics from quiz results, adaptively inserts remediation days when a student stays stuck, supports multiple subjects per student (with English, Science, and Social Science further splittable into selectable sub-subjects such as Grammar, Physics, or History, plus a combined/fusion option), offers a standalone practice mode, and keeps students consistent with account-wide study streaks and a "continue where you left off" prompt. The platform features bilingual support (English and Hindi) across UI, quizzes, lessons, and weak-topic labels, voice input and text-to-speech read-aloud, and a floating site-wide AI assistant widget. Quizzes can optionally include **AI-graded written (essay / short-answer) questions** alongside multiple-choice, a persistent **AI tutor chat (Mentor)**, and a **PDF study-notes generator**. It also has a role-based account system — students, an optional **read-only parent login** per student, and an environment-configured **admin console** — plus student profile editing with server-side Cloudinary photo uploads.

---

## Core Features

### 1. Diagnostic Quiz & Personalized Roadmap Generation
- **What it does:** Evaluates foundational concept mastery across target courses (Class 10 Science, Class 11 JEE Physics & Maths, Class 12 NEET Biology). Based on the accuracy of answers per topic, the backend generates a 10-15 day structured study roadmap that allocates extra learning days to identified weak topics.
- **Components/Pages:**
  - `client/src/components/Onboarding.jsx` (Quiz interface & subject selection)
  - `client/src/pages/DiagnosticReview.jsx` (Detailed quiz score review and topic breakdown)
- **Backend Routes & Utilities:**
  - `POST /api/diagnostic/generate` (Quiz generation via Groq AI or handwritten banks)
  - `POST /api/diagnostic/submit` (Score calculation, weak topic analysis, and Groq explanation generation)
  - `POST /api/roadmap/generate` (Roadmap day schedule creation via Groq AI `llama-3.3-70b-versatile`)
  - Models: `DiagnosticSession.js`, `DiagnosticResult.js`, `Roadmap.js`

### 2. Day-by-Day Study Plan & Verified YouTube Resources
- **What it does:** Students follow a daily study schedule. Clicking into any day presents a 2-3 paragraph detailed lesson module generated on first view, alongside real embeddable YouTube video recommendations fetched via YouTube Data API v3 (strictly filtered to exclude low-quality content and brand competitors like BYJU'S). Each day brings together watchable videos (with per-video completion tracking — Feature 8), the lesson module, and a module quiz (Feature 9): a day is only marked **complete** once the student has both watched a video *and* passed that day's quiz, a gate enforced by the backend.
- **Components/Pages:**
  - `client/src/pages/DayDetail.jsx` (Daily study module view, video players, and module quiz)
  - `client/src/components/RoadmapDashboard.jsx` (Roadmap day overview with per-day completion + quiz score indicators)
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/:id/day/:dayNumber` (Dynamic lesson generation via Groq + YouTube resource fetch)
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
  - `server/src/routes/admin.js`, `server/src/utils/adminCreds.js`, `server/src/models/AdminConfig.js`

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
│   │   ├── components/         # Reusable React components (Header, ChatWidget, SpeakerButton, RoadmapDashboard, DashboardSidebar, YouTubePlayer, ModuleQuiz, ProgressWeakTopics, PracticeMode, StreakWidget, ParentAccessCard, ParentDashboard, AdminDashboard, AdminSettings, DashboardShell, Avatar, NotesGenerator, WrittenQuestion, etc.)
│   │   ├── context/            # React Context providers (AuthContext.jsx, LanguageContext.jsx)
│   │   ├── data/               # Course catalog (courses.js) and translation dictionary (translations.js)
│   │   ├── pages/              # Top-level page views (DiagnosticReview.jsx, DayDetail.jsx, AuthPage.jsx, ChangePasswordPage.jsx, ProfilePage.jsx, AdminLoginPage.jsx, MentorPage.jsx)
│   │   ├── utils/              # Client utility helpers (subject & topic translation mappers, streak.js)
│   │   ├── App.jsx             # Main Router configuration & global ChatWidget mount
│   │   ├── main.jsx            # React root entry point
│   │   └── styles.css          # Global design tokens and component styling
│   └── package.json            # Client dependencies and Vite scripts
│
├── server/                     # Backend Node.js + Express API server
│   ├── uploads/                # Disk cache for generated audio WAV files (uploads/audio/ & uploads/audio/temp/)
│   ├── src/
│   │   ├── config/             # Single source of truth for the subject/grade/sub-subject taxonomy (taxonomy.js)
│   │   ├── data/               # Static route catalog (siteRoutes.js) & grounding knowledge (siteKnowledge.js)
│   │   ├── middleware/         # Auth middleware (auth.js — authMiddleware, requireRole, parentPasswordChangeGate)
│   │   ├── models/             # Mongoose schemas (User, DiagnosticSession, DiagnosticResult, Roadmap, PracticeSession, AdminConfig, Conversation) + writtenFields.js (shared written-question schema fields)
│   │   ├── routes/             # Express API routes (auth.js, admin.js, mentor.js, notes.js, diagnostic.js, roadmap.js, practice.js, activity.js, chat.js)
│   │   ├── scripts/            # Database remediation and utility maintenance scripts
│   │   ├── utils/              # Backend integrations & helpers (sarvamClient.js, localizeReply.js, fetchYoutubeResources.js, textToSpeech.js, translateAndCache.js, recordActivity.js, validatePassword.js, rateLimiter.js, generateTempPassword.js, weakTopics.js, cloudinary.js, imageSniff.js, adminCreds.js, groqClient.js, notesPdf.js, generateWritten.js, gradeWritten.js)
│   │   └── server.js           # Server entry point, MongoDB connection, & graceful shutdown
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
| `POST` | `/api/diagnostic/generate` | Yes | Generate 6-question diagnostic assessment quiz |
| `POST` | `/api/diagnostic/submit` | Yes | Submit diagnostic answers, calculate score, & generate explanations |
| `POST` | `/api/diagnostic/:id/translate` | Yes | Translate diagnostic assessment result into Hindi via Sarvam AI |
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

# Frontend URL (for Production CORS setup)
FRONTEND_URL=http://localhost:5173
```

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
   `Groq AI llama-3.3-70b-versatile` $\rightarrow$ `Handwritten Question Banks / Structured Fallback Schedule`
5. **Database Fallback:**  
   If MongoDB is unreachable at server startup, the server logs a warning and enters offline demo mode without crashing.
6. **Optional feature gating:**  
   The **admin console** is disabled (its routes return `404`) unless `ADMIN_EMAIL` is configured; if it *is* set, the server fails fast at boot when the password/code are missing. **Profile-photo upload** returns `503` when Cloudinary isn't configured, and the UI falls back to a generic avatar icon whenever a user has no photo.
