import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ShieldCheck, Users, LogOut, Loader2, ChevronLeft, CheckCircle2, Clock, TrendingUp, Settings } from 'lucide-react';
import Avatar from './Avatar.jsx';
import DashboardShell from './DashboardShell.jsx';
import AdminSettings from './AdminSettings.jsx';

// Phase 6: read-only admin console. Reuses the admin endpoints (parent-linkage
// status + per-student roadmaps/weak-topics/activity). No edit controls anywhere.
export default function AdminDashboard() {
  const { user, loading: authLoading, authFetch, logout } = useAuth();
  const navigate = useNavigate();

  const [section, setSection] = useState('students'); // 'students' | 'settings'
  const [students, setStudents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { student, roadmaps }
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeRoadmapId, setActiveRoadmapId] = useState(null);
  const [weak, setWeak] = useState(null);
  const [activityCount, setActivityCount] = useState(null);

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
    try {
      const [sRes, aRes] = await Promise.all([
        authFetch(`/admin/student/${studentId}`),
        authFetch(`/admin/student/${studentId}/activity`)
      ]);
      const sData = await sRes.json();
      const aData = await aRes.json().catch(() => ({ studyDates: [] }));
      setSelected({ student: sData.student, roadmaps: sData.roadmaps || [] });
      setActivityCount((aData.studyDates || []).length);
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
  const progressOf = (rm) => {
    const total = rm.totalDays || (rm.days?.length || 0);
    const done = (rm.days || []).filter((d) => d.completed).length;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  };

  const railBrand = (
    <>
      <span className="dashboard-rail-icon"><ShieldCheck size={18} /></span>
      <span className="dashboard-rail-title">Admin Console</span>
    </>
  );
  const railFooter = (
    <button type="button" className="dashboard-rail-logout" onClick={doLogout}>
      <LogOut size={15} /> Sign out
    </button>
  );
  const nav = [
    { key: 'students', label: 'Students', Icon: Users },
    { key: 'settings', label: 'Settings', Icon: Settings }
  ];

  return (
    <DashboardShell brand={railBrand} nav={nav} activeKey={section} onNav={setSection} footer={railFooter}>
      {section === 'settings' ? (
        <AdminSettings />
      ) : (
      <>
      <header className="admin-header">
        <h1>Parent Linkage &amp; Student Progress</h1>
      </header>

      {loading ? (
        <div className="weak-loading"><Loader2 size={22} className="animate-spin" /> Loading…</div>
      ) : !selected ? (
        <>
          <p className="admin-count">{(students || []).length} student account(s)</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Student</th><th>Email</th><th>Parent access</th><th></th></tr>
              </thead>
              <tbody>
                {(students || []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="admin-email">{s.email}</td>
                    <td>
                      {!s.parentLinked ? (
                        <span className="admin-tag admin-tag-none">Not created</span>
                      ) : s.parentPending ? (
                        <span className="admin-tag admin-tag-pending"><Clock size={12} /> Temp — not changed</span>
                      ) : (
                        <span className="admin-tag admin-tag-active"><CheckCircle2 size={12} /> Active</span>
                      )}
                    </td>
                    <td><button type="button" className="admin-view-btn" onClick={() => openStudent(s.id)}>View progress</button></td>
                  </tr>
                ))}
                {(students || []).length === 0 && (
                  <tr><td colSpan={4} className="admin-empty-row">No student accounts yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="admin-detail">
          <button type="button" className="admin-back" onClick={() => setSelected(null)}><ChevronLeft size={16} /> Back to list</button>

          {detailLoading ? (
            <div className="weak-loading"><Loader2 size={22} className="animate-spin" /> Loading…</div>
          ) : !selected.student ? (
            <p className="admin-empty-row">Student not found.</p>
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
                <p className="admin-activity">{activityCount} active study day(s) recorded</p>
              )}

              {selected.roadmaps.length === 0 ? (
                <div className="parent-empty-card"><Users size={26} /><p>No roadmaps yet.</p></div>
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
                          onClick={() => setActiveRoadmapId(rm._id)}
                        >
                          <strong>{rm.grade} · {rm.subject}</strong>
                          <span>{p.done}/{p.total} days · {p.pct}%</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeRoadmap && (
                    <div className="dashboard-progress-card">
                      <div className="progress-info-row">
                        <div><h3>{activeRoadmap.grade} · {activeRoadmap.subject}</h3></div>
                        <span className="progress-percent-badge">{progressOf(activeRoadmap).pct}%</span>
                      </div>
                      <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{ width: `${progressOf(activeRoadmap).pct}%` }}></div>
                      </div>
                    </div>
                  )}

                  {/* Weak topics — from the shared aggregation (admin endpoint, read-only) */}
                  <div className="weak-topics-panel">
                    <div className="weak-head">
                      <TrendingUp size={22} className="weak-head-icon" />
                      <div><h3>Weak Topics</h3></div>
                    </div>
                    {!weak ? (
                      <div className="weak-loading"><Loader2 size={18} className="animate-spin" /> Loading…</div>
                    ) : !weak.hasAttempts ? (
                      <div className="weak-empty">No quiz attempts yet.</div>
                    ) : (weak.weakTopics || []).length === 0 ? (
                      <div className="weak-none"><CheckCircle2 size={20} /> No weak topics — all above threshold.</div>
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
                              <span className="weak-item-score">{tpc.correct}/{tpc.total} correct</span>
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
