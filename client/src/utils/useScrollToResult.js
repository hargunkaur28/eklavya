import { useEffect, useRef } from 'react';

// Bring a result into view the moment it exists.
//
// A submitted quiz renders its score ABOVE the per-question review, but the student
// is usually near the bottom of the page when they hit Submit — so the score appears
// off-screen behind them and the page looks like it did nothing. On a long paper the
// banner can be several screens up.
//
// Usage:
//   const resultRef = useScrollToResult(phase === 'result');
//   <div ref={resultRef} className="quiz-result-banner"> …
//
// Fires once per result. `ready` going false (retake, new attempt) re-arms it, so the
// next result scrolls too — without that, only the first attempt of a session works.
export function useScrollToResult(ready) {
  const ref = useRef(null);
  const fired = useRef(false);

  useEffect(() => {
    if (!ready) { fired.current = false; return; }
    if (fired.current) return;
    fired.current = true;

    // Two frames: the result element is rendered by the same commit that flipped
    // `ready`, so it exists — but its final position does not settle until layout has
    // run, and scrolling to a stale offset lands in the wrong place.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // `block: 'start'` plus a scroll-margin-top in CSS, rather than a computed
      // offset: the scrolling box here may be `main` rather than the document, and
      // scroll-margin is honoured by whichever one actually scrolls.
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  return ref;
}

export default useScrollToResult;
