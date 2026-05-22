import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { getAuthUrl } from "./config";

export default function CaptchaChallenge({ value, onChange, disabled, reloadKey = 0 }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sliderValue, setSliderValue] = useState(0);
  const [dragStartedAt, setDragStartedAt] = useState(0);
  const rememberDevice = !!value?.rememberDevice;

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    setSliderValue(0);
    setDragStartedAt(0);
    try {
      const res = await axios.get(`${getAuthUrl()}/captcha`, { headers: { "Cache-Control": "no-store" } });
      onChange({
        type: "slider-unlock",
        token: res.data?.token || "",
        answer: "",
        solved: false,
        startedAt: 0,
        completedAt: 0,
        rememberDevice: !!value?.rememberDevice,
      });
    } catch {
      onChange({
        type: "slider-unlock",
        token: "",
        answer: "",
        solved: false,
        startedAt: 0,
        completedAt: 0,
        rememberDevice: !!value?.rememberDevice,
      });
      setError("Could not load security challenge. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [onChange, value?.rememberDevice]);

  useEffect(() => {
    loadChallenge();
    // Challenge reload should happen only when parent asks for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const handleReload = () => {
    if (disabled || loading) return;
    loadChallenge();
  };

  const updateSlider = (nextValue) => {
    if (disabled || loading || !value?.token || value?.solved) return;
    const now = Date.now();
    const normalized = Math.max(0, Math.min(100, Number(nextValue) || 0));
    const startedAt = dragStartedAt || now;
    if (!dragStartedAt) setDragStartedAt(startedAt);
    setSliderValue(normalized);

    const solved = normalized >= 100;
    onChange({
      type: "slider-unlock",
      token: value?.token || "",
      answer: String(normalized),
      solved,
      startedAt,
      completedAt: solved ? now : 0,
      rememberDevice,
    });
  };

  const resetIfUnsolved = () => {
    if (disabled || loading || value?.solved) return;
    setSliderValue(0);
    setDragStartedAt(0);
    onChange({
      type: "slider-unlock",
      token: value?.token || "",
      answer: "",
      solved: false,
      startedAt: 0,
      completedAt: 0,
      rememberDevice,
    });
  };

  const handleRememberChange = (event) => {
    onChange({
      type: "slider-unlock",
      token: value?.token || "",
      answer: value?.answer || "",
      solved: !!value?.solved,
      startedAt: Number(value?.startedAt || 0),
      completedAt: Number(value?.completedAt || 0),
      rememberDevice: !!event.target.checked,
    });
  };

  return (
    <div className="auth-field auth-captcha-field">
      <label htmlFor="captcha-slider">Security Check</label>
      <div className="auth-captcha-box auth-slider-captcha-box">
        <div className="auth-slider-shell" aria-live="polite">
          <div className="auth-slider-title">Slide to unlock</div>
          <div className={`auth-slider-track ${value?.solved ? "is-solved" : ""}`}>
            <div className="auth-slider-fill" style={{ width: `${sliderValue}%` }} />
            <input
              id="captcha-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={sliderValue}
              onChange={(event) => updateSlider(event.target.value)}
              onMouseUp={resetIfUnsolved}
              onTouchEnd={resetIfUnsolved}
              disabled={disabled || loading || !value?.token || value?.solved}
              aria-label="Slide to unlock security check"
              className="auth-slider-input"
            />
          </div>
          <div className={`auth-slider-status ${value?.solved ? "is-solved" : ""}`}>
            {value?.solved ? "Unlocked" : "Slider CAPTCHA"}
          </div>
        </div>
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
      <label className="auth-captcha-remember">
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={handleRememberChange}
          disabled={disabled || loading}
        />
        <span>Remember this device</span>
      </label>
      <p className="auth-captcha-remember-note">
        When checked, this device stays trusted until the cookie is removed (default: 180 days).
      </p>
      {error ? <div className="auth-error auth-captcha-error" role="alert">{error}</div> : null}
    </div>
  );
}
