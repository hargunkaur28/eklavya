// Phase 7: shared dashboard chrome so the parent and admin views match the
// student dashboard's look — the cream rounded card with a green left rail.
// `brand` fills the rail header; `nav` (array of {key,label,Icon}) renders as rail
// nav buttons switching the active section; `footer` sits at the rail bottom
// (e.g. sign-out); `children` is the main content column.
export default function DashboardShell({ brand, nav = [], activeKey, onNav, footer, children }) {
  return (
    <div className="dashboard-bg">
      <div className="dashboard-card">
        <aside className="dashboard-rail">
          <div className="dashboard-rail-top">
            <div className="dashboard-rail-brand">{brand}</div>
            {nav.length > 0 && (
              <nav className="dashboard-rail-nav">
                {nav.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={`dashboard-rail-item ${activeKey === key ? 'active' : ''}`}
                    onClick={() => onNav && onNav(key)}
                    aria-current={activeKey === key ? 'page' : undefined}
                  >
                    {Icon && <Icon size={18} />}
                    <span>{label}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
          {footer && <div className="dashboard-rail-footer">{footer}</div>}
        </aside>
        <div className="dashboard-main">{children}</div>
      </div>
    </div>
  );
}
