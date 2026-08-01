import { useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { BOARDS } from '../data/taxonomy.js';

// Workstream H: one-time prompt for students migrated off a board the platform no
// longer serves (scripts/backfill-board.js emptied their board and set the flag).
//
// Modelled on NarrationPrompt — same overlay/card classes, same "gate on a user flag
// so only the first surface fires" shape, same dismiss-anyway-on-failure behaviour.
// Deliberately NOT a new visual language for a prompt that already exists here.
//
// It is DISMISSIBLE. The board can be set later from Profile, and a prompt a student
// cannot close is a worse failure than an unset board — especially for someone who
// opened the app to study and did not ask to be interrupted. Dismiss clears the flag
// so it is genuinely one-time, and the PYQ screens ask for a board on their own terms
// when one is actually needed.
export default function BoardReselectPrompt({ onDone }) {
  const { user, reselectBoard } = useAuth();
  const { t, language } = useLanguage();

  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  // Same guard shape as NarrationPrompt: not a student, no user, or already answered.
  if (!user || user.role !== 'student' || !user.profile?.boardNeedsReselect) return null;

  // Board names are object KEYS containing spaces and parentheses, so they are read
  // from the translations table directly rather than through t()'s dotted-path
  // lookup — same access pattern the profile flow and settings already use.
  const boards = translations[language]?.profileFlow?.boards || translations.en.profileFlow.boards;
  const boardLabel = (b) => boards[b] || b;

  const finish = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      // The flag is server-side, so a failed save means the prompt returns next
      // login. That is the correct direction to fail: the question genuinely has
      // not been answered yet.
      console.warn('BoardReselectPrompt: save failed:', err.message);
    } finally {
      setBusy(false);
      if (onDone) onDone();
    }
  };

  return (
    <div className="narration-prompt-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="narration-prompt-card">
        <div className="narration-prompt-icon">
          <GraduationCap size={28} />
        </div>

        <h3 className="narration-prompt-title">{t('boardReselect.title')}</h3>
        {/* Says WHY the question is being asked. A prompt that just re-asks a
            question the student already answered reads as a bug. */}
        <p className="narration-prompt-desc">{t('boardReselect.desc')}</p>

        <div className="narration-prompt-choices">
          {BOARDS.map((b) => (
            <button
              key={b}
              type="button"
              className={`narration-prompt-choice ${choice === b ? 'selected' : ''}`}
              onClick={() => setChoice(b)}
            >
              {boardLabel(b)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary-button narration-prompt-confirm"
          onClick={() => finish(() => reselectBoard(choice))}
          disabled={!choice || busy}
        >
          {busy
            ? <><Loader2 size={16} className="animate-spin" /> {t('boardReselect.confirm')}</>
            : t('boardReselect.confirm')}
        </button>

        <button
          type="button"
          className="narration-prompt-skip"
          onClick={() => finish(() => reselectBoard('', { dismiss: true }))}
          disabled={busy}
        >
          {t('boardReselect.later')}
        </button>
      </div>
    </div>
  );
}
