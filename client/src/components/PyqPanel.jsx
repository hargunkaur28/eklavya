import { useState, useEffect, useCallback } from 'react';
import { scrollToTop } from '../utils/scrollToTop.js';
import { Loader2, ScrollText, Timer, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import PyqSourceBadge from './PyqSourceBadge.jsx';
import PyqExam from './PyqExam.jsx';
import SpeakerButton from './SpeakerButton.jsx';

// Workstream I — the student's Previous Year Questions section.
//
// Three screens, chosen by what the server says is actually available, NOT by what
// the student picked:
//
//   mode 'pyq' + papers      → real past papers, with a year selector
//   mode 'pyq' + no papers   → "we don't have papers for this yet". NOT a silent
//                              fallback to generated questions.
//   mode 'exam-style'        → non-board grade. Explains why, no year selector.
//
// The empty state is the important one. Substituting generated questions where a
// student asked for past papers is the exact failure Workstream I exists to prevent,
// so "we don't have this" is a first-class screen rather than an error.
export default function PyqPanel({ grade, subject, subSubject }) {
  const { authFetch } = useAuth();
  const { t, language } = useLanguage();

  const [avail, setAvail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('practice');       // 'practice' | 'exam'
  const [selectedYears, setSelectedYears] = useState([]);
  const [count, setCount] = useState(10);

  const [session, setSession] = useState(null);     // practice run
  const [feedback, setFeedback] = useState({});     // questionId -> graded result
  const [busy, setBusy] = useState(false);
  const [activeAttemptId, setActiveAttemptId] = useState(null);

  // ── Availability ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!grade || !subject) return;
    let alive = true;
    setLoading(true);
    setError('');
    authFetch(`/pyq/availability?grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setAvail(d);
        // Default: ALL available years selected. A student who wants everything —
        // the common case — does nothing.
        setSelectedYears(d.years || []);
      })
      .catch(() => alive && setError(t('pyq.loadFailed')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [authFetch, grade, subject, t]);

  const toggleYear = (y) => setSelectedYears((prev) =>
    prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y].sort((a, b) => b - a));

  const startPractice = useCallback(async () => {
    setBusy(true);
    setError('');
    setFeedback({});
    try {
      const res = await authFetch('/pyq/practice/start', {
        method: 'POST',
        body: JSON.stringify({ grade, subject, subSubject, years: selectedYears, count, language })
      });
      const data = await res.json();
      if (!res.ok) {
        // NO_PAPERS_AVAILABLE is not a crash — it is the honest answer, rendered as
        // its own message rather than a generic failure.
        setError(data.error === 'NO_PAPERS_AVAILABLE' ? t('pyq.noPapersForYears') : t('pyq.startFailed'));
        return;
      }
      setSession(data);
    } catch {
      setError(t('pyq.startFailed'));
    } finally {
      setBusy(false);
    }
  }, [authFetch, grade, subject, subSubject, selectedYears, count, language, t]);

  // Immediate per-question feedback — graded one at a time server-side, so the
  // answer key is never sitting in the page before the student answers.
  const answerOne = async (q, optIndex) => {
    if (feedback[q._id]) return;                    // already answered; low-stakes, one shot
    try {
      const res = await authFetch('/pyq/practice/answer', {
        method: 'POST',
        body: JSON.stringify({ questionId: q._id, selectedIndex: optIndex, language })
      });
      const data = await res.json();
      if (res.ok) setFeedback((f) => ({ ...f, [q._id]: { ...data, selectedIndex: optIndex } }));
    } catch { /* leave unanswered; the student can tap again */ }
  };

  const finishPractice = async () => {
    const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
    await authFetch('/pyq/practice/finish', { method: 'POST', body: JSON.stringify({ localDate }) }).catch(() => {});
    setSession(null);
    setFeedback({});
  };

  if (loading) {
    return <div className="pyq-panel"><Loader2 className="animate-spin" size={20} /> {t('pyq.loading')}</div>;
  }

  // A student migrated off an unsupported board (Workstream H) has no corpus to
  // query. Say that, rather than showing an empty year list that looks like a
  // content gap.
  if (avail?.mode === 'no-board') {
    return (
      <div className="pyq-panel">
        <PyqHeading t={t} />
        <div className="pyq-empty">
          <AlertCircle size={22} />
          <h4>{t('pyq.noBoardTitle')}</h4>
          <p>{t('pyq.noBoardDesc')}</p>
        </div>
      </div>
    );
  }

  // ── Exam mode owns the whole surface once running ────────────────────────
  if (activeAttemptId) {
    return (
      <PyqExam
        attemptId={activeAttemptId}
        onExit={() => { setActiveAttemptId(null); scrollToTop(); }}
        onFinished={() => { setActiveAttemptId(null); scrollToTop(); }}
      />
    );
  }

  const isExamStyle = avail?.mode === 'exam-style';
  const hasPapers = (avail?.paperCount || 0) > 0;

  return (
    <div className="pyq-panel">
      <PyqHeading t={t} />

      {/* ── The honest framing, stated once, at the top ──────────────────── */}
      {isExamStyle ? (
        // Non-apologetic: this is what this grade gets, and it explains why rather
        // than implying something is missing.
        <div className="pyq-notice pyq-notice-generated">
          <PyqSourceBadge source="generated" />
          <div>
            <strong>{t('pyq.examStyleTitle')}</strong>
            <p>{t('pyq.examStyleDesc')}</p>
          </div>
        </div>
      ) : (
        <div className="pyq-notice pyq-notice-real">
          <PyqSourceBadge source="pyq" sourceLabel={avail?.board || ''} />
          <div>
            <strong>{t('pyq.realTitle')}</strong>
            <p>
              {hasPapers
                ? `${avail.paperCount} ${avail.paperCount === 1 ? t('pyq.paperAvailable') : t('pyq.papersAvailable')} (${avail.years.join(', ')})`
                : t('pyq.noPapersYet')}
            </p>
          </div>
        </div>
      )}

      {/* Board grade with an EMPTY corpus. This is a terminal state on purpose —
          there is no "try exam-style instead" button, because that offer is what
          would blur the line the whole workstream is drawn around. */}
      {!isExamStyle && !hasPapers && (
        <div className="pyq-empty">
          <ScrollText size={22} />
          <h4>{t('pyq.noPapersTitle')}</h4>
          <p>{t('pyq.noPapersDesc')}</p>
        </div>
      )}

      {(isExamStyle || hasPapers) && !session && (
        <>
          <div className="pyq-tabs">
            <button className={`pyq-tab ${tab === 'practice' ? 'active' : ''}`} onClick={() => setTab('practice')}>
              {t('pyq.tabPractice')}
            </button>
            <button className={`pyq-tab ${tab === 'exam' ? 'active' : ''}`} onClick={() => setTab('exam')}>
              {t('pyq.tabExam')}
            </button>
          </div>

          {/* ── Year selector: real papers only ───────────────────────────
              Hidden entirely for exam-style, because a generated question carries
              no year and a disabled year control would imply one exists. */}
          {!isExamStyle && (
            <div className="pyq-years">
              <span className="pyq-years-label">{t('pyq.yearsLabel')}</span>
              <div className="pyq-year-chips">
                {avail.years.map((y) => (
                  <button
                    key={y}
                    className={`pyq-year-chip ${selectedYears.includes(y) ? 'selected' : ''}`}
                    onClick={() => toggleYear(y)}
                    aria-pressed={selectedYears.includes(y)}
                  >{y}</button>
                ))}
              </div>
            </div>
          )}

          {tab === 'practice' ? (
            <div className="pyq-controls">
              <span className="pyq-years-label">{t('pyq.countLabel')}</span>
              <div className="pyq-year-chips">
                {[10, 20, 30].map((n) => (
                  <button key={n} className={`pyq-year-chip ${count === n ? 'selected' : ''}`} onClick={() => setCount(n)}>{n}</button>
                ))}
                {/* Offered so a thin corpus is usable rather than rounded to nothing. */}
                <button className={`pyq-year-chip ${count === 'all' ? 'selected' : ''}`} onClick={() => setCount('all')}>
                  {t('pyq.countAll')}
                </button>
              </div>
              <button className="primary-button" onClick={startPractice} disabled={busy || (!isExamStyle && !selectedYears.length)}>
                {busy ? <><Loader2 size={16} className="animate-spin" /> {t('pyq.starting')}</> : t('pyq.startPractice')}
              </button>
            </div>
          ) : (
            <PyqExamStart
              avail={avail}
              grade={grade}
              subject={subject}
              subSubject={subSubject}
              onStarted={(id) => { setActiveAttemptId(id); scrollToTop(); }}
            />
          )}
        </>
      )}

      {error && <p className="pyq-error"><AlertCircle size={15} /> {error}</p>}

      {/* ── Practice run ──────────────────────────────────────────────────── */}
      {session && (
        <div className="pyq-run">
          {/* Session-level label. A set containing ANY generated question is labelled
              exam-style for the whole session — never presented as PYQs. */}
          <div className={`pyq-run-banner ${session.mode === 'pyq' ? 'real' : 'generated'}`}>
            {session.mode === 'pyq' ? t('pyq.runRealBanner') : t('pyq.runGeneratedBanner')}
          </div>

          {/* Class 10 Science and Social Science are ONE paper sectioned by
              discipline, so a Geography student's practice is drawn from the
              Geography section of Social Science papers. Said out loud, because
              otherwise the source and the subject appear not to match. */}
          {session.disciplineFilter && (
            <p className="pyq-discipline-note">
              {t('pyq.disciplineFiltered')(session.disciplineFilter, subject)}
            </p>
          )}

          {session.questions.map((q, i) => {
            const fb = feedback[q._id];
            return (
              <article className="pyq-question" key={q._id}>
                <div className="pyq-question-head">
                  <span className="pyq-qnum">{i + 1}</span>
                  {/* Per-question provenance, on every single question. */}
                  <PyqSourceBadge source={q.source} sourceLabel={q.sourceLabel} year={q.year} />
                  {q.marks > 0 && <span className="pyq-marks">{q.marks} {t('pyq.marks')}</span>}
                  {/* Read-aloud through the existing narration path — same payload
                      shape the diagnostic and practice mode use, so PYQ inherits the
                      whole Phase 2 narration-language resolution rather than a
                      parallel one. `diagramAlt` is included for the same reason it
                      is elsewhere: a narrating student asked about "the figure
                      below" must hear what is drawn. For an extracted PYQ figure
                      that alt text is the admin's own words. */}
                  <SpeakerButton
                    key={`speaker-pyq-${q._id}`}
                    fetchPayload={{
                      questionText: q.questionText,
                      options: q.options || [],
                      language,
                      diagramAlt: q.diagramAlt || ''
                    }}
                    subject={subject}
                    size={16}
                  />
                </div>

                <h4>{q.questionText}</h4>

                {/* A real paper's figure is the EXTRACTED image; a generated
                    question's is the SVG. Two fields, never interchanged. */}
                {q.diagramUrl && <img className="pyq-figure" src={q.diagramUrl} alt={q.diagramAlt} />}
                {q.diagramSvg && (
                  <div className="pyq-figure" role="img" aria-label={q.diagramAlt}
                    dangerouslySetInnerHTML={{ __html: q.diagramSvg }} />
                )}

                <div className="pyq-options">
                  {q.options.map((opt, oi) => {
                    const chosen = fb?.selectedIndex === oi;
                    const right = fb && fb.correctIndex === oi;
                    return (
                      <button
                        key={oi}
                        className={`pyq-option ${chosen ? 'chosen' : ''} ${right ? 'correct' : ''} ${chosen && !fb.isCorrect ? 'wrong' : ''}`}
                        onClick={() => answerOne(q, oi)}
                        disabled={!!fb}
                      >
                        {opt}
                        {right && <CheckCircle2 size={15} />}
                        {chosen && !fb.isCorrect && <XCircle size={15} />}
                      </button>
                    );
                  })}
                </div>

                {fb && (fb.explanation || fb.correctAnswer) && (
                  <p className="pyq-explanation">{fb.explanation || fb.correctAnswer}</p>
                )}
              </article>
            );
          })}

          <button className="primary-button" onClick={finishPractice}>{t('pyq.finishPractice')}</button>
        </div>
      )}
    </div>
  );
}

function PyqHeading({ t }) {
  return (
    <div className="pyq-heading">
      <h3><ScrollText size={20} /> {t('pyq.title')}</h3>
      <p>{t('pyq.subtitle')}</p>
    </div>
  );
}

// Exam start: pick a paper (board grade) or confirm the blueprint (non-board).
function PyqExamStart({ avail, grade, subject, subSubject, onStarted }) {
  const { authFetch } = useAuth();
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(null);

  const start = async (paperId, confirmAbandon = false) => {
    setBusy(true);
    setErr('');
    try {
      const res = await authFetch('/pyq/exam/start', {
        method: 'POST',
        body: JSON.stringify({ grade, subject, subSubject, paperId, language, confirmAbandon })
      });
      const data = await res.json();
      if (res.status === 409 && data.error === 'ATTEMPT_ALREADY_IN_PROGRESS') {
        // One active attempt per paper. Resuming is offered FIRST — abandoning
        // destroys work and must be the deliberate choice, not the default.
        setConflict({ ...data, paperId });
        return;
      }
      if (!res.ok) { setErr(t('pyq.startFailed')); return; }
      onStarted(data.attemptId);
    } catch {
      setErr(t('pyq.startFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (conflict) {
    const mins = Math.floor(conflict.secondsRemaining / 60);
    return (
      <div className="pyq-conflict">
        <AlertCircle size={18} />
        <p>
          {t('pyq.attemptInProgress')} — {mins} {t('pyq.minutesLeft')}
          {/* A paused attempt says so, because "45 minutes left" means something very
              different depending on whether those minutes are currently running out. */}
          {conflict.paused && <span className="pyq-paused-badge">{t('pyq.pausedBadge')}</span>}
        </p>
        {conflict.paused && <p className="pyq-conflict-note">{t('pyq.pausedNoTimeLost')}</p>}
        <div className="pyq-conflict-actions">
          <button className="primary-button" onClick={() => onStarted(conflict.attemptId)}>{t('pyq.resume')}</button>
          <button className="ghost-button" onClick={() => { setConflict(null); start(conflict.paperId, true); }}>
            {t('pyq.startFreshAbandon')}
          </button>
        </div>
      </div>
    );
  }

  if (avail.mode === 'exam-style') {
    if (!avail.examAvailable) {
      return <div className="pyq-empty"><p>{t('pyq.noExamForSubject')}</p></div>;
    }
    const bp = avail.blueprint;
    return (
      <div className="pyq-controls">
        <div className="pyq-blueprint">
          <strong>{bp.totalMarks} {t('pyq.marks')} · {bp.durationMinutes} {t('pyq.minutes')}</strong>
          <ul>
            {bp.sections.map((s) => (
              <li key={s.name}>
                {/* A section is either uniform or MIXED. Real Class 10 Science
                    discipline sections run 1-mark MCQs through a 5-mark long
                    answer, so `marksPerQuestion` is 0 there and rendering it would
                    read "16 × 0 marks". Mixed sections show their composition. */}
                {s.name} — {s.marksMix?.length
                  ? `${s.marksMix.reduce((a, m) => a + m.count, 0)} ${t('pyq.questions')} (${s.marksMix.map((m) => `${m.count}×${m.marks}`).join(', ')}) · ${s.totalMarks} ${t('pyq.marks')}`
                  : `${s.questionCount} × ${s.marksPerQuestion} ${t('pyq.marks')}`}
              </li>
            ))}
          </ul>
        </div>
        {/* Says plainly that exiting does not pause the clock, BEFORE they start. */}
        <p className="pyq-timer-warning"><Timer size={14} /> {t('pyq.timerWarning')}</p>
        <button className="primary-button" onClick={() => start(null)} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} {t('pyq.startExam')}
        </button>
        {err && <p className="pyq-error">{err}</p>}
      </div>
    );
  }

  return (
    <div className="pyq-controls">
      <span className="pyq-years-label">{t('pyq.choosePaper')}</span>
      <div className="pyq-paper-list">
        {avail.papers.map((p) => (
          <button key={p._id} className="pyq-paper" onClick={() => start(p._id)} disabled={busy}>
            <strong>{p.year} — {p.title}</strong>
            <span>{p.totalMarks} {t('pyq.marks')} · {p.durationMinutes || 180} {t('pyq.minutes')} · {p.questionCount} {t('pyq.questions')}</span>
          </button>
        ))}
      </div>
      <p className="pyq-timer-warning"><Timer size={14} /> {t('pyq.timerWarning')}</p>
      {err && <p className="pyq-error">{err}</p>}
    </div>
  );
}
