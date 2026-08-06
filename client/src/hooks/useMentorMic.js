// Feature 27 — push-to-talk for the mentor.
//
// A thin wrapper over the EXISTING `useSpeechInput` (Feature 21), not a replacement.
// That hook already owns the dual-path STT logic — live SpeechRecognition, falling back
// to MediaRecorder plus Sarvam — and CI invariant 18 is scoped to files holding a
// MediaRecorder. A second recording implementation would be a second file for that
// invariant to learn about, and a second place for a child's audio to be mishandled.
//
// ── WHY THIS FILE WAS REWRITTEN (device testing, A1) ────────────────────────
//
// The first version delivered the transcript from `finish()`, and `finish()` ran only
// from the microphone button's onClick. **The transcript was captured correctly and
// then thrown away**, because a recording session ends by four routes and only one of
// them is a button press:
//
//   1. the user presses stop                      -> finish()
//   2. `recognition.onend` fires on its own       -> NOTHING
//   3. the 45s/30s auto-stop timer                -> NOTHING
//   4. `recognition.onerror`                      -> NOTHING
//
// Route 2 is not an edge case: **Android Chrome ends the session after a pause even
// with `continuous: true`**, which is the single commonest way a child's answer ends.
// So `onresult` fired, the text sat in `latest.current`, and nothing ever handed it on.
// Worse, `isRecording` had already flipped to false, so the button read "start" again —
// pressing it began a NEW capture rather than submitting the old one. There was no
// sequence of presses that could complete the loop.
//
// A SECOND, INDEPENDENT DEFECT on the MediaRecorder path — every device without
// `SpeechRecognition`, i.e. most Android WebViews and all iOS Safari: `finish()` waited
// a fixed 700ms and then read `latest.current`. But `mediaRecorder.onstop` POSTs to
// `/chat/stt` and resolves only after a network round-trip, so 700ms was essentially
// always too short and it delivered the empty string.
//
// THE RULE THIS NOW ENCODES: **delivery is bound to the RECORDER ENDING, not to a UI
// event** — and it waits for the transcript to arrive rather than for a fixed delay.
// A UI event is a proxy for "the answer is finished"; the recorder ending is the thing
// itself. (Same shape as the two proxy failures under Design Rule 11.)

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechInput } from './useSpeechInput.js';

// How long to wait, AFTER recording stops, for a transcript that may still be in
// flight. Sized for the MediaRecorder path: the blob is POSTed to /chat/stt on stop and
// the round-trip is seconds, not milliseconds, on the connections this deployment
// targets. Delivering early means dropping an answer the child actually gave, which is
// strictly worse than a pause — they would be asked to repeat something that worked.
const TRANSCRIPT_WAIT_MS = 8000;

// Once text has arrived, a short settle for late chunks before handing it on.
const SETTLE_MS = 250;

export function useMentorMic({ language = 'hi', token, onResult }) {
  const [transcript, setTranscript] = useState('');
  // The latest transcript, read at delivery time. State alone is stale inside the
  // timers and callbacks that end the turn.
  const latest = useRef('');
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Exactly one delivery per capture. Starts `true` so a mount, a re-render or a
  // spurious state change cannot deliver an answer nobody gave.
  const delivered = useRef(true);
  const wasRecording = useRef(false);
  const settleTimer = useRef(null);
  const deadlineTimer = useRef(null);

  const clearTimers = () => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (deadlineTimer.current) { clearTimeout(deadlineTimer.current); deadlineTimer.current = null; }
  };

  const handleTranscript = useCallback((text) => {
    latest.current = text;
    setTranscript(text);
  }, []);

  const { isRecording, hasMicSupport, recordingNotice, toggleRecording, stopRecording } =
    useSpeechInput({
      language,
      token,
      // Always empty: the mentor asks one question and takes one answer, so there is
      // never prior text to append to. Passing the previous answer here is how "seven"
      // becomes "Satu seven" on the second question.
      currentText: '',
      onTranscript: handleTranscript
    });

  /** Hand the captured text to the caller. Idempotent per capture. */
  const deliver = useCallback(() => {
    if (delivered.current) return;
    delivered.current = true;
    clearTimers();
    onResultRef.current?.(latest.current || '');
  }, []);

  // ── Route 1: the recorder STOPPED, by any of the four routes above ────────
  useEffect(() => {
    const was = wasRecording.current;
    wasRecording.current = isRecording;
    if (isRecording || !was || delivered.current) return;

    clearTimers();
    if (latest.current) {
      // Text already in hand (the SpeechRecognition path). Settle briefly for a
      // trailing chunk, then hand it on.
      settleTimer.current = setTimeout(deliver, SETTLE_MS);
    }
    // Whether or not we have text, arm the deadline: on the MediaRecorder path the
    // transcript is still crossing the network and `latest` is legitimately empty here.
    deadlineTimer.current = setTimeout(deliver, TRANSCRIPT_WAIT_MS);
  }, [isRecording, deliver]);

  // ── Route 2: the transcript ARRIVED after recording had already stopped ───
  // This is the MediaRecorder path resolving. Without it the answer waits out the full
  // deadline before being delivered, which reads to a child as the mentor ignoring them.
  useEffect(() => {
    if (delivered.current || isRecording || !transcript) return;
    clearTimers();
    settleTimer.current = setTimeout(deliver, SETTLE_MS);
  }, [transcript, isRecording, deliver]);

  // ── Route 3: the hook reported a FAILURE (mic denied, STT unusable) ───────
  // A notice means no transcript is coming. Waiting the full deadline for something
  // that will never arrive is dead air in front of a child who is waiting to be
  // answered, so deliver the empty result immediately and let the caller respond.
  useEffect(() => {
    if (delivered.current || !recordingNotice) return;
    clearTimers();
    deliver();
  }, [recordingNotice, deliver]);

  useEffect(() => () => { clearTimers(); if (ceilingTimer.current) clearTimeout(ceilingTimer.current); }, []);

  // A HARD CEILING ON THE CAPTURE ITSELF.
  //
  // `useSpeechInput` auto-stops at 45s, which on a device reads as "hung forever" —
  // the floating mentor sat spinning while a child repeated "addition" at it. A child
  // will not wait 45 seconds, and nothing told them anything was wrong.
  //
  // 12s is a long answer to one short question. When it fires, the recorder is stopped
  // and the normal delivery path runs, so an empty transcript reaches the caller and
  // the caller says so out loud instead of the UI simply spinning.
  const CAPTURE_CEILING_MS = 12000;
  const ceilingTimer = useRef(null);

  const start = useCallback(() => {
    clearTimers();
    if (ceilingTimer.current) clearTimeout(ceilingTimer.current);
    latest.current = '';
    setTranscript('');
    delivered.current = false;      // a capture is now outstanding
    if (!isRecording) toggleRecording();
    ceilingTimer.current = setTimeout(() => { try { stopRecording(); } catch { /* already stopped */ } }, CAPTURE_CEILING_MS);
  }, [isRecording, toggleRecording, stopRecording]);

  /**
   * End the turn early because the child pressed stop.
   *
   * Deliberately does NOT deliver. It only stops the recorder; the effect above sees
   * `isRecording` fall and delivers through the SAME path as every other ending. One
   * delivery path, four ways in — which is the whole point of the rewrite.
   */
  const finish = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  return { isRecording, hasMicSupport, recordingNotice, transcript, start, finish };
}
