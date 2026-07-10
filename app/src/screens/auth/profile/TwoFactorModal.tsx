import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { AuthLabel, TextInput } from "@/components/auth/fields";
import { api } from "@/lib/api";
import type { TwoFactorSetup } from "@/types/api";
import { Modal, Spinner } from "./Modal";

/** Copyable inline value (secret / otpauth URI). */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };
  return (
    <div>
      <AuthLabel>{label}</AuthLabel>
      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#16161f] p-2.5 pl-3.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-ink">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-white/10"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * Two-factor modal. `mode="setup"` fetches enrollment material (secret +
 * otpauth URI) and enables after a valid code; `mode="disable"` prompts for a
 * code to turn TOTP off. Calls `onChanged` after a successful enable/disable so
 * the parent can refresh the user.
 */
export function TwoFactorModal({
  open,
  mode,
  onClose,
  onChanged,
}: {
  open: boolean;
  mode: "setup" | "disable";
  onClose: () => void;
  onChanged: () => void;
}) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Fetch enrollment material when the setup modal opens.
  useEffect(() => {
    if (!open || mode !== "setup") return;
    let cancelled = false;
    setLoadingSetup(true);
    setSetup(null);
    api.auth
      .twofaSetup()
      .then((res) => {
        if (!cancelled) setSetup(res);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Couldn't start 2FA setup");
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, onClose]);

  const close = () => {
    if (busy) return;
    setCode("");
    setSetup(null);
    onClose();
  };

  const codeValid = /^\d{6}$/.test(code);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeValid || busy) return;
    setBusy(true);
    try {
      if (mode === "setup") {
        await api.auth.twofaEnable({ code });
        toast.success("Two-factor authentication enabled");
      } else {
        await api.auth.twofaDisable({ code });
        toast.success("Two-factor authentication disabled");
      }
      setCode("");
      setSetup(null);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
      setBusy(false);
    }
  };

  const isSetup = mode === "setup";

  return (
    <Modal
      open={open}
      title={isSetup ? "Set up two-factor authentication" : "Disable two-factor authentication"}
      subtitle={
        isSetup
          ? "Scan the QR code with your authenticator app, then enter the 6-digit code it generates."
          : "Enter the current 6-digit code from your authenticator app to turn off 2FA."
      }
      onClose={close}
      locked={busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {isSetup ? (
          loadingSetup || !setup ? (
            <div className="flex items-center gap-2.5 py-6 text-[13px] text-muted">
              <Spinner />
              Preparing setup…
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl bg-white p-3">
                  <QRCodeSVG value={setup.otpauthUri} size={168} marginSize={0} level="M" />
                </div>
                <p className="text-center text-[12px] text-muted">
                  Can't scan it? Enter this key manually in your app.
                </p>
              </div>
              <CopyRow label="Secret key" value={setup.secret} />
            </>
          )
        ) : null}

        <div>
          <AuthLabel htmlFor="tfa-code">6-digit code</AuthLabel>
          <TextInput
            id="tfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="tracking-[0.35em]"
            disabled={isSetup && (loadingSetup || !setup)}
          />
        </div>

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!codeValid || busy || (isSetup && !setup)}
            className={
              isSetup
                ? "inline-flex items-center gap-2 rounded-[11px] border-none bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] px-[18px] py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
                : "inline-flex items-center gap-2 rounded-[11px] border border-[rgba(244,63,94,.32)] bg-[rgba(244,63,94,.14)] px-[18px] py-2.5 text-[13px] font-bold text-danger-soft transition-colors hover:bg-[rgba(244,63,94,.22)] disabled:opacity-50"
            }
          >
            {busy ? <Spinner /> : null}
            {busy ? "Working…" : isSetup ? "Enable" : "Disable 2FA"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
