import {
  ALL_TICKETS_PAGE_SIZE,
  useProjectRepos,
  useProjects,
  useRuns,
  useTickets,
} from "@/hooks/queries";
import { knowledgeStatusStyle, providerLabel } from "@/data/projects";
import { providerGlyph } from "@/components/ui/badges";
import type { ProviderKind } from "@/types/api";
import type { ProjectMeta } from "./types";

/**
 * Loads a project's summary data (project record, repos, tickets, runs) and
 * derives the values the ProjectDetail header + overview render: the aggregate
 * knowledge status/confidence, the status pill styling, the provider glyph, and
 * the {@link ProjectMeta} record. Pure relocation of the derivations previously
 * inline in `ProjectDetail`.
 *
 * @param key The decoded project name (route param).
 */
export function useProjectOverviewData(key: string) {
  const { data: projects } = useProjects();
  const { data: repos } = useProjectRepos(key);
  const { data: ticketsPage } = useTickets({ pageSize: ALL_TICKETS_PAGE_SIZE });
  const tickets = ticketsPage?.items;
  const { data: runs } = useRuns();

  const project = projects?.find((p) => p.name === key);
  const providerKind: ProviderKind = project?.providerKind ?? "ado";
  const repoList = repos ?? [];
  const indexedRepos = repoList.filter((r) => r.status === "indexed");
  const meta: ProjectMeta = {
    name: key,
    repo: repoList.length ? `${repoList.length} repos` : "",
    framework: "Playwright",
    provider: providerLabel[providerKind],
    providerKind,
    tickets: (tickets ?? []).filter((t) => t.providerKind === providerKind).length,
    runs: (runs ?? []).filter((r) => r.status !== "done").length,
    rate: "—",
  };

  // Aggregate knowledge status across the project's repos.
  const status = indexedRepos.length ? "indexed" : "not_indexed";
  const confidence = indexedRepos.length
    ? Math.round(indexedRepos.reduce((s, r) => s + r.confidence, 0) / indexedRepos.length)
    : 0;
  const [, statusColor, statusBg, statusDot] = knowledgeStatusStyle(status);
  const statusLabel = repoList.length
    ? `${indexedRepos.length}/${repoList.length} repos indexed`
    : "no repos";
  const [glyph, glyphBg] = providerGlyph[meta.providerKind] ?? ["?", "#6b7280"];
  const glyphColor = meta.providerKind === "github" ? "#12121a" : "#fff";

  return {
    meta,
    providerKind,
    repoList,
    confidence,
    statusColor,
    statusBg,
    statusDot,
    statusLabel,
    glyph,
    glyphBg,
    glyphColor,
  };
}
