import { useState } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2, KeyRound, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import EklavyaLogo from '../components/EklavyaLogo.jsx';

// Phase 1: dedicated /login and /signup pages. This is a structural move of the
// former AuthModal into a routed page — the auth logic, validation, error
// messages, and redirect-after-auth behaviour are preserved exactly.
export default function AuthPage({ initialTab = 'login' }) {
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Phase 7: admin can sign in from this page too. When the entered email+password
  // match the admin, we reveal a security-code field and switch to admin login.
  const [adminStep, setAdminStep] = useState(false);
  const [securityCode, setSecurityCode] = useState('');

  const { login, signup, adminLogin, adminPrecheck } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Editing the email/password invalidates a revealed admin step.
  const resetAdmin = () => { if (adminStep) { setAdminStep(false); setSecurityCode(''); } };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (tab === 'signup') {
        await signup(name, email, password, rememberMe);
        navigate('/onboarding');
      } else if (adminStep) {
        // Admin second step: email + password + security code.
        await adminLogin(email, password, securityCode);
        navigate('/admin');
      } else {
        // Normal student/parent login first.
        try {
          const { roadmap, mustChangePassword } = await login(email, password, rememberMe);
          if (mustChangePassword) {
            navigate('/change-password'); // parent on a temp password
          } else if (roadmap) {
            navigate('/dashboard');
          } else {
            navigate('/onboarding');
          }
        } catch (loginErr) {
          // Not a student/parent — is it the admin? If so, reveal the code field.
          const isAdmin = await adminPrecheck(email, password);
          if (isAdmin) {
            setAdminStep(true);
          } else {
            throw loginErr; // normal "Invalid email or password."
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
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
          <p>{t('auth.tagline')}</p>
        </div>

        <div className="auth-modal-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            {t('auth.loginTab')}
          </button>
          <button
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); }}
          >
            {t('auth.createAccountTab')}
          </button>
        </div>

        {error && <div className="auth-error-banner">{error}</div>}

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
                onChange={(e) => { setEmail(e.target.value); resetAdmin(); }}
                required
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>{t('auth.password')}</label>
            <div className="auth-input-wrapper">
              <Lock size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); resetAdmin(); }}
                required
                minLength={tab === 'signup' ? 8 : undefined}
              />
            </div>
            {tab === 'signup' && (
              <p className="password-policy-hint">{t('auth.passwordPolicyHint')}</p>
            )}
          </div>

          {/* Phase 7: revealed only when the email+password match the admin */}
          {tab === 'login' && adminStep && (
            <div className="auth-input-group">
              <div className="change-password-forced-note">
                <ShieldAlert size={16} /> {t('auth.adminDetected')}
              </div>
              <label>{t('auth.adminSecurityCode')}</label>
              <div className="auth-input-wrapper">
                <KeyRound size={18} />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={securityCode}
                  onChange={(e) => setSecurityCode(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
          )}

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
                {tab === 'signup'
                  ? t('auth.signupSubmit')
                  : adminStep
                    ? t('auth.adminSignIn')
                    : t('auth.loginSubmit')}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
