import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import axios from "axios";
import { useAuth } from "./AuthContext";
import { getAuthUrl } from "./config";
import CaptchaChallenge from "./CaptchaChallenge";
import "./Auth.css";

export default function LoginPage({ onGoToRegister }) {
  const { login, completeLogin, authError, authLoading, setAuthError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState(null);
  const [forgotResetUrl, setForgotResetUrl] = useState("");
  const [forgotResetToken, setForgotResetToken] = useState("");
  const [showForgotResetToken, setShowForgotResetToken] = useState(false);
  const [forgotCopyMessage, setForgotCopyMessage] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [verificationResendEmail, setVerificationResendEmail] = useState("");
  const [verificationResendMessage, setVerificationResendMessage] = useState(null);
  const [verificationResendLoading, setVerificationResendLoading] = useState(false);

  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [verifyStatus, setVerifyStatus] = useState({ loading: false, success: false, error: null, email: "" });

  // Forced password update state
  const [forceUpdate, setForceUpdate] = useState(null); // { token, user }
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [captcha, setCaptcha] = useState({ token: "", answer: "" });
  const [captchaReloadKey, setCaptchaReloadKey] = useState(0);
  const [securityStep, setSecurityStep] = useState(false);

  const handleCaptchaChange = React.useCallback((nextCaptcha) => {
    setCaptcha(nextCaptcha);
    setAuthError(null);
  }, [setAuthError]);

  React.useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const token = params.get('reset') || '';
    if (token) setResetToken(token);
    const emailToken = params.get('verify') || '';
    if (emailToken) setVerifyToken(emailToken);
  }, []);

  React.useEffect(() => {
    if (!verifyToken) return;
    let cancelled = false;
    setVerifyStatus({ loading: true, success: false, error: null, email: "" });
    axios.post(`${getAuthUrl()}/verify-email`, { token: verifyToken })
      .then((res) => {
        if (cancelled) return;
        const verifiedEmail = res.data?.email || "";
        setVerifyStatus({ loading: false, success: true, error: null, email: verifiedEmail });
        if (verifiedEmail) setEmail(verifiedEmail);
        const params = new URLSearchParams(globalThis.location.search);
        params.delete('verify');
        const qs = params.toString();
        const cleanUrl = qs ? `${globalThis.location.pathname}?${qs}` : globalThis.location.pathname;
        globalThis.history.replaceState({}, '', cleanUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setVerifyStatus({
          loading: false,
          success: false,
          error: err.response?.data?.error || "Could not confirm this email link.",
          email: "",
        });
        const params = new URLSearchParams(globalThis.location.search);
        params.delete('verify');
        const qs = params.toString();
        globalThis.history.replaceState({}, '', qs ? `${globalThis.location.pathname}?${qs}` : globalThis.location.pathname);
      });
    return () => { cancelled = true; };
  }, [verifyToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    if (!email.trim() || !password) return;

    setCaptcha({ token: "", answer: "" });
    setCaptchaReloadKey((key) => key + 1);
    setSecurityStep(true);
  };

  const handleSecuritySubmit = async (e) => {
    e.preventDefault();
    if (!captcha.token || !captcha.answer.trim()) {
      setAuthError("Complete the security check.");
      return;
    }
    const result = await login(email.trim(), password, captcha);
    if (result && typeof result === 'object' && result.password_weak) {
      setForceUpdate({ token: result.token, user: result.user });
    } else if (result?.emailVerificationRequired) {
      setVerificationResendEmail(result.email || email.trim());
      setSecurityStep(false);
    } else if (!result) {
      setSecurityStep(false);
      setCaptcha({ token: "", answer: "" });
    }
  };

  const handleSecurityBack = () => {
    setSecurityStep(false);
    setCaptcha({ token: "", answer: "" });
    setAuthError(null);
  };

  const handleForgotSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!forgotEmail.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
      setForgotMessage("Please enter a valid email address.");
      return;
    }
    setForgotLoading(true);
    setForgotMessage(null);
    setForgotResetUrl("");
    setForgotResetToken("");
    setShowForgotResetToken(false);
    setForgotCopyMessage("");
    try {
      const res = await axios.post(`${getAuthUrl()}/request-password-reset`, { email: forgotEmail.trim() });
      if (res.data?.delivery === "manual") {
        setForgotResetUrl(res.data?.resetUrl || "");
        setForgotResetToken(res.data?.resetToken || "");
        setForgotMessage("Email delivery is unavailable right now. Use the manual reset link below.");
      } else {
        setForgotMessage("If that email exists, a reset link has been sent.");
      }
    } catch (err) {
      setForgotMessage(err.response?.data?.error || "Could not send reset email right now.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleCopyForgotResetLink = async () => {
    if (!forgotResetUrl) return;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await globalThis.navigator.clipboard.writeText(forgotResetUrl);
      setForgotCopyMessage("Reset link copied.");
    } catch {
      setForgotCopyMessage("Could not copy automatically. Please copy the link manually.");
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = (verificationResendEmail || email).trim();
    if (!targetEmail) return;
    setVerificationResendLoading(true);
    setVerificationResendMessage(null);
    try {
      await axios.post(`${getAuthUrl()}/resend-verification`, { email: targetEmail });
      setVerificationResendMessage("If that account still needs confirmation, a new link has been sent.");
    } catch (err) {
      setVerificationResendMessage(err.response?.data?.error || "Could not send a confirmation email right now.");
    } finally {
      setVerificationResendLoading(false);
    }
  };

  const handleTokenResetSubmit = async (e) => {
    e.preventDefault();
    setResetError(null);
    if (resetPassword.length < 6) {
      setResetError("New password must be at least 6 characters.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetLoading(true);
    try {
      await axios.post(`${getAuthUrl()}/reset-password`, {
        token: resetToken,
        newPassword: resetPassword,
      });
      setResetToken("");
      setResetPassword("");
      setResetConfirm("");
      setPassword("");
      setForgotMessage("Password reset successful. Please sign in with your new password.");
    } catch (err) {
      setResetError(err.response?.data?.error || "Failed to reset password.");
    } finally {
      const params = new URLSearchParams(globalThis.location.search);
      params.delete('reset');
      const qs = params.toString();
      globalThis.history.replaceState({}, '', qs ? `${globalThis.location.pathname}?${qs}` : globalThis.location.pathname);
      setResetLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setUpdateError(null);
    if (newPassword.length < 6) {
      setUpdateError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNew) {
      setUpdateError("Passwords do not match.");
      return;
    }
    setUpdating(true);
    try {
      await axios.patch(`${getAuthUrl()}/password`, {
        currentPassword: password,
        newPassword,
      }, { headers: { Authorization: `Bearer ${forceUpdate.token}` } });
      completeLogin(forceUpdate.token, forceUpdate.user);
      setForceUpdate(null);
    } catch (err) {
      setUpdateError(err.response?.data?.error || "Failed to update password.");
    } finally {
      setUpdating(false);
    }
  };

  if (forceUpdate) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">
              <img
                className="auth-logo-image"
                 src="/vault-jump.png"
                alt="Vault Jump Retro logo"
              />
              <span className="auth-logo-text">Vault Jump Retro</span>
          </div>
          <h2 className="auth-title">Update Your Password</h2>
          <p className="auth-subtitle">Your password is too short. Please set a new password (at least 6 characters).</p>

          <form className="auth-form" onSubmit={handlePasswordUpdate}>
            {updateError && (
              <div className="auth-error" role="alert">{updateError}</div>
            )}

            <div className="auth-field">
              <label htmlFor="new-password">New Password</label>
              <div className="auth-password-wrapper">
                <input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  autoFocus
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setUpdateError(null); }}
                  disabled={updating}
                />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowNew(v => !v)} tabIndex={-1}>
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="confirm-new-password">Confirm New Password</label>
              <div className="auth-password-wrapper">
                <input
                  id="confirm-new-password"
                  type={showConfirmNew ? "text" : "password"}
                  placeholder="Re-enter new password"
                  value={confirmNew}
                  onChange={(e) => { setConfirmNew(e.target.value); setUpdateError(null); }}
                  disabled={updating}
                />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowConfirmNew(v => !v)} tabIndex={-1}>
                  {showConfirmNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={updating || !newPassword || !confirmNew}
            >
              {updating ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (verifyToken) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">
            <img
              className="auth-logo-image"
              src="/vault-jump.png"
              alt="Vault Jump Retro logo"
            />
            <span className="auth-logo-text">Vault Jump Retro</span>
          </div>
          <h2 className="auth-title">Email Confirmation</h2>
          <p className="auth-subtitle">Confirming your Vault Jump Retro account.</p>

          {verifyStatus.loading && <output className="auth-info">Confirming your email...</output>}
          {verifyStatus.success && <output className="auth-info">Email confirmed. You can now sign in.</output>}
          {verifyStatus.error && <div className="auth-error" role="alert">{verifyStatus.error}</div>}

          {verifyStatus.error && (
            <div className="auth-form">
              <div className="auth-field">
                <label htmlFor="verify-resend-email">Email</label>
                <input
                  id="verify-resend-email"
                  type="email"
                  value={verificationResendEmail || email}
                  onChange={(e) => setVerificationResendEmail(e.target.value)}
                  disabled={verificationResendLoading}
                />
              </div>
              {verificationResendMessage && <div className="auth-info">{verificationResendMessage}</div>}
              <button
                type="button"
                className="auth-btn-primary"
                onClick={handleResendVerification}
                disabled={verificationResendLoading || !(verificationResendEmail || email).trim()}
              >
                {verificationResendLoading ? "Sending..." : "Send New Link"}
              </button>
            </div>
          )}

          {verifyStatus.success && (
            <button type="button" className="auth-btn-primary" onClick={() => setVerifyToken("")}>Sign In</button>
          )}
        </div>
      </div>
    );
  }

  if (resetToken) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">
            <img
              className="auth-logo-image"
               src="/vault-jump.png"
              alt="Vault Jump Retro logo"
            />
            <span className="auth-logo-text">Vault Jump Retro</span>
          </div>
          <h2 className="auth-title">Reset Password</h2>
          <p className="auth-subtitle">Set your new password.</p>

          <form className="auth-form" onSubmit={handleTokenResetSubmit}>
            {resetError && (
              <div className="auth-error" role="alert">{resetError}</div>
            )}

            <div className="auth-field">
              <label htmlFor="reset-password">New Password</label>
              <input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => { setResetPassword(e.target.value); setResetError(null); }}
                disabled={resetLoading}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="reset-password-confirm">Confirm New Password</label>
              <input
                id="reset-password-confirm"
                type="password"
                value={resetConfirm}
                onChange={(e) => { setResetConfirm(e.target.value); setResetError(null); }}
                disabled={resetLoading}
              />
            </div>

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={resetLoading || !resetPassword || !resetConfirm}
            >
              {resetLoading ? "Resetting…" : "Set New Password"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (securityStep) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">
            <img
              className="auth-logo-image"
              src="/vault-jump.png"
              alt="Vault Jump Retro logo"
            />
            <span className="auth-logo-text">Vault Jump Retro</span>
          </div>
          <h2 className="auth-title">CAPTCHA Verification</h2>
          <p className="auth-subtitle">Complete the CAPTCHA security check to sign in.</p>

          <form className="auth-form" onSubmit={handleSecuritySubmit}>
            {authError && (
              <div className="auth-error" role="alert">
                {authError}
              </div>
            )}

            <CaptchaChallenge
              value={captcha}
              onChange={handleCaptchaChange}
              disabled={authLoading}
              reloadKey={captchaReloadKey}
            />

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={authLoading || !captcha.token || !captcha.answer.trim()}
            >
              {authLoading ? "Signing in…" : "Sign In"}
            </button>

            <button
              type="button"
              className="auth-btn-secondary"
              onClick={handleSecurityBack}
              disabled={authLoading}
            >
              Back
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
            <img
              className="auth-logo-image"
               src="/vault-jump.png"
              alt="Vault Jump Retro logo"
            />
          <span className="auth-logo-text">Vault Jump Retro</span>
        </div>
        <h2 className="auth-title">Welcome to Vault Jump Retro</h2>
        <p className="auth-subtitle">Sign in to access your boards</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {authError && (
            <div className="auth-error" role="alert">
              {authError}
            </div>
          )}

          {verificationResendEmail && (
            <div className="auth-form">
              {verificationResendMessage && <div className="auth-info">{verificationResendMessage}</div>}
              <button
                type="button"
                className="auth-btn-secondary"
                onClick={handleResendVerification}
                disabled={verificationResendLoading}
              >
                {verificationResendLoading ? "Sending..." : "Send New Confirmation Link"}
              </button>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setAuthError(null); setVerificationResendEmail(""); setVerificationResendMessage(null); }}
              disabled={authLoading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <div className="auth-password-wrapper">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setAuthError(null); }}
                disabled={authLoading}
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="auth-btn-primary"
            disabled={authLoading || !email.trim() || !password}
          >
            Sign In
          </button>

          <button
            type="button"
            className="auth-link-btn"
            onClick={() => setShowForgot(v => !v)}
            disabled={authLoading}
            style={{ marginTop: 6 }}
          >
            {showForgot ? "Hide password reset" : "Forgot password?"}
          </button>

          {showForgot && (
            <div className="auth-form">
              <div className="auth-field">
                <label htmlFor="forgot-email">Email for reset link</label>
                <input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={forgotLoading}
                />
              </div>
              {forgotMessage && <div className="auth-info">{forgotMessage}</div>}
              {forgotResetUrl && (
                <div className="auth-manual-panel" role="status" aria-live="polite">
                  <p className="auth-manual-title">Use this manual reset link.</p>
                  <div className="auth-manual-actions">
                    <a href={forgotResetUrl} className="auth-btn-primary auth-btn-inline">Open Reset Link</a>
                    <button type="button" className="auth-btn-secondary auth-btn-inline" onClick={handleCopyForgotResetLink}>Copy Link</button>
                  </div>
                  {forgotCopyMessage ? <p className="auth-manual-message">{forgotCopyMessage}</p> : null}
                  <p className="auth-manual-link">
                    <a href={forgotResetUrl}>{forgotResetUrl}</a>
                  </p>
                </div>
              )}
              {forgotResetToken && (
                <div className="auth-manual-token-wrap">
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => setShowForgotResetToken((prev) => !prev)}
                  >
                    {showForgotResetToken ? "Hide reset token" : "Show reset token"}
                  </button>
                  {showForgotResetToken ? (
                    <div className="auth-info auth-manual-token">{forgotResetToken}</div>
                  ) : null}
                </div>
              )}
              <button className="auth-btn-primary" type="button" onClick={handleForgotSubmit} disabled={forgotLoading || !forgotEmail.trim()}>
                {forgotLoading ? "Sending…" : "Send Reset Link"}
              </button>
            </div>
          )}
        </form>

        <p className="auth-switch">
          Don&apos;t have an account?{" "}
          <button className="auth-link-btn" onClick={onGoToRegister} disabled={authLoading}>
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
