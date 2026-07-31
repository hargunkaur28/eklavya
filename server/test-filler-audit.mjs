// Forces generation down and asserts that NO path ships filler that names no
// real syllabus content — and that nothing fake gets cached.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const API = `http://localhost:${process.env.TEST_PORT || 5097}/api`;
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

// Filler = generic study-skills language that names no actual syllabus content.
const FILLER = /welcome to day|foundational review|key definitions & terms|advanced topic exploration|study the foundational concepts|complete the practice exercises|final mastery & summary|error analysis & doubt room/i;

const su = await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'filler', email: `filler.${Date.now()}@t.test`, password: 'TestPass1!' }) });
const token = su.body.token;
await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).userId);

// 1. Diagnostic — must refuse, never fabricate.
const diag = await j('/diagnostic/generate', { method: 'POST', body: JSON.stringify({ grade: 'Class 10', subject: 'Maths' }) }, token);
check('diagnostic refuses rather than fabricating', diag.status === 503 && !diag.body.questions, `status ${diag.status}`);

// 2. Roadmap — must be built from the real syllabus, not a template.
const dr = await mongoose.connection.collection('diagnosticresults').insertOne({
  userId, grade: 'Class 10', subject: 'Maths', subSubject: '',
  questions: [{ questionText: 'q', options: ['a', 'b', 'c', 'd'], selectedIndex: 0, correctIndex: 1, isCorrect: false, topic: 'Quadratic Equations', explanation: '' }],
  weakTopics: ['Quadratic Equations'], strongTopics: [],
  recommendation: '', score: 0, totalQuestions: 1,
  chapterCoverage: { total: 9, touched: 1, resolved: 1, unresolvedChapters: [], untouchedChapters: ['Statistics'] },
  createdAt: new Date()
});
const rm = await j('/roadmap/generate', { method: 'POST', body: JSON.stringify({ diagnosticResultId: dr.insertedId.toString() }) }, token);
const days = rm.body?.roadmap?.days || [];
const titles = days.map(d => d.topic).join(' | ');
check('roadmap contains no template filler', days.length > 0 && !FILLER.test(titles), titles.slice(0, 90) + '…');
check('roadmap names real syllabus chapters', /quadratic|trigonometry|polynomial|circles|statistics/i.test(titles));
check('unassessed chapter still present with generation down', /statistics/i.test(titles));

// 3. Daily lesson — must NOT cache filler, and must flag itself unavailable.
const roadmapId = rm.body?.roadmap?._id;
const day = await j(`/roadmap/${roadmapId}/day/1`, {}, token);
check('day lesson reports contentAvailable:false', day.body.contentAvailable === false, `content=${JSON.stringify((day.body.content || '').slice(0, 60))}`);
check('day lesson ships no filler prose', !FILLER.test(day.body.content || ''));

const stored = await mongoose.connection.collection('roadmaps').findOne({ _id: new mongoose.Types.ObjectId(roadmapId) });
const d1 = stored.days.find(d => d.dayNumber === 1);
check('nothing fake was CACHED (contentGenerated stays false)', d1.contentGenerated !== true, `contentGenerated=${d1.contentGenerated}`);
check('cached content field is empty, not placeholder', !d1.content || !FILLER.test(d1.content), JSON.stringify((d1.content || '').slice(0, 50)));

// 4. Module quiz — must signal unavailable, cache nothing.
const quiz = await j(`/roadmap/${roadmapId}/day/1/quiz`, {}, token);
check('module quiz signals unavailable', quiz.body.available === false, `reason=${quiz.body.reason}`);
const stored2 = await mongoose.connection.collection('roadmaps').findOne({ _id: new mongoose.Types.ObjectId(roadmapId) });
check('module quiz cached nothing', !(stored2.days.find(d => d.dayNumber === 1)?.moduleQuiz?.generated));

// 5. Practice / notes / mentor — must return real errors.
check('practice signals unavailable', (await j('/practice/generate', { method: 'POST', body: JSON.stringify({ grade: 'Class 10', subject: 'Maths', topic: 'Circles' }) }, token)).body.available === false);
check('notes returns a real error', (await j('/notes/generate', { method: 'POST', body: JSON.stringify({ subject: 'Maths', topic: 'Circles' }) }, token)).status === 502);
const convo = await j('/mentor/conversations', { method: 'POST', body: JSON.stringify({}) }, token);
const convoId = convo.body.id || convo.body.conversation?._id || convo.body._id;
const mentorReply = await j(`/mentor/conversations/${convoId}/message`, { method: 'POST', body: JSON.stringify({ message: 'explain circles' }) }, token);
check('mentor returns a real error', mentorReply.status === 502, `status ${mentorReply.status}`);
// A failed reply must not leave a half-saved thread the student sees as a dead turn.
const convoDoc = await mongoose.connection.collection('conversations').findOne({ _id: new mongoose.Types.ObjectId(convoId) });
check('mentor persisted no half-saved turn', (convoDoc?.messages || []).length === 0, `${(convoDoc?.messages || []).length} messages stored`);

await mongoose.connection.collection('diagnosticresults').deleteOne({ _id: dr.insertedId });
await mongoose.connection.collection('roadmaps').deleteMany({ userId });
await mongoose.disconnect();

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
