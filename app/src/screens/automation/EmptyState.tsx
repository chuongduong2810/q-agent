import { FileCode, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * "No automation yet" empty state. Offers generation when there are approved,
 * automatable cases; otherwise explains how to get some.
 *
 * @param automatableCount Number of approved, non-Manual cases ready to automate.
 * @param generating Whether generation is currently in flight (disables the button).
 * @param onGenerate Kicks off incremental generation.
 */
export function NoAutomationEmptyState({
  automatableCount,
  generating,
  onGenerate,
}: {
  automatableCount: number;
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
      <div
        className="mb-5 flex h-[70px] w-[70px] items-center justify-center rounded-[22px]"
        style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
      >
        <FileCode size={30} color="#a78bfa" strokeWidth={1.9} />
      </div>
      <h2 className="m-0 mb-2 text-xl font-extrabold">No automation yet</h2>
      {automatableCount > 0 ? (
        <>
          <p className="m-0 mb-[22px] max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
            {automatableCount} approved case{automatableCount === 1 ? "" : "s"} ready to automate.
            Generate Playwright specs from them.
          </p>
          <Button variant="primary" size="lg" onClick={onGenerate} disabled={generating}>
            <Sparkles size={16} strokeWidth={2.2} /> Generate automation
          </Button>
        </>
      ) : (
        <p className="m-0 max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
          No approved, automatable cases in this run. Approve non-Manual test cases in the Review
          Center, then generate automation here.
        </p>
      )}
    </div>
  );
}
