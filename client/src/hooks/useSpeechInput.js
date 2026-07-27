import { useState, useRef, useCallback, useEffect } from 'react';

// Phase 4: reusable speech-to-text hook extracted from ChatWidget. Encapsulates
// the dual-path STT logic (SpeechRecognition live dictation → MediaRecorder +
// Sarvam STT fallback) so both ChatWidget and MentorPage consume identical code.
//
// Usage:
//   const { isRecording, hasMicSupport, recordingNotice, toggleRecording } =
//     useSpeechInput({ language, token, apiBase, onTranscript, currentText });
//
// - `onTranscript(fullText)`: called with the combined text (existing + new).
// - `currentText`: the current input value so we can append to it.

const DEFAULT_API = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:5000/api';
    return '/api';
  }
  return 'http://127.0.0.1:5000/api';
})();

export function useSpeechInput({ language = 'en', token, apiBase, onTranscript, currentText = '' }) {
  const api = apiBase || DEFAULT_API;

  const [isRecording, setIsRecording] = useState(false);
  const [hasMicSupport, setHasMicSupport] = useState(false);
  const [recordingNotice, setRecordingNotice] = useState('');

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const initialTextRef = useRef('');

  // Feature detection on mount
  useEffect(() => {
    const hasRecognition = typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (hasRecognition || navigator.mediaDevices?.getUserMedia) {
      setHasMicSupport(true);
    }
    return () => {
      stopRecording();
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
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
    initialTextRef.current = currentText;

    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;

    // ── Primary Path: Live Word-by-Word SpeechRecognition ──
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
          const base = initialTextRef.current.trim();
          const combined = base ? `${base} ${liveTranscript}` : liveTranscript;
          onTranscript(combined);
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
        recordingTimerRef.current = setTimeout(() => stopRecording(), 45000);
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

          const res = await fetch(`${api}/chat/stt`, {
            method: 'POST',
            headers,
            body: formData
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.transcript) {
              const base = initialTextRef.current.trim();
              onTranscript(base ? `${base} ${data.transcript}` : data.transcript);
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

      recordingTimerRef.current = setTimeout(() => stopRecording(), 30000);
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
  }, [currentText, language, token, api, onTranscript, stopRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, stopRecording, startRecording]);

  return { isRecording, hasMicSupport, recordingNotice, toggleRecording, stopRecording };
}
