import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext.jsx';
import EklavyaLogo from './EklavyaLogo.jsx';

// The columns list what the app ACTUALLY does, and every entry is a real route.
// Previously these were bare <a> tags with no href — Product/Company/Support headings
// over Pricing, Success Stories and a Help Center, none of which exist. Placeholder
// links read as broken rather than as coming soon.
export default function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="footer">
      <div className="footer-brand">
        <Link className="brand" to="/"><EklavyaLogo /></Link>
        <p>{t('footer.tagline')}</p>
        <p className="footer-note">{t('footer.builtWith')}</p>
      </div>

      <div>
        <strong>{t('footer.learn')}</strong>
        <Link to="/courses">{t('footer.learnCourses')}</Link>
        <Link to="/onboarding">{t('footer.learnDiagnostic')}</Link>
        <Link to="/dashboard">{t('footer.learnRoadmap')}</Link>
        <Link to="/dashboard">{t('footer.learnPractice')}</Link>
      </div>

      <div>
        <strong>{t('footer.space')}</strong>
        <Link to="/mentor">{t('footer.spaceMentor')}</Link>
        <Link to="/dashboard">{t('footer.spaceNotes')}</Link>
        <Link to="/dashboard">{t('footer.spaceProgress')}</Link>
        <Link to="/profile">{t('footer.spaceProfile')}</Link>
      </div>

      <div>
        <strong>{t('footer.account')}</strong>
        <Link to="/login">{t('footer.accountSignIn')}</Link>
        <Link to="/signup">{t('footer.accountSignUp')}</Link>
        <Link to="/dashboard">{t('footer.accountParent')}</Link>
        <Link to="/change-password">{t('footer.accountPassword')}</Link>
      </div>
    </footer>
  );
}
