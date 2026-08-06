// Feature 27 — the mentor's persistent presence on the dashboard.
//
// THREE CONTROLS, ALL ICON-LED, ALL ALWAYS VISIBLE:
//   • the avatar        — tap to talk (push-to-talk)
//   • a mute button     — stops the talking instantly
//   • a replay button   — plays the tour again
//
// None of them is behind a long-press, a menu, or a gesture. A child who cannot read
// finds a control by seeing it; a hidden affordance is one they can only find by
// accident, which means most of them never will. That rules out the tidier designs —
// long-press to replay, mute inside a settings sheet — however much less cluttered they
// look to an adult who can read the labels.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Volume2, VolumeX, HelpCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useMentor } from '../context/MentorContext.jsx';
import { translations } from '../data/translations.js';
import { useMentorMic } from '../hooks/useMentorMic.js';
import { subscribe as subscribeNarration } from '../utils/narrationController.js';
import { matchStudyIntent, guidanceLineFor } from '../utils/mentorVoice.js';
import MentorTour from './MentorTour.jsx';
import './VoiceMentor.css';

const AVATAR_SPEAKING = '/chatbot-avatar.png';
// The listening-state asset, when it arrives. Until then the component falls back to
// the speaking avatar plus a pulsing ring — `onError` swaps it, so dropping the file in
// at this path is the entire integration. No lip-sync in either case.
const AVATAR_LISTENING = '/chatbot-avatar-listening.png';

