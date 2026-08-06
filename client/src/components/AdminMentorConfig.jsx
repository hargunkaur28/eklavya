// Feature 27 — the admin control for the Voice Mentor's grade ceiling.
//
// A separate component from AdminSettings because it is a different kind of setting:
// the credential form is gated on the current security code (it changes who can log
// in), and this is a product configuration. Folding it into that form would mean typing
// a security code to change a grade, which is friction with no security value.
//
// A PICKER, NOT A TEXT BOX. The value must be a grade the taxonomy knows: an
// unrecognised one resolves to index -1, which compares below every real grade, so a
// typo would silently disable the mentor for EVERY student with no error anywhere and
// nothing in the UI to explain why the feature had vanished. The server refuses an
// unknown value too (MENTOR_GRADE_NOT_IN_TAXONOMY) — this just makes it untypeable.

import { useCallback, useEffect, useState } from 'react';
import { Mic, Save, Loader2, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AdminMentorConfig() {
  const { authFetch } = useAuth();
  const [grades, setGrades] = useState([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/admin/mentor-config');
      if (!res.ok) return;
      const data = await res.json();
      setGrades(data.grades || []);
      setValue(data.mentorMaxGrade || '');
    } catch {
      setError('Could not read the mentor configuration.');
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const save = async (grade) => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await authFetch('/admin/mentor-config', {
        method: 'PATCH',
        body: JSON.stringify({ mentorMaxGrade: grade })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save.'); return; }
      setValue(data.mentorMaxGrade);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Could not save the mentor configuration.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h2 className="settings-heading"><Mic size={18} /> Voice Mentor</h2>
      <p className="admin-current-email">
        The spoken guide is offered to students up to and including this class. It exists for
        children who cannot yet read the interface, so the right value is a judgement about
        this deployment&apos;s actual students rather than a fixed number.
      </p>

      <div className="change-password-forced-note">
        Takes effect for new sessions — no redeploy needed. It deliberately does not reach into
        a session already running: a mentor that stops mid-sentence because this form was saved
        is, to a child, indistinguishable from a mentor that broke.
      </div>

      {error && <div className="auth-error-banner">{error}</div>}

      <div className="chip-grid" style={{ marginTop: '1rem' }}>
        {grades.map((g) => (
          <button
            key={g}
            type="button"
            className={`select-chip ${value === g ? 'selected' : ''}`}
            onClick={() => save(g)}
            disabled={busy}
          >
            {g}
          </button>
        ))}
      </div>

      <p className="admin-current-email" style={{ marginTop: '0.75rem' }}>
        {busy ? <><Loader2 className="animate-spin" size={14} /> Saving…</>
          : saved ? <><Check size={14} /> Saved — mentor available up to <strong>{value}</strong></>
          : <>Currently: <strong>{value || '—'}</strong></>}
      </p>
    </div>
  );
}
