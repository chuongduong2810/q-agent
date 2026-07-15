import { Command } from "cmdk";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CheckSquare,
  Compass,
  CornerDownLeft,
  Image,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings as SettingsIcon,
  SquareStack,
  Star,
  Terminal,
  Ticket,
} from "lucide-react";
import { type ComponentType, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useRunRouteId } from "@/hooks/useRunRouteId";
import { useTour } from "@/store/tour";
import { useUI } from "@/store/ui";

/** Section headings, rendered in this order as grouped blocks. */
const SECTIONS = ["Actions", "Navigate"] as const;
type Section = (typeof SECTIONS)[number];

interface PaletteCommand {
  id: string;
  label: string;
  /** Sub-label shown beneath the command name. */
  description: string;
  section: Section;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  run: () => void;
  /** Reachable only from within a run (workspace mode) — hidden off run routes. */
  runScoped?: boolean;
}

/** Command palette overlay (⌘K) — cmdk-driven, matching Q-Agent.dc.html lines
 * 556-564 (frosted overlay, scaleIn card, ⌘K input, grouped result list). */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const query = useUI((s) => s.paletteQuery);
  const setQuery = useUI((s) => s.setPaletteQuery);
  const closePalette = useUI((s) => s.closePalette);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const { t } = useTranslation("commands");
  const navigate = useNavigate();
  const runId = useRunRouteId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const go = (path: string) => () => {
    navigate(path);
    closePalette();
  };
  // Run-scoped commands only exist inside a run, so `runId` is always set when
  // they're reachable (they're filtered out off run routes below).
  const runPath = (seg: string) => `/runs/${runId}/${seg}`;

  const commands: PaletteCommand[] = [
    {
      id: "create-run",
      label: t("items.create-run.label"),
      description: t("items.create-run.description"),
      section: "Actions",
      icon: Plus,
      run: () => {
        openCreateRun();
        closePalette();
      },
    },
    {
      id: "start-tour",
      label: t("items.start-tour.label"),
      description: t("items.start-tour.description"),
      section: "Actions",
      icon: Compass,
      run: () => {
        closePalette();
        useTour.getState().start();
      },
    },
    { id: "run-execution", label: t("items.run-execution.label"), description: t("items.run-execution.description"), section: "Actions", icon: Terminal, run: go(runPath("execution")), runScoped: true },
    { id: "dashboard", label: t("items.dashboard.label"), description: t("items.dashboard.description"), section: "Navigate", icon: LayoutDashboard, run: go("/") },
    { id: "tickets", label: t("items.tickets.label"), description: t("items.tickets.description"), section: "Navigate", icon: Ticket, run: go("/tickets") },
    { id: "runs", label: t("items.runs.label"), description: t("items.runs.description"), section: "Navigate", icon: SquareStack, run: go("/runs") },
    { id: "review", label: t("items.review.label"), description: t("items.review.description"), section: "Navigate", icon: CheckSquare, run: go(runPath("review")), runScoped: true },
    { id: "automation", label: t("items.automation.label"), description: t("items.automation.description"), section: "Navigate", icon: Terminal, run: go(runPath("automation")), runScoped: true },
    { id: "console", label: t("items.console.label"), description: t("items.console.description"), section: "Navigate", icon: ListChecks, run: go(runPath("execution")), runScoped: true },
    { id: "evidence", label: t("items.evidence.label"), description: t("items.evidence.description"), section: "Navigate", icon: Image, run: go(runPath("evidence")), runScoped: true },
    { id: "reports", label: t("items.reports.label"), description: t("items.reports.description"), section: "Navigate", icon: BarChart3, run: go("/reports") },
    { id: "settings", label: t("items.settings.label"), description: t("items.settings.description"), section: "Navigate", icon: SettingsIcon, run: go("/settings") },
  ];

  // Run-scoped screens (Review/Automation/Execution/Evidence) are reachable only
  // from within a run — hide them unless the URL already resolves a run.
  const visibleCommands = commands.filter((c) => !c.runScoped || runId != null);

  return (
    <div
      onClick={closePalette}
      className="fixed inset-0 z-50 flex items-start justify-center animate-[fadeInUp_.2s_ease_both] pt-[14vh]"
      style={{ background: "rgba(6,6,10,.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[min(600px,92vw)] overflow-hidden rounded-[20px] border border-white/[0.11] shadow-[0_40px_90px_-20px_rgba(0,0,0,.8)]"
        style={{ background: "rgba(24,24,32,.9)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)" }}
      >
        {/* NB: the search text is controlled on `Command.Input` only. The root
            `Command`'s `value`/`onValueChange` is the *selected item*, not the
            query — binding it to `query` fed the highlighted item's label back
            into the search box, collapsing the list to a single result. */}
        <Command shouldFilter label={t("label")}>
          <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
            </svg>
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              className="flex-1 border-none bg-transparent text-[16px] text-ink outline-none placeholder:text-[#7a7a8c]"
            />
            <span className="rounded-md bg-white/[0.06] px-2 py-[3px] font-mono text-[11px] text-[#8b8b9e]">ESC</span>
          </div>
          <Command.List className="max-h-[340px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-[#6a6a7c]">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-dim">{t("empty")}</Command.Empty>
            {SECTIONS.map((section) => (
              <Command.Group key={section} heading={t(`sections.${section}`)}>
                {visibleCommands
                  .filter((cmd) => cmd.section === section)
                  .map((cmd) => {
                    const Icon = cmd.icon;
                    return (
                      <Command.Item
                        key={cmd.id}
                        value={cmd.label}
                        onSelect={cmd.run}
                        className="group flex w-full cursor-pointer items-center gap-[13px] rounded-xl px-[13px] py-[9px] text-left data-[selected=true]:bg-[rgba(139,92,246,.16)]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06] text-ink-soft">
                          <Icon size={16} strokeWidth={2} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] font-semibold text-ink">{cmd.label}</span>
                          <span className="truncate text-[12px] text-[#7a7a8c]">{cmd.description}</span>
                        </span>
                        <ArrowRight
                          size={15}
                          strokeWidth={2}
                          className="shrink-0 text-[#5a5a6c] transition group-data-[selected=true]:translate-x-0.5 group-data-[selected=true]:text-[#a78bfa]"
                        />
                      </Command.Item>
                    );
                  })}
              </Command.Group>
            ))}
          </Command.List>
          <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-[#7a7a8c]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <kbd className="flex h-5 min-w-5 items-center justify-center rounded-md bg-white/[0.06] px-1">
                  <CornerDownLeft size={11} strokeWidth={2} />
                </kbd>
                {t("footer.open")}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="flex h-5 min-w-5 items-center justify-center rounded-md bg-white/[0.06] px-1 font-mono">
                  ↑↓
                </kbd>
                {t("footer.navigate")}
              </span>
            </div>
            <span className="flex items-center gap-1.5 font-medium">
              <Star size={11} strokeWidth={2} style={{ color: "#fbbf24" }} fill="#fbbf24" />
              {t("footer.poweredBy")}
            </span>
          </div>
        </Command>
      </motion.div>
    </div>
  );
}
