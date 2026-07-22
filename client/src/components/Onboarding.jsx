import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import SpeakerButton from './SpeakerButton.jsx';
import { WrittenInput, isWrittenAnswered } from './WrittenQuestion.jsx';
// Track 4.1: canonical subject/grade lists now come from the single source.
import { SUBJECTS as SUBJECTLIST, GRADES as GRADELIST, hasSubSubjects, subSubjectsFor } from '../data/taxonomy.js';
import { getSubSubjectName } from '../utils/subjectTranslations.js';

export default function Onboarding() {
  const [step, setStep] = useState(1); // 1: Select Grade/Subject, 2: Quiz
  const [selectedGrade, setSelectedGrade] = useState('Class 10');
  const [selectedSubject, setSelectedSubject] = useState('Science');
  const [selectedSubSubject, setSelectedSubSubject] = useState(''); // sub-subject split
  const [quizSessionId, setQuizSessionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [hindiQuestions, setHindiQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [includeWritten, setIncludeWritten] = useState(false); // Track 3: opt-in written

  const [translatingHindi, setTranslatingHindi] = useState(false);

  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();

  // Fetch Hindi translation mid-quiz if user switches language toggle to Hindi
  useEffect(() => {
    if (step === 2 && language === 'hi' && questions.length > 0 && (!hindiQuestions || hindiQuestions.length === 0) && !translatingHindi) {
      setTranslatingHindi(true);
      authFetch(`/diagnostic/generate?lang=hi`, {
        method: 'POST',
        body: JSON.stringify({ grade: selectedGrade, subject: selectedSubject, subSubject: selectedSubSubject, language: 'hi', includeWritten })
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.translatedHindiQuestions && data.translatedHindiQuestions.length > 0) {
            setHindiQuestions(data.translatedHindiQuestions);
          }
        })
        .catch((err) => console.warn('Mid-quiz Hindi translation error:', err))
        .finally(() => setTranslatingHindi(false));
    }
  }, [step, language, questions, hindiQuestions, translatingHindi, selectedGrade, selectedSubject, selectedSubSubject, authFetch, includeWritten]);

  // Split subjects (English/Science/Social Science) require a sub-subject choice.
  const subSubjectOptions = subSubjectsFor(selectedSubject);
  const needsSubSubject = hasSubSubjects(selectedSubject);
  const subSubjectReady = !needsSubSubject || !!selectedSubSubject;

  // Start Diagnostic Quiz
  const handleStartQuiz = async () => {
    setError('');
    setLoadingQuiz(true);

    try {
      const res = await authFetch(`/diagnostic/generate?lang=${language}`, {
        method: 'POST',
        body: JSON.stringify({ grade: selectedGrade, subject: selectedSubject, subSubject: selectedSubSubject, language, includeWritten })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate diagnostic quiz.');
      }

      setQuizSessionId(data.quizSessionId);
      setQuestions(data.questions);
      setHindiQuestions(data.translatedHindiQuestions || []);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Error initializing quiz');
    } finally {
      setLoadingQuiz(false);
    }
  };

  // Submit Quiz (sends ONLY quizSessionId and selectedIndex array)
  const handleSubmitQuiz = async () => {
    setSubmitting(true);

    try {
      const formattedAnswers = questions.map((q, idx) => q.type === 'written'
        ? {
            questionText: q.questionText || q.question,
            topic: q.topic,
            writtenAnswer: typeof answers[idx] === 'string' ? answers[idx] : ''
          }
        : {
            questionText: q.questionText || q.question,
            options: q.options,
            topic: q.topic,
            selectedIndex: answers[idx] !== undefined ? answers[idx] : 0
          });

      const submitRes = await authFetch('/diagnostic/submit', {
        method: 'POST',
        body: JSON.stringify({
          quizSessionId,
          grade: selectedGrade,
          subject: selectedSubject,
          answers: formattedAnswers
        })
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitData.error || 'Error submitting diagnostic quiz.');
      }

      // Navigate to Review Screen with result ID
      navigate(`/review/${submitData._id}`, { state: { result: submitData } });
    } catch (err) {
      setError(err.message || 'Error processing diagnostic submission');
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {step === 1 && (
          <div className="onboarding-step">
            <span className="section-kicker">Step 1 of 2</span>
            <h2>Select your grade & subject</h2>
            <p className="onboarding-subtitle">
              We customize your AI diagnostic test and day-by-day roadmap based on your syllabus.
            </p>

            {error && <div className="auth-error-banner">{error}</div>}

            <div className="selection-group">
              <label>Select Grade / Batch</label>
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
              <label>Select Subject / Track</label>
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
                <label>Select {selectedSubject} area</label>
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
                <strong>Include written questions</strong>
                <small>Adds a couple of AI-graded short written-answer questions.</small>
              </span>
            </label>

            {needsSubSubject && !selectedSubSubject && (
              <p className="quiz-hint" style={{ marginTop: '1rem' }}>Choose a {selectedSubject} area to continue.</p>
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
                  Initializing Diagnostic...
                </>
              ) : (
                <>
                  Start Diagnostic Test <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        )}

        {step === 2 && currentQ && (
          <div className="onboarding-step">
            <div className="quiz-step-header">
              <span className="section-kicker">
                {selectedSubject}{selectedSubSubject ? ` · ${getSubSubjectName(selectedSubSubject, language)}` : ''} — Question {currentQIndex + 1} of {questions.length}
              </span>
              <span className="topic-badge">{currentQ.topic || selectedSubject}</span>
            </div>

            {error && <div className="auth-error-banner">{error}</div>}

            {translatingHindi && (
              <div className="translation-notice" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 className="animate-spin" size={16} /> Translating quiz to Hindi...
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <h3 className="quiz-question-title" style={{ margin: 0 }}>{displayStem}</h3>
              <SpeakerButton
                fetchPayload={{ questionText: displayStem, options: displayOptions, language }}
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
              <button
                type="button"
                className="ghost-button"
                disabled={currentQIndex === 0 || submitting}
                onClick={() => setCurrentQIndex(currentQIndex - 1)}
              >
                Previous
              </button>

              {currentQIndex < questions.length - 1 ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!currentAnswered || submitting}
                  onClick={() => setCurrentQIndex(currentQIndex + 1)}
                >
                  Next Question
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!currentAnswered || submitting}
                  onClick={handleSubmitQuiz}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} /> Submitting...
                    </>
                  ) : (
                    'Submit & Review Diagnostic'
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
