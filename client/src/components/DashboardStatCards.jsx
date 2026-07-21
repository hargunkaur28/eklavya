import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { computeStreaks, getLocalDate } from '../utils/streak.js';
import { Flame, Trophy, Play, ArrowRight } from 'lucide-react';

// Right column of the redesigned overview. Re-flows OUR real data into the
// reference's stat-card pattern: an identity card, a streak card (reusing the
// StreakWidget's /activity data), and a continue-where-you-left-off card
// (reusing Phase 9's next-day). Plus an honest study-activity strip built from
// the same studyDates (which days the student studied, last 14 days).
export default function DashboardStatCards({ userName, subjectLabel, nextDay, onContinue, children }) {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [dates, setDates] = useState(null);

  useEffect(() => {
    let active = true;
    authFetch('/activity')
      .then((r) => r.json())
      .then((d) => { if (active) setDates(d.studyDates || []); })
      .catch(() => { if (active) setDates([]); });
    return () => { active = false; };
  }, [authFetch]);

  const streaks = useMemo(() => computeStreaks(dates || []), [dates]);

  // Last 14 days, TODAY first (leftmost) → older to the right, so the strip
  // fills from the first box as the streak grows.
  const strip = useMemo(() => {
    const set = new Set(dates || []);
    const out = [];
    for (let i = 0; i <= 13; i++) {
      const day = getLocalDate(new Date(Date.now() - i * 86400000));
      out.push({ day, active: set.has(day) });
    }
    return out;
  }, [dates]);

  const daysUnit = (n) => (typeof t.streakDaysUnit === 'function' ? t.streakDaysUnit(n) : `${n}`);
  const initial = (userName || 'S').trim().charAt(0).toUpperCase();

  return (
    <div className="overview-right">
      {/* Identity */}
      <div className="stat-card identity-card">
        <span className="identity-avatar">{initial}</span>
        <div className="identity-text">
          <span className="identity-name">{userName}</span>
          {subjectLabel && <span className="identity-sub">{subjectLabel}</span>}
        </div>
      </div>

      {/* Streak */}
      <div className={`stat-card streak-card ${streaks.current > 0 ? 'active' : ''}`}>
        <div className="streak-card-top">
          <Flame size={22} className="streak-card-flame" />
          <div className="streak-card-num">
            <span className="streak-card-value">{streaks.current}</span>
            <span className="streak-card-label">{t.streakCurrentLabel}</span>
          </div>
        </div>
        <div className="streak-card-longest">
          <Trophy size={14} /> {t.streakLongestLabel}: <strong>{daysUnit(streaks.longest)}</strong>
        </div>
        {/* Study-activity strip (last 14 days) */}
        <div className="activity-strip" aria-hidden="true">
          {strip.map((d, i) => (
            <span key={i} className={`activity-dot ${d.active ? 'on' : ''}`} title={d.day}></span>
          ))}
        </div>
      </div>

      {/* Continue where you left off */}
      {nextDay ? (
        <button type="button" className="stat-card continue-stat" onClick={onContinue}>
          <span className="continue-stat-label"><Play size={13} /> {t.continueHeading}</span>
          <span className="continue-stat-day">
            {typeof t.day === 'function' ? t.day(nextDay.dayNumber) : `Day ${nextDay.dayNumber}`} — {nextDay.topic}
          </span>
          <span className="continue-stat-go">{t.continueCta} <ArrowRight size={15} /></span>
        </button>
      ) : (
        <div className="stat-card all-done-stat"><Trophy size={16} /> {t.allDaysComplete}</div>
      )}

      {/* Extra cards the parent passes into the right column (e.g. Parent Access) */}
      {children}
    </div>
  );
}
