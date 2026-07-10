/**
 * Getting Started / User Guide — a comprehensive in-app manual for Q-Agent.
 *
 * A single scrollable page of GlassCard sections that explains what Q-Agent is,
 * its core concepts, the 8-stage run pipeline (mirroring RunSidebar's PIPELINE),
 * a first-run walkthrough, provider/credential setup, and a short FAQ. The hero
 * offers two CTAs: launch the interactive product tour, or seed + open a live
 * sample run to explore hands-on.
 */
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  Rocket,
  Compass,
  BookOpen,
  FolderGit2,
  Ticket,
  SquareStack,
  Library,
  ListChecks,
  Sparkles,
  ClipboardCheck,
  GitBranch,
  FlaskConical,
  PlayCircle,
  Camera,
  MessageSquare,
  Loader2,
  PlugZap,
  KeyRound,
  HelpCircle,
} from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { useTour } from "@/store/tour";
import { useEnsureSampleRun } from "@/hooks/queries";

/** A single core concept, rendered as a card in the concepts grid. */
interface Concept {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  body: string;
}

const CONCEPTS: Concept[] = [
  {
    icon: FolderGit2,
    title: "Projects",
    body: "A product or repo you test. Each project wires up its work-item source and the codebase Q-Agent generates automation against.",
  },
  {
    icon: Ticket,
    title: "Tickets",
    body: "Work items synced live from Azure DevOps or Jira. They're the raw input the AI reads to draft test cases.",
  },
  {
    icon: SquareStack,
    title: "Runs",
    body: "A batch QA session over a set of selected tickets. A run carries its own cases, automation, execution results, and evidence.",
  },
  {
    icon: Library,
    title: "Knowledge bases",
    body: "Per-repo indexed context. Q-Agent reads your code so the cases and Playwright specs it writes fit how your app actually works.",
  },
];

/** One stage of the run pipeline — mirrors RunSidebar's PIPELINE order/labels. */
interface Stage {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  what: string;
}

const PIPELINE: Stage[] = [
  { icon: ListChecks, label: "Sync & Select", what: "Pull the latest tickets from your provider and pick the ones this run should cover." },
  { icon: Sparkles, label: "Analyze", what: "The AI reads each ticket against your knowledge base and drafts candidate test cases." },
  { icon: ClipboardCheck, label: "Review", what: "Approve, edit, or reject the AI-generated cases before anything leaves Q-Agent." },
  { icon: GitBranch, label: "Link", what: "Create the reviewed cases in your provider and link them back to their source tickets." },
  { icon: FlaskConical, label: "Automation", what: "Generate runnable Playwright specs from the approved cases." },
  { icon: PlayCircle, label: "Execution", what: "Run the generated scripts and collect pass/fail results per case." },
  { icon: Camera, label: "Evidence", what: "Capture screenshots, video, and a trace for every executed case." },
  { icon: MessageSquare, label: "Publish", what: "Post the results and evidence back onto the originating tickets." },
];

/** A numbered step in the "Your first run" walkthrough. */
const FIRST_RUN: { title: string; body: string }[] = [
  { title: "Connect a provider", body: "In Settings, link your work-item source (ADO or Jira) and the repo you want automation written against." },
  { title: "Sync tickets", body: "Pull your backlog into Q-Agent. Use Basic or Advanced filters to reflect exactly what you care about." },
  { title: "Select & create a run", body: "Pick the tickets to cover, then spin them into a new run — your workspace for this QA session." },
  { title: "Review the cases", body: "Open Review and approve or refine the AI-drafted cases. Nothing is created upstream until you say so." },
  { title: "Link them upstream", body: "Push the approved cases into your provider and link them to their tickets from the Link stage." },
  { title: "Generate automation", body: "From Automation, turn the cases into Playwright specs tailored to your codebase." },
  { title: "Execute", body: "Run the scripts from Execution and watch pass/fail results land per case." },
  { title: "Review evidence & publish", body: "Inspect the captured screenshots, video, and traces, then Publish the outcome back to the tickets." },
];

