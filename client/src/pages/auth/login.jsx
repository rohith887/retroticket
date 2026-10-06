// apps/client/src/pages/auth/login.jsx
// Built only from design-system tokens and shared components; no login-specific styling.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { Alert, Button, Field, Input, PasswordInput, toast } from "../../ui";
import { BRAND_INITIAL, BRAND_NAME } from "../../ui/brand";
import { useUser } from "../../store/session.jsx";
import { apiUrl } from "../../utils/api";

// Turn any failure into a readable sentence (the API answers with { message }).
async function readError(res) {
  try {
    const data = await res.json();
    if (data?.message) return data.message;
  } catch {
    /* body was not JSON */
  }
  if (res.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  if (res.status >= 500) return "The server had a problem. Please try again in a moment.";
  return "Invalid email or password.";
}

function getRedirectTarget(nextUser) {
  if (nextUser?.isAdmin) return "/admin";
  if (nextUser?.isAgent) return "/agents/tickets?status=open";
  return "/portal";
}

function normalizeUser(rawUser) {
  if (!rawUser) return null;
  return {
    ...rawUser,
    _id: rawUser.id || rawUser._id,
    id: rawUser.id || rawUser._id,
    isAdmin: rawUser.isAdmin === true,
    isAgent: rawUser.isAgent === true,
    imap_enabled: rawUser.imap_enabled === true,
  };
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [capsLock, setCapsLock] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [ssoUrl, setSsoUrl] = useState("");

  const { user, setUser } = useUser();
  const navigate = useNavigate();
  const isSubmitting = useRef(false);
  const emailRef = useRef(null);
  const loading = status === "loading";

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading || isSubmitting.current) return;

    isSubmitting.current = true;
    setStatus("loading");
    setError("");

    try {
      const res = await fetch(apiUrl("/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!res.ok) {
        setError(await readError(res));
        setPassword("");
        return;
      }

      const data = await res.json();
      if (!data.token || !data.user) {
        setError(data.message || "Login failed. Please try again.");
        return;
      }

      const normalizedUser = normalizeUser(data.user);
      // The token lives 8 hours on the server; keep the cookie aligned with that.
      Cookies.set("session", data.token, {
        secure: window.location.protocol === "https:",
        sameSite: "lax",
        path: "/",
        expires: 8 / 24,
      });
      localStorage.setItem("session", data.token);
      localStorage.setItem("user", JSON.stringify(normalizedUser));
      setUser(normalizedUser);
      navigate(getRedirectTarget(normalizedUser), { replace: true });
      toast.success("Welcome back!");
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setStatus("idle");
      isSubmitting.current = false;
    }
  }

  // Already signed in: go straight to the right home page.
  useEffect(() => {
    if (user) navigate(getRedirectTarget(user), { replace: true });
  }, [user, navigate]);

  // Discover whether SSO is configured (stay silent when it is not).
  useEffect(() => {
    if (user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/v1/auth/check"));
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success && data.url) setSsoUrl(data.url);
      } catch {
        /* SSO is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  return (
    <div className="ds-root flex min-h-dvh items-center justify-center bg-canvas p-4">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-ds-lg bg-brand text-body-sm font-semibold text-brand-fg">
            {BRAND_INITIAL}
          </span>
          <span className="text-body font-semibold text-ink">{BRAND_NAME}</span>
        </div>

        <h1 className="text-heading font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-body-sm text-ink-muted">Enter your credentials to open your workspace.</p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4 rounded-ds-lg border border-line bg-surface p-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Field label="Email address" required>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                ref={emailRef}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            )}
          </Field>

          <Field label="Password" required hint={capsLock ? "Caps Lock is on." : undefined}>
            {(fieldProps) => (
              <PasswordInput
                {...fieldProps}
                name="password"
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") === true)}
                onBlur={() => setCapsLock(false)}
                disabled={loading}
                required
              />
            )}
          </Field>

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={!email.trim() || !password}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {ssoUrl ? (
            <>
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-caption text-ink-faint">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button size="lg" className="w-full" onClick={() => (window.location.href = ssoUrl)} disabled={loading}>
                Continue with single sign-on
              </Button>
            </>
          ) : null}
        </form>
      </main>
    </div>
  );
}
