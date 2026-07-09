/**
 * Admin "Claude credentials" screen (#95 re-skin). Manages the workspace's
 * *shared* Claude CLI credential (`PUT`/`DELETE /ai/credentials/shared`) that
 * members fall back to when they haven't uploaded their own (see
 * `Settings → Claude account` / `ClaudeCredentialsCard`). Gated to
 * `role === "admin"`, mirroring `UserManagement`.
 *
 * The design (`design/…/Q-Agent.dc.html`, lines 1158–1215) shows a *list* of
 * shared accounts, each with subscription/expiry/scopes/assigned-user
 * metadata and a "set as default" action. The backend only tracks one shared
 * credential slot (`hasShared`) — no concept of multiple accounts — but does
 * carry that slot's subscription/expiry/scopes/assigned-user metadata (#95).
 * This renders that one slot as a single-item list, populated from
 * `status.shared`, and drops "set as default" (meaningless with a single
 * slot) rather than inventing endpoints. Renders inside the app shell (child
 * of `RequireAuth` → `App`).
 */

import { AnimatePresence, motion } from "framer-motion";
import { Lock, MoreVertical, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Pill } from "@/components/ui/badges";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClaudeLogo, Spinner } from "@/components/ui/misc";
import {
  AccessTokenRow,
  Field,
  formatExpiry,
  readFileText,
  ScopeChips,
} from "@/components/settings/ClaudeCredentialsCard";
import {
  useClaudeCredentialsStatus,
  useDeleteSharedClaudeCredentials,
  useUploadSharedClaudeCredentials,
} from "@/hooks/queries";
import { relativeTime } from "@/screens/auth/profile/sessions";
import { useAuth } from "@/store/auth";

const MENU_WIDTH = 196;

