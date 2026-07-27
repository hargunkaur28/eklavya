import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { resolveNarrationLang } from '../utils/narration.js';
import { primeAudio, getSharedAudio } from '../utils/audioPriming.js';
import { formatQuestionForTTS, normalizeTextForTTS } from '../utils/ttsNormalize.js';

export default function SpeakerButton({
  audioEndpoint,
  fetchPayload,
  ttsText = '',          // Phase 4: raw text for /api/chat/tts (Mentor replies etc.)
  subject = '',          // narration-language resolution needs subject context (English is exempt)
  fallbackText = '',     // explicit last-resort text for Web Speech (e.g. a Mentor reply)
  autoPlay = false,      // Phase 3: auto-trigger on mount when true (caller must key by question)
  onEnded = null,        // Callback when audio finishes playing naturally
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

  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'playing' | 'error'
  const [errorType, setErrorType] = useState(null); // null | 'unavailable' | 'rate_limited'
  const [autoplayBlocked, setAutoplayBlocked] = useState(false); // browser policy blocked auto-play
  const audioRef = useRef(null);
  const resetTimerRef = useRef(null);
  const handleClickRef = useRef(null); // stable ref for the auto-play effect
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; });

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const playWebSpeechFallback = (textToSpeak, speakLang = narrationLang) => {
    if (!('speechSynthesis' in window) || !textToSpeak) return false;

    try {
      window.speechSynthesis.cancel();
      const normalizedText = normalizeTextForTTS(textToSpeak, speakLang);

      // Chunk text into short sentences to avoid Chrome long-text speech timeouts
      const sentences = normalizedText.length > 250
        ? normalizedText.split(/(?<=[.?!।\n])\s+/).filter(s => s.trim().length > 0)
        : [normalizedText];

      let currentIndex = 0;

      const speakNextSentence = () => {
        if (currentIndex >= sentences.length) {
          setStatus('idle');
          audioRef.current = null;
          if (onEndedRef.current) onEndedRef.current();
          return;
        }

        const currentText = sentences[currentIndex];
        const utterance = new SpeechSynthesisUtterance(currentText);
        const targetLangPrefix = speakLang === 'hi' ? 'hi' : 'en';
        utterance.lang = speakLang === 'hi' ? 'hi-IN' : 'en-IN';
        utterance.rate = 0.95;

        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith(targetLangPrefix)) ||
                                voices.find(v => v.lang.toLowerCase().includes('in')) ||
                                voices[0];
          if (matchingVoice) {
            utterance.voice = matchingVoice;
          }
        }

        utterance.onend = () => {
          currentIndex++;
          speakNextSentence();
        };

        utterance.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') {
            return;
          }
          console.warn('SpeechSynthesis sentence error:', e);
          setStatus('idle');
          audioRef.current = null;
        };

        window.speechSynthesis.speak(utterance);
      };

      audioRef.current = {
        pause: () => {
          window.speechSynthesis.cancel();
          currentIndex = sentences.length;
        },
        currentTime: 0
      };

      setStatus('playing');
      speakNextSentence();
      return true;
    } catch (err) {
      console.warn('Web Speech API fallback error:', err);
      return false;
    }
  };

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

    // If currently playing, stop audio
    if (status === 'playing' && audioRef.current) {
      if (typeof audioRef.current.pause === 'function') {
        audioRef.current.pause();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      audioRef.current = null;
      setStatus('idle');
      return;
    }

    if (status === 'loading') return;

    setStatus('loading');
    setErrorType(null);

    // Prime audio session if manual click
    primeAudio();

    const extractTextForFallback = () => {
      if (fallbackText) return normalizeTextForTTS(fallbackText, narrationLang);
      if (ttsText) return normalizeTextForTTS(ttsText, narrationLang);
      if (fetchPayload?.questionText) {
        return formatQuestionForTTS(fetchPayload.questionText, fetchPayload.options, narrationLang);
      }
      return null;
    };

    try {
      let res;
      if (ttsText) {
        // Phase 4: raw-text TTS via /api/chat/tts (Mentor replies, general text).
        // No quiz-specific formatting — just send the text and narration language.
        res = await authFetch('/chat/tts', {
          method: 'POST',
          body: JSON.stringify({ text: ttsText, language: narrationLang })
        });
      } else if (fetchPayload) {
        // Live-audio: send the displayed text + its language, and the RESOLVED
        // narration language — the server translates on demand when they differ.
        res = await authFetch('/diagnostic/live-audio', {
          method: 'POST',
          body: JSON.stringify({ ...fetchPayload, narrationLang })
        });
      } else if (audioEndpoint) {
        // Cached-audio: rewrite the endpoint's ?lang= to the resolved narration lang.
        res = await authFetch(withNarrationLang(audioEndpoint));
      } else {
        throw new Error('No audio source specified');
      }

      if (!res.ok) {
        const textToSpeak = extractTextForFallback();
        if (textToSpeak && playWebSpeechFallback(textToSpeak, language)) {
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // /api/chat/tts returns { success, audio } (base64 WAV) — play directly.
      if (data.success && data.audio) {
        const audioSrc = `data:audio/wav;base64,${data.audio}`;
        const audio = getSharedAudio() || new Audio();
        audio.src = audioSrc;
        audioRef.current = audio;

        audio.onended = () => {
          setStatus('idle');
          audioRef.current = null;
          if (onEndedRef.current) onEndedRef.current();
        };
        audio.onerror = () => {
          const textToSpeak = extractTextForFallback();
          if (textToSpeak && playWebSpeechFallback(textToSpeak, language)) return;
          setStatus('error'); setErrorType('unavailable'); audioRef.current = null;
        };

        await audio.play();
        setStatus('playing');
        setAutoplayBlocked(false);
        return;
      }

      // /diagnostic/live-audio and cached-audio paths return { audioUrl } or { useFallback }.
      if (data.useFallback || !data.audioUrl) {
        // Server text (data.fallbackText) is already in the narration language; our
        // own extracted text is in the displayed language.
        const textToSpeak = data.fallbackText || extractTextForFallback();
        const speakLang = data.fallbackText ? narrationLang : language;
        if (textToSpeak && playWebSpeechFallback(textToSpeak, speakLang)) {
          return;
        }
        throw new Error('No audio URL returned');
      }

      const fullUrl = getFullAudioUrl(data.audioUrl);
      const audio = getSharedAudio() || new Audio();
      audio.src = fullUrl;
      audioRef.current = audio;

      audio.onended = () => {
        setStatus('idle');
        audioRef.current = null;
        if (onEndedRef.current) onEndedRef.current();
      };

      audio.onerror = () => {
        const textToSpeak = extractTextForFallback();
        if (textToSpeak && playWebSpeechFallback(textToSpeak, language)) {
          return;
        }
        setStatus('error');
        setErrorType('unavailable');
        audioRef.current = null;
      };

      console.log('[SpeakerButton] Attempting audio.play() for URL:', fullUrl);
      await audio.play();
      console.log('[SpeakerButton] audio.play() succeeded.');
      setStatus('playing');
      setAutoplayBlocked(false); // clear any prior blocked state
    } catch (err) {
      console.warn('[SpeakerButton audio.play rejection]', err.name, err.message);
      // Detect browser autoplay-policy block (only relevant for auto-play path)
      if (err.name === 'NotAllowedError') {
        console.warn('[SpeakerButton autoPlay] Browser autoplay policy blocked audio.play(). Displaying pulse highlight.');
        setAutoplayBlocked(true);
        setStatus('idle');
        return;
      }
      console.warn('SpeakerButton playback error, activating Web Speech fallback:', err.message);
      const textToSpeak = extractTextForFallback();
      if (textToSpeak && playWebSpeechFallback(textToSpeak, language)) {
        return;
      }
      setStatus('error');
      setErrorType('unavailable');
    }
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
