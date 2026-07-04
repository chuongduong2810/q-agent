import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { MultiSelect, Select } from "@/components/ui/Dropdown";
import { StatusBadge, priorityColor, providerGlyph } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/misc";
import {
  useProviders,
  useSettings,
  useSprints,
  useSyncTickets,
  useTickets,
  useWorkItemMetadata,
} from "@/hooks/queries";
import { useUI, type TicketFilter } from "@/store/ui";
import type { ProviderKind, TicketFilters, TicketOut } from "@/types/api";

const FILTERS: { id: TicketFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "My tickets" },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Tickets() {
  const ticketFilter = useUI((s) => s.ticketFilter);
  const setTicketFilter = useUI((s) => s.setTicketFilter);
  const ticketSearch = useUI((s) => s.ticketSearch);
  const setTicketSearch = useUI((s) => s.setTicketSearch);
  const selected = useUI((s) => s.selected);
  const toggleSelected = useUI((s) => s.toggleSelected);
  const setSelected = useUI((s) => s.setSelected);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const navigate = useNavigate();
  const selectedSprint = useUI((s) => s.selectedSprint);
  const setSelectedSprint = useUI((s) => s.setSelectedSprint);
  const areaPath = useUI((s) => s.areaPath);
  const setAreaPath = useUI((s) => s.setAreaPath);
  const states = useUI((s) => s.states);
  const setStates = useUI((s) => s.setStates);
  const workItemTypes = useUI((s) => s.workItemTypes);
  const setWorkItemTypes = useUI((s) => s.setWorkItemTypes);

  // Pick the connected provider (ADO preferred, then Jira) for metadata + sync.
  const { data: providers } = useProviders();
  const providerKind: ProviderKind = useMemo(() => {
    const connected = (providers ?? []).filter((p) => p.connected);
    return (
      connected.find((p) => p.kind === "ado")?.kind ??
      connected.find((p) => p.kind === "jira")?.kind ??
      "ado"
    );
  }, [providers]);
  const { data: sprints } = useSprints(providerKind);
  const { data: metadata } = useWorkItemMetadata(providerKind);

  // "Assigned to me" resolves against the configured identity (Settings → Profile).
  const { data: settings } = useSettings();
  const userName = (settings?.userName ?? "").trim();

  // Combine every active filter into the ticket query.
  const filters: TicketFilters = {
    assignee: ticketFilter === "mine" && userName ? userName : undefined,
    sprint: selectedSprint?.name,
    areaPath: areaPath || undefined,
    states: states.length ? states.join(",") : undefined,
    workItemTypes: workItemTypes.length ? workItemTypes.join(",") : undefined,
    q: ticketSearch || undefined,
  };
  const { data: tickets, isLoading } = useTickets(filters);
  const syncTickets = useSyncTickets();

  const selCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const sprintOptions = (sprints ?? []).map((s) => ({ value: s.path, label: s.name }));
  const areaOptions = (metadata?.areaPaths ?? []).map((a) => ({ value: a.path, label: a.name, hint: a.path }));
  const stateOptions = (metadata?.states ?? []).map((s) => ({ value: s, label: s }));
  const typeOptions = (metadata?.workItemTypes ?? []).map((t) => ({ value: t, label: t }));

  const onPickSprint = (path: string | null) => {
    const sprint = path ? (sprints ?? []).find((s) => s.path === path) : null;
    setSelectedSprint(sprint ? { name: sprint.name, path: sprint.path } : null);
  };

  const selectAssigned = () => {
    if (!userName) return;
    const ids = (tickets ?? []).filter((t) => t.assignee === userName).map((t) => t.externalId);
    setSelected(ids);
  };

  const handleSync = () => {
    syncTickets.mutate(
      {
        providerKind,
        mode: selectedSprint ? "sprint" : "all",
        sprint: selectedSprint?.name,
        sprintPath: selectedSprint?.path,
        areaPath: areaPath || undefined,
        states,
        workItemTypes,
      },
      {
        onSuccess: (res) => toast.success(`Synced ${res.synced} ticket${res.synced === 1 ? "" : "s"}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
      },
    );
  };

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            Surency Platform &middot; Synced 12m ago
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Tickets</h1>
        </div>
      </div>

      <div className="glass mb-4 flex flex-wrap items-center gap-[9px] rounded-2xl p-[12px_14px]">
        <div className="flex h-9 max-w-[280px] min-w-[180px] flex-1 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.04] px-3">
          <Search size={14} color="#7a7a8c" strokeWidth={2} />
          <input
            value={ticketSearch}
            onChange={(e) => setTicketSearch(e.target.value)}
            placeholder="Search tickets…"
            className="flex-1 border-none bg-transparent text-[13px] text-ink outline-none"
          />
        </div>

        {FILTERS.filter((f) => f.id !== "mine" || !!userName).map((f) => {
          const active = ticketFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setTicketFilter(f.id)}
              className="cursor-pointer rounded-[11px] px-[13px] py-2 text-[12.5px] font-semibold transition-colors"
              style={
                active
                  ? { background: "linear-gradient(135deg,#8b5cf6,#6366f1)", border: "1px solid transparent", color: "#fff" }
                  : { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", color: "#dcdce4" }
              }
            >
              {f.label}
            </button>
          );
        })}

        <Select
          value={selectedSprint?.path ?? null}
          options={sprintOptions}
          placeholder="Sprint"
          onChange={onPickSprint}
          emptyLabel="No sprints found"
        />
        <Select
          value={areaPath}
          options={areaOptions}
          placeholder="Area path"
          onChange={setAreaPath}
          emptyLabel="No area paths"
        />
        <MultiSelect
          values={states}
          options={stateOptions}
          placeholder="States"
          onChange={setStates}
        />
        <MultiSelect
          values={workItemTypes}
          options={typeOptions}
          placeholder="Work item types"
          onChange={setWorkItemTypes}
        />
        {userName && (
          <button
            onClick={selectAssigned}
            className="cursor-pointer rounded-[11px] border border-white/[0.09] bg-white/[0.05] px-[13px] py-2 text-[12.5px] font-semibold text-[#dcdce4] hover:bg-white/[0.1]"
          >
            Select my assigned
          </button>
        )}

        <div className="ml-auto flex items-center gap-[9px]">
          <Button variant="glass" onClick={handleSync} disabled={syncTickets.isPending}>
            <RefreshCw size={13} className={syncTickets.isPending ? "animate-[spin_.7s_linear_infinite]" : ""} />
            {syncTickets.isPending ? "Syncing…" : "Sync"}
          </Button>
          <Button variant="primary" onClick={openCreateRun}>
            <Plus size={14} strokeWidth={2.3} />
            Create Run {selCount > 0 && `(${selCount})`}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass h-[64px] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : !tickets?.length ? (
        <EmptyState
          icon={<Search size={28} color="#8b8b9e" strokeWidth={1.6} />}
          title="No tickets found"
          body="Try a different filter or sync tickets from your provider."
        />
      ) : (
        <div className="flex flex-col gap-[10px]">
          {tickets.map((tk, i) => (
            <TicketRow
              key={tk.externalId}
              ticket={tk}
              selected={!!selected[tk.externalId]}
              onToggle={() => toggleSelected(tk.externalId)}
              onOpen={() => navigate(`/tickets/${encodeURIComponent(tk.externalId)}`)}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketRow({
  ticket,
  selected,
  onToggle,
  onOpen,
  index,
}: {
  ticket: TicketOut;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  index: number;
}) {
  const [glyph, glyphColor] = providerGlyph[ticket.providerKind] ?? ["?", "#8b8b9e"];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.03, 0.24), ease: "easeOut" }}
      className="glass flex items-center gap-[15px] rounded-2xl p-[15px_18px] transition-colors hover:border-[rgba(139,92,246,.28)]"
      style={{ borderColor: selected ? "rgba(139,92,246,.5)" : undefined }}
    >
      <div
        onClick={onToggle}
        className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border transition-colors"
        style={{
          background: selected ? "linear-gradient(135deg,#8b5cf6,#6366f1)" : "rgba(255,255,255,.04)",
          borderColor: selected ? "transparent" : "rgba(255,255,255,.18)",
        }}
      >
        {selected && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </div>

      <div
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[14px] font-black"
        style={{ color: glyphColor, background: `${glyphColor}26` }}
      >
        {glyph}
      </div>

      <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
        <div className="mb-[3px] flex items-center gap-[9px]">
          <span className="font-mono text-[11.5px] font-semibold text-violet">{ticket.externalId}</span>
          <span className="text-[10.5px] text-[#7a7a8c]">{ticket.sprint}</span>
        </div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14.5px] font-semibold">
          {ticket.title}
        </div>
      </div>

      <StatusBadge status={ticket.status} />

      <span className="w-[74px] shrink-0 text-right text-[11px] text-ink-dim">
        {ticket.acCount} AC &middot; <span style={{ color: priorityColor(ticket.priority) }}>{ticket.priority}</span>
      </span>

      <div className="accent-gradient flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] text-[10.5px] font-bold text-white">
        {initials(ticket.assignee)}
      </div>

      <Button variant="glass" size="sm" onClick={onOpen} className="shrink-0">
        Details
      </Button>
    </motion.div>
  );
}
