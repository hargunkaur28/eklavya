import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { translations } from '../data/translations.js';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem('lms-lang') || 'en';
    } catch {
      return 'en';
    }
  });

  // Set document lang attribute on mount and on change
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('lms-lang', language);
    } catch {
      // localStorage unavailable
    }
  }, [language]);

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => (prev === 'en' ? 'hi' : 'en'));
  }, []);

  // t('hero.titleLine1') → looks up translations[language].hero.titleLine1
  // Falls back to English value if missing in current language
  const t = useCallback((key) => {
    const keys = key.split('.');
    let valueCurrent = translations[language];
    let valueFallback = translations.en;

    for (const k of keys) {
      valueCurrent = valueCurrent?.[k];
      valueFallback = valueFallback?.[k];
    }

    // Return current language value, or English fallback, or the key itself
    return valueCurrent ?? valueFallback ?? key;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
