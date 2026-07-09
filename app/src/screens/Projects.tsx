import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FolderKanban, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { providerGlyph } from "@/components/ui/badges";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { SharedProjectsCatalog } from "@/components/projects/SharedProjectsCatalog";
import { confidenceColor, knowledgeStatusStyle, providerLabel } from "@/data/projects";
import { useKnowledgeList, useProjects, useProviders, useRefreshProjects } from "@/hooks/queries";
import type { KnowledgeStatus, ProjectKnowledgeOut, ProjectOut } from "@/types/api";

/** Aggregate a project's per-repo knowledge rows into a single card summary. */
interface KnowledgeSummary {
  status: KnowledgeStatus;
  confidence: number;
  lastIndexed: string | null;
  framework: string;
  repoLabel: string;
}
function summarize(rows: ProjectKnowledgeOut[]): KnowledgeSummary | undefined {
  if (!rows.length) return undefined;
  const indexed = rows.filter((r) => r.status === "indexed");
  const lastIndexed =
    indexed.map((r) => r.lastIndexed).filter(Boolean).sort().at(-1) ?? null;
  return {
    status: indexed.length ? "indexed" : "not_indexed",
    confidence: indexed.length
      ? Math.round(indexed.reduce((s, r) => s + r.confidence, 0) / indexed.length)
      : 0,
    lastIndexed,
    framework: rows[0]?.framework || "Playwright",
    repoLabel: `${indexed.length}/${rows.length} repos indexed`,
  };
}

/**
 * Projects grid — real connected projects pulled from providers (GET /projects,
 * refreshed from provider adapters). Knowledge status is merged in live by name.
 * No mock data: an empty list prompts the user to connect a provider in Settings.
 */
export function Projects() {
  const navigate = useNavigate();

  const { data: projects, isLoading } = useProjects();
  const { data: providers } = useProviders();
  const { data: knowledgeList } = useKnowledgeList();
  const refresh = useRefreshProjects();

  // Group per-repo knowledge rows by their owning project and summarize each.
  const byProject = useMemo(() => {
    const groups = new Map<string, ProjectKnowledgeOut[]>();
    for (const k of knowledgeList ?? []) {
      const pk = k.projectKey || k.key;
      const list = groups.get(pk) ?? [];
      list.push(k);
      groups.set(pk, list);
    }
    const m = new Map<string, KnowledgeSummary>();
    for (const [pk, rows] of groups) {
      const s = summarize(rows);
      if (s) m.set(pk, s);
    }
    return m;
  }, [knowledgeList]);

  const connectedCount = (providers ?? []).reduce((sum, g) => sum + g.connectedCount, 0);

  // Auto-pull projects from connected providers once, if none are cached yet.
  const triedRefresh = useRef(false);
  useEffect(() => {
    if (
      !triedRefresh.current &&
      !isLoading &&
      (projects?.length ?? 0) === 0 &&
      connectedCount > 0 &&
      !refresh.isPending
    ) {
      triedRefresh.current = true;
      refresh.mutate();
    }
  }, [isLoading, projects, connectedCount, refresh]);

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-muted">
            Across {connectedCount} connected provider{connectedCount === 1 ? "" : "s"} &middot;
            Q&#8209;Agent learns each project before it tests
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Projects</h1>
        </div>
        <Button variant="glass" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? <Spinner size={14} /> : <RefreshCw size={15} strokeWidth={2.2} />}
          Refresh
        </Button>
      </div>

      <SharedProjectsCatalog />

      {isLoading || refresh.isPending ? (
        <div className="grid grid-cols-3 gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass h-[240px] animate-pulse rounded-[20px]" />
          ))}
        </div>
      ) : !projects?.length ? (
        <EmptyState
          icon={<FolderKanban size={28} className="text-muted" />}
          title="No connected projects"
          body="Connect Azure DevOps, Jira or GitHub in Settings, then refresh to pull your projects in."
          action={
            <div className="flex gap-2.5">
              <Button variant="primary" onClick={() => navigate("/settings")}>
                Open Settings
              </Button>
              <Button variant="glass" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw size={15} strokeWidth={2.2} /> Refresh
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
          {projects.map((p, i) => (
            <ProjectCard
              key={p.id}
              project={p}
              summary={byProject.get(p.name)}
              index={i}
              onOpen={() => navigate(`/projects/${encodeURIComponent(p.name)}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  summary,
  index,
  onOpen,
}: {
  project: ProjectOut;
  summary: KnowledgeSummary | undefined;
  index: number;
  onOpen: () => void;
}) {
  const status = summary?.status ?? "not_indexed";
  const indexed = status === "indexed";
  const confidence = summary?.confidence ?? 0;
  const baseLabel = knowledgeStatusStyle(status);
  const [, statusColor, statusBg, statusDot] = baseLabel;
  const statusLabel = summary?.repoLabel ?? baseLabel[0];
  const [glyph, glyphBg] = providerGlyph[project.providerKind] ?? ["?", "#6b7280"];
  const glyphColor = project.providerKind === "github" ? "#12121a" : "#fff";
  const framework = summary?.framework || "Playwright";
  const lastIndexed =
    indexed && summary?.lastIndexed ? new Date(summary.lastIndexed).toLocaleDateString() : "Never";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
      whileHover={{ y: -3, borderColor: "rgba(139,92,246,.35)" }}
      onClick={onOpen}
      className="glass flex cursor-pointer flex-col rounded-[20px] p-5"
      style={{ borderColor: project.active ? "rgba(139,92,246,.3)" : "rgba(255,255,255,.07)" }}
    >
      <div className="mb-4 flex items-center gap-[11px]">
        <div
          className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-[15px] font-black"
          style={{ background: glyphBg, color: glyphColor }}
        >
          {glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{project.name}</div>
        </div>
        {project.active && (
          <span
            className="rounded-full px-[9px] py-[3px] text-[10px] font-bold"
            style={{ background: "rgba(139,92,246,.24)", color: "#c4b5fd" }}
          >
            Active
          </span>
        )}
      </div>

      <div
        className="mb-3.5 flex items-center gap-2 rounded-xl p-[9px_11px]"
        style={{ background: statusBg }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: statusDot }} />
        <span className="text-[12px] font-bold" style={{ color: statusColor }}>
          Knowledge: {statusLabel}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Last indexed" value={lastIndexed} />
        <Field label="Confidence" value={`${confidence}%`} valueColor={confidenceColor(confidence)} />
        <Field label="Framework" value={framework} />
        <Field label="Provider" value={providerLabel[project.providerKind]} />
      </div>

      {indexed ? (
        <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-[11.5px] text-[#8b8b9e]">Knowledge base ready</span>
          <span className="flex items-center gap-[5px] text-[12px] font-bold text-violet">
            Open <ArrowRight size={13} strokeWidth={2.4} />
          </span>
        </div>
      ) : (
        <Button
          variant="primary"
          className="mt-auto w-full"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Sparkles size={15} strokeWidth={2.2} /> Set up repositories &amp; knowledge
        </Button>
      )}
    </motion.div>
  );
}

function Field({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[10.5px] text-[#7a7a8c]">{label}</div>
      <div className="text-[12.5px] font-semibold" style={{ color: valueColor }}>
        {value}
      </div>
    </div>
  );
}
