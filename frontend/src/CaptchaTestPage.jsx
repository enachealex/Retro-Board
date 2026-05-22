import React, { useState } from "react";
import axios from "axios";
import CaptchaChallenge from "./CaptchaChallenge";
import { getAuthUrl } from "./config";
import { storeCaptchaTrust } from "./captchaTrust";
import "./Auth.css";

export default function CaptchaTestPage() {
  const [captcha, setCaptcha] = useState({ token: "", answer: "", solved: false, startedAt: 0, completedAt: 0, rememberDevice: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const runVerification = async (event) => {
    event.preventDefault();
    setMessage("");
    if (!captcha.token || !captcha.solved) {
      setMessage("Complete the slider before verifying.");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${getAuthUrl()}/captcha/verify`, { captcha });
      if (res.data?.captchaTrust) {
        storeCaptchaTrust(res.data.captchaTrust);
      }
      setMessage("Captcha verification passed.");
    } catch (error) {
      setMessage(error.response?.data?.error || "Captcha verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <img className="auth-logo-image" src="/vault-jump.png" alt="Vault Jump Retro logo" />
          <span className="auth-logo-text">Vault Jump Retro</span>
        </div>
        <h2 className="auth-title">Captcha Test</h2>
        <p className="auth-subtitle">Slide to unlock and verify the captcha endpoint directly.</p>

        <form className="auth-form" onSubmit={runVerification}>
          <CaptchaChallenge
            value={captcha}
            onChange={setCaptcha}
            disabled={loading}
            reloadKey={reloadKey}
          />

          <button type="submit" className="auth-btn-primary" disabled={loading || !captcha.token || !captcha.solved}>
            {loading ? "Verifying..." : "Verify Captcha"}
          </button>

          <button
            type="button"
            className="auth-btn-secondary"
            disabled={loading}
            onClick={() => {
              setMessage("");
              setCaptcha({ token: "", answer: "", solved: false, startedAt: 0, completedAt: 0, rememberDevice: false });
              setReloadKey((key) => key + 1);
            }}
          >
            New Challenge
          </button>

          {message ? <output className="auth-info">{message}</output> : null}
        </form>
      </div>
    </div>
  );
}
