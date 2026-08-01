import { scrollToTop } from '../utils/scrollToTop.js';
// Phase 7: shared dashboard chrome so the parent and admin views match the
// student dashboard's look — the cream rounded card with a green left rail.
// `brand` fills the rail header; `nav` (array of {key,label,Icon}) renders as rail
// nav buttons switching the active section; `footer` sits at the rail bottom
// (e.g. sign-out); `children` is the main content column.
export default function DashboardShell({ brand, nav = [], activeKey, onNav, footer, children }) {
  // A section switch is a page change to the person using it, but it is a state
  // change to the router — so the route-level ScrollToTop never fires and you land
  // partway down the new section at whatever offset the old one was scrolled to.
  const go = (key) => { if (onNav) onNav(key); scrollToTop(); };
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
                    onClick={() => go(key)}
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

        {/* Mobile bottom nav for the admin and parent views. The rail used to wrap into
            a row at the TOP of the card on a phone, which pushed the actual content
            below the fold and read as a header rather than navigation — the student
            dashboard has had a fixed bottom bar all along, so the two roles disagreed
            about where navigation lives. Rendered as its own element rather than by
            restyling the rail, because the rail also carries the brand and sign-out,
            neither of which belongs in a bottom bar. */}
        {nav.length > 0 && (
          <nav className="shell-bottom-nav" aria-label="Sections">
            {nav.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={`shell-bottom-item ${activeKey === key ? 'active' : ''}`}
                onClick={() => go(key)}
                aria-current={activeKey === key ? 'page' : undefined}
              >
                {Icon && <Icon size={18} />}
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
