import React, { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "./AuthContext";
import { getApiUrl } from "./config";
import CaptchaChallenge from "./CaptchaChallenge";
import axios from "axios";
import "./Auth.css";

const API_URL = getApiUrl();

export default function RegisterPage({ onGoToLogin }) {
  const { register, authError, authLoading, setAuthError } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [company, setCompany] = useState("");
  const [companyEntryMode, setCompanyEntryMode] = useState("select");
  const [companyOptions, setCompanyOptions] = useState([]);
  const [invitePreview, setInvitePreview] = useState(null);
  const [inviteToken, setInviteToken] = useState("");
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [captcha, setCaptcha] = useState({ token: "", answer: "" });
  const [captchaReloadKey, setCaptchaReloadKey] = useState(0);

  const error = localError || authError;
  const passwordsMatch = password === confirmPassword;
  const companyNames = Array.from(new Set([...companyOptions, invitePreview?.company].filter(Boolean)));
  const selectedCompanyValue = companyEntryMode === "custom" ? "__custom__" : company;
  const isCustomCompany = selectedCompanyValue === "__custom__";
  const isInviteCompanyLocked = !!invitePreview?.company;
  const canSubmit =
    !authLoading &&
    !loadingInvite &&
    !(inviteToken && (!invitePreview || invitePreview.status !== 'PENDING')) &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!email.trim() &&
    !!company.trim() &&
    !!password &&
    !!confirmPassword &&
    passwordsMatch &&
    !!captcha.token &&
    !!captcha.answer.trim();

  const clearErrors = React.useCallback(() => { setLocalError(null); setAuthError(null); }, [setAuthError]);
  const handleCaptchaChange = React.useCallback((nextCaptcha) => {
    setCaptcha(nextCaptcha);
    clearErrors();
  }, [clearErrors]);

  // Load invite preview and company options on mount
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite') || '';
    if (!cancelled) setInviteToken(invite);

    axios.get(`${API_URL}/companies`)
      .then(res => { if (!cancelled) setCompanyOptions(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setCompanyOptions([]); });

    if (!invite) {
      if (!cancelled) {
        setLoadingInvite(false);
        setInvitePreview(null);
      }
      return () => { cancelled = true; };
    }

    if (!cancelled) {
      setLoadingInvite(true);
    }

    axios.get(`${API_URL}/invites/${encodeURIComponent(invite)}`)
      .then(res => {
        if (cancelled) return;
        setInvitePreview(res.data);
        if (res.data?.company) {
          setCompany(res.data.company);
          setCompanyEntryMode("select");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setInvitePreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingInvite(false);
      });

    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearErrors();

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password || !company.trim()) {
      setLocalError("All fields are required.");
      return;
    }
    if (inviteToken && (!invitePreview || invitePreview.status !== 'PENDING')) {
      setLocalError("This invite is invalid, expired, or already used.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLocalError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setLocalError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    if (!captcha.token || !captcha.answer.trim()) {
      setLocalError("Complete the security check.");
      return;
    }

    const success = await register(firstName.trim(), lastName.trim(), email.trim(), password, company.trim(), inviteToken, captcha);
    if (!success) setCaptchaReloadKey((key) => key + 1);
  };

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
        <h2 className="auth-title">Create your account</h2>
        <p className="auth-subtitle">{inviteToken ? "Join your board from an invite link" : "Create your Retro Boards account"}</p>

        {inviteToken && loadingInvite ? (
          <div className="auth-info" role="status">Checking invite link...</div>
        ) : inviteToken && !invitePreview ? (
          <div className="auth-error" role="alert">This invite link is invalid or expired.</div>
        ) : inviteToken && invitePreview.status !== 'PENDING' ? (
          <div className="auth-error" role="alert">This invite is already {invitePreview.status.toLowerCase()}.</div>
        ) : inviteToken && invitePreview ? (
          <div className="auth-info">Invited to join board: <strong>{invitePreview.boardName}</strong></div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <div className="auth-field-row">
            <div className="auth-field">
              <label htmlFor="reg-first-name">First Name</label>
              <input
                id="reg-first-name"
                type="text"
                autoFocus
                autoComplete="given-name"
                placeholder="First"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); clearErrors(); }}
                disabled={authLoading}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="reg-last-name">Last Name</label>
              <input
                id="reg-last-name"
                type="text"
                autoComplete="family-name"
                placeholder="Last"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); clearErrors(); }}
                disabled={authLoading}
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearErrors(); }}
              disabled={authLoading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-company">Company</label>
            <select
              id="reg-company"
              className="auth-select"
              value={selectedCompanyValue}
              onChange={(e) => {
                const value = e.target.value;
                setCompanyEntryMode(value === "__custom__" ? "custom" : "select");
                setCompany(value === "__custom__" ? "" : value);
                clearErrors();
              }}
              disabled={authLoading || isInviteCompanyLocked}
            >
              <option value="" disabled>Select a company</option>
              {companyNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              {!isInviteCompanyLocked && <option value="__custom__">Add a different company</option>}
            </select>
            {!isInviteCompanyLocked && isCustomCompany && (
              <input
                type="text"
                placeholder="Enter your company"
                value={company}
                onChange={(e) => { setCompany(e.target.value); clearErrors(); }}
                disabled={authLoading}
              />
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="reg-password">Password</label>
            <div className="auth-password-wrapper">
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearErrors(); }}
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

          <div className="auth-field">
            <label htmlFor="reg-confirm-password">Confirm Password</label>
            <div className="auth-password-wrapper">
              <input
                id="reg-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); clearErrors(); }}
                disabled={authLoading}
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowConfirmPassword(v => !v)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <CaptchaChallenge
            value={captcha}
            onChange={handleCaptchaChange}
            disabled={authLoading}
            reloadKey={captchaReloadKey}
          />

          <button
            type="submit"
            className="auth-btn-primary"
            disabled={!canSubmit}
          >
            {authLoading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{" "}
          <button className="auth-link-btn" onClick={onGoToLogin} disabled={authLoading}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

