// Does POST /api/roadmap/generate actually CONSUME chapterCoverage?
// Failure mode under test: a chapter the diagnostic never reached is in neither
// the weak nor the strong list, so the roadmap omits it entirely — the chapter
// vanishes from the study plan because the quiz ran out of budget, not because
// the student knows it.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { normalizeTopic } from './src/utils/weakTopics.js';
dotenv.config();

const API = 'http://localhost:5000/api';
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const su = await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'cov', email: `cov.${Date.now()}@t.test`, password: 'TestPass1!' }) });
const token = su.body.token;
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).userId);

await mongoose.connect(process.env.MONGODB_URI);

// A realistic adaptive outcome: budget spent on a few chapters, three never reached.
const UNTOUCHED = ['Surface Areas and Volumes', 'Statistics', 'Coordinate Geometry'];
const WEAK = ['Quadratic Equations'];
const STRONG = ['Real Numbers', 'Probability'];

const ins = await mongoose.connection.collection('diagnosticresults').insertOne({
  userId, grade: 'Class 10', subject: 'Maths', subSubject: '',
  questions: [
    { questionText: 'q1', options: ['a', 'b', 'c', 'd'], selectedIndex: 0, correctIndex: 1, isCorrect: false, topic: 'Quadratic Equations', explanation: '' },
    { questionText: 'q2', options: ['a', 'b', 'c', 'd'], selectedIndex: 1, correctIndex: 1, isCorrect: true, topic: 'Real Numbers', explanation: '' },
    { questionText: 'q3', options: ['a', 'b', 'c', 'd'], selectedIndex: 1, correctIndex: 1, isCorrect: true, topic: 'Probability', explanation: '' }
  ],
  weakTopics: WEAK, strongTopics: STRONG,
  recommendation: 'Focus on Quadratic Equations.', score: 2, totalQuestions: 3,
  chapterCoverage: { total: 9, touched: 6, resolved: 6, unresolvedChapters: [], untouchedChapters: UNTOUCHED },
  createdAt: new Date()
});
const id = ins.insertedId.toString();

const rm = await j('/roadmap/generate', { method: 'POST', body: JSON.stringify({ diagnosticResultId: id }) }, token);
console.log('roadmap status:', rm.status);
const days = rm.body?.roadmap?.days || [];
console.log('days generated:', days.length);
console.log('');
days.forEach(d => console.log(`  ${String(d.dayNumber).padStart(2)}. ${d.topic}`));
console.log('');

const covered = (topic) => {
  const needle = normalizeTopic(topic);
  return days.some(d => normalizeTopic(`${d.topic || ''} ${d.focus || ''}`).includes(needle));
};

let fails = 0;
console.log('--- UNASSESSED CHAPTERS MUST APPEAR (standard pacing) ---');
for (const t of UNTOUCHED) {
  const ok = covered(t);
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '*** FAIL ***'}  ${t}`);
}
console.log('--- WEAK CHAPTER MUST APPEAR (extra depth) ---');
for (const t of WEAK) {
  const ok = covered(t);
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : '*** FAIL ***'}  ${t}`);
}

// Standard pacing, not remediation pacing: an unassessed chapter should not be
// given more days than the chapter the student actually got wrong.
const dayCount = (topic) => {
  const needle = normalizeTopic(topic);
  return days.filter(d => normalizeTopic(`${d.topic || ''} ${d.focus || ''}`).includes(needle)).length;
};
const weakDays = Math.max(...WEAK.map(dayCount));
const unassessedDays = UNTOUCHED.map(dayCount);
console.log('--- PACING ---');
console.log(`  weak chapter days: ${weakDays}   unassessed chapter days: ${unassessedDays.join(', ')}`);
const pacingOk = unassessedDays.every(n => n >= 1 && n <= weakDays);
if (!pacingOk) fails++;
console.log(`  ${pacingOk ? 'PASS' : '*** FAIL ***'}  unassessed covered at >=1 day but not more than the weak chapter`);

await mongoose.connection.collection('diagnosticresults').deleteOne({ _id: ins.insertedId });
await mongoose.connection.collection('roadmaps').deleteMany({ userId });
await mongoose.disconnect();
console.log(`\n${fails ? fails + ' FAILURES' : 'ALL COVERAGE HAND-OFF CHECKS PASS'}`);
process.exit(fails ? 1 : 0);
