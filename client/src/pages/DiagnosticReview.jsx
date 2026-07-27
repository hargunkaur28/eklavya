import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubject } from '../utils/subjectTranslations.js';
import { getTranslatedTopic } from '../utils/topicTranslations.js';
import { CheckCircle2, XCircle, Trophy, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import SpeakerButton from '../components/SpeakerButton.jsx';
import { WrittenReview } from '../components/WrittenQuestion.jsx';

export default function DiagnosticReview() {
  const { id } = useParams();
  const { authFetch, refreshRoadmap } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const t = translations[language]?.review || translations.en.review;
  const tDash = translations[language]?.dashboard || translations.en.dashboard;

  const [result, setResult] = useState(location.state?.result || null);
  const [loading, setLoading] = useState(!location.state?.result);
  const [error, setError] = useState('');
  const [generatingRoadmap, setGeneratingRoadmap] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [hindiQuestions, setHindiQuestions] = useState(location.state?.result?.translatedHindiQuestions || []);
  const [hindiRec, setHindiRec] = useState(location.state?.result?.translatedHindiRecommendation || '');

  // Fetch Diagnostic Result by ID if not passed in location state or when ID changes
  useEffect(() => {
    if (id && (!result || result._id !== id)) {
      setLoading(true);
      authFetch(`/diagnostic/${id}`)
        .then((res) => {
          if (!res.ok) throw new Error(t.notFound);
          return res.json();
        })
        .then((data) => {
          setResult(data);
          if (data.translatedHindiQuestions && data.translatedHindiQuestions.length > 0) {
            setHindiQuestions(data.translatedHindiQuestions);
          }
          if (data.translatedHindiRecommendation) {
            setHindiRec(data.translatedHindiRecommendation);
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [id, result?._id, authFetch, t.notFound]);

  // Handle Sarvam Translation when language switches to Hindi
  useEffect(() => {
    if (language === 'hi' && result?._id && (!hindiQuestions || hindiQuestions.length === 0 || !hindiRec) && !translating) {
      setTranslating(true);
      authFetch(`/diagnostic/${result._id}/translate`, { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          if (data.translatedHindiQuestions) {
            setHindiQuestions(data.translatedHindiQuestions);
            setHindiRec(data.translatedHindiRecommendation);
            setResult(data);
          }
        })
        .catch((err) => console.warn('Diagnostic translation error:', err))
        .finally(() => setTranslating(false));
    }
  }, [language, result, result?._id, hindiQuestions, hindiRec, translating, authFetch]);

  const handleGenerateRoadmap = async () => {
    setGeneratingRoadmap(true);
    try {
      const res = await authFetch('/roadmap/generate', {
        method: 'POST',
        body: JSON.stringify({ diagnosticResultId: result._id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate roadmap');

      await refreshRoadmap();
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Error generating roadmap');
    } finally {
      setGeneratingRoadmap(false);
    }
  };

  if (loading) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card" style={{ textAlign: 'center' }}>
          <Loader2 className="animate-spin" size={36} style={{ color: '#2F6B3A' }} />
          <p style={{ marginTop: '1rem', color: '#6B6357' }}>{t.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card" style={{ textAlign: 'center' }}>
          <h2>{t.unavailable}</h2>
          <p className="onboarding-subtitle">{error || t.notFound}</p>
          <button className="primary-button" onClick={() => navigate('/onboarding')}>
            {t.returnToOnboarding}
          </button>
        </div>
      </div>
    );
  }

  const percentage = Math.round((result.score / result.totalQuestions) * 100);
  const displayRec = (language === 'hi' && (result?.translatedHindiRecommendation || hindiRec))
    ? (result?.translatedHindiRecommendation || hindiRec)
    : result.recommendation;

  // Group topics for Topic Strength bars
  const topicAccuracyMap = {};
  result.questions.forEach((q) => {
    if (!topicAccuracyMap[q.topic]) {
      topicAccuracyMap[q.topic] = { correct: 0, total: 0 };
    }
    topicAccuracyMap[q.topic].total += 1;
    if (q.isCorrect) topicAccuracyMap[q.topic].correct += 1;
  });

  const activeHindiQuestions = (result?.translatedHindiQuestions?.length > 0 ? result.translatedHindiQuestions : hindiQuestions);

  return (
    <div className="review-page">
      <div className="review-container">
        {/* Header Banner */}
        <header className="review-header-card">
          <div className="review-score-badge">
            <Trophy size={28} className="trophy-icon" />
            <div>
              <span className="score-number">{result.score} / {result.totalQuestions}</span>
              <span className="score-label">{typeof tDash.score === 'function' ? tDash.score(percentage) : `Score (${percentage}%)`}</span>
            </div>
          </div>
          <div>
            <h2>{t.testReview}</h2>
            <p>{formatGradeSubject(result.grade, result.subject, language, result.subSubject)} {t.assessment}</p>
          </div>
        </header>

        {result.corrupted && (
          <div className="onboarding-card" style={{ background: '#FFF4E5', borderColor: '#E07A3E', marginTop: '1rem' }}>
            <h4 style={{ color: '#E07A3E', marginTop: 0 }}>⚠️ Diagnostic Assessment Notice</h4>
            <p style={{ margin: '0.5rem 0 0 0', color: '#6B6357' }}>
              This legacy test result was scored using an unvalidated session key. We recommend retaking your diagnostic test for an accurate score and roadmap.
            </p>
          </div>
        )}

        {/* Recommendation Box */}
        {displayRec && (
          <div className="recommendation-card">
            <Sparkles size={20} className="sparkle-icon" />
            <div>
              <h4>{tDash.aiRecommendation}</h4>
              <p>{displayRec}</p>
            </div>
          </div>
        )}

        {translating && (
          <div className="translation-notice">
            {t.translatingBreakdown}
          </div>
        )}

        {/* Topic Strength Bars */}
        <div className="topic-strength-card">
          <h3>{t.topicStrengthBreakdown}</h3>
          <div className="topic-bars-grid">
            {Object.keys(topicAccuracyMap).map((topKey) => {
              const acc = Math.round((topicAccuracyMap[topKey].correct / topicAccuracyMap[topKey].total) * 100);
              let barColor = '#E07A3E'; // neutral orange
              if (acc >= 75) barColor = '#2F6B3A'; // green strong
              if (acc < 50) barColor = '#E53935'; // red weak

              return (
                <div key={topKey} className="topic-bar-row">
                  <div className="topic-bar-header">
                    <span>{getTranslatedTopic(topKey, language)}</span>
                    <span>{acc}%</span>
                  </div>
                  <div className="topic-bar-bg">
                    <div
                      className="topic-bar-fill"
                      style={{ width: `${acc}%`, background: barColor }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Questions Breakdown List */}
        <div className="questions-review-stack">
          <h3>{t.detailedAnalysis}</h3>
          {result.questions.map((q, idx) => {
            const hindiQ = activeHindiQuestions?.[idx];

            const useHindi = language === 'hi' && hindiQ;
            const displayStem = useHindi && hindiQ.questionText ? hindiQ.questionText : q.questionText;
            const displayOptions = useHindi && hindiQ.options && hindiQ.options.length > 0 ? hindiQ.options : q.options;
            const displayExp = useHindi && hindiQ.explanation ? hindiQ.explanation : q.explanation;

            const isWritten = q.type === 'written';

            return (
              <div
                key={idx}
                className={`review-question-card ${isWritten ? (q.isCorrect ? 'correct' : 'below') : (q.isCorrect ? 'correct' : 'incorrect')}`}
              >
                <div className="q-review-top">
                  <span className="q-number-pill">{typeof tDash.question === 'function' ? tDash.question(idx + 1) : `Question ${idx + 1}`}</span>
                  {isWritten ? (
                    <span className={`q-status-badge ${q.isCorrect ? 'correct' : 'below'}`}>
                      {q.isCorrect ? t.reachedThreshold : t.belowThreshold}
                    </span>
                  ) : (
                    <span className={`q-status-badge ${q.isCorrect ? 'correct' : 'incorrect'}`}>
                      {q.isCorrect ? (
                        <><CheckCircle2 size={14} /> {tDash.correct}</>
                      ) : (
                        <><XCircle size={14} /> {tDash.incorrect}</>
                      )}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0 }}>
                    {isWritten && <span className="quiz-written-badge">{t.writtenBadge}</span>}
                    {displayStem}
                  </h4>
                  <SpeakerButton
                    audioEndpoint={`/diagnostic/${result._id}/question/${idx}/audio?lang=${language}`}
                    subject={result.subject}
                    size={16}
                  />
                </div>

                {isWritten ? (
                  <WrittenReview
                    answer={q.writtenAnswer}
                    isCorrect={q.isCorrect}
                    overall={q.writtenOverall}
                    scores={q.writtenScores}
                    feedback={q.writtenFeedback}
                    expectedPoints={q.expectedPoints}
                    language={language}
                    showStatus={false}
                    labels={{ reached: t.reachedThreshold, below: t.belowThreshold, thresholdLabel: t.thresholdLabel, yourAnswer: t.yourWrittenAnswer }}
                  />
                ) : (
                  <div className="q-options-review">
                    {(displayOptions || []).map((optStr, optIdx) => {
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
                          {isUserChoice && <span className="tag-user">{tDash.yourAnswer}</span>}
                          {isCorrectChoice && !q.isCorrect && <span className="tag-correct">{tDash.correctAnswer}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {displayExp && (
                  <div className="q-explanation-box">
                    <div style={{ flex: 1 }}>
                      <strong>{tDash.explanation}</strong> {displayExp}
                    </div>
                    <SpeakerButton
                      fetchPayload={{ questionText: `${language === 'hi' ? 'व्याख्या' : 'Explanation'}: ${displayExp}`, options: [], language }}
                      subject={result.subject}
                      size={15}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Generate Roadmap Action Footer */}
        <div className="review-action-footer">
          <button
            type="button"
            className="primary-button large"
            onClick={handleGenerateRoadmap}
            disabled={generatingRoadmap}
          >
            {generatingRoadmap ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {t.generatingRoadmap}
              </>
            ) : (
              <>
                {t.generateMyRoadmap} <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
