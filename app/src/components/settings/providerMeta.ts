import type { ProviderCategory, ProviderKind } from "@/types/api";

export interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
}

/** Backend contract field keys per provider (docs/API-CONTRACT.md) — config
 * fields prefill from a connection's `config`; secret fields render masked and
 * are only sent on save when the user typed a new value. */
export const PROVIDER_FIELDS: Record<ProviderKind, FieldSpec[]> = {
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

export const PROVIDER_META: Record<
  ProviderKind,
  { name: string; glyph: string; color: string; glyphColor: string; categories: ProviderCategory[] }
> = {
  ado: { name: "Azure DevOps", glyph: "A", color: "#0078d4", glyphColor: "#fff", categories: ["work_item", "repository"] },
  jira: { name: "Jira", glyph: "J", color: "#2684ff", glyphColor: "#fff", categories: ["work_item"] },
  github: { name: "GitHub", glyph: "G", color: "#24292f", glyphColor: "#fff", categories: ["repository"] },
};

/** Fixed render order for the flat Settings provider list (ADR 0006 §4). */
export const PROVIDER_ORDER: ProviderKind[] = ["ado", "jira", "github"];

/** Human summary of a connection's non-secret config (e.g. the org + project),
 * or empty string when nothing is configured yet. */
export function connectionConfigSummary(kind: ProviderKind, config: Record<string, string>): string {
  return PROVIDER_FIELDS[kind]
    .filter((f) => !f.secret)
    .map((f) => config[f.key])
    .filter((v) => v && v.trim())
    .join(" · ");
}

/** Compact relative time ("2h ago", "just now"), or "never" for null. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
