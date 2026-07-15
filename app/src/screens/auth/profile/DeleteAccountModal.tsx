import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { AuthLabel, TextInput } from "@/components/auth/fields";
import { api } from "@/lib/api";
import { Modal, Spinner } from "./Modal";

const CONFIRM_WORD = "DELETE";

/**
 * Type-to-confirm account deletion. On success the caller clears the auth store
 * and navigates to /login (passed via `onDeleted`).
 */
export function DeleteAccountModal({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("auth");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setText("");
    onClose();
  };

  const canDelete = text.trim().toUpperCase() === CONFIRM_WORD && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDelete) return;
    setBusy(true);
    try {
      await api.auth.deleteMe();
      toast.success(t("deleteAccount.success"));
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteAccount.error"));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("deleteAccount.title")}
      subtitle={t("deleteAccount.subtitle")}
      onClose={close}
      locked={busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <AuthLabel htmlFor="del-confirm">
            {t("deleteAccount.confirmPrefix")}
            <span className="font-bold text-danger-soft">{CONFIRM_WORD}</span>
            {t("deleteAccount.confirmSuffix")}
          </AuthLabel>
          <TextInput
            id="del-confirm"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={CONFIRM_WORD}
          />
        </div>
        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {t("deleteAccount.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canDelete}
            className="inline-flex items-center gap-2 rounded-[11px] border border-[rgba(244,63,94,.32)] bg-[rgba(244,63,94,.14)] px-[18px] py-2.5 text-[13px] font-bold text-danger-soft transition-colors hover:bg-[rgba(244,63,94,.22)] disabled:opacity-50"
          >
            {busy ? <Spinner /> : null}
            {busy ? t("deleteAccount.submitting") : t("deleteAccount.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
