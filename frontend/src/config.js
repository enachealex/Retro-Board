// Server connection config
// Priority: HTTPS server > HTTP server > localhost fallback
// Use VITE_SERVER_HOST env var to override (e.g. in .env.local for Electron builds pointing at a remote host)
const SERVER_HOST = import.meta.env.VITE_SERVER_HOST || 'retroboard.thejumpvault.com';
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || "5000";
const SERVER_SSL_PORT = import.meta.env.VITE_SERVER_SSL_PORT || "5443";
const LOCAL_PORT = "5000";

const SERVER_BASE_SSL = `https://${SERVER_HOST}`;
const SERVER_BASE = `http://${SERVER_HOST}:${SERVER_PORT}`;
const LOCAL_BASE = `http://localhost:${LOCAL_PORT}`;

// Detect if running inside Electron (file:// protocol) or on the server's own web host
const isElectron = typeof window !== 'undefined' && (
  window.location.protocol === 'file:' ||
  navigator.userAgent.toLowerCase().includes('electron')
);

const isViteDevRuntime = !isElectron && typeof window !== 'undefined' && Boolean(import.meta?.env?.DEV);

const getBrowserStaticFrontendBackendBase = () => {
  if (typeof window === 'undefined') return SERVER_BASE;
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const host = window.location.hostname;
  return protocol === 'https'
    ? `${protocol}://${host}`
    : `${protocol}://${host}:${SERVER_PORT}`;
};

// If loaded from the server itself (deployed web), always use the server.
// If Electron or localhost dev, try server first with a fast check.
let _resolvedBase = null;

function getBaseUrl() {
  if (_resolvedBase) return _resolvedBase;
  // Dev mode (vite dev server on localhost) — use relative URLs, Vite proxy handles routing
  if (isViteDevRuntime) {
    _resolvedBase = '';
    return _resolvedBase;
  }
  // Production static frontend on common Vite ports (5173/4173) should call backend directly.
  if (!isElectron && typeof window !== 'undefined' && ['5173', '4173'].includes(window.location.port)) {
    _resolvedBase = getBrowserStaticFrontendBackendBase();
    return _resolvedBase;
  }
  // Browser-hosted web app (LAN host, tunnel, domain): always use same origin.
  // This keeps API and socket traffic on the exact host users loaded.
  if (!isElectron && typeof window !== 'undefined') {
    _resolvedBase = window.location.origin;
    return _resolvedBase;
  }
  // Electron app — default to HTTPS server (will be confirmed async)
  _resolvedBase = SERVER_BASE_SSL;
  return _resolvedBase;
}

// Async check: try HTTPS first, then HTTP, then localhost
export async function initConnection() {
  if (isViteDevRuntime) {
    _resolvedBase = '';
    return;
  }
  if (!isElectron && typeof window !== 'undefined' && ['5173', '4173'].includes(window.location.port)) {
    _resolvedBase = getBrowserStaticFrontendBackendBase();
    return;
  }
  if (!isElectron && typeof window !== 'undefined') {
    _resolvedBase = window.location.origin;
    return;
  }
  // Try HTTPS first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${SERVER_BASE_SSL}/api/role-labels`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      _resolvedBase = SERVER_BASE_SSL;
      return;
    }
  } catch { /* HTTPS unavailable, try HTTP */ }
  // Fall back to HTTP
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${SERVER_BASE}/api/role-labels`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      _resolvedBase = SERVER_BASE;
      return;
    }
  } catch { /* HTTP also unavailable */ }
  // Last resort: localhost
  _resolvedBase = LOCAL_BASE;
}

export function getApiUrl() {
  return `${getBaseUrl()}/api`;
}

export function getAuthUrl() {
  return `${getBaseUrl()}/api/auth`;
}

export function getSocketUrl() {
  return getBaseUrl();
}
