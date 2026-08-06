// Feature 27 — the Voice Mentor's session brain.
//
// Three jobs, none of which involve a model:
//   1. SPEAK a line by id, through the one narration owner.
//   2. MATCH a spoken answer against a closed set, deterministically.
//   3. Run the CONFIRM machine — read back, retry once, then hand over to typing.
//
// Everything here is free at runtime. There is no live model anywhere in this feature:
// fixed lines are cached WAVs, variable lines are the browser's own voice, and matching
// is a synonym table. That is a deliberate cost decision, not a limitation to be lifted
// later — see PRODUCTION_CHECKLIST "Working practice".

import { playNarration, speakLocal, hasVoiceFor } from './narrationController.js';

const API_BASE = (() => {
  if (import.meta.env?.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:5000/api';
    return '/api';
  }
  return 'http://127.0.0.1:5000/api';
})();

const absolute = (url) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${API_BASE.replace(/\/api\/?$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
};

// ── Speaking a scripted line ────────────────────────────────────────────────
//
// Goes through `playNarration`, which means starting a mentor line IS stopping whatever
// was speaking (Design Rule 10). A mentor that talks over quiz narration is a
// regression of a bug that took three separate fixes to close, and the only reason it
// cannot happen here is that this module does not own playback.

let muted = false;
export function setMuted(v) { muted = !!v; }
export function isMuted() { return muted; }

/**
 * Speak one scripted line.
 *
 * The request carries a LINE ID, never text — the server resolves it to a fixed string
 * and returns an already-synthesised WAV. Sending text would silently destroy the cache
 * (every caller phrasing it slightly differently, every request a miss, a per-utterance
 * bill forever), so the client is not able to.
 */
export async function speakLine(lineId, { lang = 'hi', authFetch, ownerId = 'mentor', onEnded, onUnspoken } = {}) {
  if (muted) { onEnded?.(); return true; }

  let spoke = true;

  await playNarration({
    ownerId,
    prime: true,
    // THE MENTOR NEVER SUBSTITUTES A VOICE FROM ANOTHER LANGUAGE. Quiz narration does,
    // and should: a Class 10 student hearing Devanagari in an American accent can read
    // the screen and route around it. The mentor's user cannot — for them an English
    // voice reading Devanagari is noise, and noise is worse than silence because it
    // SOUNDS LIKE THE APP WORKING. See selectVoice() in narrationController.js.
    strictVoice: true,
    resolve: async (signal) => {
      const res = await authFetch('/mentor-voice/speak', {
        method: 'POST', signal, body: JSON.stringify({ lineId, lang })
      });
      if (!res.ok) throw new Error(`speak ${res.status}`);
      const data = await res.json();
      // Every provider exhausted server-side — the only branch where a line's TEXT
      // reaches the client, so the browser can speak it rather than say nothing.
      if (data.useFallback) return { speak: { text: data.fallbackText, lang: data.fallbackLang || lang } };
      return { src: absolute(data.audioUrl) };
    },
    onEnded,
    onError: (kind) => {
      // 'novoice' is the refusal, and it is the only error kind that means "this device
      // cannot say this at all" rather than "this attempt failed". Callers that own a
      // retry budget must distinguish them: a refusal has to leave the budget untouched.
      if (kind === 'novoice') { spoke = false; onUnspoken?.(); }
    }
  });

  return spoke;
}

// ── Voice availability, resolved ONCE, UP FRONT ─────────────────────────────
//
// THE ORDERING IS THE WHOLE POINT. This must be known BEFORE a confirm prompt is
// attempted, never discovered by one failing. If availability is inferred from "the
// child said nothing", the machine has already spent an attempt on silence — and after
// two of those it hands over to typing having never told the child what went wrong.
let voiceCheck = null;
export function primeVoiceCheck(lang) {
  if (!voiceCheck) voiceCheck = hasVoiceFor(lang);
  return voiceCheck;
}
export function resetVoiceCheck() { voiceCheck = null; }

// ── Reading a value back ────────────────────────────────────────────────────
//
// This line contains the child's own words, so it is unbounded, so it can never be a
// cached clip. It is spoken by the browser — free and on-device — or not at all.
// It is never sent to a paid provider: an uncacheable line billed per utterance, on the
// hardware least likely to have a local voice, is the cost model inverted.
export async function readBack(value, { lang = 'hi', carrier, onEnded }) {
  if (muted) { onEnded?.(); return true; }
  const text = carrier(value);
  // `onEnded` fires when the utterance FINISHES. The promise resolves on onSTART, which
  // is the right signal for "did this device speak at all" and the wrong one for "may I
  // open the microphone now" — opening it at start means recording the read-back.
  return speakLocal({ ownerId: 'mentor-confirm', text, lang, onEnded });
}

// ── The confirm machine ─────────────────────────────────────────────────────
//
// Outcomes, and what each one costs:
//
//   'confirmed'   the child said yes -> accept the value
//   'retry'       the child said no  -> ask once more (ONE attempt is spent)
//   'handover'    two attempts spent -> hand to typing, with a friendly line
//   'unspoken'    the read-back never happened (no voice / engine dead) -> the confirm
//                 step is SKIPPED. NO ATTEMPT IS SPENT, because nothing was attempted.
//
// The last one is the one that matters and the one an obvious implementation gets
// wrong. A silent prompt looks exactly like a child who did not answer, so a machine
// that counts by "no answer received" charges a playback failure to the transcription
// budget and burns through both attempts producing nothing anyone could hear.
export const CONFIRM_MAX_ATTEMPTS = 2;

export function createConfirmMachine() {
  let attempts = 0;
  return {
    attemptsUsed: () => attempts,
    /** Called only when the read-back GENUINELY SPOKE. Anything else must not reach here. */
    onNegative() {
      attempts += 1;
      return attempts >= CONFIRM_MAX_ATTEMPTS ? 'handover' : 'retry';
    },
    onPositive() { return 'confirmed'; },
    /**
     * The read-back did not speak. Returns 'unspoken' and leaves the counter ALONE.
     * Never a third loop either way: a child who was not understood twice will not be
     * understood better the third time, and an open question they cannot escape is the
     * worst place to leave the person least able to escape it.
     */
    onUnspoken() { return 'unspoken'; },
    reset() { attempts = 0; }
  };
}

// ── Deterministic matching ──────────────────────────────────────────────────
//
// No model call. A closed set plus a synonym table answers this exactly, and exactly is
// what a closed set deserves — an unmatched answer re-asks once and then falls back to
// the visual picker, which is a better outcome than a confident wrong match.

/**
 * Fold case, strip punctuation, collapse spaces — WITHOUT destroying Devanagari.
 *
 * `\p{M}` IS LOAD-BEARING AND MUST NOT BE REMOVED AS REDUNDANT.
 *
 * Devanagari vowel signs — the matras ा ि ी ु ू े ै ो ौ, the anusvara ं, the chandrabindu
 * ँ, the nukta ़ and the virama ् — are Unicode COMBINING MARKS (`\p{M}`), not letters
 * (`\p{L}`). A keep-set of `[\p{L}\p{N}\s]` therefore reads them as punctuation and
 * strips them: हाँ collapses to ह, सही to सह, पाँचवीं to पचव.
 *
 * Every Hindi match in this file then fails, and it fails SILENTLY and TOTALLY — yes,
 * no, names, numbers, grades and subjects all stop matching in the mentor's default
 * language, while every Latin transliteration keeps working perfectly. So the feature
 * looks fine to anyone testing in English and is completely deaf to the children it was
 * built for.
 *
 * Caught by test-mentor-voice.mjs, which is why the Devanagari cases are asserted
 * separately from the transliterated ones rather than being assumed equivalent.
 */
export function normalizeSpoken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Affirmative / negative, in both languages and in the Latin transliterations a
// code-mixed child actually produces. "haan" and "हाँ" are the same answer and the STT
// engine's choice of script is not the child's.
const YES = ['haan', 'han', 'ha', 'yes', 'yep', 'yeah', 'ok', 'okay', 'sahi', 'thik', 'theek', 'हाँ', 'हां', 'सही', 'ठीक', 'जी', 'ji'];
const NO = ['nahi', 'nahin', 'na', 'no', 'nope', 'galat', 'नहीं', 'नही', 'ना', 'गलत'];

export function matchYesNo(transcript) {
  const t = normalizeSpoken(transcript);
  if (!t) return null;
  const words = t.split(' ');
  // Word-level, not substring: "na" inside "naam" is not a refusal, and a substring
  // test turns every sentence containing the child's own name into a "no".
  if (words.some((w) => NO.includes(w))) return false;
  if (words.some((w) => YES.includes(w))) return true;
  return null;
}

// Grades, spoken. Ordinals in Hindi are their own words, not the digit plus a suffix,
// so a numeric parse alone answers almost nothing a child actually says.
const GRADE_WORDS = {
  'Class 1': ['1', 'one', 'ek', 'pehli', 'pahli', 'first', 'एक', 'पहली', 'पहलि'],
  'Class 2': ['2', 'two', 'do', 'dusri', 'doosri', 'second', 'दो', 'दूसरी'],
  'Class 3': ['3', 'three', 'teen', 'tisri', 'teesri', 'third', 'तीन', 'तीसरी'],
  'Class 4': ['4', 'four', 'char', 'chauthi', 'fourth', 'चार', 'चौथी'],
  'Class 5': ['5', 'five', 'panch', 'paanch', 'panchvi', 'paanchvi', 'fifth', 'पांच', 'पाँच', 'पांचवी', 'पाँचवीं'],
  'Class 6': ['6', 'six', 'chah', 'chhah', 'chhati', 'sixth', 'छह', 'छठी'],
  'Class 7': ['7', 'seven', 'saat', 'satvi', 'saatvi', 'seventh', 'सात', 'सातवीं'],
  'Class 8': ['8', 'eight', 'aath', 'aathvi', 'eighth', 'आठ', 'आठवीं'],
  'Class 9': ['9', 'nine', 'nau', 'navi', 'ninth', 'नौ', 'नौवीं'],
  'Class 10': ['10', 'ten', 'das', 'dasvi', 'dasvin', 'tenth', 'दस', 'दसवीं'],
  'Class 11': ['11', 'eleven', 'gyarah', 'gyarahvi', 'eleventh', 'ग्यारह', 'ग्यारहवीं'],
  'Class 12': ['12', 'twelve', 'barah', 'barahvi', 'twelfth', 'बारह', 'बारहवीं']
};

export function matchGrade(transcript, allowed) {
  const words = normalizeSpoken(transcript).split(' ');
  for (const [grade, forms] of Object.entries(GRADE_WORDS)) {
    if (allowed && !allowed.includes(grade)) continue;
    if (forms.some((f) => words.includes(normalizeSpoken(f)))) return grade;
  }
  return null;
}

const SUBJECT_WORDS = {
  Maths: ['maths', 'math', 'mathematics', 'ganit', 'hisab', 'गणित', 'हिसाब'],
  Science: ['science', 'vigyan', 'vigyaan', 'विज्ञान', 'साइंस'],
  English: ['english', 'angrezi', 'angreji', 'अंग्रेज़ी', 'अंग्रेजी', 'इंग्लिश'],
  Hindi: ['hindi', 'हिन्दी', 'हिंदी'],
  'Social Science': ['social', 'social science', 'samajik', 'samajik vigyan', 'sst', 'सामाजिक', 'सामाजिक विज्ञान'],
  Physics: ['physics', 'bhautiki', 'भौतिकी'],
  Chemistry: ['chemistry', 'rasayan', 'रसायन'],
  Biology: ['biology', 'jeev vigyan', 'जीव विज्ञान'],
  JEE: ['jee', 'जेईई'],
  NEET: ['neet', 'नीट']
};

/**
 * Match a spoken subject.
 *
 * `allowed` is the SERVER's spoken-subject list for this grade, and passing it is not
 * optional politeness — the mentor must not ACCEPT a subject it never OFFERED. Naming
 * five subjects and matching against ten is the same defect one step later, and harder
 * to see, because the child's own words appear to have caused it.
 */
export function matchSubject(transcript, allowed) {
  const t = normalizeSpoken(transcript);
  const words = t.split(' ');
  // Longest first, so "social science" is claimed before "science" — a shorter entry
  // winning would pin exactly the wrong subject, which is the same ordering bug the
  // Hindi glossary documents.
  const entries = Object.entries(SUBJECT_WORDS)
    .filter(([subject]) => !allowed || allowed.includes(subject))
    .flatMap(([subject, forms]) => forms.map((f) => [subject, normalizeSpoken(f)]))
    .sort((a, b) => b[1].length - a[1].length);

  for (const [subject, form] of entries) {
    if (form.includes(' ') ? t.includes(form) : words.includes(form)) return subject;
  }
  return null;
}

const BOARD_WORDS = {
  CBSE: ['cbse', 'c b s e', 'central', 'सीबीएसई', 'सी बी एस ई'],
  'Haryana Board (HBSE)': ['hbse', 'haryana', 'haryana board', 'h b s e', 'हरियाणा', 'एचबीएसई']
};

export function matchBoard(transcript, allowed) {
  const t = normalizeSpoken(transcript);
  for (const [board, forms] of Object.entries(BOARD_WORDS)) {
    if (allowed && !allowed.includes(board)) continue;
    if (forms.some((f) => t.includes(normalizeSpoken(f)))) return board;
  }
  return null;
}

/**
 * Pull an age out of a spoken answer.
 *
 * Bounded to a plausible school range rather than accepting any integer: "मैं दूसरी
 * कक्षा में हूँ और मेरी उम्र 7 है" contains a 2 and a 7, and an unbounded first-number
 * parse takes the 2. Age drives the whole course level, so a wrong one is not a small
 * error — it is a wrong roadmap. This is also why age is on the read-back list despite
 * feeling safe for being short and numeric.
 */
export function matchAge(transcript) {
  const t = normalizeSpoken(transcript);
  const NUM_WORDS = {
    3: ['teen', 'तीन'], 4: ['char', 'चार'], 5: ['panch', 'paanch', 'पांच', 'पाँच'],
    6: ['chah', 'chhah', 'छह'], 7: ['saat', 'सात'], 8: ['aath', 'आठ'], 9: ['nau', 'नौ'],
    10: ['das', 'दस'], 11: ['gyarah', 'ग्यारह'], 12: ['barah', 'बारह'], 13: ['terah', 'तेरह'],
    14: ['chaudah', 'चौदह'], 15: ['pandrah', 'पंद्रह'], 16: ['solah', 'सोलह']
  };
  const digits = (t.match(/\b\d{1,2}\b/g) || []).map(Number).filter((n) => n >= 5 && n <= 25);
  if (digits.length) return digits[0];
  const words = t.split(' ');
  for (const [n, forms] of Object.entries(NUM_WORDS)) {
    if (Number(n) >= 5 && forms.some((f) => words.includes(normalizeSpoken(f)))) return Number(n);
  }
  return null;
}

/**
 * Extract a NAME from a code-mixed sentence, in the script it was spoken in.
 *
 * "mera naam Satu hai" must store "Satu", and "मेरा नाम सातु है" must store "सातु" — the
 * script the child used is the script that is kept, because transliterating a person's
 * own name into the other script is not a normalisation, it is getting it wrong.
 *
 * Carrier words are stripped from BOTH ends; whatever remains is the name. If nothing
 * remains, the whole transcript is returned rather than an empty string — a slightly
 * wrong name shown for confirmation is recoverable, and a blank field is the child
 * having spoken and been given nothing back.
 */
const NAME_CARRIERS = [
  'mera', 'meri', 'naam', 'nam', 'name', 'hai', 'hain', 'he', 'is', 'my', 'papa', 'pita',
  'ka', 'ki', 'ke', 'father', 'school', 'skool', 'padhta', 'padhti', 'hoon', 'hun', 'main',
  'मेरा', 'मेरी', 'नाम', 'है', 'हैं', 'पापा', 'पिता', 'का', 'की', 'के', 'स्कूल', 'मैं', 'हूँ', 'हूं', 'पढ़ता', 'पढ़ती'
];

export function extractName(transcript) {
  const raw = String(transcript || '').trim();
  if (!raw) return '';
  const tokens = raw.split(/\s+/);
  const isCarrier = (w) => NAME_CARRIERS.includes(normalizeSpoken(w));
  let start = 0;
  let end = tokens.length;
  while (start < end && isCarrier(tokens[start])) start++;
  while (end > start && isCarrier(tokens[end - 1])) end--;
  const name = tokens.slice(start, end).join(' ').trim();
  return name || raw;
}

// ── Which line to speak for a day, given real progress ──────────────────────
//
// Pure, so the mapping from roadmap state to spoken instruction can be reasoned about
// (and asserted) without a browser, a session, or a roadmap.
//
// THE COMPLETION GATE IS FEATURE 9's: a day is done when the video is watched AND the
// quiz is passed. Never tell a child they are finished when the day is not complete,
// and never send them to a day they have already finished — the first is a lie they
// cannot check and the second is work they have already done, and a child who cannot
// read the screen has no way to discover either.
export function guidanceLineFor(context) {
  if (!context) return 'guide.noRoadmap';
  if (!context.hasRoadmap) return 'guide.noRoadmap';
  if (context.allDone) return 'guide.allDone';

  const day = context.active?.currentDay;
  if (!day) return 'guide.allDone';
  if (day.needs === 'both') return 'guide.dayIncomplete';
  if (day.needs === 'video') return 'guide.watchVideo';
  return 'guide.takeQuiz';
}

// ── "What do you want to study today?" ──────────────────────────────────────
//
// The one open question in the flow, and it is answered WITHOUT a model.
//
// Matching is against the child's OWN COURSES only, never the full taxonomy. A child
// who says "science" and has no Science roadmap must not be guided to one that does not
// exist; the honest answer is the fallback below.
//
// A no-match does NOT re-ask. It goes straight to two large tappable answers. Re-asking
// an open question that already failed once is the worst possible experience for the
// person least able to escape it — they were not understood, they cannot read the
// screen, and asking again gives them nothing new to work with.
const INTENTS = {
  practice: ['practice', 'abhyas', 'abhyaas', 'sawal', 'question', 'अभ्यास', 'सवाल', 'प्रश्न'],
  notes: ['notes', 'note', 'likhna', 'copy', 'नोट', 'नोट्स', 'लिखना'],
  study: ['padhna', 'padhai', 'padh', 'study', 'learn', 'lesson', 'roadmap', 'plan', 'पढ़ना', 'पढ़ाई', 'पढ़', 'योजना']
};

export function matchStudyIntent(transcript, ownCourses = []) {
  const t = normalizeSpoken(transcript);
  if (!t) return null;

  // A subject the child ACTUALLY HAS wins over a generic intent: "science" from a child
  // with a Science roadmap is a course, not the word "study".
  const ownSubjects = ownCourses.map((c) => c.subject).filter(Boolean);
  const subject = matchSubject(t, ownSubjects);
  if (subject) {
    const course = ownCourses.find((c) => c.subject === subject);
    if (course) return { kind: 'course', course };
  }

  for (const [intent, forms] of Object.entries(INTENTS)) {
    if (forms.some((f) => t.includes(normalizeSpoken(f)))) return { kind: intent };
  }
  return null;
}
