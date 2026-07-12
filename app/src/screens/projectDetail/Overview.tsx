import { ArrowRight, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { confidenceColor } from "@/data/projects";
import type { ProjectMeta } from "./types";

export function Overview({
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
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
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
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:gap-[18px]">
          <div className="flex min-w-0 flex-1 items-center gap-[18px]">
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
          </div>
          <Button variant="white" onClick={onView} className="w-full shrink-0 md:w-auto">
            View Project Knowledge <ArrowRight size={14} strokeWidth={2.3} />
          </Button>
        </div>
      </div>
    </>
  );
}
