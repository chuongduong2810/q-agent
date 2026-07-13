/**
 * AI chat panel to edit the selected spec (Automation screen). A 480px right
 * slide-in drawer: the reviewer types an instruction, Claude really edits the
 * spec (backend `POST /cases/{id}/spec/chat`), the reply types out char-by-char,
 * a red/green diff shows what changed, and the spec is updated with Undo.
 *
 * Mounted inside Automation.tsx (under RunSocketProvider) so `useRunEvents`
 * receives the `automation.chat.reply` / `automation.chat.error` results.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRunEvents } from "@/hooks/useRunEvents";
import { useSendSpecChat, useUpdateSpec } from "@/hooks/queries";
import { AI_MODEL_OPTIONS } from "@/lib/models";
import { useUI } from "@/store/ui";
import type { AutomationSpecOut, ChatErrorPayload, ChatReplyPayload } from "@/types/api";
import { diffLines } from "@/screens/automation/lineDiff";
import { useTypewriter } from "./useTypewriter";

const QUICK_ACTIONS = [
  "Use data-testid selectors",
  "Add a network-idle wait",
  "Assert the success toast",
  "Cover the empty state",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: boolean;
  error?: string;
  prevCode?: string;
  code?: string;
  applied?: boolean;
  reverted?: boolean;
};

interface Props {
  runId: number;
  spec: AutomationSpecOut | null | undefined;
}

/** Drives the chat message list + send/undo for the currently-selected spec. */
export function SpecChatPanel({ runId, spec }: Props) {
  const chatOpen = useUI((s) => s.chatOpen);
  const closeChat = useUI((s) => s.closeChat);
  const sendChat = useSendSpecChat(runId);
  const updateSpec = useUpdateSpec(runId);
  const caseId = spec?.testCaseId ?? 0;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(AI_MODEL_OPTIONS[1]?.value ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset the conversation when the selected spec changes.
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [caseId]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const busy = messages.some((m) => m.role === "assistant" && m.thinking);

  const patch = (id: string, next: Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...next } : m)));

  // The real edit result arrives over the run WS (correlated by messageId).
  useRunEvents((evt) => {
    if (evt.event === "automation.chat.reply") {
      const p = evt.payload as unknown as ChatReplyPayload;
      if (p.caseId !== caseId) return;
      patch(p.messageId, {
        thinking: false,
        text: p.text,
        prevCode: p.prevCode,
        code: p.spec.code,
        applied: true,
      });
    } else if (evt.event === "automation.chat.error") {
      const p = evt.payload as unknown as ChatErrorPayload;
      if (p.caseId !== caseId) return;
      patch(p.messageId, { thinking: false, error: p.error });
    }
  });

  const send = (raw: string) => {
    const message = raw.trim();
    if (!message || !spec || busy) return;
    const messageId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `m-${messages.length}`;
    setMessages((ms) => [
      ...ms,
      { id: `u-${messageId}`, role: "user", text: message },
      { id: messageId, role: "assistant", text: "", thinking: true },
    ]);
    setInput("");
    sendChat.mutate({ caseId, message, model: model || undefined, messageId });
  };

  const undo = (m: ChatMessage) => {
    if (m.prevCode == null) return;
    updateSpec.mutate({ caseId, code: m.prevCode });
    patch(m.id, { applied: false, reverted: true });
  };
  const reapply = (m: ChatMessage) => {
    if (m.code == null) return;
    updateSpec.mutate({ caseId, code: m.code });
    patch(m.id, { applied: true, reverted: false });
  };

  return createPortal(
    <AnimatePresence>
      {chatOpen && spec && (
        <motion.div
          key="chat-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[1000]"
          style={{ background: "rgba(4,4,8,.5)" }}
          onClick={closeChat}
        >
          <motion.aside
            key="chat-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 flex h-full w-[480px] max-w-[96vw] flex-col border-l border-white/[0.09]"
            style={{ background: "#0e0e15" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
              <span className="accent-gradient flex h-8 w-8 items-center justify-center rounded-lg">
                <Sparkles size={16} color="#fff" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold leading-tight">Q-Agent</div>
                <div className="truncate font-mono text-[11px] text-ink-dim">{spec.filename}</div>
              </div>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="ml-auto rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[11px] text-ink-soft"
                title="Model"
              >
                {AI_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label.split(" — ")[0]}
                  </option>
                ))}
              </select>
              <button
                onClick={closeChat}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-dim hover:bg-white/[0.08]"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 && (
                <div className="px-2 py-8 text-center text-[12.5px] text-ink-dim">
                  Ask Q-Agent to edit this spec — e.g. “use data-testid selectors” or “assert the
                  success toast”.
                </div>
              )}
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} text={m.text} />
                ) : (
                  <AssistantMessage key={m.id} m={m} onUndo={() => undo(m)} onReapply={() => reapply(m)} />
                ),
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-white/[0.07] p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    disabled={busy}
                    onClick={() => send(q)}
                    className="rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-[11px] text-ink-soft hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] p-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask Q-Agent to edit this spec…"
                  className="max-h-32 flex-1 resize-none bg-transparent px-1 text-[12.5px] text-ink outline-none placeholder:text-ink-dim"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || busy}
                  className="accent-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-40"
                  title="Send"
                >
                  <Send size={15} color="#fff" />
                </button>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="accent-gradient max-w-[85%] rounded-[14px_14px_5px_14px] px-3 py-2 text-[12.5px] text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  m,
  onUndo,
  onReapply,
}: {
  m: ChatMessage;
  onUndo: () => void;
  onReapply: () => void;
}) {
  const { shown, done } = useTypewriter(m.thinking ? "" : m.text);
  return (
    <div className="flex gap-2.5">
      <span className="accent-gradient mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
        <Sparkles size={13} color="#fff" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {m.thinking ? (
          <span className="inline-flex gap-1 text-ink-dim" aria-label="Thinking">
            <Dot /> <Dot /> <Dot />
          </span>
        ) : m.error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {m.error}
          </div>
        ) : (
          <>
            <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-soft">
              {shown}
              {!done && <span className="caret-blink">▍</span>}
            </div>
            {done && m.prevCode != null && m.code != null && (
              <>
                <DiffSnippet prev={m.prevCode} next={m.code} />
                {m.reverted ? (
                  <RevertedCard onReapply={onReapply} />
                ) : (
                  <AppliedCard prev={m.prevCode} next={m.code} onUndo={onUndo} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-dim" style={{ animation: "var(--animate-think)" }} />;
}

/** Compact red/green line diff of what the edit changed. */
function DiffSnippet({ prev, next }: { prev: string; next: string }) {
  const { changed, removed } = useMemo(() => diffLines(prev, next), [prev, next]);
  const nextLines = next.split("\n");
  const added = nextLines.filter((_, i) => changed.has(i)).slice(0, 8);
  const gone = removed.slice(0, 4);
  if (added.length === 0 && gone.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
      {gone.map((l, i) => (
        <div key={`r${i}`} style={{ color: "#fb7185", background: "rgba(251,113,133,.09)" }}>
          - {l}
        </div>
      ))}
      {added.map((l, i) => (
        <div key={`a${i}`} style={{ color: "#6ee7b7", background: "rgba(16,185,129,.1)" }}>
          + {l}
        </div>
      ))}
    </div>
  );
}

function AppliedCard({ prev, next, onUndo }: { prev: string; next: string; onUndo: () => void }) {
  const { count } = useMemo(() => diffLines(prev, next), [prev, next]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[12px]">
      <span className="text-success">Applied to spec · {count} line{count === 1 ? "" : "s"} changed</span>
      <button onClick={onUndo} className="ml-auto flex items-center gap-1 text-ink-soft hover:text-ink" title="Undo">
        <Undo2 size={13} /> Undo
      </button>
    </div>
  );
}

function RevertedCard({ onReapply }: { onReapply: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] text-ink-dim">
      Edit reverted
      <button onClick={onReapply} className="ml-auto text-ink-soft hover:text-ink">
        Re-apply
      </button>
    </div>
  );
}
