// Feature 27 — the microphone that fills ONE onboarding field, and the confirm pass.
//
// Additive to ProfileOnboarding rather than a parallel flow: the written question, the
// avatar, the animation, the Back button and the typed input are all exactly as they
// were. This adds a mic beside the input and speaks the question. TYPING ALWAYS WORKS,
// and voice never becomes the only way to answer anything.
//
// ── THE ORDERING THAT MATTERS ──
//
// `hasLocalVoice` is resolved AT MOUNT, before any confirm prompt is attempted. It is
// never inferred from a prompt failing.
//
// If the read-back is attempted first and only discovered to be silent afterwards, the
// machine has already spent an attempt on silence — and after two of those it hands the
// child over to typing having never told them what went wrong. A playback failure and a
// transcription failure are different failures; only one of them owns the retry budget.
//
// So: no local voice (or a read-back that never starts) => the confirm step is SKIPPED,
// a cached line asks the child to check the value or ask a grown-up, and THE COUNTER IS
// NOT TOUCHED.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Loader2, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useMentor } from '../context/MentorContext.jsx';
import { translations } from '../data/translations.js';
import { useMentorMic } from '../hooks/useMentorMic.js';
import { VOICE_FILLABLE_FIELDS, CONFIRM_READBACK_FIELDS } from '../data/mentorScript.js';
import {
  createConfirmMachine, matchYesNo, readBack, extractName, matchAge, matchBoard
} from '../utils/mentorVoice.js';
import './VoiceMentor.css';

