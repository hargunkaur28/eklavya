import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { ArrowLeft, CheckSquare, Square, Clock, Youtube, FileText, ExternalLink, Loader2 } from 'lucide-react';
import SpeakerButton from '../components/SpeakerButton.jsx';

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}` : null;
}

export default function DayDetail() {
  const { roadmapId, dayNumber } = useParams();
  const { authFetch, refreshRoadmap } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();

  const t = translations[language]?.dayDetail || translations.en.dayDetail;
  const tDash = translations[language]?.dashboard || translations.en.dashboard;

  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    setLoading(true);
    authFetch(`/roadmap/${roadmapId}/day/${dayNumber}?lang=${language}`)
      .then((res) => {
        if (!res.ok) throw new Error(t.couldNotLoad);
        return res.json();
      })
      .then((data) => setDayData(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [roadmapId, dayNumber, language, authFetch, t.couldNotLoad]);

  const handleToggleCompletion = async () => {
    if (!dayData) return;
    setToggling(true);
    const nextState = !dayData.completed;
    setDayData((prev) => ({ ...prev, completed: nextState }));

    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: nextState })
      });
      if (res.ok) {
        await refreshRoadmap();
      }
    } catch (err) {
      console.warn('Failed to update completion:', err);
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="day-detail-page">
        <div className="day-detail-container" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <Loader2 className="animate-spin" size={36} style={{ color: '#2F6B3A' }} />
          <p style={{ marginTop: '1rem', color: '#6B6357' }}>{t.loading}</p>
        </div>
      </div>
    );
  }

  if (error || !dayData) {
    return (
      <div className="day-detail-page">
        <div className="day-detail-container" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <h2>{t.unavailable}</h2>
          <p>{error || t.couldNotLoad}</p>
          <button className="primary-button" onClick={() => navigate('/dashboard')}>
            {t.backToRoadmap}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="day-detail-page">
      <div className="day-detail-container">
        {/* Top Nav Row */}
        <div className="detail-top-nav">
          <button className="ghost-button" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={16} /> {t.backToRoadmap}
          </button>
          <button
            className={`complete-toggle-btn ${dayData.completed ? 'completed' : ''}`}
            onClick={handleToggleCompletion}
            disabled={toggling}
          >
            {dayData.completed ? (
              <><CheckSquare size={18} /> {t.completed}</>
            ) : (
              <><Square size={18} /> {t.markComplete}</>
            )}
          </button>
        </div>

        {/* Day Header */}
        <header className="day-detail-header">
          <div className="day-detail-meta">
            <span className="day-pill">{typeof tDash.day === 'function' ? tDash.day(dayData.dayNumber) : `Day ${dayData.dayNumber}`}</span>
            <span className="day-time"><Clock size={14} /> {typeof tDash.mins === 'function' ? tDash.mins(dayData.estimatedMinutes || 30) : `${dayData.estimatedMinutes || 30} mins`}</span>
          </div>
          <h2>{dayData.topic}</h2>
          <p className="day-focus-text">{dayData.focus}</p>
        </header>

        {/* Prose Content Body */}
        <article className="day-content-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0 }}>{t.overviewKeyConcepts}</h3>
            <SpeakerButton
              audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/audio?lang=${language}`}
              size={18}
            />
          </div>
          <div className="prose-body">
            {dayData.content.split('\n\n').map((paragraph, pIdx) => (
              <p key={pIdx}>{paragraph}</p>
            ))}
          </div>
        </article>

        {/* Curated Resources Section */}
        <section className="day-resources-section">
          <h3>{t.verifiedResources}</h3>
          {dayData.resources && dayData.resources.length > 0 ? (
            <div className="resources-grid">
              {dayData.resources.map((res, rIdx) => {
                const embedUrl = getYouTubeEmbedUrl(res.url);

                if (res.type === 'youtube' && embedUrl) {
                  return (
                    <div key={rIdx} className="resource-card video-card">
                      <div className="video-embed-wrapper">
                        <iframe
                          src={embedUrl}
                          title={res.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        ></iframe>
                      </div>
                      <div className="resource-card-info">
                        <div className="res-badge">
                          <Youtube size={14} className="yt-icon" /> {t.videoGuide}
                        </div>
                        <h4>{res.title}</h4>
                        <span className="channel-name">{res.channel}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={rIdx} className="resource-card article-card">
                    <div className="resource-card-info">
                      <div className="res-badge article">
                        <FileText size={14} /> {t.officialGuide}
                      </div>
                      <h4>{res.title}</h4>
                      <span className="channel-name">{res.channel}</span>
                      <a
                        href={res.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="resource-external-link"
                      >
                        {t.readArticle} <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="onboarding-card" style={{ padding: '1.5rem', textAlign: 'center', color: '#6B6357', marginTop: '1rem' }}>
              {t.noResourcesFound}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
