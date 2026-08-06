// Feature 27 (B) — reading the diagnostic score aloud.
//
// The score contains NUMBERS the child just produced, so it is unbounded and can never
// be a cached line. It therefore follows the same rule as the confirm read-back:
// spoken by the browser's own voice, free and on-device, and **never sent to a paid
// provider** — an uncacheable line billed per utterance is the cost model inverted.
//
// And it is REFUSED rather than substituted when the device has no voice for the
// mentor's language. `speakLocal` already enforces that: a Devanagari sentence through
// an English voice is noise, and noise is worse than silence because it sounds like the
// app working to a child who cannot check.
//
// When the read-out cannot happen, the fixed `guide.reviewIntro` line still plays from
// cache — so the child is never told nothing. They are told the test is done and how it
// went is on screen; only the number itself goes unspoken.

import { useEffect, useRef } from 'react';
import { useMentor } from '../context/MentorContext.jsx';
import { speakLocal } from '../utils/narrationController.js';

export default function MentorScoreReadout({ score, total }) {
  const mentor = useMentor();
  const spoken = useRef(false);

  useEffect(() => {
    if (!mentor?.active || spoken.current) return;
    if (typeof score !== 'number' || typeof total !== 'number' || total <= 0) return;
    spoken.current = true;

    // The fixed part first, from cache. It carries the meaning ("your test is done,
    // here is how it went") independently of whether the number can be spoken, so a
    // device with no local voice still gets the important half.
    mentor.speak('guide.reviewIntro', {
      onEnded: () => {
        if (mentor.muted || mentor.hasLocalVoice === false) return;
        const text = mentor.language === 'hi'
          ? `तुमने ${total} में से ${score} सवाल सही किए।`
          : `You answered ${score} out of ${total} questions correctly.`;
        speakLocal({ ownerId: 'mentor-score', text, lang: mentor.language });
      }
    });
  }, [mentor, score, total]);

  return null;
}
