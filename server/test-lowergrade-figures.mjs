// A missing blueprint row must not read as "this course gets no figures".
//
// The blueprint covers the exam grades; the taxonomy covers all 280 course identities.
// Class 6 Maths has NO blueprint entry, so every chapter-derived gate answers false for
// it. Before this fix a Class 6 Maths module quiz silently never attempted a figure
// while a Class 6 Maths PRACTICE quiz did — same student, same subject.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getBlueprint } from './src/config/syllabusBlueprint.js';
import { subjectDiagramEligible } from './src/config/taxonomy.js';
import { needsDiagramRetry } from './src/utils/generateDiagram.js';
dotenv.config();

const API = 'http://localhost:5000/api';
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

// Fixture check first, not an assumption: this test is only meaningful if Class 6
// Maths genuinely has no blueprint entry but IS subject-eligible.
check('fixture: Class 6 Maths has no blueprint entry', !getBlueprint('Class 6', 'Maths', ''));
check('fixture: Class 6 Maths IS subject-eligible for figures', subjectDiagramEligible('Maths', '') === true);

const su = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'LowGrade', email: `low.${Date.now()}@t.test`, password: 'TestPass1!' })
})).json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` };
await fetch(`${API}/auth/profile-details`, { method: 'PATCH', headers: H,
  body: JSON.stringify({ age: 12, studyMedium: 'CBSE', fatherName: 'Ram Kumar', schoolName: 'Govt Sr Sec School', schoolCity: 'Ambala' }) });

await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(su.token.split('.')[1], 'base64').toString()).userId);
const R = mongoose.connection.collection('roadmaps');
const id = (await R.insertOne({
  userId, grade: 'Class 6', subject: 'Maths', subSubject: '', totalDays: 1,
  days: [{ dayNumber: 1, topic: 'Symmetry', focus: 'Lines of symmetry in shapes', estimatedMinutes: 30,
    completed: false, content: 'An introduction to symmetry.', resources: [], contentGenerated: true,
    subtopics: [], moduleQuiz: { generated: false, generatedAt: null, questions: [] } }],
  language: 'en', archived: false, createdAt: new Date()
})).insertedId;

// A figure is not guaranteed on any single run (the model may decline every sampled
// question), so the assertion is that the path was ATTEMPTED — which is the thing the
// bug made impossible. `diagramAttempted` being stamped at all proves the gate opened.
const quiz = await (await fetch(`${API}/roadmap/${id}/day/1/quiz`, { headers: H })).json();
const stored = (await R.findOne({ _id: id })).days[0].moduleQuiz.questions;
const mcq = stored.filter((q) => q.type !== 'written');
const attempted = mcq.filter((q) => q.diagramAttempted === true).length;
const figures = mcq.filter((q) => q.diagram?.svg).length;

console.log(`   Class 6 Maths module quiz: ${mcq.length} MCQs, ${attempted} with a recorded attempt, ${figures} figure(s)`);
check('the figure path was ATTEMPTED for a course with no blueprint entry',
  attempted > 0, `${attempted} of ${mcq.length} questions carry a recorded decision`);
check('the served quiz is intact', quiz.available === true && (quiz.questions || []).length > 0,
  `available=${quiz.available} questions=${(quiz.questions || []).length}`);

// The retry path has the same shape one layer down: an empty chapter map must not make
// the retry unreachable for these grades.
const noChapters = new Map();
const q = { type: 'mcq', chapterId: '', diagramAttempted: undefined };
check('needsDiagramRetry falls through to the subject verdict when no chapter exists',
  needsDiagramRetry(q, noChapters, true) === true && needsDiagramRetry(q, noChapters, false) === false);
check('a known-ineligible chapter still overrides the subject verdict',
  needsDiagramRetry({ type: 'mcq', chapterId: 'c1' },
    new Map([['c1', { id: 'c1', diagramEligible: false }]]), true) === false);

await R.deleteMany({ userId });
await mongoose.disconnect();
const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
