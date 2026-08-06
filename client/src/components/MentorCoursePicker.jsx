// Feature 27 — the mentor's voice on the grade + subject picker.
//
// A sibling component rather than surgery inside Onboarding.jsx, so the picker keeps
// working identically with the mentor absent, off, or ineligible. It renders one row of
// controls under the existing chips and touches nothing else.
//
// TWO RULES, BOTH SPECIFIC TO SPEAKING RATHER THAN SHOWING:
//
// 1. THE SPOKEN SUBJECT LIST IS FILTERED BY GRADE, and it is the SERVER's list.
//    A visual list of ten chips is scanned and mostly ignored. A spoken list is a
//    sequence of recommendations carrying the authority of a guide the child has just
//    been told to trust — reading "NEET" to a seven-year-old IS the mentor proposing
//    NEET. The picker never made that claim, so this is a harm the voice path creates.
//    The same list governs what the matcher ACCEPTS: offering five and matching ten
//    means accepting a subject that was never offered.
//
// 2. ELIGIBILITY IS RE-CHECKED THE MOMENT A GRADE IS STATED — and a child who turns
//    out to be above the threshold is NOT dropped mid-flow. The mentor finishes with
//    them and says goodbye. Vanishing mid-question strands a child exactly as badly as
//    a wrong navigation: they cannot read the screen they are stranded on, and they
//    cannot describe where they are.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useMentor } from '../context/MentorContext.jsx';
import { translations } from '../data/translations.js';
import { useMentorMic } from '../hooks/useMentorMic.js';
import { matchGrade, matchSubject } from '../utils/mentorVoice.js';
import './VoiceMentor.css';
import { GRADES } from '../data/taxonomy.js';

export default function MentorCoursePicker({ grade, subject, onGrade, onSubject }) {
  const mentor = useMentor();
  const { token, authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.voiceMentor || translations.en.voiceMentor;

  const [asking, setAsking] = useState('grade');   // 'grade' | 'subject' | 'done'
  // Set when the server says this grade is above the ceiling. The mentor finishes the
  // screen and then stops; it does not follow the child to the dashboard.
  const [dismissed, setDismissed] = useState(false);
  const askedGrade = useRef(false);
  const [spokenSubjects, setSpokenSubjects] = useState(mentor?.spokenSubjects || null);
  const [subjectLineId, setSubjectLineId] = useState(mentor?.subjectLineId || 'course.subject.primary');

  const active = !!mentor?.active && !dismissed;

  useEffect(() => {
    if (!active || askedGrade.current) return;
    askedGrade.current = true;
    // A2: open the mic when the question finishes, not on a press the child cannot find.
    mentor.speak('course.grade', { onEnded: () => { if (mic.hasMicSupport && !mentor.muted) mic.start(); } });
  }, [active, mentor]);

  /**
   * Ask the server whether this grade still gets a mentor, and which subjects it may
   * name. The `?grade=` hint exists because no roadmap has been created yet, so the
   * server has nothing stored to check against — see routes/mentorVoice.js.
   *
   * The CLIENT NEVER DECIDES THIS. It could compute it from the taxonomy index and the
   * max grade, and that would be a third copy of a rule that already exists twice.
   */
  const recheck = useCallback(async (g) => {
    try {
      const res = await authFetch(`/mentor-voice/config?grade=${encodeURIComponent(g)}`);
      if (!res.ok) return true;
      const data = await res.json();
      setSpokenSubjects(data.spokenSubjects);
      setSubjectLineId(data.subjectLineId || 'course.subject.primary');
      if (!data.available) {
        // Goodbye, not silence. Spoken through the mentor BEFORE the flag flips, so the
        // line actually plays.
        await mentor.speak('mentor.farewell');
        setDismissed(true);
        return false;
      }
      return true;
    } catch {
      return true;   // a failed check must not silence a mentor the child is using
    }
  }, [authFetch, mentor]);

  const acceptGrade = useCallback(async (g) => {
    onGrade?.(g);
    const stillOn = await recheck(g);
    if (!stillOn) return;
    setAsking('subject');
    // The subject line id comes from the server and is band-specific, so the question a
    // Class 2 child hears names five subjects and a Class 11 child's does not.
    mentor.speak(subjectLineId, { onEnded: () => { if (mic.hasMicSupport && !mentor.muted) mic.start(); } });
  }, [onGrade, recheck, mentor, subjectLineId]);

  const onResult = useCallback((transcript) => {
    if (!transcript?.trim()) { mentor.speak('mentor.notUnderstood'); return; }

    if (asking === 'grade') {
      const g = matchGrade(transcript, GRADES);
      // ONE re-ask, then the visual picker. A closed set that did not match will not
      // match better on the third attempt, and the chips are right there.
      if (!g) { mentor.speak('course.notMatched'); setAsking('done'); return; }
      acceptGrade(g);
      return;
    }

    if (asking === 'subject') {
      // `spokenSubjects` null means the senior band — the full taxonomy is allowed.
      const s = matchSubject(transcript, spokenSubjects || undefined);
      if (!s) { mentor.speak('course.notMatched'); setAsking('done'); return; }
      onSubject?.(s);
      setAsking('done');
      mentor.speak('confirm.ok');
    }
  }, [asking, mentor, acceptGrade, spokenSubjects, onSubject]);

  const mic = useMentorMic({ language: mentor?.language || 'hi', token, onResult });

  if (!active) return null;

  return (
    <div className="mentor-course-picker">
      <button
        type="button"
        className={`mfm-btn ${mic.isRecording ? 'is-listening' : ''}`}
        onClick={() => (mic.isRecording ? mic.finish() : mic.start())}
        aria-label={mic.isRecording ? t.stopListening : t.tapToTalk}
        disabled={!mic.hasMicSupport}
      >
        {mic.isRecording ? <Loader2 size={18} className="vm-spin" /> : <Mic size={18} />}
      </button>
      <span className="mcp-hint">
        {asking === 'grade' ? t.sayYourClass : asking === 'subject' ? t.sayYourSubject : t.orTapAbove}
      </span>
      {mic.recordingNotice && <span className="mfm-notice" role="status">{mic.recordingNotice}</span>}
    </div>
  );
}
