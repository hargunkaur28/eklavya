// Feature 27 — what the mentor says after a module quiz is submitted.
//
// The device pass found silence here: the child answers, presses submit, a result
// appears, and nothing is said. For a child who cannot read the result, submitting the
// quiz and being ignored are indistinguishable.
//
// SPLIT INTO A FIXED PART AND A VARIABLE PART, for the same reason as the diagnostic
// review. The pass/fail sentence and the next action are FIXED strings, so they are
// cached and always available. The SCORE contains numbers the child just produced, so it
// can never be cached and is spoken through `speakLocal` — free, on-device, and refused
// rather than voice-substituted when the language has no local voice.
//
// The ordering matters: the fixed line carries the MEANING and plays first. On a device
// with no local voice the child still learns whether they passed and what to do next;
// only the number goes unsaid. The reverse ordering would lose the important half.

import { useEffect, useRef } from 'react';
import { useMentor } from '../context/MentorContext.jsx';
import { speakLocal } from '../utils/narrationController.js';
import MentorGuide from './MentorGuide.jsx';

export default function MentorQuizResult({ passed, score, total, attemptKey }) {
  const mentor = useMentor();
  const spokenFor = useRef(null);

  const active = !!mentor?.active && typeof score === 'number' && typeof total === 'number' && total > 0;

  useEffect(() => {
    if (!active) return;
    const key = `${attemptKey ?? ''}::${score}/${total}`;
    if (spokenFor.current === key) return;
    spokenFor.current = key;

    if (mentor.muted || mentor.hasLocalVoice === false) return;
    const text = mentor.language === 'hi'
      ? `तुमने ${total} में से ${score} सवाल सही किए।`
      : `You answered ${score} out of ${total} questions correctly.`;
    speakLocal({ ownerId: 'mentor-quiz-score', text, lang: mentor.language });
  }, [active, attemptKey, score, total, mentor]);

  if (!active) return null;

  // On a PASS the next action is the next day, so the ring goes there. On a FAIL there
  // is no single button to press — the child must revisit the lesson AND retake — so the
  // line claims the highlight with no selector, which still extinguishes any stale ring
  // rather than leaving one pointing at the videos they have already watched.
  return passed
    ? <MentorGuide line="guide.quizPassed" highlight='[data-mentor="next-day"]' replayKey={attemptKey} />
    : <MentorGuide line="guide.quizFailed" replayKey={attemptKey} />;
}
