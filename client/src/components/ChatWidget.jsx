import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Bot, X, Send, Mic, MicOff, Volume2, VolumeX, ExternalLink, Sparkles } from 'lucide-react';
import './ChatWidget.css';

// Swappable avatar image path — drop a real avatar at this path and it works with zero code changes.
// Falls back to the Bot lucide icon if the image fails to load.
const AVATAR_SRC = '/chatbot-avatar.png';

const API_BASE = (() => {
  // Prefer explicit env var set at build/deploy time (e.g. the Render backend URL on Vercel)
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000/api';
    }
    return '/api';
  }
  return 'http://127.0.0.1:5000/api';
})();

export default function ChatWidget() {
  const { language } = useLanguage();
  const { token, user, activeRoadmap } = useAuth();
  const navigate = useNavigate();

  // ── State ──
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { id, role: 'user'|'bot', content, type, route, label, resources, revealed }
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showUnread, setShowUnread] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Voice feature support (detected on mount)
  const [hasSpeechSynthesis, setHasSpeechSynthesis] = useState(false);
  const [hasMicSupport, setHasMicSupport] = useState(false);

  // Speaker state
  const [playingMsgId, setPlayingMsgId] = useState(null);
  const [speakerLoading, setSpeakerLoading] = useState(null);
  const currentAudioRef = useRef(null);

  // Mic state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingNotice, setRecordingNotice] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Refs
  const recognitionRef = useRef(null);
  const initialInputRef = useRef('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const revealTimerRef = useRef(null);

  // ── Feature Detection on Mount ──
  useEffect(() => {
    setHasSpeechSynthesis('speechSynthesis' in window);

    const hasRecognition = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (hasRecognition || navigator.mediaDevices?.getUserMedia) {
      setHasMicSupport(true);
    }

    // Unread dot — distinct key from auth token ('eklavya_chat_opened')
    try {
      const opened = sessionStorage.getItem('eklavya_chat_opened');
      if (!opened) setShowUnread(true);
    } catch {
      // sessionStorage unavailable
    }

    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Open/Close ──
  const handleToggle = useCallback(() => {
    setIsOpen(prev => {
      if (!prev) {
        // Opening — clear unread dot
        setShowUnread(false);
        try {
          sessionStorage.setItem('eklavya_chat_opened', 'true');
        } catch {}
        setTimeout(() => inputRef.current?.focus(), 300);
      }
      return !prev;
    });
  }, []);

  // ── Progressive Text Reveal ──
  const revealText = useCallback((msgId, fullText, onComplete) => {
    const words = fullText.split(/(\s+)/); // preserve whitespace
    let revealed = '';
    let wordIndex = 0;

    if (revealTimerRef.current) clearInterval(revealTimerRef.current);

    revealTimerRef.current = setInterval(() => {
      if (wordIndex >= words.length) {
        clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: fullText, revealed: true } : m
        ));
        if (onComplete) onComplete();
        return;
      }

      revealed += words[wordIndex];
      wordIndex++;
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: revealed } : m
      ));
    }, 40);
  }, []);

  // ── Send Message ──
  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    if (isRecording) {
      stopRecording();
    }

    // Clear any recording notice
    setRecordingNotice('');

    // Add user message
    const userMsgId = Date.now() + '-user';
    const newUserMsg = { id: userMsgId, role: 'user', content: text };
    setMessages(prev => [...prev, newUserMsg]);
    setInputText('');
    setIsLoading(true);

    // Build conversation history (last 10 messages)
    const history = messages
      .filter(m => m.revealed !== false) // only fully revealed messages
      .slice(-10)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));

    // Build user context for personalization
    let userContext = null;
    if (activeRoadmap) {
      userContext = {
        roadmapId: activeRoadmap._id,
        grade: activeRoadmap.grade,
        subject: activeRoadmap.subject
      };
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/chat/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          conversationHistory: history,
          language,
          userContext
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      const botMsgId = Date.now() + '-bot';

      // Add bot message with empty content for progressive reveal
      const botMsg = {
        id: botMsgId,
        role: 'bot',
        content: '',
        type: data.type || 'text',
        route: data.route || null,
        label: data.label || null,
        resources: data.resources || null,
        revealed: false
      };

      setMessages(prev => [...prev, botMsg]);
      setIsLoading(false);

      // Progressive reveal, then show resources/nav after text completes
      revealText(botMsgId, data.reply || 'I\'m not sure how to respond to that.', () => {
        // After text reveal, mark as fully revealed (resources/nav will render)
      });

    } catch (err) {
      console.error('Chat send error:', err);
      const errorMsgId = Date.now() + '-error';
      const errorText = language === 'hi'
        ? 'क्षमा करें, मुझे अभी जवाब देने में परेशानी हो रही है। कृपया कुछ देर बाद फिर से प्रयास करें।'
        : 'Sorry, I\'m having trouble responding right now. Please try again in a moment.';

      setMessages(prev => [...prev, {
        id: errorMsgId,
        role: 'bot',
        content: errorText,
        type: 'text',
        revealed: true
      }]);
      setIsLoading(false);
    }
  }, [inputText, isLoading, messages, language, token, activeRoadmap, revealText]);

  // ── Keyboard Handler ──
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // ── Speaker (TTS) ──
  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      if (currentAudioRef.current instanceof HTMLAudioElement) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setPlayingMsgId(null);
  }, []);

  const handleSpeak = useCallback(async (msgId, text) => {
    // If already playing this message, stop
    if (playingMsgId === msgId) {
      stopAudio();
      return;
    }

    // Stop any currently playing audio
    stopAudio();

    setSpeakerLoading(msgId);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/chat/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, language })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.audio) {
          // Play Sarvam TTS audio
          const audioSrc = `data:audio/wav;base64,${data.audio}`;
          const audio = new Audio(audioSrc);
          currentAudioRef.current = audio;
          setPlayingMsgId(msgId);
          setSpeakerLoading(null);

          audio.onended = () => {
            setPlayingMsgId(null);
            currentAudioRef.current = null;
          };
          audio.onerror = () => {
            setPlayingMsgId(null);
            currentAudioRef.current = null;
          };

          await audio.play();
          return;
        }
      }

      // Sarvam failed — fall back to browser speechSynthesis
      throw new Error('Sarvam TTS failed');
    } catch (err) {
      console.warn('TTS primary failed, trying browser fallback:', err.message);
      setSpeakerLoading(null);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
        utterance.rate = 0.95;

        setPlayingMsgId(msgId);
        currentAudioRef.current = 'speechSynthesis'; // sentinel

        utterance.onend = () => {
          setPlayingMsgId(null);
          currentAudioRef.current = null;
        };
        utterance.onerror = (e) => {
          if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('Browser TTS error:', e);
          }
          setPlayingMsgId(null);
          currentAudioRef.current = null;
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setSpeakerLoading(null);
      }
    }
  }, [playingMsgId, stopAudio, token, language]);

  // ── Microphone (STT / Live Dictation) ──
  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setRecordingNotice('');

    // Capture text that was already typed in input box before mic click
    initialInputRef.current = inputText;

    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;

    // ── Primary Path: Live Word-by-Word SpeechRecognition ──
    // Types text live into the textbox as the user speaks ("hello" "I'm" "shine")
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          let liveTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            liveTranscript += event.results[i][0].transcript;
          }

          const base = initialInputRef.current.trim();
          const combined = base ? `${base} ${liveTranscript}` : liveTranscript;
          setInputText(combined);
          inputRef.current?.focus();
        };

        recognition.onerror = (e) => {
          if (e.error === 'no-speech' || e.error === 'aborted') return;
          console.warn('SpeechRecognition error:', e.error);
          if (e.error === 'not-allowed') {
            setRecordingNotice(
              language === 'hi'
                ? 'माइक्रोफ़ोन अनुमति अस्वीकृत की गई — कृपया टाइप करें'
                : 'Microphone permission denied — please type your message'
            );
            setTimeout(() => setRecordingNotice(''), 4000);
          }
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
          recognitionRef.current = null;
        };

        recognition.start();
        recognitionRef.current = recognition;
        setIsRecording(true);

        // Auto-stop after 45 seconds
        recordingTimerRef.current = setTimeout(() => {
          stopRecording();
        }, 45000);

        return;
      } catch (err) {
        console.warn('SpeechRecognition start error, falling back to MediaRecorder + Sarvam:', err);
      }
    }

    // ── Fallback Path: MediaRecorder + Sarvam STT Backend ──
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });

        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');
          const headers = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${API_BASE}/chat/stt`, {
            method: 'POST',
            headers,
            body: formData
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.transcript) {
              const base = initialInputRef.current.trim();
              setInputText(base ? `${base} ${data.transcript}` : data.transcript);
              inputRef.current?.focus();
              return;
            }
          }
        } catch (err) {
          console.warn('Sarvam STT fallback failed:', err);
        }

        setRecordingNotice(
          language === 'hi'
            ? 'आवाज़ इनपुट प्राप्त नहीं हुआ — कृपया टाइप करें'
            : "Voice input could not be transcribed — please type your message"
        );
        setTimeout(() => setRecordingNotice(''), 4000);
      };

      mediaRecorder.start();
      setIsRecording(true);

      recordingTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 30000);

    } catch (err) {
      console.warn('Mic access denied:', err);
      setRecordingNotice(
        language === 'hi'
          ? 'माइक्रोफ़ोन अनुमति अस्वीकृत की गई — कृपया टाइप करें'
          : "Microphone access was denied — please type your message"
      );
      setTimeout(() => setRecordingNotice(''), 4000);
      setIsRecording(false);
    }
  }, [inputText, language, token, stopRecording]);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, stopRecording, startRecording]);

  // ── Navigate Handler ──
  const handleNavigate = useCallback((route) => {
    navigate(route);
    // Don't close panel — user might want to continue chatting
  }, [navigate]);

  // ── Avatar Component ──
  const AvatarIcon = ({ size = 18, className = '' }) => {
    if (avatarFailed) {
      return <Bot size={size} className={className} />;
    }
    return (
      <img
        src={AVATAR_SRC}
        alt=""
        onError={() => setAvatarFailed(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  };

  // ── Render ──
  return (
    <>
      {/* Floating Toggle Button */}
      <button
        className="chat-toggle-btn"
        onClick={handleToggle}
        aria-label={isOpen ? 'Close chat' : 'Open Eklavya Assistant'}
        id="chat-toggle"
      >
        {isOpen ? (
          <X size={24} />
        ) : avatarFailed ? (
          <Bot size={26} />
        ) : (
          <img
            src={AVATAR_SRC}
            alt="Eklavya Assistant"
            onError={() => setAvatarFailed(true)}
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
          />
        )}
        {showUnread && !isOpen && <span className="chat-unread-dot" />}
      </button>

      {/* Chat Panel */}
      <div className={`chat-panel ${isOpen ? 'chat-panel--open' : ''}`} role="dialog" aria-label="Eklavya Assistant Chat">
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-avatar">
            {avatarFailed ? <Bot size={24} /> : (
              <img src={AVATAR_SRC} alt="" onError={() => setAvatarFailed(true)} />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div className="chat-header-title">
              {language === 'hi' ? 'एकलव्य सहायक' : 'Eklavya Assistant'}
            </div>
            <div className="chat-header-subtitle">
              {language === 'hi' ? 'आपका AI ट्यूटर' : 'Your AI Tutor'}
            </div>
          </div>
          <button className="chat-close-btn" onClick={handleToggle} aria-label="Close chat" id="chat-close">
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div className="chat-messages" id="chat-messages">
          {messages.length === 0 && !isLoading && (
            <div className="chat-welcome">
              <div className="chat-welcome-icon">
                <Sparkles size={24} />
              </div>
              <div className="chat-welcome-title">
                {language === 'hi' ? 'नमस्ते! 👋' : 'Hi there! 👋'}
              </div>
              <div>
                {language === 'hi'
                  ? 'मैं एकलव्य सहायक हूँ। पढ़ाई, साइट नेविगेशन, या वीडियो रिसोर्स के बारे में कुछ भी पूछें!'
                  : "I'm Eklavya Assistant. Ask me anything about studying, site navigation, or video resources!"}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg chat-msg--${msg.role === 'user' ? 'user' : 'bot'}`}>
              {msg.role === 'bot' && (
                <div className="chat-msg-avatar">
                  {avatarFailed ? <Bot size={20} /> : (
                    <img src={AVATAR_SRC} alt="" onError={() => setAvatarFailed(true)} />
                  )}
                </div>
              )}

              <div className="chat-msg-content">
                <div className="chat-msg-bubble">
                  {msg.content}

                  {/* Navigation button — shown only after text is fully revealed */}
                  {msg.role === 'bot' && msg.revealed && msg.route && (
                    <div>
                      <button
                        className="chat-nav-btn"
                        onClick={() => handleNavigate(msg.route)}
                        id={`chat-nav-${msg.id}`}
                      >
                        {msg.label || 'Go'} <ExternalLink size={13} />
                      </button>
                    </div>
                  )}

                  {/* Resource cards — shown only after text is fully revealed */}
                  {msg.role === 'bot' && msg.revealed && msg.resources && msg.resources.length > 0 && (
                    <div className="chat-resources-list">
                      {msg.resources.map((res, idx) => (
                        <a
                          key={idx}
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chat-resource-card"
                          id={`chat-resource-${msg.id}-${idx}`}
                        >
                          <div className="chat-resource-icon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                              <path d="M23 12l-10.5-7v4.5H0v5h12.5V19z" transform="rotate(90 12 12)" />
                              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0C.488 3.45.029 5.804 0 12c.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0C23.512 20.55 23.971 18.196 24 12c-.029-6.185-.484-8.549-4.385-8.816zM9 16V8l8 4-8 4z" />
                            </svg>
                          </div>
                          <div className="chat-resource-info">
                            <div className="chat-resource-title">{res.title}</div>
                            <div className="chat-resource-channel">{res.channel}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Speaker button for bot messages (only if fully revealed) */}
                {msg.role === 'bot' && msg.revealed && hasSpeechSynthesis && (
                  <div className="chat-msg-actions">
                    <button
                      className={`chat-speaker-btn ${
                        playingMsgId === msg.id ? 'chat-speaker-btn--playing' : ''
                      } ${speakerLoading === msg.id ? 'chat-speaker-btn--loading' : ''}`}
                      onClick={() => handleSpeak(msg.id, msg.content)}
                      aria-label={playingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                      id={`chat-speaker-${msg.id}`}
                    >
                      {playingMsgId === msg.id ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div className="chat-typing">
              <div className="chat-msg-avatar">
                {avatarFailed ? <Bot size={14} /> : (
                  <img src={AVATAR_SRC} alt="" onError={() => setAvatarFailed(true)} />
                )}
              </div>
              <div className="chat-typing-dots">
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Inline notices (voice status, etc.) */}
        {recordingNotice && (
          <div className="chat-inline-notice">{recordingNotice}</div>
        )}

        {/* Input Area */}
        <div className="chat-input-area">
          {hasMicSupport && (
            <button
              className={`chat-mic-btn ${isRecording ? 'chat-mic-btn--recording' : ''}`}
              onClick={handleMicClick}
              aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
              id="chat-mic"
            >
              {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}

          <textarea
            ref={inputRef}
            className="chat-text-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={language === 'hi' ? 'अपना सवाल पूछें...' : 'Ask anything...'}
            rows={1}
            disabled={isLoading}
            id="chat-input"
          />

          <button
            className="chat-send-btn"
            onClick={sendMessage}
            disabled={!inputText.trim() || isLoading}
            aria-label="Send message"
            id="chat-send"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
