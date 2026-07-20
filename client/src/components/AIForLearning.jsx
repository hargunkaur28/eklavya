import { Mic, Sprout, Bot, FileText } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.jsx';
import ScrollReveal from './ScrollReveal.jsx';
import './AIForLearning.css';

export default function AIForLearning() {
  const { t } = useLanguage();

  /** Wrap every occurrence of "Sarvam AI" or "सर्वम AI" in a highlight span */
  const highlightSarvam = (text) => {
    if (!text) return '';
    const keyword = text.includes('सर्वम AI') ? 'सर्वम AI' : 'Sarvam AI';
    const idx = text.indexOf(keyword);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="ai-highlight-sarvam">{keyword}</span>
        {text.slice(idx + keyword.length)}
      </>
    );
  };

  return (
    <section className="ai-for-learning" id="ai-for-learning">
      <div className="ai-for-learning-inner">
        {/* Section Heading & Subheading stay exactly as already written */}
        <div className="ai-header-block">
          <ScrollReveal>
            <div className="ai-kicker-row">
              <div className="ai-tricolor-bar">
                <span />
                <span />
                <span />
              </div>
              <span className="ai-kicker-text">{t('aiForLearning.kicker')}</span>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={100}>
            <h2>{t('aiForLearning.heading')}</h2>
          </ScrollReveal>

          <ScrollReveal delay={200}>
            <p className="ai-for-learning-sub">{t('aiForLearning.subheading')}</p>
          </ScrollReveal>
        </div>

        {/* Scattered Collage Grid Container */}
        <div className="ai-scatter-container">
          
          {/* Pathway connecting SVG line (hidden on mobile) */}
          <svg className="ai-pathway-svg" viewBox="0 0 1400 330" preserveAspectRatio="none" aria-hidden="true">
            <path 
              d="M 100 135 C 200 10, 200 320, 300 185 C 400 50, 400 290, 500 150 C 600 10, 600 320, 700 185 C 800 50, 800 290, 900 135 C 1000 0, 1000 330, 1100 185 C 1200 50, 1200 290, 1300 150" 
              fill="none" 
              stroke="rgba(181, 161, 120, 0.35)" 
              strokeWidth="3" 
              strokeDasharray="8 10" 
            />
          </svg>

          {/* Pathway connecting SVG line for mobile (hidden on desktop) */}
          <svg className="ai-pathway-mobile-svg" viewBox="0 0 320 1400" preserveAspectRatio="none" aria-hidden="true">
            <path 
              d="M 100 80 C 100 170, 220 170, 220 260 C 220 390, 100 390, 100 520 C 100 610, 220 610, 220 700 C 220 830, 100 830, 100 960 C 100 1050, 220 1050, 220 1140 C 220 1270, 100 1270, 100 1350" 
              fill="none" 
              stroke="rgba(181, 161, 120, 0.35)" 
              strokeWidth="3" 
              strokeDasharray="8 10" 
            />
          </svg>

          {/* Zone 1: Content Circle (Sarvam AI) - Soft Green */}
          <ScrollReveal className="ai-zone ai-zone-1" delay={250}>
            <div className="ai-item-card green-tint">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <Mic size={32} className="ai-icon" />
                  <span className="ai-circle-label">{t('aiForLearning.card1Title')}</span>
                  <p className="ai-circle-desc">{highlightSarvam(t('aiForLearning.card1Text'))}</p>
                </div>
              </div>
              <div className="ai-caption-wrap">
                <h3 className="ai-mobile-label">{t('aiForLearning.card1Title')}</h3>
                <p className="ai-caption">{highlightSarvam(t('aiForLearning.card1Text'))}</p>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 2: Image Circle 1 (Primary Photo) */}
          <ScrollReveal className="ai-zone ai-zone-2" delay={300}>
            <div className="ai-item-card image-card primary-img">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <img
                    src="https://images.hindustantimes.com/rf/image_size_800x600/HT/p2/2016/09/20/Pictures/hindustan-chokhandi-september-computer-september-students-learning_d5176eee-7f5d-11e6-a0d9-e435f3f63e15.jpg"
                    alt="Rural Indian students learning on computers"
                  />
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 3: Content Circle (Built for Bharat) - Peach */}
          <ScrollReveal className="ai-zone ai-zone-3" delay={350}>
            <div className="ai-item-card peach-tint">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <Sprout size={32} className="ai-icon" />
                  <span className="ai-circle-label">{t('aiForLearning.card2Title')}</span>
                  <p className="ai-circle-desc">{highlightSarvam(t('aiForLearning.card2Text'))}</p>
                </div>
              </div>
              <div className="ai-caption-wrap">
                <h3 className="ai-mobile-label">{t('aiForLearning.card2Title')}</h3>
                <p className="ai-caption">{highlightSarvam(t('aiForLearning.card2Text'))}</p>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 4: Image Circle 2 (Secondary Photo) */}
          <ScrollReveal className="ai-zone ai-zone-4" delay={400}>
            <div className="ai-item-card image-card secondary-img">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <img
                    src="https://villagesquare.in/wp-content/uploads/2017/10/Computers1.jpg"
                    alt="Students learning together in rural school classroom"
                  />
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 5: Content Circle (AI Tutor) - Yellow */}
          <ScrollReveal className="ai-zone ai-zone-5" delay={450}>
            <div className="ai-item-card yellow-tint">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <Bot size={32} className="ai-icon" />
                  <span className="ai-circle-label">{t('aiForLearning.card3Title')}</span>
                  <p className="ai-circle-desc">{highlightSarvam(t('aiForLearning.card3Text'))}</p>
                </div>
              </div>
              <div className="ai-caption-wrap">
                <h3 className="ai-mobile-label">{t('aiForLearning.card3Title')}</h3>
                <p className="ai-caption">{highlightSarvam(t('aiForLearning.card3Text'))}</p>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 6: Image Circle 3 (Shutterstock Photo) */}
          <ScrollReveal className="ai-zone ai-zone-6" delay={500}>
            <div className="ai-item-card image-card secondary-img">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <img
                    src="https://www.shutterstock.com/image-photo/indian-village-government-school-boys-260nw-2251941889.jpg"
                    alt="Indian village government school boys"
                  />
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Zone 7: Content Circle 4 (AI Notes & PDFs) - Rose */}
          <ScrollReveal className="ai-zone ai-zone-7" delay={550}>
            <div className="ai-item-card rose-tint">
              <div className="ai-circle-wrap">
                <div className="ai-circle">
                  <FileText size={32} className="ai-icon" />
                  <span className="ai-circle-label">{t('aiForLearning.card4Title')}</span>
                  <p className="ai-circle-desc">{highlightSarvam(t('aiForLearning.card4Text'))}</p>
                </div>
              </div>
              <div className="ai-caption-wrap">
                <h3 className="ai-mobile-label">{t('aiForLearning.card4Title')}</h3>
                <p className="ai-caption">{highlightSarvam(t('aiForLearning.card4Text'))}</p>
              </div>
            </div>
          </ScrollReveal>

          {/* 4 small decorative dots: green, peach, yellow, rose */}
          <div className="ai-decorative-dot dot-green" aria-hidden="true"></div>
          <div className="ai-decorative-dot dot-peach" aria-hidden="true"></div>
          <div className="ai-decorative-dot dot-yellow" aria-hidden="true"></div>
          <div className="ai-decorative-dot dot-rose" aria-hidden="true"></div>

        </div>
      </div>
    </section>
  );
}
