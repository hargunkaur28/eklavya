// Feature 27 — the Voice Mentor's session state.
//
// A context rather than component state because the mentor spans four surfaces that do
// not share a parent: the post-signup offer, the profile flow, the course picker, and
// the dashboard. Threading "is the mentor on, in which language, and does this device
// have a Hindi voice" through all four as props would mean four chances to forget it.
//
// WHAT LIVES HERE IS A SESSION CONCERN, AND ONLY A SESSION CONCERN.
//
// Conversational memory — what the child just said, which step they are on, how many
// confirm attempts have been spent — is held in memory and dies with the tab. It is
// deliberately not persisted: it is not a fact about the child, it is a fact about this
// conversation, and a stored copy would be a second source of truth about a child's
// progress that can disagree with the roadmap. (See utils/mentorContext.js on the
// server for why that particular disagreement is dangerous rather than untidy.)
//
// The four things that ARE persisted live on the User document and are fetched here
// from GET /mentor-voice/config: offered, enabled, language, tourSeen.

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { speakLine, setMuted as setControllerMuted, primeVoiceCheck, resetVoiceCheck } from '../utils/mentorVoice.js';
import { stopNarration } from '../utils/narrationController.js';

const MentorContext = createContext(null);

export function MentorProvider({ children }) {
  const { user, authFetch } = useAuth();

  const [config, setConfig] = useState(null);     // null = not yet known
  const [muted, setMutedState] = useState(false);
  // Whether this DEVICE can speak the mentor's language with its own voice. Needed for
  // the read-back path, and resolved UP FRONT — never discovered by a prompt failing.
  const [hasLocalVoice, setHasLocalVoice] = useState(null);   // null = still resolving
  const [tourRunning, setTourRunning] = useState(false);

  const isStudent = user?.role === 'student';

  // ── Load the server's answer ──
  // Eligibility is NEVER computed here. The server decides, exactly as it does for the
  // Aadhaar field (Feature 22): a control that renders and is then refused is operated
  // by a child who cannot read the refusal.
  const refresh = useCallback(async () => {
    if (!isStudent) { setConfig(null); return null; }
    try {
      const res = await authFetch('/mentor-voice/config');
      if (!res.ok) { setConfig(null); return null; }
      const data = await res.json();
      setConfig(data);
      return data;
    } catch {
      // A failed config fetch means NO mentor, not a default-on mentor. Silence is a
      // safe degradation; guessing "available" is how a child gets offered something
      // the server will refuse.
      setConfig(null);
      return null;
    }
  }, [authFetch, isStudent]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Voice availability, resolved as soon as the language is known ──
  //
  // Deliberately in its own effect keyed on the language: this must be settled BEFORE
  // any confirm prompt is attempted. Discovering it from "the child said nothing" is
  // the ordering that charges a playback failure to the transcription retry budget and
  // spends both attempts on silence.
  const lang = config?.language || 'hi';
  useEffect(() => {
    let alive = true;
    resetVoiceCheck();
    setHasLocalVoice(null);
    primeVoiceCheck(lang).then((ok) => { if (alive) setHasLocalVoice(ok); });
    return () => { alive = false; };
  }, [lang]);

  const active = !!(config?.available && config?.enabled && isStudent);

  const setMuted = useCallback((v) => {
    setMutedState(v);
    setControllerMuted(v);
    // Muting must take effect INSTANTLY, mid-sentence. A mute that waits for the
    // current line to finish is not a mute to a child who wants the talking to stop —
    // it is a button that appears not to work.
    if (v) stopNarration();
  }, []);

  const speak = useCallback((lineId, opts = {}) => {
    if (!active || muted) return Promise.resolve();
    return speakLine(lineId, { lang, authFetch, ...opts });
  }, [active, muted, lang, authFetch]);

  const savePrefs = useCallback(async (patch) => {
    try {
      const res = await authFetch('/mentor-voice/prefs', { method: 'PATCH', body: JSON.stringify(patch) });
      if (!res.ok) return null;
      const data = await res.json();
      setConfig((c) => (c ? { ...c, ...data.mentorVoice } : c));
      return data;
    } catch {
      return null;
    }
  }, [authFetch]);

  // ── Conversational memory. In memory, and only in memory. ──
  const memory = useRef({ lastIntent: null, lastStep: null, saidHello: false });

  const value = useMemo(() => ({
    config,
    loading: config === null && isStudent,
    // `available` is the server's eligibility answer; `active` additionally requires
    // that the child said yes. The offer screen needs the first without the second.
    available: !!config?.available,
    active,
    enabled: !!config?.enabled,
    offered: !!config?.offered,
    tourSeen: !!config?.tourSeen,
    language: lang,
    spokenSubjects: config?.spokenSubjects || null,
    subjectLineId: config?.subjectLineId || 'course.subject.primary',
    knownGrade: config?.knownGrade || '',
    hasLocalVoice,
    muted,
    setMuted,
    speak,
    savePrefs,
    refresh,
    tourRunning,
    setTourRunning,
    memory: memory.current
  }), [config, isStudent, active, lang, hasLocalVoice, muted, setMuted, speak, savePrefs, refresh, tourRunning]);

  return <MentorContext.Provider value={value}>{children}</MentorContext.Provider>;
}

/**
 * Returns null outside a provider rather than throwing.
 *
 * Unlike `useAuth`, this is consumed by components that must work perfectly with the
 * mentor absent — the profile flow, the course picker, the dashboard. Throwing would
 * make the mentor a hard dependency of flows whose entire requirement is that they
 * remain completable in silence.
 */
export function useMentor() {
  return useContext(MentorContext);
}
