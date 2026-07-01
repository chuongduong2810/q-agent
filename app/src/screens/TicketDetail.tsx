import { ArrowLeft, FileText, GitBranch } from "lucide-react";
import { Pill, StatusBadge, priorityColor, providerGlyph } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/misc";
import { useTicket } from "@/hooks/queries";
import { useUI } from "@/store/ui";

export function TicketDetail() {
  const activeTicket = useUI((s) => s.activeTicket);
  const navigate = useUI((s) => s.navigate);
  const { data: detail, isLoading } = useTicket(activeTicket);

  const goTickets = () => navigate("tickets");

  if (isLoading || !detail) {
    return (
      <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
        <BackButton onClick={goTickets} />
        {isLoading ? (
          <div className="grid grid-cols-[1.55fr_1fr] items-start gap-4">
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
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <BackButton onClick={goTickets} />

      <div className="grid grid-cols-[1.55fr_1fr] items-start gap-4">
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
            <h1 className="m-0 mb-4 text-2xl leading-[1.25] font-black tracking-tight">{detail.title}</h1>

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

        <div className="sticky top-0 flex flex-col gap-[14px]">
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
