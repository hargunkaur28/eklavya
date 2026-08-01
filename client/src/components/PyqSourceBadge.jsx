import { FileCheck2, Sparkles } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.jsx';

// Workstream I0 — the badge that keeps real and generated questions apart on screen.
//
// This is the whole user-facing half of the source rule, so it is ONE component and
// every surface uses it. A second place that renders "where this question came from"
// is a second place that can get it wrong, and getting it wrong here means a student
// revising for a board exam believes an invented question is a real one.
//
// The two states are deliberately not variations of a theme:
//   • REAL      — solid green, a document icon, and the paper's own identity:
//                 "CBSE 2023 · Q14". Carries a year because there IS one.
//   • GENERATED — outlined amber, a sparkle icon, "Exam-style practice", and NO
//                 YEAR, because a generated question does not have one. The server
//                 does not send a year for these; there is nothing here to render
//                 even if this component asked for it.
//
// Different colour, different border treatment, different icon and different text —
// not just different text. A student skimming a paper should be able to tell the two
// apart without reading, and colour alone would fail anyone who cannot distinguish
// green from amber, which is why the icon and the wording differ too.
export default function PyqSourceBadge({ source, sourceLabel, year }) {
  const { t } = useLanguage();
  const isReal = source === 'pyq';

  if (isReal) {
    return (
      <span className="pyq-badge pyq-badge-real" title={t('pyq.badgeRealTitle')}>
        <FileCheck2 size={13} aria-hidden="true" />
        {/* Server-built from board + year + question number. The client never
            assembles this string, so it cannot assemble one for a generated
            question by getting a prop wrong. */}
        <span>{sourceLabel}</span>
      </span>
    );
  }

  return (
    <span className="pyq-badge pyq-badge-generated" title={t('pyq.badgeGeneratedTitle')}>
      <Sparkles size={13} aria-hidden="true" />
      <span>{t('pyq.badgeGenerated')}</span>
      {/* No year element at all — not an empty one, not a hidden one. */}
    </span>
  );
}
