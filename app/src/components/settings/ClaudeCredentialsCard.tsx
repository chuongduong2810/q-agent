import { useRef, useState } from "react";
import { useAuth } from "@/store/auth";
import {
  useClaudeCredentialsStatus,
  useDeleteOwnClaudeCredentials,
  useDeleteSharedClaudeCredentials,
  useUploadOwnClaudeCredentials,
  useUploadSharedClaudeCredentials,
} from "@/hooks/queries";

/** Reads a dropped/selected file's text contents (used for `.credentials.json` uploads). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** One upload/status row: a drag-and-drop + click-to-browse target for a Claude
 * CLI `.credentials.json` file, plus a "remove" action once one is configured. */
function CredentialUploadRow({
  title,
  description,
  configured,
  onUpload,
  onDelete,
  uploading,
}: {
  title: string;
  description: string;
  configured: boolean;
  onUpload: (contents: string) => void;
  onDelete: () => void;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onUpload(await readFileText(file));
    } catch {
      setError("Could not read that file.");
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-[13px] last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          {title}
          <span
            className={`rounded-full px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide ${
              configured ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.08] text-muted"
            }`}
          >
            {configured ? "Configured" : "Not configured"}
          </span>
        </div>
        <div className="text-[12px] text-muted">{description}</div>
        {error && <div className="mt-1 text-[12px] text-red-400">{error}</div>}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`shrink-0 cursor-pointer rounded-[11px] border px-[15px] py-[10px] text-[13px] font-semibold transition-colors ${
          dragOver
            ? "border-[rgba(139,92,246,.6)] bg-[rgba(139,92,246,.12)]"
            : "border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1]"
        }`}
      >
        {uploading ? "Uploading…" : configured ? "Replace file" : "Upload file"}
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>
      {configured && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-[11px] border border-white/[0.1] bg-white/[0.05] px-[13px] py-[10px] text-[13px] font-semibold text-red-400 transition-colors hover:bg-red-500/10"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** Claude CLI credentials management (#95): upload/replace/remove the signed-in
 * user's own `.credentials.json`, plus an admin-only shared/fallback credential
 * used for users who haven't configured their own. */
export function ClaudeCredentialsCard() {
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const { data: status } = useClaudeCredentialsStatus();
  const uploadOwn = useUploadOwnClaudeCredentials();
  const deleteOwn = useDeleteOwnClaudeCredentials();
  const uploadShared = useUploadSharedClaudeCredentials();
  const deleteShared = useDeleteSharedClaudeCredentials();

  return (
    <div className="flex flex-col">
      <CredentialUploadRow
        title="Your Claude credentials"
        description={
          status?.mode === "own"
            ? "Your own credentials are in use for AI calls."
            : status?.mode === "shared"
              ? "Using the shared credential — upload your own to use your own account/quota."
              : "Upload your Claude CLI .credentials.json to run AI actions under your own account."
        }
        configured={!!status?.hasOwn}
        uploading={uploadOwn.isPending}
        onUpload={(contents) => uploadOwn.mutate({ credentials: contents })}
        onDelete={() => deleteOwn.mutate()}
      />
      {isAdmin && (
        <CredentialUploadRow
          title="Shared credential (admin)"
          description="Fallback used for any user who hasn't uploaded their own credentials."
          configured={!!status?.hasShared}
          uploading={uploadShared.isPending}
          onUpload={(contents) => uploadShared.mutate({ credentials: contents })}
          onDelete={() => deleteShared.mutate()}
        />
      )}
    </div>
  );
}
