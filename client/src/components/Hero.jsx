import { useEffect, useState, useRef } from 'react';
import { ArrowRight, BarChart3, GraduationCap, Star, UsersRound, Video, Bot, Languages, Mic } from 'lucide-react';
import LiquidChrome from './LiquidChrome';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function Hero() {
  const [isMounted, setIsMounted] = useState(false);
  const heroRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="hero" ref={heroRef}>
      {/* Background Liquid Chrome animation */}
      <div className="hero-liquid-background">
        <LiquidChrome
          baseColor={[0.18, 0.42, 0.23]}
          speed={0.35}
          amplitude={0.5}
          interactive={true}
        />
      </div>

      <div className="hero-copy">
        <div 
          className={`audience-pill reveal-item ${isMounted ? 'is-visible' : ''}`} 
          style={{ '--delay': '0ms', '--reveal-translate': '10px' }}
        >
          <GraduationCap size={16} />
          <span>{t('hero.badge1')}</span>
          <strong>{t('hero.badgeJee')}</strong>
          <strong>{t('hero.badgeNeet')}</strong>
        </div>
        <h1>
          <span 
            className={`hero-title-line line-1 reveal-item ${isMounted ? 'is-visible' : ''}`}
            style={{ '--delay': '100ms', '--reveal-translate': '16px' }}
          >
            {t('hero.titleLine1')} <span className="highlight-word">{t('hero.titleHighlight')}</span>{" "}
          </span>
          <span 
            className={`hero-title-line line-2 reveal-item ${isMounted ? 'is-visible' : ''}`}
            style={{ '--delay': '200ms', '--reveal-translate': '16px' }}
          >
            {t('hero.titleLine2')}
          </span>
        </h1>
        <p 
          className={`reveal-item ${isMounted ? 'is-visible' : ''}`} 
          style={{ '--delay': '300ms', '--reveal-translate': '12px' }}
        >
          {t('hero.description')}
        </p>
        <div 
          className={`hero-actions reveal-item ${isMounted ? 'is-visible' : ''}`} 
          style={{ '--delay': '400ms', '--reveal-translate': '10px' }}
        >
          <a className="primary-button large" href="#courses">{t('hero.ctaPrimary')} <ArrowRight size={17} /></a>
          <a className="secondary-button large" href="#courses">{t('hero.ctaSecondary')} <ArrowRight size={17} /></a>
        </div>
        <div 
          className={`student-count reveal-item ${isMounted ? 'is-visible' : ''}`} 
          style={{ '--delay': '480ms', '--reveal-translate': '10px' }}
        >
          <div className="avatar-stack">
            <img src="https://img.magnific.com/free-photo/two-colleagues-working-laptop_114579-2814.jpg?semt=ais_hybrid&w=740&q=80" alt="Indian student" />
            <img src="https://images.unsplash.com/photo-1607746882042-944635dfe10e?auto=format&fit=crop&w=120&q=80" alt="Indian learner" />
            <img src="https://images.unsplash.com/photo-1604079628040-94301bb21b91?auto=format&fit=crop&w=120&q=80" alt="Indian mentor" />
          </div>
          <div><strong>{t('hero.studentCount')}</strong><span>{t('hero.studentCountLabel')}</span></div>
        </div>
        <div 
          className={`hero-extra-features reveal-item ${isMounted ? 'is-visible' : ''}`} 
          style={{ '--delay': '520ms', '--reveal-translate': '10px' }}
        >
          <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1F2A1F', fontSize: '0.95rem', fontWeight: '600' }}><Bot size={18} color="#2F6B3A" /> <strong>{t('hero.featureAi')}:</strong> {t('hero.featureAiDesc')}</li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1F2A1F', fontSize: '0.95rem', fontWeight: '600' }}><Languages size={18} color="#2F6B3A" /> <strong>{t('hero.featureTrans')}:</strong> {t('hero.featureTransDesc')}</li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1F2A1F', fontSize: '0.95rem', fontWeight: '600' }}><Mic size={18} color="#2F6B3A" /> <strong>{t('hero.featureSpeech')}:</strong> {t('hero.featureSpeechDesc')}</li>
          </ul>
        </div>
      </div>
      <div 
        className={`hero-visual reveal-item ${isMounted ? 'is-visible' : ''}`} 
        style={{ '--delay': '560ms', '--reveal-scale': '0.95' }} 
        aria-label="Indian student learning online"
      >
        <div className="feature-card top-left"><Video size={22} /><strong>{t('hero.featureLive')}</strong><span>{t('hero.featureLiveDesc')}</span></div>
        <div className="feature-card top-right"><UsersRound size={22} /><strong>{t('hero.featureMentors')}</strong><span>{t('hero.featureMentorsDesc')}</span></div>
        <div className="feature-card mid-left"><BarChart3 size={22} /><strong>{t('hero.featureMock')}</strong><span>{t('hero.featureMockDesc')}</span></div>
        <div className="feature-card mid-right"><Star size={22} /><strong>{t('hero.featureProgress')}</strong><span>{t('hero.featureProgressDesc')}</span></div>
        <img className="main-student" src="https://img.magnific.com/free-photo/two-colleagues-working-laptop_114579-2814.jpg?semt=ais_hybrid&w=740&q=80" alt="Real Indian student holding books" />
      </div>
    </section>
  );
}
