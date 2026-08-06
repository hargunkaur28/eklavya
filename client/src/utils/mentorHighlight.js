// Feature 27 — the ONE owner of the guidance highlight.
//
// Same shape, and the same reason, as narrationController.js owning playback (Design
// Rule 10). Highlighting was owned PER COMPONENT, and per-component ownership of a
// global visual produced four symptoms that all read as separate bugs on a device:
//
//   1. a ring on a thin empty strip between two cards, pointing at nothing
//   2. a ring stuck on the videos, including while a video played
//   3. no ring on Start Quiz when the mentor had just said to press it
//   4. rings surviving long past the moment they were relevant
//
// All four are one defect: **nothing could clear "whatever is highlighted right now"**,
// because no single place knew what that was. Every `MentorGuide` independently decided
// to show a ring and independently kept showing it, so two guides could be lit at once
// and a stale one could outlive the sentence that put it there.
//
// So the ring lives HERE, at module scope, and claiming a highlight IS releasing the
// previous one — exactly as starting a narration is stopping the previous one.
//
// A FIFTH symptom probably belongs to the same family: the sidebar rendering black.
// The tour's highlight paints its dimming scrim with `box-shadow: 0 0 0 9999px`, so a
// highlight rect that outlives its step darkens the entire page except one strip. With a
// single owner that clears on finish, the mechanism for that no longer exists — though
// it was NOT reproduced, so this is a plausible cause and not a confirmed one.

let current = null;   // { ownerId, selector }
const listeners = new Set();

function emit() {
  for (const l of listeners) { try { l(current); } catch { /* a bad listener must not break the UI */ } }
}

export function subscribeHighlight(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/**
 * Claim the highlight. Whatever was highlighted before is released.
 *
 * `selector` may be null, which is a legitimate claim meaning "I am the current guidance
 * and I point at nothing" — a spoken line with no button to press. That still supersedes
 * a previous ring, which is the whole point: a line about the quiz must extinguish the
 * ring on the videos even though it has no ring of its own.
 */
export function claimHighlight(ownerId, selector) {
  current = { ownerId, selector: selector || null };
  emit();
}

/** Release, but ONLY if this owner still holds it — a late cleanup must not clear someone else's ring. */
export function releaseHighlight(ownerId) {
  if (current?.ownerId !== ownerId) return;
  current = null;
  emit();
}

export function getHighlight() { return current; }

// A rect smaller than this in either dimension is not a thing a child can be pointed at.
// It is the empty-anchor case: `<div data-mentor="module-quiz" />` measured 0px tall and
// produced a glowing sliver between two cards. Anchors must be real elements; this is the
// backstop for when they are not, because a ring pointing at nothing is worse than no
// ring — it directs a child who cannot read to press empty space.
export const MIN_HIGHLIGHT_PX = 16;

export function isPointableRect(r) {
  return !!r && r.width >= MIN_HIGHLIGHT_PX && r.height >= MIN_HIGHLIGHT_PX;
}

/**
 * Is this element ACTUALLY VISIBLE to the child right now?
 *
 * ── WHY EXISTENCE WAS NOT ENOUGH, AND WHY THE SKIP RULE WAS BYPASSED ──
 *
 * The tour's rule is "a step whose element is not on screen is SKIPPED, not spoken".
 * It was implemented as `document.querySelector(sel)` returning something — and that
 * is a test of EXISTENCE, not of visibility. The sidebar exists in the DOM at all
 * times: scrolled out of view on desktop, and on mobile it is a fixed bottom bar that
 * is never "scrolled to" at all. So the selector always matched, the step was never
 * skipped, and the mentor described a sidebar the child could not see.
 *
 * Another instance of asserting a proxy instead of the thing (Design Rule 11): "is it
 * in the document" stood in for "can the child see it".
 */
export function isElementVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (!isPointableRect(r)) return false;
  const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
  if (style && (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)) return false;
  // Must intersect the viewport. A generous margin, because an element just below the
  // fold is legitimately reachable by the scroll the tour is about to perform.
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}
