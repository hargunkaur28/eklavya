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
/**
 * Choose a voice for a language — or REFUSE to.
 *
 * Pure, and exported, so the refusal can be asserted without a DOM. The rule it encodes
 * is the one thing about this module that differs between its two callers, so it is the
 * one thing worth being able to test directly.
 *
 * `strict: false` (quiz narration, Feature 21) keeps the historical cascade, ending at
 * `voices[0]` — ANY voice at all.
 *
 * `strict: true` (the Voice Mentor) returns **null** when nothing matches the requested
 * language, and null means NO SPEECH.
 *
 * ── WHY THE MENTOR REFUSES WHAT THE QUIZ ACCEPTS ──
 *
 * `voices[0]` is a sensible-looking catch-all, and for Feature 21 it IS the right
 * answer: a Class 10 student who hears a Devanagari question in an American accent can
 * READ THE SCREEN and route around it, and the alternative is a silent quiz. Something
 * imperfect beats nothing.
 *
 * For the mentor the arithmetic inverts, because its user cannot read the screen. An
 * English voice reading Devanagari is not degraded speech — it is noise. And noise is
 * worse than silence here, because **noise sounds like the app working**: the child
 * hears the mentor talking, cannot tell that it is gibberish, cannot check, and has no
 * way to report it. Silence is legible. Silence prompts them to ask someone.
 *
 * This is why the flag exists rather than one path being "fixed" to match the other.
 * Both behaviours are correct, for different readers. Anyone later "unifying" these two
 * call sites will be looking at `voices[0]` and seeing a harmless default — this comment
 * is the only thing standing between that reasonable-looking edit and a mentor that
 * talks nonsense to children who cannot tell.
 */
export function selectVoice(voices, lang, strict = false) {
  const list = Array.isArray(voices) ? voices : [];
  if (!list.length) return null;
  const prefix = lang === 'hi' ? 'hi' : 'en';
  const exact = list.find((v) => String(v.lang || '').toLowerCase().startsWith(prefix));
  if (exact) return exact;
  // No voice for the requested language. This is the fork.
  if (strict) return null;
  return list.find((v) => String(v.lang || '').toLowerCase().includes('in')) || list[0];
}

function speakViaWebSpeech(text, lang, token, onEnded, strictVoice = false) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return false;
  // Belt and braces: the callers below already check, but a THIRD caller added later
  // would otherwise bypass the refusal entirely — and this module exists precisely
  // because per-caller audio rules do not hold.
  if (strictVoice && !selectVoice(window.speechSynthesis.getVoices(), lang, true)) return false;
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
      // The cascade — including `voices[0]` — now lives in selectVoice(), so the quiz
      // and the mentor differ in exactly one argument rather than in duplicated logic.
      const picked = selectVoice(window.speechSynthesis.getVoices(), lang, strictVoice);
      if (picked) u.voice = picked;
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
export async function playNarration({ ownerId, resolve, fallback, onEnded, onError, prime = false, strictVoice = false }) {
  stopNarration();                       // ALWAYS. See the note above.

  const token = currentToken;            // captured HERE, exactly like noteSaveManager
  const abort = new AbortController();
  currentAbort = abort;
  setState({ status: 'loading', ownerId, error: null });

  if (prime) primeAudio();

  const stale = () => token !== currentToken;

  // A strict caller with no matching voice never reaches the speech engine at all. The
  // error kind is DISTINCT ('novoice') rather than folded into the generic ones, because
  // the mentor has a specific, correct response to it — skip the read-back, play the
  // "have a look, or ask a grown-up" line, and DO NOT spend a retry attempt — and it
  // cannot take that branch from an error kind that also means "the fetch failed".
  const noVoiceFor = (l) =>
    strictVoice &&
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    !selectVoice(window.speechSynthesis.getVoices(), l, true);

  const speakFallback = (kind) => {
    if (stale()) return;
    if (noVoiceFor(fallback?.lang)) {
      setState({ status: 'error', ownerId, error: 'novoice' });
      onError?.('novoice');
      return;
    }
    if (fallback?.text && speakViaWebSpeech(fallback.text, fallback.lang, token, onEnded, strictVoice)) return;
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
    // The server exhausted every TTS provider and handed back text. For the mentor with
    // a cold cache this is the COMMON path, not an edge case — which is exactly why the
    // refusal has to hold here and not only on the fallback branch.
    if (noVoiceFor(result.speak.lang)) {
      setState({ status: 'error', ownerId, error: 'novoice' });
      onError?.('novoice');
      return;
    }
    if (!speakViaWebSpeech(result.speak.text, result.speak.lang, token, onEnded, strictVoice)) speakFallback('speech');
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

// ── Web Speech VOICE AVAILABILITY (Feature 27) ──────────────────────────────
//
// Lives here rather than in the mentor because this module is the one owner of
// `speechSynthesis` (Design Rule 10, CI invariant 10). A second module calling
// `getVoices()` would be a second module holding an opinion about the speech engine,
// and the whole point of this file is that there is exactly one.
//
// WHY THIS IS DETECTION AND NOT A FALLBACK.
//
// The mentor reads a heard value back to confirm it — "मैंने सुना — सातु। सही है?" —
// and that line contains data, so it can never be a cached clip and must be spoken by
// the browser's own voice. On the cheap Android hardware this deployment targets, a
// hi-IN voice is frequently just absent.
//
// The failure to avoid is NOT the silence. It is charging a PLAYBACK failure to the
// TRANSCRIPTION retry budget: a silent prompt spends both attempts producing nothing
// the child can perceive, and then hands over to typing without them ever learning why.
// Those are different failures and the budget belongs to only one of them.
//
// So availability is resolved UP FRONT, at mount, and the confirm step is SKIPPED
// rather than attempted-and-failed. Discovering it by "nothing was heard" is precisely
// the ordering that burns an attempt on silence.
let voicesPromise = null;

/**
 * Resolve once the browser has actually populated its voice list.
 *
 * `getVoices()` returns [] until the engine is ready in Chrome, and `voiceschanged` is
 * the documented signal — but it does not fire at all in some WebViews, so a poll and a
 * hard timeout back it up. Resolving empty is a legitimate answer meaning "no voices",
 * which is exactly what a locked-down school tablet reports.
 */
export function voicesReady() {
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { resolve([]); return; }
    const read = () => { try { return window.speechSynthesis.getVoices() || []; } catch { return []; } };

    const initial = read();
    if (initial.length) { resolve(initial); return; }

    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearInterval(poll); clearTimeout(cap); resolve(v); } };
    try { window.speechSynthesis.addEventListener('voiceschanged', () => done(read()), { once: true }); } catch { /* older engine */ }
    const poll = setInterval(() => { const v = read(); if (v.length) done(v); }, 150);
    // Give up and answer "none". An unresolved promise here would hang the mentor
    // before it ever spoke, which is worse than knowing there are no voices.
    const cap = setTimeout(() => done(read()), 2500);
  });
  return voicesPromise;
}

