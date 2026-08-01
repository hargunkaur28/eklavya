// Workstream B5 — draft persistence for the profile onboarding flow.
//
// The flow is five steps ending in a single PATCH, so a refresh mid-flow would
// otherwise lose everything. Drafting the answers is the obvious fix and it is fine
// for most fields.
//
// IT IS NOT FINE FOR AADHAAR.
//
// A draft in localStorage holds a PLAINTEXT Aadhaar number in the browser
// indefinitely: it survives logout, it survives closing the tab, and on a shared
// school or family device the next student to sit down can read it out of devtools.
// That single convenience would undo every guarantee the server-side encryption
// establishes — the number would be safe at rest in our database and sitting in
// cleartext on a shared machine.
//
// So the allow-list below is the enforcement mechanism: this module can only ever
// persist the fields named in it. Aadhaar and its consent flag are absent by
// construction, live in component state only, and are simply re-entered if the page
// reloads. That is the correct trade: a few seconds of retyping against an
// indefinite plaintext copy on a shared device.

import { isKnownBoard } from '../data/taxonomy.js';

// The draft is keyed PER USER, not globally.
//
// The shared-device reasoning that kept Aadhaar out of storage applies to the rest
// of the fields too. On a school computer with one global key, Student B opens the
// flow and finds Student A's father's name, school and phone number already filled
// in — no Aadhaar, but plenty that is still personal and still wrong to show them.
// Scoping by userId means a draft can only ever be resumed by the account that
// created it, and `clearAllDrafts()` (called on logout) removes every one of them.
const KEY_PREFIX = 'eklavya.onboardingDraft.v1.';
const keyFor = (userId) => `${KEY_PREFIX}${userId || 'anon'}`;

// The ONLY fields that may ever be written to storage. Adding `aadhaarNumber` or
// `aadhaarConsent` here would be a privacy regression — see the comment above.
const DRAFTABLE = [
  'age',
  'studyMedium',
  'fatherName',
  'schoolName',
  'schoolCity',
  'phoneNumber',
  'location'
];

// Belt and braces: even if a caller passes the whole form object, anything not on
// the allow-list is dropped rather than stored.
function pickDraftable(state) {
  const out = {};
  for (const k of DRAFTABLE) {
    if (state[k] !== undefined && state[k] !== null && state[k] !== '') out[k] = state[k];
  }
  // Workstream H: a draft written before the board list was reduced can hold 'ICSE'
  // or an 'Other' free-text board. Restoring it puts the flow in a state no button
  // renders as selected, yet `stepValid` passes (a non-empty studyMedium) — so the
  // student walks to the end and the submit dies on BOARD_NOT_SUPPORTED with the
  // board step five screens behind them. Dropping it here returns them to an
  // unanswered board question instead, which is the honest state.
  if (out.studyMedium && !isKnownBoard(out.studyMedium)) delete out.studyMedium;
  return out;
}

export function saveDraft(userId, state) {
  try {
    const safe = pickDraftable(state || {});
    if (!Object.keys(safe).length) return;
    localStorage.setItem(keyFor(userId), JSON.stringify(safe));
  } catch {
    // Storage disabled or full — drafting is a convenience, never a requirement.
  }
}

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return {};
    // Re-filter on read too, so a draft written by an older build that included a
    // field we now consider unsafe cannot resurrect it.
    return pickDraftable(JSON.parse(raw) || {});
  } catch {
    return {};
  }
}

/** Called after a CONFIRMED successful submit — never before. */
export function clearDraft(userId) {
  try { localStorage.removeItem(keyFor(userId)); } catch { /* nothing to do */ }
}

/**
 * Remove every user's draft. Called on logout, alongside the session token: a draft
 * that outlives the session is exactly the shared-device leak this key scheme exists
 * to prevent. Also sweeps the pre-scoping global key, so an upgrade cleans up after
 * the previous build.
 */
export function clearAllDrafts() {
  try {
    localStorage.removeItem('eklavya.onboardingDraft.v1'); // legacy global key
    // Uses the standard length/key(i) Storage API rather than Object.keys(), which
    // is not guaranteed to enumerate stored keys. Iterating BACKWARDS so removing an
    // entry cannot shift an index past an unvisited one.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* nothing to do */ }
}

// Exported for the privacy test, which asserts the list contains no Aadhaar field.
export const DRAFTABLE_FIELDS = DRAFTABLE;
