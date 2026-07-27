import { useState } from 'react';
import { Volume2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { primeAudio } from '../utils/audioPriming.js';

// Phase 3: one-time narration prompt shown on the student's first quiz encounter
// (diagnostic / module quiz / practice — whichever comes first). Each quiz surface
// renders this component independently, but they all gate on user.hasSeenNarrationPrompt
// so only the very first one fires.
//
// On confirm the component PATCHes preferences atomically and waits for the response
// before calling `onDone` — the parent reads the post-PATCH user from context so
// auto-play never fires against a stale `autoNarrateQuizzes` value.
export default function NarrationPrompt({ onDone }) {
  const { user, updatePreferences } = useAuth();
  const { t } = useLanguage();

  const [wantNarration, setWantNarration] = useState(null); // null | true | false
  const [langChoice, setLangChoice] = useState('hindi');     // 'hindi' | 'english'
  const [busy, setBusy] = useState(false);

  // Guard: already shown, or not a student, or no user at all — render nothing.
  if (!user || user.role !== 'student' || user.hasSeenNarrationPrompt) return null;

  const canConfirm = wantNarration !== null && (wantNarration === false || langChoice);

  const handleConfirm = async () => {
    if (!canConfirm || busy) return;
    primeAudio(); // Unlock browser session audio playback on user gesture
    setBusy(true);
    try {
      const patch = { hasSeenNarrationPrompt: true };
      if (wantNarration) {
        patch.autoNarrateQuizzes = true;
        patch.narrationLanguagePref = langChoice;
      }
      // Await the PATCH so the user context is updated BEFORE onDone fires —
      // the parent component's auto-play reads from the post-PATCH user object.
      await updatePreferences(patch);
    } catch (err) {
      console.warn('NarrationPrompt: preference save failed, dismissing anyway:', err.message);
    } finally {
      setBusy(false);
      if (onDone) onDone();
    }
  };

  return (
    <div className="narration-prompt-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="narration-prompt-card">
        <div className="narration-prompt-icon">
          <Volume2 size={28} />
        </div>

        <h3 className="narration-prompt-title">{t('auth.narrationPromptTitle')}</h3>
        <p className="narration-prompt-desc">{t('auth.narrationPromptDesc')}</p>

        {/* Yes / No choice */}
        <div className="narration-prompt-choices">
          <button
            type="button"
            className={`narration-prompt-choice ${wantNarration === true ? 'selected' : ''}`}
            onClick={() => { primeAudio(); setWantNarration(true); }}
          >
            {t('auth.narrationPromptYes')}
          </button>
          <button
            type="button"
            className={`narration-prompt-choice ${wantNarration === false ? 'selected' : ''}`}
            onClick={() => setWantNarration(false)}
          >
            {t('auth.narrationPromptNo')}
          </button>
        </div>

        {/* Language sub-choice (only when Yes is selected) */}
        {wantNarration === true && (
          <div className="narration-prompt-lang">
            <span className="narration-prompt-lang-label">{t('auth.narrationPromptLangLabel')}</span>
            <div className="narration-prompt-lang-options">
              <label className={`narration-prompt-lang-opt ${langChoice === 'hindi' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="narrationPromptLang"
                  value="hindi"
                  checked={langChoice === 'hindi'}
                  onChange={() => setLangChoice('hindi')}
                />
                <span>
                  <strong>{t('auth.narrationPromptHindi')}</strong>
                  <small>{t('auth.narrationPromptHindiHint')}</small>
                </span>
              </label>
              <label className={`narration-prompt-lang-opt ${langChoice === 'english' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="narrationPromptLang"
                  value="english"
                  checked={langChoice === 'english'}
                  onChange={() => setLangChoice('english')}
                />
                <span>
                  <strong>{t('auth.narrationPromptEnglish')}</strong>
                </span>
              </label>
            </div>
          </div>
        )}

        <button
          type="button"
          className="primary-button narration-prompt-confirm"
          onClick={handleConfirm}
          disabled={!canConfirm || busy}
        >
          {busy
            ? <><Loader2 size={16} className="animate-spin" /> {t('auth.narrationPromptConfirm')}</>
            : t('auth.narrationPromptConfirm')
          }
        </button>
      </div>
    </div>
  );
}
