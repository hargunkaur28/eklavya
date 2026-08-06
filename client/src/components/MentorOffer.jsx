// Feature 27 — the offer, made immediately after signup and BEFORE profile onboarding.
//
// The order is the point. Profile onboarding is the first thing a new student meets and
// it is entirely written; offering the mentor afterwards would mean a child who cannot
// read has to complete, unaided and in silence, the exact flow the mentor exists to
// narrate. So the offer comes first, and it is SPOKEN.
//
// TWO LARGE TAPPABLE ANSWERS, NOT TEXT TO READ. Each carries an icon and a colour, and
// the spoken line names them out loud ("tap the green round button for yes") — because a
// child who cannot read the question cannot read the labels on the buttons either.
//
// ASKED IN HINDI, ALWAYS, regardless of the site toggle. At this moment nobody has told
// us what the child speaks, and Hindi is what this deployment serves by default. The
// language question comes second, once they have said yes.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, X, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useMentor } from '../context/MentorContext.jsx';
import { translations } from '../data/translations.js';
import { speakLine } from '../utils/mentorVoice.js';

const AVATAR = '/chatbot-avatar.png';

export default function MentorOffer() {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const { language, setLanguage } = useLanguage();
  const mentor = useMentor();
  const t = translations[language]?.voiceMentor || translations.en.voiceMentor;

  const [phase, setPhase] = useState('ask');     // 'ask' | 'language' | 'saving'
  const spoken = useRef(false);

  const leave = () => navigate('/onboarding/profile', { replace: true });

  // ── Speak the question on arrival ──
  //
  // Called through `speakLine` DIRECTLY rather than through `mentor.speak`, because
  // `mentor.speak` is gated on `active` — and at this exact moment the child has not yet
  // said yes, so the mentor is not active. This is the one screen where the mentor must
  // speak before being switched on: it is the screen asking to be switched on.
  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    // Hindi, unconditionally. See the header.
    speakLine('offer.ask', { lang: 'hi', authFetch, ownerId: 'mentor-offer' });
  }, [authFetch]);

  // A student the server says is ineligible never sees this screen. The client does not
  // decide that and does not cache the answer.
  useEffect(() => {
    if (mentor && mentor.config && !mentor.available) leave();
    // Already answered once — the offer is not repeated on a later login.
    if (mentor?.offered) leave();
  }, [mentor]);   // eslint-disable-line react-hooks/exhaustive-deps

  const decline = async () => {
    setPhase('saving');
    // `offered: true` with `enabled: false` records "asked and declined", which is a
    // DIFFERENT state from "never asked". Collapsing them re-offers the mentor on every
    // login to the one child who has already said no.
    await mentor?.savePrefs({ offered: true, enabled: false });
    await speakLine('offer.declined', { lang: 'hi', authFetch, ownerId: 'mentor-offer' });
    leave();
  };

  const accept = async () => {
    setPhase('language');
    speakLine('offer.language', { lang: 'hi', authFetch, ownerId: 'mentor-offer' });
  };

  const chooseLanguage = async (lang) => {
    setPhase('saving');
    // The write-through to `narrationLanguagePref` happens SERVER-side and is guarded on
    // `hasSeenNarrationPrompt` — see routes/mentorVoice.js. The client does not
    // replicate that rule, because two copies of a conditional write is how one of them
    // ends up overwriting a preference the student set deliberately.
    await mentor?.savePrefs({ offered: true, enabled: true, language: lang });
    // The site toggle follows too: a child who asked to be spoken to in Hindi should not
    // then be shown an English interface.
    setLanguage(lang);
    await mentor?.refresh();
    await speakLine('offer.confirmed', { lang, authFetch, ownerId: 'mentor-offer' });
    leave();
  };

  return (
    <div className="mentor-offer">
      <motion.img
        src={AVATAR} alt="" className="mo-avatar" aria-hidden="true"
        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      />

      {/* The written form of the spoken line, for a parent sitting alongside and for
          anyone who can read. It is never the ONLY form. */}
      <p className="mo-question" aria-live="polite">
        {phase === 'language' ? t.offerLanguage : t.offerAsk}
      </p>

      {phase === 'saving' && <Loader2 className="animate-spin mo-spin" size={22} />}

      {phase === 'ask' && (
        <div className="mo-choices">
          <button type="button" className="mo-choice mo-yes" onClick={accept} aria-label={t.offerYes}>
            <Check size={40} strokeWidth={3} />
            <span>{t.offerYes}</span>
          </button>
          <button type="button" className="mo-choice mo-no" onClick={decline} aria-label={t.offerNo}>
            <X size={40} strokeWidth={3} />
            <span>{t.offerNo}</span>
          </button>
        </div>
      )}

      {phase === 'language' && (
        <div className="mo-choices">
          <button type="button" className="mo-choice mo-lang" onClick={() => chooseLanguage('hi')}>
            <span className="mo-lang-glyph" aria-hidden="true">अ</span>
            <span>हिन्दी</span>
          </button>
          <button type="button" className="mo-choice mo-lang" onClick={() => chooseLanguage('en')}>
            <span className="mo-lang-glyph" aria-hidden="true">A</span>
            <span>English</span>
          </button>
        </div>
      )}

      {/* Always completable in silence. Turning the mentor off, or never turning it on,
          must never block anything — so there is a plain skip on the screen whose whole
          job is to ask about the mentor. */}
      <button type="button" className="mo-skip" onClick={decline}>{t.offerSkip}</button>
    </div>
  );
}
