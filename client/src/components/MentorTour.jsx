// Feature 27 — the spoken dashboard tour.
//
// MOBILE AND DESKTOP ARE DIFFERENT TOURS, not one tour with a responsive stylesheet.
// The sidebar collapses to a bottom bar on a phone (Feature 7), so describing "the tall
// strip on the left" to a child holding a phone is worse than saying nothing: they
// cannot read the screen to correct the description, so they will look for something
// that is not there and conclude they have done it wrong.
//
// IT HIGHLIGHTS AND INSTRUCTS. IT NEVER NAVIGATES.
// No step clicks anything, changes a route, or switches a section. The mentor says "tap
// the card" and lights the card up. A wrong auto-navigation strands a child who cannot
// read the page they landed on and cannot describe where they are — and unlike every
// other failure mode here, they have no way to report it and no way back.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.jsx';
import { isElementVisible } from '../utils/mentorHighlight.js';
import { useMentor } from '../context/MentorContext.jsx';
import { translations } from '../data/translations.js';

const MOBILE_QUERY = '(max-width: 768px)';   // the breakpoint DashboardSidebar switches at

// Steps are (line id, DOM anchor) pairs.
//
// Anchors are `data-tour` attributes, NOT class names. A class name is styling: it gets
// renamed in a refactor that has nothing to do with this feature, and the tour then
// silently describes nothing. A `data-tour` attribute has exactly one purpose, so
// removing it is a decision rather than a side effect.
const TOUR_DESKTOP = [
  { line: 'tour.desktop.welcome', anchor: null },
  { line: 'tour.desktop.nav', anchor: '[data-tour="nav"]' },
  { line: 'tour.desktop.progress', anchor: '[data-tour="progress"]' },
  { line: 'tour.desktop.days', anchor: '[data-tour="days"]' },
  { line: 'tour.desktop.mentor', anchor: '[data-tour="mentor"]' }
];

const TOUR_MOBILE = [
  { line: 'tour.mobile.welcome', anchor: null },
  { line: 'tour.mobile.nav', anchor: '[data-tour="nav"]' },
  // Mobile only: the overflow sheet exists solely because nine sections do not fit in a
  // bottom bar. A child who is never told about it never finds five of the nine.
  //
  // THE MENU IS DESCRIBED, NOT OPENED — the choice you asked me to make.
  //
  // Opening it would be the mentor pressing a control on the child's behalf, which is
  // the one thing this feature must never do: they cannot read the sheet it opens and
  // cannot get back out of it. So the step points at the BUTTON (which is visible) and
  // the line names what is inside it, without ever implying the contents are on screen.
  // The wording was already rewritten for exactly this in A5 — it enumerates the six
  // items rather than saying "press it and see".
  { line: 'tour.mobile.more', anchor: '[data-tour="nav-more"]' },
  { line: 'tour.mobile.progress', anchor: '[data-tour="progress"]' },
  { line: 'tour.mobile.days', anchor: '[data-tour="days"]' },
  { line: 'tour.mobile.mentor', anchor: '[data-tour="mentor"]' }
];

