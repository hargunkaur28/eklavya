import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { ClipboardCheck, CheckCircle2, XCircle, Loader2, RefreshCw, Sparkles, ArrowLeft } from 'lucide-react';
import SpeakerButton from './SpeakerButton.jsx';
import { getLocalDate } from '../utils/streak.js';
import { WrittenInput, WrittenReview, isWrittenAnswered } from './WrittenQuestion.jsx';

// Phase 3 + result-visibility fix: per-day module quiz. Questions are generated
// + cached server-side; this component presents them, submits answers, shows the
// scored review, AND persistently surfaces the last attempt on revisit (reading
// the already-stored moduleQuizAttempt — the same data Phase 4 aggregates).
export default function ModuleQuiz({ roadmapId, dayNumber, onDayCompleted, onRoadmapChanged }) {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.quiz || translations.en.quiz;

  const [status, setStatus] = useState('init'); // init|idle|summary|loading|active|submitting|result|reviewing|unavailable
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);      // post-submit result
  const [lastResult, setLastResult] = useState(null); // persisted last attempt
  const [passThreshold, setPassThreshold] = useState(0.7);

  const thresholdPct = Math.round(passThreshold * 100);

  // On mount / language change: load any previously-stored attempt.
  useEffect(() => {
    let active = true;
    authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/quiz/result?lang=${language}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.attempted) {
          setLastResult(d);
          setPassThreshold(d.passThreshold || 0.7);
          setStatus((s) => (s === 'init' ? 'summary' : s));
        } else {
          setStatus((s) => (s === 'init' ? 'idle' : s));
        }
      })
      .catch(() => { if (active) setStatus((s) => (s === 'init' ? 'idle' : s)); });
    return () => { active = false; };
  }, [authFetch, roadmapId, dayNumber, language]);

  const startQuiz = useCallback(async () => {
    setStatus('loading');
    setResult(null);
    setAnswers({});
    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/quiz?lang=${language}`);
      const data = await res.json();
      if (!res.ok || data.available === false) { setStatus('unavailable'); return; }
      setQuestions(data.questions || []);
      setPassThreshold(data.passThreshold || 0.7);
      setStatus('active');
    } catch {
      setStatus('unavailable');
    }
  }, [authFetch, roadmapId, dayNumber, language]);

  const allAnswered = questions.length > 0 && questions.every((q, i) =>
    q.type === 'written' ? isWrittenAnswered(answers[i]) : answers[i] !== undefined);

  const submitQuiz = useCallback(async () => {
    if (!allAnswered) return;
    setStatus('submitting');
    const payload = questions.map((q, i) => q.type === 'written'
      ? { writtenAnswer: answers[i] }
      : { selectedIndex: answers[i] });
    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/quiz/submit?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ answers: payload, localDate: getLocalDate() })
      });
      const data = await res.json();
      if (!res.ok) { setStatus('active'); return; }
      setResult(data);
      setLastResult(data); // keep the persisted summary in sync
      setStatus('result');
      if (data.dayCompleted && onDayCompleted) onDayCompleted();
      if (data.remediationInserted && onRoadmapChanged) onRoadmapChanged();
    } catch {
      setStatus('active');
    }
  }, [allAnswered, questions, answers, authFetch, roadmapId, dayNumber, onDayCompleted, onRoadmapChanged, language]);

  // ── Shared: result banner + per-question review (used post-submit AND on revisit) ──
  const renderBanner = (data, showRemediation) => {
    const pct = data.total > 0 ? Math.round((data.score / data.total) * 100) : 0;
    return (
      <>
        <div className={`quiz-result-banner ${data.passed ? 'passed' : 'failed'}`}>
          <div className="quiz-result-score">
            <span className="quiz-result-num">{data.score} / {data.total}</span>
            <span className="quiz-result-pct">{pct}%</span>
          </div>
          <div className="quiz-result-status">
            {data.passed
              ? <span className="quiz-status-pill passed"><CheckCircle2 size={16} /> {t.passed}</span>
              : <span className="quiz-status-pill failed"><XCircle size={16} /> {t.failed}</span>}
            <p>
              {data.passed
                ? (data.dayCompleted ? t.dayCompleted : t.passedNeedVideo)
                : (typeof t.failedRetry === 'function' ? t.failedRetry(Math.round((data.passThreshold || passThreshold) * 100)) : '')}
            </p>
            {typeof data.attemptCount === 'number' && (
              <span className="quiz-attempts">{typeof t.attemptCountLabel === 'function' ? t.attemptCountLabel(data.attemptCount) : ''}</span>
            )}
          </div>
        </div>
        {showRemediation && data.remediationInserted && (
          <div className="quiz-remediation-notice">
            <Sparkles size={16} />
            <span>{typeof t.remediationAdded === 'function' ? t.remediationAdded(data.remediationInserted.dayNumber, data.remediationInserted.topic) : ''}</span>
          </div>
        )}
      </>
    );
  };

  const renderReview = (data) => (
    <>
      <h4 className="quiz-review-heading">{t.reviewHeading}</h4>
      <div className="quiz-questions">
        {data.questions.map((q, qi) => (
          <div key={qi} className={`quiz-question reviewed ${q.type === 'written' ? (q.isCorrect ? 'correct' : 'below') : (q.isCorrect ? 'correct' : 'incorrect')}`}>
            <div className="quiz-q-row">
              <h4 className="quiz-q-text">
                {q.type === 'written' && <span className="quiz-written-badge">{t.writtenBadge}</span>}
                {q.questionText}
              </h4>
              <SpeakerButton audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/quiz/question/${qi}/audio?lang=${language}`} size={16} />
            </div>
            {q.type === 'written' ? (
              <WrittenReview
                answer={q.writtenAnswer}
                isCorrect={q.isCorrect}
                overall={q.overall}
                threshold={q.threshold}
                scores={q.scores}
                feedback={q.feedback}
                expectedPoints={q.expectedPoints}
                language={language}
                labels={{ reached: t.reachedThreshold, below: t.belowThreshold, thresholdLabel: t.thresholdLabel, yourAnswer: t.yourWrittenAnswer }}
              />
            ) : (
              <div className="quiz-options">
                {q.options.map((opt, oi) => {
                  const isSel = q.selectedIndex === oi;
                  const isCorrect = q.correctIndex === oi;
                  let cls = 'quiz-review-opt';
                  if (isCorrect) cls += ' opt-correct';
                  else if (isSel && !q.isCorrect) cls += ' opt-wrong';
                  return (
                    <div key={oi} className={cls}>
                      <span className="quiz-opt-letter">{String.fromCharCode(65 + oi)}</span>
                      <span>{opt}</span>
                      {isSel && <span className="quiz-tag">{t.yourAnswer}</span>}
                      {isCorrect && !q.isCorrect && <span className="quiz-tag correct">{t.correctAnswer}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {q.explanation && <p className="quiz-explanation"><strong>{t.explanation}</strong> {q.explanation}</p>}
          </div>
        ))}
      </div>
    </>
  );

  // ── init (loading the stored attempt) ──
  if (status === 'init') {
    return <section className="module-quiz-card"><div className="weak-loading"><Loader2 size={20} className="animate-spin" /></div></section>;
  }

  // ── Never attempted: entry card ──
  if (status === 'idle' || status === 'loading' || status === 'unavailable') {
    return (
      <section className="module-quiz-card">
        <div className="quiz-head">
          <ClipboardCheck size={22} className="quiz-head-icon" />
          <div>
            <h3>{t.title}</h3>
            <p>{typeof t.intro === 'function' ? t.intro(thresholdPct) : t.intro}</p>
          </div>
        </div>
        {status === 'unavailable' && <p className="quiz-unavailable">{t.unavailable}</p>}
        <button type="button" className="primary-button quiz-start-btn" onClick={startQuiz} disabled={status === 'loading'}>
          {status === 'loading'
            ? <><Loader2 size={16} className="animate-spin" /> {t.loading}</>
            : status === 'unavailable' ? <><RefreshCw size={16} /> {t.retry}</> : t.start}
        </button>
      </section>
    );
  }

  // ── Attempted before: persistent summary ──
  if (status === 'summary' && lastResult) {
    return (
      <section className="module-quiz-card">
        <div className="quiz-head">
          <ClipboardCheck size={22} className="quiz-head-icon" />
          <div><h3>{t.title}</h3><p>{t.lastResultHeading}</p></div>
        </div>
        {renderBanner(lastResult, false)}
        <div className="practice-result-actions">
          {(lastResult.questions?.length > 0) && (
            <button type="button" className="primary-button quiz-submit-btn" onClick={() => setStatus('reviewing')}>
              {t.viewReview}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={startQuiz}>
            <RefreshCw size={16} /> {t.retake}
          </button>
        </div>
      </section>
    );
  }

  // ── Viewing a past attempt's full review ──
  if (status === 'reviewing' && lastResult) {
    return (
      <section className="module-quiz-card">
        <button type="button" className="ghost-button" style={{ marginBottom: '1rem' }} onClick={() => setStatus('summary')}>
          <ArrowLeft size={16} /> {t.backToSummary}
        </button>
        {renderBanner(lastResult, false)}
        {renderReview(lastResult)}
        <div className="practice-result-actions">
          <button type="button" className="primary-button quiz-submit-btn" onClick={startQuiz}>
            <RefreshCw size={16} /> {t.retake}
          </button>
        </div>
      </section>
    );
  }

  // ── Active quiz ──
  if (status === 'active' || status === 'submitting') {
    return (
      <section className="module-quiz-card">
        <div className="quiz-head">
          <ClipboardCheck size={22} className="quiz-head-icon" />
          <h3>{t.title}</h3>
        </div>
        <div className="quiz-questions">
          {questions.map((q, qi) => (
            <div key={qi} className="quiz-question">
              <p className="quiz-q-number">
                {typeof t.questionOf === 'function' ? t.questionOf(qi + 1, questions.length) : `${qi + 1}`}
                {q.type === 'written' && <span className="quiz-written-badge">{t.writtenBadge}</span>}
              </p>
              <div className="quiz-q-row">
                <h4 className="quiz-q-text">{q.questionText}</h4>
                <SpeakerButton audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/quiz/question/${qi}/audio?lang=${language}`} size={16} />
              </div>
              {q.type === 'written' ? (
                <WrittenInput
                  value={answers[qi]}
                  onChange={(val) => setAnswers((p) => ({ ...p, [qi]: val }))}
                  placeholder={t.writtenPlaceholder}
                  disabled={status === 'submitting'}
                />
              ) : (
                <div className="quiz-options">
                  {q.options.map((opt, oi) => (
                    <button key={oi} type="button" className={`quiz-option ${answers[qi] === oi ? 'selected' : ''}`} onClick={() => setAnswers((p) => ({ ...p, [qi]: oi }))}>
                      <span className="quiz-opt-letter">{String.fromCharCode(65 + oi)}</span>
                      <span>{opt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {!allAnswered && <p className="quiz-hint">{t.answerAll}</p>}
        <button type="button" className="primary-button quiz-submit-btn" onClick={submitQuiz} disabled={!allAnswered || status === 'submitting'}>
          {status === 'submitting' ? <><Loader2 size={16} className="animate-spin" /> {t.submitting}</> : t.submit}
        </button>
      </section>
    );
  }

  // ── Just submitted ──
  return (
    <section className="module-quiz-card">
      {renderBanner(result, true)}
      {renderReview(result)}
      <div className="practice-result-actions">
        {!result.passed && (
          <button type="button" className="primary-button quiz-submit-btn" onClick={startQuiz}>
            <RefreshCw size={16} /> {t.retake}
          </button>
        )}
        <button type="button" className="ghost-button" onClick={() => setStatus('summary')}>
          {t.backToSummary}
        </button>
      </div>
    </section>
  );
}