/** A single FAQ entry. */
const FAQ: { q: string; a: string }[] = [
  { q: "Do I need real credentials to explore?", a: "No. Click “Explore the sample run” above to open a fully-populated run with no setup." },
  { q: "How do I re-watch the tour?", a: "Open the command palette (⌘K) and choose “Start product tour” any time." },
  { q: "Where do my runs live?", a: "Runs are private to you — only you see the runs you create." },
  { q: "Can I edit what the AI drafts?", a: "Yes. The Review stage exists precisely so you approve or edit every case before it's linked upstream." },
];

export function GettingStarted() {
  const navigate = useNavigate();
  const startTour = useTour((s) => s.start);
  const ensureSample = useEnsureSampleRun();

  const openSampleRun = () => {
    ensureSample.mutate(undefined, {
      onSuccess: (run) => navigate(`/runs/${run.id}`),
    });
  };

  return (
    <div className="px-1 pb-10 pt-0.5">
      {/* Hero */}
      <div className="mb-[22px]">
        <div className="mb-[5px] text-[13px] font-medium text-muted">User guide · Q-Agent</div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Getting Started</h1>
        <p className="mb-0 mt-2.5 max-w-[640px] text-[13.5px] leading-relaxed text-ink-dim">
          Everything you need to go from a backlog of tickets to reviewed, automated, executed, and
          evidenced test runs. Skim it, or jump straight in with the tour or a live sample run.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button variant="primary" onClick={startTour}>
            <Compass size={15} /> Take the product tour
          </Button>
          <Button variant="glass" onClick={openSampleRun} disabled={ensureSample.isPending}>
            {ensureSample.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Rocket size={15} />
            )}
            {ensureSample.isPending ? "Preparing sample…" : "Explore the sample run"}
          </Button>
        </div>
      </div>

      {/* What is Q-Agent */}
      <GlassCard index={0} className="mb-3.5 p-6">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[11px]"
            style={{ background: "linear-gradient(135deg,rgba(139,92,246,.22),rgba(34,211,238,.12))", color: "#c4b5fd" }}
          >
            <BookOpen size={18} strokeWidth={2} />
          </span>
          <h2 className="m-0 text-[17px] font-extrabold tracking-tight">What is Q-Agent?</h2>
        </div>
        <p className="m-0 max-w-[760px] text-[13.5px] leading-relaxed text-ink-soft">
          Q-Agent is an AI-native QA operating system. It turns the tickets in your backlog into
          reviewed, automated, executed, and evidenced test runs — end to end. Instead of writing
          test cases and Playwright scripts by hand, you point Q-Agent at your work items and
          codebase; it drafts the cases, you review them, and it generates the automation, runs it,
          captures the evidence, and reports back to the tickets.
        </p>
        <p className="m-0 mt-3 max-w-[760px] text-[13.5px] leading-relaxed text-ink-dim">
          You stay in control at every step — the AI proposes, you approve. Nothing is created in
          your provider until you say so.
        </p>
      </GlassCard>

      {/* Core concepts */}
      <div className="mb-1.5 mt-6 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted">
        CORE CONCEPTS
      </div>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {CONCEPTS.map((c, i) => {
          const Icon = c.icon;
          return (
            <GlassCard key={c.title} index={i} hover className="p-[18px]">
              <span
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-[11px]"
                style={{ background: "rgba(139,92,246,.14)", color: "#c4b5fd" }}
              >
                <Icon size={17} strokeWidth={2} />
              </span>
              <div className="mb-1.5 text-[14px] font-bold tracking-tight">{c.title}</div>
              <p className="m-0 text-[12.5px] leading-relaxed text-ink-dim">{c.body}</p>
            </GlassCard>
          );
        })}
      </div>

      {/* The run pipeline */}
      <div className="mb-1.5 mt-6 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted">
        THE RUN PIPELINE
      </div>
      <GlassCard index={0} className="mb-3.5 p-6">
        <h2 className="m-0 mb-1 text-[17px] font-extrabold tracking-tight">Eight stages, one run</h2>
        <p className="m-0 mb-5 max-w-[720px] text-[13px] leading-relaxed text-ink-dim">
          Every run moves through the same pipeline — the exact stages you'll see in the run
          workspace sidebar. Each one hands off to the next.
        </p>
        <div className="relative flex flex-col gap-px">
          {/* connector rail behind the nodes (node center ≈ 18px from the left) */}
          <div className="absolute bottom-6 left-[18px] top-6 w-0.5 bg-white/[0.09]" />
          {PIPELINE.map((stage, i) => {
            const Icon = stage.icon;
            return (
              <div key={stage.label} className="flex items-start gap-[13px] rounded-[11px] px-2 py-2.5">
                <span
                  className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white"
                  style={{
                    background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
                    boxShadow: "0 0 0 4px rgba(139,92,246,.14)",
                  }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <Icon size={15} strokeWidth={2} className="text-violet" />
                    <span className="text-[14px] font-bold tracking-tight">{stage.label}</span>
                  </div>
                  <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-dim">{stage.what}</p>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Your first run */}
      <div className="mb-1.5 mt-6 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted">
        YOUR FIRST RUN
      </div>
      <GlassCard index={0} className="mb-3.5 p-6">
        <h2 className="m-0 mb-1 text-[17px] font-extrabold tracking-tight">From zero to published</h2>
        <p className="m-0 mb-5 max-w-[720px] text-[13px] leading-relaxed text-ink-dim">
          The full happy path, once. After the first time it becomes second nature.
        </p>
        <ol className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2">
          {FIRST_RUN.map((step, i) => (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-[13px] p-3"
              style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.05)" }}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-[#c4b5fd]" style={{ background: "rgba(139,92,246,.16)" }}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold tracking-tight">{step.title}</div>
                <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-ink-dim">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </GlassCard>

      {/* Providers & Claude credentials */}
      <div className="mb-1.5 mt-6 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted">
        PROVIDERS & CREDENTIALS
      </div>
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <GlassCard index={0} className="p-[22px]">
          <span
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-[11px]"
            style={{ background: "rgba(34,211,238,.13)", color: "#22d3ee" }}
          >
            <PlugZap size={17} strokeWidth={2} />
          </span>
          <div className="mb-1.5 text-[14px] font-bold tracking-tight">Provider connections</div>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-dim">
            In Settings, connect a work-item source — Azure DevOps or Jira — so Q-Agent can sync
            tickets and publish results. Connect the repo you want automation generated against so
            the AI has real code context.
          </p>
        </GlassCard>
        <GlassCard index={1} className="p-[22px]">
          <span
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-[11px]"
            style={{ background: "rgba(139,92,246,.14)", color: "#c4b5fd" }}
          >
            <KeyRound size={17} strokeWidth={2} />
          </span>
          <div className="mb-1.5 text-[14px] font-bold tracking-tight">Claude credentials</div>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-dim">
            Claude credentials are per-user and set in Settings. They power the analysis and
            generation stages, and they stay private to your account — you manage your own.
          </p>
        </GlassCard>
      </div>

      {/* Tips & FAQ */}
      <div className="mb-1.5 mt-6 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted">
        TIPS & FAQ
      </div>
      <GlassCard index={0} className="mb-3.5 p-6">
        <div className="flex flex-col gap-3.5">
          {FAQ.map((item) => (
            <div key={item.q} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-violet">
                <HelpCircle size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold tracking-tight">{item.q}</div>
                <p className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-ink-dim">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2.5 border-t border-white/[0.06] pt-5">
          <Button variant="primary" onClick={startTour}>
            <Compass size={15} /> Take the product tour
          </Button>
          <Button variant="glass" onClick={openSampleRun} disabled={ensureSample.isPending}>
            {ensureSample.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Rocket size={15} />
            )}
            {ensureSample.isPending ? "Preparing sample…" : "Explore the sample run"}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
