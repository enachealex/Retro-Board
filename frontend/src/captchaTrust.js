const CAPTCHA_TRUST_COOKIE = "retro_captcha_trust";
const CAPTCHA_TRUST_SESSION_KEY = "retro_captcha_trust_session";

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return "";
  return decodeURIComponent(match.slice(name.length + 1));
}

function writeCookie(name, value, expiresAt) {
  if (typeof document === "undefined") return;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (Number.isFinite(Number(expiresAt))) {
    cookie += `; Expires=${new Date(Number(expiresAt)).toUTCString()}`;
  }
  document.cookie = cookie;
}

function clearCookie(name) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export function getCaptchaTrustToken() {
  const cookieToken = readCookie(CAPTCHA_TRUST_COOKIE);
  if (cookieToken) return cookieToken;
  try {
    return globalThis.sessionStorage?.getItem(CAPTCHA_TRUST_SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function storeCaptchaTrust(payload) {
  const token = String(payload?.token || "").trim();
  if (!token) return;
  const persistent = !!payload?.persistent;
  const expiresAt = Number(payload?.expiresAt || 0);

  if (persistent) {
    writeCookie(CAPTCHA_TRUST_COOKIE, token, expiresAt);
    try {
      globalThis.sessionStorage?.removeItem(CAPTCHA_TRUST_SESSION_KEY);
    } catch {
      // Ignore unavailable storage.
    }
    return;
  }

  try {
    globalThis.sessionStorage?.setItem(CAPTCHA_TRUST_SESSION_KEY, token);
  } catch {
    // Ignore unavailable storage.
  }
  clearCookie(CAPTCHA_TRUST_COOKIE);
}

export function clearCaptchaTrust() {
  clearCookie(CAPTCHA_TRUST_COOKIE);
  try {
    globalThis.sessionStorage?.removeItem(CAPTCHA_TRUST_SESSION_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
