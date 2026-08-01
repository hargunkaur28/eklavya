import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { scrollToTop } from '../utils/scrollToTop.js';
import { BookOpen, Dumbbell, TrendingUp, Trophy, Settings, FileText, NotebookPen, ScrollText, Menu, X } from 'lucide-react';

// Which sections KEEP a slot in the bottom bar; everything else moves behind "More".
// Nine items across a phone gives each pill ~40px, so labels wrap to three lines and
// the row scrolls sideways — the last items are unreachable without a horizontal swipe
// nobody discovers. Three plus the button leaves each one wide enough to read.
//
// Listed as a keep-list rather than a drop-list on purpose: a new section added to
// `items` then defaults to the overflow sheet instead of silently re-crowding the bar.
// Only applied on mobile; the desktop rail is vertical and has room for all nine.
const PRIMARY_KEYS = ['roadmap', 'mentor', 'my-notes'];
const MOBILE_QUERY = '(max-width: 768px)';   // same breakpoint the CSS switches at

// Dashboard navigation rail with a PillNav-style hover effect (adapted from
// React Bits' PillNav to our section-switching + our cream/green palette).
// Each section is a labeled pill; hovering plays a circle-fill + label swap.
// Switches internal `activeSection` (not routes). On mobile it becomes the
// existing fixed bottom nav (see .pill-sidebar mobile styles).
export default function DashboardSidebar({ activeSection, onSelect, t, ease = 'power3.easeOut' }) {
  const items = [
    { key: 'roadmap', label: t.studyRoadmap, Icon: BookOpen },
    { key: 'practice', label: t.practiceMode, Icon: Dumbbell },
    // Workstream I: Previous Year Questions. Sits next to Practice because it is a
    // sibling activity, not a sub-mode of it — PYQ has its own model, its own
    // routes and its own two modes (practice + exam).
    { key: 'pyq', label: t.pyqNav, Icon: ScrollText },
    { key: 'progress', label: t.progressWeakTopics, Icon: TrendingUp },
    { key: 'review', label: t.diagnosticReview, Icon: Trophy },
    // Track 2: PDF Notes generator (inline dashboard section).
    { key: 'notes', label: t.notesNav, Icon: FileText },
    // Workstream C: My Notes — the student's OWN pages. A separate section from
    // 'notes' above (Feature 18's AI generator), which keeps its key, route and
    // endpoints; only its LABEL changed to 'AI Notes'.
    { key: 'my-notes', label: t.myNotesNav, Icon: NotebookPen },
    // Track 1: Mentor uses the ChatWidget avatar; selecting it routes to /mentor.
    { key: 'mentor', label: t.mentor, img: '/chatbot-avatar.png' },
    { key: 'settings', label: t.settings, Icon: Settings }
  ];
  // Icon node for a pill — the chatbot avatar image when `img` is set, else a lucide icon.
  const pillIcon = ({ Icon, img }) => (img ? <img className="pill-avatar" src={img} alt="" /> : <Icon size={18} />);

  // Tracked in JS rather than by CSS alone because this changes WHICH buttons exist,
  // not just how they look — a CSS-hidden pill is still focusable and still read out
  // by a screen reader, which would leave the overflow items reachable by keyboard
  // but invisible, and duplicated once they also appear in the sheet.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => {
      setIsMobile(e.matches);
      if (!e.matches) setMoreOpen(false);   // rotating to landscape must not strand the sheet
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Ordered by PRIMARY_KEYS, not by their position in `items`, so the bar reads
  // Roadmap · Mentor · My Notes regardless of where they sit in the full list.
  const visible = isMobile
    ? PRIMARY_KEYS.map((k) => items.find((i) => i.key === k)).filter(Boolean)
    : items;
  const overflow = isMobile ? items.filter((i) => !PRIMARY_KEYS.includes(i.key)) : [];
  const overflowActive = overflow.some((i) => i.key === activeSection);

  // Both paths go through here so the bar and the More sheet behave identically.
  const choose = (key) => { setMoreOpen(false); onSelect(key); scrollToTop(); };

  const circleRefs = useRef([]);
  const tlRefs = useRef([]);
  const activeTweenRefs = useRef([]);

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        if (!circle?.parentElement) return;
        const pill = circle.parentElement;
        const rect = pill.getBoundingClientRect();
        const { width: w, height: h } = rect;
        if (!w || !h) return;

        const R = ((w * w) / 4 + h * h) / (2 * h);
        const D = Math.ceil(2 * R) + 2;
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
        const originY = D - delta;

        circle.style.width = `${D}px`;
        circle.style.height = `${D}px`;
        circle.style.bottom = `-${delta}px`;

        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

        const label = pill.querySelector('.pill-label');
        const hover = pill.querySelector('.pill-label-hover');
        if (label) gsap.set(label, { y: 0 });
        if (hover) gsap.set(hover, { y: h + 12, opacity: 0 });

        tlRefs.current[index]?.kill();
        const tl = gsap.timeline({ paused: true });
        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: 'auto' }, 0);
        if (label) tl.to(label, { y: -(h + 8), duration: 2, ease, overwrite: 'auto' }, 0);
        if (hover) {
          gsap.set(hover, { y: Math.ceil(h + 100), opacity: 0 });
          tl.to(hover, { y: 0, opacity: 1, duration: 2, ease, overwrite: 'auto' }, 0);
        }
        tlRefs.current[index] = tl;
      });
    };

    layout();
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    if (document.fonts?.ready) document.fonts.ready.then(layout).catch(() => {});
    return () => window.removeEventListener('resize', onResize);
  }, [ease, t]); // re-measure when labels change (language toggle)

  const handleEnter = (i) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease, overwrite: 'auto' });
  };
  const handleLeave = (i) => {
    const tl = tlRefs.current[i];
    if (!tl) return;
    activeTweenRefs.current[i]?.kill();
    activeTweenRefs.current[i] = tl.tweenTo(0, { duration: 0.2, ease, overwrite: 'auto' });
  };

  return (
    <aside className="dashboard-sidebar pill-sidebar" aria-label={t.navMenuLabel}>
      <ul className="pill-list" role="menubar">
        {visible.map((item, i) => (
          <li key={item.key} role="none">
            <button
              type="button"
              role="menuitem"
              className={`pill ${activeSection === item.key ? 'is-active' : ''}`}
              onClick={() => choose(item.key)}
              onMouseEnter={() => handleEnter(i)}
              onMouseLeave={() => handleLeave(i)}
              aria-current={activeSection === item.key ? 'page' : undefined}
            >
              <span className="hover-circle" aria-hidden="true" ref={(el) => { circleRefs.current[i] = el; }} />
              <span className="label-stack">
                <span className="pill-label">{pillIcon(item)} {item.label}</span>
                <span className="pill-label-hover" aria-hidden="true">{pillIcon(item)} {item.label}</span>
              </span>
            </button>
          </li>
        ))}

        {overflow.length > 0 && (
          <li role="none">
            {/* Marked active when the CURRENT section lives behind it, so the bar still
                shows where you are instead of looking like nothing is selected. */}
            <button
              type="button"
              role="menuitem"
              className={`pill pill-more ${overflowActive ? 'is-active' : ''}`}
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label={t.navMoreLabel || 'More'}
            >
              <span className="label-stack">
                <span className="pill-label">
                  {moreOpen ? <X size={18} /> : <Menu size={18} />} {t.navMore || 'More'}
                </span>
              </span>
            </button>
          </li>
        )}
      </ul>

      {moreOpen && overflow.length > 0 && (
        <>
          {/* Tapping anywhere else closes it — on a phone there is no cursor to move
              away, so a menu with no dismiss target is a menu you are stuck in. */}
          <div className="pill-more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="pill-more-sheet" role="menu">
            {overflow.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`pill-more-item ${activeSection === item.key ? 'is-active' : ''}`}
                onClick={() => choose(item.key)}
                aria-current={activeSection === item.key ? 'page' : undefined}
              >
                {pillIcon(item)} <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
