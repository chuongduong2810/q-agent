import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { KNOWLEDGE_STEPS } from "@/data/projects";
import { Spinner } from "@/components/ui/misc";
import { useUI } from "@/store/ui";

/** Full-screen "Learning <project>" overlay shown while the knowledge base builds. */
export function KnowledgeBuildOverlay() {
  const building = useUI((s) => s.knowledgeBuilding);
  const name = useUI((s) => s.buildProjectName);
  const step = useUI((s) => s.knowledgeStep);
  const tick = useUI((s) => s.tickKnowledgeStep);

  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => tick(KNOWLEDGE_STEPS.length - 1), 620);
    return () => clearInterval(id);
  }, [building, tick]);

  if (!building) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-[fadeInUp_.25s_ease_both]"
      style={{ background: "rgba(6,6,10,.78)", backdropFilter: "blur(10px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-[min(560px,94vw)] overflow-hidden rounded-[24px] border border-[rgba(139,92,246,.28)] shadow-[0_40px_100px_-20px_rgba(0,0,0,.85)]"
        style={{ background: "rgba(20,20,30,.94)", backdropFilter: "blur(40px)" }}
      >
        <div className="relative overflow-hidden p-[30px_30px_22px]">
          <div
            className="pointer-events-none absolute -right-[30px] -top-10 h-[220px] w-[220px] rounded-full"
            style={{
              background: "radial-gradient(circle,rgba(139,92,246,.4),transparent 65%)",
              filter: "blur(24px)",
              animation: "glowPulse 4s ease-in-out infinite",
            }}
          />
          <div className="relative flex items-center gap-3.5">
            <div
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
                boxShadow: "0 0 30px rgba(139,92,246,.7)",
                animation: "floaty 3s ease-in-out infinite",
              }}
            >
              <Sparkles size={26} color="#fff" strokeWidth={2.2} />
            </div>
            <div>
              <div className="text-[18px] font-extrabold tracking-tight">Learning {name}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-dim">
                Q&#8209;Agent is building the Project Knowledge Base
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-[3px] p-[6px_30px_30px]">
          {KNOWLEDGE_STEPS.map((text, i) => {
            if (i > step) return null;
            const done = i < step;
            return (
              <div key={text} className="flex items-center gap-[13px] py-2">
                {done ? (
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-success">
                    <Check size={13} color="#fff" strokeWidth={3} />
                  </span>
                ) : (
                  <Spinner size={22} />
                )}
                <span
                  className="text-[13.5px]"
                  style={{ color: done ? "#8b8b9e" : "#ececf1", fontWeight: done ? 400 : 600 }}
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
