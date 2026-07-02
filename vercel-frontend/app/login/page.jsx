"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";

const COUNTRIES = [
  "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Singapore", "United Arab Emirates", "Japan",
  "Other",
];

function firebaseErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Incorrect email or password.";
  }
  if (code.includes("email-already-in-use")) {
    return "An account with this email already exists — try signing in instead.";
  }
  if (code.includes("weak-password")) {
    return "Password should be at least 6 characters.";
  }
  if (code.includes("invalid-email")) {
    return "That doesn't look like a valid email address.";
  }
  if (code.includes("popup-closed-by-user")) {
    return "Google sign-in was closed before finishing.";
  }
  if (code.includes("unauthorized-domain")) {
    return "This domain isn't authorized for sign-in yet. Add it in Firebase Console → Authentication → Settings → Authorized domains.";
  }
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const { user, loading, login, signup, loginWithGoogle, resetPassword } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  function switchMode(next) {
    setError("");
    setResetSent(false);
    setMode(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
        router.replace("/");
      } else if (mode === "signup") {
        // `country` is captured for future use (e.g. localized destinations,
        // currency) but isn't sent anywhere yet — no backend field for it.
        await signup(email, password);
        router.replace("/");
      } else if (mode === "reset") {
        await resetPassword(email);
        setResetSent(true);
      }
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setSubmitting(true);
    try {
      await loginWithGoogle();
      router.replace("/");
    } catch (err) {
      setError(firebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || (!loading && user)) {
    return (
      <main className="page">
        <div className="loading-row" style={{ margin: "80px auto" }}>
          <span className="spinner" aria-hidden="true" />
          Checking sign-in status…
        </div>
      </main>
    );
  }

  const heading =
    mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password";

  return (
    <main className="page">
      <div className="top-strip">
        <div className="brand">
          <span className="brand-mark">ST</span>
          SmartTrip AI
        </div>
        <span>Knapsack-optimized itineraries</span>
      </div>

      <section className="hero">
        <div className="hero-eyebrow">{heading}</div>
        <h1>
          {mode === "login" && <>Sign in to <em>plan your next trip</em>.</>}
          {mode === "signup" && <>One account, <em>every itinerary you generate</em>.</>}
          {mode === "reset" && <>We'll email you a <em>link to set a new password</em>.</>}
        </h1>
        <p>
          {mode === "login" && "Sign in with email and password, or continue with Google."}
          {mode === "signup" && "Sign up with email and password, or continue with Google."}
          {mode === "reset" && "Enter the email on your account and we'll send a reset link."}
        </p>
      </section>

      <form className="pass" onSubmit={handleSubmit} style={{ maxWidth: 480, margin: "0 auto" }}>
        <div className="pass-main">
          <div className="pass-label-row">
            <span className="pass-tag">
              {mode === "login" ? "Sign in" : mode === "signup" ? "Sign up" : "Forgot password"}
            </span>
          </div>

          <div className="field-grid">
            <div className="field full">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {mode !== "reset" && (
              <div className="field full">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
              </div>
            )}

            {mode === "login" && (
              <div className="field full" style={{ marginTop: -8 }}>
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                    font: "inherit",
                    fontSize: "0.85rem",
                    alignSelf: "flex-start",
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {mode === "signup" && (
              <div className="field full">
                <label htmlFor="country">Region / Country</label>
                <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && <div className="form-error">{error}</div>}

          {resetSent && !error && (
            <div className="form-error" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
              Reset link sent — check your inbox (and spam folder).
            </div>
          )}

          {submitting && (
            <div className="loading-row">
              <span className="spinner" aria-hidden="true" />
              {mode === "login" && "Signing in…"}
              {mode === "signup" && "Creating account…"}
              {mode === "reset" && "Sending reset link…"}
            </div>
          )}

          {mode !== "reset" && (
            <button
              type="button"
              className="interest-pill"
              onClick={handleGoogle}
              disabled={submitting}
              style={{ marginTop: 16, width: "100%", padding: "12px 0" }}
            >
              Continue with Google
            </button>
          )}

          <p style={{ marginTop: 16, color: "var(--text-muted)", fontSize: "0.9rem" }}>
            {mode === "login" && (
              <>
                Don't have an account?{" "}
                <button type="button" onClick={() => switchMode("signup")} style={linkStyle}>
                  Sign up
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} style={linkStyle}>
                  Sign in
                </button>
              </>
            )}
            {mode === "reset" && (
              <>
                Remembered it?{" "}
                <button type="button" onClick={() => switchMode("login")} style={linkStyle}>
                  Back to sign in
                </button>
              </>
            )}
          </p>
        </div>

        <div className="pass-side">
          <div className="pass-side-top">
            <div className="pass-side-eyebrow">Access</div>
            <div className="pass-side-code">
              {mode === "login" ? "IN" : mode === "signup" ? "NEW" : "RST"}
            </div>
          </div>
          <div className="barcode" aria-hidden="true" />
          <button type="submit" className="submit-btn" disabled={submitting}>
            {submitting
              ? "Please wait…"
              : mode === "login"
              ? "Sign in"
              : mode === "signup"
              ? "Create account"
              : "Send reset link"}
          </button>
        </div>
      </form>
    </main>
  );
}

const linkStyle = {
  background: "none",
  border: "none",
  color: "var(--accent)",
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
  font: "inherit",
};
