import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubjectDash } from '../utils/subjectTranslations.js';
import { Users, Trophy, Eye, TrendingUp, Settings, KeyRound, ExternalLink, Mail } from 'lucide-react';
import SubjectRings from './SubjectRings.jsx';
import StreakWidget from './StreakWidget.jsx';
import ProgressWeakTopics from './ProgressWeakTopics.jsx';
import Avatar from './Avatar.jsx';
import DashboardShell from './DashboardShell.jsx';

// Phase 5: read-only parent dashboard. A parent session (Option B) shares the
// student's userId, so every endpoint it reads is ALREADY scoped to the one linked
// student server-side. This view only DISPLAYS that data. Phase 7 adds a Settings
// section where the parent can change their OWN password (but NOT the email — the
// login email is the child's, changeable only from the child's account).
export default function ParentDashboard() {
  const { user, roadmaps, activeRoadmap, selectRoadmap } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [section, setSection] = useState('progress');
  const studentName = (user?.name || '').trim();

  const railBrand = (
    <>
      <span className="dashboard-rail-icon"><Eye size={18} /></span>
      <span className="dashboard-rail-title">{t.parentViewBadge}</span>
    </>
  );
  const nav = [
    { key: 'progress', label: t.parentProgressHeading, Icon: TrendingUp },
    { key: 'settings', label: t.settings, Icon: Settings }
  ];
  const identity = (
    <header className="parent-dash-header">
      <div className="parent-dash-identity">
        <Avatar url={user?.photoUrl} name={studentName} size={52} />
        <div>
          <h1>{t.parentViewingProgress ? t.parentViewingProgress(studentName) : `${studentName}'s progress`}</h1>
          <p className="parent-read-only-note">{t.parentReadOnlyNote}</p>
        </div>
      </div>
    </header>
  );

  const renderProgress = () => {
    if (!activeRoadmap) {
      return (
        <div className="parent-empty-card">
          <Users size={30} />
          <p>{t.parentNoRoadmaps}</p>
        </div>
      );
    }
    const days = activeRoadmap.days || [];
    const total = activeRoadmap.totalDays || days.length || 0;
    const completedCount = days.filter((d) => d.completed).length;
    const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    const videosWatchedCount = days.filter(
      (d) => (Array.isArray(d?.videoProgress) && d.videoProgress.some((v) => v?.watched)) || d?.videoWatched
    ).length;
    const videoPercent = total > 0 ? Math.round((videosWatchedCount / total) * 100) : 0;
    const quizAttempts = days.filter((d) => d.moduleQuizAttempt?.attempted);
    const quizzesPassed = quizAttempts.filter((d) => d.moduleQuizAttempt?.passed).length;

    return (
      <>
        <SubjectRings roadmaps={roadmaps} activeRoadmapId={activeRoadmap._id} onSelect={selectRoadmap} readOnly />

        <div className="dashboard-progress-card">
          <div className="progress-info-row">
            <div>
              <h3><Trophy size={20} className="trophy-icon" /> {t.parentProgressHeading} — {formatGradeSubjectDash(activeRoadmap.grade, activeRoadmap.subject, language)}</h3>
              <p>{typeof t.daysCompleted === 'function' ? t.daysCompleted(completedCount, total) : `${completedCount} of ${total} days completed`}</p>
            </div>
            <span className="progress-percent-badge">{progressPercent}%</span>
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%`, transition: 'width 0.4s ease' }}></div>
          </div>
          <div className="progress-secondary-row">
            <span className="progress-secondary-label">
              {typeof t.videosWatchedStat === 'function' ? t.videosWatchedStat(videosWatchedCount, total) : `${videosWatchedCount} of ${total} videos watched`}
            </span>
            <span className="progress-secondary-value">{videoPercent}%</span>
          </div>
          {quizAttempts.length > 0 && (
            <div className="progress-secondary-row">
              <span className="progress-secondary-label">
                {typeof t.parentQuizzesPassed === 'function' ? t.parentQuizzesPassed(quizzesPassed, quizAttempts.length) : `${quizzesPassed} of ${quizAttempts.length} module quizzes passed`}
              </span>
            </div>
          )}
        </div>

        <StreakWidget userName={studentName} />
        <ProgressWeakTopics roadmapId={activeRoadmap._id} readOnly />
      </>
    );
  };

  const renderSettings = () => (
    <div className="settings-section">
      <h2 className="settings-heading">{t.settingsHeading}</h2>
      <button type="button" className="settings-row" onClick={() => navigate('/change-password')}>
        <span className="settings-row-icon"><KeyRound size={20} /></span>
        <span className="settings-row-text">
          <span className="settings-row-title">{t.profileChangePasswordLink}</span>
          <span className="settings-row-sub">{t.parentChangePwSub}</span>
        </span>
        <ExternalLink size={16} className="settings-row-arrow" />
      </button>
      <div className="parent-email-note">
        <Mail size={15} /> {t.parentEmailNote}
      </div>
    </div>
  );

  return (
    <DashboardShell brand={railBrand} nav={nav} activeKey={section} onNav={setSection}>
      {identity}
      {section === 'progress' ? renderProgress() : renderSettings()}
    </DashboardShell>
  );
}
