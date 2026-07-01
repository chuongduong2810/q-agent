import { RefreshCw, FolderKanban } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { providerGlyph } from "@/components/ui/badges";
import { useProjects, useRefreshProjects } from "@/hooks/queries";
import { useUI } from "@/store/ui";
import type { ProjectOut, ProviderKind } from "@/types/api";

/** Design's showcase project cards (Q-Agent.dc.html lines 807-811) — shown
 * when no provider is connected yet so the grid isn't empty on first run. */
const SAMPLE_PROJECTS: Array<{
  name: string;
  provider: string;
  providerKind: ProviderKind;
  tickets: number;
  runs: number;
  rate: string;
  active: boolean;
}> = [
  { name: "Surency Platform", provider: "Azure DevOps", providerKind: "ado", tickets: 42, runs: 1, rate: "94%", active: true },
  { name: "Surency Mobile", provider: "Azure DevOps", providerKind: "ado", tickets: 28, runs: 0, rate: "91%", active: false },
  { name: "Claims Portal", provider: "Jira", providerKind: "jira", tickets: 63, runs: 0, rate: "97%", active: false },
];

const providerLabel: Record<ProviderKind, string> = {
  ado: "Azure DevOps",
  jira: "Jira",
  github: "GitHub",
};

interface ProjectCard {
  key: string;
  name: string;
  provider: string;
  providerKind: ProviderKind;
  tickets: number;
  runs: number;
  rate: string;
  active: boolean;
  open: () => void;
}

export function Projects() {
  const { data: projects, isLoading } = useProjects();
  const refresh = useRefreshProjects();
  const openProject = useUI((s) => s.openProject);

  const usingSamples = !isLoading && (projects?.length ?? 0) === 0;
  const cards: ProjectCard[] = usingSamples
    ? SAMPLE_PROJECTS.map((p) => ({ key: p.name, ...p, open: () => openProject(p.name) }))
    : (projects ?? []).map((p: ProjectOut) => ({
        key: String(p.id),
        name: p.name,
        provider: providerLabel[p.providerKind],
        providerKind: p.providerKind,
        // Ticket/run/pass-rate counts per project have no dedicated endpoint yet
        // (ProjectOut only carries id/name/active/meta) — meta is provider-defined
        // and not guaranteed to include these, so fall back to 0/—.
        tickets: typeof p.meta?.tickets === "number" ? p.meta.tickets : 0,
        runs: typeof p.meta?.runs === "number" ? p.meta.runs : 0,
        rate: typeof p.meta?.rate === "string" ? p.meta.rate : "—",
        active: p.active,
        open: () => openProject(p.name),
      }));

  const providerCount = new Set(cards.map((c) => c.providerKind)).size || 2;

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-muted">
            Across {providerCount} connected provider{providerCount === 1 ? "" : "s"}
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Projects</h1>
        </div>
        <Button variant="glass" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? <Spinner size={13} /> : <RefreshCw size={15} strokeWidth={2.2} />}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} />
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={28} className="text-muted" />}
          title="No projects yet"
          body="Connect a provider in Settings and refresh to pull in your projects."
          action={
            <Button variant="primary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              {refresh.isPending ? <Spinner size={13} /> : <RefreshCw size={15} strokeWidth={2.2} />}
              Refresh projects
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
          {cards.map((p, i) => {
            const [glyph, glyphBg] = providerGlyph[p.providerKind] ?? ["?", "#6b7280"];
            const glyphColor = p.providerKind === "github" ? "#12121a" : "#fff";
            return (
              <GlassCard
                key={p.key}
                hover
                index={i}
                onClick={p.open}
                className="p-5"
                style={{ borderColor: p.active ? "rgba(139,92,246,.3)" : "rgba(255,255,255,.07)" }}
              >
                <div className="mb-4 flex items-center gap-[11px]">
                  <div
                    className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] text-[15px] font-black"
                    style={{ background: glyphBg, color: glyphColor }}
                  >
                    {glyph}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{p.name}</div>
                    <div className="text-[11px] text-muted">{p.provider}</div>
                  </div>
                  {p.active && (
                    <span
                      className="rounded-full px-[9px] py-[3px] text-[10px] font-bold"
                      style={{ background: "rgba(139,92,246,.24)", color: "#c4b5fd" }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div className="flex gap-[18px]">
                  <div>
                    <div className="text-[20px] font-black">{p.tickets}</div>
                    <div className="text-[11px] text-muted">tickets</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-black text-[#a78bfa]">{p.runs}</div>
                    <div className="text-[11px] text-muted">active runs</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-black text-[#6ee7b7]">{p.rate}</div>
                    <div className="text-[11px] text-muted">pass rate</div>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
