import { useState } from "react";
import { toast } from "@/lib/toast";
import { AuthLabel, PasswordInput } from "@/components/auth/fields";
import { api } from "@/lib/api";
import { Modal, Spinner } from "./Modal";

/** Change-password modal: current / new / confirm → `api.auth.changePassword`. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      toast.success("Password changed");
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change password");
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Change password"
      subtitle="Enter your current password, then choose a new one (at least 8 characters)."
      onClose={close}
      locked={saving}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <AuthLabel htmlFor="cp-current">Current password</AuthLabel>
          <PasswordInput
            id="cp-current"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
          />
        </div>
        <div>
          <AuthLabel htmlFor="cp-new">New password</AuthLabel>
          <PasswordInput
            id="cp-new"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 8 characters"
          />
          {tooShort ? (
            <p className="mt-1.5 text-[11.5px] text-danger-soft">
              Use at least 8 characters.
            </p>
          ) : null}
        </div>
        <div>
          <AuthLabel htmlFor="cp-confirm">Confirm new password</AuthLabel>
          <PasswordInput
            id="cp-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter new password"
          />
          {mismatch ? (
            <p className="mt-1.5 text-[11.5px] text-danger-soft">Passwords don't match.</p>
          ) : null}
        </div>
        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-[11px] border-none bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] px-[18px] py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Spinner /> : null}
            {saving ? "Saving…" : "Update password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
