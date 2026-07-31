// Workstream G — prove the register version actually retranslates STALE cached Hindi.
//
// The predicate is unit-tested; this is the integration, which is where a half-wired
// rollout hides. Seeds a cache exactly as it exists in the database TODAY — translated,
// with NO hindiRegisterVersion field — then reads it back through the real route and
// checks the stored document changed.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { TRANSLATION_REGISTER_VERSION } from './src/utils/translateAndCache.js';
dotenv.config();

const API = 'http://localhost:5000/api';
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const su = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Reg', email: `reg.${Date.now()}@t.test`, password: 'TestPass1!' })
})).json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` };
await fetch(`${API}/auth/profile-details`, { method: 'PATCH', headers: H,
  body: JSON.stringify({ age: 15, studyMedium: 'CBSE', fatherName: 'Ram Kumar', schoolName: 'Govt Sr Sec School', schoolCity: 'Ambala' }) });

await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(su.token.split('.')[1], 'base64').toString()).userId);
const R = mongoose.connection.collection('roadmaps');

// Deliberately FORMAL Hindi, flagged as translated, with NO version field — exactly
// the shape of every Hindi translation cached before this change.
const STALE_HI = 'निम्नलिखित कथनों में से कौन सा उपरोक्त दर्पण के लिए सत्य है?';
const id = (await R.insertOne({
  userId, grade: 'Class 10', subject: 'Science', subSubject: '', totalDays: 1,
  days: [{
    dayNumber: 1, topic: 'Light — Reflection and Refraction', focus: 'Laws of reflection',
    estimatedMinutes: 30, completed: false, content: 'Light reflects from a mirror.',
    resources: [], contentGenerated: true, subtopics: ['Reflection'],
    moduleQuiz: {
      generated: true, generatedAt: new Date(),
      questions: [{
        questionText: 'Which of the following statements is true for a concave mirror?',
        options: ['It always forms a virtual image', 'It can form a real image', 'It never reflects light', 'It is flat'],
        correctIndex: 1, topic: 'Reflection', explanation: 'A concave mirror can form a real image.',
        translatedHindiQuestionText: STALE_HI,
        translatedHindiOptions: ['अ', 'ब', 'स', 'द'],
        translatedHindiExplanation: 'उपरोक्त कथन सत्य है।',
        hindiTranslated: true
        // NOTE: no hindiRegisterVersion — this is the pre-existing shape.
      }]
    }
  }],
  language: 'en', archived: false, createdAt: new Date()
})).insertedId;

const stored = () => R.findOne({ _id: id }).then((d) => d.days[0].moduleQuiz.questions[0]);

const before = await stored();
check('FIXTURE: the seeded cache is marked translated', before.hindiTranslated === true);
check('FIXTURE: it has NO register version, like every pre-existing translation',
  before.hindiRegisterVersion === undefined, `hindiRegisterVersion=${before.hindiRegisterVersion}`);
console.log(`   stale Hindi: ${before.translatedHindiQuestionText}`);

// Read it back through the REAL route, in Hindi.
await fetch(`${API}/roadmap/${id}/day/1/quiz?lang=hi`, { headers: H });

const after = await stored();
console.log(`   after fetch: ${after.translatedHindiQuestionText}`);
check('the stale translation was replaced, not served as-is',
  after.translatedHindiQuestionText !== before.translatedHindiQuestionText,
  after.translatedHindiQuestionText === before.translatedHindiQuestionText ? 'UNCHANGED — served stale' : 'retranslated');
check('the new translation is stamped with the current register version',
  after.hindiRegisterVersion === TRANSLATION_REGISTER_VERSION,
  `hindiRegisterVersion=${after.hindiRegisterVersion} (expected ${TRANSLATION_REGISTER_VERSION})`);
check('the formal markers are gone from the retranslated text',
  !/निम्नलिखित|उपरोक्त/.test(after.translatedHindiQuestionText || ''),
  after.translatedHindiQuestionText?.slice(0, 60));

// And it must NOT retranslate again on the next read — one migration, not every fetch.
await fetch(`${API}/roadmap/${id}/day/1/quiz?lang=hi`, { headers: H });
const third = await stored();
check('a second read does NOT retranslate again (migration is once, not per-fetch)',
  third.translatedHindiQuestionText === after.translatedHindiQuestionText, 'stable');

await R.deleteMany({ userId });
await mongoose.disconnect();
const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