export function ClaudeCredentials() {
  const me = useAuth((s) => s.user);
  const { data: status } = useClaudeCredentialsStatus();
  const uploadShared = useUploadSharedClaudeCredentials();
  const deleteShared = useDeleteSharedClaudeCredentials();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        left: Math.max(12, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
      });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((e.target as HTMLElement).closest?.("[data-shared-cred-menu]")) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      const contents = await readFileText(file);
      uploadShared.mutate(
        { credentials: contents },
        {
          onSuccess: () => toast.success("Shared Claude account updated"),
          onError: () => toast.error("Could not save that credentials file"),
        },
      );
    } catch {
      setFileError("Could not read that file.");
    }
  };

  // ── Admin gate ────────────────────────────────────────────────────────────
  if (me && me.role !== "admin") {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Lock size={26} className="text-[#8b8b9e]" />
        </div>
        <h1 className="m-0 mb-2 text-[22px] font-black tracking-[-0.02em]">Not authorized</h1>
        <p className="m-0 max-w-[380px] text-[13.5px] leading-relaxed text-muted">
          Claude credentials are managed by workspace administrators only. If you need access, ask
          an admin to change your role.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[940px] py-10">
      <div className="mb-[22px]">
        <div className="mb-[5px] flex items-center gap-2 text-[13px] font-medium text-muted">
          <span className="rounded-full bg-[rgba(139,92,246,.16)] px-[7px] py-[2px] text-[9px] font-bold tracking-[.06em] text-[#c4b5fd]">
            ADMIN
          </span>
          Surency workspace
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-[-0.03em]">Claude credentials</h1>
      </div>

      <div
        className="mb-6 flex gap-[14px] rounded-2xl border border-[rgba(217,119,87,.22)] p-[16px_18px]"
        style={{ background: "linear-gradient(135deg,rgba(217,119,87,.1),rgba(139,92,246,.05))" }}
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-[rgba(217,119,87,.3)] bg-[rgba(217,119,87,.16)]">
          <ClaudeLogo size={20} />
        </span>
        <p className="m-0 text-[13px] leading-[1.65] text-[#c3c3d0]">
          These are the <b className="font-bold text-[#ececf1]">shared Claude accounts</b> your
          team runs on. Upload and maintain the{" "}
          <span className="font-mono text-[12px] text-[#e0a58c]">.credentials.json</span> here —
          Q&#8209;Agent writes the token to{" "}
          <span className="font-mono text-[12px] text-[#e0a58c]">~/.claude/.credentials.json</span>{" "}
          and every member on the shared account uses it. Members can also bring their own from{" "}
          <b className="font-semibold text-[#ececf1]">Settings &#8250; Claude account</b>.
        </p>
      </div>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">
        SHARED CLAUDE ACCOUNTS
      </div>

      {status?.hasShared ? (
        <div className="mb-4 overflow-hidden rounded-[18px] border border-white/[0.07] bg-white/[0.035] p-[18px]">
          <div className="flex items-center gap-[13px]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border border-[rgba(217,119,87,.3)] bg-[rgba(217,119,87,.16)]">
              <ClaudeLogo size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[15.5px] font-extrabold tracking-[-0.01em]">
                  Shared Claude account
                </span>
                <span className="shrink-0 rounded-full bg-[rgba(139,92,246,.18)] px-2 py-[2px] text-[9.5px] font-bold tracking-[.03em] text-[#c4b5fd]">
                  DEFAULT
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[12px] text-[#8b8b9e]">
                Maintained by workspace admins
              </div>
            </div>
            <Pill color="#6ee7b7" bg="rgba(16,185,129,.14)" dot>
              Configured
            </Pill>
            <div className="relative shrink-0">
              <button
                ref={btnRef}
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Shared credential actions"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-white/[0.09] bg-white/[0.04] text-[#8b8b9e] transition-colors hover:bg-white/[0.09] hover:text-[#dcdce4]"
              >
                <MoreVertical size={16} />
              </button>
              {createPortal(
                <AnimatePresence>
                  {menuOpen && pos && (
                    <motion.div
                      data-shared-cred-menu
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                      className="fixed z-[1000] rounded-xl border border-white/[0.12] p-1.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,1)]"
                      style={{
                        top: pos.top,
                        left: pos.left,
                        width: MENU_WIDTH,
                        background: "rgba(26,26,34,.98)",
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmingRemove(true);
                        }}
                        className="flex w-full items-center gap-[9px] rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#fb7185] hover:bg-[rgba(244,63,94,.12)]"
                      >
                        <Trash2 size={14} />
                        Remove credential
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>,
                document.body,
              )}
            </div>
          </div>

          <div className="mt-[18px] grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="SUBSCRIPTION" value={status?.shared?.subscriptionType ?? "—"} />
            <Field label="EXPIRES" value={formatExpiry(status?.shared?.expiresAt)} />
            <Field label="SCOPES" value={<ScopeChips scopes={status?.shared?.scopes} />} />
            <Field
              label="LAST REFRESHED"
              value={status?.shared?.lastRefreshed ? relativeTime(status.shared.lastRefreshed) : "—"}
            />
            <Field
              label="ASSIGNED USERS"
              value={status?.shared?.assignedUsers != null ? String(status.shared.assignedUsers) : "—"}
            />
          </div>

          <AccessTokenRow accent="#c4b5fd" />

          <div className="mt-[14px] flex gap-[10px]">
            <label className="flex cursor-pointer items-center gap-2 rounded-[11px] border border-[rgba(139,92,246,.3)] bg-[rgba(139,92,246,.14)] px-[15px] py-[9px] text-[12.5px] font-semibold text-[#c4b5fd] transition-colors hover:bg-[rgba(139,92,246,.22)]">
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <UploadCloud size={14} strokeWidth={2} />
              {uploadShared.isPending ? "Uploading…" : "Rotate / replace token"}
            </label>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-[16px] border border-white/[0.07] bg-white/[0.03] p-5 text-center text-[13px] text-muted">
          No shared Claude account configured yet.
        </div>
      )}

      {!status?.hasShared && (
        <label className="flex cursor-pointer flex-col items-center gap-[9px] rounded-2xl border-[1.5px] border-dashed border-[rgba(139,92,246,.35)] bg-[rgba(139,92,246,.05)] p-[26px] text-center transition-colors hover:border-[rgba(139,92,246,.6)] hover:bg-[rgba(139,92,246,.09)]">
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {uploadShared.isPending ? (
            <>
              <Spinner size={30} />
              <div className="text-[13.5px] font-bold">Reading token…</div>
            </>
          ) : (
            <>
              <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-[rgba(139,92,246,.14)] text-[#c4b5fd]">
                <UploadCloud size={20} strokeWidth={2} />
              </span>
              <div className="text-[13.5px] font-bold">Add a shared Claude account</div>
              <div className="text-[12px] text-[#8b8b9e]">
                Upload a <span className="font-mono text-[11px]">.credentials.json</span> exported
                from an authenticated Claude CLI
              </div>
            </>
          )}
        </label>
      )}
      {fileError && <div className="mt-2 text-[12px] text-red-400">{fileError}</div>}

      <ConfirmDialog
        open={confirmingRemove}
        title="Remove the shared Claude account?"
        message="Every member relying on the shared account (anyone who hasn't uploaded their own credentials) will lose AI access until a new one is added."
        confirmLabel="Remove credential"
        danger
        loading={deleteShared.isPending}
        onConfirm={() =>
          deleteShared.mutate(undefined, {
            onSuccess: () => {
              toast.success("Removed the shared Claude account");
              setConfirmingRemove(false);
            },
            onError: () => toast.error("Failed to remove the shared credential"),
          })
        }
        onClose={() => setConfirmingRemove(false)}
      />
    </div>
  );
}
