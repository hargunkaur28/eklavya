import { BookOpen, Dumbbell, TrendingUp, Trophy, Plus, GraduationCap } from 'lucide-react';

// Phase 1 dashboard navigation shell + Phase 5 subject switcher.
// Purely presentational: switches the dashboard's internal `activeSection`
// (no route changes). Renders as a left sidebar on desktop and a fixed
// bottom nav bar on mobile (<=768px) — see .dashboard-sidebar styles.
export default function DashboardSidebar({
  activeSection, onSelect, t, userName, gradeSubject,
  subjects = [], activeRoadmapId, onSelectSubject, onAddSubject
}) {
  const items = [
    { key: 'roadmap', label: t.studyRoadmap, Icon: BookOpen },
    { key: 'practice', label: t.practiceMode, Icon: Dumbbell },
    { key: 'progress', label: t.progressWeakTopics, Icon: TrendingUp },
    { key: 'review', label: t.diagnosticReview, Icon: Trophy }
  ];

  return (
    <aside className="dashboard-sidebar" aria-label={t.navMenuLabel}>
      <div className="sidebar-identity">
        <span className="sidebar-avatar" aria-hidden="true">
          {(userName || 'S').trim().charAt(0).toUpperCase()}
        </span>
        <div className="sidebar-identity-text">
          <span className="sidebar-user-name">{userName}</span>
          {gradeSubject && <span className="sidebar-user-sub">{gradeSubject}</span>}
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`sidebar-nav-btn ${activeSection === key ? 'active' : ''}`}
            onClick={() => onSelect(key)}
            aria-current={activeSection === key ? 'page' : undefined}
          >
            <Icon size={20} className="sidebar-nav-icon" />
            <span className="sidebar-nav-label">{label}</span>
          </button>
        ))}
      </nav>

      {/* Phase 5: subject switcher */}
      <div className="sidebar-subjects">
        <span className="sidebar-section-label">{t.subjectsLabel}</span>
        {subjects.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`subject-btn ${s.id === activeRoadmapId ? 'active' : ''}`}
            onClick={() => onSelectSubject && onSelectSubject(s.id)}
            aria-current={s.id === activeRoadmapId ? 'true' : undefined}
          >
            <GraduationCap size={17} className="subject-icon" />
            <span className="subject-label">{s.label}</span>
          </button>
        ))}
        <button type="button" className="subject-add-btn" onClick={onAddSubject}>
          <Plus size={16} /> {t.addSubject}
        </button>
      </div>
    </aside>
  );
}
