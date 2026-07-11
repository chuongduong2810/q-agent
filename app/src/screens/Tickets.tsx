import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DropdownShell, MultiSelect, Select } from "@/components/ui/Dropdown";
import { StatusBadge, priorityColor, providerGlyph } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/misc";
import { PROVIDER_META, PROVIDER_ORDER } from "@/components/settings/providerMeta";
import { SyncTicketsModal } from "@/components/tickets/SyncTicketsModal";
import {
  useConnectionSprints,
  useConnectionWorkItemMetadata,
  useProviders,
  useTickets,
} from "@/hooks/queries";
import { useAuth } from "@/store/auth";
import { useUI, type TicketFilter } from "@/store/ui";
import type { ConnectionOut, ProviderKind, TicketFilters, TicketOut } from "@/types/api";

const FILTERS: { id: TicketFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "My tickets" },
];

const PRIORITY_OPTIONS = ["High", "Medium", "Low"].map((p) => ({ value: p, label: p }));

const PAGE_SIZE = 10;

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Primary left-most filter-bar pill: provider glyph + "Provider · connection".
 * Dropdown lists every work-item connection, grouped by provider. */
function ConnectionSelect({
  groups,
  value,
  onChange,
}: {
  groups: { kind: ProviderKind; connections: ConnectionOut[] }[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const selected = groups.flatMap((g) => g.connections).find((c) => c.id === value) ?? null;
  const meta = selected ? PROVIDER_META[selected.kind] : null;

  const label = selected && meta ? (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[10.5px] font-black"
        style={{ background: meta.color, color: meta.glyphColor }}
      >
        {meta.glyph}
      </span>
      <span className="truncate">
        {meta.name} &middot; {selected.name}
      </span>
    </span>
  ) : (
    "Select connection"
  );

  return (
    <DropdownShell active={!!selected} label={label} minWidth={240}>
      {(close) => (
        <>
          {groups.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-ink-dim">
              No work-item connections
            </div>
          )}
          {groups.map((g) => (
            <div key={g.kind} className="mb-1 last:mb-0">
              <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-dim">
                {PROVIDER_META[g.kind].name}
              </div>
              {g.connections.map((c) => {
                const on = c.id === value;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onChange(c.id);
                      close();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.06] data-[on=true]:bg-[rgba(139,92,246,.16)]"
                    data-on={on}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {on && <Check size={13} className="text-violet" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </>
      )}
    </DropdownShell>
  );
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
  const ticketPriority = useUI((s) => s.ticketPriority);
  const setTicketPriority = useUI((s) => s.setTicketPriority);
  const ticketEpic = useUI((s) => s.ticketEpic);
  const setTicketEpic = useUI((s) => s.setTicketEpic);
  const ticketPage = useUI((s) => s.ticketPage);
  const setTicketPage = useUI((s) => s.setTicketPage);
  const ticketConnectionId = useUI((s) => s.ticketConnectionId);
  const setTicketConnectionId = useUI((s) => s.setTicketConnectionId);

  // Connection scoping the ticket list, metadata, sprints + sync (ADR 0006).
  // Options are every connection with the work-item capability (ado/jira);
  // default to the first connected one, else the first available.
  const { data: providers } = useProviders();
  const workItemConnections = useMemo(
    () =>
      (providers ?? [])
        .flatMap((g) => g.connections)
        .filter((c) => c.categories.includes("work_item")),
    [providers],
  );
  const connectionGroups = useMemo(
    () =>
      PROVIDER_ORDER.map((kind) => ({
        kind,
        connections: workItemConnections.filter((c) => c.kind === kind),
      })).filter((g) => g.connections.length > 0),
    [workItemConnections],
  );
  const defaultConnId =
    workItemConnections.find((c) => c.connected)?.id ?? workItemConnections[0]?.id ?? null;
  useEffect(() => {
    if (ticketConnectionId == null && defaultConnId != null) {
      setTicketConnectionId(defaultConnId);
    }
  }, [ticketConnectionId, defaultConnId, setTicketConnectionId]);
  const connectionId = ticketConnectionId ?? defaultConnId;
  const selectedConn = workItemConnections.find((c) => c.id === connectionId) ?? null;
  const isJira = selectedConn?.kind === "jira";
  const isAdo = selectedConn?.kind === "ado";
  const { data: sprints } = useConnectionSprints(connectionId);
  const { data: metadata } = useConnectionWorkItemMetadata(connectionId);

  // "Assigned to me" resolves against the authenticated user (ADR 0007).
  const user = useAuth((s) => s.user);
  const userName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "";

  // Combine every active filter into the ticket query.
  const filters: TicketFilters = {
    connectionId: connectionId ?? undefined,
    providerKind: selectedConn?.kind,
    assignee: ticketFilter === "mine" && userName ? userName : undefined,
    sprint: selectedSprint?.name,
    areaPath: isAdo ? areaPath || undefined : undefined,
    states: states.length ? states.join(",") : undefined,
    workItemTypes: workItemTypes.length ? workItemTypes.join(",") : undefined,
    priority: ticketPriority || undefined,
    epic: isJira ? ticketEpic || undefined : undefined,
    q: ticketSearch || undefined,
    page: ticketPage,
    pageSize: PAGE_SIZE,
  };
  const { data: ticketsPage, isLoading } = useTickets(filters);
  const tickets = ticketsPage?.items ?? [];
  const total = ticketsPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [syncOpen, setSyncOpen] = useState(false);

  const selCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const sprintOptions = (sprints ?? []).map((s) => ({ value: s.path, label: s.name }));
  const areaOptions = (metadata?.areaPaths ?? []).map((a) => ({ value: a.path, label: a.name, hint: a.path }));
  const stateOptions = (metadata?.states ?? []).map((s) => ({ value: s, label: s }));
  const typeOptions = (metadata?.workItemTypes ?? []).map((t) => ({ value: t, label: t }));
  const epicOptions = (metadata?.epics ?? []).map((e) => ({ value: e.key, label: e.name }));

  const onPickSprint = (path: string | null) => {
    const sprint = path ? (sprints ?? []).find((s) => s.path === path) : null;
    setSelectedSprint(sprint ? { name: sprint.name, path: sprint.path } : null);
  };

  const selectAssigned = () => {
    if (!userName) return;
    const ids = tickets.filter((t) => t.assignee === userName).map((t) => t.externalId);
    setSelected(ids);
  };

  const syncSourceLabel = selectedConn
    ? `${PROVIDER_META[selectedConn.kind].name}${selectedConn.name ? ` · ${selectedConn.name}` : ""}`
    : "your provider";

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {(selectedConn ? `${PROVIDER_META[selectedConn.kind].name} · ${selectedConn.name}` : "No connection") +
              " · Synced 12m ago"}
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Tickets</h1>
        </div>
      </div>

      <div className="glass mb-4 flex flex-col gap-[10px] rounded-2xl p-[12px_14px]">
        {/* Row 1 — connection · search · view pills, actions pinned right */}
        <div className="flex flex-wrap items-center gap-[9px]">
          <ConnectionSelect groups={connectionGroups} value={connectionId} onChange={setTicketConnectionId} />

          <div className="flex h-9 max-w-[320px] min-w-[180px] flex-1 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.04] px-3">
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

          <div className="ml-auto flex items-center gap-[9px]">
            <Button variant="glass" onClick={() => setSyncOpen(true)}>
              <RefreshCw size={13} />
              Sync
            </Button>
            <Button variant="primary" onClick={openCreateRun}>
              <Plus size={14} strokeWidth={2.3} />
              Create Run {selCount > 0 && `(${selCount})`}
            </Button>
          </div>
        </div>

        {/* Row 2 — attribute filters */}
        <div className="flex flex-wrap items-center gap-[9px] border-t border-white/[0.06] pt-[10px]">
          <Select
            value={selectedSprint?.path ?? null}
            options={sprintOptions}
            placeholder="Sprint"
            onChange={onPickSprint}
            emptyLabel="No sprints found"
          />
          {isJira && (
            <Select
              value={ticketEpic}
              options={epicOptions}
              placeholder="Epic"
              onChange={setTicketEpic}
              emptyLabel="No epics"
            />
          )}
          {isAdo && (
            <Select
              value={areaPath}
              options={areaOptions}
              placeholder="Area path"
              onChange={setAreaPath}
              emptyLabel="No area paths"
            />
          )}
          <MultiSelect
            values={states}
            options={stateOptions}
            placeholder={isJira ? "Status" : "State"}
            onChange={setStates}
          />
          <MultiSelect
            values={workItemTypes}
            options={typeOptions}
            placeholder={isJira ? "Issue type" : "Work item type"}
            onChange={setWorkItemTypes}
          />
          <Select
            value={ticketPriority}
            options={PRIORITY_OPTIONS}
            placeholder="Priority"
            onChange={setTicketPriority}
          />
          {userName && (
            <button
              onClick={selectAssigned}
              className="cursor-pointer rounded-[11px] border border-white/[0.09] bg-white/[0.05] px-[13px] py-2 text-[12.5px] font-semibold text-[#dcdce4] hover:bg-white/[0.1]"
            >
              Select my assigned
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass h-[64px] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : !tickets.length ? (
        <EmptyState
          icon={<Search size={28} color="#8b8b9e" strokeWidth={1.6} />}
          title="No tickets found"
          body="Try a different filter or sync tickets from your provider."
        />
      ) : (
        <>
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

          <div className="mt-4 flex items-center justify-between text-[12.5px] text-ink-dim">
            <span>
              {total} ticket{total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTicketPage(Math.max(1, ticketPage - 1))}
                disabled={ticketPage <= 1}
                className="flex cursor-pointer items-center gap-1 rounded-[10px] border border-white/[0.09] bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-semibold text-[#dcdce4] hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} />
                Prev
              </button>
              <span className="font-medium text-ink">
                Page {ticketPage} of {totalPages}
              </span>
              <button
                onClick={() => setTicketPage(Math.min(totalPages, ticketPage + 1))}
                disabled={ticketPage >= totalPages}
                className="flex cursor-pointer items-center gap-1 rounded-[10px] border border-white/[0.09] bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-semibold text-[#dcdce4] hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {syncOpen && (
        <SyncTicketsModal
          connectionId={connectionId}
          providerKind={selectedConn?.kind}
          sourceLabel={syncSourceLabel}
          onClose={() => setSyncOpen(false)}
        />
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
