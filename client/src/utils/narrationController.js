// Workstream F — the ONE owner of narration playback.
//
// THE BUG THIS EXISTS FOR: narration outlived the page that started it. A student
// began a quiz question, navigated away mid-sentence, and the audio kept talking over
// the next page's auto-narration. Three separate reasons, all of which had to be
// closed at once:
//
//   1. `window.speechSynthesis` is a browser-level singleton. It is not attached to
//      any component, so nothing unmounts it and a route change does not touch it.
//   2. An HTMLAudioElement is not part of the DOM lifecycle. Once handed to the audio
//      pipeline it keeps playing after the component that created it is gone.
//   3. Playback was owned per-component, so there was no single place that could stop
//      "whatever is speaking right now" — every surface could only stop its own.
//
// So playback lives HERE, at module scope, and two simultaneous narrations are
// structurally impossible rather than merely discouraged: there is exactly one audio
// element and one utterance queue, and starting a narration IS stopping the previous
// one (`playNarration` calls `stopNarration` first, unconditionally).
//
// CI invariant 10 asserts `new Audio(` and `speechSynthesis.speak(` appear nowhere
// else in client/src — a second playback owner would silently reintroduce the overlap.

import { getSharedAudio, primeAudio } from './audioPriming.js';

// ── Single-playback state ───────────────────────────────────────────────────
let currentAudio = null;      // the HTMLAudioElement actually playing
let currentAbort = null;      // AbortController for the in-flight TTS fetch
let currentToken = 0;         // bumped on EVERY play and stop — see the stale guard
let speechActive = false;     // a speechSynthesis utterance queue is running

let state = { status: 'idle', ownerId: null, error: null };
const listeners = new Set();

function emit() {
  for (const l of listeners) { try { l(state); } catch { /* a bad listener must not stop playback control */ } }
}

function setState(next) {
  state = { ...state, ...next };
  emit();
}

/** Subscribe to narration state so a button can render its own playing/loading state. */
export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getNarrationState() { return state; }
export function isNarrating() { return state.status === 'playing' || state.status === 'loading'; }

/**
 * Stop whatever is speaking. IDEMPOTENT and safe to call at any time, including when
 * nothing is playing — callers (route change, unmount, visibility change) must not
 * have to know whether narration is active.
 *
 * Every step below is load-bearing; skipping any one leaves audio running:
 */
export function stopNarration() {
  // (4) Invalidate first, so any in-flight resolution that is already past its await
  //     cannot start playback in the gap between here and the end of this function.
  currentToken += 1;

  // (3) Abort the in-flight TTS request. Necessary but NOT sufficient on its own —
  //     abort can lose the race, and the Web Speech path has no fetch to abort.
  if (currentAbort) {
    try { currentAbort.abort(); } catch { /* already aborted */ }
    currentAbort = null;
  }

  // (1) Pausing alone is not enough: an element with a live `src` can resume, and the
  //     shared element is reused across every narration on the site.
  if (currentAudio) {
    try {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
    } catch { /* element already torn down */ }
    currentAudio = null;
  }

  // (2) UNCONDITIONALLY, even when this narration used the server path. The fallback
  //     can have started without the caller knowing (an onerror mid-playback silently
  //     hands over to speechSynthesis), so "we didn't use it" is not something the
  //     caller can actually assert.
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch { /* not supported */ }
  }
  speechActive = false;

  if (state.status !== 'idle') setState({ status: 'idle', ownerId: null });
}

/**
 * Speak text through the browser's Web Speech API.
 *
 * Chunked into sentences because Chrome silently truncates long utterances. Lives here
 * rather than in SpeakerButton so that `speechSynthesis.speak(` has exactly one call
 * site in the app — the surface most likely to survive a route change is the one that
 * most needs a single owner.
 */
function speakViaWebSpeech(text, lang, token, onEnded) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return false;
  try {
    const sentences = text.length > 250
      ? text.split(/(?<=[.?!।\n])\s+/).filter((s) => s.trim().length > 0)
      : [text];

    let i = 0;
    speechActive = true;

    const speakNext = () => {
      // Re-checked before EVERY chunk, not just at the start. A route change midway
      // through a five-sentence question would otherwise keep speaking the remainder.
      if (token !== currentToken) return;
      if (i >= sentences.length) {
        speechActive = false;
        setState({ status: 'idle', ownerId: null });
        onEnded?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(sentences[i]);
      u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
      u.rate = 0.95;
      const voices = window.speechSynthesis.getVoices();
      if (voices?.length) {
        const prefix = lang === 'hi' ? 'hi' : 'en';
        u.voice = voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
          || voices.find((v) => v.lang.toLowerCase().includes('in'))
          || voices[0];
      }
      u.onend = () => { i += 1; speakNext(); };
      u.onerror = (e) => {
        // 'interrupted'/'canceled' are what a deliberate stop looks like from in here.
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        if (token !== currentToken) return;
        speechActive = false;
        setState({ status: 'idle', ownerId: null, error: 'speech' });
      };
      window.speechSynthesis.speak(u);
    };

    setState({ status: 'playing', ownerId: state.ownerId, error: null });
    speakNext();
    return true;
  } catch {
    speechActive = false;
    return false;
  }
}

