// Feature 27 (B) — one spoken instruction, and at most one highlight.
//
//     <MentorGuide line="guide.pressContinue" highlight='[data-mentor="continue"]' when={answered} />
//
// Each guided screen states its guidance next to the markup it describes, which is what
// makes covering EVERY screen realistic rather than the two or three that felt urgent.
//
// ── WHAT THE SECOND DEVICE PASS CHANGED ──
//
// This component used to own its own ring, and per-component ownership of a global
// visual is what produced the four ring symptoms (see utils/mentorHighlight.js). It no
// longer draws anything. It CLAIMS the highlight from a module-scope owner, and the
// single <MentorHighlightRing /> renders it. Claiming releases the previous claim, so
// two rings at once is now structurally impossible rather than merely unlikely.
//
// And the claim has a LIFETIME. Previously a ring lived as long as `when` stayed true,
// which is why one sat on the videos throughout playback: `when` was still true, the
// sentence had finished minutes earlier. A ring belongs to a SENTENCE, not to a screen
// state — it is released when the line ends (plus a dwell long enough to act on) or the
// moment another guide supersedes it.

import { useEffect, useRef } from 'react';
import { useMentor } from '../context/MentorContext.jsx';
import { claimHighlight, releaseHighlight } from '../utils/mentorHighlight.js';
import './VoiceMentor.css';

// How long the ring stays after the sentence ends. Long enough for a child to look up
// and press, short enough that it is gone before it stops being true. Not indefinite:
// a ring that outlives its instruction is the symptom this whole rewrite is for.
const DWELL_MS = 12000;

let seq = 0;

export default function MentorGuide({
  line,
  highlight = null,
  when = true,
  replayKey = null,
  onSpoken = null
}) {
  const mentor = useMentor();
  const spokenFor = useRef(null);
  const ownerId = useRef(`guide-${++seq}`);
  const dwellTimer = useRef(null);

  const active = !!mentor?.active && when;

  useEffect(() => {
    if (!active || !line) return undefined;
    const key = `${line}::${replayKey ?? ''}`;
    if (spokenFor.current === key) return undefined;
    spokenFor.current = key;

    const me = ownerId.current;
    // Claim IMMEDIATELY, before the line plays. This is what extinguishes the previous
    // guide's ring at the moment the new sentence begins, rather than leaving both lit
    // while the new one is still loading its audio.
    claimHighlight(me, highlight);

    if (dwellTimer.current) clearTimeout(dwellTimer.current);

    mentor.speak(line, {
      onEnded: () => {
        onSpoken?.();
        // Released after the dwell, not at the instant the audio stops.
        dwellTimer.current = setTimeout(() => releaseHighlight(me), DWELL_MS);
      }
    });

    // A line that never speaks (cold cache + no local voice) must still not leave a ring
    // lit forever, so the dwell is armed unconditionally as a backstop. `releaseHighlight`
    // is owner-checked, so whichever fires first wins and the other is a no-op.
    dwellTimer.current = setTimeout(() => releaseHighlight(me), DWELL_MS * 2);

    return undefined;
  }, [active, line, replayKey, highlight, mentor, onSpoken]);

  // Unmounting a guide must take its ring with it — navigating away from a screen used
  // to leave the ring behind, because nothing tied the visual to the component.
  useEffect(() => {
    const me = ownerId.current;
    return () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
      releaseHighlight(me);
    };
  }, []);

  return null;   // the ring is drawn by the single MentorHighlightRing
}
