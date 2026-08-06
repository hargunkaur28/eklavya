// Feature 27 — the single ring. Rendered ONCE, for the whole app.
//
// It draws whatever `mentorHighlight.js` currently holds, and nothing else. Two rings on
// screen at once is not "unlikely" here, it is unrepresentable: there is one owner and
// one renderer.
//
// ── Tracking, and refusing to point at nothing ──
//
// The rect is re-measured on a rAF loop, on scroll and on resize, because the element it
// points at MOVES: a video card grows when its player mounts, a quiz section appears
// below, images land late. A ring measured once ends up beside its target, which on the
// device looked like "highlighting a thin empty strip".
//
// And a degenerate rect draws NOTHING. The quiz ring was anchored to an empty `<div/>`
// that measured 0px tall, so it rendered as a glowing sliver between two cards, pointing
// a child who cannot read at empty space. No ring is better than a wrong ring: silence
// about where to press leaves them to explore, a wrong ring actively misdirects them.

import { useEffect, useState } from 'react';
import { subscribeHighlight, isPointableRect } from '../utils/mentorHighlight.js';
import './VoiceMentor.css';

export default function MentorHighlightRing() {
  const [selector, setSelector] = useState(null);
  const [rect, setRect] = useState(null);

  useEffect(() => subscribeHighlight((cur) => {
    setSelector(cur?.selector || null);
    // Drop the old rect the instant the claim changes, so a superseded ring cannot
    // linger for a frame on the previous element.
    setRect(null);
  }), []);

  useEffect(() => {
    if (!selector) { setRect(null); return undefined; }
    let alive = true;
    let raf = 0;

    const measure = () => {
      if (!alive) return;
      const el = document.querySelector(selector);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      // Off-screen or collapsed: show nothing rather than a ring at the edge.
      if (!isPointableRect(r)) { setRect(null); return; }
      setRect((prev) => (
        prev && prev.top === r.top && prev.left === r.left
          && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      ));
    };

    // Tracked continuously while the claim is held. A bounded loop was enough for the
    // tour (one scroll, then still) and is NOT enough here: the day page reflows while a
    // video loads and again when the quiz section renders, both well after any deadline.
    const track = () => { if (!alive) return; measure(); raf = requestAnimationFrame(track); };
    raf = requestAnimationFrame(track);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [selector]);

  if (!rect) return null;

  return (
    <div
      className="mentor-ring"
      style={{ top: rect.top - 5, left: rect.left - 5, width: rect.width + 10, height: rect.height + 10 }}
      aria-hidden="true"
    />
  );
}
