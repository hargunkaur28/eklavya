import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { computeStreaks } from '../utils/streak.js';
import { Flame, Trophy } from 'lucide-react';

// Phase 8: account-wide study streak, shown near the top of the dashboard.
// Reads /activity (local study dates) and computes current + longest streak
// using the browser's local day boundaries.
export default function StreakWidget() {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [streaks, setStreaks] = useState({ current: 0, longest: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    authFetch('/activity')
      .then((r) => r.json())
      .then((d) => { if (active) { setStreaks(computeStreaks(d.studyDates)); setLoaded(true); } })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [authFetch]);

  if (!loaded) return null; // avoid a flash before data arrives

  const daysUnit = (n) => (typeof t.streakDaysUnit === 'function' ? t.streakDaysUnit(n) : `${n}`);

  return (
    <div className={`streak-widget ${streaks.current > 0 ? 'active' : ''}`}>
      <div className="streak-current">
        <Flame size={26} className="streak-flame" />
        <div className="streak-current-text">
          <span className="streak-num">{streaks.current}</span>
          <span className="streak-label">{t.streakCurrentLabel}</span>
        </div>
      </div>

      {streaks.current === 0 ? (
        <p className="streak-msg">{t.streakStartMsg}</p>
      ) : (
        <div className="streak-longest">
          <Trophy size={15} />
          <span>{t.streakLongestLabel}: <strong>{daysUnit(streaks.longest)}</strong></span>
        </div>
      )}
    </div>
  );
}
