import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Lock, Mail } from "lucide-react";
import { toast } from "@/lib/toast";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthLabel, PasswordInput, TextInput } from "@/components/auth/fields";
import { api, ApiError } from "@/lib/api";

/**
 * Forgot / reset password (#76) — one public screen, three modes inside
 * `<AuthLayout>`:
 *   1. Request  — email → `api.auth.requestReset`, then mode 2.
 *   2. Sent     — "Check your inbox" confirmation.
 *   3. Reset    — reached via `?token=…`: new password → `api.auth.reset`.
 * Ported from the design source (`design/…/Q-Agent Auth.dc.html`). No SSO.
 */
export function ForgotPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  return token ? <ResetForm token={token} /> : <RequestForm />;
}

const GRADIENT = "linear-gradient(135deg,#8b5cf6,#6366f1)";

/** Full-width violet gradient submit button with an inline loading spinner. */
function GradientButton({
  busy,
  busyLabel,
  children,
}: {
  busy: boolean;
  busyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-[18px] flex h-[46px] w-full items-center justify-center gap-[9px] rounded-xl border-none text-[14.5px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-80"
      style={{ background: GRADIENT, boxShadow: "0 10px 26px -8px rgba(139,92,246,.8)" }}
    >
      {busy ? (
        <>
          <span
            className="h-[17px] w-[17px] rounded-full border-2 border-white/40 border-t-white animate-spin-fast"
            aria-hidden
          />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Secondary "Back to sign in" button. */
function BackToSignInButton() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");
  return (
    <button
      type="button"
      onClick={() => navigate("/login")}
      className="h-11 w-full rounded-xl border border-white/[0.12] bg-white/[0.06] text-[13.5px] font-semibold text-white transition hover:bg-white/[0.12]"
    >
      {t("forgot.back")}
    </button>
  );
}

// ─────────────────────────────────────────── mode 1 + 2: request / sent

function RequestForm() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // Dev-only: backend echoes the reset token when not in prod (email delivery
  // is a stub). Surfaced as a labelled hint so the flow is testable locally.
  const [devToken, setDevToken] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending || !email.trim()) return;
    setSending(true);
    try {
      const res = (await api.auth.requestReset({ email: email.trim() })) as unknown as {
        token?: string | null;
      } | void;
      setDevToken(res && res.token ? res.token : null);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("forgot.sendError"));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <style>{CHECK_POP_KEYFRAMES}</style>
        <div className="text-center">
          <div
            className="mx-auto mb-[18px] flex h-[58px] w-[58px] items-center justify-center rounded-[18px]"
            style={{
              background: "rgba(16,185,129,.16)",
              border: "1px solid rgba(16,185,129,.3)",
              animation: "checkPop .4s ease both",
            }}
          >
            <Mail size={28} color="#6ee7b7" strokeWidth={2.4} />
          </div>
          <h2 className="m-0 mb-2 text-[22px] font-extrabold">{t("forgot.sent.title")}</h2>
          <p className="m-0 mb-[22px] text-[13.5px] leading-relaxed text-muted">
            {t("forgot.sent.bodyPrefix")}
            <span className="font-semibold text-[#c7c7d4]">{email.trim()}</span>
            {t("forgot.sent.bodySuffix")}
          </p>
          <BackToSignInButton />
          {devToken ? (
            <p className="mt-4 text-[11.5px] text-faint">
              {t("forgot.sent.devHint")}
              <a
                href={`/forgot?token=${encodeURIComponent(devToken)}`}
                className="text-accent underline underline-offset-2"
              >
                {t("forgot.sent.devOpenLink")}
              </a>
            </p>
          ) : null}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <button
        type="button"
        onClick={() => navigate("/login")}
        className="mb-5 flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} />
        {t("forgot.back")}
      </button>
      <div className="mb-6">
        <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">{t("forgot.title")}</h2>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted">
          {t("forgot.subtitle")}
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div>
          <AuthLabel htmlFor="reset-email">{t("fields.workEmail")}</AuthLabel>
          <TextInput
            id="reset-email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            icon={<Mail size={15} />}
            placeholder={t("fields.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <GradientButton busy={sending} busyLabel={t("forgot.submitting")}>
          {t("forgot.submit")}
        </GradientButton>
      </form>
    </AuthLayout>
  );
}

// ─────────────────────────────────────────── mode 3: reset completion

function ResetForm({ token }: { token: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (password.length < 8) {
      toast.error(t("reset.tooShort"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("reset.mismatch"));
      return;
    }
    setSaving(true);
    try {
      await api.auth.reset({ token, password });
      toast.success(t("reset.success"));
      navigate("/login");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("reset.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="m-0 mb-1.5 text-[26px] font-black tracking-[-0.02em]">{t("reset.title")}</h2>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted">
          {t("reset.subtitle")}
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <AuthLabel htmlFor="new-password">{t("reset.newPasswordLabel")}</AuthLabel>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            autoFocus
            required
            icon={<Lock size={15} />}
            placeholder={t("reset.newPasswordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <AuthLabel htmlFor="confirm-password">{t("reset.confirmLabel")}</AuthLabel>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            required
            icon={<Lock size={15} />}
            placeholder={t("reset.confirmPlaceholder")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <GradientButton busy={saving} busyLabel={t("reset.submitting")}>
          {t("reset.submit")}
        </GradientButton>
      </form>
    </AuthLayout>
  );
}

const CHECK_POP_KEYFRAMES = `@keyframes checkPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}`;
