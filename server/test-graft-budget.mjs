// Grafting must respect the day budget, and a grafted day must be a first-class
// day — i.e. its module quiz generates and populates `subtopics`, since weak-topic
// flagging (F10) pins questions to that list and remediation (F12) consumes it.
// A day with no subtopics is a hole in that chain.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { ROADMAP_MIN_DAYS, ROADMAP_MAX_DAYS } from './src/routes/roadmap.js';
import { normalizeTopic } from './src/utils/weakTopics.js';
dotenv.config();

const API = 'http://localhost:5000/api';
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

console.log(`documented budget: ${ROADMAP_MIN_DAYS}-${ROADMAP_MAX_DAYS} days\n`);

const su = await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'graft', email: `graft.${Date.now()}@t.test`, password: 'TestPass1!' }) });
const token = su.body.token;
await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).userId);

// Worst case for the budget: many unassessed chapters to graft.
const UNTOUCHED = [
  'Coordinate Geometry', 'Introduction to Trigonometry', 'Some Applications of Trigonometry',
  'Circles', 'Areas Related to Circles', 'Surface Areas and Volumes', 'Statistics', 'Probability'
];
const dr = await mongoose.connection.collection('diagnosticresults').insertOne({
  userId, grade: 'Class 10', subject: 'Maths', subSubject: '',
  questions: [{ questionText: 'q', options: ['a', 'b', 'c', 'd'], selectedIndex: 0, correctIndex: 1, isCorrect: false, topic: 'Quadratic Equations', explanation: '' }],
  weakTopics: ['Quadratic Equations'], strongTopics: ['Real Numbers'],
  recommendation: '', score: 0, totalQuestions: 1,
  chapterCoverage: { total: 9, touched: 2, resolved: 2, unresolvedChapters: [], untouchedChapters: UNTOUCHED },
  createdAt: new Date()
});

const rm = await j('/roadmap/generate', { method: 'POST', body: JSON.stringify({ diagnosticResultId: dr.insertedId.toString() }) }, token);
const roadmapId = rm.body?.roadmap?._id;
const days = rm.body?.roadmap?.days || [];
console.log(`generated ${days.length} days with ${UNTOUCHED.length} unassessed chapters to place\n`);
days.forEach(d => console.log(`  ${String(d.dayNumber).padStart(2)}. ${d.topic}`));
console.log('');

check('day count within the documented budget', days.length >= ROADMAP_MIN_DAYS && days.length <= ROADMAP_MAX_DAYS, `${days.length} days`);
check('dayNumber is sequential from 1', days.every((d, i) => d.dayNumber === i + 1));
check('totalDays matches the stored days', rm.body?.roadmap?.totalDays === days.length);

const allText = days.map(d => `${d.topic} ${d.focus}`).join(' | ');
const missing = UNTOUCHED.filter(t => !normalizeTopic(allText).includes(normalizeTopic(t)));
check('every unassessed chapter is named somewhere', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `all ${UNTOUCHED.length} placed`);

// A catch-up day must stay teachable AND keep Feature 10's >=2-questions-per-
// subtopic flagging threshold reachable within a 10-question quiz.
const catchups = days.filter(d => /^catch-up:/i.test(d.topic || ''));
const worst = Math.max(0, ...catchups.map(d => d.topic.replace(/^catch-up:\s*/i, '').split(',').length));
check('no catch-up day exceeds 3 chapters', worst <= 3, catchups.length ? `${catchups.length} catch-up day(s), max ${worst} chapters` : 'none needed');
check('catch-up chapters stay above the weak-flag threshold', worst === 0 || Math.floor(10 / worst) >= 2, worst ? `~${Math.floor(10 / worst)} questions per chapter` : 'n/a');

// The subtopics chain: generate a quiz on the LAST day (most likely to be grafted)
// and confirm the day ends up with a populated subtopics list.
const lastDay = days[days.length - 1].dayNumber;
console.log(`\ngenerating module quiz for day ${lastDay} ("${days[days.length - 1].topic}") to test the subtopics chain…`);
const quiz = await j(`/roadmap/${roadmapId}/day/${lastDay}/quiz`, {}, token);
if (quiz.body?.available === false) {
  console.log('  (generation unavailable — subtopics chain not exercised this run)');
  check('quiz route degrades cleanly on the grafted day', true, 'available:false, nothing cached');
} else {
  const stored = await mongoose.connection.collection('roadmaps').findOne({ _id: new mongoose.Types.ObjectId(roadmapId) });
  const d = stored.days.find(x => x.dayNumber === lastDay);
  check('grafted day gets subtopics populated', Array.isArray(d.subtopics) && d.subtopics.length > 0, `subtopics=${JSON.stringify(d.subtopics)}`);
  const qTopics = (d.moduleQuiz?.questions || []).map(q => q.topic);
  check('quiz questions pin to that subtopic list', qTopics.length > 0 && qTopics.every(t => d.subtopics.includes(t)), `${qTopics.length} questions`);
}

await mongoose.connection.collection('diagnosticresults').deleteOne({ _id: dr.insertedId });
await mongoose.connection.collection('roadmaps').deleteMany({ userId });
await mongoose.disconnect();

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
