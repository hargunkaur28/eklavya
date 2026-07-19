import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function SpeakerButton({
  audioEndpoint,
  fetchPayload,
  size = 18,
  className = '',
  style = {}
}) {
  const { authFetch } = useAuth();
  const { language } = useLanguage();

  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'playing' | 'error'
  const [errorType, setErrorType] = useState(null); // null | 'unavailable' | 'rate_limited'
  const audioRef = useRef(null);
  const resetTimerRef = useRef(null);

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

  const playWebSpeechFallback = (textToSpeak) => {
    if (!('speechSynthesis' in window) || !textToSpeak) return false;

    try {
      window.speechSynthesis.cancel();

      // Chunk text into short sentences to avoid Chrome long-text speech timeouts
      const sentences = textToSpeak.length > 250
        ? textToSpeak.split(/(?<=[.?!।\n])\s+/).filter(s => s.trim().length > 0)
        : [textToSpeak];

      let currentIndex = 0;

      const speakNextSentence = () => {
        if (currentIndex >= sentences.length) {
          setStatus('idle');
          audioRef.current = null;
          return;
        }

        const currentText = sentences[currentIndex];
        const utterance = new SpeechSynthesisUtterance(currentText);
        const targetLangPrefix = language === 'hi' ? 'hi' : 'en';
        utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
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

    const extractTextForFallback = () => {
      if (fallbackText) return fallbackText;
      if (fetchPayload?.questionText) return fetchPayload.questionText;
      const proseEl = document.querySelector('.prose-body');
      if (proseEl) return proseEl.innerText;
      return null;
    };

    try {
      let res;
      if (fetchPayload) {
        res = await authFetch('/diagnostic/live-audio', {
          method: 'POST',
          body: JSON.stringify(fetchPayload)
        });
      } else if (audioEndpoint) {
        res = await authFetch(audioEndpoint);
      } else {
        throw new Error('No audio source specified');
      }

      if (!res.ok) {
        const textToSpeak = extractTextForFallback();
        if (textToSpeak && playWebSpeechFallback(textToSpeak)) {
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.useFallback || !data.audioUrl) {
        const textToSpeak = data.fallbackText || extractTextForFallback();
        if (textToSpeak && playWebSpeechFallback(textToSpeak)) {
          return;
        }
        throw new Error('No audio URL returned');
      }

      const fullUrl = getFullAudioUrl(data.audioUrl);
      const audio = new Audio(fullUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setStatus('idle');
        audioRef.current = null;
      };

      audio.onerror = () => {
        const textToSpeak = extractTextForFallback();
        if (textToSpeak && playWebSpeechFallback(textToSpeak)) {
          return;
        }
        setStatus('error');
        setErrorType('unavailable');
        audioRef.current = null;
      };

      await audio.play();
      setStatus('playing');
    } catch (err) {
      console.warn('SpeakerButton playback error, activating Web Speech fallback:', err.message);
      const textToSpeak = extractTextForFallback();
      if (textToSpeak && playWebSpeechFallback(textToSpeak)) {
        return;
      }
      setStatus('error');
      setErrorType('unavailable');
    }
  };

  let tooltipText = language === 'hi' ? 'ऑडियो सुनें' : 'Listen to Audio';
  if (status === 'loading') {
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
      className={`speaker-btn ${status} ${className}`}
      onClick={handleClick}
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
