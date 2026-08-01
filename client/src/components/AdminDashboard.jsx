import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { scrollToTop } from '../utils/scrollToTop.js';
import { ShieldCheck, Users, LogOut, Loader2, ChevronLeft, CheckCircle2, Clock, TrendingUp, Settings, ScrollText } from 'lucide-react';
import Avatar from './Avatar.jsx';
import DashboardShell from './DashboardShell.jsx';
import AdminSettings from './AdminSettings.jsx';
import PyqAdminPanel from './PyqAdminPanel.jsx';

// Phase 6: read-only admin console for STUDENT DATA. Reuses the admin endpoints
// (parent-linkage status + per-student roadmaps/weak-topics/activity). No edit
// controls anywhere in the student views.
//
// Workstream I3 adds ONE write capability, in its own section: past-paper import.
// It is scoped deliberately — it writes only PastPaper/PyqQuestion, content models
// that no student owns — so the read-only guarantee that actually matters (an admin
// cannot alter a student's own data) is unchanged. Enforced server-side; this nav
// entry is only the way in.
export default function AdminDashboard() {
  const { user, loading: authLoading, authFetch, logout } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language]?.admin || translations.en.admin;

  const [section, setSection] = useState('students'); // 'students' | 'settings'
  const [students, setStudents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { student, roadmaps }
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeRoadmapId, setActiveRoadmapId] = useState(null);
  const [weak, setWeak] = useState(null);
  const [activityCount, setActivityCount] = useState(null);
  const [studyDates, setStudyDates] = useState([]);

  // Load the parent-linkage overview once.
  useEffect(() => {
    let active = true;
    authFetch('/admin/parent-links')
      .then((r) => r.json())
      .then((d) => { if (active) setStudents(d.students || []); })
      .catch(() => { if (active) setStudents([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authFetch]);

  const openStudent = useCallback(async (studentId) => {
    setDetailLoading(true);
    setSelected(null);
    setWeak(null);
    setActiveRoadmapId(null);
    setActivityCount(null);
    setStudyDates([]);
    try {
      const [sRes, aRes] = await Promise.all([
        authFetch(`/admin/student/${studentId}`),
        authFetch(`/admin/student/${studentId}/activity`)
      ]);
      const sData = await sRes.json();
      const aData = await aRes.json().catch(() => ({ studyDates: [] }));
      setSelected({ student: sData.student, roadmaps: sData.roadmaps || [] });
      setActivityCount((aData.studyDates || []).length);
      setStudyDates(aData.studyDates || []);
      const first = (sData.roadmaps || [])[0];
      if (first) setActiveRoadmapId(first._id);
    } catch {
      setSelected({ student: null, roadmaps: [] });
    } finally {
      setDetailLoading(false);
    }
  }, [authFetch]);

  // Load weak topics whenever the selected roadmap changes.
  useEffect(() => {
    if (!selected?.student || !activeRoadmapId) return;
    let active = true;
    setWeak(null);
    authFetch(`/admin/student/${selected.student.id}/roadmap/${activeRoadmapId}/weak-topics`)
      .then((r) => r.json())
      .then((d) => { if (active) setWeak(d); })
      .catch(() => { if (active) setWeak(null); });
    return () => { active = false; };
  }, [authFetch, selected, activeRoadmapId]);

  // Route guard: only an admin session may view this. Wait for the session to
  // resolve, then bounce anyone who isn't an admin to the admin login.
  if (authLoading) {
    return <div className="weak-loading" style={{ padding: '4rem' }}><Loader2 size={22} className="animate-spin" /> Loading…</div>;
  }
  if (!user || user.role !== 'admin') return <Navigate to="/admin/login" replace />;

  const doLogout = () => { logout(); navigate('/admin/login', { replace: true }); };

  const activeRoadmap = selected?.roadmaps?.find((r) => r._id === activeRoadmapId);
  // Same fields and same arithmetic as ParentDashboard, deliberately. An admin fielding
  // a parent's question needs to see the numbers that parent is looking at — a
  // different subset is worse than none, because the two then disagree about the same
  // student and there is no way to tell which view is wrong.
  const progressOf = (rm) => {
    const days = rm.days || [];
    const total = rm.totalDays || days.length || 0;
    const done = days.filter((d) => d.completed).length;
    const videos = days.filter(
      (d) => (Array.isArray(d?.videoProgress) && d.videoProgress.some((v) => v?.watched)) || d?.videoWatched
    ).length;
    const quizAttempts = days.filter((d) => d.moduleQuizAttempt?.attempted);
    return {
      done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0,
      videos, videoPct: total > 0 ? Math.round((videos / total) * 100) : 0,
      quizzesPassed: quizAttempts.filter((d) => d.moduleQuizAttempt?.passed).length,
      quizAttempted: quizAttempts.length
    };
  };

  // The parent sees a streak widget; the admin saw only a raw count of study days.
  // Derived from the same studyDates the activity endpoint already returns, so this
  // needs no new server surface — and it must be computed from THAT student's dates,
  // not from the shared StreakWidget, which reads the logged-in user (the admin).
  const streaksFrom = (dates) => {
    const days = [...new Set((dates || []).map((d) => String(d).slice(0, 10)))].sort();
    if (!days.length) return { current: 0, longest: 0 };
    const DAY = 86400000;
    const at = (s) => Date.parse(`${s}T00:00:00Z`);
    let longest = 1, run = 1;
    for (let i = 1; i < days.length; i += 1) {
      run = at(days[i]) - at(days[i - 1]) === DAY ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    // "Current" only counts if the run reaches today or yesterday — a streak that
    // ended a month ago is history, and showing it as current would misreport a
    // student who has stopped as one who is going strong.
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const gap = Math.round((today.getTime() - at(days[days.length - 1])) / DAY);
    return { current: gap <= 1 ? run : 0, longest };
  };

  const railBrand = (
    <>
      <span className="dashboard-rail-icon"><ShieldCheck size={18} /></span>
      <span className="dashboard-rail-title">{t.consoleTitle}</span>
    </>
  );
  const railFooter = (
    <button type="button" className="dashboard-rail-logout" onClick={doLogout} aria-label={t.signOut} title={t.signOut}>
      <LogOut size={15} /> <span className="rail-logout-label">{t.signOut}</span>
    </button>
  );
  const nav = [
    { key: 'students', label: t.navStudents, Icon: Users },
    { key: 'papers', label: t.navPapers, Icon: ScrollText },
    { key: 'settings', label: t.navSettings, Icon: Settings }
  ];

  return (
    <DashboardShell brand={railBrand} nav={nav} activeKey={section} onNav={setSection} footer={railFooter}>
      {section === 'settings' ? (
        <AdminSettings />
      ) : section === 'papers' ? (
        <PyqAdminPanel />
      ) : (
      <>
      <header className="admin-header">
        <h1>{t.heading}</h1>
      </header>

      {loading ? (
        <div className="weak-loading"><Loader2 size={22} className="animate-spin" /> {t.loading}</div>
      ) : !selected ? (
        <>
          <p className="admin-count">{t.studentCount((students || []).length)}</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>{t.colStudent}</th><th>{t.colEmail}</th><th>{t.colParentAccess}</th><th></th></tr>
              </thead>
              <tbody>
                {(students || []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="admin-email">{s.email}</td>
                    <td>
                      {!s.parentLinked ? (
                        <span className="admin-tag admin-tag-none">{t.tagNotCreated}</span>
                      ) : s.parentPending ? (
                        <span className="admin-tag admin-tag-pending"><Clock size={12} /> {t.tagTempUnchanged}</span>
                      ) : (
                        <span className="admin-tag admin-tag-active"><CheckCircle2 size={12} /> {t.tagActive}</span>
                      )}
                    </td>
                    <td><button type="button" className="admin-view-btn" onClick={() => { openStudent(s.id); scrollToTop(); }}>{t.viewProgress}</button></td>
                  </tr>
                ))}
                {(students || []).length === 0 && (
                  <tr><td colSpan={4} className="admin-empty-row">{t.noStudents}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="admin-detail">
          <button type="button" className="admin-back" onClick={() => { setSelected(null); scrollToTop(); }}><ChevronLeft size={16} /> {t.backToList}</button>

          {detailLoading ? (
            <div className="weak-loading"><Loader2 size={22} className="animate-spin" /> {t.loading}</div>
          ) : !selected.student ? (
            <p className="admin-empty-row">{t.studentNotFound}</p>
          ) : (
            <>
              <div className="admin-detail-identity">
                <Avatar url={selected.student.photoUrl} name={selected.student.name} size={48} />
                <div>
                  <h2 className="admin-detail-name">{selected.student.name}</h2>
                  <p className="admin-email">{selected.student.email}</p>
                </div>
              </div>
              {activityCount != null && (
                <p className="admin-activity">{t.activeStudyDays(activityCount)}</p>
              )}

              {selected.roadmaps.length === 0 ? (
                <div className="parent-empty-card"><Users size={26} /><p>{t.noRoadmaps}</p></div>
              ) : (
                <>
                  <div className="admin-roadmap-tabs">
                    {selected.roadmaps.map((rm) => {
                      const p = progressOf(rm);
                      return (
                        <button
                          key={rm._id}
                          type="button"
                          className={`admin-roadmap-tab ${rm._id === activeRoadmapId ? 'active' : ''}`}
                          onClick={() => { setActiveRoadmapId(rm._id); scrollToTop(); }}
                        >
                          <strong>{rm.grade} · {rm.subject}</strong>
                          <span>{p.done}/{p.total} {t.days} · {p.pct}%</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeRoadmap && (
                    <>
                    <div className="dashboard-progress-card">
                      <div className="progress-info-row">
                        <div>
                          <h3>{activeRoadmap.grade} · {activeRoadmap.subject}</h3>
                          <p>{t.daysCompleted(progressOf(activeRoadmap).done, progressOf(activeRoadmap).total)}</p>
                        </div>
                        <span className="progress-percent-badge">{progressOf(activeRoadmap).pct}%</span>
                      </div>
                      <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{ width: `${progressOf(activeRoadmap).pct}%` }}></div>
                      </div>
                      {/* Videos and quizzes: the parent sees both, so the admin does too. */}
                      <div className="progress-secondary-row">
                        <span className="progress-secondary-label">
                          {t.videosWatched(progressOf(activeRoadmap).videos, progressOf(activeRoadmap).total)}
                        </span>
                        <span className="progress-secondary-value">{progressOf(activeRoadmap).videoPct}%</span>
                      </div>
                      {progressOf(activeRoadmap).quizAttempted > 0 && (
                        <div className="progress-secondary-row">
                          <span className="progress-secondary-label">
                            {t.quizzesPassed(progressOf(activeRoadmap).quizzesPassed, progressOf(activeRoadmap).quizAttempted)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Streak, from this student's own studyDates rather than the shared
                        widget, which would read the admin's. */}
                    <div className="admin-streak-row">
                      <div className="admin-streak-stat">
                        <strong>{streaksFrom(studyDates).current}</strong>
                        <span>{t.currentStreak} ({t.dayUnit(streaksFrom(studyDates).current)})</span>
                      </div>
                      <div className="admin-streak-stat">
                        <strong>{streaksFrom(studyDates).longest}</strong>
                        <span>{t.longestStreak} ({t.dayUnit(streaksFrom(studyDates).longest)})</span>
                      </div>
                    </div>
                    </>
                  )}

                  {/* Weak topics — from the shared aggregation (admin endpoint, read-only) */}
                  <div className="weak-topics-panel">
                    <div className="weak-head">
                      <TrendingUp size={22} className="weak-head-icon" />
                      <div><h3>{t.weakTopics}</h3></div>
                    </div>
                    {!weak ? (
                      <div className="weak-loading"><Loader2 size={18} className="animate-spin" /> {t.loading}</div>
                    ) : !weak.hasAttempts ? (
                      <div className="weak-empty">{t.noQuizAttempts}</div>
                    ) : (weak.weakTopics || []).length === 0 ? (
                      <div className="weak-none"><CheckCircle2 size={20} /> {t.noWeakTopics}</div>
                    ) : (
                      <div className="weak-list">
                        {weak.weakTopics.map((tpc) => (
                          <div key={tpc.subtopic} className="weak-item">
                            <div className="weak-item-top">
                              <span className="weak-item-name">{tpc.label || tpc.subtopic}</span>
                              <span className="weak-item-avg">{Math.round((tpc.accuracy || 0) * 100)}%</span>
                            </div>
                            <div className="weak-bar"><div className="weak-bar-fill" style={{ width: `${Math.round((tpc.accuracy || 0) * 100)}%` }}></div></div>
                            <div className="weak-item-foot">
                              <span className="weak-item-score">{tpc.correct}/{tpc.total} {t.correct}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
      </>
      )}
    </DashboardShell>
  );
}
