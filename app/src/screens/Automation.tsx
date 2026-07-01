import { Check, Download, FileCode, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/GlassCard";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { EmptyState } from "@/components/ui/misc";
import { useGenerateAutomation, useRegenerateSpec, useRun, useSpecs } from "@/hooks/queries";
import { useRunSocket } from "@/hooks/useRunSocket";
import { useUI } from "@/store/ui";

const THINKING_STEPS = [
  "Reading approved test cases",
  "Mapping steps to Playwright locators",
  "Writing assertions",
  "Formatting TypeScript specs",
];

export function Automation() {
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);
  const { data: run } = useRun(activeRunId);
  const { data: specs, isLoading } = useSpecs(activeRunId);
  const generateAutomation = useGenerateAutomation(activeRunId ?? 0);
  const regenerateSpec = useRegenerateSpec(activeRunId ?? 0);
  useRunSocket(activeRunId);

  const selectedSpecCaseId = useUI((s) => s.selectedSpecCaseId);
  const selectSpec = useUI((s) => s.selectSpec);

  const [copyLabel, setCopyLabel] = useState("Copy");
  const [thinkStep, setThinkStep] = useState(0);

  const specCount = specs ? specs.length : 0;
  const thinking = generateAutomation.isPending || (isLoading && specCount === 0);

  useEffect(() => {
    if (!thinking) {
      setThinkStep(0);
      return;
    }
    const id = setInterval(() => {
      setThinkStep((n) => Math.min(n + 1, THINKING_STEPS.length - 1));
    }, 1100);
    return () => clearInterval(id);
  }, [thinking]);

  // Default to the first spec once the list loads.
  useEffect(() => {
    if (specs && specs.length && selectedSpecCaseId == null) {
      selectSpec(specs[0].testCaseId);
    }
  }, [specs, selectedSpecCaseId, selectSpec]);

  const selectedSpec = useMemo(
    () => specs?.find((s) => s.testCaseId === selectedSpecCaseId) ?? specs?.[0] ?? null,
    [specs, selectedSpecCaseId],
  );

  if (!activeRunId) {
    return (
      <div className="animate-fade-in-up px-1 pb-10 pt-0.5">
        <EmptyState
          icon={<Sparkles size={30} className="text-violet" />}
          title="No active run"
          body="Start a run and approve test cases before generating automation."
        />
      </div>
    );
  }

  const handleCopy = () => {
    if (!selectedSpec) return;
    navigator.clipboard.writeText(selectedSpec.code);
    setCopyLabel("Copied!");
    toast.success("Code copied to clipboard");
    setTimeout(() => setCopyLabel("Copy"), 1500);
  };

  const handleDownload = () => {
    if (!selectedSpec) return;
    const blob = new Blob([selectedSpec.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedSpec.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-in-up px-1 pb-10 pt-0.5">
      <div className="mb-3.5">
        <div className="mb-1 text-[13px] font-medium text-muted">
          {run?.code} &middot; Playwright · TypeScript · approved cases only
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Automation</h1>
      </div>
      <div className="mb-4">
        <PipelineRail stage={6} />
      </div>

      {thinking && (
        <GlassCard className="p-[26px]" style={{ borderColor: "rgba(139,92,246,.28)" }}>
          <div className="mb-[22px] flex items-center gap-[13px]">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[14px]"
              style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 0 26px rgba(139,92,246,.6)" }}
            >
              <Sparkles size={22} color="#fff" />
            </div>
            <div>
              <div className="text-[15px] font-bold">Writing Playwright automation</div>
              <div className="mt-0.5 text-xs text-muted">for every approved case in {run?.code}</div>
            </div>
          </div>
          <div className="flex flex-col gap-[13px]">
            {THINKING_STEPS.map((text, i) => {
              const done = i < thinkStep;
              const active = i === thinkStep;
              if (!done && !active) return null;
              return (
                <div key={text} className="flex items-center gap-3 text-[13.5px]">
                  {done ? (
                    <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-success">
                      <Check size={12} color="#fff" strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className="h-[19px] w-[19px] shrink-0 rounded-full border-2"
                      style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                    />
                  )}
                  <span className={done ? "text-muted" : "font-semibold text-ink"}>{text}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {!thinking && specs && specs.length === 0 && (
        <EmptyState
          icon={<FileCode size={30} className="text-violet" />}
          title="No automation yet"
          body="Approve test cases in Review Center, then generate automation to see specs here."
        />
      )}

      {!thinking && specs && specs.length > 0 && (
        <div className="grid grid-cols-[230px_1fr] items-start gap-3.5">
          <GlassCard className="p-2">
            <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold tracking-wider text-faint">
              APPROVED SPECS
            </div>
            <div className="flex flex-col gap-0.5">
              {specs.map((s) => {
                const active = selectedSpec?.testCaseId === s.testCaseId;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectSpec(s.testCaseId)}
                    className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-white/5"
                    style={active ? { background: "rgba(139,92,246,.14)" } : undefined}
                  >
                    <FileCode size={14} color={active ? "#a78bfa" : "#8b8b9e"} />
                    <span className="flex-1 truncate font-mono text-xs text-ink-soft">{s.filename}</span>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          <div
            className="overflow-hidden rounded-2xl border border-white/[0.09]"
            style={{ background: "rgba(8,8,13,.8)", backdropFilter: "blur(22px)" }}
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
              <span className="font-mono text-[12.5px] text-ink-soft">tests/{selectedSpec?.filename}</span>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(34,211,238,.13)", color: "#67e8f9" }}>
                TypeScript
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  onClick={() => selectedSpec && regenerateSpec.mutate(selectedSpec.testCaseId)}
                  disabled={regenerateSpec.isPending}
                  className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
                >
                  <RotateCcw size={13} />
                  Regenerate
                </button>
                <button
                  onClick={handleCopy}
                  className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10"
                >
                  {copyLabel}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10"
                >
                  <Download size={13} />
                  Download
                </button>
              </div>
            </div>
            <pre className="m-0 overflow-x-auto whitespace-pre px-5 py-[18px] font-mono text-[12.5px] leading-[1.75] text-ink">
              {selectedSpec ? <CodeHighlight code={selectedSpec.code} /> : null}
            </pre>
            <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-4 py-3.5">
              <span className="flex-1 text-xs text-muted">Execute the approved suite in parallel across the Run</span>
              <button
                onClick={() => navigate("console")}
                className="flex items-center gap-2 rounded-xl px-[18px] py-2.5 text-[13px] font-bold text-white"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 8px 22px -8px rgba(139,92,246,.8)" }}
              >
                <Play size={14} fill="#fff" />
                Run tests
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TS_KEYWORDS = new Set([
  "import", "export", "from", "const", "let", "var", "async", "await", "function",
  "test", "expect", "describe", "it", "return", "if", "else", "new", "class",
  "extends", "interface", "type", "for", "of", "in", "typeof",
]);
const TS_KEYWORD_SPLIT = /\b([a-zA-Z]+)\b/g;

/** Lightweight TypeScript syntax highlighter — strings, comments, keywords only. */
function CodeHighlight({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <div key={i}>{highlightLine(line) || " "}</div>
      ))}
    </>
  );
}

function highlightLine(line: string) {
  const tokens: { text: string; cls?: string }[] = [];
  const pattern = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line))) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    tokens.push({ text: m[0], cls: m[1] ? "cmt" : "str" });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });

  return tokens.map((t, i) => {
    if (t.cls === "cmt") return <span key={i} style={{ color: "#6c6c7e" }}>{t.text}</span>;
    if (t.cls === "str") return <span key={i} style={{ color: "#a5d6a7" }}>{t.text}</span>;
    const parts = t.text.split(TS_KEYWORD_SPLIT);
    return (
      <span key={i}>
        {parts.map((p, j) =>
          TS_KEYWORDS.has(p) ? (
            <span key={j} style={{ color: "#c792ea" }}>
              {p}
            </span>
          ) : (
            p
          ),
        )}
      </span>
    );
  });
}
