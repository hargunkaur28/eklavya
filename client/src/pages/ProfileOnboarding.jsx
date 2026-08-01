import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, MapPin, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { saveDraft, loadDraft, clearDraft } from '../utils/onboardingDraft.js';
import { STEPS, TOTAL_STEPS, firstOffendingStep } from '../utils/onboardingSteps.js';

// Workstream B5 — the animated profile onboarding flow.
//
// One question per screen, presented by the existing avatar. The interaction rules
// below are load-bearing; each exists because getting it wrong traps or annoys a
// student on the very first thing they do on the platform.

const AVATAR = '/chatbot-avatar.png';

/** Types text in, but NEVER gates the input — see useTypewriter's contract below. */
function useTypewriter(text, enabled) {
  const [shown, setShown] = useState(enabled ? '' : text);
  useEffect(() => {
    if (!enabled) { setShown(text); return undefined; }
    setShown('');
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [text, enabled]);
  // `complete` lets a tap anywhere finish the text instantly.
  return [shown, useCallback(() => setShown(text), [text])];
}

export default function ProfileOnboarding() {
  const { user, saveProfileDetails, authFetch } = useAuth();
  const { language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const t = translations[language]?.profileFlow || translations.en.profileFlow;
  const errText = (code) => {
    const map = translations[language]?.onboarding?.errors || translations.en.onboarding.errors;
    return map[code] || map.GENERIC;
  };

  const userId = user?.id || 'anon';
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [form, setForm] = useState(() => ({
    age: '', studyMedium: '', fatherName: '', schoolName: '', schoolCity: '',
    phoneNumber: '', location: { village: '', city: '', state: '' },
    // Aadhaar and consent live ONLY here, in component state. They are absent from
    // the draft allow-list, so a reload costs re-entry rather than leaving a
    // plaintext number in localStorage on a shared school device.
    aadhaarNumber: '', aadhaarConsent: false,
    ...loadDraft(userId)
  }));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [aadhaarEnabled, setAadhaarEnabled] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [boards, setBoards] = useState([]);

  const inputRef = useRef(null);

  // Draft everything the allow-list permits. Aadhaar/consent are filtered out inside
  // saveDraft, so passing the whole form is safe by construction.
  useEffect(() => { saveDraft(userId, form); }, [form, userId]);

  // The client HIDES the Aadhaar step-field when the deployment has not enabled
  // collection, rather than showing a field guaranteed to fail on submit.
  useEffect(() => {
    let alive = true;
    authFetch('/auth/profile-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setAadhaarEnabled(!!d.aadhaarEnabled); setBoards(d.studyMediums || []); } })
      .catch(() => { /* field simply stays hidden */ });
    return () => { alive = false; };
  }, [authFetch]);

  // ── Android hardware back moves between STEPS, not out of the flow ──────────
  // Default behaviour pops the route, dumping the student out mid-onboarding — the
  // guard then redirects them straight back in at step 1. Each step pushes a history
  // entry so the OS back button is Back.
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.onboardingStep;
      if (typeof s === 'number') { setDir(-1); setStep(s); }
      else { window.history.pushState({ onboardingStep: 0 }, ''); setDir(-1); setStep(0); }
    };
    window.history.replaceState({ onboardingStep: 0 }, '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goTo = useCallback((next, direction) => {
    setDir(direction);
    setStep(next);
    setFormError('');
    if (direction > 0) window.history.pushState({ onboardingStep: next }, '');
  }, []);

  const stepDef = STEPS[step];
  const question = t.questions[stepDef.id];
  const [typed, completeTyping] = useTypewriter(question, !reduceMotion);

  // ── Focus moves to the new step's input on every transition ────────────────
  // Otherwise focus stays on the button just clicked: keyboard and screen-reader
  // users must tab back in on every screen, and the mobile keyboard never opens.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), reduceMotion ? 0 : 260);
    return () => clearTimeout(id);
  }, [step, reduceMotion]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const clearFieldError = (field) => setFieldErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Client-side gate for the CURRENT step only — optional fields never block.
  const stepValid = useMemo(() => {
    if (stepDef.id === 'age') return Number.isInteger(Number(form.age)) && Number(form.age) >= 5 && Number(form.age) <= 25;
    // Workstream H: boards are a closed two-entry set, so a selection is the whole
    // gate — there is no 'Other' free-text branch left to validate.
    if (stepDef.id === 'board') return !!form.studyMedium;
    if (stepDef.id === 'family') return form.fatherName.trim().length >= 2;
    if (stepDef.id === 'school') return form.schoolName.trim().length >= 2 && form.schoolCity.trim().length >= 2;
    return true; // optional step
  }, [stepDef.id, form]);

  const next = () => { if (stepValid && step < TOTAL_STEPS - 1) goTo(step + 1, 1); };
  const back = () => { if (step > 0) { setDir(-1); setStep(step - 1); window.history.back(); } };

  // ── Auto-advance fires on a GENUINE user change only ───────────────────────
  // Attached to the interaction, never to an effect watching studyMedium — an effect
  // re-fires on mount and on Back, bouncing the student forward again. Restoring a
  // draft sets state without touching this path.
  const chooseBoard = (value) => {
    set({ studyMedium: value });
    clearFieldError('studyMedium');
    if (value !== 'Other') setTimeout(() => goTo(step + 1, 1), reduceMotion ? 0 : 220);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setFormError(errText('GEOCODE_COORDS_INVALID')); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await authFetch('/auth/reverse-geocode', {
            method: 'POST',
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          });
          const data = await res.json();
          if (res.ok && data.resolved) set({ location: data.location });
          else setFormError(errText(data.error || 'GEOCODE_FAILED'));
        } catch { setFormError(errText('GEOCODE_FAILED')); }
        finally { setGeoBusy(false); }
      },
      // Permission denied is NOT an error state — fall back to manual entry silently.
      () => setGeoBusy(false),
      { timeout: 8000 }
    );
  };

  const submit = async () => {
    if (submitting) return;              // guard: a double-tap must not fire two PATCHes
    setSubmitting(true);
    setFormError('');
    setFieldErrors({});
    try {
      await saveProfileDetails({
        age: Number(form.age),
        studyMedium: form.studyMedium,
        fatherName: form.fatherName.trim(),
        schoolName: form.schoolName.trim(),
        schoolCity: form.schoolCity.trim(),
        phoneNumber: form.phoneNumber.trim(),
        location: form.location,
        ...(aadhaarEnabled && form.aadhaarNumber.trim()
          ? { aadhaarNumber: form.aadhaarNumber.trim(), aadhaarConsent: form.aadhaarConsent }
          : {})
      });
      clearDraft(userId);               // ONLY after a confirmed success
      setDone(true);
      // The celebration plays OVER the transition; it never holds the route.
      setTimeout(() => navigate('/onboarding', { replace: true }), reduceMotion ? 0 : 1500);
    } catch (err) {
      const fields = err.fields || {};
      setFieldErrors(fields);
      // A field error about step 1 must not render on step 5 where its input isn't.
      const jump = firstOffendingStep(fields);
      if (jump >= 0 && jump !== step) goTo(jump, -1);
      else setFormError(errText(err.code));
      setSubmitting(false);             // stay on the step, offer retry
    }
  };

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: dir * 60 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: dir * -60 } };

  const err = (f) => (fieldErrors[f] ? <p className="pf-field-error">{errText(fieldErrors[f])}</p> : null);

  return (
    <div className="pf-page" onClick={completeTyping}>
      {/* The language toggle used to live here, because this flow rendered with no site
          header and being trapped in English on the one screen a student cannot skip
          past would be the worst possible place for it. The flow now renders inside
          PageShell, whose header carries the toggle AND keeps it visible at 360px via
          .mobile-header-actions rather than hiding it behind the hamburger — so the
          guarantee still holds and a second toggle on the same screen would just be
          two controls doing one job. If the site header ever stops showing it at
          mobile width, put this back. */}
      <header className="pf-header">
        <span className="pf-brand">{t.title}</span>
      </header>

      <div className="pf-progress" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1}>
        {STEPS.map((s, i) => (
          <span key={s.id} className="pf-seg">
            <motion.span
              className="pf-seg-fill"
              initial={false}
              animate={{ width: i <= step ? '100%' : '0%' }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 26 }}
            />
          </span>
        ))}
      </div>

      <div className="pf-card">
        <img src={AVATAR} alt="" className="pf-avatar" aria-hidden="true" />

        <div className="pf-body">
          {/* aria-live so the typed question is ANNOUNCED, not silently appearing. */}
          <p className="pf-question" aria-live="polite">{typed}</p>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={stepDef.id} {...slide} transition={{ duration: reduceMotion ? 0 : 0.26 }} className="pf-step">
              {done ? (
                <div className="pf-done">
                  <motion.span
                    className="pf-check"
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 14 }}
                  >
                    <Check size={30} />
                  </motion.span>
                  <p>{t.allSet(user?.name || '')}</p>
                </div>
              ) : stepDef.id === 'age' ? (
                <>
                  <input
                    ref={inputRef} className="pf-input" type="text" inputMode="numeric" maxLength={2}
                    value={form.age} placeholder={t.agePlaceholder}
                    onChange={(e) => { set({ age: e.target.value.replace(/\D/g, '') }); clearFieldError('age'); }}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                    aria-label={t.questions.age}
                  />
                  {err('age')}
                </>
              ) : stepDef.id === 'board' ? (
                <>
                  <div className="pf-choices">
                    {boards.map((b) => (
                      <button
                        key={b} type="button"
                        // Previous selection renders visibly selected, so returning
                        // via Back never leaves the student guessing what they picked.
                        className={`pf-choice ${form.studyMedium === b ? 'selected' : ''}`}
                        onClick={() => chooseBoard(b)}
                      >
                        {t.boards[b] || b}
                      </button>
                    ))}
                  </div>
                  {err('studyMedium')}
                </>
              ) : stepDef.id === 'family' ? (
                <>
                  <input
                    ref={inputRef} className="pf-input" type="text" maxLength={60}
                    value={form.fatherName} placeholder={t.fatherPlaceholder}
                    onChange={(e) => { set({ fatherName: e.target.value }); clearFieldError('fatherName'); }}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                    aria-label={t.questions.family}
                  />
                  {err('fatherName')}
                </>
              ) : stepDef.id === 'school' ? (
                <>
                  <input
                    ref={inputRef} className="pf-input" type="text" maxLength={120}
                    value={form.schoolName} placeholder={t.schoolPlaceholder}
                    onChange={(e) => { set({ schoolName: e.target.value }); clearFieldError('schoolName'); }}
                    aria-label={t.schoolLabel}
                  />
                  {err('schoolName')}
                  <input
                    className="pf-input" type="text" maxLength={80}
                    value={form.schoolCity} placeholder={t.cityPlaceholder}
                    onChange={(e) => { set({ schoolCity: e.target.value }); clearFieldError('schoolCity'); }}
                    onKeyDown={(e) => e.key === 'Enter' && next()}
                    aria-label={t.cityLabel}
                  />
                  {err('schoolCity')}
                </>
              ) : (
                <>
                  <p className="pf-optional-note">{t.optionalNote}</p>

                  <label className="pf-label">{t.phoneLabel}</label>
                  <input
                    ref={inputRef} className="pf-input" type="text" inputMode="numeric" maxLength={13}
                    autoComplete="off"
                    value={form.phoneNumber} placeholder={t.phonePlaceholder}
                    onChange={(e) => { set({ phoneNumber: e.target.value }); clearFieldError('phoneNumber'); }}
                  />
                  {err('phoneNumber')}

                  <label className="pf-label">{t.locationLabel}</label>
                  <button type="button" className="pf-ghost" onClick={useMyLocation} disabled={geoBusy}>
                    {geoBusy ? <Loader2 className="animate-spin" size={15} /> : <MapPin size={15} />} {t.useLocation}
                  </button>
                  <div className="pf-loc-row">
                    <input className="pf-input" type="text" maxLength={80} value={form.location.village}
                      placeholder={t.villagePlaceholder}
                      onChange={(e) => set({ location: { ...form.location, village: e.target.value } })} />
                    <input className="pf-input" type="text" maxLength={80} value={form.location.city}
                      placeholder={t.cityPlaceholder}
                      onChange={(e) => set({ location: { ...form.location, city: e.target.value } })} />
                    <input className="pf-input" type="text" maxLength={80} value={form.location.state}
                      placeholder={t.statePlaceholder}
                      onChange={(e) => set({ location: { ...form.location, state: e.target.value } })} />
                  </div>

                  {/* Hidden entirely when the deployment does not collect Aadhaar. */}
                  {aadhaarEnabled && (
                    <>
                      <label className="pf-label">{t.aadhaarLabel}</label>
                      <input
                        className="pf-input" type="text" inputMode="numeric" maxLength={14}
                        // autoComplete off + type=text so password managers and browser
                        // autofill do not retain the number either.
                        autoComplete="off" autoCorrect="off" spellCheck={false}
                        value={form.aadhaarNumber} placeholder={t.aadhaarPlaceholder}
                        onChange={(e) => { set({ aadhaarNumber: e.target.value.replace(/[^\d ]/g, '') }); clearFieldError('aadhaarNumber'); }}
                      />
                      <p className="pf-help">{t.aadhaarHelp}</p>
                      <label className="pf-consent">
                        <input type="checkbox" checked={form.aadhaarConsent}
                          onChange={(e) => { set({ aadhaarConsent: e.target.checked }); clearFieldError('aadhaarNumber'); }} />
                        <span>{t.aadhaarConsent}</span>
                      </label>
                      {err('aadhaarNumber')}
                    </>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {formError && (
            <div className="pf-form-error" role="alert">
              <AlertCircle size={16} /> {formError}
            </div>
          )}

          {!done && (
            <div className="pf-nav">
              <button type="button" className="pf-ghost" onClick={back} disabled={step === 0 || submitting}>
                <ArrowLeft size={15} /> {t.back}
              </button>

              {step < TOTAL_STEPS - 1 ? (
                <button type="button" className="pf-primary" onClick={next} disabled={!stepValid}>
                  {t.continue} <ArrowRight size={15} />
                </button>
              ) : (
                <div className="pf-final">
                  {/* Skip is prominent: every optional field must be skippable in one tap. */}
                  <button type="button" className="pf-ghost" onClick={submit} disabled={submitting}>
                    {t.skipAll}
                  </button>
                  <button type="button" className="pf-primary" onClick={submit} disabled={submitting}>
                    {submitting
                      ? <><Loader2 className="animate-spin" size={15} /> {t.saving}</>
                      : <>{t.finish} <ArrowRight size={15} /></>}
                  </button>
                </div>
              )}
            </div>
          )}

          {formError && !submitting && step === TOTAL_STEPS - 1 && (
            <button type="button" className="pf-ghost pf-retry" onClick={submit}>
              <RefreshCw size={14} /> {t.retry}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
