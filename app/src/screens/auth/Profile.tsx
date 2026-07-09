import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LogOut, Sparkles } from "lucide-react";
import { useAuth } from "@/store/auth";
import { api } from "@/lib/api";
import type { AuthSession } from "@/types/api";
import { AuthLabel, TextInput } from "@/components/auth/fields";
import { Spinner } from "./profile/Modal";
import { ChangePasswordModal } from "./profile/ChangePasswordModal";
import { TwoFactorModal } from "./profile/TwoFactorModal";
import { DeleteAccountModal } from "./profile/DeleteAccountModal";
import { describeSession, relativeTime } from "./profile/sessions";

const CARD = "rounded-[20px] border border-white/[0.07] bg-white/[0.035] p-[22px]";
const STATIC_FIELD =
  "flex h-[46px] items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5";

function initials(first: string, last: string): string {
  const a = first?.trim()?.[0] ?? "";
  const b = last?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

/**
 * Account settings (ADR 0007, #77). Renders inside the app shell under the auth
 * guard. Sections: identity card, personal info, security (password + 2FA),
 * active sessions, danger zone. SSO row is intentionally omitted (deferred).
 */
export function Profile() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  // ── personal info form ──────────────────────────────────────────────────
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Resync the form when the store user changes (e.g. after a save/refresh).
  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  const [signingOut, setSigningOut] = useState(false);

  // ── modals ──────────────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [twofaOpen, setTwofaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── sessions ────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsError(false);
    try {
      setSessions(await api.auth.sessions());
    } catch {
      setSessionsError(true);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  /** Refresh the store principal from the server (after 2FA / profile change). */
  const refreshUser = useCallback(async () => {
    try {
      const fresh = await api.auth.me();
      const token = useAuth.getState().accessToken;
      if (token) useAuth.getState().setSession({ accessToken: token, user: fresh });
    } catch {
      /* non-fatal: store keeps its last-known principal */
    }
  }, []);

  if (!user) return null;

  const roleLabel = user.role === "admin" ? "Admin" : "Member";

  const dirty = firstName !== user.firstName || lastName !== user.lastName;
  const canSave = dirty && firstName.trim().length > 0 && lastName.trim().length > 0 && !savingProfile;

  const saveProfile = async () => {
    if (!canSave) return;
    setSavingProfile(true);
    try {
      const updated = await api.auth.updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      const token = useAuth.getState().accessToken;
      if (token) useAuth.getState().setSession({ accessToken: token, user: updated });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save changes");
    } finally {
      setSavingProfile(false);
    }
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.auth.logout();
    } catch {
      /* best-effort server logout; clear locally regardless */
    }
    useAuth.getState().logout();
    navigate("/signed-out");
  };

  const revokeOne = async (id: string) => {
    setRevokingId(id);
    try {
      await api.auth.revokeSession(id);
      toast.success("Session revoked");
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke session");
    } finally {
      setRevokingId(null);
    }
  };

  const revokeOthers = async () => {
    setRevokingAll(true);
    try {
      await api.auth.revokeOthers();
      toast.success("Signed out of all other sessions");
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke sessions");
    } finally {
      setRevokingAll(false);
    }
  };

  const hasOthers = (sessions ?? []).some((s) => !s.current);

  return (
    <div className="mx-auto max-w-[720px] px-6 pb-16 pt-10">
      {/* header */}
      <div className="mb-[26px] flex items-center gap-3">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(135deg,#8b5cf6,#6366f1)]">
          <Sparkles size={19} className="text-white" />
        </div>
        <div>
          <div className="text-[13px] font-medium text-muted">Account settings</div>
          <h1 className="m-0 text-[26px] font-black tracking-[-0.03em] text-ink">Your profile</h1>
        </div>
      </div>

      {/* identity card */}
      <div className={`${CARD} mb-4 flex items-center gap-[18px]`}>
        <div
          className="flex h-[66px] w-[66px] shrink-0 items-center justify-center rounded-[20px] text-[24px] font-extrabold text-white"
          style={{ background: "linear-gradient(135deg,#f59e0b,#f43f5e)" }}
          aria-hidden
        >
          {initials(user.firstName, user.lastName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-extrabold tracking-[-0.01em] text-ink">
            {user.firstName} {user.lastName}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-muted">{user.email}</div>
          <div className="mt-[9px] inline-flex items-center gap-1.5 rounded-full bg-[rgba(139,92,246,.16)] px-2.5 py-1 text-[11px] font-bold text-[#c4b5fd]">
            {roleLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="flex min-w-[118px] shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-white/10 bg-white/[0.05] px-[15px] py-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-[rgba(244,63,94,.3)] hover:bg-[rgba(244,63,94,.14)] hover:text-danger-soft disabled:opacity-60"
        >
          {signingOut ? (
            <>
              <Spinner className="border-t-danger-soft" />
              Signing out…
            </>
          ) : (
            <>
              <LogOut size={15} />
              Sign out
            </>
          )}
        </button>
      </div>

      {/* personal information */}
      <div className={`${CARD} mb-4`}>
        <div className="mb-4 text-[15px] font-bold text-ink">Personal information</div>
        <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <AuthLabel htmlFor="pf-first">First name</AuthLabel>
            <TextInput
              id="pf-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
          </div>
          <div>
            <AuthLabel htmlFor="pf-last">Last name</AuthLabel>
            <TextInput
              id="pf-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
          <div>
            <AuthLabel>Email</AuthLabel>
            <div className={STATIC_FIELD}>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
                {user.email}
              </span>
              <span className="shrink-0 text-[10px] text-faint">managed by admin</span>
            </div>
          </div>
          <div>
            <AuthLabel>Role</AuthLabel>
            <div className={STATIC_FIELD}>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{roleLabel}</span>
              <span className="shrink-0 text-[10px] text-faint">managed by admin</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={saveProfile}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-[11px] border-none bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] px-[18px] py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {savingProfile ? <Spinner /> : null}
            {savingProfile ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* security */}
      <div className={`${CARD} mb-4`}>
        <div className="mb-4 text-[15px] font-bold text-ink">Security</div>

        {/* password */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3.5">
          <div>
            <div className="text-[13.5px] font-semibold text-ink">Password</div>
            <div className="text-[12px] text-muted">Change the password you use to sign in</div>
          </div>
          <button
            type="button"
            onClick={() => setPwOpen(true)}
            className="shrink-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-white/10"
          >
            Change
          </button>
        </div>

        {/* two-factor */}
        <div className="flex items-center justify-between gap-4 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-ink">
                Two-factor authentication
              </span>
              <span
                className={
                  user.totpEnabled
                    ? "rounded-full bg-[rgba(16,185,129,.14)] px-2 py-0.5 text-[10px] font-bold text-success-soft"
                    : "rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-muted"
                }
              >
                {user.totpEnabled ? "On" : "Off"}
              </span>
            </div>
            <div className="text-[12px] text-muted">
              {user.totpEnabled
                ? "Authenticator app · enabled"
                : "Protect your account with an authenticator app"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {!user.totpEnabled ? (
              <button
                type="button"
                onClick={() => setTwofaOpen(true)}
                className="rounded-[10px] border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-white/10"
              >
                Set up
              </button>
            ) : null}
            <button
              type="button"
              role="switch"
              aria-checked={user.totpEnabled}
              aria-label="Toggle two-factor authentication"
              onClick={() => setTwofaOpen(true)}
              className="relative h-6 w-[42px] shrink-0 rounded-full transition-colors"
              style={{
                background: user.totpEnabled
                  ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                  : "rgba(255,255,255,.12)",
              }}
            >
              <span
                className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left]"
                style={{ left: user.totpEnabled ? 21 : 3 }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* active sessions */}
      <div className={`${CARD} mb-4`}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex-1 text-[15px] font-bold text-ink">Active sessions</span>
          {hasOthers ? (
            <button
              type="button"
              onClick={revokeOthers}
              disabled={revokingAll}
              className="text-[12.5px] font-semibold text-danger-soft transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {revokingAll ? "Revoking…" : "Revoke all others"}
            </button>
          ) : null}
        </div>

        {sessions === null && !sessionsError ? (
          <div className="flex items-center gap-2.5 py-2 text-[13px] text-muted">
            <Spinner />
            Loading sessions…
          </div>
        ) : sessionsError ? (
          <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
            <span>Couldn't load sessions.</span>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="text-[12.5px] font-semibold text-violet hover:opacity-80"
            >
              Retry
            </button>
          </div>
        ) : sessions && sessions.length === 0 ? (
          <div className="py-2 text-[13px] text-muted">No active sessions.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {sessions?.map((s) => {
              const { label, Icon } = describeSession(s.userAgent);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3.5 rounded-[13px] border border-white/[0.06] bg-white/[0.03] p-3"
                >
                  <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05] text-ink-dim">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{label}</div>
                    <div className="truncate text-[11.5px] text-faint">
                      {s.ip} · {relativeTime(s.lastSeenAt)}
                    </div>
                  </div>
                  {s.current ? (
                    <span className="shrink-0 rounded-full bg-[rgba(16,185,129,.14)] px-2.5 py-[3px] text-[10.5px] font-bold text-success-soft">
                      This device
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revokeOne(s.id)}
                      disabled={revokingId === s.id}
                      className="shrink-0 text-[11.5px] font-semibold text-muted transition-colors hover:text-danger-soft disabled:opacity-50"
                    >
                      {revokingId === s.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* danger zone */}
      <div className="flex items-center gap-4 rounded-[20px] border border-[rgba(244,63,94,.2)] bg-[rgba(244,63,94,.05)] px-[22px] py-[18px]">
        <div className="flex-1">
          <div className="text-[14px] font-bold text-danger-soft">Delete account</div>
          <div className="mt-0.5 text-[12px] text-[#a6a6b6]">
            Permanently remove your account, runs, and evidence. This cannot be undone.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="shrink-0 rounded-[11px] border border-[rgba(244,63,94,.32)] bg-[rgba(244,63,94,.14)] px-4 py-2.5 text-[12.5px] font-bold text-danger-soft transition-colors hover:bg-[rgba(244,63,94,.22)]"
        >
          Delete
        </button>
      </div>

      {/* modals */}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <TwoFactorModal
        open={twofaOpen}
        mode={user.totpEnabled ? "disable" : "setup"}
        onClose={() => setTwofaOpen(false)}
        onChanged={() => void refreshUser()}
      />
      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          useAuth.getState().logout();
          navigate("/login");
        }}
      />
    </div>
  );
}
