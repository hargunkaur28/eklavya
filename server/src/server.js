import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import diagnosticRoutes from './routes/diagnostic.js';
import roadmapRoutes from './routes/roadmap.js';
import { startTempAudioCleanup, stopTempAudioCleanup } from './utils/textToSpeech.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project_eklavya';

// Middlewares
app.use(cors({
  origin: ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Serve uploads directory statically for audio files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/diagnostic', diagnosticRoutes);
app.use('/api/roadmap', roadmapRoutes);

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

// MongoDB Connection & Server Start
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Successfully connected to MongoDB.');
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
