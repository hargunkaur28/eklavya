#!/usr/bin/env node
// Feature 27 — unit checks for the Voice Mentor's pure logic.
//
// NO NETWORK, NO KEY, NO BROWSER. Every function under test is deliberately pure so it
// can be asserted for free: the matchers, the confirm machine, and the roadmap-state →
// spoken-instruction mapping. Runs in `test:units`.
//
// Per Design Rule 18, each check states its property in a sentence FIRST. If the
// sentence needs the implementation to make sense, it is not an invariant.

import {
  createConfirmMachine, CONFIRM_MAX_ATTEMPTS,
  matchYesNo, matchGrade, matchSubject, matchBoard, matchAge,
  extractName, guidanceLineFor, matchStudyIntent, normalizeSpoken
} from './src/utils/mentorVoice.js';
import { selectVoice } from './src/utils/narrationController.js';

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fails.push(name); console.log(`*** FAIL ***  ${name}${detail ? '  — ' + detail : ''}`); }
};

console.log('\n── THE ORDERING RULE: a playback failure must not spend a transcription attempt ──');
// PROPERTY: the two-attempt budget belongs to TRANSCRIPTION failures. A read-back that
// never spoke is a PLAYBACK failure, and charging it to that budget means a device with
// no Hindi voice burns both attempts on silence and then hands over to typing without
// the child ever learning why.
{
  const m = createConfirmMachine();
  const outcomes = [m.onUnspoken(), m.onUnspoken(), m.onUnspoken(), m.onUnspoken()];
  check('an unspoken read-back returns "unspoken" every time, never "handover"',
    outcomes.every((o) => o === 'unspoken'), outcomes.join(','));
  check('NO attempt is spent by an unspoken read-back, however many times it happens',
    m.attemptsUsed() === 0, `attemptsUsed=${m.attemptsUsed()}`);
}
{
  // PROPERTY: only a genuine spoken "no" spends an attempt, and the second one hands
  // over. Never a third loop — a child not understood twice will not be understood
  // better the third time.
  const m = createConfirmMachine();
  check('the first "no" asks again', m.onNegative() === 'retry');
  check('the second "no" hands over to typing', m.onNegative() === 'handover');
  check('exactly two attempts are spendable', m.attemptsUsed() === CONFIRM_MAX_ATTEMPTS);
}
{
  // PROPERTY: a machine that has spent one real attempt is not RESET by an unspoken
  // read-back, and is not ADVANCED by one either. The two counters are independent.
  const m = createConfirmMachine();
  m.onNegative();
  m.onUnspoken(); m.onUnspoken();
  check('an unspoken read-back neither advances nor resets a partly-spent budget',
    m.attemptsUsed() === 1, `attemptsUsed=${m.attemptsUsed()}`);
  check('the next real "no" still hands over', m.onNegative() === 'handover');
}

