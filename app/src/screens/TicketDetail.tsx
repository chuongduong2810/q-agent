import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckSquare, ExternalLink, FileText, GitBranch, RefreshCw } from "lucide-react";
import { Pill, StatusBadge, priorityColor, providerGlyph } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/misc";
import { useLinkedCases, useTicket } from "@/hooks/queries";
import { providerLabel } from "@/data/projects";
import type { LinkedTestCaseOut, ProviderKind } from "@/types/api";

const CASE_STATUS_COLOR: Record<string, [string, string]> = {
  Design: ["#a78bfa", "rgba(139,92,246,.14)"],
  Ready: ["#6ee7b7", "rgba(16,185,129,.14)"],
  Open: ["#67e8f9", "rgba(34,211,238,.13)"],
  "To Do": ["#fbbf24", "rgba(251,191,36,.13)"],
};

/** Test cases created in the provider and linked back to this work item. */
function LinkedTestCases({ externalId }: { externalId: string }) {
  const { data: cases, isFetching, refetch } = useLinkedCases(externalId);
  const linked = cases ?? [];
  const has = linked.length > 0;

  return (
    <div className="glass mb-[14px] rounded-[22px] p-5">
      <div className="mb-[14px] flex items-center gap-2.5">
        <span className="flex-1 text-[14px] font-bold">Linked test cases</span>
        {has && (
          <Pill color="#6ee7b7" bg="rgba(16,185,129,.14)">
            {linked.length} linked
          </Pill>
        )}
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-[10px] border border-white/[0.1] bg-white/[0.05] px-3 py-[7px] text-[12px] font-semibold text-ink-soft hover:bg-white/[0.1]"
        >
          <RefreshCw size={13} strokeWidth={2.2} className={isFetching ? "animate-[spin_.7s_linear_infinite]" : ""} />
          Refresh
        </button>
      </div>

      {has ? (
        <>
          {/* Desktop — 4-column table. */}
          <div className="hidden overflow-hidden rounded-[13px] border border-white/[0.07] md:block">
            <div className="grid grid-cols-[78px_1fr_92px_92px] gap-2.5 bg-white/[0.04] px-3.5 py-[9px] text-[10px] font-bold tracking-[.05em] text-[#7a7a8c]">
              <span>ID</span>
              <span>TITLE</span>
              <span>STATUS</span>
              <span>LINK</span>
            </div>
            {linked.map((lc) => (
              <LinkedRow key={lc.id} lc={lc} />
            ))}
          </div>

          {/* Mobile — stacked cards. */}
          <div className="flex flex-col gap-2 md:hidden">
            {linked.map((lc) => (
              <LinkedCard key={lc.id} lc={lc} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-white/[0.1] bg-white/[0.02] px-5 py-7 text-center">
          <CheckSquare size={26} color="#6c6c7e" strokeWidth={1.8} className="mb-2.5" />
          <div className="mb-1 text-[13.5px] font-semibold">No test cases linked yet</div>
          <div className="max-w-[320px] text-[12.5px] leading-relaxed text-[#8b8b9e]">
            Approve and create test cases in the Review Center to link them to this work item.
          </div>
        </div>
      )}
    </div>
  );
}

/** Mobile stand-in for `LinkedRow` — one card per linked test case instead of a table row. */
function LinkedCard({ lc }: { lc: LinkedTestCaseOut }) {
  const [color, bg] = CASE_STATUS_COLOR[lc.status] ?? ["#a78bfa", "rgba(139,92,246,.14)"];
  const prov = providerLabel[lc.providerKind as ProviderKind] ?? lc.providerKind;
  return (
    <div className="rounded-[13px] border border-white/[0.07] bg-white/[0.03] p-[12px_14px]">
      <div className="mb-[6px] flex items-center gap-2">
        <span className="truncate font-mono text-[12px] font-semibold text-cyan-soft">{lc.externalId}</span>
        <span
          className="ml-auto shrink-0 rounded-full px-[9px] py-[3px] text-[10.5px] font-bold"
          style={{ color, background: bg }}
        >
          {lc.status}
        </span>
      </div>
      <div className="mb-[8px] text-[13px] leading-snug text-ink-soft">{lc.title}</div>
      {lc.url ? (
        <a
          href={lc.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-violet hover:underline"
          title={`Open in ${prov}`}
        >
          Open <ExternalLink size={12} strokeWidth={2.2} />
        </a>
      ) : lc.linked ? (
        <span className="text-[11px] text-[#6ee7b7]">linked</span>
      ) : (
        <span className="text-[11px] text-[#7a7a8c]">—</span>
      )}
    </div>
  );
}

function LinkedRow({ lc }: { lc: LinkedTestCaseOut }) {
  const [color, bg] = CASE_STATUS_COLOR[lc.status] ?? ["#a78bfa", "rgba(139,92,246,.14)"];
  const prov = providerLabel[lc.providerKind as ProviderKind] ?? lc.providerKind;
  return (
    <div className="grid grid-cols-[78px_1fr_92px_92px] items-center gap-2.5 border-t border-white/[0.05] px-3.5 py-[11px] text-[12.5px]">
      <span className="truncate font-mono font-semibold text-cyan-soft">{lc.externalId}</span>
      <span className="truncate text-ink-soft">{lc.title}</span>
      <span>
        <span className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold" style={{ color, background: bg }}>
          {lc.status}
        </span>
      </span>
      <span>
        {lc.url ? (
          <a
            href={lc.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-violet hover:underline"
            title={`Open in ${prov}`}
          >
            Open <ExternalLink size={12} strokeWidth={2.2} />
          </a>
        ) : lc.linked ? (
          <span className="text-[11px] text-[#6ee7b7]">linked</span>
        ) : (
          <span className="text-[11px] text-[#7a7a8c]">—</span>
        )}
      </span>
    </div>
  );
}

export function TicketDetail() {
  const { externalId } = useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading } = useTicket(externalId ?? null);

  const goTickets = () => navigate("/tickets");

  if (isLoading || !detail) {
    return (
      <div className="px-1 pb-10 pt-0.5">
        <BackButton onClick={goTickets} />
        {isLoading ? (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1.55fr_1fr]">
            <div className="glass h-[420px] animate-pulse rounded-[22px]" />
            <div className="glass h-[280px] animate-pulse rounded-[20px]" />
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={28} color="#8b8b9e" strokeWidth={1.6} />}
            title="Ticket not found"
            body="This ticket may have been removed or hasn't been synced yet."
          />
        )}
      </div>
    );
  }

  const [glyph, glyphColor] = providerGlyph[detail.providerKind] ?? ["?", "#8b8b9e"];

  return (
    <div className="px-1 pb-10 pt-0.5">
      <BackButton onClick={goTickets} />

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1.55fr_1fr]">
        <div>
          <div className="glass mb-[14px] rounded-[22px] p-6">
            <div className="mb-[14px] flex items-center gap-[10px]">
              <span
                className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[12px] font-black text-white"
                style={{ background: glyphColor }}
              >
                {glyph}
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-cyan-soft">{detail.externalId}</span>
              <StatusBadge status={detail.status} />
            </div>
            <h1 className="m-0 mb-4 text-xl leading-[1.25] font-black tracking-tight md:text-2xl">{detail.title}</h1>

            <div className="mb-[7px] text-[11px] font-semibold tracking-[0.08em] text-faint">DESCRIPTION</div>
            <p className="m-0 mb-4 text-[14px] leading-[1.6] text-ink-soft">{detail.description}</p>

            <div className="mb-[18px] rounded-[13px] border border-white/[0.06] bg-white/[0.03] p-[14px]">
              <div className="mb-[6px] text-[11px] font-semibold tracking-[0.08em] text-faint">NOTE</div>
              <p className="m-0 text-[13px] leading-[1.6] text-ink-dim">{detail.note}</p>
            </div>

            <div className="mb-[10px] text-[11px] font-semibold tracking-[0.08em] text-faint">
              ACCEPTANCE CRITERIA &middot; {detail.acceptanceCriteria.length}
            </div>
            <div className="flex flex-col gap-2">
              {detail.acceptanceCriteria.map((text, i) => (
                <div key={i} className="flex gap-[10px] text-[13px] leading-[1.55] text-[#b4b4c2]">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-[rgba(139,92,246,.14)] font-mono text-[11px] font-bold text-violet">
                    {i + 1}
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <LinkedTestCases externalId={detail.externalId} />

          <div className="glass rounded-[22px] p-5">
            <div className="mb-[14px] text-[14px] font-bold">Comments</div>
            <div className="flex flex-col gap-[14px]">
              {detail.comments.length === 0 ? (
                <p className="m-0 text-[13px] text-ink-dim">No comments yet.</p>
              ) : (
                detail.comments.map((c, i) => (
                  <div key={i} className="flex gap-[11px]">
                    <div
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold text-white"
                      style={{ background: "linear-gradient(135deg,#6366f1,#22d3ee)" }}
                    >
                      {c.ini}
                    </div>
                    <div className="flex-1">
                      <div className="mb-[3px] text-[12.5px]">
                        <span className="font-bold">{c.who}</span>{" "}
                        <span className="text-[#7a7a8c]">
                          &middot; {c.role} &middot; {c.when}
                        </span>
                      </div>
                      <div className="text-[13px] leading-[1.55] text-ink-soft">{c.text}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-[14px] md:sticky md:top-0">
          <div className="glass rounded-[20px] p-[18px]">
            <div className="flex flex-col gap-[13px]">
              <Row label="Priority">
                <span className="font-bold" style={{ color: priorityColor(detail.priority) }}>
                  {detail.priority}
                </span>
              </Row>
              <Row label="Status">
                <span className="font-semibold">{detail.status}</span>
              </Row>
              <Row label="Assignee">
                <span className="font-semibold">{detail.assignee}</span>
              </Row>
              <Row label="Sprint">
                <span className="font-semibold">{detail.sprint}</span>
              </Row>
              {detail.labels.length > 0 && (
                <div>
                  <div className="mb-2 text-[13px] text-ink-dim">Labels</div>
                  <div className="flex flex-wrap gap-[6px]">
                    {detail.labels.map((l) => (
                      <Pill key={l} color="#c3c3d0" bg="rgba(255,255,255,.06)">
                        {l}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="glass rounded-[20px] p-[18px]">
            <div className="mb-3 text-[13px] font-bold">Linked pull requests</div>
            <div className="flex flex-col gap-[9px]">
              {detail.linkedPrs.length === 0 ? (
                <p className="m-0 text-[12px] text-ink-dim">No linked pull requests.</p>
              ) : (
                detail.linkedPrs.map((pr, i) => (
                  <div key={i} className="flex items-center gap-[10px] rounded-[11px] bg-white/[0.03] p-[9px]">
                    <GitBranch size={15} color={pr.color} strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold">
                        {pr.title}
                      </div>
                      <div className="font-mono text-[11px] text-[#7a7a8c]">
                        {pr.repo} #{pr.num}
                      </div>
                    </div>
                    <span className="text-[10.5px] font-bold" style={{ color: pr.color }}>
                      {pr.status}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 mb-3 text-[13px] font-bold">Attachments</div>
            <div className="flex flex-col gap-2">
              {detail.attachments.length === 0 ? (
                <p className="m-0 text-[12px] text-ink-dim">No attachments.</p>
              ) : (
                detail.attachments.map((at, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-[10px] rounded-[11px] bg-white/[0.03] p-[9px] hover:bg-white/[0.06]"
                  >
                    <FileText size={15} color="#8b8b9e" strokeWidth={2} />
                    <span className="flex-1 text-[12px] text-ink-soft">{at.name}</span>
                    <span className="text-[11px] text-[#7a7a8c]">{at.size}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-4 flex cursor-pointer items-center gap-[7px] border-none bg-transparent p-0 text-[12.5px] font-semibold text-ink-dim hover:text-[#c7c7d4]"
    >
      <ArrowLeft size={14} strokeWidth={2.2} />
      All tickets
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-ink-dim">{label}</span>
      {children}
    </div>
  );
}
