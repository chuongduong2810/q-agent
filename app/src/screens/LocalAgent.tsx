/**
 * Local Agent screen (global, non run-scoped — routed alongside `settings`).
 * Lets the user pair a device running `npx @qagent/agent`, which executes
 * Playwright suites headed on their own machine (so manual login/MFA happens
 * right where the user is, and session cookies never leave that machine).
 *
 * Flow: "Add device" mints a short-lived pairing code (`POST
 * /agent/devices/pair-code`); the user runs the printed `npx @qagent/agent
 * pair <code> --server <origin>` command locally. Once paired, the device
 * shows up in the list below (`GET /agent/devices`) and becomes selectable as
 * an execution target on the Execution screen.
 */

import { useEffect, useState } from "react";
import { Check, Copy, Cpu, Laptop, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { GlassCard } from "@/components/ui/GlassCard";
import { Spinner } from "@/components/ui/misc";
import { useAgentDevices, usePairCode, useRevokeDevice } from "@/hooks/queries";
import { relativeTime } from "@/screens/auth/profile/sessions";
import type { AgentDeviceOut } from "@/types/api";

export function LocalAgent() {
  const { data: devices, isLoading } = useAgentDevices();
  const pairCode = usePairCode();
  const revokeDevice = useRevokeDevice();

  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [revoking, setRevoking] = useState<AgentDeviceOut | null>(null);

  const handleAddDevice = () => {
    pairCode.mutate(undefined, {
      onSuccess: (data) =>
        setPairing({ code: data.code, expiresAt: Date.now() + data.expiresIn * 1000 }),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Failed to generate a pairing code"),
    });
  };

  // The agent calls the API's `/agent/...` routes; on the same-origin (tunnel)
  // deployment those live under `/api`. Local dev with a separate API port
  // should instead point --server straight at the API (see the note below).
  const command = pairing
    ? `npx @qagent/agent pair ${pairing.code} --server ${window.location.origin}/api`
    : "";

  return (
    <div className="mx-auto max-w-[860px] py-10">
      <div className="mb-[22px]">
        <div className="mb-[5px] text-[13px] font-medium text-muted">Local Agent</div>
        <h1 className="m-0 text-[28px] font-black tracking-[-0.03em]">Run suites on your machine</h1>
      </div>

      <GlassCard className="mb-5 p-[22px]">
        <div className="flex gap-[14px]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[rgba(139,92,246,.3)] bg-[rgba(139,92,246,.14)]">
            <Cpu size={19} className="text-violet" strokeWidth={2} />
          </span>
          <div className="flex-1">
            <div className="mb-1 text-[14.5px] font-bold">What is the Local Agent?</div>
            <p className="m-0 text-[13px] leading-[1.65] text-[#c3c3d0]">
              A small CLI you run on your own computer. It claims execution jobs from Q&#8209;Agent
              and runs Playwright <b className="font-semibold text-[#ececf1]">headed, locally</b> — so
              when a suite needs a manual login (e.g. MFA), the browser opens right where you are.
              Your session cookies never leave your machine; only progress, results, and screenshots
              are sent back.
            </p>
          </div>
        </div>
        <div className="mt-[18px] rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[.06em] text-[#6c6c7e]">
            PREREQUISITES
          </div>
          <ul className="m-0 list-none space-y-1 p-0 text-[12.5px] text-[#c3c3d0]">
            <li>&middot; Node.js 18 or newer</li>
            <li>&middot; Chromium is installed automatically the first time you run the agent</li>
          </ul>
        </div>
      </GlassCard>

      <div className="mb-3 flex items-center justify-between">
        <div className="text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">PAIRED DEVICES</div>
        <Button variant="primary" size="sm" onClick={handleAddDevice} disabled={pairCode.isPending}>
          {pairCode.isPending ? <Spinner size={13} /> : <Laptop size={14} strokeWidth={2.4} />}
          Add device
        </Button>
      </div>

      {pairing && <PairingCommand command={command} expiresAt={pairing.expiresAt} onExpire={() => setPairing(null)} />}

      <GlassCard className="p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[58px] animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : !devices?.length ? (
          <div className="p-8 text-center text-[13px] text-ink-dim">
            No devices paired yet. Click "Add device" to get a pairing command.
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-2">
            {devices.map((d) => (
              <DeviceRow key={d.id} device={d} onRevoke={() => setRevoking(d)} />
            ))}
          </div>
        )}
      </GlassCard>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this device?"
        message={`"${revoking?.name ?? "This device"}" will no longer be able to claim or run jobs. You can pair it again later.`}
        confirmLabel="Revoke device"
        danger
        loading={revokeDevice.isPending}
        onConfirm={() => {
          if (!revoking) return;
          revokeDevice.mutate(revoking.id, {
            onSuccess: () => {
              toast.success("Device revoked");
              setRevoking(null);
            },
            onError: (err) =>
              toast.error(err instanceof Error ? err.message : "Failed to revoke device"),
          });
        }}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

/** The generated pairing command with a copy button and a live expiry
 * countdown. Calls `onExpire` once the code's TTL elapses so the caller can
 * clear it (the user must generate a new one). */
function PairingCommand({
  command,
  expiresAt,
  onExpire,
}: {
  command: string;
  expiresAt: number;
  onExpire: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => expiresAt - Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const tick = () => {
      const left = expiresAt - Date.now();
      setRemainingMs(left);
      if (left <= 0) onExpire();
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  if (remainingMs <= 0) return null;

  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <GlassCard className="mb-3 p-[18px]">
      <div className="mb-2.5 flex items-center gap-2">
        <Terminal size={15} className="text-violet" strokeWidth={2.2} />
        <span className="text-[13px] font-semibold">Run this on your machine</span>
        <span className="ml-auto font-mono text-[12px] text-[#8b8b9e]">
          Expires in {mm}:{ss.toString().padStart(2, "0")}
        </span>
      </div>
      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#16161f] p-2.5 pl-3.5">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-ink">
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8b8b9e] transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label="Copy command"
        >
          {copied ? <Check size={15} className="text-[#6ee7b7]" /> : <Copy size={15} />}
        </button>
      </div>
      <p className="mt-2 mb-0 text-[11.5px] leading-[1.5] text-[#8b8b9e]">
        Running the API on a separate port in local dev? Point <code className="font-mono">--server</code> at
        it directly, e.g. <code className="font-mono">http://localhost:8787</code>.
      </p>
    </GlassCard>
  );
}

function DeviceRow({ device, onRevoke }: { device: AgentDeviceOut; onRevoke: () => void }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[13px] border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05] text-ink-dim">
        <Laptop size={16} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink">{device.name || "Unnamed device"}</div>
        <div className="text-[11.5px] text-muted">
          Last seen {device.lastSeenAt ? relativeTime(device.lastSeenAt) : "never"} &middot; Paired{" "}
          {relativeTime(device.createdAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-danger-soft transition-colors hover:bg-[rgba(244,63,94,.1)]"
      >
        <Trash2 size={13} strokeWidth={2.2} />
        Revoke
      </button>
    </div>
  );
}
