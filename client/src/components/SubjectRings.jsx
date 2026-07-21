import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubjectDash } from '../utils/subjectTranslations.js';
import { Plus } from 'lucide-react';

// Visual re-flow of the reference's "Today's course" rings onto OUR data:
// one ring per subject the student has an active roadmap for. Percentage =
// that subject's roadmap completion % (computed on the frontend from the
// already-fetched `roadmaps` list — no new data). Clicking a ring switches the
// active subject via the existing selectRoadmap. All existing data, restyled.
function Ring({ percent }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, percent)) / 100);
  return (
    <svg className="ring-svg" width="82" height="82" viewBox="0 0 82 82">
      <circle className="ring-track" cx="41" cy="41" r={r} fill="none" strokeWidth="7" />
      <circle
        className="ring-progress"
        cx="41" cy="41" r={r} fill="none" strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 41 41)"
      />
      <text className="ring-pct" x="41" y="41" dominantBaseline="central" textAnchor="middle">{percent}%</text>
    </svg>
  );
}

export default function SubjectRings({ roadmaps = [], activeRoadmapId, onSelect, readOnly = false }) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  return (
    <div className="subject-rings">
      {roadmaps.map((r) => {
        const total = r.totalDays || (r.days?.length || 0);
        const done = (r.days || []).filter((d) => d.completed).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const isActive = r._id === activeRoadmapId;
        return (
          <button
            key={r._id}
            type="button"
            className={`subject-ring ${isActive ? 'selected' : ''}`}
            onClick={() => onSelect && onSelect(r._id)}
            aria-current={isActive ? 'true' : undefined}
          >
            <Ring percent={pct} />
            <span className="subject-ring-name">{formatGradeSubjectDash(r.grade, r.subject, language)}</span>
            <span className="subject-ring-sub">
              {typeof t.daysCompleted === 'function' ? t.daysCompleted(done, total) : `${done} of ${total} days`}
            </span>
          </button>
        );
      })}

      {/* Phase 5: parents are read-only — no "add subject" (would hit onboarding). */}
      {!readOnly && (
        <button type="button" className="subject-ring add" onClick={() => navigate('/onboarding')}>
          <span className="subject-ring-add-circle"><Plus size={26} /></span>
          <span className="subject-ring-name">{t.addSubject}</span>
        </button>
      )}
    </div>
  );
}
