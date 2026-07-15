import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { AuthLabel, PasswordInput } from "@/components/auth/fields";
import { api } from "@/lib/api";
import { Modal, Spinner } from "./Modal";

/** Change-password modal: current / new / confirm → `api.auth.changePassword`. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("auth");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setSaving(false);
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.auth.changePassword({ currentPassword: current, newPassword: next });
      toast.success(t("changePassword.success"));
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("changePassword.error"));
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("changePassword.title")}
      subtitle={t("changePassword.subtitle")}
      onClose={close}
      locked={saving}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <AuthLabel htmlFor="cp-current">{t("changePassword.currentLabel")}</AuthLabel>
          <PasswordInput
            id="cp-current"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder={t("changePassword.currentPlaceholder")}
          />
        </div>
        <div>
          <AuthLabel htmlFor="cp-new">{t("changePassword.newLabel")}</AuthLabel>
          <PasswordInput
            id="cp-new"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={t("changePassword.newPlaceholder")}
          />
          {tooShort ? (
            <p className="mt-1.5 text-[11.5px] text-danger-soft">
              {t("changePassword.tooShort")}
            </p>
          ) : null}
        </div>
        <div>
          <AuthLabel htmlFor="cp-confirm">{t("changePassword.confirmLabel")}</AuthLabel>
          <PasswordInput
            id="cp-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("changePassword.confirmPlaceholder")}
          />
          {mismatch ? (
            <p className="mt-1.5 text-[11.5px] text-danger-soft">{t("changePassword.mismatch")}</p>
          ) : null}
        </div>
        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {t("changePassword.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-[11px] border-none bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] px-[18px] py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Spinner /> : null}
            {saving ? t("changePassword.submitting") : t("changePassword.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
