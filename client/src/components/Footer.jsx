import { useLanguage } from '../context/LanguageContext.jsx';

export default function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="footer">
      <div><a className="brand" href="#">{t('brand')}</a><p>{t('footer.tagline')}</p></div>
      <div><strong>{t('footer.product')}</strong><a>{t('footer.productCourses')}</a><a>{t('footer.productQuizzes')}</a><a>{t('footer.productPricing')}</a></div>
      <div><strong>{t('footer.company')}</strong><a>{t('footer.companyAbout')}</a><a>{t('footer.companyStories')}</a><a>{t('footer.companyContact')}</a></div>
      <div><strong>{t('footer.support')}</strong><a>{t('footer.supportHelp')}</a><a>{t('footer.supportPrivacy')}</a><a>{t('footer.supportTerms')}</a></div>
    </footer>
  );
}
