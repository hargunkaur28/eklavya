import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { ClipboardCheck, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import SpeakerButton from './SpeakerButton.jsx';

// Phase 3: per-day module quiz. Questions are generated + cached server-side
// (grounded in the day's topic/content); this component only presents them,
// submits answers, and shows the scored review. Passing (>= threshold) with a
// watched video completes the day — the server enforces that gate.
export default function ModuleQuiz({ roadmapId, dayNumber, onDayCompleted }) {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.quiz || translations.en.quiz;

  const [status, setStatus] = useState('idle'); // idle|loading|active|submitting|result|unavailable
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({}); // { [index]: selectedIndex }
  const [result, setResult] = useState(null);
  const [passThreshold, setPassThreshold] = useState(0.7);
  const [previousAttempt, setPreviousAttempt] = useState(null);

  const thresholdPct = Math.round(passThreshold * 100);

  const startQuiz = useCallback(async () => {
    setStatus('loading');
    setResult(null);
    setAnswers({});
    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/quiz?lang=${language}`);
      const data = await res.json();
      if (!res.ok || data.available === false) {
        setStatus('unavailable');
        return;
      }
      setQuestions(data.questions || []);
      setPassThreshold(data.passThreshold || 0.7);
      setPreviousAttempt(data.previousAttempt || null);
      setStatus('active');
    } catch {
      setStatus('unavailable');
    }
  }, [authFetch, roadmapId, dayNumber, language]);

  const selectOption = (qIndex, optIndex) => {
    setAnswers((prev) => ({ ...prev, [qIndex]: optIndex }));
  };

  const allAnswered = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined);

  const submitQuiz = useCallback(async () => {
    if (!allAnswered) return;
    setStatus('submitting');
    const payload = questions.map((_, i) => ({ selectedIndex: answers[i] }));
    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/quiz/submit?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ answers: payload })
      });
      const data = await res.json();
      if (!res.ok) { setStatus('active'); return; }
      setResult(data);
      setStatus('result');
      if (data.dayCompleted && onDayCompleted) onDayCompleted();
    } catch {
      setStatus('active');
    }
  }, [allAnswered, questions, answers, authFetch, roadmapId, dayNumber, onDayCompleted, language]);

  // ── Idle / entry card ──
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

        {previousAttempt && (
          <p className="quiz-prev-attempt">
            {typeof t.lastAttempt === 'function' ? t.lastAttempt(previousAttempt.score, previousAttempt.total) : ''}
          </p>
        )}

        {status === 'unavailable' && (
          <p className="quiz-unavailable">{t.unavailable}</p>
        )}

        <button
          type="button"
          className="primary-button quiz-start-btn"
          onClick={startQuiz}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? (
            <><Loader2 size={16} className="animate-spin" /> {t.loading}</>
          ) : status === 'unavailable' ? (
            <><RefreshCw size={16} /> {t.retry}</>
          ) : (
            t.start
          )}
        </button>
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
              <p className="quiz-q-number">{typeof t.questionOf === 'function' ? t.questionOf(qi + 1, questions.length) : `${qi + 1}`}</p>
              <div className="quiz-q-row">
                <h4 className="quiz-q-text">{q.questionText}</h4>
                <SpeakerButton
                  audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/quiz/question/${qi}/audio?lang=${language}`}
                  size={16}
                />
              </div>
              <div className="quiz-options">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    type="button"
                    className={`quiz-option ${answers[qi] === oi ? 'selected' : ''}`}
                    onClick={() => selectOption(qi, oi)}
                  >
                    <span className="quiz-opt-letter">{String.fromCharCode(65 + oi)}</span>
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!allAnswered && <p className="quiz-hint">{t.answerAll}</p>}
        <button
          type="button"
          className="primary-button quiz-submit-btn"
          onClick={submitQuiz}
          disabled={!allAnswered || status === 'submitting'}
        >
          {status === 'submitting' ? (
            <><Loader2 size={16} className="animate-spin" /> {t.submitting}</>
          ) : t.submit}
        </button>
      </section>
    );
  }

  // ── Result / review ──
  const scorePct = result && result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
  return (
    <section className="module-quiz-card">
      <div className={`quiz-result-banner ${result.passed ? 'passed' : 'failed'}`}>
        <div className="quiz-result-score">
          <span className="quiz-result-num">{result.score} / {result.total}</span>
          <span className="quiz-result-pct">{scorePct}%</span>
        </div>
        <div className="quiz-result-status">
          {result.passed ? (
            <span className="quiz-status-pill passed"><CheckCircle2 size={16} /> {t.passed}</span>
          ) : (
            <span className="quiz-status-pill failed"><XCircle size={16} /> {t.failed}</span>
          )}
          <p>
            {result.passed
              ? (result.dayCompleted ? t.dayCompleted : t.passedNeedVideo)
              : (typeof t.failedRetry === 'function' ? t.failedRetry(Math.round((result.passThreshold || passThreshold) * 100)) : '')}
          </p>
        </div>
      </div>

      <h4 className="quiz-review-heading">{t.reviewHeading}</h4>
      <div className="quiz-questions">
        {result.questions.map((q, qi) => (
          <div key={qi} className={`quiz-question reviewed ${q.isCorrect ? 'correct' : 'incorrect'}`}>
            <div className="quiz-q-row">
              <h4 className="quiz-q-text">{q.questionText}</h4>
              <SpeakerButton
                audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/quiz/question/${qi}/audio?lang=${language}`}
                size={16}
              />
            </div>
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
            {q.explanation && (
              <p className="quiz-explanation"><strong>{t.explanation}</strong> {q.explanation}</p>
            )}
          </div>
        ))}
      </div>

      {!result.passed && (
        <button type="button" className="primary-button quiz-submit-btn" onClick={startQuiz}>
          <RefreshCw size={16} /> {t.retake}
        </button>
      )}
    </section>
  );
}
