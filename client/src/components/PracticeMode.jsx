import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { formatGradeSubjectDash } from '../utils/subjectTranslations.js';
import { Dumbbell, Loader2, RefreshCw, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import SpeakerButton from './SpeakerButton.jsx';
import NarrationPrompt from './NarrationPrompt.jsx';
import { primeAudio } from '../utils/audioPriming.js';
import { getLocalDate } from '../utils/streak.js';
import { WrittenInput, WrittenReview, isWrittenAnswered } from './WrittenQuestion.jsx';

// Phase 6: practice mode. Generates a FRESH quiz per session (variety, no cache),
// separate from the roadmap — it never marks days complete and never writes to
// the weak-topic aggregation. It only READS weak topics to pre-fill a shortcut.
export default function PracticeMode({ roadmaps = [], defaultRoadmap }) {
  const { authFetch, user } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.practice || translations.en.practice;

  const subjects = (roadmaps || []).map((r) => ({
    id: r._id, subject: r.subject, grade: r.grade,
    label: formatGradeSubjectDash(r.grade, r.subject, language)
  }));

  const [roadmapId, setRoadmapId] = useState(defaultRoadmap?._id || subjects[0]?.id || '');
  const [topic, setTopic] = useState('');
  const [weakTopics, setWeakTopics] = useState([]);
  const [phase, setPhase] = useState('setup'); // setup|loading|active|submitting|result
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [sessionId, setSessionId] = useState(null);
  const [result, setResult] = useState(null);
  const [includeWritten, setIncludeWritten] = useState(false); // Track 3: opt-in
  const [promptDismissed, setPromptDismissed] = useState(false); // Phase 3
  const [autoPlayIndex, setAutoPlayIndex] = useState(-1);

  const selected = subjects.find((s) => s.id === roadmapId) || subjects[0];

  // Read-only link to Phase 4: pull weak topics for the chosen subject to pre-fill.
  useEffect(() => {
    if (!roadmapId) return;
    let active = true;
    authFetch(`/roadmap/${roadmapId}/weak-topics?lang=${language}`)
      .then((r) => r.json())
      .then((d) => { if (active) setWeakTopics(d?.weakTopics || []); })
      .catch(() => { if (active) setWeakTopics([]); });
    return () => { active = false; };
  }, [authFetch, roadmapId, language]);

  const generate = useCallback(async (topicToUse) => {
    primeAudio();
    const finalTopic = (topicToUse ?? topic).trim();
    if (!finalTopic || !selected) return;
    setTopic(finalTopic);
    setPhase('loading');
    setAnswers({});
    setResult(null);
    try {
      const res = await authFetch(`/practice/generate?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ grade: selected.grade, subject: selected.subject, topic: finalTopic, includeWritten })
      });
      const data = await res.json();
      if (!res.ok || data.available === false) { setPhase('unavailable'); return; }
      setQuestions(data.questions || []);
      setSessionId(data.sessionId);
      setAutoPlayIndex(user?.autoNarrateQuizzes !== false ? 0 : -1);
      setPhase('active');
    } catch {
      setPhase('unavailable');
    }
  }, [authFetch, topic, selected, language, includeWritten]);

  // A written question counts as answered when its text box is non-empty; an MCQ
  // when an option index is set.
  const allAnswered = questions.length > 0 && questions.every((q, i) =>
    q.type === 'written' ? isWrittenAnswered(answers[i]) : answers[i] !== undefined);

  const submit = useCallback(async () => {
    if (!allAnswered) return;
    setPhase('submitting');
    const payload = questions.map((q, i) => q.type === 'written'
      ? { writtenAnswer: answers[i] }
      : { selectedIndex: answers[i] });
    try {
      const res = await authFetch(`/practice/submit?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, answers: payload, localDate: getLocalDate() })
      });
      const data = await res.json();
      if (!res.ok) { setPhase('active'); return; }
      setResult(data);
      setPhase('result');
    } catch {
      setPhase('active');
    }
  }, [allAnswered, questions, answers, authFetch, sessionId, language]);

  if (subjects.length === 0) {
    return <div className="module-quiz-card"><p className="quiz-unavailable">{t.noSubjects}</p></div>;
  }

  // ── Setup ──
  if (phase === 'setup' || phase === 'loading' || phase === 'unavailable') {
    return (
      <div className="module-quiz-card">
        <div className="quiz-head">
          <Dumbbell size={22} className="quiz-head-icon" />
          <div><h3>{t.title}</h3><p>{t.intro}</p></div>
        </div>

        <div className="practice-setup">
          <label className="practice-field">
            <span>{t.chooseSubject}</span>
            <select value={roadmapId} onChange={(e) => setRoadmapId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>

          <label className="practice-field">
            <span>{t.chooseTopic}</span>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t.topicPlaceholder}
            />
          </label>

          <label className="practice-written-toggle">
            <input
              type="checkbox"
              checked={includeWritten}
              onChange={(e) => setIncludeWritten(e.target.checked)}
            />
            <span>
              <strong>{t.includeWritten}</strong>
              <small>{t.includeWrittenHint}</small>
            </span>
          </label>

          {weakTopics.length > 0 && (
            <div className="practice-weak-hints">
              <span className="practice-weak-label">{t.weakTopicsHint}</span>
              <div className="practice-weak-chips">
                {weakTopics.map((w) => (
                  <button
                    key={w.subtopic}
                    type="button"
                    className="practice-weak-chip"
                    onClick={() => generate(w.label || w.subtopic)}
                  >
                    {w.label || w.subtopic}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase === 'unavailable' && <p className="quiz-unavailable">{t.unavailable}</p>}

          <button
            type="button"
            className="primary-button quiz-submit-btn"
            onClick={() => generate()}
            disabled={phase === 'loading' || !topic.trim()}
          >
            {phase === 'loading'
              ? <><Loader2 size={16} className="animate-spin" /> {t.generating}</>
              : phase === 'unavailable' ? <><RefreshCw size={16} /> {t.retry}</> : t.start}
          </button>
        </div>
      </div>
    );
  }

  // ── Active ──
  if (phase === 'active' || phase === 'submitting') {
    return (
      <div className="module-quiz-card">
        <div className="quiz-head">
          <Dumbbell size={22} className="quiz-head-icon" />
          <div><h3>{t.title}</h3><p>{selected?.label} · {topic}</p></div>
        </div>
        <p className="practice-not-counted"><Sparkles size={14} /> {t.notCounted}</p>
        {/* Phase 3: one-time narration prompt */}
        {!promptDismissed && !user?.hasSeenNarrationPrompt && (
          <NarrationPrompt onDone={() => setPromptDismissed(true)} />
        )}

        <div className="quiz-questions">
          {questions.map((q, qi) => (
            <div key={qi} className="quiz-question">
              <p className="quiz-q-number">
                {t.questionOf(qi + 1, questions.length)}
                {q.type === 'written' && <span className="quiz-written-badge">{t.writtenBadge}</span>}
              </p>
              <div className="quiz-q-row">
                <h4 className="quiz-q-text">{q.questionText}</h4>
                <SpeakerButton
                  key={`speaker-prac-${qi}`}
                  fetchPayload={{ questionText: q.questionText, options: q.options || [], language }}
                  subject={selected?.subject}
                  autoPlay={autoPlayIndex === qi}
                  onEnded={() => setAutoPlayIndex((prev) => (prev === qi ? qi + 1 : prev))}
                  size={16}
                />
              </div>
              {q.type === 'written' ? (
                <WrittenInput
                  value={answers[qi]}
                  onChange={(val) => setAnswers((p) => ({ ...p, [qi]: val }))}
                  placeholder={t.writtenPlaceholder}
                  disabled={phase === 'submitting'}
                />
              ) : (
                <div className="quiz-options">
                  {q.options.map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      className={`quiz-option ${answers[qi] === oi ? 'selected' : ''}`}
                      onClick={() => setAnswers((p) => ({ ...p, [qi]: oi }))}
                    >
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
        <button type="button" className="primary-button quiz-submit-btn" onClick={submit} disabled={!allAnswered || phase === 'submitting'}>
          {phase === 'submitting' ? <><Loader2 size={16} className="animate-spin" /> {t.submitting}</> : t.submit}
        </button>
      </div>
    );
  }

  // ── Result ──
  const scorePct = result && result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
  return (
    <div className="module-quiz-card">
      <div className="quiz-result-banner passed">
        <div className="quiz-result-score">
          <span className="quiz-result-num">{result.score} / {result.total}</span>
          <span className="quiz-result-pct">{scorePct}%</span>
        </div>
        <div className="quiz-result-status">
          <span className="quiz-status-pill passed"><CheckCircle2 size={16} /> {t.title}</span>
          <p>{t.notCounted}</p>
        </div>
      </div>

      <h4 className="quiz-review-heading">{t.reviewHeading}</h4>
      <div className="quiz-questions">
        {result.questions.map((q, qi) => (
          <div key={qi} className={`quiz-question reviewed ${q.type === 'written' ? (q.isCorrect ? 'correct' : 'below') : (q.isCorrect ? 'correct' : 'incorrect')}`}>
            <div className="quiz-q-row">
              <h4 className="quiz-q-text">
                {q.type === 'written' && <span className="quiz-written-badge">{t.writtenBadge}</span>}
                {q.questionText}
              </h4>
              <SpeakerButton fetchPayload={{ questionText: q.questionText, options: q.options || [], language }} subject={selected?.subject} size={16} />
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

      <div className="practice-result-actions">
        <button type="button" className="primary-button quiz-submit-btn" onClick={() => generate(topic)}>
          <RefreshCw size={16} /> {t.practiceAgain}
        </button>
        <button type="button" className="ghost-button" onClick={() => setPhase('setup')}>
          {t.changeTopic}
        </button>
      </div>
    </div>
  );
}
