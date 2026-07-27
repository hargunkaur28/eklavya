import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from './LanguageContext.jsx';

const AuthContext = createContext(null);

const API_BASE = (() => {
  // Prefer explicit env var set at build/deploy time
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;

  // At runtime, if we're in a browser and on localhost, use the local API
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:5000/api';
    }

    // In production (deployed site), prefer a relative `/api` path so the browser
    // doesn't attempt to contact the visiting device's localhost.
    return '/api';
  }

  // Fallback for non-browser environments
  return 'http://127.0.0.1:5000/api';
})();

const getStoredToken = () => {
  try {
    return localStorage.getItem('eklavya_token') || sessionStorage.getItem('eklavya_token') || null;
  } catch {
    return null;
  }
};

const storeToken = (token, rememberMe = true) => {
  try {
    if (rememberMe) {
      localStorage.setItem('eklavya_token', token);
      sessionStorage.removeItem('eklavya_token');
    } else {
      sessionStorage.setItem('eklavya_token', token);
      localStorage.removeItem('eklavya_token');
    }
  } catch {
    // Storage fallback
  }
};

const removeStoredToken = () => {
  try {
    localStorage.removeItem('eklavya_token');
    sessionStorage.removeItem('eklavya_token');
  } catch {
    // Storage fallback
  }
};

