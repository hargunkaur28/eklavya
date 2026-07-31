import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { user, token, loading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#2F6B3A', fontFamily: 'inherit' }}>
        <p>Loading session...</p>
      </div>
    );
  }

  if (!user && !token) {
    return <Navigate to="/login" replace />;
  }

  // Phase 4: a parent still holding the temporary password is forced to the
  // change-password screen and cannot reach any other protected page until done.
  // (The change-password route itself is exempt to avoid a redirect loop.)
  //
  // ORDER MATTERS: this MUST stay ahead of the onboarding gate below. Under Option B
  // (Feature 14) a parent and their student share ONE User document, so
  // `onboardingCompleted` is reachable from a parent session — a parent on a temp
  // password whose child has not finished onboarding must land on the password
  // change, never in the student profile flow.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Workstream B: a new STUDENT completes the profile flow before anything else.
  // Restricted to role === 'student' for the same shared-document reason: parents and
  // admins skip this entirely and are unaffected by the flag's value.
  if (
    user?.role === 'student' &&
    user?.onboardingCompleted === false &&
    location.pathname !== '/onboarding/profile'
  ) {
    return <Navigate to="/onboarding/profile" replace />;
  }

  return children;
}
