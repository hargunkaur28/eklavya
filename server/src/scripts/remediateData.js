import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function remediateData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for data remediation.');

    const DiagnosticResult = mongoose.model('DiagnosticResult', new mongoose.Schema({}, { strict: false }));
    const Roadmap = mongoose.model('Roadmap', new mongoose.Schema({}, { strict: false }));

    // 1. Flag Corrupted DiagnosticResults (where every question has correctIndex === 0)
    const allResults = await DiagnosticResult.find({});
    let corruptedCount = 0;
    let clearedDiagTransCount = 0;

    for (const resDoc of allResults) {
      let isCorrupted = false;
      if (Array.isArray(resDoc.questions) && resDoc.questions.length > 0) {
        const allZero = resDoc.questions.every(q => q.correctIndex === 0);
        if (allZero) {
          isCorrupted = true;
        }
      }

      let needsSave = false;
      if (isCorrupted && !resDoc.corrupted) {
        resDoc.corrupted = true;
        corruptedCount++;
        needsSave = true;
      }

      // Check for stale English translations stored in Hindi fields
      if (resDoc.translatedHindiRecommendation && resDoc.translatedHindiRecommendation === resDoc.recommendation) {
        resDoc.translatedHindiRecommendation = '';
        clearedDiagTransCount++;
        needsSave = true;
      }

      if (needsSave) {
        await resDoc.save();
      }
    }

    console.log(`DiagnosticResult Remediation Complete: Flagged ${corruptedCount} corrupted result documents, cleared ${clearedDiagTransCount} stale translations.`);

    // 2. Clear Stale Stored Translations in Roadmap Documents
    const allRoadmaps = await Roadmap.find({});
    let clearedRoadmapDays = 0;

    for (const rm of allRoadmaps) {
      let rmSaved = false;
      if (Array.isArray(rm.days)) {
        for (const day of rm.days) {
          let dayChanged = false;
          if (day.translatedHindiContent && day.translatedHindiContent === day.content) {
            day.translatedHindiContent = '';
            day.hindiContentTranslated = false;
            dayChanged = true;
          }
          if (day.translatedHindiTopic && day.translatedHindiTopic === day.topic) {
            day.translatedHindiTopic = '';
            day.hindiTopicTranslated = false;
            dayChanged = true;
          }
          if (day.translatedHindiFocus && day.translatedHindiFocus === day.focus) {
            day.translatedHindiFocus = '';
            day.hindiFocusTranslated = false;
            dayChanged = true;
          }

          if (dayChanged) {
            clearedRoadmapDays++;
            rmSaved = true;
          }
        }
      }
      if (rmSaved) {
        await rm.save();
      }
    }

    console.log(`Roadmap Remediation Complete: Cleared stale translations across ${clearedRoadmapDays} day modules.`);

    await mongoose.disconnect();
    console.log('MongoDB connection closed successfully.');
  } catch (err) {
    console.error('Remediation error:', err);
    process.exit(1);
  }
}

remediateData();
