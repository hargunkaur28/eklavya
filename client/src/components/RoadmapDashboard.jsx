import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubject, formatGradeSubjectDash } from '../utils/subjectTranslations.js';
import { getTranslatedTopic } from '../utils/topicTranslations.js';
import { CheckSquare, Square, Clock, ExternalLink, RefreshCw, Trophy, BookOpen, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SpeakerButton from './SpeakerButton.jsx';

export default function RoadmapDashboard() {
  const { activeRoadmap, setActiveRoadmap, authFetch, refreshRoadmap, user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();

  const t = translations[language]?.dashboard || translations.en.dashboard;
  const userName = user?.name || (language === 'hi' ? 'छात्र' : 'Student');

  const [activeTab, setActiveTab] = useState('roadmap'); // 'roadmap' or 'review'
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

  const toggleDayCompletion = async (dayNumber, currentCompleted) => {
    const nextState = !currentCompleted;
    setLocalDays((prev) =>
      prev.map((d) => (d.dayNumber === dayNumber ? { ...d, completed: nextState } : d))
    );

    try {
      const res = await authFetch(`/roadmap/${activeRoadmap._id}/day/${dayNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: nextState })
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRoadmap(data.roadmap);
      }
    } catch (err) {
      console.warn('Failed to update day completion:', err);
    }
  };

  const displayRec = (language === 'hi' && diagnosticData?.translatedHindiRecommendation)
    ? diagnosticData.translatedHindiRecommendation
    : diagnosticData?.recommendation;

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.45rem', fontWeight: '800', color: '#2F6B3A' }}>
              {typeof t.greeting === 'function' ? t.greeting(userName) : `Hello, ${userName}`}
            </h3>
            <h2>{formatGradeSubjectDash(activeRoadmap.grade, activeRoadmap.subject, language)}</h2>
            <p className="dashboard-subtitle">
              {t.tailoredScheduleSubtitle}
            </p>
          </div>
          <button
            className="ghost-button"
            onClick={() => navigate('/onboarding')}
            title={t.retakeTest}
          >
            <RefreshCw size={16} /> {t.retakeTest}
          </button>
        </header>

        {/* Tab Toggle Navigation Bar */}
        <div className="dashboard-tabs-bar">
          <button
            className={`dash-tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('roadmap')}
          >
            <BookOpen size={16} /> {t.studyRoadmap}
          </button>
          <button
            className={`dash-tab-btn ${activeTab === 'review' ? 'active' : ''}`}
            onClick={() => setActiveTab('review')}
          >
            <Trophy size={16} /> {t.diagnosticReview}
          </button>
        </div>

        {/* ROADMAP TAB CONTENT */}
        {activeTab === 'roadmap' && (
          <>
            {/* Progress Banner */}
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
            </div>

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
                        <span className="day-time">
                          <Clock size={14} /> {typeof t.mins === 'function' ? t.mins(day.estimatedMinutes || 30) : `${day.estimatedMinutes || 30} mins`}
                        </span>
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
          </>
        )}

        {/* DIAGNOSTIC REVIEW TAB CONTENT */}
        {activeTab === 'review' && (
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
    </div>
  );
}
