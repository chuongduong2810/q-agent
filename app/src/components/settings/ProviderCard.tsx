import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/GlassCard";
import { Spinner } from "@/components/ui/misc";
import { useSaveProvider, useTestConnection } from "@/hooks/queries";
import type { ProviderKind, ProviderOut } from "@/types/api";

interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
}

/** Backend contract field keys per provider (docs/API-CONTRACT.md / team-lead
 * brief) — config fields are prefilled from `provider.config`; secret fields
 * render masked and are only sent on save if the user typed a new value. */
const PROVIDER_FIELDS: Record<ProviderKind, FieldSpec[]> = {
  ado: [
    { key: "orgUrl", label: "Organization URL" },
    { key: "project", label: "Project" },
    { key: "pat", label: "Personal Access Token", secret: true },
  ],
  jira: [
    { key: "baseUrl", label: "Base URL" },
    { key: "project", label: "Project Key" },
    { key: "email", label: "Email", secret: true },
    { key: "apiToken", label: "API Token", secret: true },
  ],
  github: [
    { key: "org", label: "Organization" },
    { key: "repo", label: "Repository" },
    { key: "pat", label: "Personal Access Token", secret: true },
  ],
};

const PROVIDER_META: Record<ProviderKind, { name: string; glyph: string; color: string; glyphColor: string }> = {
  ado: { name: "Azure DevOps", glyph: "A", color: "#0078d4", glyphColor: "#fff" },
  jira: { name: "Jira", glyph: "J", color: "#2684ff", glyphColor: "#fff" },
  github: { name: "GitHub", glyph: "G", color: "#24292f", glyphColor: "#fff" },
};

/** One provider connection card: field inputs (prefilled config, masked
 * secrets), Test connection, and Save connection — Q-Agent.dc.html lines
 * 530-538. */
export function ProviderCard({ provider }: { provider: ProviderOut }) {
  const meta = PROVIDER_META[provider.kind];
  const fields = PROVIDER_FIELDS[provider.kind];
  const [config, setConfig] = useState<Record<string, string>>(() => ({ ...provider.config }));
  // Only fields the user actually typed into go here — untouched secrets are
  // never re-sent so the backend keeps the existing encrypted value.
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const saveProvider = useSaveProvider();
  const testConnection = useTestConnection();

  const setField = (key: string, secret: boolean | undefined, value: string) => {
    if (secret) setSecrets((s) => ({ ...s, [key]: value }));
    else setConfig((c) => ({ ...c, [key]: value }));
  };

  const handleSave = () => {
    saveProvider.mutate(
      { kind: provider.kind, body: { config, secrets } },
      {
        onSuccess: () => {
          toast.success(`${meta.name} connection saved`);
          setSecrets({});
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save connection"),
      },
    );
  };

  const handleTest = () => {
    testConnection.mutate(provider.kind, {
      onSuccess: (result) => (result.ok ? toast.success(result.message) : toast.error(result.message)),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Connection test failed"),
    });
  };

  const statusBg = provider.connected ? "rgba(16,185,129,.14)" : "rgba(122,122,140,.14)";
  const statusColor = provider.connected ? "#6ee7b7" : "#9494a6";
  const statusDot = provider.connected ? "#10b981" : "#7a7a8c";

  return (
    <GlassCard className="overflow-hidden !p-0">
      <div className="flex items-center gap-[13px] border-b border-white/[0.06] px-[22px] py-[18px]">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[17px] font-black"
          style={{ background: meta.color, color: meta.glyphColor }}
        >
          {meta.glyph}
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-bold">{meta.name}</div>
          <div className="text-[11.5px] text-muted">Last sync: {provider.lastSync ?? "never"}</div>
        </div>
        <span
          className="flex items-center gap-[7px] rounded-full px-3 py-[5px] text-[12px] font-semibold"
          style={{ background: statusBg, color: statusColor }}
        >
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: statusDot }} />
          {provider.connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <div className="px-[22px] py-5">
        <div className="mb-4 grid grid-cols-2 gap-3.5">
          {fields.map((f) => {
            const isMasked = f.secret && provider.secretFields.includes(f.key);
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
            disabled={testConnection.isPending}
            className="flex items-center gap-2 rounded-[11px] px-4 py-2.5 text-[13px] font-semibold text-[#c4b5fd] disabled:opacity-60"
            style={{ background: "rgba(139,92,246,.16)", border: "1px solid rgba(139,92,246,.32)" }}
          >
            {testConnection.isPending ? <Spinner size={14} /> : <RefreshCw size={14} />}
            Test connection
          </button>
          <button
            onClick={handleSave}
            disabled={saveProvider.isPending}
            className="rounded-[11px] border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-semibold text-ink-soft hover:bg-white/[0.1] disabled:opacity-60"
          >
            Save connection
          </button>
          <span className="ml-auto text-[11.5px] text-[#7a7a8c]">Credentials are encrypted at rest</span>
        </div>
      </div>
    </GlassCard>
  );
}
