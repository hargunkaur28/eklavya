import { useState, useRef } from 'react';
import { User, Mail, Lock, Save, Loader2, ShieldAlert, KeyRound, Camera, Trash2, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar.jsx';
import ProfileDetailsSection from '../components/ProfileDetailsSection.jsx';

// Phase 7: student account settings — edit name and/or email. Password changes go
// through the existing /change-password flow (button below). Email is the login
// identity for the student AND their linked parent (Option B), so changing it
// requires the current password and is double-entered as a typo guard (NOT
// verification — there is no email-verification system).
export default function ProfilePage() {
  const { user, updateProfile, updatePreferences, uploadProfilePhoto, removeProfilePhoto } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Narration prefs (account-level). Locally optimistic + persisted via updatePreferences.
  const [narrationPref, setNarrationPref] = useState(user?.narrationLanguagePref || 'hindi');
  const [autoNarrate, setAutoNarrate] = useState(!!user?.autoNarrateQuizzes);
  const [prefBusy, setPrefBusy] = useState(false);

  if (!user) return null;

  const savePref = async (patch, revert) => {
    setError(''); setSuccess(''); setPrefBusy(true);
    try {
      await updatePreferences(patch);
      setSuccess(t('auth.prefSaved'));
    } catch (err) {
      revert();
      setError(err.message || t('auth.prefError'));
    } finally {
      setPrefBusy(false);
    }
  };

  const onNarrationPref = (val) => {
    const prev = narrationPref;
    setNarrationPref(val);
    savePref({ narrationLanguagePref: val }, () => setNarrationPref(prev));
  };

  const onToggleAutoNarrate = () => {
    const next = !autoNarrate;
    setAutoNarrate(next);
    savePref({ autoNarrateQuizzes: next }, () => setAutoNarrate(!next));
  };

  const NARRATION_OPTIONS = [
    { value: 'hindi', label: t('auth.narrationHindi'), hint: t('auth.narrationHindiHint') },
    { value: 'english', label: t('auth.narrationEnglish'), hint: t('auth.narrationEnglishHint') },
    { value: 'match-toggle', label: t('auth.narrationMatch'), hint: t('auth.narrationMatchHint') }
  ];

  const onPickPhoto = () => fileInputRef.current?.click();

  const onPhotoSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError('');
    setSuccess('');
    setPhotoBusy(true);
    try {
      await uploadProfilePhoto(file);
      setSuccess(t('auth.profileSaved'));
    } catch (err) {
      setError(err.message || t('auth.profilePhotoError'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const onRemovePhoto = async () => {
    setError('');
    setSuccess('');
    setPhotoBusy(true);
    try {
      await removeProfilePhoto();
    } catch (err) {
      setError(err.message || t('auth.profilePhotoError'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const nameChanged = name.trim() !== (user.name || '');
  const emailChanged = email.trim().toLowerCase() !== (user.email || '').toLowerCase();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!nameChanged && !emailChanged) {
      setError(t('auth.profileNoChanges'));
      return;
    }
    if (emailChanged && email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError(t('auth.profileEmailsDoNotMatch'));
      return;
    }

    const payload = {};
    if (nameChanged) payload.name = name.trim();
    if (emailChanged) {
      payload.email = email.trim();
      payload.currentPassword = currentPassword;
    }

    setIsSubmitting(true);
    try {
      await updateProfile(payload);
      setSuccess(t('auth.profileSaved'));
      setCurrentPassword('');
      setConfirmEmail('');
    } catch (err) {
      setError(err.message || t('auth.profileError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-modal-container auth-page-card">
        <div className="auth-modal-header">
          <p>{t('auth.profileTitle')}</p>
        </div>

        {/* Phase 7.5: profile photo */}
        <div className="profile-photo-row">
          <div className={`profile-photo-avatar ${photoBusy ? 'busy' : ''}`}>
            <Avatar url={user.photoUrl} name={user.name} size={88} />
            {photoBusy && <span className="profile-photo-spinner"><Loader2 size={20} className="animate-spin" /></span>}
          </div>
          <div className="profile-photo-controls">
            <span className="profile-photo-label">{t('auth.profilePhoto')}</span>
            <div className="profile-photo-buttons">
              <button type="button" className="profile-photo-btn" onClick={onPickPhoto} disabled={photoBusy}>
                <Camera size={15} /> {user.photoUrl ? t('auth.profilePhotoChange') : t('auth.profilePhotoUpload')}
              </button>
              {user.photoUrl && (
                <button type="button" className="profile-photo-btn ghost" onClick={onRemovePhoto} disabled={photoBusy}>
                  <Trash2 size={15} /> {t('auth.profilePhotoRemove')}
                </button>
              )}
            </div>
            <span className="profile-photo-hint">{t('auth.profilePhotoHint')}</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={onPhotoSelected}
          />
        </div>

        {error && <div className="auth-error-banner">{error}</div>}
        {success && <div className="profile-success-banner">{success}</div>}

        <form onSubmit={handleSubmit} className="auth-modal-form">
          <div className="auth-input-group">
            <label>{t('auth.profileName')}</label>
            <div className="auth-input-wrapper">
              <User size={18} />
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
            </div>
          </div>

          <div className="auth-input-group">
            <label>{t('auth.profileEmail')}</label>
            <div className="auth-input-wrapper">
              <Mail size={18} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <p className="password-policy-hint">{t('auth.profileTypoNote')}</p>
          </div>

          {/* Extra fields appear only when the email is actually being changed. */}
          {emailChanged && (
            <>
              {user.parentLinked && (
                <div className="change-password-forced-note">
                  <ShieldAlert size={16} /> {t('auth.profileEmailWarning')}
                </div>
              )}
              <div className="auth-input-group">
                <label>{t('auth.profileConfirmEmail')}</label>
                <div className="auth-input-wrapper">
                  <Mail size={18} />
                  <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} required />
                </div>
              </div>
              <div className="auth-input-group">
                <label>{t('auth.profileCurrentPasswordForEmail')}</label>
                <div className="auth-input-wrapper">
                  <Lock size={18} />
                  <input type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </div>
              </div>
            </>
          )}

          <button type="submit" className="auth-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="animate-spin" size={18} /> {t('auth.processing')}</>
            ) : (
              <><Save size={18} /> {t('auth.profileSave')}</>
            )}
          </button>
        </form>

        {/* Workstream B: a SEPARATE form with its own handler, posting to
            PATCH /api/auth/profile-details. Deliberately not merged with the
            identity form above (PATCH /api/auth/profile) — two endpoints sharing
            one submit handler is how the wrong payload gets sent, and in the
            worst case ships the Aadhaar field along with an email change. */}
        <ProfileDetailsSection />

        <button type="button" className="profile-change-password-btn" onClick={() => navigate('/change-password')}>
          <KeyRound size={16} /> {t('auth.profileChangePasswordLink')}
        </button>

        {/* Narration preferences (student-only; parents/admins have no quiz flows) */}
        {user.role === 'student' && (
          <div className="narration-settings">
            <div className="narration-settings-head">
              <Volume2 size={18} />
              <h3>{t('auth.narrationTitle')}</h3>
            </div>

            <div className="narration-field">
              <span className="narration-field-label">{t('auth.narrationLangLabel')}</span>
              <div className="narration-radio-group">
                {NARRATION_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`narration-radio ${narrationPref === opt.value ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="narrationLanguagePref"
                      value={opt.value}
                      checked={narrationPref === opt.value}
                      onChange={() => onNarrationPref(opt.value)}
                      disabled={prefBusy}
                    />
                    <span className="narration-radio-body">
                      <strong>{opt.label}</strong>
                      <small>{opt.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="narration-toggle">
              <input type="checkbox" checked={autoNarrate} onChange={onToggleAutoNarrate} disabled={prefBusy} />
              <span>
                <strong>{t('auth.autoNarrateLabel')}</strong>
                <small>{t('auth.autoNarrateHint')}</small>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