export default function MentorFieldMic({ field, lineId, boards = [], value, onValue, onHandover }) {
  const mentor = useMentor();
  const { token } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.voiceMentor || translations.en.voiceMentor;

  const [stage, setStage] = useState('idle');   // 'idle' | 'listening' | 'confirming'
  const [pending, setPending] = useState(null); // the parsed value awaiting confirmation
  const machine = useRef(createConfirmMachine());
  const askedRef = useRef(false);

  const active = !!mentor?.active;
  // AADHAAR IS NEVER VOICE-INPUT. Enforced by ABSENCE from the allow-list, not by a
  // special case here — a `field` not on the list renders no microphone at all, so the
  // control cannot exist for it. CI invariant 19 asserts `aadhaarNumber` and
  // `aadhaarConsent` are absent from that list.
  const fillable = VOICE_FILLABLE_FIELDS.includes(field);
  const needsConfirm = CONFIRM_READBACK_FIELDS.includes(field);

  // ── A2: the microphone opens BY ITSELF when the question finishes ────────
  //
  // A child who cannot read the screen cannot find and press a microphone button
  // either — the button is as unreadable as everything else. Requiring a press before
  // they may answer puts an unreadable obstacle between the question and the answer.
  //
  // AUTO-ACTIVATION IS SCOPED TO QUESTION-ASK LINES ONLY, and this is the boundary that
  // matters: it hangs off THIS effect, which fires once when a field asks its question.
  // Narration in general never opens the mic — a mic that opened after every spoken
  // line would be an open microphone in a classroom by another name, which is both the
  // expensive path and the one that false-triggers on thirty other children.
  //
  // It starts only AFTER the line finishes (`onEnded`), never alongside it, or the
  // recogniser hears the mentor's own voice and transcribes the question back.
  useEffect(() => {
    if (!active || !lineId || askedRef.current) return;
    askedRef.current = true;
    machine.current.reset();
    mentor.speak(lineId, {
      onEnded: () => {
        if (!fillable || !mic.hasMicSupport || mentor.muted) return;
        mic.start();
        setStage('listening');
      }
    });
    // `mic` is intentionally excluded: including it re-runs this effect on every
    // recording state change, which would re-ask the question mid-answer. `askedRef`
    // guards the once-only contract; the closure only needs `start`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lineId, mentor, fillable]);

  // Re-opening the microphone after the mentor speaks again. Held in a ref because the
  // callbacks that use it are created before `mic` exists, and because rebuilding them
  // whenever the recording state changes would re-trigger the ask effect mid-answer.
  const reopenRef = useRef(() => {});
  const reopenMic = useCallback(() => reopenRef.current(), []);

  const accept = useCallback((v) => {
    setPending(null);
    setStage('idle');
    onValue?.(v);
    mentor.speak('confirm.ok');
  }, [onValue, mentor]);

  /** Two attempts spent. Hand to typing with a friendly line — never a third loop. */
  const handover = useCallback(() => {
    setPending(null);
    setStage('idle');
    mentor.speak('confirm.handover');
    onHandover?.();
  }, [mentor, onHandover]);

  const parse = useCallback((transcript) => {
    if (field === 'age') return matchAge(transcript);
    if (field === 'studyMedium') return matchBoard(transcript, boards);
    // Names and places: keep the SCRIPT the child spoke in. "mera naam Satu hai" stores
    // "Satu"; "मेरा नाम सातु है" stores "सातु". Transliterating someone's own name into
    // the other script is not normalisation, it is getting it wrong.
    return extractName(transcript);
  }, [field, boards]);

  const startConfirm = useCallback(async (v) => {
    // ── THE BRANCH. Checked BEFORE attempting, never after failing. ──
    if (!needsConfirm || mentor.hasLocalVoice === false) {
      // No read-back is possible, so there is no confirm step to run. The value is
      // accepted and shown enlarged in its own field; a cached line asks the child to
      // check it or ask a grown-up. No attempt is spent, because none was made.
      setPending(null);
      setStage('idle');
      onValue?.(v);
      if (needsConfirm) mentor.speak('confirm.checkWithGrownup');
      return;
    }

    setPending(v);
    setStage('confirming');
    onValue?.(v);   // fill the field NOW — the child should see it while they hear it

    const spoke = await readBack(String(v), {
      lang: mentor.language,
      carrier: (val) => (mentor.language === 'hi' ? `मैंने सुना — ${val}। सही है?` : `I heard — ${val}. Is that right?`),
      // Listen for the yes/no only once the question has finished being asked.
      onEnded: () => reopenMic()
    });

    // The watchdog in narrationController says the utterance never started: a voice
    // that exists but is muted, dead, or a WebView that accepts speak() and does
    // nothing. Same branch as no voice at all, and the SAME refusal to spend an attempt.
    if (!spoke) {
      setPending(null);
      setStage('idle');
      mentor.speak('confirm.checkWithGrownup');
    }
  }, [needsConfirm, mentor, onValue]);

  const onResult = useCallback((transcript) => {
    if (stage === 'confirming') {
      const yn = matchYesNo(transcript);
      if (yn === true) { accept(pending); return; }
      if (yn === false) {
        // A genuine "no" — the only thing that spends an attempt.
        const next = machine.current.onNegative();
        if (next === 'handover') { handover(); return; }
        setPending(null);
        mentor.speak('confirm.retry', { onEnded: () => reopenMic() });
        return;
      }
      // Neither yes nor no. Treated as a no-match rather than a refusal, so it does not
      // silently consume the budget on an ambiguous noise.
      mentor.speak('mentor.notUnderstood', { onEnded: () => reopenMic() });
      return;
    }

    const parsed = parse(transcript);
    if (parsed === null || parsed === '' || parsed === undefined) {
      const next = machine.current.onNegative();
      if (next === 'handover') { handover(); return; }
      mentor.speak('confirm.retry', { onEnded: () => reopenMic() });
      return;
    }
    startConfirm(parsed);
  }, [stage, pending, accept, handover, parse, startConfirm, mentor]);

  const mic = useMentorMic({ language: mentor?.language || 'hi', token, onResult });

  reopenRef.current = () => {
    if (!fillable || !mic.hasMicSupport || mentor?.muted) { setStage('idle'); return; }
    mic.start();
    setStage('listening');
  };

  if (!active || !fillable) return null;

  const listening = mic.isRecording;

  return (
    <div className="mentor-field-mic">
      <button
        type="button"
        className={`mfm-btn ${listening ? 'is-listening' : ''}`}
        onClick={() => {
          if (listening) { mic.finish(); setStage('idle'); }
          else { mic.start(); setStage('listening'); }
        }}
        aria-label={listening ? t.stopListening : t.tapToTalk}
        disabled={!mic.hasMicSupport}
      >
        {listening ? <Loader2 size={18} className="vm-spin" /> : <Mic size={18} />}
      </button>

      {stage === 'confirming' && pending !== null && (
        // Shown ENLARGED. When there is no local voice this is the only feedback the
        // child (or the parent beside them) has, so it cannot be the same size as the
        // rest of the form.
        <span className="mfm-heard" aria-live="polite">
          <Check size={16} /> <strong>{String(pending)}</strong>
        </span>
      )}

      {/* The written prompt always accompanies the spoken one. Voice is never the only
          way to answer, and a parent sitting alongside is an expected reader. */}
      {mic.recordingNotice && <span className="mfm-notice" role="status">{mic.recordingNotice}</span>}
    </div>
  );
}