const SELECTED_ROADMAP_KEY = 'eklavya_selected_roadmap';
const getStoredSelectedRoadmap = () => {
  try { return localStorage.getItem(SELECTED_ROADMAP_KEY) || null; } catch { return null; }
};
const storeSelectedRoadmap = (id) => {
  try { if (id) localStorage.setItem(SELECTED_ROADMAP_KEY, id); } catch { /* ignore */ }
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [activeRoadmap, setActiveRoadmapState] = useState(null);
  const [roadmaps, setRoadmaps] = useState([]); // Phase 5: all active roadmaps
  const [loading, setLoading] = useState(true);
  // Phase 4: a parent session that still holds its temporary password. While true,
  // the app forces the change-password screen (mirrors the server-side gate).
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Narration feature: the account's siteLanguage is the source of truth on login;
  // localStorage/LanguageContext is the fast-path cache. `lastSyncedLang` marks the
  // value we last reconciled with the account so the toggle-persist effect below
  // doesn't echo a hydration-set value straight back to the server.
  const { language, setLanguage } = useLanguage();
  const lastSyncedLang = useRef(null);

  // Account value WINS on hydrate: pull siteLanguage from the account onto the local
  // toggle (student sessions only — parents/admins have no quiz flows).
  const applyAccountLanguage = useCallback((u) => {
    if (u && u.role === 'student' && (u.siteLanguage === 'en' || u.siteLanguage === 'hi')) {
      lastSyncedLang.current = u.siteLanguage;
      setLanguage((prev) => (prev !== u.siteLanguage ? u.siteLanguage : prev));
    }
  }, [setLanguage]);

  // Keep the selected roadmap and the roadmaps list in sync when a component
  // updates the active roadmap (e.g. after toggling a day complete).
  const setActiveRoadmap = useCallback((next) => {
    setActiveRoadmapState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (resolved?._id) {
        setRoadmaps((list) => list.map((r) => (r._id === resolved._id ? resolved : r)));
      }
      return resolved;
    });
  }, []);

  // Phase 5: pick which subject's roadmap is shown (persisted across sessions).
  const selectRoadmap = useCallback((id) => {
    setRoadmaps((list) => {
      const found = list.find((r) => r._id === id);
      if (found) { setActiveRoadmapState(found); storeSelectedRoadmap(id); }
      return list;
    });
  }, []);

  // Helper fetch with auth token
  const authFetch = useCallback(async (endpoint, options = {}) => {
    const currentToken = getStoredToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    return res;
  }, []);

  // Phase 5: load ALL active roadmaps, then select which one is shown — the
  // previously-selected subject if it still exists, otherwise the newest.
  const refreshRoadmap = useCallback(async () => {
    try {
      const res = await authFetch('/roadmap/list');
      if (res.ok) {
        const data = await res.json();
        const list = data.roadmaps || [];
        setRoadmaps(list);
        const preferredId = getStoredSelectedRoadmap();
        const chosen = list.find((r) => r._id === preferredId) || list[0] || null;
        setActiveRoadmapState(chosen);
        if (chosen?._id) storeSelectedRoadmap(chosen._id);
        return chosen;
      }
    } catch (err) {
      console.warn('Failed to fetch roadmaps:', err.message);
    }
    return null;
  }, [authFetch]);

  const refreshUser = useCallback(async () => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setUser(null);
      setActiveRoadmapState(null);
      setRoadmaps([]);
      setLoading(false);
      return;
    }

    try {
      const res = await authFetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        applyAccountLanguage(data.user); // account siteLanguage wins on refresh
        setMustChangePassword(!!data.mustChangePassword);
        await refreshRoadmap();
      } else {
        // Clear invalid token
        removeStoredToken();
        setToken(null);
        setUser(null);
        setActiveRoadmapState(null);
        setRoadmaps([]);
      }
    } catch (err) {
      console.warn('Auth check error (backend offline demo mode):', err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, refreshRoadmap, applyAccountLanguage]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // PATCH account-level narration/voice prefs and mirror them onto local user state.
  const updatePreferences = useCallback(async (patch) => {
    const res = await authFetch('/auth/preferences', { method: 'PATCH', body: JSON.stringify(patch) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update preferences.');
    setUser((prev) => (prev ? { ...prev, ...data.preferences } : prev));
    return data.preferences;
  }, [authFetch]);

  // Persist a site-language TOGGLE back to the account (student only). Skips the
  // hydration-set value (tracked in lastSyncedLang) so only genuine user changes PATCH.
  useEffect(() => {
    if (!user || user.role !== 'student') return;
    if (lastSyncedLang.current === null) { lastSyncedLang.current = language; return; }
    if (language === lastSyncedLang.current) return;
    lastSyncedLang.current = language;
    authFetch('/auth/preferences', { method: 'PATCH', body: JSON.stringify({ siteLanguage: language }) })
      .then((r) => { if (r && r.ok) setUser((prev) => (prev ? { ...prev, siteLanguage: language } : prev)); })
      .catch(() => { /* offline / non-critical — localStorage already holds it */ });
  }, [language, user, authFetch]);

  const login = async (email, password, rememberMe = true) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    storeToken(data.token, rememberMe);
    setToken(data.token);
    setUser(data.user);
    applyAccountLanguage(data.user); // account siteLanguage wins on login
    setMustChangePassword(!!data.mustChangePassword); // Phase 4

    let roadmap = null;
    try {
      roadmap = await refreshRoadmap(); // Phase 5: loads the full active-roadmap list
    } catch (err) {
      console.warn('Failed to fetch roadmaps on login:', err.message);
    }

    return { user: data.user, roadmap, mustChangePassword: !!data.mustChangePassword };
  };

  // Phase 6: admin login (separate route + 3 factors). The admin token is stored
  // in sessionStorage only (rememberMe=false) — high-value + short-lived, never
  // persisted across browser sessions. Replaces any student/parent token in this
  // browser (one session at a time).
  const adminLogin = async (email, password, securityCode) => {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, securityCode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Admin login failed');
    }
    storeToken(data.token, false); // sessionStorage only
    setToken(data.token);
    setUser(data.user);
    setActiveRoadmapState(null);
    setRoadmaps([]);
    setMustChangePassword(false);
    return data;
  };

  // Phase 7: a student edits their own name/email. On success the returned user
  // (with the possibly-new email) replaces the context user so the UI updates
  // immediately. The JWT is unaffected (it carries userId+role, not email), so
  // no re-login is needed.
  const updateProfile = async ({ name, email, currentPassword }) => {
    const res = await authFetch('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name, email, currentPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not update profile.');
    }
    setUser((prev) => ({ ...prev, ...data.user }));
    return data.user;
  };

  // Phase 7.5: upload/replace the student's profile photo. Sent as multipart —
  // we deliberately do NOT set Content-Type so the browser adds the multipart
  // boundary itself (authFetch always forces JSON, so this uses fetch directly).
  const uploadProfilePhoto = async (file) => {
    const currentToken = getStoredToken();
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch(`${API_BASE}/auth/profile/photo`, {
      method: 'POST',
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not upload photo.');
    }
    setUser((prev) => ({ ...prev, photoUrl: data.photoUrl }));
    return data.photoUrl;
  };

  // Phase 7.5: remove the student's profile photo (falls back to the icon).
  const removeProfilePhoto = async () => {
    const res = await authFetch('/auth/profile/photo', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not remove photo.');
    }
    setUser((prev) => ({ ...prev, photoUrl: null }));
  };

  // Phase 7: used by the /login page — returns true if the given email+password
  // match the admin credentials (so the page can reveal the security-code field).
  const adminPrecheck = async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/admin/precheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) return false; // 404 (admin disabled), 429, etc. → don't reveal
      const data = await res.json().catch(() => ({}));
      return !!data.needsCode;
    } catch {
      return false;
    }
  };

  // Phase 7: admin edits its own email / password / security code. Requires the
  // current security code (verified server-side) to authorize the change.
  const updateAdminCredentials = async ({ currentSecurityCode, newEmail, newPassword, newSecurityCode }) => {
    const res = await authFetch('/admin/credentials', {
      method: 'PATCH',
      body: JSON.stringify({ currentSecurityCode, newEmail, newPassword, newSecurityCode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not update admin credentials.');
    }
    if (data.email) setUser((prev) => ({ ...prev, email: data.email }));
    return data;
  };

  // Phase 4: change the current session's own password (re-verified server-side).
  // On success, clears the forced-change flag so routing releases the user.
  const changePassword = async (currentPassword, newPassword) => {
    const res = await authFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not change password.');
    }
    setMustChangePassword(false);
    // A parent's login-time roadmap fetch was blocked while they still held the
    // temp password (server gate). Now that the flag is cleared, re-fetch so the
    // parent dashboard has data without needing a full page reload.
    try { await refreshRoadmap(); } catch { /* non-fatal */ }
    return data;
  };

  const signup = async (name, email, password, rememberMe = true) => {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, rememberMe })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Signup failed');
    }

    storeToken(data.token, rememberMe);
    setToken(data.token);
    setUser(data.user);
    setActiveRoadmapState(null);
    setRoadmaps([]);
    return { user: data.user, roadmap: null };
  };

  const logout = () => {
    removeStoredToken();
    try { localStorage.removeItem(SELECTED_ROADMAP_KEY); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
    setActiveRoadmapState(null);
    setRoadmaps([]);
    setMustChangePassword(false);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        activeRoadmap,
        setActiveRoadmap,
        roadmaps,
        selectRoadmap,
        loading,
        mustChangePassword,
        login,
        signup,
        logout,
        adminLogin,
        adminPrecheck,
        changePassword,
        updateProfile,
        updatePreferences,
        updateAdminCredentials,
        uploadProfilePhoto,
        removeProfilePhoto,
        authFetch,
        refreshRoadmap,
        refreshRoadmaps: refreshRoadmap
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
