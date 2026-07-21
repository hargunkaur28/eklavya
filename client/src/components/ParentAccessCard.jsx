import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { Users, Copy, Check, ShieldAlert, RefreshCw } from 'lucide-react';

// Phase 3 (frontend): a STUDENT creates parent access from their dashboard.
// Calls POST /auth/parent/generate, which returns a word-based temporary password
// exactly ONCE. We display it here with a copy button and a "won't be shown again"
// warning — it is never re-fetchable (only the bcrypt hash is stored server-side).
export default function ParentAccessCard() {
  const { user, authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [linked, setLinked] = useState(!!user?.parentLinked);
  const [credentials, setCredentials] = useState(null); // { email, tempPassword } — shown once
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Only students can create parent access. A parent/admin session never sees this.
  if (user?.role && user.role !== 'student') return null;

  const generate = async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const res = await authFetch('/auth/parent/generate', { method: 'POST' });
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      setCredentials({ email: data.email, tempPassword: data.tempPassword });
      setLinked(true);
    } catch {
      setError(t.parentAccessError);
    } finally {
      setLoading(false);
    }
  };

  const copyPassword = async () => {
    if (!credentials?.tempPassword) return;
    try {
      await navigator.clipboard.writeText(credentials.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the password is still visible to copy manually.
    }
  };

  return (
    <div className="parent-access-card">
      <div className="parent-access-head">
        <span className="parent-access-icon"><Users size={18} /></span>
        <h3>{t.parentAccessTitle}</h3>
        {linked && !credentials && <span className="parent-access-badge">●</span>}
      </div>

      {/* One-time credential reveal — highest-priority state after generating. */}
      {credentials ? (
        <div className="parent-access-reveal">
          <p className="parent-access-warning">
            <ShieldAlert size={15} /> {t.parentAccessShareTitle}
          </p>
          <div className="parent-cred-row">
            <span className="parent-cred-label">{t.parentAccessEmailLabel}</span>
            <code className="parent-cred-value">{credentials.email}</code>
          </div>
          <div className="parent-cred-row">
            <span className="parent-cred-label">{t.parentAccessPasswordLabel}</span>
            <code className="parent-cred-value parent-cred-password">{credentials.tempPassword}</code>
            <button type="button" className="parent-copy-btn" onClick={copyPassword}>
              {copied ? <><Check size={14} /> {t.parentAccessCopied}</> : <><Copy size={14} /> {t.parentAccessCopy}</>}
            </button>
          </div>
          <p className="parent-access-note">{t.parentAccessChangeNote}</p>
        </div>
      ) : (
        <>
          <p className="parent-access-intro">
            {linked ? t.parentAccessActive : t.parentAccessIntro}
          </p>
          {error && <p className="parent-access-error">{error}</p>}
          <button type="button" className="parent-access-btn" onClick={generate} disabled={loading}>
            {loading ? (
              t.parentAccessGenerating
            ) : linked ? (
              <><RefreshCw size={15} /> {t.parentAccessRegenerate}</>
            ) : (
              <><Users size={15} /> {t.parentAccessCreate}</>
            )}
          </button>
        </>
      )}
    </div>
  );
}
