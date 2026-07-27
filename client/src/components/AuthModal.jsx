import { useState } from 'react';
import { X, Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import EklavyaLogo from './EklavyaLogo.jsx';

export default function AuthModal({ isOpen, onClose, initialTab = 'login' }) {
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Forgot password 3-step state
  const [forgotStep, setForgotStep] = useState(1); // 1: Request OTP, 2: Verify OTP, 3: Reset Password
  const [accountType, setAccountType] = useState('student');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { login, signup } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (!isOpen) return null;

  const resetFormState = () => {
    setError('');
    setSuccessMsg('');
    setForgotStep(1);
    setOtp('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setSuccessMsg(`Verification code (OTP) sent to ${email}. Check your inbox!`);
      setForgotStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, accountType })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');
      setResetToken(data.resetToken);
      setSuccessMsg('OTP verified successfully! Now set your new password.');
      setForgotStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setSuccessMsg('Password updated successfully! Redirecting to login...');
      setTimeout(() => {
        setTab('login');
        resetFormState();
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (tab === 'login') {
        const { roadmap } = await login(email, password, rememberMe);
        onClose();
        if (roadmap) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      } else {
        await signup(name, email, password, rememberMe);
        onClose();
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal-container" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose} aria-label="Close modal">
          <X size={20} />
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-logo-wrapper">
            <EklavyaLogo />
          </div>
          <p>{t('auth.tagline')}</p>
        </div>

        <div className="auth-modal-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); resetFormState(); }}
          >
            {t('auth.loginTab')}
          </button>
          <button
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); resetFormState(); }}
          >
            {t('auth.createAccountTab')}
          </button>
          {tab === 'forgot' && (
            <button className="auth-tab active">
              Forgot Password
            </button>
          )}
        </div>

        {error && <div className="auth-error-banner">{error}</div>}
        {successMsg && <div className="auth-success-banner" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.88rem' }}>{successMsg}</div>}

        {tab === 'forgot' ? (
          <div className="forgot-password-flow">
            {forgotStep === 1 && (
              <form onSubmit={handleRequestOtp} className="auth-modal-form">
                <div className="auth-input-group">
                  <label>Account Context</label>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="accountType"
                        value="student"
                        checked={accountType === 'student'}
                        onChange={() => setAccountType('student')}
                      /> Student Account
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="accountType"
                        value="parent"
                        checked={accountType === 'parent'}
                        onChange={() => setAccountType('parent')}
                      /> Parent Account
                    </label>
                  </div>
                </div>

                <div className="auth-input-group">
                  <label>Student Email Address</label>
                  <div className="auth-input-wrapper">
                    <Mail size={18} />
                    <input
                      type="email"
                      placeholder="student@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '4px' }}>
                    {accountType === 'parent' ? 'OTP will be sent to the registered student email address.' : 'Enter your registered email address.'}
                  </p>
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> Sending OTP…</> : <>Send Verification Code (OTP) <ArrowRight size={18} /></>}
                </button>

                <div style={{ textAlignment: 'center', marginTop: '12px' }}>
                  <button type="button" onClick={() => { setTab('login'); resetFormState(); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.86rem', textDecoration: 'underline' }}>
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}

            {forgotStep === 2 && (
              <form onSubmit={handleVerifyOtp} className="auth-modal-form">
                <div className="auth-input-group">
                  <label>Enter 6-Digit OTP</label>
                  <div className="auth-input-wrapper">
                    <Lock size={18} />
                    <input
                      type="text"
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      maxLength={6}
                      style={{ letterSpacing: '4px', fontSize: '1.2rem', textAlign: 'center', fontWeight: 'bold' }}
                    />
                  </div>
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isSubmitting || otp.length !== 6}>
                  {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> Verifying…</> : <>Verify OTP <ArrowRight size={18} /></>}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '0.86rem' }}>
                  <button type="button" onClick={() => setForgotStep(1)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                    ← Change Email
                  </button>
                  <button type="button" onClick={handleRequestOtp} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>
                    Resend OTP
                  </button>
                </div>
              </form>
            )}

            {forgotStep === 3 && (
              <form onSubmit={handleResetPassword} className="auth-modal-form">
                <div className="auth-input-group">
                  <label>New Password</label>
                  <div className="auth-input-wrapper">
                    <Lock size={18} />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <div className="auth-input-group">
                  <label>Confirm New Password</label>
                  <div className="auth-input-wrapper">
                    <Lock size={18} />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> Resetting…</> : <>Reset Password <ArrowRight size={18} /></>}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-modal-form">
            {tab === 'signup' && (
              <div className="auth-input-group">
                <label>{t('auth.fullName')}</label>
                <div className="auth-input-wrapper">
                  <User size={18} />
                  <input
                    type="text"
                    placeholder={t('auth.fullNamePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-input-group">
              <label>{t('auth.emailAddress')}</label>
              <div className="auth-input-wrapper">
                <Mail size={18} />
                <input
                  type="email"
                  placeholder="student@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="auth-input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>{t('auth.password')}</label>
                {tab === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setTab('forgot'); resetFormState(); }}
                    style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="auth-input-wrapper">
                <Lock size={18} />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div className="auth-remember-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 14px', fontSize: '0.86rem', color: '#6B6357', cursor: 'pointer' }}>
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: '#2F6B3A', cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <label htmlFor="rememberMe" style={{ cursor: 'pointer', userSelect: 'none' }}>
                {t('auth.rememberMe')}
              </label>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {t('auth.processing')}
                </>
              ) : (
                <>
                  {tab === 'login' ? t('auth.loginSubmit') : t('auth.signupSubmit')}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
