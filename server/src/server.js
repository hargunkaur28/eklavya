// Phase 4: load .env BEFORE any other module so route/middleware files that read
// process.env at import time (e.g. JWT_SECRET) see the configured values. This
// side-effect import must stay the first import in the file.
import 'dotenv/config';

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import diagnosticRoutes from './routes/diagnostic.js';
import roadmapRoutes from './routes/roadmap.js';
import practiceRoutes from './routes/practice.js';
import activityRoutes from './routes/activity.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import mentorRoutes from './routes/mentor.js';
import notesRoutes from './routes/notes.js';
import { parentPasswordChangeGate } from './middleware/auth.js';
import { startTempAudioCleanup, stopTempAudioCleanup } from './utils/textToSpeech.js';

// Phase 4: no hardcoded secret fallback anywhere. Refuse to start without a
// configured JWT secret rather than silently signing tokens with a known value.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set it in the environment (.env) before starting.');
  process.exit(1);
}

// Phase 6: the admin panel is enabled by setting ADMIN_EMAIL. If it's set, the
// other two credentials MUST also be present — refuse to boot on a half-configured
// admin. If ADMIN_EMAIL is unset, the admin surface stays disabled (routes 404).
if (process.env.ADMIN_EMAIL) {
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SECURITY_CODE) {
    console.error('FATAL: ADMIN_EMAIL is set but ADMIN_PASSWORD and/or ADMIN_SECURITY_CODE are missing. Set all three (or none) in the environment.');
    process.exit(1);
  }
}

// Narration feature: OpenAI is the HINDI TTS fallback when Sarvam is down/out of
// quota (Groq TTS can't do Hindi). NOT required to boot — but warn loudly, since
// without it Hindi narration silently degrades to lower-quality browser TTS.
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set — Hindi TTS will have NO server-side fallback if Sarvam fails (it will degrade to browser Web Speech). Set OPENAI_API_KEY to enable the OpenAI Hindi fallback.');
}

import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project_eklavya';

// Middlewares
const allowedOrigins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://localhost:3000'
];

if (process.env.FRONTEND_URL) {
  const prodOrigins = process.env.FRONTEND_URL.split(',').map(url => url.trim());
  allowedOrigins.push(...prodOrigins);
}

// Section 4 Security Hardening: Helmet HTTP headers
app.use(helmet({ contentSecurityPolicy: false }));

// Section 5 Load Resilience: Response payload compression
app.use(compression());

// Section 4 Security Hardening: Global rate limiter on all /api/* routes (200 req / 15 min per IP)
const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.SKIP_RATE_LIMIT === 'true' || req.path === '/health'
});
app.use('/api', globalApiLimiter);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Section 4 Security Hardening: Request body size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve uploads directory statically for audio files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
// Phase 4: the parent-must-change-password gate runs ahead of every data router
// (but not /api/auth, so change-password itself stays reachable, nor /api/chat).
app.use('/api/diagnostic', parentPasswordChangeGate, diagnosticRoutes);
app.use('/api/roadmap', parentPasswordChangeGate, roadmapRoutes);
app.use('/api/practice', parentPasswordChangeGate, practiceRoutes);
app.use('/api/activity', parentPasswordChangeGate, activityRoutes);
app.use('/api/chat', chatRoutes);
// Phase 6: admin panel (read-only). No parent gate — admin is never a parent.
app.use('/api/admin', adminRoutes);
// Track 1: Mentor — persistent AI tutor chat (student-only; enforced in the router).
app.use('/api/mentor', mentorRoutes);
// Track 2: PDF Notes generator (student-only; ephemeral — no persistence).
app.use('/api/notes', notesRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Project Eklavya API Server' });
});

// Initialize temp audio cleanup timer
startTempAudioCleanup();

let serverInstance = null;

// Graceful Shutdown Handler
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down Project Eklavya Server gracefully...`);
  stopTempAudioCleanup();

  if (serverInstance) {
    serverInstance.close(() => {
      console.log('HTTP Server closed.');
      mongoose.connection.close(false).then(() => {
        console.log('MongoDB connection closed.');
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const isDirectRun = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].includes('server.js'));

if (isDirectRun) {
  mongoose.connect(MONGODB_URI, { maxPoolSize: 50 })
    .then(() => {
      console.log('Successfully connected to MongoDB.');
      console.log(`Admin panel: ${process.env.ADMIN_EMAIL ? 'ENABLED' : 'disabled'}`);
      serverInstance = app.listen(PORT, () => {
        console.log(`Project Eklavya Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.warn('MongoDB connection warning:', err.message);
      console.log('Starting server in fallback mode (in-memory/demo mode ready)...');
      serverInstance = app.listen(PORT, () => {
        console.log(`Project Eklavya Server running on port ${PORT}`);
      });
    });
}
