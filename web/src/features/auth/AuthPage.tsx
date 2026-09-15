import { useEffect, useMemo, useState, type FC, type FormEvent } from "react";

import { login, signup } from "../../lib/api";
import type { AuthResponse } from "../../lib/types";

interface AuthPageProps {
  mode: "login" | "signup";
  onBackToLanding: () => void;
  onContinueToApp: () => void;
  onSwitchMode: () => void;
  onAuthSuccess: (auth: AuthResponse) => void;
}

const PASSWORD_MIN_LENGTH = 10;

interface PasswordRuleStatus {
  label: string;
  valid: boolean;
}

function modeToTitle(mode: "login" | "signup"): string {
  return mode === "login" ? "Log In" : "Create Account";
}

function modeToDescription(mode: "login" | "signup"): string {
  if (mode === "login") {
    return "Resume synced reading progress, manage your provider keys, and access paid features.";
  }
  return "Create your account to unlock key vault storage, usage history, and managed billing.";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function evaluateSignupPassword(password: string): PasswordRuleStatus[] {
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, valid: password.length >= PASSWORD_MIN_LENGTH },
    { label: "At least one lowercase letter", valid: /[a-z]/.test(password) },
    { label: "At least one uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "At least one number", valid: /\d/.test(password) },
    { label: "No whitespace", valid: !/\s/.test(password) },
  ];
}

function normalizeApiErrorDetail(raw: string): string {
  const value = raw.trim();
  const firstColon = value.indexOf(":");
  if (firstColon === -1) {
    return value;
  }
  const detail = value.slice(firstColon + 1).trim();
  return detail.length > 0 ? detail : value;
}

function toAuthErrorMessage(rawMessage: string, mode: "login" | "signup"): string {
  const detail = normalizeApiErrorDetail(rawMessage);
  const lower = detail.toLowerCase();

  if (lower.includes("network error")) {
    return "Could not reach the server. Check your connection and try again.";
  }

  if (lower.includes("too many")) {
    return detail;
  }

  if (lower.includes("invalid email address")) {
    return "Enter a valid email address.";
  }

  if (lower.includes("field required")) {
    return "Email and password are required.";
  }

  if (lower.includes("string should have at least") && lower.includes("characters")) {
    return mode === "signup" ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` : "Password is too short.";
  }

  if (lower.includes("invalid email or password")) {
    return "Email or password is incorrect.";
  }

  if (lower.includes("account is disabled")) {
    return "This account is disabled. Contact support if this is unexpected.";
  }

  if (mode === "signup" && lower.includes("unable to create account with these credentials")) {
    return "This email is already registered. Try logging in instead.";
  }

  return detail;
}

export const AuthPage: FC<AuthPageProps> = ({ mode, onBackToLanding, onContinueToApp, onSwitchMode, onAuthSuccess }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordFieldActive, setPasswordFieldActive] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signupPasswordRules = useMemo(() => evaluateSignupPassword(password), [password]);
  const signupPasswordValid = useMemo(() => signupPasswordRules.every((rule) => rule.valid), [signupPasswordRules]);
  const unmetSignupPasswordRules = useMemo(() => signupPasswordRules.filter((rule) => !rule.valid), [signupPasswordRules]);

  const submitLabel = mode === "login" ? "Log In" : "Sign Up";
  const switchLabel = mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in";

  useEffect(() => {
    setPasswordFieldActive(false);
    setShowPassword(false);
  }, [mode]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && !signupPasswordValid) {
      setPasswordFieldActive(true);
      setError("Password does not meet the minimum requirements.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const authResponse = mode === "login" ? await login(normalizedEmail, password) : await signup(normalizedEmail, password);
      onAuthSuccess(authResponse);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Authentication failed.";
      setError(toAuthErrorMessage(message, mode));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="auth-eyebrow">Speed Reader Account</p>
        <h1>{modeToTitle(mode)}</h1>
        <p>{modeToDescription(mode)}</p>

        <form className="auth-form" onSubmit={(event) => void onSubmit(event)} noValidate>
          <label>
            Email
            <input type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Password
            <div className="auth-password-input-row">
              <input
                type={mode === "signup" && showPassword ? "text" : "password"}
                value={password}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onFocus={() => {
                  if (mode === "signup") {
                    setPasswordFieldActive(true);
                  }
                }}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (mode === "signup") {
                    setPasswordFieldActive(true);
                  }
                }}
                minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 8}
                required
              />
              {mode === "signup" ? (
                <button
                  type="button"
                  className={`auth-password-toggle${showPassword ? " is-visible" : ""}`}
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M2 12c2.4-4 5.9-6 10-6s7.6 2 10 6c-2.4 4-5.9 6-10 6s-7.6-2-10-6Z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPassword ? null : <path d="M4 4l16 16" />}
                  </svg>
                </button>
              ) : null}
            </div>
          </label>

          {mode === "signup" && passwordFieldActive && unmetSignupPasswordRules.length > 0 ? (
            <ul className="auth-password-rules" aria-live="polite">
              {unmetSignupPasswordRules.map((rule) => (
                <li key={rule.label}>{rule.label}</li>
              ))}
            </ul>
          ) : null}

          {error ? <p className="auth-helper auth-error">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Please wait..." : submitLabel}
          </button>
        </form>

        <div className="auth-actions">
          <button type="button" className="btn-secondary" onClick={onSwitchMode}>
            {switchLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onContinueToApp}>
            Continue as Guest
          </button>
          <button type="button" className="btn-ghost" onClick={onBackToLanding}>
            Back to Landing
          </button>
        </div>
      </section>
    </main>
  );
};
