import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { providerGlyph } from "@/components/ui/badges";
import {
  SAMPLE_PROJECTS,
  confidenceColor,
  knowledgeStatusStyle,
  type SampleProject,
} from "@/data/projects";
import { useKnowledgeList } from "@/hooks/queries";
import { useKnowledgeBuilder } from "@/hooks/useKnowledgeBuilder";
import { useUI } from "@/store/ui";
import type { ProjectKnowledgeOut } from "@/types/api";

/**
 * Projects grid. Q-Agent learns each project (Project Knowledge) before testing:
 * cards show knowledge status and either a "Build Project Knowledge" CTA or open
 * the project detail. Knowledge status is merged live from the backend by name.
 */
export function Projects() {
  const openProject = useUI((s) => s.openProject);
  const { data: knowledgeList } = useKnowledgeList();
  const build = useKnowledgeBuilder();

  const byName = useMemo(() => {
    const m = new Map<string, ProjectKnowledgeOut>();
    for (const k of knowledgeList ?? []) m.set(k.key, k);
    return m;
  }, [knowledgeList]);

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-5">
        <div className="mb-[5px] text-[13px] font-medium text-muted">
          Across connected providers &middot; Q&#8209;Agent learns each project before it tests
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Projects</h1>
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        {SAMPLE_PROJECTS.map((p, i) => (
          <ProjectCard
            key={p.name}
            project={p}
            knowledge={byName.get(p.name)}
            index={i}
            onOpen={() => openProject(p.name)}
            onBuild={() => build(p)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  knowledge,
  index,
  onOpen,
  onBuild,
}: {
  project: SampleProject;
  knowledge: ProjectKnowledgeOut | undefined;
  index: number;
  onOpen: () => void;
  onBuild: () => void;
}) {
  const status = knowledge?.status ?? "not_indexed";
  const indexed = status === "indexed";
  const confidence = knowledge?.confidence ?? 0;
  const [statusLabel, statusColor, statusBg, statusDot] = knowledgeStatusStyle(status);
  const [glyph, glyphBg] = providerGlyph[project.providerKind] ?? ["?", "#6b7280"];
  const glyphColor = project.providerKind === "github" ? "#12121a" : "#fff";
  const lastIndexed = indexed && knowledge?.lastIndexed
    ? new Date(knowledge.lastIndexed).toLocaleDateString()
    : "Never";

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
          <div className="truncate font-mono text-[11px] text-[#8b8b9e]">{project.repo}</div>
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
        <Field label="Framework" value={project.framework} />
        <Field label="Provider" value={project.provider} />
      </div>

      {indexed ? (
        <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-[11.5px] text-[#8b8b9e]">
            <b className="text-ink-soft">{project.tickets}</b> tickets &middot;{" "}
            <b className="text-ink-soft">{project.runs}</b> runs
          </span>
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
            onBuild();
          }}
        >
          <Sparkles size={15} strokeWidth={2.2} /> Build Project Knowledge
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
