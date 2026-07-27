// Phase 2 resolution table: which language a piece of content narrates in.
//  1. English subject (any sub-subject) → ALWAYS the displayed/site language
//     (the Hindi-default override does NOT apply to English content).
//  2. Otherwise (non-English subject, or no subject at all — e.g. Mentor):
//       pref 'hindi'        → Hindi   (the new default)
//       pref 'english'      → English
//       pref 'match-toggle' → the site language toggle (pre-feature behavior)
// Returns 'hi' | 'en'.
export function resolveNarrationLang({ subject, pref, siteLang } = {}) {
  const site = siteLang === 'hi' ? 'hi' : 'en';
  if (subject && /english/i.test(subject)) return site; // English subject exempt
  if (pref === 'english') return 'en';
  if (pref === 'match-toggle') return site;
  return 'hi'; // Default is Hindi for all non-English subjects (even when pref is unset)
}
