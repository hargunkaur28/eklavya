import { Menu, X, User, LogOut, LayoutDashboard } from 'lucide-react';
import GooeyNav from './GooeyNav';
import EklavyaLogo from './EklavyaLogo';
import Avatar from './Avatar.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Link, useNavigate } from 'react-router-dom';

export default function Header({ mobileOpen, setMobileOpen }) {
  const { t, language, toggleLanguage } = useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { label: t('nav.home'), href: '#' },
    { label: t('nav.courses'), href: '#courses' },
    { label: t('nav.mentors'), href: '#why-choose' },
    { label: t('nav.successStories'), href: '#success-stories' },
    { label: t('nav.about'), href: '#why-choose' }
  ];

  const mobileNav = [
    { label: t('nav.home'), href: '#' },
    { label: t('nav.courses'), href: '#courses' },
    { label: t('nav.mentors'), href: '#why-choose' },
    { label: t('nav.successStories'), href: '#success-stories' },
    { label: t('nav.about'), href: '#why-choose' }
  ];

  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Project Eklavya Home">
        <EklavyaLogo />
      </Link>
      <div className="desktop-nav-wrapper">
        <GooeyNav items={navItems} />
      </div>
      <div className="header-actions">
        <button
          className="lang-toggle"
          onClick={toggleLanguage}
          aria-label={t('header.langToggleLabel')}
          aria-pressed={language === 'hi'}
        >
          <span className={language === 'en' ? 'lang-active' : ''}>EN</span>
          <span className={language === 'hi' ? 'lang-active' : ''}>हि</span>
        </button>

        {user ? (
          <>
            <button className="ghost-button" onClick={() => navigate(user.role === 'admin' ? '/admin' : '/dashboard')}>
              <LayoutDashboard size={16} /> {t('header.dashboard')}
            </button>
            {/* Phase 7: the badge opens account settings for students (parents are
                read-only and cannot edit the shared account). */}
            {user.role === 'student' ? (
              <button
                type="button"
                className="user-profile-badge user-profile-badge-btn"
                title={user.email}
                onClick={() => navigate('/profile')}
              >
                <Avatar url={user.photoUrl} name={user.name} size={22} />
                <span>{user.name.split(' ')[0]}</span>
              </button>
            ) : (
              <div className="user-profile-badge" title={user.email}>
                <Avatar url={user.photoUrl} name={user.name} size={22} />
                <span>{user.name.split(' ')[0]}</span>
              </div>
            )}
            <button className="icon-button" onClick={logout} title={t('header.logout')} aria-label={t('header.logout')}>
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <>
            <button className="ghost-button" onClick={() => navigate('/login')}>
              {t('header.login')}
            </button>
            <button className="primary-button" onClick={() => navigate('/signup')}>
              {t('header.getStarted')}
            </button>
          </>
        )}
      </div>

      <div className="mobile-header-actions">
        <button
          className="lang-toggle"
          onClick={toggleLanguage}
          aria-label={t('header.langToggleLabel')}
          aria-pressed={language === 'hi'}
        >
          <span className={language === 'en' ? 'lang-active' : ''}>EN</span>
          <span className={language === 'hi' ? 'lang-active' : ''}>हि</span>
        </button>
        <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </button>
      </div>

      {mobileOpen && (
        <div className="mobile-panel">
          <button className="icon-button close-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            <X size={22} />
          </button>
          {mobileNav.map((item) => (
            <a key={item.label} href={item.href} onClick={() => setMobileOpen(false)}>
              {item.label}
            </a>
          ))}
          {user ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', marginTop: '0.5rem' }}>
              <button className="primary-button" onClick={() => { setMobileOpen(false); navigate(user.role === 'admin' ? '/admin' : '/dashboard'); }}>
                {t('header.dashboard')}
              </button>
              {user.role === 'student' && (
                <button className="ghost-button" style={{ border: '1px solid currentColor' }} onClick={() => { setMobileOpen(false); navigate('/profile'); }}>
                  <User size={16} /> {t('auth.profileTitle')}
                </button>
              )}
              <button className="ghost-button" style={{ border: '1px solid currentColor' }} onClick={() => { setMobileOpen(false); logout(); }}>
                <LogOut size={16} /> {t('header.logout')}
              </button>
            </div>
          ) : (
            <button className="primary-button" onClick={() => { setMobileOpen(false); navigate('/login'); }}>
              {t('header.login')}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
