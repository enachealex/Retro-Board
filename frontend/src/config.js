// Server connection config
// Priority: baked-in API URL > configured API URL > server host > localhost fallback
// Use VITE_API_BASE_URL in GitHub Pages builds to pin the browser to the server API.
const SERVER_HOST = import.meta.env.VITE_SERVER_HOST || 'api.thejumpvault.com';

// When baked in at build time (e.g. GitHub Pages CI), this overrides all other resolution.
const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const STATIC_SITE_HOSTS = new Set([
  'retroboard.thejumpvault.com',
  'enachealex.github.io',
]);

// Default company name — override with VITE_DEFAULT_COMPANY in .env or .env.local
export const DEFAULT_COMPANY = import.meta.env.VITE_DEFAULT_COMPANY || 'RetroBoard';
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || '5000';
const SERVER_SSL_PORT = import.meta.env.VITE_SERVER_SSL_PORT || '5443';
const LOCAL_PORT = '5000';

const SERVER_BASE_SSL = `https://${SERVER_HOST}`;
const SERVER_BASE = `http://${SERVER_HOST}:${SERVER_PORT}`;
const LOCAL_BASE = `http://localhost:${LOCAL_PORT}`;

// Detect if running inside Electron (file:// protocol) or local Vite dev.
const isElectron = typeof window !== 'undefined' && (
  window.location.protocol === 'file:' ||
  navigator.userAgent.toLowerCase().includes('electron')
);

const isViteDevRuntime = !isElectron && typeof window !== 'undefined' && Boolean(import.meta?.env?.DEV);

// If loaded from the browser, prefer the server API rather than the current origin.
let _resolvedBase = null;

function getBaseUrl() {
  if (_resolvedBase) return _resolvedBase;
  if (VITE_API_BASE_URL) {
    try {
      const parsed = new URL(VITE_API_BASE_URL);
      if (!STATIC_SITE_HOSTS.has(parsed.hostname)) {
        _resolvedBase = VITE_API_BASE_URL;
        return _resolvedBase;
      }
    } catch {
      // Invalid build-time URL is ignored and normal resolution will be used.
    }
  }
  // Dev mode (vite dev server on localhost) — use relative URLs, Vite proxy handles routing
  if (isViteDevRuntime) {
    _resolvedBase = '';
    return _resolvedBase;
  }
  // Electron app — default to HTTPS server (will be confirmed async)
  _resolvedBase = SERVER_BASE_SSL;
  return _resolvedBase;
}

// Async check: try server API first, then HTTP, then localhost
export async function initConnection() {
  if (VITE_API_BASE_URL) {
    _resolvedBase = VITE_API_BASE_URL;
    return;
  }
  if (isViteDevRuntime) {
    _resolvedBase = '';
    return;
  }
  if (!isElectron && typeof window !== 'undefined') {
    _resolvedBase = SERVER_BASE_SSL;
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
