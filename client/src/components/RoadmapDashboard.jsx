import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubject, formatGradeSubjectDash } from '../utils/subjectTranslations.js';
import { getTranslatedTopic } from '../utils/topicTranslations.js';
import { CheckSquare, Square, Clock, ExternalLink, RefreshCw, Trophy, CheckCircle2, XCircle, Sparkles, UserCog } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SpeakerButton from './SpeakerButton.jsx';
import DashboardSidebar from './DashboardSidebar.jsx';
import ProgressWeakTopics from './ProgressWeakTopics.jsx';
import PracticeMode from './PracticeMode.jsx';
import SubjectRings from './SubjectRings.jsx';
import DashboardStatCards from './DashboardStatCards.jsx';
import ParentAccessCard from './ParentAccessCard.jsx';

export default function RoadmapDashboard() {
  const { activeRoadmap, setActiveRoadmap, authFetch, refreshRoadmap, user, roadmaps, selectRoadmap } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();

  const t = translations[language]?.dashboard || translations.en.dashboard;
  const userName = user?.name || (language === 'hi' ? 'छात्र' : 'Student');

  // Phase 1: sidebar-driven section state (replaces the old 2-tab toggle).
  // 'roadmap' | 'practice' | 'progress' | 'review'. Practice/Progress are
  // placeholder panels until Phases 6/4 fill them in.
  const [activeSection, setActiveSection] = useState('roadmap');
  const [gateNotice, setGateNotice] = useState('');
  const [localDays, setLocalDays] = useState(activeRoadmap?.days || []);
  const [translating, setTranslating] = useState(false);
  const [hindiData, setHindiData] = useState(activeRoadmap?.translatedHindiDays || []);

  const diagnosticData = activeRoadmap?.diagnosticResultId;

  // Auto refresh roadmap if not set on dashboard mount
  useEffect(() => {
    if (!activeRoadmap) {
      refreshRoadmap();
    } else {
      setLocalDays(activeRoadmap.days || []);
      setHindiData(activeRoadmap.translatedHindiDays || []);
    }
  }, [activeRoadmap, refreshRoadmap]);

  // Handle Sarvam translate when language switches to Hindi for Roadmap Days
  useEffect(() => {
    if (language === 'hi' && activeRoadmap && (!hindiData || hindiData.length === 0) && !translating) {
      setTranslating(true);
      authFetch(`/roadmap/${activeRoadmap._id}/translate`, { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          if (data.roadmap) {
            setActiveRoadmap(data.roadmap);
            setHindiData(data.roadmap.translatedHindiDays || []);
          }
        })
        .catch((err) => console.warn('Roadmap translation error:', err))
        .finally(() => setTranslating(false));
    }
  }, [language, activeRoadmap, hindiData, translating, authFetch, setActiveRoadmap]);

  // Handle Sarvam translate when language switches to Hindi for Dashboard Diagnostic Review tab
  useEffect(() => {
    if (language === 'hi' && diagnosticData?._id && (!diagnosticData.translatedHindiQuestions || diagnosticData.translatedHindiQuestions.length === 0)) {
      authFetch(`/diagnostic/${diagnosticData._id}/translate`, { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          if (data.translatedHindiQuestions) {
            setActiveRoadmap((prev) => ({
              ...prev,
              diagnosticResultId: data
            }));
          }
        })
        .catch((err) => console.warn('Dashboard diagnostic translation error:', err));
    }
  }, [language, diagnosticData, authFetch, setActiveRoadmap]);

  // Auto-fetch full diagnostic result if diagnosticResultId is stored as a string ID
  useEffect(() => {
    if (activeRoadmap?.diagnosticResultId && typeof activeRoadmap.diagnosticResultId === 'string') {
      authFetch(`/diagnostic/${activeRoadmap.diagnosticResultId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data._id) {
            setActiveRoadmap((prev) => ({
              ...prev,
              diagnosticResultId: data
            }));
          }
        })
        .catch((err) => console.warn('Failed to populate diagnosticResultId:', err));
    }
  }, [activeRoadmap?.diagnosticResultId, authFetch, setActiveRoadmap]);

  if (!activeRoadmap) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card" style={{ textAlign: 'center' }}>
          <h2>{t.noRoadmapFound}</h2>
          <p className="onboarding-subtitle">{t.noRoadmapSubtitle}</p>
          <button className="primary-button" onClick={() => navigate('/onboarding')}>
            {t.startDiagnostic}
          </button>
        </div>
      </div>
    );
  }

  const completedCount = localDays.filter((d) => d.completed).length;
  const progressPercent = Math.round((completedCount / activeRoadmap.totalDays) * 100);
  // Phase 9: first not-fully-complete day (completed = video watched + quiz passed).
  // Per-subject automatically — localDays is the selected roadmap's days.
  const nextDayIdx = localDays.findIndex((d) => !d.completed);
  const nextDay = nextDayIdx >= 0 ? localDays[nextDayIdx] : null;
  // Phase 2: video completion is a distinct signal from days completed. OR logic —
  // a day counts if ANY of its videos is watched. Falls back to the legacy scalar
  // `videoWatched` so days not yet migrated still register.
  const videosWatchedCount = localDays.filter(
    (d) => (Array.isArray(d?.videoProgress) && d.videoProgress.some((v) => v?.watched)) || d?.videoWatched
  ).length;
  const videoPercent = activeRoadmap.totalDays > 0
    ? Math.round((videosWatchedCount / activeRoadmap.totalDays) * 100)
    : 0;

  const toggleDayCompletion = async (dayNumber, currentCompleted) => {
    const nextState = !currentCompleted;
    setGateNotice('');
    setLocalDays((prev) =>
      prev.map((d) => (d.dayNumber === dayNumber ? { ...d, completed: nextState } : d))
    );

    const revert = () => setLocalDays((prev) =>
      prev.map((d) => (d.dayNumber === dayNumber ? { ...d, completed: currentCompleted } : d))
    );

    try {
      const res = await authFetch(`/roadmap/${activeRoadmap._id}/day/${dayNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: nextState })
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRoadmap(data.roadmap);
      } else if (res.status === 409) {
        // Phase 3 completion gate — revert and tell the student what's needed.
        revert();
        const data = await res.json().catch(() => ({}));
        setGateNotice(data.message || t.completionGate || 'Complete the day’s quiz to mark it done.');
      } else {
        revert();
      }
    } catch (err) {
      console.warn('Failed to update day completion:', err);
      revert();
    }
  };

  const displayRec = (language === 'hi' && diagnosticData?.translatedHindiRecommendation)
    ? diagnosticData.translatedHindiRecommendation
    : diagnosticData?.recommendation;

  const nextTopic = nextDay
    ? ((language === 'hi' && hindiData?.[nextDayIdx]?.topic) ? hindiData[nextDayIdx].topic : nextDay.topic)
    : null;

  return (
    <div className="dashboard-bg">
      <div className="dashboard-card">
      <DashboardSidebar
        activeSection={activeSection}
        onSelect={(key) => (key === 'mentor' ? navigate('/mentor') : setActiveSection(key))}
        t={t}
      />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.45rem', fontWeight: '800', color: '#2F6B3A' }}>
              {typeof t.greeting === 'function' ? t.greeting(userName) : `Hello, ${userName}`}
              {' '}<span className="wave-emoji" role="img" aria-label="waving hand">👋</span>
            </h3>
            <p className="dashboard-welcome">{t.welcomeSubtitle}</p>
            {/* Subject + tailored-schedule line belong to the roadmap view only —
                they'd be out of place on Practice / Progress / Review / Settings. */}
            {activeSection === 'roadmap' && (
              <>
                <h2>{formatGradeSubjectDash(activeRoadmap.grade, activeRoadmap.subject, language)}</h2>
                <p className="dashboard-subtitle">
                  {t.tailoredScheduleSubtitle}
                </p>
              </>
            )}
          </div>
          {activeSection === 'roadmap' && (
            <button
              className="ghost-button"
              onClick={() => navigate('/onboarding')}
              title={t.retakeTest}
            >
              <RefreshCw size={16} /> {t.retakeTest}
            </button>
          )}
        </header>

        {/* ROADMAP SECTION CONTENT — redesigned two-column overview */}
        {activeSection === 'roadmap' && (
          <>
          <div className="overview-grid">
            <div className="overview-left">
              {/* Subject rings — one per active roadmap; click to switch subject */}
              <SubjectRings
                roadmaps={roadmaps}
                activeRoadmapId={activeRoadmap._id}
                onSelect={selectRoadmap}
              />
            {/* Progress Banner (selected subject detail) */}
            <div className="dashboard-progress-card">
              <div className="progress-info-row">
                <div>
                  <h3><Trophy size={20} className="trophy-icon" /> {t.yourRoadmapProgress}</h3>
                  <p>{typeof t.daysCompleted === 'function' ? t.daysCompleted(completedCount, activeRoadmap.totalDays) : `${completedCount} of ${activeRoadmap.totalDays} days completed`}</p>
                </div>
                <span className="progress-percent-badge">{progressPercent}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%`, transition: 'width 0.4s ease' }}
                ></div>
              </div>

              {/* Phase 2: secondary video-completion stat (separate from days completed) */}
              <div className="progress-secondary-row">
                <span className="progress-secondary-label">
                  {typeof t.videosWatchedStat === 'function'
                    ? t.videosWatchedStat(videosWatchedCount, activeRoadmap.totalDays)
                    : `${videosWatchedCount} of ${activeRoadmap.totalDays} videos watched`}
                </span>
                <span className="progress-secondary-value">{videoPercent}%</span>
              </div>
            </div>

            {gateNotice && (
              <div className="completion-gate-notice">{gateNotice}</div>
            )}

            {translating && (
              <div className="translation-notice">
                {t.translatingRoadmap}
              </div>
            )}

            {/* Day Cards Stack */}
            <div className="roadmap-days-stack">
              {localDays.map((day, idx) => {
                const hindiItem = hindiData?.[idx];
                const displayTopic = (language === 'hi' && hindiItem?.topic) ? hindiItem.topic : day.topic;
                const displayFocus = (language === 'hi' && hindiItem?.focus) ? hindiItem.focus : day.focus;

                return (
                  <div
                    key={day.dayNumber}
                    className={`roadmap-day-card ${day.completed ? 'completed' : ''}`}
                    onClick={() => navigate(`/roadmap/${activeRoadmap._id}/day/${day.dayNumber}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <button
                      type="button"
                      className="day-check-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDayCompletion(day.dayNumber, day.completed);
                      }}
                      aria-label={`Mark Day ${day.dayNumber} as completed`}
                    >
                      {day.completed ? (
                        <CheckSquare size={24} className="check-icon-active" />
                      ) : (
                        <Square size={24} className="check-icon-idle" />
                      )}
                    </button>

                    <div className="day-card-content">
                      <div className="day-card-top">
                        <span className="day-pill">{typeof t.day === 'function' ? t.day(day.dayNumber) : `Day ${day.dayNumber}`}</span>
                        {day.isRemediation && (
                          <span className="remediation-badge"><Sparkles size={12} /> {t.remediationBadge}</span>
                        )}
                        <span className="day-time">
                          <Clock size={14} /> {typeof t.mins === 'function' ? t.mins(day.estimatedMinutes || 30) : `${day.estimatedMinutes || 30} mins`}
                        </span>
                        {day.moduleQuizAttempt?.attempted && (
                          <span className={`day-quiz-score ${day.moduleQuizAttempt.passed ? 'passed' : 'failed'}`}>
                            {day.moduleQuizAttempt.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {day.moduleQuizAttempt.score}/{day.moduleQuizAttempt.total}
                          </span>
                        )}
                      </div>

                      <h4>{displayTopic}</h4>
                      <p>{displayFocus}</p>

                      {day.resourceLink && (
                        <button
                          type="button"
                          className="resource-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/courses/${day.resourceLink}`);
                          }}
                        >
                          {t.viewYoutubeResource} <ExternalLink size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>{/* /overview-left */}

            <DashboardStatCards
              userName={userName}
              subjectLabel={formatGradeSubjectDash(activeRoadmap.grade, activeRoadmap.subject, language)}
              nextDay={nextDay ? { dayNumber: nextDay.dayNumber, topic: nextTopic } : null}
              onContinue={() => nextDay && navigate(`/roadmap/${activeRoadmap._id}/day/${nextDay.dayNumber}`)}
            />
          </div>
          </>
        )}

        {/* SETTINGS — Phase 7: account settings (edit profile + parent login) */}
        {activeSection === 'settings' && (
          <div className="settings-section">
            <h2 className="settings-heading">{t.settingsHeading}</h2>
            <button type="button" className="settings-row" onClick={() => navigate('/profile')}>
              <span className="settings-row-icon"><UserCog size={20} /></span>
              <span className="settings-row-text">
                <span className="settings-row-title">{t.editProfile}</span>
                <span className="settings-row-sub">{t.editProfileSub}</span>
              </span>
              <ExternalLink size={16} className="settings-row-arrow" />
            </button>

            <h3 className="settings-subheading">{t.parentLoginHeading}</h3>
            <ParentAccessCard />
          </div>
        )}

        {/* PRACTICE MODE — Phase 6 */}
        {activeSection === 'practice' && (
          <PracticeMode roadmaps={roadmaps} defaultRoadmap={activeRoadmap} />
        )}

        {/* PROGRESS / WEAK TOPICS — Phase 4 */}
        {activeSection === 'progress' && (
          <ProgressWeakTopics roadmapId={activeRoadmap._id} />
        )}

        {/* DIAGNOSTIC REVIEW SECTION CONTENT */}
        {activeSection === 'review' && (
          <div className="dashboard-review-tab">
            {diagnosticData && typeof diagnosticData === 'object' ? (
              <>
                <div className="review-header-card" style={{ marginTop: 0 }}>
                  <div className="review-score-badge">
                    <Trophy size={28} className="trophy-icon" />
                    <div>
                      <span className="score-number">{diagnosticData.score} / {diagnosticData.totalQuestions}</span>
                      <span className="score-label">{typeof t.score === 'function' ? t.score(Math.round((diagnosticData.score / diagnosticData.totalQuestions) * 100)) : `Score (${Math.round((diagnosticData.score / diagnosticData.totalQuestions) * 100)}%)`}</span>
                    </div>
                  </div>
                  <div>
                    <h3>{t.diagnosticAssessmentResults}</h3>
                    <p>{formatGradeSubject(diagnosticData.grade, diagnosticData.subject, language)}</p>
                  </div>
                </div>

                {diagnosticData.corrupted && (
                  <div className="onboarding-card" style={{ background: '#FFF4E5', borderColor: '#E07A3E', marginTop: '1rem' }}>
                    <h4 style={{ color: '#E07A3E', marginTop: 0 }}>⚠️ Diagnostic Assessment Notice</h4>
                    <p style={{ margin: '0.5rem 0 0 0', color: '#6B6357' }}>
                      This legacy test result was scored using an unvalidated session key. We recommend retaking your diagnostic test for an accurate score and roadmap.
                    </p>
                  </div>
                )}

                {displayRec && (
                  <div className="recommendation-card">
                    <Sparkles size={20} className="sparkle-icon" />
                    <div>
                      <h4>{t.aiRecommendation}</h4>
                      <p>{displayRec}</p>
                    </div>
                  </div>
                )}

                {diagnosticData.questions && (
                  <div className="questions-review-stack">
                    <h3>{t.questionBreakdown}</h3>
                    {diagnosticData.questions.map((q, idx) => {
                      const hindiQ = diagnosticData.translatedHindiQuestions?.[idx];
                      const useHindi = language === 'hi' && hindiQ;
                      const displayStem = useHindi && hindiQ.questionText ? hindiQ.questionText : q.questionText;
                      const displayOptions = useHindi && hindiQ.options && hindiQ.options.length > 0 ? hindiQ.options : q.options;
                      const displayExp = useHindi && hindiQ.explanation ? hindiQ.explanation : q.explanation;

                      return (
                        <div
                          key={idx}
                          className={`review-question-card ${q.isCorrect ? 'correct' : 'incorrect'}`}
                        >
                          <div className="q-review-top">
                            <span className="q-number-pill">{typeof t.question === 'function' ? t.question(idx + 1) : `Question ${idx + 1}`}</span>
                            <span className={`q-status-badge ${q.isCorrect ? 'correct' : 'incorrect'}`}>
                              {q.isCorrect ? (
                                <><CheckCircle2 size={14} /> {t.correct}</>
                              ) : (
                                <><XCircle size={14} /> {t.incorrect}</>
                              )}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
                            <h4 style={{ margin: 0 }}>{displayStem}</h4>
                            <SpeakerButton
                              audioEndpoint={`/diagnostic/${diagnosticData._id}/question/${idx}/audio?lang=${language}`}
                              size={16}
                            />
                          </div>

                          <div className="q-options-review">
                            {displayOptions.map((optStr, optIdx) => {
                              const isUserChoice = q.selectedIndex === optIdx;
                              const isCorrectChoice = q.correctIndex === optIdx;
                              let optClass = 'opt-neutral';
                              if (isUserChoice && q.isCorrect) optClass = 'opt-correct';
                              if (isUserChoice && !q.isCorrect) optClass = 'opt-wrong';
                              if (!q.isCorrect && isCorrectChoice) optClass = 'opt-correct-answer';

                              return (
                                <div key={optIdx} className={`review-opt-pill ${optClass}`}>
                                  <span className="opt-index">{String.fromCharCode(65 + optIdx)}</span>
                                  <span className="opt-text">{optStr}</span>
                                  {isUserChoice && <span className="tag-user">{t.yourAnswer}</span>}
                                  {isCorrectChoice && !q.isCorrect && <span className="tag-correct">{t.correctAnswer}</span>}
                                </div>
                              );
                            })}
                          </div>

                          {displayExp && (
                            <div className="q-explanation-box">
                              <div style={{ flex: 1 }}>
                                <strong>{t.explanation}</strong> {displayExp}
                              </div>
                              <SpeakerButton
                                fetchPayload={{ questionText: `${language === 'hi' ? 'व्याख्या' : 'Explanation'}: ${displayExp}`, options: [], language }}
                                size={15}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="onboarding-card" style={{ textAlign: 'center', marginTop: '1rem' }}>
                <h3>{t.noReviewAvailable}</h3>
                <p className="onboarding-subtitle">
                  {t.noReviewSubtitle}
                </p>
                <button className="primary-button" onClick={() => navigate('/onboarding')}>
                  {t.retakeDiagnosticTest}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      </div>{/* /dashboard-card */}
    </div>
  );
}
