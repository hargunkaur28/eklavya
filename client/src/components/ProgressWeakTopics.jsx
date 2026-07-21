import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { TrendingUp, Loader2, CheckCircle2, ArrowRight } from 'lucide-react';

// Phase 4: reads the weak-topics aggregation (per-question quiz results grouped
// by canonical sub-topic) and surfaces what the student should focus on next.
export default function ProgressWeakTopics({ roadmapId }) {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    authFetch(`/roadmap/${roadmapId}/weak-topics?lang=${language}`)
      .then((res) => res.json())
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setData(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authFetch, roadmapId, language]);

  const pct = (a) => Math.round((a || 0) * 100);

  if (loading) {
    return (
      <div className="weak-topics-panel">
        <div className="weak-loading"><Loader2 size={22} className="animate-spin" /> {t.weakTopicsLoading}</div>
      </div>
    );
  }

  const hasAttempts = data?.hasAttempts;
  const weak = data?.weakTopics || [];
  const all = data?.allTopics || [];

  return (
    <div className="weak-topics-panel">
      <div className="weak-head">
        <TrendingUp size={22} className="weak-head-icon" />
        <div>
          <h3>{t.weakTopicsTitle}</h3>
          <p>{t.weakTopicsIntro}</p>
        </div>
      </div>

      {!hasAttempts ? (
        <div className="weak-empty">{t.weakTopicsEmpty}</div>
      ) : weak.length === 0 ? (
        <div className="weak-none">
          <CheckCircle2 size={20} /> {t.noWeakTopics}
        </div>
      ) : (
        <div className="weak-list">
          {weak.map((tpc) => (
            <div key={tpc.subtopic} className="weak-item">
              <div className="weak-item-top">
                <span className="weak-item-name">{tpc.label || tpc.subtopic}</span>
                <span className="weak-item-avg">{typeof t.weakTopicAvg === 'function' ? t.weakTopicAvg(pct(tpc.accuracy)) : `${pct(tpc.accuracy)}%`}</span>
              </div>
              <div className="weak-bar">
                <div className="weak-bar-fill" style={{ width: `${pct(tpc.accuracy)}%` }}></div>
              </div>
              <div className="weak-item-foot">
                <span className="weak-item-score">{typeof t.weakTopicScore === 'function' ? t.weakTopicScore(tpc.correct, tpc.total) : `${tpc.correct}/${tpc.total}`}</span>
                <div className="weak-day-links">
                  {tpc.days.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="weak-day-link"
                      onClick={() => navigate(`/roadmap/${roadmapId}/day/${d}`)}
                    >
                      {typeof t.reviewDay === 'function' ? t.reviewDay(d) : `Review Day ${d}`} <ArrowRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full breakdown of every quizzed sub-topic (context beyond just weak ones) */}
      {hasAttempts && all.length > 0 && (
        <div className="weak-all">
          <h4>{t.allTopicsHeading}</h4>
          <div className="weak-all-list">
            {all.map((tpc) => (
              <div key={tpc.subtopic} className={`weak-all-row ${tpc.accuracy < (data.threshold || 0.6) && tpc.total >= 2 ? 'is-weak' : ''}`}>
                <span className="weak-all-name">{tpc.label || tpc.subtopic}</span>
                <span className="weak-all-bar">
                  <span className="weak-all-fill" style={{ width: `${pct(tpc.accuracy)}%` }}></span>
                </span>
                <span className="weak-all-pct">{pct(tpc.accuracy)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
