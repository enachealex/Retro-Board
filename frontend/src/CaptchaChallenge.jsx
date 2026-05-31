import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { getAuthUrl } from "./config";

const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY || "";

function isHcaptchaReady(value) {
  return value?.type === "hcaptcha" && !!value?.token;
}

export function isCaptchaComplete(value) {
  if (!value?.token) return false;
  if (value.type === "hcaptcha") return true;
  return !!String(value.answer || "").trim();
}

export default function CaptchaChallenge({ value, onChange, disabled, reloadKey = 0 }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState(null);
  const [siteKey, setSiteKey] = useState(HCAPTCHA_SITE_KEY);
  const captchaRef = useRef(null);
  const rememberDevice = !!value?.rememberDevice;
  const rememberDeviceRef = useRef(rememberDevice);

  useEffect(() => {
    rememberDeviceRef.current = rememberDevice;
  }, [rememberDevice]);

  const resetHcaptcha = useCallback(() => {
    captchaRef.current?.resetCaptcha();
    onChange({
      type: "hcaptcha",
      token: "",
      rememberDevice: rememberDeviceRef.current,
    });
  }, [onChange]);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${getAuthUrl()}/captcha`, { headers: { "Cache-Control": "no-store" } });
      const nextProvider = res.data?.provider || "text-captcha";
      setProvider(nextProvider);
      if (nextProvider === "hcaptcha") {
        const key = res.data?.siteKey || HCAPTCHA_SITE_KEY;
        if (!key) {
          setError("hCaptcha is not configured. Contact your administrator.");
          onChange({ type: "hcaptcha", token: "", rememberDevice: rememberDeviceRef.current });
          return;
        }
        setSiteKey(key);
        resetHcaptcha();
        return;
      }
      onChange({
        type: "text-captcha",
        token: res.data?.token || "",
        answer: "",
        image: res.data?.image || "",
        rememberDevice: rememberDeviceRef.current,
      });
    } catch {
      onChange({ type: "text-captcha", token: "", answer: "", image: "", rememberDevice: rememberDeviceRef.current });
      setError("Could not load security challenge. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [onChange, resetHcaptcha]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge, reloadKey]);

  const handleReload = () => {
    if (disabled || loading) return;
    if (provider === "hcaptcha") {
      resetHcaptcha();
      return;
    }
    loadChallenge();
  };

  const handleAnswerChange = (event) => {
    onChange({
      type: "text-captcha",
      token: value?.token || "",
      image: value?.image || "",
      answer: event.target.value,
      rememberDevice,
    });
  };

  const handleRememberChange = (event) => {
    onChange({
      ...value,
      type: value?.type || provider || "text-captcha",
      rememberDevice: !!event.target.checked,
    });
  };

  const onHcaptchaVerify = (token) => {
    setError("");
    onChange({
      type: "hcaptcha",
      token: token || "",
      rememberDevice: rememberDeviceRef.current,
    });
  };

  const onHcaptchaExpire = () => {
    onChange({
      type: "hcaptcha",
      token: "",
      rememberDevice: rememberDeviceRef.current,
    });
  };

  if (provider === "hcaptcha") {
    return (
      <div className="auth-field auth-captcha-field" role="group" aria-labelledby="captcha-label-hcaptcha">
        <label id="captcha-label-hcaptcha">Security Check</label>
        <div className="auth-captcha-box auth-captcha-hcaptcha">
          {siteKey ? (
            <HCaptcha
              ref={captchaRef}
              sitekey={siteKey}
              onVerify={onHcaptchaVerify}
              onExpire={onHcaptchaExpire}
              onError={() => setError("hCaptcha failed to load. Please refresh and try again.")}
            />
          ) : (
            <div className="auth-captcha-placeholder">{loading ? "Loading..." : "Not configured"}</div>
          )}
          <button
            type="button"
            className="auth-captcha-refresh"
            onClick={handleReload}
            disabled={disabled || loading || !siteKey}
            aria-label="Reload security challenge"
          >
            ↻
          </button>
        </div>
        <label className="auth-captcha-remember">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={handleRememberChange}
            disabled={disabled || loading}
          />
          <span>Remember this device</span>
        </label>
        {error ? <div className="auth-error auth-captcha-error" role="alert">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="auth-field auth-captcha-field">
      <label htmlFor="captcha-answer">Security Check</label>
      <div className="auth-captcha-box">
        {value?.image ? (
          <img className="auth-captcha-image" src={value.image} alt="Security challenge" />
        ) : (
          <div className="auth-captcha-placeholder">{loading ? "Loading..." : "No challenge"}</div>
        )}
        <button
          type="button"
          className="auth-captcha-refresh"
          onClick={handleReload}
          disabled={disabled || loading}
          aria-label="Reload security challenge"
        >
          {loading ? "..." : "↻"}
        </button>
      </div>
      <input
        id="captcha-answer"
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="Type the code shown above"
        value={value?.answer || ""}
        onChange={handleAnswerChange}
        disabled={disabled || loading || !value?.token}
      />
      <label className="auth-captcha-remember">
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={handleRememberChange}
          disabled={disabled || loading}
        />
        <span>Remember this device</span>
      </label>
      {error ? <div className="auth-error auth-captcha-error" role="alert">{error}</div> : null}
    </div>
  );
}

export { isHcaptchaReady };
