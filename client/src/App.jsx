import { useState, useEffect , useRef} from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { stopNarration } from './utils/narrationController.js';
import { courses } from './data/courses.js';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { scrollToTop } from './utils/scrollToTop.js';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Stats from './components/Stats.jsx';
import WhyChoose from './components/WhyChoose.jsx';
import Courses from './components/Courses.jsx';
import Testimonials from './components/Testimonials.jsx';
import Cta from './components/Cta.jsx';
import Footer from './components/Footer.jsx';
import CourseDetail from './components/CourseDetail.jsx';
import ScrollReveal from './components/ScrollReveal.jsx';
import AIForLearning from './components/AIForLearning.jsx';
import AuthPage from './pages/AuthPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import MentorPage from './pages/MentorPage.jsx';
import Onboarding from './components/Onboarding.jsx';
import ProfileOnboarding from './pages/ProfileOnboarding.jsx';
import RoadmapDashboard from './components/RoadmapDashboard.jsx';
import ParentDashboard from './components/ParentDashboard.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import DiagnosticReview from './pages/DiagnosticReview.jsx';
import DayDetail from './pages/DayDetail.jsx';
import ChatWidget from './components/ChatWidget.jsx';

// Home Component with landing page sections
function Home() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (window.location.pathname === '/courses') {
      setTimeout(() => {
        document.getElementById('courses')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, []);

  const handleSelectCourse = (courseId) => {
    navigate(`/courses/${courseId}`);
  };

  return (
    <main>
      <Header mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <Hero />
      <ScrollReveal><Stats /></ScrollReveal>
      <AIForLearning />
      <ScrollReveal><WhyChoose /></ScrollReveal>
      <ScrollReveal><Courses onSelect={handleSelectCourse} /></ScrollReveal>
      <ScrollReveal><Testimonials /></ScrollReveal>
      <ScrollReveal><Cta /></ScrollReveal>
      <div className="footer-wrapper">
        <Footer />
      </div>
    </main>
  );
}

// Course Detail Route Wrapper matching /courses/:id
function CourseDetailWrapper() {
  const { id } = useParams();
  const navigate = useNavigate();
  const selectedCourse = courses.find((course) => course.id === id);

  if (!selectedCourse) {
    return (
      <div style={{ textAlign: 'center', padding: '6rem 1rem' }}>
        <h2>Course not found</h2>
        <button className="primary-button" onClick={() => navigate('/courses')}>
          Back to Courses
        </button>
      </div>
    );
  }

  return (
    <CourseDetail
      course={selectedCourse}
      onBack={() => navigate('/')}
    />
  );
}

// Shared chrome wrapper for the authenticated inner pages.
function PageShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <main>
      <Header mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      {children}
      <div className="footer-wrapper">
        <Footer />
      </div>
    </main>
  );
}

// Phase 5: /dashboard shows the read-only parent view for a parent session,
// otherwise the interactive student dashboard. Both are server-scoped to the
// same one student (Option B), so this is a presentation choice, not the security
// boundary — mutations are blocked server-side regardless.
function DashboardView() {
  const { user } = useAuth();
  return user?.role === 'parent' ? <ParentDashboard /> : <RoadmapDashboard />;
}

// Dedicated /login and /signup pages (replaces the former auth modal)
function AuthPageWrapper({ initialTab }) {
  return (
    <PageShell>
      <AuthPage initialTab={initialTab} />
    </PageShell>
  );
}

// Workstream F: narration must not survive a route change. Mounted once, beside
// ScrollToTop, for the same reason — it is a property of navigation, not of any page.
// A component that starts narration cannot be trusted to stop it, because by the time
// it matters that component has already unmounted.
function NarrationStopper() {
  const { pathname } = useLocation();
  const firstRun = useRef(true);
  useEffect(() => {
    // SKIP THE FIRST RUN. A route effect fires on mount as well as on change, and on
    // mount there is by definition nothing to stop — but there IS something about to
    // start: React runs effects bottom-up, so a page's autoPlay effect has already
    // scheduled its narration by the time this parent effect runs. Stopping here would
    // kill auto-narration on every single page load, and the symptom is nasty to
    // diagnose: manual speaker buttons work perfectly, autoplay just never plays, and
    // nothing errors. Only a TRANSITION should stop anything.
    if (firstRun.current) { firstRun.current = false; return; }
    stopNarration();
  }, [pathname]);
  // Also on unmount, which covers a full teardown (logout) that never changes pathname.
  useEffect(() => stopNarration, []);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    scrollToTop();
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <NarrationStopper />
          <ChatWidget />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/courses" element={<Home />} />
            <Route path="/courses/:id" element={<CourseDetailWrapper />} />
            <Route path="/login" element={<AuthPageWrapper initialTab="login" />} />
            <Route path="/signup" element={<AuthPageWrapper initialTab="signup" />} />
            {/* Phase 6: admin console — isolated shell (no student header/nav).
                AdminDashboard self-guards on role and redirects to /admin/login. */}
            <Route path="/admin/login" element={<PageShell><AdminLoginPage /></PageShell>} />
            <Route path="/admin" element={<PageShell><AdminDashboard /></PageShell>} />
            {/* Workstream B: the profile flow. Wrapped in ProtectedRoute (a session is
                required) — ProtectedRoute exempts this exact path from its own
                onboarding redirect, otherwise an incomplete student would be
                redirected here forever. No PageShell: the flow renders its own
                header, including the language toggle, because this is the one screen
                a student cannot skip past to find the toggle later. */}
            <Route
              path="/onboarding/profile"
              element={
                <ProtectedRoute>
                  <PageShell><ProfileOnboarding /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <PageShell><Onboarding /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/review/:id"
              element={
                <ProtectedRoute>
                  <PageShell><DiagnosticReview /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/roadmap/:roadmapId/day/:dayNumber"
              element={
                <ProtectedRoute>
                  <PageShell><DayDetail /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <PageShell><DashboardView /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute>
                  <PageShell><ChangePasswordPage /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <PageShell><ProfilePage /></PageShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mentor"
              element={
                <ProtectedRoute>
                  <PageShell><MentorPage /></PageShell>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
