import { ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/misc";
import { useTestConnection, useUpdateConnection } from "@/hooks/queries";
import type { ConnectionOut } from "@/types/api";
import {
  PROVIDER_FIELDS,
  PROVIDER_META,
  connectionConfigSummary,
  relativeTime,
} from "@/components/settings/providerMeta";

/**
 * One connection under a provider group: a collapsible row (name + config
 * summary, status pill, relative time, delete) that expands to an inset edit
 * form (connection name + the kind's config/secret fields, Test + Save).
 * Untouched secrets are never re-sent so the backend keeps the encrypted value.
 */
export function ConnectionRow({
  connection,
  expanded,
  onToggle,
  onRequestDelete,
}: {
  connection: ConnectionOut;
  expanded: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
}) {
  const meta = PROVIDER_META[connection.kind];
  const fields = PROVIDER_FIELDS[connection.kind];

  const [name, setName] = useState(connection.name);
  const [config, setConfig] = useState<Record<string, string>>(() => ({ ...connection.config }));
  // Only fields the user typed into go here — untouched secrets stay omitted.
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const update = useUpdateConnection();
  const test = useTestConnection(connection.id);

  const setField = (key: string, secret: boolean | undefined, value: string) => {
    if (secret) setSecrets((s) => ({ ...s, [key]: value }));
    else setConfig((c) => ({ ...c, [key]: value }));
  };

  const handleSave = () => {
    update.mutate(
      { id: connection.id, body: { name, config, secrets } },
      {
        onSuccess: () => {
          toast.success(`${name || meta.name} connection saved`);
          setSecrets({});
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save connection"),
      },
    );
  };

  const handleTest = () => {
    test.mutate(undefined, {
      onSuccess: (result) => (result.ok ? toast.success(result.message) : toast.error(result.message)),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Connection test failed"),
    });
  };

  const summary = connectionConfigSummary(connection.kind, connection.config);
  const statusBg = connection.connected ? "rgba(16,185,129,.14)" : "rgba(122,122,140,.14)";
  const statusColor = connection.connected ? "#6ee7b7" : "#9494a6";
  const statusDot = connection.connected ? "#10b981" : "#7a7a8c";

  return (
    <div className="overflow-hidden border-t border-white/[0.06] first:border-t-0">
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-3 px-[18px] py-[13px] hover:bg-white/[0.03]"
      >
        <ChevronRight
          size={15}
          color="#8b8b9e"
          strokeWidth={2.4}
          style={{ transition: "transform .2s", transform: expanded ? "rotate(90deg)" : "none" }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-ink">{connection.name}</div>
          <div className="truncate text-[11.5px] text-muted">{summary || "Not configured"}</div>
        </div>
        <span
          className="flex shrink-0 items-center gap-[6px] rounded-full px-2.5 py-[4px] text-[11.5px] font-semibold"
          style={{ background: statusBg, color: statusColor }}
        >
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: statusDot }} />
          {connection.connected ? "Connected" : "Not connected"}
        </span>
        <span className="w-[68px] shrink-0 text-right text-[11px] text-[#7a7a8c]">
          {relativeTime(connection.lastTestedAt ?? connection.lastSync)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border border-[rgba(255,255,255,.09)] bg-[rgba(255,255,255,.04)] text-[#8b8b9e] transition-colors hover:border-[rgba(244,63,94,.3)] hover:bg-[rgba(244,63,94,.14)] hover:text-[#fb7185]"
          title="Delete connection"
        >
          <Trash2 size={14} strokeWidth={2.1} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] bg-white/[0.015] px-[18px] py-4">
          <div className="mb-3">
            <div className="mb-1.5 text-[12px] font-semibold text-[#9494a6]">Connection name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${meta.name} connection`}
              className="w-full rounded-[11px] border border-white/[0.09] bg-white/[0.04] px-[13px] py-2.5 text-[13px] text-ink outline-none focus:border-[rgba(139,92,246,.5)]"
            />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3.5">
            {fields.map((f) => {
              const isMasked = f.secret && connection.secretFields.includes(f.key);
              return (
                <div key={f.key}>
                  <div className="mb-1.5 text-[12px] font-semibold text-[#9494a6]">{f.label}</div>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={f.secret ? (secrets[f.key] ?? "") : (config[f.key] ?? "")}
                    onChange={(e) => setField(f.key, f.secret, e.target.value)}
                    placeholder={isMasked ? "••••••••••••" : f.label}
                    className="w-full rounded-[11px] border border-white/[0.09] bg-white/[0.04] px-[13px] py-2.5 font-sans text-[13px] text-ink outline-none focus:border-[rgba(139,92,246,.5)]"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleTest}
              disabled={test.isPending}
              className="flex items-center gap-2 rounded-[11px] border border-[rgba(139,92,246,.32)] bg-[rgba(139,92,246,.16)] px-4 py-2.5 text-[13px] font-semibold text-[#c4b5fd] transition-colors hover:bg-[rgba(139,92,246,.24)] disabled:opacity-60"
            >
              {test.isPending ? <Spinner size={14} /> : <RefreshCw size={14} />}
              Test connection
            </button>
            <button
              onClick={handleSave}
              disabled={update.isPending}
              className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft hover:bg-white/[0.1] disabled:opacity-60"
            >
              {update.isPending ? "Saving…" : "Save connection"}
            </button>
            <span className="ml-auto text-[11.5px] text-[#7a7a8c]">Credentials encrypted at rest</span>
          </div>
        </div>
      )}
    </div>
  );
}
