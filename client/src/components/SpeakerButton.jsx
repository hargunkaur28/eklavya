import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { resolveNarrationLang } from '../utils/narration.js';
import { playNarration, stopNarration, subscribe as subscribeNarration, getNarrationState } from '../utils/narrationController.js';
import { formatQuestionForTTS, normalizeTextForTTS } from '../utils/ttsNormalize.js';

export default function SpeakerButton({
  audioEndpoint,
  fetchPayload,
  ttsText = '',          // Phase 4: raw text for /api/chat/tts (Mentor replies etc.)
  subject = '',          // narration-language resolution needs subject context (English is exempt)
  fallbackText = '',     // explicit last-resort text for Web Speech (e.g. a Mentor reply)
  autoPlay = false,      // Phase 3: auto-trigger on mount when true (caller must key by question)
  onEnded = null,        // Callback when audio finishes playing naturally
  // Fires when narration ENDS WITHOUT SUCCEEDING — an error, or an autoplay block.
  // A chain that advances only on `onEnded` stops dead at the first failure, which is
  // exactly what happened on device: question 1's narration was blocked, so questions
  // 2..n were never narrated at all and it read as "only Q1 is narrated".
  onFailed = null,
  size = 18,
  className = '',
  style = {}
}) {
  const { authFetch, user } = useAuth();
  const { language } = useLanguage();

  // Resolve the narration language per the Phase 2 table (subject + account pref +
  // site toggle). This is what drives the audio request; `language` is only the
  // displayed language.
  const narrationLang = resolveNarrationLang({
    subject,
    pref: user?.narrationLanguagePref,
    siteLang: language
  });

  // Workstream F: this component no longer OWNS playback. narrationController does.
  // It keeps only what is genuinely local — which endpoint to call — and reads its
  // playing/loading state back from the controller, so a button can never believe it
  // is playing while a different button actually is.
  const ownerIdRef = useRef(`spk-${Math.random().toString(36).slice(2)}`);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'playing' | 'error'
  const [errorType, setErrorType] = useState(null); // null | 'unavailable' | 'rate_limited'
  const [autoplayBlocked, setAutoplayBlocked] = useState(false); // browser policy blocked auto-play
  const resetTimerRef = useRef(null);
  const handleClickRef = useRef(null); // stable ref for the auto-play effect
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; });

  // Mirror the controller's state, but only when THIS button owns the playback.
  useEffect(() => subscribeNarration((st) => {
    if (st.ownerId !== ownerIdRef.current) {
      // Another button (or a route change) took over — fall back to idle rather than
      // leaving a stale "playing" icon on a button that is not producing sound.
      setStatus((prev) => (prev === 'idle' ? prev : 'idle'));
      return;
    }
    if (st.status === 'blocked') { setAutoplayBlocked(true); setStatus('idle'); return; }
    setStatus(st.status);
    if (st.status === 'error') setErrorType('unavailable');
  }), []);

  // Stop on unmount ONLY if this button is the one speaking. An unconditional stop
  // here would be worse than the bug: quiz auto-narration unmounts question N's button
  // as question N+1's mounts, so question N's cleanup would kill the narration that
  // had just correctly started.
  useEffect(() => () => {
    if (getNarrationState().ownerId === ownerIdRef.current) stopNarration();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const getFullAudioUrl = (relativeOrFullUrl) => {
    if (!relativeOrFullUrl) return '';
    if (relativeOrFullUrl.startsWith('http')) return relativeOrFullUrl;

    let apiBase = import.meta.env.VITE_API_BASE_URL || '';
    if (!apiBase && typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        apiBase = 'http://127.0.0.1:5000/api';
      } else {
        apiBase = '/api';
      }
    }

    const rootUrl = apiBase.replace(/\/api\/?$/, '');
    return `${rootUrl}${relativeOrFullUrl.startsWith('/') ? '' : '/'}${relativeOrFullUrl}`;
  };

  // Force the cached-audio endpoint to the resolved narration language: rewrite an
  // existing ?lang=/&lang= to narrationLang, or append it if absent.
  const withNarrationLang = (url) => {
    if (!url) return url;
    if (/[?&]lang=(hi|en)/.test(url)) return url.replace(/([?&]lang=)(hi|en)/, `$1${narrationLang}`);
    return url + (url.includes('?') ? '&' : '?') + `lang=${narrationLang}`;
  };

  const handleClick = async (e) => {
    e.stopPropagation();

    // Pressing a playing button stops it. Pressing a different one is handled by
    // playNarration, which stops the previous narration before starting.
    if (status === 'playing') { stopNarration(); return; }
    if (status === 'loading') return;
    setErrorType(null);

    const extractTextForFallback = () => {
      if (fallbackText) return normalizeTextForTTS(fallbackText, narrationLang);
      if (ttsText) return normalizeTextForTTS(ttsText, narrationLang);
      if (fetchPayload?.questionText) {
        return formatQuestionForTTS(fetchPayload.questionText, fetchPayload.options, narrationLang);
      }
      return null;
    };

    // Which endpoint to call is genuinely this component's business; how the result is
    // played, aborted and invalidated is not. The signal comes from the controller so
    // an in-flight request is cancelled the moment the student navigates.
    const resolve = async (signal) => {
      let res;
      if (ttsText) {
        res = await authFetch('/chat/tts', {
          method: 'POST', signal,
          body: JSON.stringify({ text: ttsText, language: narrationLang, sourceLanguage: language })
        });
      } else if (fetchPayload) {
        res = await authFetch('/diagnostic/live-audio', {
          method: 'POST', signal,
          body: JSON.stringify({ ...fetchPayload, narrationLang })
        });
      } else if (audioEndpoint) {
        res = await authFetch(withNarrationLang(audioEndpoint), { signal });
      } else {
        throw new Error('No audio source specified');
      }

      if (!res.ok) {
        let serverFallback = null;
        try { serverFallback = await res.json(); } catch (_) { /* no JSON body */ }
        const fbText = serverFallback?.fallbackText || extractTextForFallback();
        const fbLang = serverFallback?.fallbackLang || narrationLang;
        if (fbText) return { speak: { text: fbText, lang: fbLang } };
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      // /api/chat/tts returns base64 WAV; the others return a URL or ask for fallback.
      if (data.success && data.audio) return { src: `data:audio/wav;base64,${data.audio}` };
      if (data.useFallback || !data.audioUrl) {
        const textToSpeak = data.fallbackText || extractTextForFallback();
        // ── THE LANGUAGE OF THE TEXT, NOT THE STUDENT'S PREFERENCE ───────────
        //
        // This line read `data.fallbackText ? narrationLang : language`, and
        // `narrationLang` is what the student wants to HEAR. It says nothing about what
        // the server actually sent. When a quiz question could not be translated the
        // server correctly returns ENGLISH text, and this spoke it with `lang: 'hi'` —
        // English words in a Hindi voice, on some questions and not others.
        //
        // That is the A3 defect at its THIRD site: the diagnostic route (fixed via
        // `sourceLang`), the fallback responses that omitted `fallbackLang` (fixed), and
        // here — the client filling the gap with a proxy. Every server route now sends
        // `fallbackLang`; this trusts it and NEVER substitutes the preference.
        //
        // `language` (the site toggle) remains the last resort only for text this
        // component extracted itself from `fetchPayload`, which is by definition the
        // text already on screen.
        const speakLang = data.fallbackLang || language;
        if (textToSpeak) return { speak: { text: textToSpeak, lang: speakLang } };
        throw new Error('No audio URL returned');
      }
      return { src: getFullAudioUrl(data.audioUrl) };
    };

    const fb = extractTextForFallback();
    await playNarration({
      ownerId: ownerIdRef.current,
      resolve,
      fallback: fb ? { text: fb, lang: narrationLang } : null,
      onEnded: () => { if (onEndedRef.current) onEndedRef.current(); },
      onError: (kind) => {
        if (kind !== 'blocked') { setErrorType('unavailable'); }
        // Both an error and an autoplay block END this question's narration.
        onFailed?.(kind);
      },
      prime: true
    });
  };

  // Keep handleClickRef current so the auto-play effect calls the latest closure.
  handleClickRef.current = handleClick;

  // Phase 3: auto-play on mount. This effect fires once per mount — callers MUST
  // key this component by question index (e.g. key={`speaker-${qi}`}) so that each
  // question gets a fresh instance and the effect re-fires on question 2, 3, 4, etc.
  useEffect(() => {
    console.log('[SpeakerButton autoPlay effect RUNNING]', { autoPlay, status });
    if (!autoPlay) return;
    // Small delay lets the component fully render before triggering audio.
    const timer = setTimeout(() => {
      if (handleClickRef.current) {
        console.log('[SpeakerButton autoPlay timer FIRED]');
        handleClickRef.current({ stopPropagation: () => {} });
      }
    }, 300);
    return () => {
      console.log('[SpeakerButton autoPlay effect CLEANUP/UNMOUNT]');
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  let tooltipText = language === 'hi' ? 'ऑडियो सुनें' : 'Listen to Audio';
  if (autoplayBlocked) {
    tooltipText = language === 'hi' ? 'सुनने के लिए टैप करें' : 'Tap to listen';
  } else if (status === 'loading') {
    tooltipText = language === 'hi' ? 'ऑडियो तैयार हो रहा है...' : 'Preparing audio...';
  } else if (status === 'playing') {
    tooltipText = language === 'hi' ? 'ऑडियो रोकें' : 'Stop audio';
  } else if (status === 'error') {
    if (errorType === 'rate_limited') {
      tooltipText = language === 'hi'
        ? 'कृपया अधिक ऑडियो के लिए कुछ पल प्रतीक्षा करें'
        : 'Please wait a moment before playing more audio';
    } else {
      tooltipText = language === 'hi' ? 'ऑडियो उपलब्ध नहीं है' : 'Audio unavailable';
    }
  }

  return (
    <button
      type="button"
      className={`speaker-btn ${status} ${autoplayBlocked ? 'autoplay-blocked' : ''} ${className}`}
      onClick={(e) => { setAutoplayBlocked(false); handleClick(e); }}
      disabled={status === 'error' && errorType === 'unavailable'}
      title={tooltipText}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px',
        borderRadius: '50%',
        border: '1.5px solid #2F6B3A',
        background: status === 'playing' ? '#E8F5E9' : '#ffffff',
        color: status === 'error' ? (errorType === 'rate_limited' ? '#E07A3E' : '#94A3B8') : '#2F6B3A',
        borderColor: status === 'error' ? (errorType === 'rate_limited' ? '#E07A3E' : '#CBD5E1') : '#2F6B3A',
        cursor: (status === 'error' && errorType === 'unavailable') ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        ...style
      }}
    >
      {status === 'loading' ? (
        <Loader2 className="animate-spin" size={size} />
      ) : status === 'playing' ? (
        <VolumeX size={size} style={{ animation: 'pulse 1.5s infinite' }} />
      ) : (
        <Volume2 size={size} />
      )}
    </button>
  );
}
