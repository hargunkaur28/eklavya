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

  const handleClick = async (e) => {
    e.stopPropagation();

    // If currently playing, stop audio
    if (status === 'playing' && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setStatus('idle');
      return;
    }

    if (status === 'loading' || status === 'error') return;

    setStatus('loading');
    setErrorType(null);

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

      if (res.status === 429) {
        setStatus('error');
        setErrorType('rate_limited');
        // Auto-clear rate limit state after 30 seconds
        resetTimerRef.current = setTimeout(() => {
          setStatus('idle');
          setErrorType(null);
        }, 30000);
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.audioUrl) {
        throw new Error('No audio URL returned');
      }

      // Convert relative URL to full backend URL if needed
      const apiRoot = import.meta.env.VITE_API_ROOT_URL || 'http://127.0.0.1:5000';
      const fullUrl = data.audioUrl.startsWith('http')
        ? data.audioUrl
        : `${apiRoot}${data.audioUrl}`;

      const audio = new Audio(fullUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setStatus('idle');
        audioRef.current = null;
      };

      audio.onerror = () => {
        setStatus('error');
        setErrorType('unavailable');
        audioRef.current = null;
      };

      await audio.play();
      setStatus('playing');
    } catch (err) {
      console.warn('SpeakerButton playback error:', err.message);
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
