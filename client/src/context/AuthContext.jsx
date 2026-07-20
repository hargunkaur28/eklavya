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

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [activeRoadmap, setActiveRoadmap] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const refreshRoadmap = useCallback(async () => {
    try {
      const res = await authFetch('/roadmap/mine');
      if (res.ok) {
        const data = await res.json();
        setActiveRoadmap(data.roadmap || null);
        return data.roadmap;
      }
    } catch (err) {
      console.warn('Failed to fetch active roadmap:', err.message);
    }
    return null;
  }, [authFetch]);

  const refreshUser = useCallback(async () => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setUser(null);
      setActiveRoadmap(null);
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
        setActiveRoadmap(null);
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
      const rmRes = await fetch(`${API_BASE}/roadmap/mine`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.token}`
        }
      });
      if (rmRes.ok) {
        const rmData = await rmRes.json();
        roadmap = rmData.roadmap || null;
        setActiveRoadmap(roadmap);
      }
    } catch (err) {
      console.warn('Failed to fetch active roadmap on login:', err.message);
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
    setActiveRoadmap(null);
    return { user: data.user, roadmap: null };
  };

  const logout = () => {
    removeStoredToken();
    setToken(null);
    setUser(null);
    setActiveRoadmap(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        activeRoadmap,
        setActiveRoadmap,
        loading,
        login,
        signup,
        logout,
        authFetch,
        refreshRoadmap
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
