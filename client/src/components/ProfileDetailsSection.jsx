import { useState, useEffect } from 'react';
import { Loader2, ShieldCheck, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';

// Workstream B — Settings → Edit Profile: the PROFILE-DETAILS half.
//
// THIS IS A SEPARATE FILE ON PURPOSE. ProfilePage.jsx already owns an identity form
// (name/email → PATCH /api/auth/profile, with password re-verification on an email
// change). These are two different endpoints with two different payloads, and one
// shared submit handler is exactly where the wrong body gets sent — in the worst
// case shipping the Aadhaar field along with an email change.
//
// Keeping them in different components with different handlers makes that merge
// impossible rather than merely discouraged: there is no single `handleSubmit` for a
// later edit to consolidate. If these ever need to look like one page, they can sit
// side by side visually and stay separate structurally.
//
// Student-only: a parent shares the User document (Option B) and never edits it.
export default function ProfileDetailsSection() {
  const { user, saveProfileDetails, removeAadhaar, authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.profileFlow || translations.en.profileFlow;
  const ts = translations[language]?.profileSettings || translations.en.profileSettings;
  const errText = (code) => {
    const map = translations[language]?.onboarding?.errors || translations.en.onboarding.errors;
    return map[code] || map.GENERIC;
  };

  const p = user?.profile || {};
  const [form, setForm] = useState({
    age: p.age ?? '', studyMedium: p.studyMedium || '',
    fatherName: p.fatherName || '', schoolName: p.schoolName || '', schoolCity: p.schoolCity || '',
    phoneNumber: p.phoneNumber || '',
    location: { village: p.location?.village || '', city: p.location?.city || '', state: p.location?.state || '' }
  });

  // ── Aadhaar is NOT part of `form` ──────────────────────────────────────────
  // The masked value is DISPLAY TEXT and is never an input's value. "Replace" opens
  // an EMPTY field with a freshly unticked consent box, so the mask can never
  // round-trip as the submitted number, and a new number always re-collects consent.
  const [replacing, setReplacing] = useState(false);
  const [newAadhaar, setNewAadhaar] = useState('');
  const [newConsent, setNewConsent] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [aadhaarEnabled, setAadhaarEnabled] = useState(false);
  const [boards, setBoards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    authFetch('/auth/profile-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setAadhaarEnabled(!!d.aadhaarEnabled); setBoards(d.studyMediums || []); } })
      .catch(() => { /* Aadhaar controls stay hidden */ });
    return () => { alive = false; };
  }, [authFetch]);

  if (user?.role !== 'student') return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Handler for THIS section only. It never touches name/email.
  const submitDetails = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(''); setMsg(''); setFieldErrors({});
    try {
      await saveProfileDetails({
        age: Number(form.age),
        studyMedium: form.studyMedium,
        fatherName: form.fatherName.trim(),
        schoolName: form.schoolName.trim(),
        schoolCity: form.schoolCity.trim(),
        phoneNumber: form.phoneNumber.trim(),
        location: form.location,
        // Included ONLY when the student is actively replacing. An absent
        // aadhaarNumber means "unchanged" server-side — never "delete".
        ...(aadhaarEnabled && replacing && newAadhaar.trim()
          ? { aadhaarNumber: newAadhaar.trim(), aadhaarConsent: newConsent }
          : {})
      });
      setMsg(ts.saved);
      setReplacing(false); setNewAadhaar(''); setNewConsent(false);
    } catch (e2) {
      setFieldErrors(e2.fields || {});
      setErr(errText(e2.code));
    } finally { setBusy(false); }
  };

  const doRemove = async () => {
    setRemoving(true); setErr(''); setMsg('');
    try {
      await removeAadhaar();
      setConfirmRemove(false);
      setMsg(ts.aadhaarRemoved);
    } catch (e2) { setErr(errText(e2.message)); }
    finally { setRemoving(false); }
  };

  const fe = (f) => (fieldErrors[f] ? <p className="pf-field-error">{errText(fieldErrors[f])}</p> : null);

  return (
    <div className="settings-card">
      <h3>{ts.title}</h3>
      <p className="settings-sub">{ts.subtitle}</p>

      {/* Separate <form> with its own handler → PATCH /api/auth/profile-details. */}
      <form onSubmit={submitDetails} className="auth-modal-form">
        <label className="pf-label">{ts.ageLabel}</label>
        <input className="pf-input" type="text" inputMode="numeric" maxLength={2} value={form.age}
          onChange={(e) => set({ age: e.target.value.replace(/\D/g, '') })} />
        {fe('age')}

        <label className="pf-label">{ts.boardLabel}</label>
        <select className="pf-input" value={form.studyMedium} onChange={(e) => set({ studyMedium: e.target.value })}>
          <option value="">—</option>
          {boards.map((b) => <option key={b} value={b}>{t.boards[b] || b}</option>)}
        </select>
        {fe('studyMedium')}

        <label className="pf-label">{ts.fatherLabel}</label>
        <input className="pf-input" type="text" maxLength={60} value={form.fatherName}
          onChange={(e) => set({ fatherName: e.target.value })} />
        {fe('fatherName')}

        <label className="pf-label">{t.schoolLabel}</label>
        <input className="pf-input" type="text" maxLength={120} value={form.schoolName}
          onChange={(e) => set({ schoolName: e.target.value })} />
        {fe('schoolName')}

        <label className="pf-label">{t.cityLabel}</label>
        <input className="pf-input" type="text" maxLength={80} value={form.schoolCity}
          onChange={(e) => set({ schoolCity: e.target.value })} />
        {fe('schoolCity')}

        <label className="pf-label">{t.phoneLabel}</label>
        <input className="pf-input" type="text" inputMode="numeric" maxLength={13} autoComplete="off"
          value={form.phoneNumber} onChange={(e) => set({ phoneNumber: e.target.value })} />
        {fe('phoneNumber')}

        {aadhaarEnabled && (
          <div className="aadhaar-block">
            <label className="pf-label"><ShieldCheck size={14} /> {t.aadhaarLabel}</label>

            {!replacing ? (
              <div className="aadhaar-current">
                {/* Display text, never a form value. */}
                <code>{p.aadhaarOnFile ? p.aadhaarMasked : ts.aadhaarNone}</code>
                <div className="aadhaar-actions">
                  <button type="button" className="pf-ghost" onClick={() => { setReplacing(true); setNewAadhaar(''); setNewConsent(false); }}>
                    <RefreshCw size={14} /> {p.aadhaarOnFile ? ts.replace : ts.addAadhaar}
                  </button>
                  {p.aadhaarOnFile && (
                    <button type="button" className="pf-ghost danger" onClick={() => setConfirmRemove(true)}>
                      <Trash2 size={14} /> {ts.remove}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Empty field + freshly unticked consent: a new number is a new
                    disclosure, so consent is collected again and timestamped fresh. */}
                <input className="pf-input" type="text" inputMode="numeric" maxLength={14}
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                  placeholder={t.aadhaarPlaceholder} value={newAadhaar}
                  onChange={(e) => setNewAadhaar(e.target.value.replace(/[^\d ]/g, ''))} />
                <p className="pf-help">{t.aadhaarHelp}</p>
                <label className="pf-consent">
                  <input type="checkbox" checked={newConsent} onChange={(e) => setNewConsent(e.target.checked)} />
                  <span>{t.aadhaarConsent}</span>
                </label>
                {fe('aadhaarNumber')}
                <button type="button" className="pf-ghost" onClick={() => { setReplacing(false); setNewAadhaar(''); setNewConsent(false); }}>
                  {ts.cancel}
                </button>
              </>
            )}

            {confirmRemove && (
              <div className="aadhaar-confirm" role="alertdialog" aria-label={ts.removeTitle}>
                <p><AlertTriangle size={16} /> <strong>{ts.removeTitle}</strong></p>
                {/* States plainly that this is total and irreversible — there is no
                    decrypt, so nothing is archived and nothing can be restored. */}
                <p>{ts.removeBody}</p>
                <div className="aadhaar-actions">
                  <button type="button" className="pf-ghost" onClick={() => setConfirmRemove(false)} disabled={removing}>
                    {ts.cancel}
                  </button>
                  <button type="button" className="pf-primary danger" onClick={doRemove} disabled={removing}>
                    {removing ? <><Loader2 className="animate-spin" size={14} /> {ts.removing}</> : ts.removeConfirm}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {err && <div className="auth-error-banner">{err}</div>}
        {msg && <div className="auth-success-banner">{msg}</div>}

        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <><Loader2 className="animate-spin" size={15} /> {t.saving}</> : ts.save}
        </button>
      </form>
    </div>
  );
}
