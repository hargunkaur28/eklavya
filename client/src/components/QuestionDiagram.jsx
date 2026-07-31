import { useState, useMemo, useEffect } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';

// Workstream D4 — shared figure renderer for module quizzes, practice mode and
// the diagnostic.
//
// The SVG arrives already sanitised server-side (utils/generateDiagram.js). It is
// rendered as a data-URI <img> rather than with dangerouslySetInnerHTML: an <img>
// does not execute scripts, so even a sanitisation miss cannot run code. That is
// defence in depth, not a substitute for the server-side allow-list.
//
// The server keeps stroke="currentColor" in the stored figure so one stored SVG
// serves any theme; the colour is resolved to a literal here, immediately before
// encoding, because a data-URI <img> is an isolated document and cannot inherit
// the page's colour.

const FALLBACK_INK = '#1F2A1F';

function resolveInk() {
  if (typeof window === 'undefined' || !document?.documentElement) return FALLBACK_INK;
  const styles = getComputedStyle(document.documentElement);
  const token = styles.getPropertyValue('--diagram-ink').trim();
  return token || FALLBACK_INK;
}

// btoa() is latin1-only; SVG labels may contain Devanagari or maths symbols.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function QuestionDiagram({ diagram, className = '' }) {
  const { language } = useLanguage();
  const t = translations[language]?.diagnostic || translations.en.diagnostic;
  const [zoomed, setZoomed] = useState(false);
  const [ink, setInk] = useState(FALLBACK_INK);

  useEffect(() => { setInk(resolveInk()); }, []);

  // Close the zoom overlay on Escape, and don't leave the body scroll-locked.
  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [zoomed]);

  const src = useMemo(() => {
    if (!diagram?.svg) return '';
    try {
      const themed = diagram.svg.replace(/currentColor/g, ink);
      return `data:image/svg+xml;base64,${toBase64(themed)}`;
    } catch {
      return '';
    }
  }, [diagram?.svg, ink]);

  if (!src) return null;

  const alt = (language === 'hi' && diagram.altHindi) ? diagram.altHindi : (diagram.alt || t.figureLabel);

  return (
    <>
      <figure className={`question-diagram ${className}`.trim()}>
        <button
          type="button"
          className="question-diagram-frame"
          onClick={() => setZoomed(true)}
          aria-label={`${t.figureZoom}: ${alt}`}
        >
          <img src={src} alt={alt} className="question-diagram-img" />
          <span className="question-diagram-zoom-hint" aria-hidden="true">
            <Maximize2 size={14} /> {t.figureZoom}
          </span>
        </button>
        <figcaption className="question-diagram-caption">{alt}</figcaption>
      </figure>

      {zoomed && (
        <div
          className="question-diagram-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setZoomed(false)}
        >
          <button type="button" className="question-diagram-close" aria-label={t.figureClose}>
            <X size={22} />
          </button>
          <img src={src} alt={alt} className="question-diagram-zoomed" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/**
 * The text a screen reader / read-aloud should hear before the question itself.
 * Read-aloud must describe the figure, otherwise a narrating student is asked
 * about something they were never told exists.
 */
export function diagramAltFor(question, language) {
  const d = question?.diagram;
  if (!d || !d.svg) return '';
  return (language === 'hi' && d.altHindi) ? d.altHindi : (d.alt || '');
}