console.log('\n── THE MENTOR REFUSES A SUBSTITUTED VOICE; THE QUIZ STILL ACCEPTS ONE ──');
// PROPERTY: for a reader, an imperfect voice beats silence — a Class 10 student hearing
// Devanagari in an American accent can read the screen and route around it. For a child
// who CANNOT read the screen the arithmetic inverts: an English voice reading Devanagari
// is noise, and noise is worse than silence because it SOUNDS LIKE THE APP WORKING.
//
// Both behaviours are correct, for different readers. So the assertion is not "strict is
// better" — it is that the two paths differ in exactly this way and keep differing.
{
  const HI = { lang: 'hi-IN', name: 'Hindi' };
  const EN_IN = { lang: 'en-IN', name: 'English India' };
  const EN_US = { lang: 'en-US', name: 'English US' };
  const DE = { lang: 'de-DE', name: 'German' };

  // When the right voice EXISTS, both paths agree — the flag changes nothing.
  check('mentor picks the Hindi voice when one exists', selectVoice([EN_US, HI], 'hi', true) === HI);
  check('quiz picks the Hindi voice when one exists', selectVoice([EN_US, HI], 'hi', false) === HI);

  // The fork. This is the whole point of the flag.
  check('MENTOR: no Hindi voice -> NO SPEECH (null), never a substitute',
    selectVoice([EN_US, EN_IN, DE], 'hi', true) === null);
  check('QUIZ: no Hindi voice -> still speaks, via an Indian voice',
    selectVoice([EN_US, EN_IN, DE], 'hi', false) === EN_IN);
  check('QUIZ: no Hindi and no Indian voice -> still speaks, via voices[0]',
    selectVoice([DE, EN_US], 'hi', false) === DE);
  check('MENTOR: no Hindi and no Indian voice -> STILL refuses',
    selectVoice([DE, EN_US], 'hi', true) === null);

  // English is not a special case: a mentor set to English on a device with no English
  // voice refuses too. The rule is about the requested language, not about Hindi.
  check('MENTOR: an English mentor with no English voice also refuses',
    selectVoice([HI, DE], 'en', true) === null);
  check('MENTOR: an English mentor with en-IN speaks', selectVoice([HI, EN_IN], 'en', true) === EN_IN);

  // An empty voice list is "no voice", not a crash — the commonest state on a locked-down
  // school tablet, and the state getVoices() returns before the engine is ready.
  check('an empty voice list refuses under strict', selectVoice([], 'hi', true) === null);
  check('an empty voice list yields nothing for the quiz either, rather than throwing',
    selectVoice([], 'hi', false) === null);
  check('a null voice list does not throw', selectVoice(null, 'hi', false) === null);
}

console.log('\n── Yes / no, across scripts and code-mixing ──');
check('Devanagari yes', matchYesNo('हाँ') === true);
check('transliterated yes', matchYesNo('haan sahi hai') === true);
check('Devanagari no', matchYesNo('नहीं') === false);
check('transliterated no', matchYesNo('nahi galat hai') === false);
check('an unrelated sentence is neither', matchYesNo('mera naam Satu hai') === null);
// PROPERTY: matching is WORD-level, not substring. "na" inside "naam" is not a refusal,
// and a substring test turns every sentence containing the child's own name into "no".
check('"na" inside "naam" is not a refusal', matchYesNo('naam') === null);

console.log('\n── Names keep the script they were spoken in ──');
// PROPERTY: transliterating a person's own name into the other script is not
// normalisation, it is getting it wrong.
check('code-mixed Latin name', extractName('mera naam Satu hai') === 'Satu', extractName('mera naam Satu hai'));
check('Devanagari name stays Devanagari', extractName('मेरा नाम सातु है') === 'सातु', extractName('मेरा नाम सातु है'));
check('a bare name passes through', extractName('Ram Kumar') === 'Ram Kumar');
// PROPERTY: a blank field is the child having spoken and been given nothing back, which
// is worse than a slightly wrong value they can see and correct.
check('an all-carrier sentence returns the raw text rather than nothing',
  extractName('mera naam hai') !== '', JSON.stringify(extractName('mera naam hai')));

console.log('\n── Age is bounded, because age drives the whole course level ──');
// PROPERTY: an unbounded first-number parse takes the class number out of "I am in
// class 2 and I am 7". Age is what the course level derives from, so a wrong one is not
// a small error — it is a wrong roadmap.
check('a plain digit', matchAge('7') === 7);
check('a Hindi number word', matchAge('सात') === 7);
check('the class number is not mistaken for the age',
  matchAge('main dusri class me hoon aur meri umar 7 hai') === 7,
  String(matchAge('main dusri class me hoon aur meri umar 7 hai')));
check('an out-of-range number is refused', matchAge('99') === null);

console.log('\n── Closed sets: grade, subject, board ──');
check('Hindi ordinal grade', matchGrade('मैं पाँचवीं में हूँ') === 'Class 5');
check('transliterated grade', matchGrade('teesri class') === 'Class 3');
check('digit grade', matchGrade('class 2') === 'Class 2');
check('an unmatched grade returns null rather than guessing', matchGrade('bahut door') === null);

