import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from './src/models/User.js';
import Roadmap from './src/models/Roadmap.js';

async function deepAudit() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('=== DEEP ROADMAP & USER AUDIT ===\n');

  const allRoadmaps = await Roadmap.find({});
  console.log(`Total Roadmaps in Database: ${allRoadmaps.length}\n`);

  for (const r of allRoadmaps) {
    const owner = await User.findById(r.userId);
    console.log(`Roadmap ID: ${r._id}`);
    console.log(`  Subject:   "${r.subject}"`);
    console.log(`  Grade:     "${r.grade}"`);
    console.log(`  User ID:   "${r.userId}"`);
    console.log(`  Owner:     ${owner ? `"${owner.email}" (${owner.name})` : '⚠️ UNKNOWN / DELETED USER'}`);
    console.log(`  CreatedAt: ${r.createdAt || 'N/A'}`);
    console.log('--------------------------------------------------');
  }

  console.log('\n=== ALL USERS IN DATABASE ===');
  const allUsers = await User.find({});
  console.log(`Total Users in Database: ${allUsers.length}`);
  allUsers.forEach((u) => {
    console.log(`  User ID: ${u._id} | Email: "${u.email}" | Name: "${u.name}" | Role: "${u.role}"`);
  });

  await mongoose.disconnect();
}

deepAudit().catch(console.error);
