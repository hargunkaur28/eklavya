import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { CheckCircle2, Loader2, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';
import SpeakerButton from './SpeakerButton.jsx';
import NarrationPrompt from './NarrationPrompt.jsx';
import QuestionDiagram, { diagramAltFor } from './QuestionDiagram.jsx';
import { WrittenInput, isWrittenAnswered } from './WrittenQuestion.jsx';
import { primeAudio } from '../utils/audioPriming.js';
// Track 4.1: canonical subject/grade lists now come from the single source.
import { SUBJECTS as SUBJECTLIST, GRADES as GRADELIST, hasSubSubjects, subSubjectsFor } from '../data/taxonomy.js';
import { getSubSubjectName } from '../utils/subjectTranslations.js';
import { translations } from '../data/translations.js';

// Workstream A4: the diagnostic is ADAPTIVE and variable-length. The client no
// longer knows how many questions are coming, so it must never render a total.
// Questions accumulate round by round; each round is submitted, scored server-
// side, and the server replies with either the next round or the final result.
export default function Onboarding() {
  const [step, setStep] = useState(1); // 1: Select Grade/Subject, 2: Quiz
  const [selectedGrade, setSelectedGrade] = useState('Class 10');
  const [selectedSubject, setSelectedSubject] = useState('Science');
  const [selectedSubSubject, setSelectedSubSubject] = useState(''); // sub-subject split
  const [quizSessionId, setQuizSessionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [hindiQuestions, setHindiQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  // Index of the first question of the round currently on screen. Everything
  // before it has already been graded server-side and can no longer be changed.
  const [roundStart, setRoundStart] = useState(0);
  const [progress, setProgress] = useState({ asked: 0, answered: 0, maxQuestions: 20, estimatedTotal: null });
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRound, setLoadingRound] = useState(false);
  // Generation is genuinely down (503). Distinct from `error` because the student's
  // only useful action is to retry, and the diagnostic has no content fallback.
  const [unavailable, setUnavailable] = useState(false);
  const [roundFailed, setRoundFailed] = useState(false);
  const [includeWritten, setIncludeWritten] = useState(false); // Track 3: opt-in written

  const [translatingHindi, setTranslatingHindi] = useState(false);

  const { authFetch, user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language]?.diagnostic || translations.en.diagnostic;

  // Mid-quiz language switch. Before the adaptive rewrite this re-called
  // /generate, which would now abandon the in-flight session and re-roll the
  // whole quiz — so it translates the LIVE session in place instead.
  useEffect(() => {
    if (step !== 2 || language !== 'hi' || !quizSessionId) return;
    if (translatingHindi) return;
    if (hindiQuestions.length >= questions.length && questions.length > 0) return;
    if (questions.length === 0) return;

    setTranslatingHindi(true);
    authFetch(`/diagnostic/session/${quizSessionId}/translate`, { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.translatedHindiQuestions)) {
          setHindiQuestions(data.translatedHindiQuestions);
        }
      })
      .catch((err) => console.warn('Mid-quiz Hindi translation error:', err))
      .finally(() => setTranslatingHindi(false));
  }, [step, language, quizSessionId, questions.length, hindiQuestions.length, translatingHindi, authFetch]);

  // Phase 3: track prompt dismissal locally so we don't flicker the popup after the
  // PATCH resolves (the user context updates, but only on the next render cycle).
  const [promptDismissed, setPromptDismissed] = useState(false);

  // Split subjects (English/Science/Social Science) require a sub-subject choice.
  const subSubjectOptions = subSubjectsFor(selectedSubject);
  const needsSubSubject = hasSubSubjects(selectedSubject);
  const subSubjectReady = !needsSubSubject || !!selectedSubSubject;

  // Start Diagnostic Quiz — returns round 1 only.
  const handleStartQuiz = async () => {
    primeAudio();
    setError('');
    setUnavailable(false);
    setLoadingQuiz(true);

    try {
      const res = await authFetch(`/diagnostic/generate?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ grade: selectedGrade, subject: selectedSubject, subSubject: selectedSubSubject, language, includeWritten })
      });

      const data = await res.json();
      if (!res.ok) {
        // 503 = generation is genuinely unavailable. The diagnostic deliberately has
        // no content fallback, so this gets its own explained, retryable screen
        // rather than a red banner the student cannot act on.
        if (res.status === 503) { setUnavailable(true); return; }
        throw new Error(data.error || 'Failed to generate diagnostic quiz.');
      }

      setQuizSessionId(data.quizSessionId);
      setQuestions(data.questions || []);
      setHindiQuestions(data.translatedHindiQuestions || []);
      setProgress(data.progress || { asked: (data.questions || []).length, answered: 0, maxQuestions: 20 });
      setRoundStart(0);
      setCurrentQIndex(0);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Error initializing quiz');
    } finally {
      setLoadingQuiz(false);
    }
  };

  // Submit the round currently on screen. The server decides whether it needs more.
  const handleSubmitRound = useCallback(async () => {
    setSubmitting(true);
    setError('');
    setRoundFailed(false);

    const roundQuestions = questions.slice(roundStart);
    const formattedAnswers = roundQuestions.map((q, i) => {
      const idx = roundStart + i;
      return q.type === 'written'
        ? {
            questionText: q.questionText || q.question,
            topic: q.topic,
            writtenAnswer: typeof answers[idx] === 'string' ? answers[idx] : ''
          }
        : {
            questionText: q.questionText || q.question,
            options: q.options,
            topic: q.topic,
            selectedIndex: answers[idx] !== undefined ? answers[idx] : null
          };
    });

    try {
      setLoadingRound(true);
      const res = await authFetch(`/diagnostic/submit?lang=${language}`, {
        method: 'POST',
        // `round` lets the server reject a stale/replayed submission rather than
        // grading the round on screen with the previous round's answers.
        body: JSON.stringify({ quizSessionId, answers: formattedAnswers, language, round: progress.round })
      });

      const data = await res.json();
      if (!res.ok) {
        // Mid-quiz generation outage: the answers already given are graded and
        // stored server-side, so this is retryable in place, not a dead end.
        if (res.status === 503) { setRoundFailed(true); return; }
        throw new Error(data.error || 'Error submitting diagnostic quiz.');
      }

      if (data.status === 'complete') {
        navigate(`/review/${data.result._id}`, { state: { result: data.result } });
        return;
      }

      // More questions: append them and move to the first one of the new round.
      const nextStart = questions.length;
      setQuestions((prev) => [...prev, ...(data.questions || [])]);
      if (Array.isArray(data.translatedHindiQuestions) && data.translatedHindiQuestions.length) {
        setHindiQuestions((prev) => {
          const merged = [...prev];
          while (merged.length < nextStart) merged.push(null);
          return [...merged, ...data.translatedHindiQuestions];
        });
      }
      setProgress(data.progress || progress);
      setRoundStart(nextStart);
      setCurrentQIndex(nextStart);
      primeAudio();
    } catch (err) {
      setError(err.message || 'Error processing diagnostic submission');
    } finally {
      setSubmitting(false);
      setLoadingRound(false);
    }
  }, [answers, authFetch, language, navigate, progress, questions, quizSessionId, roundStart]);

  const currentQ = questions[currentQIndex];
  const currentHindiQ = hindiQuestions[currentQIndex];
  const displayStem = (language === 'hi' && (currentHindiQ?.questionText || currentHindiQ?.question))
    ? (currentHindiQ?.questionText || currentHindiQ?.question)
    : (currentQ?.questionText || currentQ?.question || '');
  const displayOptions = (language === 'hi' && currentHindiQ?.options?.length === 4) ? currentHindiQ.options : currentQ?.options;
  const isWritten = currentQ?.type === 'written';
  const currentAnswered = isWritten
    ? isWrittenAnswered(answers[currentQIndex])
    : answers[currentQIndex] !== undefined;
  const isLastOfRound = currentQIndex === questions.length - 1;

  // Workstream D: read-aloud must describe the figure, and in Hindi mode it uses
  // the translated alt text so narration matches what is on screen.
  const diagramAlt = currentQ
    ? ((language === 'hi' && currentHindiQ?.diagramAlt) ? currentHindiQ.diagramAlt : diagramAltFor(currentQ, language))
    : '';

  const maxQuestions = progress.maxQuestions || 20;
  const askedSoFar = questions.length;
  const barPct = Math.min(100, Math.round((askedSoFar / maxQuestions) * 100));
  const nearingEnd = progress.estimatedTotal && askedSoFar >= progress.estimatedTotal - 2;

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {step === 1 && (
          <div className="onboarding-step">
            <span className="section-kicker">{t.stepKicker}</span>
            <h2>{t.selectTitle}</h2>
            <p className="onboarding-subtitle">{t.selectSubtitle}</p>

            {error && <div className="auth-error-banner">{error}</div>}

            {unavailable && (
              <div className="diagnostic-unavailable" role="alert">
                <AlertCircle size={28} />
                <h3>{t.unavailableTitle}</h3>
                <p>{t.unavailableBody}</p>
                <button type="button" className="primary-button" onClick={handleStartQuiz} disabled={loadingQuiz}>
                  {loadingQuiz ? (
                    <><Loader2 className="animate-spin" size={16} /> {t.retrying}</>
                  ) : (
                    <><RefreshCw size={16} /> {t.unavailableRetry}</>
                  )}
                </button>
              </div>
            )}

            <div className="selection-group">
              <label>{t.gradeLabel}</label>
              <div className="chip-grid">
                {GRADELIST.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`select-chip ${selectedGrade === g ? 'selected' : ''}`}
                    onClick={() => setSelectedGrade(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="selection-group" style={{ marginTop: '1.5rem' }}>
              <label>{t.subjectLabel}</label>
              <div className="chip-grid">
                {SUBJECTLIST.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`select-chip ${selectedSubject === s ? 'selected' : ''}`}
                    onClick={() => { setSelectedSubject(s); setSelectedSubSubject(''); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {needsSubSubject && (
              <div className="selection-group" style={{ marginTop: '1.5rem' }}>
                <label>{t.areaLabel(selectedSubject)}</label>
                <div className="chip-grid">
                  {subSubjectOptions.map((ss) => (
                    <button
                      key={ss}
                      type="button"
                      className={`select-chip ${selectedSubSubject === ss ? 'selected' : ''}`}
                      onClick={() => setSelectedSubSubject(ss)}
                    >
                      {getSubSubjectName(ss, language)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="practice-written-toggle" style={{ marginTop: '1.5rem' }}>
              <input
                type="checkbox"
                checked={includeWritten}
                onChange={(e) => setIncludeWritten(e.target.checked)}
              />
              <span>
                <strong>{t.writtenToggle}</strong>
                <small>{t.writtenToggleHint}</small>
              </span>
            </label>

            <p className="adaptive-note">{t.adaptiveNote}</p>

            {needsSubSubject && !selectedSubSubject && (
              <p className="quiz-hint" style={{ marginTop: '1rem' }}>{t.areaHint(selectedSubject)}</p>
            )}

            <button
              type="button"
              className="primary-button large onboarding-next-btn"
              onClick={handleStartQuiz}
              disabled={loadingQuiz || !subSubjectReady}
            >
              {loadingQuiz ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {t.starting}
                </>
              ) : (
                <>
                  {t.start} <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        )}

        {step === 2 && loadingRound && (
          <div className="onboarding-step">
            <div className="adaptive-round-loading">
              <Loader2 className="animate-spin" size={30} />
              <p>{t.nextRoundLoading}</p>
              <small>{t.adaptiveNote}</small>
            </div>
          </div>
        )}

        {step === 2 && !loadingRound && roundFailed && (
          <div className="onboarding-step">
            <div className="diagnostic-unavailable" role="alert">
              <AlertCircle size={28} />
              <h3>{t.unavailableTitle}</h3>
              <p>{t.unavailableMidQuiz}</p>
              <button type="button" className="primary-button" onClick={handleSubmitRound} disabled={submitting}>
                {submitting ? (
                  <><Loader2 className="animate-spin" size={16} /> {t.retrying}</>
                ) : (
                  <><RefreshCw size={16} /> {t.unavailableRetry}</>
                )}
              </button>
            </div>
          </div>
        )}

        {step === 2 && !loadingRound && !roundFailed && currentQ && (
          <div className="onboarding-step">
            <div className="quiz-step-header">
              <span className="section-kicker">
                {selectedSubject}{selectedSubSubject ? ` · ${getSubSubjectName(selectedSubSubject, language)}` : ''}
              </span>
              <span className="topic-badge">{currentQ.topic || selectedSubject}</span>
            </div>

            {/* Indeterminate progress: the total is genuinely unknown, so we
                never render "of N" — only how far along the student is. */}
            <div className="adaptive-progress">
              <div className="adaptive-progress-label">
                <span className="adaptive-progress-count">{t.questionN(currentQIndex + 1)}</span>
                <span className="adaptive-progress-hint">
                  — {nearingEnd ? t.almostDone : t.stillLearning}
                </span>
              </div>
              <div className="adaptive-progress-track">
                <div className="adaptive-progress-fill" style={{ width: `${barPct}%` }} />
              </div>
            </div>

            {error && <div className="auth-error-banner">{error}</div>}

            {translatingHindi && (
              <div className="translation-notice" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 className="animate-spin" size={16} /> {t.translating}
              </div>
            )}

            {/* Phase 3: one-time narration prompt (shown on first quiz encounter) */}
            {!promptDismissed && !user?.hasSeenNarrationPrompt && (
              <NarrationPrompt onDone={() => setPromptDismissed(true)} />
            )}

            {currentQ.diagram?.svg && (
              <QuestionDiagram
                diagram={{
                  ...currentQ.diagram,
                  altHindi: currentHindiQ?.diagramAlt || currentQ.diagram.altHindi || ''
                }}
              />
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <h3 className="quiz-question-title" style={{ margin: 0 }}>{displayStem}</h3>
              <SpeakerButton
                key={`speaker-diag-${currentQIndex}`}
                fetchPayload={{ questionText: displayStem, options: displayOptions, language, diagramAlt }}
                subject={selectedSubject?.name || selectedSubject?.id || ''}
                autoPlay={!!user?.autoNarrateQuizzes}
                size={16}
              />
            </div>

            {isWritten ? (
              <WrittenInput
                value={answers[currentQIndex]}
                onChange={(val) => setAnswers({ ...answers, [currentQIndex]: val })}
                placeholder="Type your answer…"
                disabled={submitting}
              />
            ) : (
              <div className="quiz-options-stack">
                {(displayOptions || []).map((opt, optIdx) => {
                  const isSelected = answers[currentQIndex] === optIdx;
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className={`quiz-option-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => setAnswers({ ...answers, [currentQIndex]: optIdx })}
                    >
                      <span className="option-letter">{String.fromCharCode(65 + optIdx)}</span>
                      <span className="option-text">{opt}</span>
                      {isSelected && <CheckCircle2 size={18} className="option-check" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="quiz-nav-row">
              {/* Previous is bounded by the current round: earlier rounds are
                  already graded server-side and cannot be changed. */}
              <button
                type="button"
                className="ghost-button"
                disabled={currentQIndex <= roundStart || submitting}
                onClick={() => setCurrentQIndex(currentQIndex - 1)}
              >
                {t.previous}
              </button>

              {!isLastOfRound ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!currentAnswered || submitting}
                  onClick={() => { primeAudio(); setCurrentQIndex(currentQIndex + 1); }}
                >
                  {t.next}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!currentAnswered || submitting}
                  onClick={handleSubmitRound}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} /> {t.submitting}
                    </>
                  ) : (
                    askedSoFar >= (progress.estimatedTotal || maxQuestions) ? t.submitFinal : t.continueRound
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
