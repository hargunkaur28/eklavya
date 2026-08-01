import { useState, useEffect, useRef, useCallback } from 'react';
import { useScrollToResult } from '../utils/useScrollToResult.js';
import { Loader2, Timer, LogOut, Send, AlertCircle, CheckCircle2, XCircle, Pause, Play, Maximize, Minimize } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { stopNarration } from '../utils/narrationController.js';
import PyqSourceBadge from './PyqSourceBadge.jsx';
import SpeakerButton from './SpeakerButton.jsx';
import MicButton from './MicButton.jsx';

// Workstream I6 — the exam runner.
//
// ── THE CLIENT DOES NOT OWN THE CLOCK ───────────────────────────────────────
//
// It receives `secondsRemaining` from the server and ticks it down locally ONLY so
// the number moves between requests. That local countdown is cosmetic:
//
//   • It is RE-SYNCED from the server on every answer save, so drift never
//     accumulates and a throttled background tab catches up the moment it wakes.
//   • It is re-fetched on mount, so a resume shows true remaining time rather than
//     a fresh duration.
//   • Reaching zero locally does not end anything. It asks the server, which decides.
//     A student whose system clock is wrong (or edited) changes nothing but their own
//     display; every answer is checked against the server deadline anyway.
//
// The alternative — trusting a client-side deadline — fails in the one case that has
// to work, which is the tab being closed.
export default function PyqExam({ attemptId, onExit, onFinished }) {
  const { authFetch } = useAuth();
  const { t, language } = useLanguage();

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remaining, setRemaining] = useState(0);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const submittedRef = useRef(false);
  const rootRef = useRef(null);

  // ── FOCUS MODE ────────────────────────────────────────────────────────────
  // The exam takes the whole viewport: no sidebar, no dashboard header, no bottom
  // nav, no floating assistant. Driven by a class on <body> rather than by props
  // because the chat widget is mounted GLOBALLY in App.jsx, outside the dashboard
  // tree — there is no prop path from here to it, and threading one through would
  // couple the exam to the app shell for a purely presentational concern.
  //
  // Removed on unmount, so submitting, exiting, or the component being torn down any
  // other way all restore the normal chrome by the same path. There is no second
  // place that has to remember to undo it.
  const inProgress = !results && state?.status === 'in_progress';
  useEffect(() => {
    if (!inProgress) return undefined;
    document.body.classList.add('exam-focus');
    return () => document.body.classList.remove('exam-focus');
  }, [inProgress]);

  // ── STOP ANY NARRATION STILL PLAYING ─────────────────────────────────────
  // The app stops narration on a PATHNAME change (App.jsx) and on a dashboard
  // SECTION change (RoadmapDashboard). Entering an exam is NEITHER: the student is
  // already on /dashboard with the PYQ section open, and starting an attempt only
  // swaps what that section renders.
  //
  // Most in-section swaps are covered by accident rather than by those two hooks:
  // SpeakerButton stops playback when it unmounts IF it owns it, so replacing a view
  // full of speaker buttons takes its audio with it.
  //
  // THE CASE THAT IS NOT COVERED, and the reason this line exists: the CHAT WIDGET.
  // It is mounted globally in App.jsx, outside Routes and outside the dashboard
  // tree, and focus mode hides it with `display: none` — which does NOT unmount it.
  // So an assistant reply being read aloud keeps playing, with its stop button now
  // invisible, for the whole exam. No unmount fires, no pathname changes, no section
  // changes; nothing else in the app would have stopped it.
  //
  // Safe unconditionally — unlike the pathname case there is nothing about to
  // auto-start, since exam mode has no auto-narration of its own to kill.
  useEffect(() => { stopNarration(); }, []);

  // ── Load / resume ─────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    authFetch(`/pyq/exam/${attemptId}?lang=${language}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.results) { setResults(d.results); setState({ status: d.status }); return; }
        setState(d);
        setRemaining(d.secondsRemaining || 0);
        setPaused(!!d.paused);   // a paper paused before a reload comes back paused
        // Every answer already entered comes back — a closed laptop loses nothing.
        const restored = {};
        for (const a of d.answers || []) {
          restored[String(a.questionId)] = { selectedIndex: a.selectedIndex, writtenAnswer: a.writtenAnswer };
        }
        setAnswers(restored);
      })
      .catch(() => alive && setError(t('pyq.loadFailed')))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [attemptId, authFetch, language, t]);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const localDate = new Date().toLocaleDateString('en-CA');
      const res = await authFetch(`/pyq/exam/${attemptId}/submit`, {
        method: 'POST', body: JSON.stringify({ localDate, language })
      });
      const d = await res.json();
      if (res.ok) { setResults(d.results); setState({ status: d.status }); }
      else setError(t('pyq.submitFailed'));
    } catch {
      setError(t('pyq.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, authFetch, language, t]);

  // ── Local tick ────────────────────────────────────────────────────────────
  // Display only. On reaching zero it SUBMITS — which asks the server to finalise;
  // it does not decide locally that the exam is over. Stops entirely while paused,
  // which is cosmetic: the server's deadline slides by the paused time regardless,
  // so the two agree without the client being trusted.
  useEffect(() => {
    if (results || !state || state.status !== 'in_progress' || paused) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(id); submit(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [results, state, submit, paused]);

  // ── REAL BROWSER FULLSCREEN (opt-in, on top of focus mode) ───────────────
  //
  // Deliberately a BUTTON, not automatic on exam start: requestFullscreen() requires
  // a user gesture and is rejected outright without one, so an automatic call would
  // fail silently on every browser and leave a control that appears broken.
  //
  // Support is DETECTED rather than assumed. iOS Safari on iPhone has no Fullscreen
  // API at all (iPad does), so the button is hidden there instead of shown and inert
  // — focus mode already provides most of the benefit on a phone.
  const fullscreenSupported = typeof document !== 'undefined'
    && !!document.fullscreenEnabled
    && typeof document.documentElement.requestFullscreen === 'function';

  // Escape exits fullscreen natively and CANNOT be prevented, so the only reliable
  // source of truth is the browser's own event. Nothing sets this optimistically.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      // Leaving the exam must not strand the browser in fullscreen.
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // A rejected request (no gesture, or blocked by policy) leaves focus mode
      // exactly as it was. Fullscreen is an enhancement, never a requirement.
    }
  };

  // Pause / resume. Both re-sync the remaining time from the server response rather
  // than adjusting it locally, so the displayed clock always comes from the authority.
  const togglePause = async () => {
    if (pauseBusy) return;
    setPauseBusy(true);
    try {
      const res = await authFetch(`/pyq/exam/${attemptId}/${paused ? 'resume' : 'pause'}`, { method: 'POST' });
      const d = await res.json();
      if (res.status === 409 && d.error === 'ATTEMPT_EXPIRED') { setRemaining(0); submit(); return; }
      if (!res.ok) { setError(t('pyq.pauseFailed')); return; }
      setPaused(!!d.paused);
      if (typeof d.secondsRemaining === 'number') setRemaining(d.secondsRemaining);
    } catch {
      setError(t('pyq.pauseFailed'));
    } finally { setPauseBusy(false); }
  };

  // ── Leaving mid-paper ──────────────────────────────────────────────────────
  // Exit used to leave immediately with the clock running, and said so only in a
  // tooltip. In a learning app the ordinary reason to leave is "something came up",
  // and the student's real question is "will I lose my place?" — so the choice is put
  // in front of them rather than left to a hover.
  //
  // Pausing FIRST and exiting second matters: if the pause request fails we must not
  // leave anyway, because the student was promised a stopped clock and would come back
  // to a drained one. So the exit only happens once the server has confirmed the pause.
  const exitPaused = async () => {
    if (pauseBusy) return;
    if (paused) { onExit(); return; }        // already stopped; nothing to confirm
    setPauseBusy(true);
    try {
      const res = await authFetch(`/pyq/exam/${attemptId}/pause`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.error === 'ATTEMPT_EXPIRED') { setRemaining(0); submit(); return; }
      if (!res.ok) { setError(t('pyq.pauseFailed')); setConfirmExit(false); return; }
      setPaused(true);
      onExit();
    } catch {
      // Stay put and surface it. Exiting on a failed pause is the one outcome that
      // silently costs the student time they were told they would keep.
      setError(t('pyq.pauseFailed'));
      setConfirmExit(false);
    } finally { setPauseBusy(false); }
  };

  // Persist EVERY answer as it is entered, not on submit. A closed laptop must not
  // cost an hour of work.
  const saveAnswer = async (q, patch) => {
    setAnswers((a) => ({ ...a, [q._id]: { ...a[q._id], ...patch } }));
    try {
      const res = await authFetch(`/pyq/exam/${attemptId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ questionId: q._id, sectionName: q.sectionName, ...patch })
      });
      const d = await res.json();
      if (res.status === 409 && d.error === 'ATTEMPT_EXPIRED') {
        // The server refused it. Time really is up, whatever the local number says.
        setRemaining(0);
        submit();
        return;
      }
      // Re-sync from the authority on every save, so local drift cannot accumulate.
      if (typeof d.secondsRemaining === 'number') setRemaining(d.secondsRemaining);
    } catch { /* answer stays in local state; the next save retries it */ }
  };

  if (loading) return <div className="pyq-panel"><Loader2 className="animate-spin" size={20} /> {t('pyq.loading')}</div>;

  if (results) return <PyqResults results={results} onDone={onFinished} t={t} />;

  if (!state?.questions) {
    return <div className="pyq-panel"><p className="pyq-error">{error || t('pyq.loadFailed')}</p></div>;
  }

  // Minutes WITHIN the hour, not total minutes. This read `remaining / 60` and
  // rendered a 2h48m clock as "02:168:35" — the hours were shown and then counted
  // again in the minutes field. Obvious once seen, invisible while the test paper
  // was under an hour, which is why it survived: every automated check so far used
  // a 10-minute attempt, where total minutes and minutes-within-hour are identical.
  const hh = String(Math.floor(remaining / 3600)).padStart(2, '0');
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const answeredCount = Object.values(answers).filter(
    (a) => a && (a.selectedIndex !== null && a.selectedIndex !== undefined) || (a?.writtenAnswer || '').trim()
  ).length;

  // Group by the paper's OWN sections — this is the layout a student should
  // recognise as their exam. Within a section, alternatives of an internal-choice
  // question are grouped so they render as ONE numbered question with an "OR"
  // between them, which is how the paper prints it.
  const sections = [];
  for (const q of state.questions) {
    const name = q.sectionName || t('pyq.paperSection');
    let s = sections.find((x) => x.name === name);
    if (!s) { s = { name, groups: [] }; sections.push(s); }
    const key = q.choiceGroup || q._id;
    let g = s.groups.find((x) => x.key === key);
    if (!g) { g = { key, alternatives: [] }; s.groups.push(g); }
    g.alternatives.push(q);
  }
  for (const s of sections) {
    for (const g of s.groups) g.alternatives.sort((a, b) => (a.choiceIndex || 0) - (b.choiceIndex || 0));
  }

  // Which alternative (if any) the student has already engaged with in a group.
  // A real paper says attempt only one, so answering one closes the other rather
  // than silently letting both be filled in and the server discarding the second.
  const answeredAlternative = (group) => group.alternatives.find((alt) => {
    const a = answers[alt._id];
    return a && (a.selectedIndex !== null && a.selectedIndex !== undefined || (a.writtenAnswer || '').trim());
  });

  return (
    <div className="pyq-panel pyq-exam" ref={rootRef}>
      <div className="pyq-exam-bar">
        <div className={`pyq-exam-timer ${remaining < 300 ? 'urgent' : ''}`}>
          <Timer size={18} />
          <strong>{hh}:{mm}:{ss}</strong>
        </div>
        <span className="pyq-exam-progress">{answeredCount}/{state.questions.length} {t('pyq.answered')}</span>
        <div className="pyq-exam-actions">
          {/* Pause stops the clock. This is a learning app — a student who has to
              stop should not lose the paper. Answering is disabled while paused,
              enforced server-side, so it is a real pause and not the timer switched
              off while the work continues. */}
          <button
            className={`ghost-button ${paused ? 'pyq-resume-btn' : ''}`}
            onClick={togglePause}
            disabled={pauseBusy || submitting}
            title={paused ? t('pyq.resumeHint') : t('pyq.pauseHint')}
            aria-label={paused ? t('pyq.resumeExam') : t('pyq.pause')}
          >
            {pauseBusy ? <Loader2 size={15} className="animate-spin" />
              : paused ? <Play size={15} /> : <Pause size={15} />}
            <span className="pyq-btn-label">{paused ? t('pyq.resumeExam') : t('pyq.pause')}</span>
          </button>
          {/* Exit leaves the attempt OPEN. The clock keeps running unless you paused
              first — the two buttons do different things and the tooltips say so. */}
          {/* Hidden entirely where the API does not exist (iPhone), rather than
              shown and doing nothing. */}
          {/* Labels sit in their own span so a narrow screen can drop them and leave
              an icon-only button — the same pattern `.back-label` uses on the course
              header. `aria-label` carries the full text either way, so hiding it
              visually never removes it from the accessibility tree. Four buttons at
              360px do not fit with labels, and the Submit button was being clipped. */}
          {fullscreenSupported && (
            <button
              className="ghost-button"
              onClick={toggleFullscreen}
              title={isFullscreen ? t('pyq.exitFullscreenHint') : t('pyq.fullscreenHint')}
              aria-label={isFullscreen ? t('pyq.exitFullscreen') : t('pyq.fullscreen')}
            >
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
              <span className="pyq-btn-label">{isFullscreen ? t('pyq.exitFullscreen') : t('pyq.fullscreen')}</span>
            </button>
          )}
          <button
            className="ghost-button"
            onClick={() => setConfirmExit(true)}
            title={paused ? t('pyq.exitWarningPaused') : t('pyq.exitWarning')}
            aria-label={t('pyq.exit')}
          >
            <LogOut size={15} /> <span className="pyq-btn-label">{t('pyq.exit')}</span>
          </button>
          {/* Submit keeps its label at every width — it is the one action a student
              must never have to guess at from an icon. */}
          <button className="primary-button" onClick={submit} disabled={submitting} aria-label={t('pyq.submit')}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t('pyq.submit')}
          </button>
        </div>
      </div>

      {/* The standing warning is about the clock, so it must not keep saying the clock
          runs once it has been stopped — that is the sentence a paused student is most
          likely to read, and it would be false. */}
      <p className="pyq-timer-warning">
        <AlertCircle size={14} /> {paused ? t('pyq.exitWarningPaused') : t('pyq.exitWarning')}
      </p>

      {/* ── Leave dialog ──────────────────────────────────────────────────
          Two outcomes, each labelled by what it DOES to the clock rather than by
          "yes"/"no". A student mid-paper is deciding about their time, not confirming
          an intention they already stated by clicking Exit. */}
      {confirmExit && (
        <div className="pyq-modal-backdrop" onClick={() => !pauseBusy && setConfirmExit(false)}>
          <div className="pyq-modal" role="dialog" aria-modal="true" aria-label={t('pyq.leaveTitle')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('pyq.leaveTitle')}</h3>
            <p className="pyq-modal-body">{t('pyq.leaveBody')}</p>

            <button className="pyq-modal-choice primary" onClick={exitPaused} disabled={pauseBusy}>
              {pauseBusy ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}
              <span>
                <strong>{paused ? t('pyq.saveAndExit') : t('pyq.pauseAndExit')}</strong>
                <small>{paused ? t('pyq.saveAndExitHint') : t('pyq.pauseAndExitHint')}</small>
              </span>
            </button>

            {/* Only offered when the clock is actually running — after a pause it would
                be an invitation to throw away time for no reason. */}
            {!paused && (
              <button className="pyq-modal-choice" onClick={onExit} disabled={pauseBusy}>
                <LogOut size={16} />
                <span>
                  <strong>{t('pyq.exitClockRuns')}</strong>
                  <small>{t('pyq.exitClockRunsHint')}</small>
                </span>
              </button>
            )}

            <button className="ghost-button pyq-modal-cancel" onClick={() => setConfirmExit(false)} disabled={pauseBusy}>
              {t('pyq.stayHere')}
            </button>
          </div>
        </div>
      )}

      {/* ── Paused ────────────────────────────────────────────────────────
          The questions are COVERED, not merely un-clickable. A pause that leaves
          the paper readable is just the clock switched off while the student keeps
          working, which produces a timed-looking result that was not timed — and
          the person it misleads is the student. The server refuses answers while
          paused regardless; this makes the rule visible instead of a surprise. */}
      {paused && (
        <div className="pyq-paused-overlay">
          <Pause size={30} />
          <h3>{t('pyq.pausedTitle')}</h3>
          <p>{t('pyq.pausedDesc')}</p>
          <p className="pyq-paused-clock">{hh}:{mm}:{ss} {t('pyq.remaining')}</p>
          <div className="pyq-paused-actions">
            <button className="primary-button" onClick={togglePause} disabled={pauseBusy}>
              {pauseBusy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {t('pyq.resumeExam')}
            </button>
            {/* The whole point of pausing is often "I need to stop now". Without this the
                student has to resume — restarting the clock — before they can leave, or
                hunt for Exit behind the overlay. */}
            <button className="ghost-button" onClick={onExit} disabled={pauseBusy}>
              <LogOut size={15} /> {t('pyq.saveAndExit')}
            </button>
          </div>
          <p className="pyq-paused-hint">{t('pyq.saveAndExitHint')}</p>
        </div>
      )}

      {state.mode !== 'pyq' && (
        <div className="pyq-run-banner generated">{t('pyq.runGeneratedBanner')}</div>
      )}

      {/* Exam mode serves the WHOLE paper even when the student studies one
          discipline of it — a "Geography-only exam" does not exist. Explained
          up front, or a Geography student meets History questions and reasonably
          concludes the app served the wrong paper. */}
      {state.fullPaperNotice && (
        <div className="pyq-run-banner real">
          {t('pyq.fullPaperNotice')(state.fullPaperNotice.subSubject, state.fullPaperNotice.subject)}
        </div>
      )}

      {!paused && sections.map((s) => (
        <section className="pyq-exam-section" key={s.name}>
          <h4>{s.name}</h4>
          {s.groups.map((group) => {
            const chosen = answeredAlternative(group);
            const hasChoice = group.alternatives.length > 1;
            return (
              <article className="pyq-question" key={group.key}>
                <div className="pyq-question-head">
                  <span className="pyq-qnum">{group.alternatives[0].questionNumber || ''}</span>
                  <PyqSourceBadge
                    source={group.alternatives[0].source}
                    sourceLabel={group.alternatives[0].sourceLabel}
                    year={group.alternatives[0].year}
                  />
                  {group.alternatives[0].marks > 0 && (
                    <span className="pyq-marks">{group.alternatives[0].marks} {t('pyq.marks')}</span>
                  )}
                  {hasChoice && <span className="pyq-choice-hint">{t('pyq.attemptOneOnly')}</span>}
                </div>

                {group.alternatives.map((q, ai) => {
                  // Once one alternative is answered the other is locked, because
                  // the paper says attempt only one and the server marks the first
                  // attempted. Locking is honest about that rather than letting a
                  // student fill in both and quietly discarding one.
                  const locked = hasChoice && chosen && chosen._id !== q._id;
                  return (
                    <div className={`pyq-alternative ${locked ? 'locked' : ''}`} key={q._id}>
                      {ai > 0 && <div className="pyq-or-divider"><span>{t('pyq.or')}</span></div>}
                      <div className="pyq-q-head">
                        <h4>{q.questionText}</h4>
                        {/* Reading a full board paper is a lot of text; a student who
                            reads slowly loses exam time to decoding rather than to
                            answering. Keyed by question id so switching questions
                            starts a new narration instead of resuming the old one. */}
                        <SpeakerButton
                          key={q._id}
                          ttsText={q.questionText}
                          fallbackText={q.questionText}
                          subject={state?.subject || ''}
                          className="pyq-speaker"
                          size={16}
                        />
                      </div>
                      {q.diagramUrl && <img className="pyq-figure" src={q.diagramUrl} alt={q.diagramAlt} />}
                      {q.diagramSvg && (
                        <div className="pyq-figure" role="img" aria-label={q.diagramAlt}
                          dangerouslySetInnerHTML={{ __html: q.diagramSvg }} />
                      )}

                      {q.options.length ? (
                        <div className="pyq-options">
                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              className={`pyq-option ${answers[q._id]?.selectedIndex === oi ? 'chosen' : ''}`}
                              onClick={() => saveAnswer(q, { selectedIndex: oi })}
                              disabled={locked}
                            >{opt}</button>
                          ))}
                        </div>
                      ) : (
                        <textarea
                          className="pyq-written"
                          rows={q.marks >= 5 ? 8 : 4}
                          placeholder={locked ? t('pyq.otherAlternativeChosen') : t('pyq.writtenPlaceholder')}
                          disabled={locked}
                          value={answers[q._id]?.writtenAnswer || ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q._id]: { ...a[q._id], writtenAnswer: e.target.value } }))}
                          // Saved on blur rather than per keystroke: one request per
                          // answer instead of one per character, and blur fires
                          // before a tab close in every browser this app targets.
                          onBlur={(e) => saveAnswer(q, { writtenAnswer: e.target.value })}
                        />
                      )}
                      {!q.options.length && (
                        <MicButton
                          value={answers[q._id]?.writtenAnswer || ''}
                          disabled={locked}
                          onTranscript={(text) => {
                            setAnswers((a) => ({ ...a, [q._id]: { ...a[q._id], writtenAnswer: text } }));
                            // Dictation never fires blur, so without this an answer
                            // spoken and then submitted straight away is never saved.
                            saveAnswer(q, { writtenAnswer: text });
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </section>
      ))}

      {error && <p className="pyq-error">{error}</p>}
    </div>
  );
}

/** "2h 58m" / "41m" / "35s" — compact, and never a bare seconds count for an exam. */
function fmtDuration(totalSeconds, t) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}${t('pyq.hShort')} ${m}${t('pyq.mShort')}`;
  if (m) return `${m}${t('pyq.mShort')}`;
  return `${s}${t('pyq.sShort')}`;
}

// Section-wise breakdown mirroring the real marking scheme, not just a total.
function PyqResults({ results, onDone, t }) {
  // Submitting swaps the paper for the results at the SAME scroll offset, and the
  // student is by definition near the bottom of a long paper when they submit — so
  // the score lands off-screen above them.
  const resultRef = useScrollToResult(true);
  return (
    <div className="pyq-panel">
      <div ref={resultRef} className="pyq-heading">
        <h3>{results.status === 'expired' ? t('pyq.resultsExpired') : t('pyq.resultsTitle')}</h3>
        <p className="pyq-score">{results.marksAwarded}/{results.marksAvailable} {t('pyq.marks')}</p>

        {/* How the paper was actually sat. A strong score achieved with heavy
            pausing is not a straight three-hour performance, and the student is the
            person entitled to know that — so it is stated plainly next to the mark
            rather than buried or omitted. Shown even with zero pauses, because
            "0 pauses" is itself the useful signal. */}
        <p className="pyq-time-summary">
          {fmtDuration(results.activeSeconds, t)} {t('pyq.ofExamTime')}
          {results.pauseCount > 0
            ? ` · ${t('pyq.pausedTimes')(results.pauseCount, fmtDuration(results.pausedSeconds, t))}`
            : ` · ${t('pyq.noPauses')}`}
        </p>
      </div>

      {results.mode !== 'pyq' && <div className="pyq-run-banner generated">{t('pyq.runGeneratedBanner')}</div>}

      <table className="pyq-section-table">
        <thead>
          <tr>
            <th>{t('pyq.section')}</th><th>{t('pyq.marks')}</th>
            <th>{t('pyq.attempted')}</th><th>{t('pyq.timeSpent')}</th>
          </tr>
        </thead>
        <tbody>
          {results.sectionScores.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td>{s.marksAwarded}/{s.marksAvailable}</td>
              <td>{s.questionsAttempted}/{s.questionsTotal}</td>
              {/* Approximate by construction — first-to-last answer in the section.
                  Labelled with a tilde rather than presented as a stopwatch. */}
              <td>{s.secondsSpent ? `~${Math.round(s.secondsSpent / 60)} ${t('pyq.min')}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pyq-review">
        {results.questions.map((q, i) => (
          <article className="pyq-question" key={q._id}>
            <div className="pyq-question-head">
              <span className="pyq-qnum">{i + 1}</span>
              <PyqSourceBadge source={q.source} sourceLabel={q.sourceLabel} year={q.year} />
              {q.autoScored
                ? (q.isCorrect ? <CheckCircle2 size={16} className="pyq-ok" /> : <XCircle size={16} className="pyq-bad" />)
                // Written answers are shown for self-review, never machine-marked —
                // see finaliseAttempt on the server for why.
                : <span className="pyq-selfmark">{t('pyq.selfReview')}</span>}
            </div>
            <h4>{q.questionText}</h4>
            {q.diagramUrl && <img className="pyq-figure" src={q.diagramUrl} alt={q.diagramAlt} />}
            {q.options?.length > 0 && (
              <div className="pyq-options">
                {q.options.map((opt, oi) => (
                  <div key={oi} className={`pyq-option ${oi === q.correctIndex ? 'correct' : ''} ${oi === q.selectedIndex && oi !== q.correctIndex ? 'wrong' : ''}`}>
                    {opt}
                  </div>
                ))}
              </div>
            )}
            {q.writtenAnswer && <p className="pyq-your-answer"><strong>{t('pyq.yourAnswer')}:</strong> {q.writtenAnswer}</p>}
            {(q.explanation || q.correctAnswer) && (
              <p className="pyq-explanation">{q.explanation || q.correctAnswer}</p>
            )}
          </article>
        ))}
      </div>

      <button className="primary-button" onClick={onDone}>{t('pyq.done')}</button>
    </div>
  );
}
