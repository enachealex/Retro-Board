import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import axios from "axios";
import { getAuthUrl } from "./config";

export default function CaptchaChallenge({ value, onChange, disabled, reloadKey = 0 }) {
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await axios.get(`${getAuthUrl()}/captcha`, {
        headers: { "Cache-Control": "no-store" },
      });
      setImage(res.data?.image || "");
      onChange({ token: res.data?.token || "", answer: "" });
    } catch {
      setImage("");
      onChange({ token: "", answer: "" });
      setLoadError("Could not load the security check.");
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    loadChallenge();
  }, [loadChallenge, reloadKey]);

  const answer = value?.answer || "";
  const canUse = !disabled && !loading && !!value?.token;

  return (
    <div className="auth-field auth-captcha-field">
      <label htmlFor="auth-captcha-answer">Security Check</label>
      <div className="auth-captcha-box">
        {image ? (
          <img className="auth-captcha-image" src={image} alt="Security challenge" draggable="false" />
        ) : (
          <div className="auth-captcha-placeholder">{loading ? "Loading..." : "Unavailable"}</div>
        )}
        <button
          type="button"
          className="auth-captcha-refresh"
          onClick={loadChallenge}
          disabled={disabled || loading}
          aria-label="Refresh security check"
          title="Refresh security check"
        >
          <RefreshCw size={16} className={loading ? "auth-captcha-spin" : ""} />
        </button>
      </div>
      <input
        id="auth-captcha-answer"
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="Enter the characters"
        value={answer}
        onChange={(event) => onChange({ token: value?.token || "", answer: event.target.value })}
        disabled={!canUse}
      />
      {loadError && <div className="auth-field-hint auth-captcha-error">{loadError}</div>}
    </div>
  );
}