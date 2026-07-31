// Shared source-scanning helpers for every static-analysis check in this repo.
//
// This exists because the same false positive was written TWICE. ci-invariants.mjs
// needed comment-stripping (a comment explaining why `decryptAadhaar` is absent
// tripped the check enforcing its absence), got it, and then a second ad-hoc scanner
// was written without it and reported two failures caused by counting `<form` inside
// a comment that documented the form boundary.
//
// That is the same shape as the seven direct Groq fetch calls: a correct thing
// implemented in ONE place does not protect the places that do not call it. So the
// implementation lives here and every scanner imports it — including the ones written
// in Workstreams C and D, which will otherwise hit this exact false positive again.

/** Remove block and line comments. `://` is preserved so URLs survive. */
export function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Blank out string and template literal CONTENTS, keeping the delimiters.
 * Needed so `console.log('Aadhaar collection: DISABLED')` is not read as logging an
 * Aadhaar value — a status message mentioning a thing is not a use of that thing.
 */
export function stripStrings(src) {
  return String(src || '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * The two views every scanner should use:
 *   code     — comments removed (what the file actually does)
 *   codeOnly — comments AND string contents removed (identifiers only)
 * Never scan the raw source; that is what produced four false positives.
 */
export function scannable(raw) {
  const code = stripComments(raw);
  return { code, codeOnly: stripStrings(code) };
}
