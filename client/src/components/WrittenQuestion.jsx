// Track 3: shared UI bits for WRITTEN (essay / short-answer) questions, used by
// PracticeMode, ModuleQuiz, the diagnostic onboarding, DiagnosticReview + the
// dashboard so the input + review render ONE way. Written answers are framed by
// THRESHOLD ("Below threshold"), never "Incorrect".
import { translations } from '../data/translations.js';

// The answer input shown while taking a quiz.
export function WrittenInput({ value, onChange, placeholder, disabled = false }) {
  return (
    <textarea
      className="quiz-written-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={5}
    />
  );
}

// A criterion in [0,100] → bar color band (green / amber / red).
function scoreBand(score) {
  if (score >= 70) return 'good';
  if (score >= 40) return 'mid';
  return 'low';
}

// Post-submit review for a written answer: threshold-framed status + overall,
// the student's answer, per-criterion score bars + AI feedback, and the grading
// key (expected points). `scores`/`feedback` are {content,grammar,spelling};
// `labels` carries the host-namespace status strings; `language` selects the
// shared criterion labels. AI feedback text is English (see feedbackEnglishNote).
export function WrittenReview({ answer, isCorrect, overall, threshold, scores, feedback, expectedPoints, labels, language = 'en', showStatus = true }) {
  const w = translations[language]?.written || translations.en.written;
  const criteria = [
    { key: 'content', label: w.content },
    { key: 'grammar', label: w.grammar },
    { key: 'spelling', label: w.spelling }
  ];
  const hasScores = scores && typeof scores.content === 'number';
  const points = Array.isArray(expectedPoints) ? expectedPoints.filter((p) => p && p.trim()) : [];
  const hasOverall = typeof overall === 'number';

  return (
    <div className="quiz-written-review">
      {(showStatus || hasOverall) && (
        <div className="quiz-written-status">
          {showStatus && (
            <span className={`quiz-status-pill ${isCorrect ? 'passed' : 'below'}`}>
              {isCorrect ? labels.reached : labels.below}
            </span>
          )}
          {hasOverall && (
            <span className="quiz-written-score">
              {w.overallLabel} {overall}%{typeof threshold === 'number' ? ` · ${labels.thresholdLabel} ${threshold}%` : ''}
            </span>
          )}
        </div>
      )}

      <p className="quiz-written-answer-label">{labels.yourAnswer}</p>
      <p className="quiz-written-answer">{answer && answer.trim() ? answer : '—'}</p>

      {hasScores && (
        <div className="quiz-written-scores">
          {criteria.map(({ key, label }) => {
            const score = typeof scores[key] === 'number' ? scores[key] : 0;
            const fb = feedback && feedback[key];
            return (
              <div key={key} className="quiz-written-criterion">
                <div className="quiz-written-crit-head">
                  <span className="quiz-written-crit-label">{label}</span>
                  <span className="quiz-written-crit-score">{score}%</span>
                </div>
                <div className="quiz-written-bar-bg">
                  <div className={`quiz-written-bar-fill ${scoreBand(score)}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                </div>
                {fb && <p className="quiz-written-crit-feedback">{fb}</p>}
              </div>
            );
          })}
          {language === 'hi' && <p className="quiz-written-note">{w.feedbackEnglishNote}</p>}
        </div>
      )}

      {points.length > 0 && (
        <div className="quiz-written-expected">
          <p className="quiz-written-answer-label">{w.expectedPointsHeading}</p>
          <ul>
            {points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// Whether a written answer counts as "answered" (non-empty string). Shared so the
// submit-gating logic matches the input in every host component.
export function isWrittenAnswered(val) {
  return typeof val === 'string' && val.trim().length > 0;
}
