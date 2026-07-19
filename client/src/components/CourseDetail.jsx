import { useState } from 'react';
import { CheckCircle2, ChevronLeft, PlayCircle } from 'lucide-react';
import Footer from './Footer.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

export default function CourseDetail({ course, onBack }) {
  const { t, language } = useLanguage();
  const [answers, setAnswers] = useState({});

  // Helper to get localized text from { en, hi } objects or plain strings
  const loc = (value) => {
    if (value && typeof value === 'object' && (value.en || value.hi)) {
      return value[language] ?? value.en;
    }
    return value;
  };

  // Score uses correctIndex for language-agnostic comparison
  const score = course.quiz.reduce((total, question) => {
    const selectedIndex = answers[question.id];
    return total + (selectedIndex === question.correctIndex ? 1 : 0);
  }, 0);
  const attempted = Object.keys(answers).length;

  return (
    <main>
      <header className="detail-header">
        <button className="back-button" onClick={onBack}><ChevronLeft size={18} /> {t('courseDetail.backToCourses')}</button>
        <a className="brand" href="#" onClick={onBack}>{t('brand')}</a>
      </header>
      <section className="detail-hero">
        <img src={course.image} alt={loc(course.imageAlt)} />
        <div>
          <p className="provider">{course.provider} {t('courseDetail.youtubeLabel')}</p>
          <h1>{loc(course.title)}</h1>
          <p>{loc(course.longDescription)}</p>
          <div className="detail-tags">
            {course.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <a className="primary-button large" href={course.youtubeUrl} target="_blank" rel="noreferrer">
            {t('courseDetail.openOnYoutube')} <PlayCircle size={18} />
          </a>
        </div>
      </section>
      <section className="detail-content">
        <aside className="course-outline">
          <h2>{t('courseDetail.learningPath')}</h2>
          {(Array.isArray(course.modules) ? course.modules : (loc(course.modules) || [])).map((module) => {
            const moduleText = typeof module === 'string' ? module : loc(module);
            return (
              <div className="module-item" key={moduleText}>
                <CheckCircle2 size={18} />
                <span>{moduleText}</span>
              </div>
            );
          })}
          <div className="backend-note">
            <strong>{t('courseDetail.backendNote')}</strong>
            <p>{t('courseDetail.backendNoteDesc')}</p>
          </div>
        </aside>
        <section className="quiz-panel">
          <div className="quiz-heading">
            <div>
              <span className="section-kicker">{t('courseDetail.quizKicker')}</span>
              <h2>{loc(course.quizTitle)}</h2>
            </div>
            <div className="score-box">
              <strong>{score}/{course.quiz.length}</strong>
              <span>{attempted} {t('courseDetail.attempted')}</span>
            </div>
          </div>
          {course.quiz.map((question, index) => {
            const options = question.options && typeof question.options === 'object' && question.options[language]
              ? question.options[language]
              : (question.options?.en || []);

            return (
              <article className="question-card" key={question.id}>
                <h3>{index + 1}. {loc(question.prompt)}</h3>
                <div className="option-grid">
                  {options.map((option, optIndex) => {
                    const picked = answers[question.id] === optIndex;
                    const showCorrect = answers[question.id] !== undefined && optIndex === question.correctIndex;
                    return (
                      <button
                        className={`option-button ${picked ? 'picked' : ''} ${showCorrect ? 'correct' : ''}`}
                        key={optIndex}
                        onClick={() => setAnswers({ ...answers, [question.id]: optIndex })}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                {answers[question.id] !== undefined && <p className="explanation">{loc(question.explanation)}</p>}
              </article>
            );
          })}
        </section>
      </section>
      <Footer />
    </main>
  );
}
