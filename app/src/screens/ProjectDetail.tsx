import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  GitBranch,
  Loader2,
  LogIn,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Dropdown";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { PROVIDER_META } from "@/components/settings/providerMeta";
import { providerGlyph } from "@/components/ui/badges";
import { confidenceColor, knowledgeStatusStyle, providerLabel } from "@/data/projects";
import {
  useBuildRepoKnowledge,
  useCaptureProjectAuth,
  useClearProjectAuth,
  useConnectionRepos,
  useProjectAuth,
  useProjectConfig,
  useProjectRepos,
  useProjects,
  useProviders,
  useRepoKnowledge,
  useRuns,
  useSaveProjectConfig,
  useTickets,
} from "@/hooks/queries";
import { type ProjectTab } from "@/store/ui";
import type {
  EnvironmentCfg,
  ProjectRepo,
  ProviderKind,
  RepoKnowledgeOut,
  TestAccountIn,
} from "@/types/api";

interface ProjectMeta {
  name: string;
  repo: string;
  framework: string;
  provider: string;
  providerKind: ProviderKind;
  tickets: number;
  runs: number;
  rate: string;
}

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "knowledge", label: "Project Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

export function ProjectDetail() {
  const navigate = useNavigate();
  const { projectName } = useParams();
  const key = decodeURIComponent(projectName ?? "");
  const [searchParams, setSearchParams] = useSearchParams();
  const projectTab = (searchParams.get("tab") as ProjectTab) ?? "overview";
  const setProjectTab = (t: ProjectTab) => setSearchParams({ tab: t });

  const { data: projects } = useProjects();
  const { data: repos } = useProjectRepos(key);
  const { data: tickets } = useTickets();
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

  const onTab = (id: ProjectTab) => {
    if (id === "tickets") navigate("/tickets");
    else if (id === "runs") navigate("/runs");
    else setProjectTab(id);
  };

  return (
    <div className="px-1 pb-10 pt-0.5">
      <button
        onClick={() => navigate("/projects")}
        className="mb-3.5 flex cursor-pointer items-center gap-[7px] border-none bg-transparent p-0 text-[12.5px] font-semibold text-ink-dim hover:text-[#c7c7d4]"
      >
        <ArrowLeft size={14} strokeWidth={2.2} /> All projects
      </button>

      <div className="mb-4 flex items-center gap-3.5">
        <div
          className="flex h-[46px] w-[46px] items-center justify-center rounded-[13px] text-[18px] font-black"
          style={{ background: glyphBg, color: glyphColor }}
        >
          {glyph}
        </div>
        <div className="flex-1">
          <h1 className="m-0 text-[26px] font-black tracking-tight">{meta.name}</h1>
          <div className="font-mono text-[12.5px] text-ink-dim">
            {meta.repo ? `${meta.repo} · ` : ""}
            {meta.provider}
          </div>
        </div>
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: statusBg }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: statusDot }} />
          <span className="text-[12.5px] font-bold" style={{ color: statusColor }}>
            Knowledge: {statusLabel}
          </span>
        </div>
      </div>

      <div className="mb-[18px] flex flex-wrap gap-2 border-b border-white/[0.06] pb-4">
        {TABS.map((t) => {
          const active = projectTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className="cursor-pointer whitespace-nowrap rounded-[11px] border-none px-[15px] py-[9px] text-[13px] font-semibold"
              style={
                active
                  ? {
                      background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))",
                      color: "#fff",
                      boxShadow: "inset 0 0 0 1px rgba(139,92,246,.3)",
                    }
                  : { background: "rgba(255,255,255,.04)", color: "#a0a0b2" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={projectTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {projectTab === "overview" ? (
            <Overview meta={meta} confidence={confidence} onView={() => setProjectTab("knowledge")} />
          ) : projectTab === "settings" ? (
            <ProjectSettingsTab projectKey={key} />
          ) : (
            <KnowledgeTab
              projectKey={key}
              providerKind={providerKind}
              repos={repoList}
              onManageRepos={() => setProjectTab("settings")}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Overview({
  meta,
  confidence,
  onView,
}: {
  meta: ProjectMeta;
  confidence: number;
  onView: () => void;
}) {
  const stats = [
    { label: "Tickets", value: String(meta.tickets), color: "#ececf1" },
    { label: "Active runs", value: String(meta.runs), color: "#a78bfa" },
    { label: "Pass rate", value: meta.rate, color: "#6ee7b7" },
    { label: "Knowledge confidence", value: `${confidence}%`, color: confidenceColor(confidence) },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-3.5">
        {stats.map((s, i) => (
          <GlassCard key={s.label} index={i} className="p-[18px]">
            <div className="mb-2.5 text-[12px] text-[#9494a6]">{s.label}</div>
            <div className="text-[26px] font-black" style={{ color: s.color }}>
              {s.value}
            </div>
          </GlassCard>
        ))}
      </div>
      <div
        className="relative overflow-hidden rounded-[20px] border p-6"
        style={{
          background: "linear-gradient(135deg,rgba(139,92,246,.18),rgba(99,102,241,.08))",
          borderColor: "rgba(139,92,246,.26)",
        }}
      >
        <div
          className="pointer-events-none absolute -right-5 -top-[30px] h-[200px] w-[200px] rounded-full blur-[20px]"
          style={{ background: "radial-gradient(circle,rgba(139,92,246,.35),transparent 65%)" }}
        />
        <div className="relative flex items-center gap-[18px]">
          <div
            className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl shadow-[0_10px_26px_-8px_rgba(139,92,246,.8)]"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
          >
            <Sparkles size={26} color="#fff" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[17px] font-extrabold">
              Project Knowledge powers every AI workflow
            </div>
            <p className="m-0 max-w-[520px] text-[13px] leading-relaxed text-[#c3c3d4]">
              Before analysing requirements, generating test cases, or writing Playwright, Q&#8209;Agent
              reuses what it learned about this repository — architecture, page objects, fixtures and
              conventions.
            </p>
          </div>
          <Button variant="white" onClick={onView} className="shrink-0">
            View Project Knowledge <ArrowRight size={14} strokeWidth={2.3} />
          </Button>
        </div>
      </div>
    </>
  );
}

const repoStatusStyle = (status: string): [string, string] =>
  status === "indexed"
    ? ["#6ee7b7", "rgba(16,185,129,.16)"]
    : status === "indexing"
      ? ["#8b5cf6", "rgba(139,92,246,.16)"]
      : status === "stale"
        ? ["#fbbf24", "rgba(251,191,36,.14)"]
        : status === "error"
          ? ["#f43f5e", "rgba(244,63,94,.14)"]
          : ["#8b8b9e", "rgba(255,255,255,.06)"];

/**
 * Project Knowledge tab — per-repo. Lists the project's repositories, each with
 * its own knowledge-base status + Build/Re-index action, and shows the selected
 * repo's knowledge base detail.
 */
function KnowledgeTab({
  projectKey,
  providerKind,
  repos,
  onManageRepos,
}: {
  projectKey: string;
  providerKind: ProviderKind;
  repos: RepoKnowledgeOut[];
  onManageRepos: () => void;
}) {
  const buildRepo = useBuildRepoKnowledge(projectKey);
  const defaultRepoName = repos.find((r) => r.default)?.name ?? repos[0]?.name ?? null;
  const [selected, setSelected] = useState<string | null>(defaultRepoName);
  const active = selected ?? defaultRepoName;

  useEffect(() => {
    if (active && !repos.some((r) => r.name === active)) setSelected(defaultRepoName);
  }, [repos, active, defaultRepoName]);

  const onBuild = (repo: string) =>
    buildRepo.mutate(
      { repo, body: { provider: providerLabel[providerKind] } },
      {
        onSuccess: () => toast.success(`Knowledge built for ${repo}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Knowledge build failed"),
      },
    );

  if (repos.length === 0) {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
        <div
          className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px]"
          style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
        >
          <GitBranch size={32} color="#a78bfa" strokeWidth={1.9} />
        </div>
        <h2 className="m-0 mb-2 text-[21px] font-extrabold">No repositories yet</h2>
        <p className="m-0 mb-[22px] max-w-[440px] text-[13.5px] leading-relaxed text-ink-dim">
          A project can hold many repositories, each with its own knowledge base. Add the repos this
          project owns, then build knowledge per repo.
        </p>
        <Button variant="primary" size="lg" onClick={onManageRepos}>
          <Plus size={16} strokeWidth={2.3} /> Manage repositories
        </Button>
      </div>
    );
  }

  // A repo is "building" when the server reports it as indexing (survives
  // navigation) or when there's an in-flight build mutation for it.
  const pendingRepo = buildRepo.isPending ? (buildRepo.variables?.repo ?? null) : null;
  const isBuilding = (repo: RepoKnowledgeOut) =>
    repo.status === "indexing" || pendingRepo === repo.name;

  return (
    <div className="grid grid-cols-[260px_1fr] items-start gap-3.5">
      <GlassCard className="p-2">
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-2">
          <span className="text-[10.5px] font-semibold tracking-wider text-faint">REPOSITORIES</span>
          <button
            onClick={onManageRepos}
            className="text-[11px] font-semibold text-violet hover:text-[#c4b5fd]"
          >
            Manage
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {repos.map((r) => {
            const [dot, bg] = repoStatusStyle(r.status);
            const on = active === r.name;
            return (
              <button
                key={r.name}
                onClick={() => setSelected(r.name)}
                className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-white/5"
                style={on ? { background: "rgba(139,92,246,.14)" } : undefined}
              >
                <GitBranch size={14} color={on ? "#a78bfa" : "#8b8b9e"} />
                <span className="flex-1 truncate font-mono text-xs text-ink-soft">{r.name}</span>
                {r.default && <Star size={11} color="#fbbf24" fill="#fbbf24" />}
                {r.status === "indexing" ? (
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border-2"
                    style={{
                      borderColor: "rgba(167,139,250,.35)",
                      borderTopColor: "#a78bfa",
                      animation: "spin .8s linear infinite",
                    }}
                    title="indexing"
                  />
                ) : (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: dot }}
                    title={r.status}
                  />
                )}
                <span className="sr-only">{bg}</span>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {active ? (
        <RepoKnowledgeDetail
          projectKey={projectKey}
          repoMeta={repos.find((r) => r.name === active)!}
          building={isBuilding(repos.find((r) => r.name === active)!)}
          onBuild={() => onBuild(active)}
        />
      ) : null}
    </div>
  );
}

/** Detail view for a single repo's knowledge base (loads it on demand). */
function RepoKnowledgeDetail({
  projectKey,
  repoMeta,
  building,
  onBuild,
}: {
  projectKey: string;
  repoMeta: RepoKnowledgeOut;
  building: boolean;
  onBuild: () => void;
}) {
  const { data: knowledge } = useRepoKnowledge(
    projectKey,
    repoMeta.status === "indexed" ? repoMeta.name : null,
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (repoMeta.status === "indexing") {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
        <span
          className="mb-5 h-[46px] w-[46px] rounded-full border-[3px]"
          style={{
            borderColor: "rgba(167,139,250,.3)",
            borderTopColor: "#a78bfa",
            animation: "spin .8s linear infinite",
          }}
        />
        <h2 className="m-0 mb-2 text-[19px] font-extrabold">
          Building knowledge for <span className="font-mono">{repoMeta.name}</span>…
        </h2>
        <p className="m-0 max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
          Cloning the repo and analysing the source — this can take a few minutes. You can leave this
          page; it keeps running.
        </p>
      </div>
    );
  }

  if (repoMeta.status === "error") {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
        <div
          className="mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-[22px]"
          style={{ background: "rgba(244,63,94,.14)" }}
        >
          <Sparkles size={30} color="#fb7185" strokeWidth={1.9} />
        </div>
        <h2 className="m-0 mb-2 text-[19px] font-extrabold">
          Couldn&apos;t build <span className="font-mono">{repoMeta.name}</span>
        </h2>
        <p className="m-0 mb-[22px] max-w-[420px] text-[13.5px] leading-relaxed text-[#fb7185]">
          {repoMeta.lastError || "Knowledge build failed."}
        </p>
        <Button variant="primary" size="lg" onClick={onBuild} disabled={building}>
          <RotateCw size={16} strokeWidth={2.3} /> {building ? "Building…" : "Retry build"}
        </Button>
      </div>
    );
  }

  if (repoMeta.status !== "indexed") {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
        <div
          className="mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-[22px]"
          style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
        >
          <Sparkles size={30} color="#a78bfa" strokeWidth={1.9} />
        </div>
        <h2 className="m-0 mb-2 text-[19px] font-extrabold">
          <span className="font-mono">{repoMeta.name}</span> isn&apos;t indexed yet
        </h2>
        <p className="m-0 mb-[22px] max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
          Build this repository&apos;s knowledge base so Q&#8209;Agent learns its routes, selectors,
          auth flow and conventions before generating tests.
        </p>
        <Button variant="primary" size="lg" onClick={onBuild} disabled={building}>
          <Sparkles size={16} strokeWidth={2.3} /> {building ? "Building…" : "Build knowledge"}
        </Button>
      </div>
    );
  }

  const kn = (knowledge?.knowledge ?? {}) as Partial<import("@/types/api").KnowledgeBody>;
  const confidence = knowledge?.confidence ?? repoMeta.confidence;
  const sections = [
    { key: "arch", label: "Application architecture", body: kn.architecture || "—" },
    { key: "domain", label: "Business domain", body: kn.domain || "—" },
    { key: "locator", label: "Locator strategy", body: kn.locator || "—" },
  ];

  return (
    <div>
      <div className="glass mb-3.5 flex flex-wrap items-center gap-3 rounded-2xl p-[16px_18px]">
        <div className="flex min-w-[220px] flex-1 items-center gap-[11px]">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
          >
            <GitBranch size={20} color="#fff" strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[14px] font-bold">
              <span className="font-mono">{repoMeta.name}</span>
              <span className="text-[11px] font-semibold text-[#8b8b9e]">
                {knowledge?.version ?? repoMeta.version}
              </span>
            </div>
            <div className="text-[12px] text-[#8b8b9e]">
              Last indexed{" "}
              {repoMeta.lastIndexed ? new Date(repoMeta.lastIndexed).toLocaleString() : "—"} &middot;{" "}
              {confidence}% confidence
            </div>
            {repoMeta.docPath && (
              <div className="mt-0.5 truncate font-mono text-[11px] text-[#6c6c7e]" title={repoMeta.docPath}>
                knowledge.md · knowledge.json → {repoMeta.docPath}
              </div>
            )}
          </div>
        </div>
        <Button variant="glass" onClick={onBuild} disabled={building}>
          <RotateCw size={14} strokeWidth={2.2} /> {building ? "Re-indexing…" : "Re-index"}
        </Button>
      </div>

      {repoMeta.needsRefresh && (
        <div
          className="mb-3.5 flex items-center gap-[11px] rounded-[14px] p-[13px_16px]"
          style={{ background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.28)" }}
        >
          <span className="text-[13px] flex-1 text-[#fbdf9e]">
            This repository changed since the last index. Rebuilding its knowledge base is recommended.
          </span>
          <button
            onClick={onBuild}
            className="cursor-pointer rounded-[10px] border-none bg-[#fbbf24] px-3.5 py-2 text-[12.5px] font-bold text-[#3a2e05]"
          >
            Rebuild now
          </button>
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-3.5">
        <GlassCard className="p-[18px]">
          <div className="mb-3 text-[12.5px] font-semibold text-[#9494a6]">Base URL</div>
          <div className="break-all font-mono text-[13px] font-bold">{kn.base_url || "—"}</div>
          <div className="mt-1.5 text-[12px] text-[#8b8b9e]">
            Branch: <b className="text-ink-soft">{kn.branch || repoMeta.defaultBranch || "main"}</b>
          </div>
        </GlassCard>
        <GlassCard className="p-[18px]">
          <div className="mb-3 text-[12.5px] font-semibold text-[#9494a6]">Routes · selectors</div>
          <div className="text-[16px] font-extrabold">
            {(kn.routes?.length ?? 0)} · {(kn.selectors?.length ?? 0)}
          </div>
          <div className="mt-1.5 text-[12px] text-[#8b8b9e]">discovered from source</div>
        </GlassCard>
        <GlassCard className="p-[18px]">
          <div className="mb-3 text-[12.5px] font-semibold text-[#9494a6]">Knowledge confidence</div>
          <div className="mb-2 text-[22px] font-black" style={{ color: confidenceColor(confidence) }}>
            {confidence}%
          </div>
          <div className="h-1.5 overflow-hidden rounded-md bg-white/[0.08]">
            <div
              className="h-full rounded-md"
              style={{ width: `${confidence}%`, background: "linear-gradient(90deg,#8b5cf6,#22d3ee)" }}
            />
          </div>
        </GlassCard>
      </div>

      <div className="mb-3.5 grid grid-cols-[1.3fr_1fr] gap-3.5">
        <GlassCard className="p-5">
          <div className="mb-3 text-[13px] font-bold">Technology stack</div>
          <div className="mb-[18px] flex flex-wrap gap-2">
            {(kn.stack ?? []).map((t) => (
              <span
                key={t}
                className="rounded-[10px] px-3 py-1.5 text-[12px] font-semibold text-violet"
                style={{ background: "rgba(139,92,246,.14)" }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mb-3 text-[13px] font-bold">Reusable test utilities</div>
          <div className="flex flex-wrap gap-2">
            {(kn.utilities ?? []).map((u) => (
              <span
                key={u}
                className="rounded-[9px] border border-white/[0.08] bg-white/[0.05] px-[11px] py-[5px] font-mono text-[11.5px] text-ink-soft"
              >
                {u}
              </span>
            ))}
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="mb-3.5 text-[13px] font-bold">Existing Playwright assets</div>
          <div className="flex flex-col gap-3">
            {[
              ["Spec files", kn.assets ?? 0, "#67e8f9"],
              ["Page objects", kn.pageObjects ?? 0, "#a78bfa"],
              ["Shared fixtures", kn.fixtures ?? 0, "#6ee7b7"],
            ].map(([label, val, color]) => (
              <div key={label as string} className="flex items-center gap-3">
                <div className="flex-1 text-[13px] font-semibold">{label}</div>
                <div className="text-[20px] font-black" style={{ color: color as string }}>
                  {val as number}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <div className="flex flex-col gap-2.5">
        {sections.map((sec) => (
          <div
            key={sec.key}
            className="glass overflow-hidden rounded-2xl"
            style={{ backdropFilter: "blur(20px)" }}
          >
            <div
              onClick={() => toggle(sec.key)}
              className="flex cursor-pointer items-center gap-3 p-[15px_18px]"
            >
              <span className="flex-1 text-[14px] font-semibold">{sec.label}</span>
              <ChevronRight
                size={16}
                color="#8b8b9e"
                strokeWidth={2.4}
                style={{
                  transition: "transform .25s",
                  transform: open[sec.key] ? "rotate(90deg)" : "none",
                }}
              />
            </div>
            {open[sec.key] && (
              <div className="p-[0_18px_16px_46px] text-[13px] leading-relaxed text-ink-soft animate-[fadeInUp_.3s_ease_both]">
                {sec.body}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-[10px] border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-[13px] text-ink-soft outline-none placeholder:text-[#6c6c7e] focus:border-violet/60";
const labelCls = "mb-1.5 block text-[12px] font-semibold text-[#9494a6]";

/**
 * Project Details → Settings tab. Lets the user configure the project-specific
 * runtime values downstream automation needs (application URL, local repo path,
 * test accounts, environments, extra config) so generated Playwright specs run
 * with little to no manual editing. Passwords are write-only: blank preserves the
 * securely stored secret.
 */
function ProjectSettingsTab({ projectKey }: { projectKey: string }) {
  const { data: config, isLoading } = useProjectConfig(projectKey);
  const { data: providers } = useProviders();
  const save = useSaveProjectConfig(projectKey);

  const [baseUrl, setBaseUrl] = useState("");
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [accounts, setAccounts] = useState<(TestAccountIn & { hasPassword: boolean })[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentCfg[]>([]);
  const [extra, setExtra] = useState<{ k: string; v: string }[]>([]);
  const [manualAuth, setManualAuth] = useState(false);
  const [workItemConnectionId, setWorkItemConnectionId] = useState<number | null>(null);
  const [repositoryConnectionId, setRepositoryConnectionId] = useState<number | null>(null);

  // Work-item vs repository connections, from the grouped provider catalog.
  const connOption = (c: { id: number; kind: ProviderKind; name: string }) => ({
    value: String(c.id),
    label: `${PROVIDER_META[c.kind].name} · ${c.name}`,
  });
  const allConnections = (providers ?? []).flatMap((g) => g.connections);
  const workItemOptions = allConnections
    .filter((c) => c.categories.includes("work_item"))
    .map(connOption);
  const repositoryConnections = allConnections.filter((c) => c.categories.includes("repository"));
  const repositoryOptions = repositoryConnections.map(connOption);
  const repoConn = repositoryConnections.find((c) => c.id === repositoryConnectionId) ?? null;

  useEffect(() => {
    if (!config) return;
    setBaseUrl(config.baseUrl ?? "");
    setManualAuth(config.manualAuth ?? false);
    setWorkItemConnectionId(config.workItemConnectionId ?? null);
    setRepositoryConnectionId(config.repositoryConnectionId ?? null);
    setRepos(config.repos ?? []);
    setAccounts(
      (config.testAccounts ?? []).map((a) => ({
        role: a.role,
        username: a.username,
        password: "",
        notes: a.notes,
        hasPassword: a.hasPassword,
      })),
    );
    setEnvironments(config.environments ?? []);
    setExtra(Object.entries(config.extra ?? {}).map(([k, v]) => ({ k, v: String(v) })));
  }, [config]);

  const onSave = () => {
    save.mutate(
      {
        baseUrl,
        repos,
        testAccounts: accounts.map(({ role, username, password, notes }) => ({
          role,
          username,
          password,
          notes,
        })),
        environments,
        extra: Object.fromEntries(extra.filter((e) => e.k).map((e) => [e.k, e.v])),
        manualAuth,
        workItemConnectionId,
        repositoryConnectionId,
      },
      {
        onSuccess: () => toast.success("Project settings saved"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
      },
    );
  };

  if (isLoading) {
    return <div className="glass rounded-[18px] p-8 text-center text-[13px] text-ink-dim">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <GlassCard className="p-5">
        <div className="mb-1 text-[14px] font-bold">Provider connections</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Bind this project to a work-item source (where its tickets come from) and a repository
          source (where its code lives) — chosen independently. Manage connections in Settings.
        </p>
        <div className="grid max-w-[560px] grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Work Item Provider</label>
            <Select
              value={workItemConnectionId != null ? String(workItemConnectionId) : null}
              options={workItemOptions}
              placeholder="Select a connection"
              onChange={(v) => setWorkItemConnectionId(v ? Number(v) : null)}
              emptyLabel="No work-item connections"
            />
          </div>
          <div>
            <label className={labelCls}>Repository Provider</label>
            <Select
              value={repositoryConnectionId != null ? String(repositoryConnectionId) : null}
              options={repositoryOptions}
              placeholder="Select a connection"
              onChange={(v) => setRepositoryConnectionId(v ? Number(v) : null)}
              emptyLabel="No repository connections"
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 text-[14px] font-bold">Application</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          The default application URL the generated Playwright automation targets.
        </p>
        <div className="max-w-[420px]">
          <label className={labelCls}>Base URL</label>
          <input
            className={inputCls}
            placeholder="https://staging.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <ToggleRow
          title="Manual login before run"
          description="Open a real browser on the host so an operator can log in before the run starts."
          checked={manualAuth}
          onChange={setManualAuth}
          bordered={false}
        />
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
          Before a run, a real browser opens on the machine running Q&#8209;Agent so you can log in
          (e.g. Microsoft Entra); the session is reused until cleared.
        </p>
        {manualAuth && (
          <ManualLoginStatus projectKey={projectKey} hasBaseUrl={baseUrl.trim().length > 0} />
        )}
      </GlassCard>

      <ReposManager
        repoConnectionId={repoConn?.id ?? null}
        repoConnectionName={repoConn?.name ?? ""}
        repos={repos}
        setRepos={setRepos}
      />

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Test accounts</div>
          <Button
            variant="glass"
            onClick={() =>
              setAccounts((a) => [...a, { role: "", username: "", password: "", notes: "", hasPassword: false }])
            }
          >
            <Plus size={14} strokeWidth={2.4} /> Add account
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Credentials used by generated specs. Passwords are encrypted at rest and never shown —
          leave the password blank to keep the stored one.
        </p>
        {accounts.length === 0 && (
          <div className="text-[12.5px] text-[#6c6c7e]">No test accounts configured yet.</div>
        )}
        <div className="flex flex-col gap-3">
          {accounts.map((acct, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1.2fr_auto] items-end gap-2.5">
              <div>
                <label className={labelCls}>Role</label>
                <input
                  className={inputCls}
                  placeholder="Internal Admin"
                  value={acct.role}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Username</label>
                <input
                  className={inputCls}
                  placeholder="qa@example.com"
                  value={acct.username}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder={acct.hasPassword ? "•••••••• (unchanged)" : "password"}
                  value={acct.password}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  placeholder="optional"
                  value={acct.notes}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                  }
                />
              </div>
              <button
                onClick={() => setAccounts((a) => a.filter((_, j) => j !== i))}
                className="mb-0.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove account"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Environments</div>
          <Button
            variant="glass"
            onClick={() => setEnvironments((e) => [...e, { name: "", baseUrl: "", notes: "" }])}
          >
            <Plus size={14} strokeWidth={2.4} /> Add environment
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Per-environment URLs. A run picks the environment matching its name (e.g. Staging).
        </p>
        {environments.length === 0 && (
          <div className="text-[12.5px] text-[#6c6c7e]">No environments configured yet.</div>
        )}
        <div className="flex flex-col gap-3">
          {environments.map((env, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-end gap-2.5">
              <div>
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  placeholder="Staging"
                  value={env.name}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Base URL</label>
                <input
                  className={inputCls}
                  placeholder="https://staging.example.com"
                  value={env.baseUrl}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, baseUrl: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  placeholder="optional"
                  value={env.notes}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                  }
                />
              </div>
              <button
                onClick={() => setEnvironments((v) => v.filter((_, j) => j !== i))}
                className="mb-0.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove environment"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Additional settings</div>
          <Button variant="glass" onClick={() => setExtra((x) => [...x, { k: "", v: "" }])}>
            <Plus size={14} strokeWidth={2.4} /> Add value
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Arbitrary project-specific key/values the automation generator can reference.
        </p>
        <div className="flex flex-col gap-2.5">
          {extra.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2.5">
              <input
                className={inputCls}
                placeholder="key"
                value={row.k}
                onChange={(e) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
              />
              <input
                className={inputCls}
                placeholder="value"
                value={row.v}
                onChange={(e) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
              />
              <button
                onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}
                className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove value"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Saved manual-login session status for a project. Shows whether a browser
 * session has been captured (with a Clear button) or prompts that a browser will
 * open on the first run. Also lets the operator capture/refresh the login now
 * (opens a headed browser on the host) without starting a run. Rendered only
 * when "Manual login before run" is on.
 *
 * @param projectKey  Project key used for the auth queries/mutations.
 * @param hasBaseUrl  Whether the project has a base URL configured; capture is
 *                    disabled without one (the backend needs a URL to open).
 */
function ManualLoginStatus({
  projectKey,
  hasBaseUrl,
}: {
  projectKey: string;
  hasBaseUrl: boolean;
}) {
  const { data: auth } = useProjectAuth(projectKey);
  const clear = useClearProjectAuth(projectKey);
  const capture = useCaptureProjectAuth(projectKey);

  // True while a headed browser is open on the host waiting for the operator to
  // log in — driven by the mutation being in-flight or the polled `capturing`.
  const capturing = capture.isPending || auth?.capturing === true;

  // Fire a one-time success toast when a capture we started finishes.
  const wasCapturing = useRef(false);
  useEffect(() => {
    if (wasCapturing.current && !capturing && auth?.exists) {
      toast.success("Login captured");
    }
    wasCapturing.current = capturing;
  }, [capturing, auth?.exists]);

  const onClear = () =>
    clear.mutate(undefined, {
      onSuccess: () => toast.success("Saved login cleared"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to clear login"),
    });

  const onCapture = () =>
    capture.mutate(undefined, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to capture login"),
    });

  return (
    <div className="mt-3 rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-[13px_15px]">
      <div className="flex flex-wrap items-center gap-3">
        {auth?.exists ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#6ee7b7]" />
            <span className="flex-1 text-[12.5px] font-semibold text-ink-soft">
              Saved login captured{" "}
              {auth.capturedAt ? new Date(auth.capturedAt).toLocaleString() : ""}
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#8b8b9e]" />
            <span className="flex-1 text-[12.5px] text-ink-dim">
              No saved login yet — capture one now, or a browser will open on the first run.
            </span>
          </>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="glass"
            size="sm"
            onClick={onCapture}
            disabled={capturing || !hasBaseUrl}
            title={hasBaseUrl ? undefined : "Set a base URL first"}
          >
            {capturing ? (
              <>
                <Loader2 size={13} strokeWidth={2.2} className="animate-spin" /> Capturing…
              </>
            ) : (
              <>
                <LogIn size={13} strokeWidth={2.2} /> Capture login now
              </>
            )}
          </Button>
          {auth?.exists && (
            <Button variant="glass" size="sm" onClick={onClear} disabled={clear.isPending}>
              <Trash2 size={13} strokeWidth={2.2} />{" "}
              {clear.isPending ? "Clearing…" : "Clear saved login"}
            </Button>
          )}
        </div>
      </div>
      {capturing && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-dim">
          A browser opened on this machine — log in, then close the window to finish.
        </p>
      )}
    </div>
  );
}

/**
 * Repositories manager — a project can own many repos, each with its own
 * knowledge base. Discover them from the project's bound repository connection
 * or add manually, pick which repo automation targets by default, and set an
 * optional local path. Remember to Save settings to persist changes.
 */
function ReposManager({
  repoConnectionId,
  repoConnectionName,
  repos,
  setRepos,
}: {
  repoConnectionId: number | null;
  repoConnectionName: string;
  repos: ProjectRepo[];
  setRepos: (updater: (r: ProjectRepo[]) => ProjectRepo[]) => void;
}) {
  const [discovering, setDiscovering] = useState(false);
  const { data: available, isFetching } = useConnectionRepos(repoConnectionId, discovering);

  const setDefault = (idx: number) =>
    setRepos((rs) => rs.map((r, i) => ({ ...r, default: i === idx })));
  const removeRepo = (idx: number) =>
    setRepos((rs) => {
      const next = rs.filter((_, i) => i !== idx);
      if (next.length && !next.some((r) => r.default)) next[0].default = true;
      return next;
    });
  const addRepo = (repo: ProjectRepo) =>
    setRepos((rs) =>
      repo.name && rs.some((r) => r.name === repo.name)
        ? rs
        : [...rs, { ...repo, default: rs.length === 0 }],
    );
  const updateRepo = (idx: number, patch: Partial<ProjectRepo>) =>
    setRepos((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const known = new Set(repos.map((r) => r.name));
  const discovered = (available?.repos ?? []).filter((r) => !known.has(r.name));

  return (
    <GlassCard className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex-1 text-[14px] font-bold">Repositories</div>
        <Button
          variant="glass"
          onClick={() => setDiscovering(true)}
          disabled={isFetching || !repoConnectionId}
          title={repoConnectionId ? undefined : "Bind a repository provider above first"}
        >
          <Search size={14} strokeWidth={2.4} />{" "}
          {isFetching
            ? "Discovering…"
            : `Discover from ${repoConnectionName || "repository provider"}`}
        </Button>
        <Button
          variant="glass"
          onClick={() => addRepo({ name: "", repoUrl: "", defaultBranch: "", localRepoPath: "", default: false })}
        >
          <Plus size={14} strokeWidth={2.4} /> Add manually
        </Button>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
        Each repository gets its own knowledge base (built from the Project Knowledge tab). The{" "}
        <Star size={11} className="inline align-[-1px]" color="#fbbf24" fill="#fbbf24" /> default repo
        is the one automation targets when a run doesn&apos;t specify one. Repos are cloned/pulled to{" "}
        <span className="font-mono">workspace/repos/&lt;project&gt;/&lt;repo&gt;</span> (private repos
        use the provider PAT), or use a local path if set.
      </p>

      {available?.error && discovering && (
        <div className="mb-3 rounded-[10px] border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.1)] px-3 py-2 text-[12px] text-[#fb7185]">
          {available.error}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="mb-3.5 rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-2.5">
          <div className="mb-1.5 px-1 text-[11px] font-semibold tracking-wider text-faint">
            DISCOVERED — click to add
          </div>
          <div className="flex flex-wrap gap-2">
            {discovered.map((r) => (
              <button
                key={r.name}
                onClick={() =>
                  addRepo({
                    name: r.name,
                    repoUrl: r.cloneUrl,
                    defaultBranch: r.defaultBranch,
                    localRepoPath: "",
                    default: false,
                  })
                }
                className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11.5px] text-ink-soft hover:bg-white/[0.08]"
              >
                <Plus size={12} strokeWidth={2.4} /> {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {repos.length === 0 ? (
        <div className="text-[12.5px] text-[#6c6c7e]">No repositories configured yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {repos.map((r, i) => (
            <div
              key={i}
              className="rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-3"
            >
              <div className="mb-2 flex items-center gap-2.5">
                <button
                  onClick={() => setDefault(i)}
                  title={r.default ? "Default automation target" : "Set as default"}
                  className="flex h-6 w-6 items-center justify-center rounded-[7px]"
                  style={{ background: r.default ? "rgba(251,191,36,.16)" : "rgba(255,255,255,.05)" }}
                >
                  <Star size={14} color="#fbbf24" fill={r.default ? "#fbbf24" : "none"} />
                </button>
                <input
                  className={`${inputCls} max-w-[220px] font-mono`}
                  placeholder="repo-name"
                  value={r.name}
                  onChange={(e) => updateRepo(i, { name: e.target.value })}
                />
                {r.default && (
                  <span className="rounded-md bg-[rgba(251,191,36,.14)] px-2 py-0.5 text-[10.5px] font-bold text-[#fbbf24]">
                    default
                  </span>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => removeRepo(i)}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                  title="Remove repository"
                >
                  <Trash2 size={14} strokeWidth={2.1} />
                </button>
              </div>
              <div className="grid grid-cols-[2fr_1fr] gap-2.5">
                <input
                  className={inputCls}
                  placeholder="clone URL (https://…) — used when no local path is set"
                  value={r.repoUrl}
                  onChange={(e) => updateRepo(i, { repoUrl: e.target.value })}
                />
                <input
                  className={inputCls}
                  placeholder="local path (optional)"
                  value={r.localRepoPath}
                  onChange={(e) => updateRepo(i, { localRepoPath: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
