import { createContext, useContext, useState, useEffect, useCallback } from 'react';

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
  }, [authFetch, refreshRoadmap]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

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

    let roadmap = null;
    try {
      roadmap = await refreshRoadmap(); // Phase 5: loads the full active-roadmap list
    } catch (err) {
      console.warn('Failed to fetch roadmaps on login:', err.message);
    }

    return { user: data.user, roadmap };
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
        login,
        signup,
        logout,
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