// PROPERTY: longest-first, so "social science" is claimed before "science". A shorter
// entry winning pins exactly the wrong subject.
check('"social science" is not swallowed by "science"',
  matchSubject('social science padhna hai') === 'Social Science',
  String(matchSubject('social science padhna hai')));
check('Hindi subject', matchSubject('मुझे गणित पढ़ना है') === 'Maths');

// PROPERTY: the mentor must not ACCEPT a subject it never OFFERED. Offering five and
// matching ten is the same defect one step later, and harder to see because the child's
// own words appear to have caused it.
const PRIMARY = ['Maths', 'Science', 'English', 'Hindi', 'Social Science'];
check('NEET is matched when the band allows it', matchSubject('neet', null) === 'NEET');
check('NEET is REFUSED when the spoken band is primary-only',
  matchSubject('neet', PRIMARY) === null);
check('JEE is REFUSED when the spoken band is primary-only',
  matchSubject('jee karna hai', PRIMARY) === null);
check('a primary subject still matches inside the primary band',
  matchSubject('ganit', PRIMARY) === 'Maths');

check('board by acronym', matchBoard('cbse') === 'CBSE');
check('board by name', matchBoard('haryana board') === 'Haryana Board (HBSE)');
check('an unmatched board returns null', matchBoard('icse') === null);

console.log('\n── The completion gate is Feature 9\'s, and the mentor must not misreport it ──');
// PROPERTY: never tell a child they are done when the day is not complete, and never
// send them to a day they have finished. A child who cannot read the screen can check
// neither.
const day = (needs) => ({ hasRoadmap: true, allDone: false, active: { currentDay: { dayNumber: 3, needs } } });
check('nothing done yet -> the day is incomplete', guidanceLineFor(day('both')) === 'guide.dayIncomplete');
check('video outstanding -> watch the video', guidanceLineFor(day('video')) === 'guide.watchVideo');
check('video done, quiz outstanding -> take the quiz', guidanceLineFor(day('quiz')) === 'guide.takeQuiz');
check('every day complete -> all done',
  guidanceLineFor({ hasRoadmap: true, allDone: true, active: { currentDay: null } }) === 'guide.allDone');
check('no roadmap -> the diagnostic, not a day',
  guidanceLineFor({ hasRoadmap: false }) === 'guide.noRoadmap');
check('a null context degrades to the diagnostic rather than throwing',
  guidanceLineFor(null) === 'guide.noRoadmap');
// PROPERTY: "you have finished everything" and "you have not started" are opposite
// states. Conflating them congratulates a child who has done nothing.
check('"all done" and "no roadmap" are different answers',
  guidanceLineFor({ hasRoadmap: true, allDone: true, active: { currentDay: null } })
  !== guidanceLineFor({ hasRoadmap: false }));

console.log('\n── "What do you want to study?" matches the child\'s OWN courses only ──');
// PROPERTY: a child who says "science" and has no Science roadmap must not be guided to
// one that does not exist. The honest answer is the two-button fallback.
const own = [{ subject: 'Maths', roadmapId: 'r1' }];
check('a subject the child HAS resolves to that course',
  matchStudyIntent('ganit padhna hai', own)?.course?.roadmapId === 'r1');
check('a subject the child does NOT have is not matched as a course',
  matchStudyIntent('science padhna hai', own)?.kind !== 'course',
  JSON.stringify(matchStudyIntent('science padhna hai', own)));
check('a practice intent is recognised', matchStudyIntent('abhyas karna hai', own)?.kind === 'practice');
check('an unmatched answer returns null so the caller can show two buttons',
  matchStudyIntent('pata nahi kuch bhi', own) === null,
  JSON.stringify(matchStudyIntent('pata nahi kuch bhi', own)));

console.log('\n── Normalisation keeps Devanagari intact ──');
check('punctuation is stripped, Devanagari survives',
  normalizeSpoken('हाँ, सही है!') === 'हाँ सही है', normalizeSpoken('हाँ, सही है!'));

console.log('');
console.log(`${pass}/${pass + fails.length} checks passed`);
if (fails.length) { fails.forEach((f) => console.log(`  FAILED: ${f}`)); process.exit(1); }
