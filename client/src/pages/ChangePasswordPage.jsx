import { useState } from 'react';
import { Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import EklavyaLogo from '../components/EklavyaLogo.jsx';

// Phase 4: change-password screen with current-password re-verification. Serves
// two cases: a normal voluntary change, and the FORCED flow for a parent still on
// a temporary password (ProtectedRoute pins them here until it succeeds).
// Client-side checks mirror the server policy for fast feedback; the server
// remains the source of truth.
const policyOk = (pw) =>
  pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9\s]/.test(pw);

export default function ChangePasswordPage() {
  const { changePassword, mustChangePassword } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const forced = mustChangePassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!policyOk(newPassword)) {
      setError(t('auth.passwordPolicyHint'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      // Success: the forced flag is now cleared, so routing releases the user.
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not change password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-modal-container auth-page-card">
        <div className="auth-modal-header">
          <div className="auth-modal-logo-wrapper">
            <EklavyaLogo />
          </div>
          <p>{forced ? t('auth.changePasswordForcedTitle') : t('auth.changePasswordTitle')}</p>
        </div>

        {forced && (
          <div className="change-password-forced-note">
            <ShieldCheck size={16} /> {t('auth.changePasswordForcedNote')}
          </div>
        )}

        {error && <div className="auth-error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-modal-form">
          <div className="auth-input-group">
            <label>{t('auth.currentPassword')}</label>
            <div className="auth-input-wrapper">
              <Lock size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>{t('auth.newPassword')}</label>
            <div className="auth-input-wrapper">
              <Lock size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>{t('auth.confirmPassword')}</label>
            <div className="auth-input-wrapper">
              <Lock size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          <p className="password-policy-hint">{t('auth.passwordPolicyHint')}</p>

          <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {t('auth.processing')}
              </>
            ) : (
              <>
                {t('auth.changePasswordSubmit')}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {!forced && (
          <button type="button" className="change-password-back" onClick={() => navigate('/dashboard')}>
            {t('auth.backToDashboard')}
          </button>
        )}
      </div>
    </div>
  );
}