export default function VoiceMentor({ onHighlight }) {
  const mentor = useMentor();
  const { authFetch, token } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.voiceMentor || translations.en.voiceMentor;

  const [context, setContext] = useState(null);
  const [listeningAvatarOk, setListeningAvatarOk] = useState(true);
  const [narrating, setNarrating] = useState(false);
  const [choices, setChoices] = useState(null);   // the two-button fallback
  const startedTour = useRef(false);

  const active = !!mentor?.active;

  // Mirror the narration controller so the avatar shows SPEAKING while a line plays.
  useEffect(() => subscribeNarration((st) => {
    setNarrating(st.status === 'playing' || st.status === 'loading');
  }), []);

  // ── The mentor's knowledge, fetched fresh ──
  // Per mount, and again after the tour, rather than cached in component state for the
  // session: the child may have watched a video or passed a quiz in between, and a
  // mentor working from a stale snapshot sends them to a day they just finished.
  const loadContext = useCallback(async () => {
    if (!active) return null;
    try {
      const res = await authFetch('/mentor-voice/context');
      if (!res.ok) return null;
      const data = await res.json();
      setContext(data.context);
      return data.context;
    } catch {
      return null;
    }
  }, [authFetch, active]);

  useEffect(() => { loadContext(); }, [loadContext]);

  // ── What a spoken answer does ──
  //
  // Deterministic matching, against the child's OWN courses only. No model call, and no
  // guessing at a course they do not have.
  const handleAnswer = useCallback(async (transcript) => {
    if (!transcript?.trim()) {
      // SPEAK **AND** SHOW. Every mentor failure line is a cached line, and on a cold
      // cache (or a device with no local voice) it cannot play — so the device pass saw
      // the control spin and then do nothing at all, with no way to tell whether it had
      // heard anything. The visible fallback is what makes the failure legible when the
      // audio cannot be.
      mentor.speak('mentor.notUnderstood');
      setChoices(true);
      return;
    }

    const ctx = context || (await loadContext());
    const intent = matchStudyIntent(transcript, ctx?.courses || []);

    if (!intent) {
      // NO RE-ASK. Two large tappable answers instead. A child who was not understood
      // once will not be understood better the second time, and an open question they
      // cannot escape is the worst place to leave the person least able to escape it.
      setChoices(true);
      mentor.speak('study.fallback');
      return;
    }

    mentor.memory.lastIntent = intent.kind;

    if (intent.kind === 'practice') { onHighlight?.('practice'); mentor.speak('guide.practice'); return; }
    if (intent.kind === 'notes') { onHighlight?.('my-notes'); return; }

    // A course, or a generic "study". Both resolve to the SAME thing: the current day,
    // derived from real progress.
    onHighlight?.('roadmap');
    const line = guidanceLineFor(ctx);
    // INSTRUCT, NEVER NAVIGATE. The day card is highlighted and the child is told to
    // tap it. The mentor does not tap it for them: a wrong auto-navigation strands a
    // child who cannot read the page they landed on and cannot describe where they are,
    // and unlike every other failure in this feature they have no way to report it.
    if (line !== 'guide.noRoadmap' && ctx?.active?.currentDay) {
      onHighlight?.('roadmap', `day-${ctx.active.currentDay.dayNumber}`);
      await mentor.speak('guide.dayIntro');
    }
    mentor.speak(line);
  }, [context, loadContext, mentor, onHighlight]);

  const mic = useMentorMic({ language: mentor?.language || 'hi', token, onResult: handleAnswer });

  // ── Arrival: the tour, once ──
  useEffect(() => {
    if (!active || startedTour.current) return;
    if (mentor.tourSeen) return;
    startedTour.current = true;
    mentor.setTourRunning(true);
  }, [active, mentor]);

  if (!active) return null;

  const listening = mic.isRecording;
  const avatarSrc = listening && listeningAvatarOk ? AVATAR_LISTENING : AVATAR_SPEAKING;

  const talk = () => {
    if (listening) mic.finish();
    else { setChoices(null); mic.start(); mentor.speak('mentor.greeting'); }
  };

  return (
    <>
      {mentor.tourRunning && (
        <MentorTour
          onHighlight={onHighlight}
          onDone={async () => {
            mentor.setTourRunning(false);
            await mentor.savePrefs({ tourSeen: true });
            const ctx = await loadContext();
            await mentor.speak('study.ask', {
              onEnded: () => { if (mic.hasMicSupport && !mentor.muted) mic.start(); }
            });
            // The tour ends on an open question, so the fallback buttons are offered
            // immediately rather than after a failed answer — a child who does not
            // reply at all still has a visible way forward.
            setChoices(true);
            if (!ctx?.hasRoadmap) mentor.speak('guide.noRoadmap');
          }}
        />
      )}

      <div className="voice-mentor" data-tour="mentor">
        {choices && (
          <div className="vm-choices" role="group" aria-label={t.choicesLabel}>
            <button type="button" className="vm-choice vm-choice-primary"
              onClick={() => { setChoices(null); onHighlight?.('roadmap'); handleAnswer('padhai'); }}>
              <span aria-hidden="true">📖</span><span>{t.choiceStudy}</span>
            </button>
            <button type="button" className="vm-choice"
              onClick={() => { setChoices(null); onHighlight?.('practice'); mentor.speak('guide.practice'); }}>
              <span aria-hidden="true">✏️</span><span>{t.choicePractice}</span>
            </button>
          </div>
        )}

        {mic.recordingNotice && <p className="vm-notice" role="status">{mic.recordingNotice}</p>}

        <div className="vm-controls">
          {/* Replay. ALWAYS VISIBLE and icon-led — never a long-press, which a child
              who cannot read can only discover by accident. */}
          <button type="button" className="vm-side-btn" onClick={() => mentor.setTourRunning(true)}
            aria-label={t.showMeAround} title={t.showMeAround}>
            <HelpCircle size={20} />
          </button>

          <button
            type="button"
            className={`vm-avatar-btn ${listening ? 'is-listening' : ''} ${narrating ? 'is-speaking' : ''}`}
            onClick={talk}
            aria-label={listening ? t.stopListening : t.tapToTalk}
            disabled={!mic.hasMicSupport}
          >
            <img src={avatarSrc} alt="" onError={() => setListeningAvatarOk(false)} />
            {/* The listening indicator carries the state on its own, so the feature is
                complete without the second avatar asset ever arriving. */}
            <span className="vm-state-ring" aria-hidden="true" />
            <span className="vm-mic-badge" aria-hidden="true">
              {listening ? <Loader2 size={14} className="vm-spin" /> : <Mic size={14} />}
            </span>
          </button>

          {/* Mute. Visible, not buried in a menu, and instant — stopNarration fires in
              the context setter rather than waiting for the current line to end. */}
          <button type="button" className="vm-side-btn" onClick={() => mentor.setMuted(!mentor.muted)}
            aria-label={mentor.muted ? t.unmute : t.mute} title={mentor.muted ? t.unmute : t.mute}>
            {mentor.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
      </div>
    </>
  );
}
