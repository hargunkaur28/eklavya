import { Target, UsersRound, BarChart3, BookOpen, ClipboardCheck, Star, Bot, Languages, Mic } from 'lucide-react';
import TiltedCard from './TiltedCard';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function WhyChoose() {
  const { t } = useLanguage();

  const items = [
    { Icon: Target, title: t('whyChoose.card1Title'), text: t('whyChoose.card1Text'), tint: 'tint-blue' },
    { Icon: UsersRound, title: t('whyChoose.card2Title'), text: t('whyChoose.card2Text'), tint: 'tint-green' },
    { Icon: BarChart3, title: t('whyChoose.card3Title'), text: t('whyChoose.card3Text'), tint: 'tint-orange' },
    { Icon: BookOpen, title: t('whyChoose.card4Title'), text: t('whyChoose.card4Text'), tint: 'tint-blue' },
    { Icon: ClipboardCheck, title: t('whyChoose.card5Title'), text: t('whyChoose.card5Text'), tint: 'tint-rose' },
    { Icon: Star, title: t('whyChoose.card6Title'), text: t('whyChoose.card6Text'), tint: 'tint-purple' },
    { Icon: Bot, title: t('whyChoose.card7Title'), text: t('whyChoose.card7Text'), tint: 'tint-teal' },
    { Icon: Languages, title: t('whyChoose.card8Title'), text: t('whyChoose.card8Text'), tint: 'tint-orange' },
    { Icon: Mic, title: t('whyChoose.card9Title'), text: t('whyChoose.card9Text'), tint: 'tint-blue' }
  ];

  return (
    <section className="why" id="why-choose">
      <span className="section-kicker">{t('whyChoose.kicker')}</span>
      <h2 className="why-heading">
        {t('whyChoose.headingPart1')}
        <br />
        <span className="why-highlight-green">{t('whyChoose.headingHighlight')}</span>
      </h2>
      <p className="section-intro">{t('whyChoose.intro')}</p>
      <div className="feature-grid">
        {items.map(({ Icon, title, text, tint }) => (
          <TiltedCard
            key={title}
            altText={title}
            captionText={title}
            containerHeight="170px"
            containerWidth="100%"
            imageHeight="170px"
            imageWidth="100%"
            rotateAmplitude={10}
            scaleOnHover={1.05}
            showMobileWarning={false}
            showTooltip={false}
            displayOverlayContent={true}
            overlayContent={
              <div className="why-card-overlay">
                <div className={`why-card-icon ${tint}`}>
                  <Icon size={24} />
                </div>
                <div className="why-card-text">
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            }
          />
        ))}
      </div>
    </section>
  );
}
