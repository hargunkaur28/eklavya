# Project Eklavya (एकलव्य) — AI-Powered Learning for Bharat

> **For contributors — keeping this README current:**  
> This README should be updated whenever a feature is added, removed, or meaningfully changed. When implementing a new feature or fixing a significant bug, update the relevant section of this file in the same change — don't let it drift out of date. If you're an AI coding agent working on this repo, treat README.md updates as part of the definition of done for any user-facing feature work, the same way you'd update a model schema or route file.

---

## Project Overview

**Project Eklavya** (*Ek Shikshak, Har Vidhyarthi*) is a personalized, AI-driven learning platform built specifically for Indian students preparing for Class 10 Science, Class 11 JEE Foundation, and Class 12 NEET Biology. The platform assesses a student's current knowledge through an interactive diagnostic quiz, identifies strong and weak concept areas, and automatically constructs a day-by-day study roadmap. Each study day includes AI-generated lesson content and curated educational YouTube video recommendations from trusted Indian channels (Physics Wallah, Vedantu, Unacademy, Khan Academy India, Aakash). The platform features bilingual support (English and Hindi), voice input and text-to-speech read-aloud, progress tracking, and a floating site-wide AI assistant widget.

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
- **What it does:** Students follow a daily study schedule. Clicking into any day presents a 2-3 paragraph detailed lesson module generated on first view, alongside real embeddable YouTube video recommendations fetched via YouTube Data API v3 (strictly filtered to exclude low-quality content and brand competitors like BYJU'S).
- **Components/Pages:**
  - `client/src/pages/DayDetail.jsx` (Daily study module view)
  - `client/src/components/RoadmapDashboard.jsx` (Roadmap day overview tab)
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/:id/day/:dayNumber` (Dynamic lesson generation via Groq + YouTube resource fetch)
  - `PATCH /api/roadmap/:id/day/:dayNumber` (Toggle day completion status)
  - `server/src/utils/fetchYoutubeResources.js` (YouTube Data API integration)

### 3. Bilingual Support (English & Hindi)
- **What it does:** The site operates seamlessly in both English and Hindi. Toggling the global language switch in the header updates UI translations and triggers server-side translation of quizzes, diagnostic reviews, and study roadmap content into Devanagari Hindi using Sarvam AI Translate (`en-IN` to `hi-IN`), with a Groq AI translation fallback.
- **Components/Pages:**
  - `client/src/context/LanguageContext.jsx` (Global language provider & `localStorage` persistence)
  - `client/src/data/translations.js` (Bilingual string dictionary)
- **Backend Routes & Utilities:**
  - `POST /api/diagnostic/:id/translate` (Translates quiz review into Hindi)
  - `POST /api/roadmap/:id/translate` (Translates study roadmap days into Hindi)
  - `server/src/utils/translateAndCache.js` & `server/src/utils/localizeReply.js`

### 4. Text-to-Speech (Sarvam Bulbul v3 & Web Speech Fallback)
- **What it does:** Allows students to listen to quiz questions, diagnostic review explanations, roadmap lesson content, and AI chatbot replies read aloud in either English (`en-IN`) or Hindi (`hi-IN`).
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

### 7. Progress Tracking & Command Center
- **What it does:** Displays an interactive dashboard with total days completed, progress percentages, active roadmap schedule, topic breakdown, and diagnostic score review.
- **Components/Pages:**
  - `client/src/components/RoadmapDashboard.jsx` (`/dashboard` route)
- **Backend Routes & Utilities:**
  - `GET /api/roadmap/mine`

### 8. User Authentication & Session Management
- **What it does:** Secure user signup and login using password hashing (bcryptjs) and JSON Web Tokens (JWT). Includes a **Remember Me** option that extends session lifetime to 90 days (stored in persistent `localStorage`), while standard sessions default to 30 days.
- **Components/Pages:**
  - `client/src/components/AuthModal.jsx` (Login / Signup modal dialog)
  - `client/src/components/ProtectedRoute.jsx` (Route guard)
  - `client/src/context/AuthContext.jsx` (Session token management)
- **Backend Routes & Utilities:**
  - `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
  - `server/src/routes/auth.js` & `server/src/middleware/auth.js`

---

## Tech Stack

### Frontend
- **Framework:** React 19.0.0 (with `vite` 7.0.0 bundler)
- **Routing:** `react-router-dom` 7.18.1
- **Icons:** `lucide-react` 0.468.0
- **Animations:** `framer-motion` 12.42.2, `motion` 12.42.2, `gsap` 3.15.0, `ogl` 1.0.11 (3D WebGL visuals)
- **Styling:** Vanilla CSS3 with root design tokens, Devanagari font overrides (`Noto Sans Devanagari`), and custom animations

### Backend
- **Runtime:** Node.js (ES Modules `type: "module"`)
- **Web Framework:** Express 4.21.2
- **Database:** MongoDB with Mongoose 8.12.0 ODM
- **Authentication:** `jsonwebtoken` 9.0.2 & `bcryptjs` 3.0.2
- **File Uploads:** `multer` 2.2.0 (memory storage for STT audio processing)
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
│   │   ├── components/         # Reusable React components (Header, Hero, ChatWidget, SpeakerButton, etc.)
│   │   ├── context/            # React Context providers (AuthContext.jsx, LanguageContext.jsx)
│   │   ├── data/               # Course catalog (courses.js) and translation dictionary (translations.js)
│   │   ├── pages/              # Top-level page views (DiagnosticReview.jsx, DayDetail.jsx)
│   │   ├── utils/              # Client utility helpers (subject & topic translation mappers)
│   │   ├── App.jsx             # Main Router configuration & global ChatWidget mount
│   │   ├── main.jsx            # React root entry point
│   │   └── styles.css          # Global design tokens and component styling
│   └── package.json            # Client dependencies and Vite scripts
│
├── server/                     # Backend Node.js + Express API server
│   ├── uploads/                # Disk cache for generated audio WAV files (uploads/audio/ & uploads/audio/temp/)
│   ├── src/
│   │   ├── data/               # Static route catalog (siteRoutes.js) & grounding knowledge (siteKnowledge.js)
│   │   ├── middleware/         # Auth verification middleware (auth.js)
│   │   ├── models/             # Mongoose schemas (User, DiagnosticSession, DiagnosticResult, Roadmap)
│   │   ├── routes/             # Express API routes (auth.js, diagnostic.js, roadmap.js, chat.js)
│   │   ├── scripts/            # Database remediation and utility maintenance scripts
│   │   ├── utils/              # Backend integrations (sarvamClient.js, localizeReply.js, fetchYoutubeResources.js, textToSpeech.js, translateAndCache.js)
│   │   └── server.js           # Server entry point, MongoDB connection, & graceful shutdown
│   └── package.json            # Server dependencies and scripts
│
└── README.md                   # Comprehensive repository documentation
```

---

## API Endpoints

| Method | Path | Auth Required | Purpose |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/auth/signup` | No | Register new user (accepts `name`, `email`, `password`, `rememberMe`) |
| `POST` | `/api/auth/login` | No | Authenticate user (accepts `email`, `password`, `rememberMe`) |
| `GET` | `/api/auth/me` | Yes | Get currently authenticated user profile |
| `POST` | `/api/diagnostic/generate` | Yes | Generate 6-question diagnostic assessment quiz |
| `POST` | `/api/diagnostic/submit` | Yes | Submit diagnostic answers, calculate score, & generate explanations |
| `POST` | `/api/diagnostic/:id/translate` | Yes | Translate diagnostic assessment result into Hindi via Sarvam AI |
| `GET` | `/api/diagnostic/:id` | Yes | Fetch diagnostic result details by ID |
| `GET` | `/api/diagnostic/:id/question/:questionIndex/audio` | Yes | Synthesize/fetch cached audio WAV for diagnostic question stem & options |
| `POST` | `/api/diagnostic/live-audio` | Yes (Rate limited) | On-demand audio synthesis for live quiz questions |
| `POST` | `/api/roadmap/generate` | Yes | Generate personalized 10-15 day study roadmap based on diagnostic weak areas |
| `GET` | `/api/roadmap/mine` | Yes | Fetch current user's active study roadmap |
| `GET` | `/api/roadmap/:id` | Yes | Fetch roadmap by ID |
| `GET` | `/api/roadmap/:id/day/:dayNumber` | Yes | Fetch daily study module content & YouTube resources |
| `PATCH` | `/api/roadmap/:id/day/:dayNumber` | Yes | Toggle completion status for a study day |
| `POST` | `/api/roadmap/:id/translate` | Yes | Translate study roadmap topics & focus items into Hindi |
| `GET` | `/api/roadmap/:id/day/:dayNumber/audio` | Yes | Synthesize/fetch cached audio WAV for roadmap day content |
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

# Security
JWT_SECRET=eklavya_super_secret_jwt_key_2026

# External AI & Data APIs
GROQ_API_KEY=gsk_your_groq_api_key_here
SARVAM_API_KEY=your_sarvam_api_key_here
YOUTUBE_API_KEY=your_youtube_data_api_v3_key_here

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
