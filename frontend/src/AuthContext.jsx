import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import axios from "axios";
import { getAuthUrl } from "./config";

const TOKEN_KEY = "retro_board_token";
const USER_KEY = "retro_board_user";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; }
    catch { return null; }
  });
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  // Always true — we trust localStorage and render immediately.
  // The /me check runs in the background and logs out if the token is stale.
  const [authInitialized, setAuthInitialized] = useState(true);

  const persistAuth = useCallback((tok, usr) => {
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(USER_KEY, JSON.stringify(usr));
    setToken(tok);
    setUser(usr);
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // Clear all board cache data so it doesn't persist to the next session/user
    localStorage.removeItem("retro_boards");
    localStorage.removeItem("retro_active_board");
    localStorage.removeItem("retro_board_cache");
    localStorage.removeItem("retro_cache_owner");
    localStorage.removeItem("retro_redirect_board_id");
    setToken(null);
    setUser(null);
    setAuthError(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return false;
    const AUTH_URL = getAuthUrl();
    try {
      const res = await axios.get(`${AUTH_URL}/me`, { headers: { Authorization: `Bearer ${storedToken}` } });
      persistAuth(storedToken, res.data.user);
      return true;
    } catch (err) {
      if (err.response?.status === 401) {
        clearAuth();
      } else if (!err.request) {
        console.warn('Unexpected error during token validation:', err.message);
      }
      return false;
    }
  }, [clearAuth, persistAuth]);

  // On mount: silently verify the stored token with the backend.
  // On 401 → clear stale credentials so the login page is shown.
  // On network error → trust the stored token (backend may be temporarily down).
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!token) return;
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    const intervalId = window.setInterval(refreshUser, 30000);
    window.addEventListener("focus", refreshUser);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshUser);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshUser, token]);

  const updateUser = useCallback((partial) => {
    setUser(prev => {
      const updated = { ...prev, ...partial };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const completeLogin = useCallback((tok, usr) => {
    persistAuth(tok, usr);
  }, [persistAuth]);

  const login = useCallback(async (email, password, captcha) => {
    setAuthLoading(true);
    setAuthError(null);
    const AUTH_URL = getAuthUrl();
    try {
      const res = await axios.post(`${AUTH_URL}/login`, { email, password, captcha });
      if (res.data.password_weak) {
        // Don't persist auth yet — return the temp token so the UI can force a password change
        return { password_weak: true, token: res.data.token, user: res.data.user };
      }
      persistAuth(res.data.token, res.data.user);
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || "Login failed. Please try again.";
      setAuthError(msg);
      if (err.response?.data?.code === "EMAIL_NOT_VERIFIED") {
        return {
          emailVerificationRequired: true,
          email: err.response.data.email || email,
        };
      }
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [persistAuth]);

  // register(firstName, lastName, email, password, company, inviteToken, captcha)
  const register = useCallback(async (firstName, lastName, email, password, company, inviteToken, captcha) => {
    setAuthLoading(true);
    setAuthError(null);
    const AUTH_URL = getAuthUrl();
    try {
      const res = await axios.post(`${AUTH_URL}/register`, { firstName, lastName, email, password, company, inviteToken, captcha });
      if (res.data?.redirectBoardId) {
        localStorage.setItem("retro_redirect_board_id", String(res.data.redirectBoardId));
      }
      if (res.data?.emailVerificationRequired) {
        return res.data;
      }
      if (!res.data?.token || !res.data?.user) {
        return res.data || true;
      }
      persistAuth(res.data.token, res.data.user);
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || "Registration failed. Please try again.";
      setAuthError(msg);
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [persistAuth]);

  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, authInitialized, authError, authLoading, login, register, completeLogin, logout: clearAuth, updateUser, refreshUser, setAuthError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

