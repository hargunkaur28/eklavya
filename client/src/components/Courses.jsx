import { ArrowRight } from 'lucide-react';
import { courses } from '../data/courses.js';
import { useLanguage } from '../context/LanguageContext.jsx';
import { Link } from 'react-router-dom';

export default function Courses({ onSelect }) {
  const { t, language } = useLanguage();

  return (
    <section className="courses-section" id="courses">
      <div className="section-heading">
        <div>
          <span className="section-kicker">{t('courses.kicker')}</span>
          <h2>{t('courses.heading')}</h2>
          <p>{t('courses.description')}</p>
        </div>
        <Link to="/courses" onClick={() => document.getElementById('courses')?.scrollIntoView({ behavior: 'smooth' })}>
          {t('courses.viewAll')} <ArrowRight size={16} />
        </Link>
      </div>
      <div className="marquee-container">
        <div className="marquee-track course-track">
          {[...courses, ...courses].map((course, index) => (
            <article className="course-card" key={`${course.id}-${index}`}>
              <div className="course-media">
                <img src={course.image} alt={typeof course.imageAlt === 'object' ? course.imageAlt[language] : course.imageAlt} />
                <span>{typeof course.duration === 'object' ? course.duration[language] : course.duration}</span>
              </div>
              <div className="course-body">
                <p className="provider">{course.provider}</p>
                <h3>{typeof course.title === 'object' ? course.title[language] : course.title}</h3>
                <p className="course-desc">{typeof course.summary === 'object' ? course.summary[language] : course.summary}</p>
                <button className="outline-button" onClick={() => onSelect(course.id)}>{t('courses.learnMore')}</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
