import { useState } from 'react';
import { Mail, Lock, KeyRound, ArrowRight, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavigate } from 'react-router-dom';
import EklavyaLogo from '../components/EklavyaLogo.jsx';

// Phase 6: dedicated admin login (English-only internal tool). Three factors —
// email + password + security code — submitted together; the server returns one
// generic error and never reveals which factor failed.
export default function AdminLoginPage() {
  const { adminLogin } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [securityCode, setSecurityCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await adminLogin(email, password, securityCode);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message || 'Admin login failed');
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
          <p>Admin Console</p>
        </div>

        <div className="change-password-forced-note">
          <ShieldAlert size={16} /> Restricted access. Authorized administrators only.
        </div>

        {error && <div className="auth-error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-modal-form">
          <div className="auth-input-group">
            <label>Admin Email</label>
            <div className="auth-input-wrapper">
              <Mail size={18} />
              <input
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>Password</label>
            <div className="auth-input-wrapper">
              <Lock size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>Security Code</label>
            <div className="auth-input-wrapper">
              <KeyRound size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={securityCode}
                onChange={(e) => setSecurityCode(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="animate-spin" size={18} /> Verifying…</>
            ) : (
              <>Sign In <ArrowRight size={18} /></>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
