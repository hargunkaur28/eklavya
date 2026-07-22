import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { courses } from './data/courses.js';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
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

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
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