export default function MentorTour({ onDone }) {
  const mentor = useMentor();
  const { language } = useLanguage();
  const t = translations[language]?.voiceMentor || translations.en.voiceMentor;

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const cancelled = useRef(false);

  // Rotating a tablet mid-tour must not leave a child hearing about a sidebar that has
  // just become a bottom bar.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const steps = isMobile ? TOUR_MOBILE : TOUR_DESKTOP;

  const finish = useCallback(() => {
    cancelled.current = true;
    onDone?.();
  }, [onDone]);

  // ── Run one step ──
  //
  // A step whose anchor matches NOTHING is SKIPPED, not spoken. That is the mechanical
  // guarantee behind "never describe an element that is not on screen": if the markup
  // changes and an anchor disappears, the tour gets shorter rather than lying. Silence
  // about a real thing is recoverable; confident description of an absent one is not,
  // for a listener who cannot look and check.
  useEffect(() => {
    if (cancelled.current) return undefined;
    if (step >= steps.length) { finish(); return undefined; }

    const s = steps[step];
    const el = s.anchor ? document.querySelector(s.anchor) : null;

    // ── SCROLL FIRST, THEN DECIDE WHETHER THE STEP CAN BE SPOKEN ────────────
    //
    // The skip rule was `if (anchor && !el) skip` — a test of EXISTENCE. The sidebar
    // exists in the DOM at all times (scrolled off on desktop; a fixed bottom bar on
    // mobile), so the rule never fired and the tour described things off screen. The
    // element must be VISIBLE, not merely present.
    //
    // The check has to happen AFTER the scroll, because "not visible yet" and "not
    // visible at all" are different answers and only the second is a reason to skip.
    // So the scroll is issued here and the decision is deferred to `decide()` below.
    let alive = true;
    let raf = 0;
    let settle = 0;
    let decided = false;

    // ── THE HIGHLIGHT MUST BE MEASURED AFTER THE SCROLL, NOT BEFORE IT ──────
    //
    // Device-testing finding A4: only "Skip" appeared highlighted. The cause was here.
    // `scrollIntoView({behavior:'smooth'})` is ASYNCHRONOUS, and the old code called
    // `getBoundingClientRect()` on the very next line — capturing the element's
    // PRE-SCROLL position. The ring is `position: fixed`, so it stayed where the
    // element used to be while the page scrolled out from under it, leaving a glowing
    // rectangle over empty space (or off-screen entirely on a phone). The only bright
    // thing left was the Skip button, which sits above the scrim by design — so the
    // tour read as "everything highlights Skip".
    //
    // A rect is therefore re-measured until it stops changing, and then kept in sync
    // with scroll and resize for as long as the step is on screen.
    const measure = () => {
      if (!alive || !el) return;
      const r = el.getBoundingClientRect();
      setRect((prev) => {
        if (prev && prev.top === r.top && prev.left === r.left
          && prev.width === r.width && prev.height === r.height) return prev;
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
    };

    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // TRACK CONTINUOUSLY, not for a bounded window. The previous version tracked for
      // 900ms — long enough for the initial smooth scroll and nothing else — so the ring
      // froze at a page position that later changed. The child scrolls, the page reflows,
      // and the ring stays put over whatever now occupies that space. That is the
      // "highlights the navbar" symptom: not a wrong selector, a stale rectangle.
      const track = () => { if (!alive) return; measure(); raf = requestAnimationFrame(track); };
      raf = requestAnimationFrame(track);
      window.addEventListener('scroll', measure, { passive: true });
      window.addEventListener('resize', measure);
    } else {
      setRect(null);
    }

    // Decide AFTER the scroll has had time to land. A step whose element cannot be
    // brought on screen is SKIPPED IN SILENCE — describing something a child cannot see
    // is worse than saying nothing, because they will look for it and conclude they have
    // done something wrong.
    const decide = () => {
      if (!alive || decided) return;
      decided = true;
      if (s.anchor && !isElementVisible(document.querySelector(s.anchor))) {
        setRect(null);
        setStep((n) => n + 1);
        return;
      }
      mentor.speak(s.line, { onEnded: () => { if (alive && !cancelled.current) setStep((n) => n + 1); } });
    };
    settle = setTimeout(decide, el ? 700 : 0);
    // The next step begins when the line FINISHES, not on a timer. A fixed delay is
    // either too short (the mentor talks over itself) or too long (dead air a child
    // reads as the app having stopped), and the right value differs per line and per
    // language because the sentences are different lengths.
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [step, steps, mentor, finish]);

  // Muting mid-tour must work instantly AND must not strand the child on a highlighted
  // element with nothing happening: a muted tour ends rather than continuing silently.
  useEffect(() => { if (mentor.muted) finish(); }, [mentor.muted, finish]);

  if (step >= steps.length) return null;

  return (
    <div className="mentor-tour" role="dialog" aria-live="polite" aria-label={t.tourLabel}>
      {/* The scrim is NOT click-through-blocking over the highlighted element: the child
          is being told to look at something, and a modal overlay that swallows taps
          teaches them the screen is broken. */}
      <div className="mt-scrim" onClick={finish} />

      {rect && (
        <div
          className="mt-highlight"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
          aria-hidden="true"
        />
      )}

      <button type="button" className="mt-skip" onClick={finish} aria-label={t.skipTour}>
        <X size={18} /> <span>{t.skipTour}</span>
      </button>

      <div className="mt-progress" aria-hidden="true">
        {steps.map((s, i) => <span key={s.line} className={`mt-dot ${i <= step ? 'on' : ''}`} />)}
      </div>
    </div>
  );
}
