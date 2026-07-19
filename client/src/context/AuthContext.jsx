import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('eklavya_token') || null);
  const [user, setUser] = useState(null);
  const [activeRoadmap, setActiveRoadmap] = useState(null);
  const [loading, setLoading] = useState(true);

  // Helper fetch with auth token
  const authFetch = useCallback(async (endpoint, options = {}) => {
    const currentToken = sessionStorage.getItem('eklavya_token');
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
    const storedToken = sessionStorage.getItem('eklavya_token');
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
        sessionStorage.removeItem('eklavya_token');
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

  const login = async (email, password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    sessionStorage.setItem('eklavya_token', data.token);
    setToken(data.token);
    setUser(data.user);
    const roadmap = await refreshRoadmap();
    return { user: data.user, roadmap };
  };

  const signup = async (name, email, password) => {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Signup failed');
    }

    sessionStorage.setItem('eklavya_token', data.token);
    setToken(data.token);
    setUser(data.user);
    setActiveRoadmap(null);
    return { user: data.user, roadmap: null };
  };

  const logout = () => {
    sessionStorage.removeItem('eklavya_token');
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
