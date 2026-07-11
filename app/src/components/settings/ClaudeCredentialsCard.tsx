import { Check, File, KeyRound, Lock, ShieldCheck, Trash2, UploadCloud, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/lib/toast";
import { Pill } from "@/components/ui/badges";
import { ClaudeLogo, Spinner } from "@/components/ui/misc";
import {
  useClaudeCredentialsStatus,
  useDeleteOwnClaudeCredentials,
  useTestClaudeCredentials,
  useUploadOwnClaudeCredentials,
} from "@/hooks/queries";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/screens/auth/profile/sessions";
import type { ClaudeCredentialsMeta } from "@/types/api";

/** "in N days"/"in N hours" for a future ISO timestamp; "Expired" once past;
 * "—" if absent. Exported so the admin shared-account card can reuse it. */
export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = then - Date.now();
  if (diffMs <= 0) return "Expired";
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** True when a credential's metadata indicates the token is no longer usable: a
 * real call flagged it "expired", or its expiry is already past. Shared with the
 * top-bar AI-stats indicator so both surfaces agree. */
export function isCredentialExpired(meta: ClaudeCredentialsMeta | null | undefined): boolean {
  if (!meta) return false;
  if (meta.status === "expired") return true;
  if (meta.expiresAt) {
    const t = new Date(meta.expiresAt).getTime();
    if (!Number.isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

/** Active/Expired chip driven by the credential's real status. */
function StatusPill({ meta }: { meta: ClaudeCredentialsMeta | null | undefined }) {
  return isCredentialExpired(meta) ? (
    <Pill color="#fbbf24" bg="rgba(251,191,36,.14)" dot>
      Expired
    </Pill>
  ) : (
    <Pill color="#6ee7b7" bg="rgba(16,185,129,.14)" dot>
      Active
    </Pill>
  );
}

/** "Test credential" button — runs a real minimal Claude call under the
 * effective credential and toasts the outcome. */
function TestCredentialButton() {
  const test = useTestClaudeCredentials();
  return (
    <button
      type="button"
      onClick={() =>
        test.mutate(undefined, {
          onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
          onError: (e) => toast.error((e as Error).message || "Test failed"),
        })
      }
      disabled={test.isPending}
      className="flex items-center gap-2 rounded-[11px] border border-white/[0.1] bg-white/[0.05] px-[15px] py-[9px] text-[12.5px] font-semibold text-[#dcdce4] transition-colors hover:bg-white/[0.1] disabled:opacity-50"
    >
      {test.isPending ? <Spinner size={14} /> : <ShieldCheck size={14} strokeWidth={2} />}
      {test.isPending ? "Testing…" : "Test credential"}
    </button>
  );
}

/** A file-picker `<label>` that also accepts drag-and-drop of a single file
 * (#95 item 4) — used by every credential upload/replace control that isn't
 * the big empty-state `UploadDropzone` below (which already had this).
 * Applies `dragClassName` on top of the caller's `className` while a file is
 * being dragged over it. Exported for reuse on the admin shared-account
 * screen's "Rotate / replace token" and "Add a shared Claude account"
 * controls. */
export function FileDropLabel({
  onFile,
  className,
  dragClassName,
  children,
}: {
  onFile: (file: File | undefined) => void;
  className: string;
  dragClassName: string;
  children: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      className={cn(className, dragOver && dragClassName)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {children}
    </label>
  );
}

/** Small pill chips for a credential's OAuth scopes; "—" if none. Exported for
 * reuse on the admin shared-account card. */
export function ScopeChips({ scopes }: { scopes: string[] | null | undefined }) {
  if (!scopes || scopes.length === 0) return <span className="text-[13px] font-semibold">&#8212;</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <span
          key={s}
          className="rounded-full bg-white/[0.06] px-2 py-[2px] text-[10.5px] font-semibold text-[#c3c3d0]"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

/** Reads a dropped/selected file's text contents (used for `.credentials.json`
 * uploads). Exported so the admin Claude-credentials screen can reuse it for
 * the shared-account upload. */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Labelled stat cell (e.g. "SUBSCRIPTION" → "—") used across the credential
 * detail grids. Exported for reuse on the admin shared-account card. */
export function Field({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="mb-[5px] text-[10.5px] font-bold tracking-[0.05em] text-[#6c6c7e]">{label}</div>
      <div className={cn("text-[13px] font-semibold", valueClassName)}>{value}</div>
    </div>
  );
}

/** Masked "ACCESS TOKEN" row shared by the personal and admin shared
 * credential cards. `GET /ai/credentials` never returns the token itself (by
 * design, for security), so "reveal" only toggles a fixed mask for an
 * explicit disclosure message — it never displays a real secret. */
export function AccessTokenRow({ accent = "#67e8f9" }: { accent?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="mt-[14px]">
      <div className="mb-[7px] text-[10.5px] font-bold tracking-[0.05em] text-[#6c6c7e]">
        ACCESS TOKEN
      </div>
      <div className="flex items-center gap-[10px] rounded-[11px] border border-white/[0.08] bg-[rgba(8,8,13,.6)] px-[13px] py-[10px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#c3c3d0]">
          {revealed
            ? "Not exposed by the API — the server never returns credential contents."
            : "•".repeat(28)}
        </span>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="shrink-0 font-mono text-[11.5px] font-semibold"
          style={{ color: accent }}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function SourceCard({
  active,
  icon,
  iconBg,
  iconColor,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  description: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-[14px] border p-[14px] text-left transition-colors",
        active
          ? "border-[rgba(139,92,246,.4)] bg-[rgba(139,92,246,.08)]"
          : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16]",
      )}
    >
      <div className="mb-2 flex items-center gap-[9px]">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </span>
        <span className="flex-1 text-[14.5px] font-extrabold tracking-[-0.01em]">{title}</span>
        {active && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
          >
            <Check size={12} strokeWidth={3.2} color="#fff" />
          </span>
        )}
      </div>
      <div className="text-[12px] leading-[1.5] text-[#9a9aae]">{description}</div>
    </button>
  );
}

/** Read-only summary of the workspace's shared Claude account, backed by
 * `status.shared` (#95) — subscription/expiry/scopes from the uploaded
 * `.credentials.json`; "—" only when that field is genuinely absent. */
function SharedAccountCard({ meta }: { meta: ClaudeCredentialsMeta | null | undefined }) {
  return (
    <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[rgba(217,119,87,.3)] bg-[rgba(217,119,87,.16)]">
          <ClaudeLogo size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">
            {meta?.accountEmail ?? "Shared Claude account"}
          </div>
          <div className="truncate font-mono text-[12px] text-[#8b8b9e]">
            {meta?.accountOrg ?? "Maintained by your workspace admin"}
          </div>
        </div>
        <StatusPill meta={meta} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="SUBSCRIPTION" value={meta?.subscriptionType ?? "—"} />
        <Field label="TOKEN EXPIRES" value={formatExpiry(meta?.expiresAt)} />
        <Field label="SCOPES" value={<ScopeChips scopes={meta?.scopes} />} />
        <Field label="MAINTAINED BY" value="Workspace admin" valueClassName="text-[#c4b5fd]" />
      </div>
      <div className="mt-4 flex flex-wrap gap-[10px] border-t border-white/[0.06] pt-[14px]">
        <TestCredentialButton />
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11.5px] text-[#7a7a8c]">
        <Lock size={13} strokeWidth={2} className="shrink-0" />
        <span>
          The admin rotates and maintains this token. Switch to{" "}
          <b className="font-semibold text-[#a6a6b6]">Your own account</b> to use a personal plan
          instead.
        </span>
      </div>
    </div>
  );
}

function PersonalAccountCard({
  meta,
  uploading,
  onReplace,
  onRemove,
  removing,
}: {
  meta: ClaudeCredentialsMeta | null | undefined;
  uploading: boolean;
  onReplace: (file: File | undefined) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <div className="rounded-[16px] border border-[rgba(34,211,238,.22)] bg-white/[0.03] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[rgba(34,211,238,.3)] bg-[rgba(34,211,238,.14)] text-[#67e8f9]">
          <File size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13.5px] font-bold">
            {meta?.accountEmail ?? ".credentials.json"}
          </div>
          <div className="truncate text-[11.5px] text-[#8b8b9e]">
            {meta?.accountOrg ?? "Your personal Claude account"}
          </div>
        </div>
        <StatusPill meta={meta} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="SUBSCRIPTION" value={meta?.subscriptionType ?? "—"} />
        <Field label="TOKEN EXPIRES" value={formatExpiry(meta?.expiresAt)} />
        <Field label="SCOPES" value={<ScopeChips scopes={meta?.scopes} />} />
        <Field
          label="LAST REFRESHED"
          value={meta?.lastRefreshed ? relativeTime(meta.lastRefreshed) : "—"}
        />
      </div>
      <AccessTokenRow />
      <div className="mt-4 flex flex-wrap gap-[10px] border-t border-white/[0.06] pt-[14px]">
        <TestCredentialButton />
        <FileDropLabel
          onFile={onReplace}
          className="flex cursor-pointer items-center gap-2 rounded-[11px] border border-white/[0.1] bg-white/[0.05] px-[15px] py-[9px] text-[12.5px] font-semibold text-[#dcdce4] transition-colors hover:bg-white/[0.1]"
          dragClassName="border-[rgba(34,211,238,.5)] bg-[rgba(34,211,238,.1)]"
        >
          <UploadCloud size={14} strokeWidth={2} />
          {uploading ? "Uploading…" : "Replace file"}
        </FileDropLabel>
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="flex items-center gap-2 rounded-[11px] border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.1)] px-[15px] py-[9px] text-[12.5px] font-semibold text-[#fb7185] transition-colors hover:bg-[rgba(244,63,94,.18)] disabled:opacity-50"
        >
          <Trash2 size={14} strokeWidth={2} />
          {removing ? "Removing…" : "Remove & use shared"}
        </button>
      </div>
    </div>
  );
}

function UploadDropzone({
  uploading,
  onFile,
  error,
}: {
  uploading: boolean;
  onFile: (file: File | undefined) => void;
  error: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-[9px] rounded-[16px] border-[1.5px] border-dashed p-[30px] text-center transition-colors",
          dragOver
            ? "border-[rgba(139,92,246,.6)] bg-[rgba(139,92,246,.09)]"
            : "border-[rgba(139,92,246,.35)] bg-[rgba(139,92,246,.05)]",
        )}
      >
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {uploading ? (
          <>
            <Spinner size={32} />
            <div className="text-[13.5px] font-bold">Reading token…</div>
            <div className="text-[11.5px] text-[#8b8b9e]">Parsing your .credentials.json</div>
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-[rgba(139,92,246,.14)] text-[#c4b5fd]">
              <UploadCloud size={22} strokeWidth={2} />
            </span>
            <div className="text-[14px] font-bold">
              Drop your <span className="font-mono text-[12.5px]">.credentials.json</span>
            </div>
            <div className="text-[12px] text-[#8b8b9e]">
              or click to browse · found at{" "}
              <span className="font-mono text-[11px] text-[#a6a6b6]">~/.claude/.credentials.json</span>
            </div>
          </>
        )}
      </label>
      {error && <div className="mt-2 text-[12px] text-red-400">{error}</div>}
    </div>
  );
}

/** Claude CLI account management (#95, re-skinned per `design/…/Q-Agent.dc.html`
 * lines 1031–1098): a two-way chooser between the workspace's shared account
 * (admin-maintained, read-only here — see the dedicated admin screen) and the
 * signed-in user's own uploaded credential. Reuses the existing #95
 * upload/delete-own hooks; no backend changes.
 *
 * The chooser is view-only (which panel to show), not a stored preference —
 * the backend has no such field, and "own beats shared" is unconditional. It
 * defaults to whichever source is actually effective (`status.mode`), but can
 * be pinned via a `?claudeSource=shared|personal` query param so the AI
 * status popover's Shared/Personal shortcuts land on the right panel. */
export function ClaudeCredentialsCard() {
  const { data: status } = useClaudeCredentialsStatus();
  const uploadOwn = useUploadOwnClaudeCredentials();
  const deleteOwn = useDeleteOwnClaudeCredentials();

  const [searchParams] = useSearchParams();
  const requestedSource = searchParams.get("claudeSource");
  const [source, setSource] = useState<"shared" | "personal" | null>(
    requestedSource === "shared" || requestedSource === "personal" ? requestedSource : null,
  );
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== null || !status) return;
    setSource(status.mode === "own" ? "personal" : "shared");
  }, [status, source]);

  const activeSource = source ?? "shared";

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      const contents = await readFileText(file);
      uploadOwn.mutate(
        { credentials: contents },
        {
          onSuccess: () => toast.success("Personal Claude credentials updated"),
          onError: () => toast.error("Could not save that credentials file"),
        },
      );
    } catch {
      setFileError("Could not read that file.");
    }
  };

  return (
    <div>
      <p className="mb-[18px] text-[13.5px] leading-[1.6] text-[#a6a6b6]">
        Q&#8209;Agent authenticates the Claude CLI with the token inside a{" "}
        <span className="rounded-[5px] bg-[rgba(139,92,246,.14)] px-[6px] py-[1px] font-mono text-[12px] text-[#c4b5fd]">
          .credentials.json
        </span>{" "}
        file. Use the shared account your admin maintains, or upload your own personal Claude
        account.
      </p>

      <div className="mb-[18px] flex gap-3">
        <SourceCard
          active={activeSource === "shared"}
          icon={<Users size={16} strokeWidth={2} />}
          iconBg="rgba(139,92,246,.16)"
          iconColor="#c4b5fd"
          title="Shared account"
          description="Managed by your workspace admin. Nothing to set up — you're ready to run."
          onClick={() => setSource("shared")}
        />
        <SourceCard
          active={activeSource === "personal"}
          icon={<KeyRound size={16} strokeWidth={2} />}
          iconBg="rgba(34,211,238,.14)"
          iconColor="#67e8f9"
          title="Your own account"
          description={
            <>
              Upload your personal <span className="font-mono text-[11px]">.credentials.json</span>{" "}
              to use your own Claude plan.
            </>
          }
          onClick={() => setSource("personal")}
        />
      </div>

      {activeSource === "shared" ? (
        status?.hasShared ? (
          <SharedAccountCard meta={status.shared} />
        ) : (
          <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4 text-[13px] leading-[1.6] text-[#9a9aae]">
            Your admin hasn&rsquo;t set up a shared Claude account yet. Ask them to add one from{" "}
            <b className="font-semibold text-[#c3c3d0]">Admin &#8250; Claude credentials</b>, or
            upload your own below.
          </div>
        )
      ) : status?.hasOwn ? (
        <PersonalAccountCard
          meta={status.own}
          uploading={uploadOwn.isPending}
          onReplace={handleFile}
          onRemove={() =>
            deleteOwn.mutate(undefined, {
              onSuccess: () =>
                toast.success("Removed your personal credentials — now using the shared account"),
              onError: () => toast.error("Failed to remove your credentials"),
            })
          }
          removing={deleteOwn.isPending}
        />
      ) : (
        <UploadDropzone uploading={uploadOwn.isPending} onFile={handleFile} error={fileError} />
      )}
    </div>
  );
}
