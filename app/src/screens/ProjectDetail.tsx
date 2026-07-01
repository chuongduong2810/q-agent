import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronRight, RotateCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { providerGlyph } from "@/components/ui/badges";
import { SAMPLE_PROJECTS, confidenceColor, knowledgeStatusStyle } from "@/data/projects";
import { useProjectKnowledge } from "@/hooks/queries";
import { useKnowledgeBuilder } from "@/hooks/useKnowledgeBuilder";
import { useUI, type ProjectTab } from "@/store/ui";

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "knowledge", label: "Project Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

export function ProjectDetail() {
  const key = useUI((s) => s.activeProject);
  const projectTab = useUI((s) => s.projectTab);
  const setProjectTab = useUI((s) => s.setProjectTab);
  const navigate = useUI((s) => s.navigate);
  const build = useKnowledgeBuilder();

  const meta = SAMPLE_PROJECTS.find((p) => p.name === key) ?? SAMPLE_PROJECTS[0];
  const { data: knowledge } = useProjectKnowledge(key);

  const status = knowledge?.status ?? "not_indexed";
  const indexed = status === "indexed";
  const confidence = knowledge?.confidence ?? 0;
  const [statusLabel, statusColor, statusBg, statusDot] = knowledgeStatusStyle(status);
  const [glyph, glyphBg] = providerGlyph[meta.providerKind] ?? ["?", "#6b7280"];
  const glyphColor = meta.providerKind === "github" ? "#12121a" : "#fff";

  const onTab = (id: ProjectTab) => {
    if (id === "tickets" || id === "runs" || id === "settings") navigate(id);
    else setProjectTab(id);
  };

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <button
        onClick={() => navigate("projects")}
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
            {meta.repo} &middot; {meta.provider}
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
          ) : (
            <KnowledgeTab
              indexed={indexed}
              confidence={confidence}
              version={knowledge?.version ?? "v1"}
              lastIndexed={knowledge?.lastIndexed}
              needsRefresh={knowledge?.needsRefresh ?? false}
              repo={meta.repo}
              framework={meta.framework}
              kn={knowledge?.knowledge ?? {}}
              onBuild={() => build(meta)}
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
  meta: (typeof SAMPLE_PROJECTS)[number];
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

function KnowledgeTab({
  indexed,
  confidence,
  version,
  lastIndexed,
  needsRefresh,
  repo,
  framework,
  kn,
  onBuild,
}: {
  indexed: boolean;
  confidence: number;
  version: string;
  lastIndexed: string | null | undefined;
  needsRefresh: boolean;
  repo: string;
  framework: string;
  kn: Partial<import("@/types/api").KnowledgeBody>;
  onBuild: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (!indexed) {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
        <div
          className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px]"
          style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
        >
          <Sparkles size={32} color="#a78bfa" strokeWidth={1.9} />
        </div>
        <h2 className="m-0 mb-2 text-[21px] font-extrabold">This project isn't indexed yet</h2>
        <p className="m-0 mb-[22px] max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
          Build the Project Knowledge Base so Q&#8209;Agent understands the repository, its
          architecture, existing Playwright assets and conventions before it starts testing.
        </p>
        <Button variant="primary" size="lg" onClick={onBuild}>
          <Sparkles size={16} strokeWidth={2.3} /> Build Project Knowledge
        </Button>
      </div>
    );
  }

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
            <Sparkles size={20} color="#fff" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-[14px] font-bold">Knowledge Base {version}</div>
            <div className="text-[12px] text-[#8b8b9e]">
              Last indexed {lastIndexed ? new Date(lastIndexed).toLocaleString() : "—"} &middot;{" "}
              {confidence}% confidence
            </div>
          </div>
        </div>
        <Button variant="glass" onClick={onBuild}>
          <RotateCw size={14} strokeWidth={2.2} /> Re-index
        </Button>
      </div>

      {needsRefresh && (
        <div
          className="mb-3.5 flex items-center gap-[11px] rounded-[14px] p-[13px_16px]"
          style={{ background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.28)" }}
        >
          <span className="text-[13px] flex-1 text-[#fbdf9e]">
            The repository changed significantly since the last index. Rebuilding the Project
            Knowledge Base is recommended.
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
          <div className="mb-3 text-[12.5px] font-semibold text-[#9494a6]">Repository</div>
          <div className="break-all font-mono text-[14px] font-bold">{repo}</div>
          <div className="mt-1.5 text-[12px] text-[#8b8b9e]">
            Branch: <b className="text-ink-soft">{kn.branch || "main"}</b>
          </div>
        </GlassCard>
        <GlassCard className="p-[18px]">
          <div className="mb-3 text-[12.5px] font-semibold text-[#9494a6]">Automation framework</div>
          <div className="text-[16px] font-extrabold">{framework}</div>
          <div className="mt-1.5 text-[12px] text-[#8b8b9e]">TypeScript &middot; @playwright/test</div>
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
