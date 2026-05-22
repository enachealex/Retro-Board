import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { getAuthUrl } from "./config";

export default function CaptchaChallenge({ value, onChange, disabled, reloadKey = 0 }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rememberDevice = !!value?.rememberDevice;
  const rememberDeviceRef = useRef(rememberDevice);

  useEffect(() => {
    rememberDeviceRef.current = rememberDevice;
  }, [rememberDevice]);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${getAuthUrl()}/captcha`, { headers: { "Cache-Control": "no-store" } });
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
  }, [onChange]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge, reloadKey]);

  const handleReload = () => {
    if (disabled || loading) return;
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
      type: "text-captcha",
      token: value?.token || "",
      image: value?.image || "",
      answer: value?.answer || "",
      rememberDevice: !!event.target.checked,
    });
  };

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
