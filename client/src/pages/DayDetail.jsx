import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { ArrowLeft, CheckSquare, Square, Clock, Youtube, FileText, ExternalLink, Loader2, CheckCircle2, Play, AlertCircle, RefreshCw } from 'lucide-react';
import SpeakerButton from '../components/SpeakerButton.jsx';
import YouTubePlayer from '../components/YouTubePlayer.jsx';
import ModuleQuiz from '../components/ModuleQuiz.jsx';
import MentorGuide from '../components/MentorGuide.jsx';
import { getLocalDate } from '../utils/streak.js';

/** The day's YouTube video ids, safely — used by the mentor's completion signals. */
function mentorVideoIdsSafe(dayData) {
  return (dayData?.resources || [])
    .filter((r) => r?.type === 'youtube')
    .map((r) => getYouTubeVideoId(r.url))
    .filter(Boolean);
}

function getYouTubeVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export default function DayDetail() {
  const { roadmapId, dayNumber } = useParams();
  const { authFetch, refreshRoadmap, roadmaps, user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();

  // Subject of the roadmap this day belongs to — drives narration-language resolution
  // (English content is exempt from the Hindi-default). Resolved from the loaded list.
  const roadmapSubject = (roadmaps || []).find((r) => r._id === roadmapId)?.subject || '';

  const t = translations[language]?.dayDetail || translations.en.dayDetail;
  const tDash = translations[language]?.dashboard || translations.en.dashboard;

  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [gateMessage, setGateMessage] = useState('');
  const [autoPlayIndex, setAutoPlayIndex] = useState(user?.autoNarrateQuizzes !== false ? 0 : -1);
  // Phase 2 (revised): per-video watch state, keyed by videoId.
  const [videoProgress, setVideoProgress] = useState({});
  const [videoThreshold, setVideoThreshold] = useState(0.9);
  // Click-to-play: which video cards have had their real YT.Player mounted.
  const [activePlayers, setActivePlayers] = useState({});

  // Merge server state into local, taking the max watched-seconds so a delayed
  // server response (last saved ~10s ago) never yanks a live bar backwards.
  // Preserves any local-only optimistic entries not yet in the server array.
  const applyProgressArray = useCallback((arr) => {
    setVideoProgress((prev) => {
      const next = { ...prev };
      (arr || []).forEach((v) => {
        const local = prev[v.videoId] || {};
        next[v.videoId] = {
          watchedSeconds: Math.max(local.watchedSeconds || 0, v.watchedSeconds || 0),
          durationSeconds: v.durationSeconds || local.durationSeconds || 0,
          watched: Boolean(v.watched) || Boolean(local.watched)
        };
      });
      return next;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    authFetch(`/roadmap/${roadmapId}/day/${dayNumber}?lang=${language}`)
      .then((res) => {
        if (!res.ok) throw new Error(t.couldNotLoad);
        return res.json();
      })
      .then((data) => {
        setDayData(data);
        setVideoThreshold(data.videoThreshold || 0.9);
        applyProgressArray(data.videoProgress);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [roadmapId, dayNumber, language, authFetch, t.couldNotLoad, applyProgressArray]);

  // Throttle network saves per video (the bar updates every 1s locally, but we
  // only PATCH ~every 10s, plus always on pause/end via the `final` flag).
  const lastSaveRef = useRef({});
  const SAVE_INTERVAL_MS = 10000;

  // Phase 2: `final` = pause/end (always persist). Ticks update the bar smoothly
  // on screen every second but only hit the server on the throttle interval.
  const handleVideoProgress = useCallback(async ({ videoId, watchedSeconds, durationSeconds, final }) => {
    // 1) Always update the on-screen bar immediately (cheap, smooth).
    setVideoProgress((prev) => {
      const rec = prev[videoId] || {};
      const duration = durationSeconds || rec.durationSeconds || 0;
      const watchedMax = Math.max(rec.watchedSeconds || 0, watchedSeconds || 0);
      const watched = (rec.watched || false) || (duration > 0 && watchedMax / duration >= videoThreshold);
      return { ...prev, [videoId]: { watchedSeconds: watchedMax, durationSeconds: duration, watched } };
    });

    // 2) Persist to the server only on `final` or when the throttle window elapsed.
    const now = Date.now();
    const last = lastSaveRef.current[videoId] || 0;
    if (!final && now - last < SAVE_INTERVAL_MS) return;
    lastSaveRef.current[videoId] = now;

    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}/video-progress`, {
        method: 'PATCH',
        body: JSON.stringify({ videoId, watchedSeconds, durationSeconds, localDate: getLocalDate() })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.videoProgress)) applyProgressArray(data.videoProgress);
      }
    } catch (err) {
      console.warn('Failed to save video progress:', err);
    }
  }, [authFetch, roadmapId, dayNumber, videoThreshold, applyProgressArray]);

  const activatePlayer = useCallback((videoId) => {
    setActivePlayers((prev) => ({ ...prev, [videoId]: true }));
  }, []);

  const handleToggleCompletion = async () => {
    if (!dayData) return;
    setToggling(true);
    setGateMessage('');
    const nextState = !dayData.completed;
    // Optimistic; roll back if the server rejects (Phase 3 completion gate).
    setDayData((prev) => ({ ...prev, completed: nextState }));

    try {
      const res = await authFetch(`/roadmap/${roadmapId}/day/${dayNumber}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: nextState })
      });
      if (res.ok) {
        await refreshRoadmap();
      } else if (res.status === 409) {
        // Gate not satisfied — revert and explain.
        setDayData((prev) => ({ ...prev, completed: !nextState }));
        const data = await res.json().catch(() => ({}));
        setGateMessage(data.message || t.completionGate);
      } else {
        setDayData((prev) => ({ ...prev, completed: !nextState }));
      }
    } catch (err) {
      console.warn('Failed to update completion:', err);
      setDayData((prev) => ({ ...prev, completed: !nextState }));
    } finally {
      setToggling(false);
    }
  };

  // Called when the quiz completes the day — reflect it locally + refresh.
  const handleDayCompleted = useCallback(() => {
    setDayData((prev) => (prev ? { ...prev, completed: true } : prev));
    setGateMessage('');
    refreshRoadmap();
  }, [refreshRoadmap]);

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

  // The lesson narration has finished (or was never going to play). Until then the
  // videos are not highlighted — the device pass found the ring landing on them while
  // the overview was still being read aloud.
  const overviewDone = autoPlayIndex === -1;

  // ── ITEMS 3 AND 4 ARE ONE CAUSE: guidance decided BEFORE progress arrived ──
  //
  // `loading` is true until the day fetch resolves, and videoProgress arrives with it.
  // On first render `watchedCount` is therefore 0 for EVERY day — including one whose
  // videos are all watched — so the "watch the videos" line won the race and spoke, and
  // MentorGuide speaks each line once, so the correct "you have finished, take the quiz"
  // line never got its turn.
  //
  // That is the general form recorded last round, in its most literal shape: THE MENTOR
  // SPOKE FROM WHERE THE CHILD ARRIVED, NOT FROM WHERE THEY ARE. Every line below is
  // therefore gated on the data being present, not merely on the component being mounted.
  const progressReady = !loading && !!dayData;

  // Item 4: re-watching an already-watched video must still prompt the quiz. The
  // condition is "all videos are watched", not "a video just BECAME watched" — so the
  // replay key is the completion COUNT plus the latest watch timestamp, which changes on
  // a re-watch even though watchedCount does not.
  const lastWatchAt = mentorVideoIdsSafe(dayData).reduce((max, id) => {
    const at = videoProgress[id]?.watchedAt;
    return at && at > max ? at : max;
  }, '');

  const mentorVideoIds = (dayData?.resources || [])
    .filter((r) => r.type === 'youtube')
    .map((r) => getYouTubeVideoId(r.url))
    .filter(Boolean);
  const videoTotal = mentorVideoIds.length;
  const watchedCount = mentorVideoIds.filter((id) => videoProgress[id]?.watched).length;

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

        {gateMessage && (
          <div className="completion-gate-notice">{gateMessage}</div>
        )}

        {/* Day Header */}
        <header className="day-detail-header">
          <div className="day-detail-meta">
            <span className="day-pill">{typeof tDash.day === 'function' ? tDash.day(dayData.dayNumber) : `Day ${dayData.dayNumber}`}</span>
            <span className="day-time"><Clock size={14} /> {typeof tDash.mins === 'function' ? tDash.mins(dayData.estimatedMinutes || 30) : `${dayData.estimatedMinutes || 30} mins`}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <h2>{dayData.topic}</h2>
              <p className="day-focus-text">{dayData.focus}</p>
            </div>
            <SpeakerButton
              ttsText={`${dayData.topic}. ${dayData.focus}`}
              fallbackText={`${dayData.topic}. ${dayData.focus}`}
              subject={roadmapSubject}
              autoPlay={autoPlayIndex === 0}
              onEnded={() => setAutoPlayIndex((prev) => (prev === 0 ? 1 : prev))}
              size={16}
            />
          </div>
        </header>

        {/* Feature 27 (B): the mentor's view of this day's videos, derived from the
            SAME state the cards render from. A separate count would be a second source
            of truth about progress, which is the one thing utils/mentorContext.js
            exists to avoid. */}
        {/* Prose Content Body. `contentAvailable === false` means generation was
            unavailable — the server caches nothing in that case, so a reload
            genuinely retries. Videos and the quiz below still work. */}
        <article className="day-content-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0 }}>{t.overviewKeyConcepts}</h3>
            {dayData.contentAvailable !== false && (
              <SpeakerButton
                audioEndpoint={`/roadmap/${roadmapId}/day/${dayNumber}/audio?lang=${language}`}
                subject={roadmapSubject}
                autoPlay={autoPlayIndex === 1}
                onEnded={() => setAutoPlayIndex(-1)}
                size={18}
              />
            )}
          </div>
          {dayData.contentAvailable === false ? (
            <div className="lesson-unavailable">
              <AlertCircle size={22} />
              <p>{t.lessonUnavailable}</p>
              <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
                <RefreshCw size={15} /> {t.lessonRetry}
              </button>
            </div>
          ) : (
            <div className="prose-body">
              {(dayData.content || '').split('\n\n').map((paragraph, pIdx) => (
                <p key={pIdx}>{paragraph}</p>
              ))}
            </div>
          )}
        </article>

        {/* ── B: the day page, the screen with the most steps and the least text ──
            Four states, four different instructions. They are mutually exclusive by
            construction (`when`), so the mentor says exactly one thing at a time.

            The no-video case is NOT a cosmetic branch: the Feature 9 gate needs a video
            watched AND the quiz passed, so a day with no usable video cannot be
            completed at all. The mentor must not tell a child to press a video that is
            not there — see PRODUCTION_CHECKLIST for the underlying gap, which is NOT
            fixed here. */}
        <MentorGuide
          line="guide.noVideoToday"
          when={!!dayData && !(dayData.resources || []).some((r) => r.type === 'youtube')}
        />
        {/* THE STATES ARE MUTUALLY EXCLUSIVE AND ORDERED BY WHAT IS LEFT TO DO, not by
            what the child has just arrived at. The device pass found the mentor speaking
            from where the child ARRIVED: it re-narrated the video guidance on a day whose
            videos were already watched, and highlighted the videos while the lesson was
            still being read out.

            `overviewDone` gates the first line: the existing autoPlayIndex reaches -1
            when the lesson narration finishes, so the videos are not highlighted while
            the child is still being read to. */}
        <MentorGuide
          line="guide.dayOverviewDone"
          highlight='[data-mentor="videos"]'
          when={progressReady && overviewDone && videoTotal > 0 && watchedCount === 0}
        />
        <MentorGuide
          line="guide.nextVideo"
          highlight='[data-mentor="videos"]'
          when={progressReady && overviewDone && videoTotal > 1 && watchedCount > 0 && watchedCount < videoTotal}
          replayKey={watchedCount}
        />
        {/* Fires IMMEDIATELY on arrival when everything is already watched — no
            `overviewDone` gate, because a child returning to a finished module should
            not sit through the lesson narration before being told the one thing left. */}
        <MentorGuide
          line="guide.videosDoneTakeQuiz"
          highlight='[data-mentor="module-quiz"]'
          when={progressReady && videoTotal > 0 && watchedCount >= videoTotal}
          replayKey={`${watchedCount}-${lastWatchAt}`}
        />
        {/* The page already prints "Watch a video and pass the module quiz to complete
            this day" when Mark-as-Complete is refused. A child who cannot read it is
            silently blocked, so the mentor says it. */}
        <MentorGuide
          line="guide.dayNotComplete"
          when={!!gateMessage}
          replayKey={gateMessage}
        />

        {/* Curated Resources Section */}
        <section className="day-resources-section" data-mentor="videos">
          <h3>{t.verifiedResources}</h3>
          {dayData.resources && dayData.resources.length > 0 ? (
            <div className="resources-grid">
              {dayData.resources.map((res, rIdx) => {
                const videoId = res.type === 'youtube' ? getYouTubeVideoId(res.url) : null;

                // Every YouTube video → its own tracked player + watch UI.
                // Lazy: a lightweight thumbnail facade shows first; the real
                // YT.Player only mounts once the student clicks to play.
                if (videoId) {
                  const rec = videoProgress[videoId];
                  const watched = Boolean(rec?.watched);
                  const pct = (rec && rec.durationSeconds > 0)
                    ? Math.min(100, Math.round((rec.watchedSeconds / rec.durationSeconds) * 100))
                    : 0;
                  const isActive = Boolean(activePlayers[videoId]);

                  return (
                    <div key={rIdx} className="resource-card video-card">
                      <div className="video-embed-wrapper">
                        {isActive ? (
                          <YouTubePlayer
                            videoId={videoId}
                            autoplay
                            onProgress={handleVideoProgress}
                          />
                        ) : (
                          <button
                            type="button"
                            className="video-facade"
                            onClick={() => activatePlayer(videoId)}
                            aria-label={`${t.videoGuide}: ${res.title}`}
                          >
                            <img
                              src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                              alt=""
                              loading="lazy"
                            />
                            <span className="video-facade-play"><Play size={26} fill="currentColor" /></span>
                          </button>
                        )}
                      </div>
                      <div className="resource-card-info">
                        <div className="res-badge">
                          <Youtube size={14} className="yt-icon" /> {t.videoGuide}
                        </div>
                        <h4>{res.title}</h4>
                        <span className="channel-name">{res.channel}</span>

                        <div className="video-watch-status">
                          {watched ? (
                            <span className="video-watched-pill">
                              <CheckCircle2 size={15} /> {t.videoWatched}
                            </span>
                          ) : (
                            <span className="video-watch-label">
                              {typeof t.videoWatchProgress === 'function'
                                ? t.videoWatchProgress(pct)
                                : `Watched ${pct}%`}
                            </span>
                          )}
                          <div className="video-progress-bar">
                            <div
                              className={`video-progress-fill ${watched ? 'complete' : ''}`}
                              style={{ width: `${watched ? 100 : pct}%` }}
                            ></div>
                          </div>
                        </div>
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

        {/* Phase 3: module quiz — gates day completion */}
        {/* The ring used to be anchored to an empty <div/> here, which measured 0px
            tall and rendered as a glowing sliver between two cards. An anchor must be a
            REAL element; MentorHighlightRing now also refuses a degenerate rect, but
            that is a backstop, not the fix. */}
        <ModuleQuiz
          roadmapId={roadmapId}
          dayNumber={dayNumber}
          subject={roadmapSubject}
          onDayCompleted={handleDayCompleted}
          onRoadmapChanged={refreshRoadmap}
        />
      </div>
    </div>
  );
}
