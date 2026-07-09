/**
 * Admin user management (#75). Lists the workspace's users and lets an admin
 * create new ones, flip their role (admin ↔ member), activate/deactivate, and
 * delete them — all via `api.auth.*` (ADR 0007). Gated to `role === "admin"`;
 * everyone else gets a "Not authorized" panel. Premium dark styling ported from
 * the auth design source, reusing the shared auth field kit for the create form.
 *
 * Renders inside the app shell (child of `RequireAuth` → `App`).
 */

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Check,
  Lock,
  Mail,
  Power,
  Shield,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthLabel, PasswordInput, TextInput } from "@/components/auth/fields";
import { Button } from "@/components/ui/Button";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAuth } from "@/store/auth";
import type { User, UserRole } from "@/types/api";

/** Local (screen-scoped) query key — the shared `queryKeys` module is off-limits
 * to this slice, so we key the admin user list inline. */
const USERS_KEY = ["auth", "users"] as const;

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

const initials = (u: User) =>
  `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase() ||
  u.email[0]?.toUpperCase() ||
  "?";

export function UserManagement() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => api.auth.users(),
    enabled: me?.role === "admin",
  });

  const refresh = () => qc.invalidateQueries({ queryKey: USERS_KEY });

  // Row mutations share a single in-flight lock so a row's buttons disable while
  // any action against it runs. We track the affected user id for feedback.
  const [busyId, setBusyId] = useState<number | null>(null);

  const updateMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: Partial<{ firstName: string; lastName: string; role: UserRole; isActive: boolean }>;
    }) => api.auth.updateUser(id, body),
    onMutate: (v) => setBusyId(v.id),
    onSuccess: (u) => {
      toast.success(`Updated ${u.firstName} ${u.lastName}`.trim());
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Failed to update user")),
    onSettled: () => setBusyId(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.auth.deleteUser(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => {
      toast.success("User deleted");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, "Failed to delete user")),
    onSettled: () => setBusyId(null),
  });

  // ── Admin gate ────────────────────────────────────────────────────────────
  if (me && me.role !== "admin") {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Lock size={26} className="text-[#8b8b9e]" />
        </div>
        <h1 className="m-0 mb-2 text-[22px] font-black tracking-[-0.02em]">Not authorized</h1>
        <p className="m-0 max-w-[380px] text-[13.5px] leading-relaxed text-muted">
          User management is available to workspace administrators only. If you need access, ask an
          admin to change your role.
        </p>
      </div>
    );
  }

  const users = usersQuery.data ?? [];

  const handleDelete = (u: User) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${u.firstName} ${u.lastName} (${u.email})? This cannot be undone.`)
    ) {
      return;
    }
    deleteMut.mutate(u.id);
  };

  return (
    <div className="mx-auto max-w-[920px] py-10">
      {/* Header */}
      <div className="mb-7 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="accent-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] shadow-[0_8px_22px_-8px_rgba(139,92,246,.8)]">
            <Users size={22} color="#fff" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="m-0 text-[26px] font-black tracking-[-0.03em]">User management</h1>
            <p className="m-0 text-[13px] text-muted">
              {usersQuery.isLoading
                ? "Loading users…"
                : `${users.length} ${users.length === 1 ? "user" : "users"} in your workspace`}
            </p>
          </div>
        </div>
        <Button variant="primary" size="lg" onClick={() => setCreateOpen(true)}>
          <UserPlus size={16} strokeWidth={2.4} />
          New user
        </Button>
      </div>

      {/* States */}
      {usersQuery.isError ? (
        <div className="rounded-2xl border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.08)] p-6 text-[13.5px] text-[#fb7185]">
          {errMsg(usersQuery.error, "Failed to load users")}
        </div>
      ) : usersQuery.isLoading ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[74px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]"
            />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-panel/60 p-10 text-center text-[13.5px] text-muted">
          No users yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {users.map((u) => {
            const isMe = me?.id === u.id;
            const busy = busyId === u.id;
            return (
              <div
                key={u.id}
                className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-[#16161f] p-[16px_18px] transition-colors hover:border-white/[0.14]"
              >
                {/* Avatar */}
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white",
                    u.isActive ? "accent-gradient" : "bg-white/10 text-[#8b8b9e]",
                  )}
                >
                  {initials(u)}
                </div>

                {/* Identity */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold">
                      {`${u.firstName} ${u.lastName}`.trim() || u.email}
                    </span>
                    {isMe && (
                      <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-muted">
                        You
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12.5px] text-muted">{u.email}</div>
                </div>

                {/* Role badge */}
                <RoleBadge role={u.role} />

                {/* Status badge */}
                <StatusBadge active={u.isActive} />

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <IconAction
                    title={u.role === "admin" ? "Change to Member" : "Make Admin"}
                    disabled={busy || isMe}
                    onClick={() =>
                      updateMut.mutate({
                        id: u.id,
                        body: { role: u.role === "admin" ? "member" : "admin" },
                      })
                    }
                  >
                    {u.role === "admin" ? <Shield size={15} /> : <ShieldCheck size={15} />}
                  </IconAction>
                  <IconAction
                    title={u.isActive ? "Deactivate" : "Activate"}
                    disabled={busy || isMe}
                    onClick={() => updateMut.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                  >
                    <Power size={15} className={u.isActive ? "text-[#6ee7b7]" : ""} />
                  </IconAction>
                  <IconAction
                    title="Delete user"
                    danger
                    disabled={busy || isMe}
                    onClick={() => handleDelete(u)}
                  >
                    <Trash2 size={15} />
                  </IconAction>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const admin = role === "admin";
  return (
    <span
      className={cn(
        "hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
        admin
          ? "bg-[rgba(139,92,246,.16)] text-violet"
          : "bg-white/[0.06] text-ink-dim",
      )}
    >
      {admin ? <ShieldCheck size={12} /> : <UserIcon size={12} />}
      {admin ? "Admin" : "Member"}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
        active
          ? "bg-[rgba(16,185,129,.14)] text-[#6ee7b7]"
          : "bg-white/[0.05] text-[#8b8b9e]",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: active ? "#22c55e" : "#8b8b9e" }}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function IconAction({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.04] text-ink-dim transition-colors",
        "hover:bg-white/[0.1] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30",
        danger && "hover:border-[rgba(244,63,94,.3)] hover:bg-[rgba(244,63,94,.14)] hover:text-[#fb7185]",
      )}
    >
      {children}
    </button>
  );
}

/** Create-user modal — the sign-up-style form (first/last name, work email,
 * organization, role, initial password). Portalled to `document.body` with
 * fixed positioning per the project overlay rule. `organization` is captured
 * for parity with the design but not sent (backend takes no org field). */
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [password, setPassword] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      api.auth.createUser({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        password: password ? password : undefined,
      }),
    onSuccess: (u) => {
      toast.success(`Created ${u.firstName} ${u.lastName}`.trim());
      onCreated();
    },
    onError: (e) => toast.error(errMsg(e, "Failed to create user")),
  });

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /.+@.+\..+/.test(email.trim()) &&
    !createMut.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createMut.mutate();
  };

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-5"
      style={{ background: "rgba(6,6,10,.62)", backdropFilter: "blur(7px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(460px,94vw)] overflow-hidden rounded-[22px] border border-white/[0.11] bg-[#16161f]"
        style={{
          boxShadow: "0 40px 90px -20px rgba(0,0,0,.8)",
          animation: "scaleIn .22s ease both",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.07] p-[18px_22px]">
          <div className="accent-gradient flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px]">
            <UserPlus size={17} color="#fff" strokeWidth={2.4} />
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-extrabold">Create user</div>
            <div className="text-[12px] text-ink-dim">Add a teammate to your workspace</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-white/[0.08] hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="p-[20px_22px]">
          <div className="mb-3.5 grid grid-cols-2 gap-3">
            <div>
              <AuthLabel htmlFor="cu-first">First name</AuthLabel>
              <TextInput
                id="cu-first"
                icon={<UserIcon size={15} />}
                placeholder="Ada"
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <AuthLabel htmlFor="cu-last">Last name</AuthLabel>
              <TextInput
                id="cu-last"
                icon={<UserIcon size={15} />}
                placeholder="Lovelace"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-3.5">
            <AuthLabel htmlFor="cu-email">Work email</AuthLabel>
            <TextInput
              id="cu-email"
              type="email"
              icon={<Mail size={15} />}
              placeholder="ada@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mb-3.5">
            <AuthLabel htmlFor="cu-org">Organization</AuthLabel>
            <TextInput
              id="cu-org"
              icon={<Building2 size={15} />}
              placeholder="Company name"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </div>

          <div className="mb-3.5">
            <AuthLabel>Role</AuthLabel>
            <div className="flex gap-2">
              {(["member", "admin"] as const).map((r) => {
                const on = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-[11px] text-[13px] font-semibold transition-colors",
                      on
                        ? "border-accent/40 bg-[rgba(139,92,246,.14)] text-white"
                        : "border-white/10 bg-white/[0.04] text-ink-dim hover:bg-white/[0.08]",
                    )}
                  >
                    {r === "admin" ? <ShieldCheck size={15} /> : <UserIcon size={15} />}
                    {r === "admin" ? "Admin" : "Member"}
                    {on && <Check size={14} className="text-violet" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-1">
            <AuthLabel htmlFor="cu-pass">Initial password</AuthLabel>
            <PasswordInput
              id="cu-pass"
              placeholder="Set a temporary password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mb-0 mt-2 text-[11.5px] text-faint">
              Leave blank to let the user set their own password later.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <Button type="button" variant="glass" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {createMut.isPending ? "Creating…" : "Create user"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
