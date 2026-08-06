// Feature 21 / A3 — the one decision behind live question narration:
//
//   given text that IS in language X, and a student who wants to HEAR language Y,
//   do we translate, and what language do we ultimately speak?
//
// It lives here as a pure function because it was wrong in the route for months in a
// way that was invisible: it compared the requested narration language against the SITE
// TOGGLE rather than against the language of the text in hand. A toggle says what the
// student PREFERS. It says nothing about what a particular string IS.
//
// The observed symptom (device testing, A3): a Hindi-toggle student heard SOME diagnostic
// questions in Hindi and some in English, in the same sitting. The English ones were
// exactly the questions with no cached Hindi translation — the client fell back to
// English text, the toggle still said 'hi', the route concluded "already Hindi, nothing
// to do", and spoke English words. Every individual step looked correct.
//
// Extracted and asserted (CI invariant 21) rather than left inline, because this path is
// shared by EVERY grade: a regression here reaches Class 10 students who have nothing to
// do with the Voice Mentor.

/**
 * @param {object} p
 * @param {'hi'|'en'} p.sourceLang     what the supplied text ACTUALLY is
 * @param {'hi'|'en'} p.narrationLang  what the student wants to hear
 * @returns {{needsTranslation: boolean, translateTo: 'hi'|null, speakLang: 'hi'|'en'}}
 *
 * `speakLang` is what to speak IF translation succeeds or is unnecessary. A caller whose
 * translation fails must fall back to `sourceLang` — speaking the untranslated text in
 * the requested voice is the failure this whole module exists to prevent.
 */
export function resolveSpeakPlan({ sourceLang, narrationLang }) {
  const src = sourceLang === 'hi' ? 'hi' : 'en';
  const want = narrationLang === 'hi' ? 'hi' : 'en';

  if (src === want) return { needsTranslation: false, translateTo: null, speakLang: want };

  // en -> hi is the only supported direction (the translator is one-way). A student who
  // asked for English narration of Hindi content gets the Hindi text spoken in a Hindi
  // voice: it differs from their stated preference, but it is INTELLIGIBLE, whereas
  // Hindi words in an English voice are not. Documented gap, deliberately not silent —
  // the caller logs it.
  if (want === 'hi') return { needsTranslation: true, translateTo: 'hi', speakLang: 'hi' };
  return { needsTranslation: false, translateTo: null, speakLang: src };
}

/**
 * What to speak when a translation attempt FAILED.
 *
 * Always the source language — never the requested one. Speaking untranslated text in
 * the requested language's voice is precisely the A3 defect: English words in a Hindi
 * voice, which is both wrong and unintelligible.
 */
export function speakLangAfterTranslationFailure(sourceLang) {
  return sourceLang === 'hi' ? 'hi' : 'en';
}
