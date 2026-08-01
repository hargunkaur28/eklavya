import { Mic, MicOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useSpeechInput } from '../hooks/useSpeechInput.js';

// Dictation for a written-answer field.
//
// Wraps the SAME `useSpeechInput` hook ChatWidget uses (live SpeechRecognition with a
// MediaRecorder + Sarvam STT fallback) rather than adding a second speech path — the
// fallback logic is the hard part and it is already written and in use.
//
// Renders NOTHING when the device has no microphone support. A dictation button that
// does nothing is worse than an absent one: on a shared or low-end phone the student
// taps it, no error appears, and they conclude the answer box is broken. `hasMicSupport`
// is resolved by the hook on mount, so this disappears rather than misleading.
//
// The transcript APPENDS to whatever is already typed (the hook takes `currentText`),
// so dictating after typing does not wipe the answer — the failure that makes students
// stop trusting the feature after one use.
export default function MicButton({ value = '', onTranscript, disabled = false, size = 16, className = '' }) {
  const { token } = useAuth();
  const { language, t } = useLanguage();

  const { isRecording, hasMicSupport, recordingNotice, toggleRecording } = useSpeechInput({
    language,
    token,
    currentText: value,
    onTranscript
  });

  if (!hasMicSupport) return null;

  const label = isRecording ? t('pyq.micStop') : t('pyq.micStart');

  return (
    <div className={`mic-button-wrap ${className}`}>
      <button
        type="button"
        className={`mic-button ${isRecording ? 'recording' : ''}`}
        onClick={toggleRecording}
        disabled={disabled}
        aria-label={label}
        aria-pressed={isRecording}
        title={label}
      >
        {isRecording ? <MicOff size={size} /> : <Mic size={size} />}
      </button>
      {/* The hook reports permission denials and unsupported-language cases here.
          Surfaced next to the button, because a silent failure looks like a dead
          control and the student has no other way to find out what happened. */}
      {recordingNotice && <span className="mic-notice">{recordingNotice}</span>}
    </div>
  );
}