/**
 * Start a narration. Stops any current one first — starting and stopping are the same
 * operation, which is what removes most overlap cases without any caller cooperation.
 *
 * @param {object} opts
 * @param {string} opts.ownerId          identifies the button, so it can render its own state
 * @param {(signal: AbortSignal) => Promise<{src?: string, speak?: {text: string, lang: string}}>} opts.resolve
 *        Performs the TTS request. Endpoint choice stays with the caller; this module
 *        owns only playback, aborting and staleness.
 * @param {{text: string, lang: string}} [opts.fallback]  spoken if `resolve` fails
 * @param {() => void} [opts.onEnded]
 * @param {(kind: string) => void} [opts.onError]
 * @param {boolean} [opts.prime]         prime the shared element (manual clicks only)
 */
export async function playNarration({ ownerId, resolve, fallback, onEnded, onError, prime = false }) {
  stopNarration();                       // ALWAYS. See the note above.

  const token = currentToken;            // captured HERE, exactly like noteSaveManager
  const abort = new AbortController();
  currentAbort = abort;
  setState({ status: 'loading', ownerId, error: null });

  if (prime) primeAudio();

  const stale = () => token !== currentToken;

  const speakFallback = (kind) => {
    if (stale()) return;
    if (fallback?.text && speakViaWebSpeech(fallback.text, fallback.lang, token, onEnded)) return;
    setState({ status: 'error', ownerId, error: kind });
    onError?.(kind);
  };

  let result;
  try {
    result = await resolve(abort.signal);
  } catch (err) {
    if (stale() || err?.name === 'AbortError') return;   // navigated away — say nothing
    speakFallback('fetch');
    return;
  }

  // THE STALE GUARD. The request may have been in flight across a navigation: aborting
  // can lose the race, and the fallback path has no fetch to abort at all. Without this
  // the response lands and starts talking on a page that no longer exists.
  if (stale()) return;

  if (result?.speak?.text) {
    if (!speakViaWebSpeech(result.speak.text, result.speak.lang, token, onEnded)) speakFallback('speech');
    return;
  }

  if (!result?.src) { speakFallback('nosource'); return; }

  const audio = getSharedAudio();
  if (!audio) { speakFallback('noelement'); return; }
  audio.src = result.src;
  currentAudio = audio;

  audio.onended = () => {
    if (token !== currentToken) return;
    currentAudio = null;
    setState({ status: 'idle', ownerId: null });
    onEnded?.();
  };
  audio.onerror = () => {
    if (token !== currentToken) return;
    speakFallback('audio');
  };

  try {
    await audio.play();
  } catch (err) {
    if (stale()) return;
    if (err?.name === 'NotAllowedError') {
      // Autoplay policy, not a failure — the caller shows a tap-to-play affordance.
      setState({ status: 'blocked', ownerId });
      onError?.('blocked');
      return;
    }
    speakFallback('play');
    return;
  }

  // Checked once more AFTER play() resolves: play() is async, and a navigation during
  // it would otherwise leave audible output with the state machine reading idle.
  if (stale()) { stopNarration(); return; }
  setState({ status: 'playing', ownerId, error: null });
}

// ── Global lifecycle triggers ───────────────────────────────────────────────
// Registered once at module load rather than per-component: these are properties of
// the browser session, and a component that forgets to bind them is exactly how the
// original bug survived. Route changes are handled separately (see NarrationStopper),
// because only the router knows about them.
if (typeof window !== 'undefined') {
  // Backgrounding the tab must stop narration — audio continuing from a tab the
  // student cannot see is the least explicable version of this bug.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopNarration();
  });
  // `pagehide` rather than `unload`: it fires for bfcache navigations too, where
  // `unload` does not, and a restored bfcache page would otherwise resume talking.
  window.addEventListener('pagehide', stopNarration);
}