/**
 * Is there a voice for this language?
 *
 * DELIBERATELY NOT "fall back to the English voice". `en-IN` is near-universal where
 * `hi-IN` is not, so substituting is the tempting move — and a Devanagari name read by
 * an English voice is noise. Noise is worse than an honest cached sentence saying "have
 * a look, or ask a grown-up", because noise sounds like the app working.
 */
export async function hasVoiceFor(lang) {
  const prefix = lang === 'hi' ? 'hi' : 'en';
  const voices = await voicesReady();
  return voices.some((v) => String(v.lang || '').toLowerCase().startsWith(prefix));
}

/**
 * Speak text with the browser's own voice, and report whether it ACTUALLY spoke.
 *
 * The public entry for content that cannot be cached because it contains data the child
 * just gave us. Free, on-device, and never billed.
 *
 * A voice can exist and still fail — `synthesis-failed`, an engine muted at the OS
 * level, a WebView that accepts `speak()` and does nothing. So a WATCHDOG treats
 * "never started" as unavailability: if neither `onstart` nor completion happens within
 * WATCHDOG_MS, the caller is told it did not speak. The caller can then take the same
 * branch as a missing voice — which for the mentor means skipping the confirm step
 * WITHOUT counting an attempt.
 *
 * @returns {Promise<boolean>} true if speech genuinely started.
 */
const WATCHDOG_MS = 2000;

export function speakLocal({ ownerId, text, lang = 'hi', onEnded }) {
  stopNarration();                        // ALWAYS, exactly like playNarration.
  const token = currentToken;
  setState({ status: 'loading', ownerId, error: null });

  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
      setState({ status: 'idle', ownerId: null });
      resolve(false);
      return;
    }

    let started = false;
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; clearTimeout(watchdog); resolve(ok); } };

    const watchdog = setTimeout(() => {
      if (started) return;
      // It never began. Stop cleanly so a late start cannot talk over whatever the
      // caller does next, and report honestly that nothing was spoken.
      if (token === currentToken) stopNarration();
      finish(false);
    }, WATCHDOG_MS);

    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
      u.rate = 0.9;                        // slower than quiz narration: this is a child
      const voices = window.speechSynthesis.getVoices();
      if (voices?.length) {
        const prefix = lang === 'hi' ? 'hi' : 'en';
        // No cross-language substitution — see hasVoiceFor. If the right voice is
        // absent the utterance is left on the engine default, and the watchdog plus the
        // caller's own hasVoiceFor check are what actually decide the branch.
        const match = voices.find((v) => String(v.lang || '').toLowerCase().startsWith(prefix));
        if (match) u.voice = match;
      }
      u.onstart = () => {
        started = true;
        if (token !== currentToken) return;
        speechActive = true;
        setState({ status: 'playing', ownerId, error: null });
        finish(true);
      };
      u.onend = () => {
        if (token !== currentToken) return;
        speechActive = false;
        setState({ status: 'idle', ownerId: null });
        onEnded?.();
        finish(started);
      };
      u.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') { finish(started); return; }
        if (token !== currentToken) { finish(false); return; }
        speechActive = false;
        setState({ status: 'idle', ownerId: null });
        finish(false);
      };
      window.speechSynthesis.speak(u);
    } catch {
      setState({ status: 'idle', ownerId: null });
      finish(false);
    }
  });
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
