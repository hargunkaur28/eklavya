import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { BookOpen, Dumbbell, TrendingUp, Trophy, Settings } from 'lucide-react';

// Dashboard navigation rail with a PillNav-style hover effect (adapted from
// React Bits' PillNav to our section-switching + our cream/green palette).
// Each section is a labeled pill; hovering plays a circle-fill + label swap.
// Switches internal `activeSection` (not routes). On mobile it becomes the
// existing fixed bottom nav (see .pill-sidebar mobile styles).
export default function DashboardSidebar({ activeSection, onSelect, t, ease = 'power3.easeOut' }) {
  const items = [
    { key: 'roadmap', label: t.studyRoadmap, Icon: BookOpen },
    { key: 'practice', label: t.practiceMode, Icon: Dumbbell },
    { key: 'progress', label: t.progressWeakTopics, Icon: TrendingUp },
    { key: 'review', label: t.diagnosticReview, Icon: Trophy },
    { key: 'settings', label: t.settings, Icon: Settings }
  ];

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
        {items.map(({ key, label, Icon }, i) => (
          <li key={key} role="none">
            <button
              type="button"
              role="menuitem"
              className={`pill ${activeSection === key ? 'is-active' : ''}`}
              onClick={() => onSelect(key)}
              onMouseEnter={() => handleEnter(i)}
              onMouseLeave={() => handleLeave(i)}
              aria-current={activeSection === key ? 'page' : undefined}
            >
              <span className="hover-circle" aria-hidden="true" ref={(el) => { circleRefs.current[i] = el; }} />
              <span className="label-stack">
                <span className="pill-label"><Icon size={18} /> {label}</span>
                <span className="pill-label-hover" aria-hidden="true"><Icon size={18} /> {label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
