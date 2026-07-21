import { useState } from 'react';
import { Mail, Lock, KeyRound, Save, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

// Phase 7: admin edits its own email / password / security code. Every change is
// gated by the CURRENT security code (verified server-side). Only the fields you
// fill in are changed; new values are persisted (DB override) and take effect on
// the next sign-in.
export default function AdminSettings() {
  const { user, updateAdminCredentials } = useAuth();

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newSecurityCode, setNewSecurityCode] = useState('');
  const [currentSecurityCode, setCurrentSecurityCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!newEmail.trim() && !newPassword && !newSecurityCode) {
      setError('Enter at least one new value to change.');
      return;
    }
    setBusy(true);
    try {
      await updateAdminCredentials({
        currentSecurityCode,
        newEmail: newEmail.trim() || undefined,
        newPassword: newPassword || undefined,
        newSecurityCode: newSecurityCode || undefined
      });
      setSuccess('Admin credentials updated. Use the new values next time you sign in.');
      setNewEmail('');
      setNewPassword('');
      setNewSecurityCode('');
      setCurrentSecurityCode('');
    } catch (err) {
      setError(err.message || 'Could not update admin credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h2 className="settings-heading">Admin Settings</h2>
      <p className="admin-current-email">Current email: <strong>{user?.email}</strong></p>

      <div className="change-password-forced-note">
        <ShieldAlert size={16} /> Changing any value requires your current security code.
      </div>

      {error && <div className="auth-error-banner">{error}</div>}
      {success && <div className="profile-success-banner">{success}</div>}

      <form onSubmit={handleSubmit} className="auth-modal-form">
        <div className="auth-input-group">
          <label>New Email (leave blank to keep)</label>
          <div className="auth-input-wrapper">
            <Mail size={18} />
            <input type="email" placeholder="new-admin@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div className="auth-input-group">
          <label>New Password (leave blank to keep)</label>
          <div className="auth-input-wrapper">
            <Lock size={18} />
            <input type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" />
          </div>
          <p className="password-policy-hint">At least 8 characters, with an uppercase letter, a number, and a symbol.</p>
        </div>

        <div className="auth-input-group">
          <label>New Security Code (leave blank to keep)</label>
          <div className="auth-input-wrapper">
            <KeyRound size={18} />
            <input type="password" placeholder="••••••••" value={newSecurityCode} onChange={(e) => setNewSecurityCode(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div className="auth-input-group">
          <label>Current Security Code (required)</label>
          <div className="auth-input-wrapper">
            <ShieldAlert size={18} />
            <input type="password" placeholder="••••••••" value={currentSecurityCode} onChange={(e) => setCurrentSecurityCode(e.target.value)} required autoComplete="off" />
          </div>
        </div>

        <button type="submit" className="auth-submit-btn" disabled={busy}>
          {busy ? (<><Loader2 className="animate-spin" size={18} /> Saving…</>) : (<><Save size={18} /> Save Changes</>)}
        </button>
      </form>
    </div>
  );
}
