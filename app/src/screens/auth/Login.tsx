/**
 * Sign-in screen (#74) — the primary unauthenticated entry point (ADR 0007).
 *
 * Two-step flow inside the shared `AuthLayout`:
 *   1. email + password → `api.auth.login`. On success we install the session
 *      and show the `RedirectLoader` before navigating to the workspace root;
 *      if the backend answers with an MFA challenge we advance to step 2.
 *   2. a 6-digit TOTP code → `api.auth.loginMfa`, then the same success path.
 *
 * SSO buttons and the "OR" divider from the design are intentionally NOT
 * rendered (deferred). Accounts are admin-provisioned, so there is no signup
 * link — the design's "Create an account" line is replaced with a muted note.
 */

import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { AuthLayout, RedirectLoader } from "@/components/auth/AuthLayout";
import { AuthLabel, FieldWrap, PasswordInput, TextInput } from "@/components/auth/fields";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import type { AuthTokens } from "@/types/api";

const gradientBtn: CSSProperties = {
  background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
  boxShadow: "0 10px 26px -8px rgba(139,92,246,.8)",
};

function Spinner() {
  return (
    <span
      className="h-[17px] w-[17px] rounded-full border-2 border-white/40"
      style={{ borderTopColor: "#fff", animation: "spin .7s linear infinite" }}
    />
  );
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}

export function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MFA challenge state (step 2). `mfaToken` is set once the backend asks for a
  // code; until then we're on the email/password step.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // Once a session is minted we swap the whole screen for the redirect loader.
  const [redirecting, setRedirecting] = useState(false);

  function finishSession(tokens: AuthTokens) {
    useAuth.getState().setSession({ accessToken: tokens.accessToken, user: tokens.user });
    setRedirecting(true);
    setTimeout(() => navigate("/", { replace: true }), 1200);
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api.auth.login({ email, password, remember });
      // Discriminate on a TRUTHY `mfaRequired` — the backend also returns
      // `mfaRequired: false` + `mfaToken: null` on a straight success.
      if ("mfaRequired" in res && res.mfaRequired) {
        setMfaToken(res.mfaToken);
      } else {
        finishSession(res as AuthTokens);
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (pending || !mfaToken) return;
    setPending(true);
    setError(null);
    try {
      const tokens = await api.auth.loginMfa({ mfaToken, code });
      finishSession(tokens);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (redirecting) return <RedirectLoader label="Loading your workspace…" />;

  return (
    <AuthLayout>
      {mfaToken ? (
        <MfaStep
          code={code}
          setCode={setCode}
          pending={pending}
          error={error}
          onSubmit={handleMfa}
          onBack={() => {
            setMfaToken(null);
            setCode("");
            setError(null);
          }}
        />
      ) : (
        <>
          <div className="mb-[26px]">
            <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">Welcome back</h2>
            <p className="m-0 text-[13.5px] text-muted">Sign in to your Q&#8209;Agent workspace.</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
            <div>
              <AuthLabel htmlFor="login-email">Work email</AuthLabel>
              <TextInput
                id="login-email"
                type="email"
                autoComplete="username"
                required
                icon={<Mail size={15} />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <AuthLabel htmlFor="login-password">Password</AuthLabel>
                <button
                  type="button"
                  onClick={() => navigate("/forgot")}
                  className="mb-2 border-none bg-transparent p-0 text-xs font-semibold text-violet"
                >
                  Forgot?
                </button>
              </div>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-[9px] text-[12.5px] text-ink-soft">
              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                onClick={() => setRemember((v) => !v)}
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors"
                style={
                  remember
                    ? { ...gradientBtn, boxShadow: "none", borderColor: "transparent" }
                    : { borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.04)" }
                }
              >
                {remember ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
              Keep me signed in for 30 days
            </label>

            {error ? (
              <p className="m-0 text-[12.5px] font-medium text-danger-soft" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="mt-0.5 flex h-[46px] items-center justify-center gap-[9px] rounded-xl border-none text-[14.5px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-80"
              style={gradientBtn}
            >
              {pending ? (
                <>
                  <Spinner />
                  Signing in&#8230;
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="m-0 mt-[22px] text-center text-[12.5px] text-faint">
            Access is provisioned by your workspace admin.
          </p>
        </>
      )}
    </AuthLayout>
  );
}

function MfaStep({
  code,
  setCode,
  pending,
  error,
  onSubmit,
  onBack,
}: {
  code: string;
  setCode: (v: string) => void;
  pending: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-[22px] flex items-center gap-[7px] border-none bg-transparent p-0 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink-soft"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Back to sign in
      </button>

      <div className="mb-[26px]">
        <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">
          Two&#8209;factor authentication
        </h2>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted">
          Enter the 6&#8209;digit code from your authenticator app.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <div>
          <AuthLabel htmlFor="mfa-code">Authentication code</AuthLabel>
          <FieldWrap>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="min-w-0 flex-1 border-none bg-transparent text-center text-[20px] font-bold tracking-[0.5em] text-ink outline-none placeholder:tracking-[0.5em] placeholder:text-[#6c6c7e]"
            />
          </FieldWrap>
        </div>

        {error ? (
          <p className="m-0 text-[12.5px] font-medium text-danger-soft" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || code.length < 6}
          className="mt-0.5 flex h-[46px] items-center justify-center gap-[9px] rounded-xl border-none text-[14.5px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
          style={gradientBtn}
        >
          {pending ? (
            <>
              <Spinner />
              Verifying&#8230;
            </>
          ) : (
            "Verify code"
          )}
        </button>
      </form>
    </>
  );
}
