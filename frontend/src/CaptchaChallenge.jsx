import React, { useCallback, useEffect, useRef, useState } from "react";

const REQUIRED_STREAK = 5;
const CUE_MS = 900;
const RESULT_MS = 520;
const PADS = ["A", "B", "C"];

function randomPad(exclude = -1) {
  const values = new Uint32Array(1);
  let next = exclude;
  while (next === exclude) {
    globalThis.crypto.getRandomValues(values);
    next = values[0] % PADS.length;
  }
  return next;
}

function createChallengeId() {
  if (globalThis.crypto?.randomUUID) return `landing-pads:${globalThis.crypto.randomUUID()}`;
  const values = new Uint32Array(4);
  globalThis.crypto.getRandomValues(values);
  return `landing-pads:${Array.from(values).map((value) => value.toString(36)).join("")}`;
}

export default function CaptchaChallenge({ value, onChange, disabled, reloadKey = 0 }) {
  const [challengeId, setChallengeId] = useState(() => createChallengeId());
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [safePad, setSafePad] = useState(() => randomPad());
  const [selectedPad, setSelectedPad] = useState(null);
  const [streak, setStreak] = useState(0);
  const [status, setStatus] = useState("watch");
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearProof = useCallback(() => {
    onChange({ type: "landing-pads", token: "", answer: "", rounds: 0 });
  }, [onChange]);

  const startRound = useCallback((nextStreak = 0, previousSafePad = -1) => {
    clearTimer();
    setSelectedPad(null);
    setSafePad(randomPad(previousSafePad));
    setStreak(nextStreak);
    setStatus("watch");
    clearProof();
    timerRef.current = setTimeout(() => {
      setStatus("ready");
      timerRef.current = null;
    }, CUE_MS);
  }, [clearProof, clearTimer]);

  const resetChallenge = useCallback(() => {
    clearTimer();
    setChallengeId(createChallengeId());
    setStartedAt(Date.now());
    startRound(0);
  }, [clearTimer, startRound]);

  useEffect(() => {
    resetChallenge();
    return clearTimer;
  }, [resetChallenge, reloadKey, clearTimer]);

  const handlePadClick = (padIndex) => {
    if (disabled || status !== "ready") return;

    setSelectedPad(padIndex);
    if (padIndex !== safePad) {
      setStatus("miss");
      clearProof();
      timerRef.current = setTimeout(() => startRound(0, safePad), RESULT_MS);
      return;
    }

    const nextStreak = streak + 1;
    setStreak(nextStreak);
    if (nextStreak >= REQUIRED_STREAK) {
      clearTimer();
      setStatus("complete");
      onChange({
        type: "landing-pads",
        token: challengeId,
        answer: "complete",
        rounds: nextStreak,
        startedAt,
        completedAt: Date.now(),
      });
      return;
    }

    setStatus("hit");
    clearProof();
    timerRef.current = setTimeout(() => startRound(nextStreak, safePad), RESULT_MS);
  };

  const complete = value?.type === "landing-pads" && value?.answer === "complete" && Number(value?.rounds || 0) >= REQUIRED_STREAK;
  const prompt = status === "watch"
    ? "Watch the lit pad."
    : status === "ready"
      ? "Pick the safe pad."
      : status === "hit"
        ? "Landing locked."
        : status === "miss"
          ? "Missed approach. Streak reset."
          : "Security check complete.";

  return (
    <div className="auth-field auth-landing-pads-field">
      <div className="auth-landing-pads-header">
        <span className="auth-landing-kicker">Landing Pads</span>
        <span className="auth-landing-count">{Math.min(streak, REQUIRED_STREAK)} / {REQUIRED_STREAK}</span>
      </div>
      <div className="auth-landing-pads-panel" aria-live="polite">
        <p className="auth-landing-title">Pick the safe pad.</p>
        <p className="auth-landing-prompt">{prompt}</p>
        <div className="auth-landing-pads-grid">
          {PADS.map((pad, index) => {
            const isCue = status === "watch" && index === safePad;
            const isSelected = selectedPad === index;
            const isCorrectSelection = isSelected && index === safePad && (status === "hit" || status === "complete");
            const isMiss = isSelected && index !== safePad && status === "miss";
            return (
              <button
                key={pad}
                type="button"
                className={[
                  "auth-landing-pad",
                  isCue ? "auth-landing-pad-cue" : "",
                  isCorrectSelection ? "auth-landing-pad-hit" : "",
                  isMiss ? "auth-landing-pad-miss" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => handlePadClick(index)}
                disabled={disabled || status !== "ready" || complete}
              >
                Pad {pad}
              </button>
            );
          })}
        </div>
        <div className="auth-landing-streak">Current streak: {Math.min(streak, REQUIRED_STREAK)}</div>
      </div>
    </div>
  );
}
