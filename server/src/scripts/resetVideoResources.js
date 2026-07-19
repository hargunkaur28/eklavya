import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Roadmap from '../models/Roadmap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function resetVideoResources() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected successfully to MongoDB.');

    const roadmaps = await Roadmap.find({});
    console.log(`Found ${roadmaps.length} roadmap document(s) to process.`);

    let updatedCount = 0;
    let totalDaysReset = 0;

    for (const roadmap of roadmaps) {
      if (roadmap.days && Array.isArray(roadmap.days)) {
        for (const day of roadmap.days) {
          day.contentGenerated = false;
          day.resources = [];
          // Note: `day.content` (Groq prose) is left COMPLETELY untouched.
          totalDaysReset += 1;
        }
        await roadmap.save();
        updatedCount += 1;
      }
    }

    console.log(`Reset complete: ${updatedCount} roadmap(s) updated, ${totalDaysReset} day(s) reset for YouTube API regeneration.`);
  } catch (error) {
    console.error('Error executing resetVideoResources:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  }
}

resetVideoResources();
