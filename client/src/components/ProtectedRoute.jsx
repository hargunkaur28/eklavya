import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useMentor } from '../context/MentorContext.jsx';

export default function ProtectedRoute({ children }) {
  const { user, token, loading, mustChangePassword } = useAuth();
  const mentor = useMentor();
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
  if (user?.role === 'student' && user?.onboardingCompleted === false) {
    // ── Feature 27: the mentor offer comes BEFORE the profile flow ──────────
    //
    // The order is load-bearing, not cosmetic. Profile onboarding is entirely written,
    // and it is the first thing a new student meets. Offering the mentor afterwards
    // would require a child who cannot read to complete, unaided and in silence,
    // precisely the flow the mentor exists to narrate.
    //
    // WAIT for the server's answer rather than guessing. `mentor.loading` is only ever
    // true on this branch (an un-onboarded student), so no other route pays for it. A
    // guess in either direction is wrong in a way that is hard to undo: guessing
    // "available" flashes an offer screen at a student the server would refuse, and
    // guessing "unavailable" silently skips the offer for the child who needed it and
    // never asks again, because `offered` is written by the screen they never saw.
    if (mentor?.loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#2F6B3A', fontFamily: 'inherit' }}>
          <p>Loading session...</p>
        </div>
      );
    }

    if (
      mentor?.available &&
      !mentor?.offered &&
      location.pathname !== '/onboarding/mentor'
    ) {
      return <Navigate to="/onboarding/mentor" replace />;
    }

    // The mentor route is exempt from the profile redirect for the same reason the
    // profile route exempts itself: without it the two gates bounce the student
    // between them forever.
    if (
      location.pathname !== '/onboarding/profile' &&
      location.pathname !== '/onboarding/mentor'
    ) {
      return <Navigate to="/onboarding/profile" replace />;
    }
  }

  return children;
}
