import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ConnectionRow } from "@/components/settings/ConnectionRow";
import { PROVIDER_META } from "@/components/settings/providerMeta";
import { useCreateConnection, useDeleteConnection } from "@/hooks/queries";
import type { ConnectionOut, ProviderGroupOut } from "@/types/api";

/**
 * One provider (kind) rendered as a group: a header (brand icon, name,
 * "N connections · N connected", + Add connection) over its collapsible
 * connection rows. Adding creates an empty "New {Provider} connection" and
 * opens it expanded; deleting confirms via ConfirmDialog first.
 */
export function ProviderGroup({ group }: { group: ProviderGroupOut }) {
  const meta = PROVIDER_META[group.kind];
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionOut | null>(null);

  const create = useCreateConnection();
  const del = useDeleteConnection();

  const handleAdd = () => {
    create.mutate(
      { kind: group.kind, name: `New ${meta.name} connection` },
      {
        onSuccess: (conn) => setExpandedId(conn.id),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add connection"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    del.mutate(id, {
      onSuccess: () => {
        toast.success("Connection deleted");
        if (expandedId === id) setExpandedId(null);
        setDeleteTarget(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete connection"),
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center gap-[13px] px-[22px] py-[16px]">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[17px] font-black"
          style={{ background: meta.color, color: meta.glyphColor }}
        >
          {meta.glyph}
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-bold">{meta.name}</div>
          <div className="text-[11.5px] text-muted">
            {group.connectionCount} connection{group.connectionCount === 1 ? "" : "s"} ·{" "}
            {group.connectedCount} connected
          </div>
        </div>
        <button
          onClick={handleAdd}
          disabled={create.isPending}
          className="flex items-center gap-1.5 rounded-[11px] border border-[rgba(139,92,246,.32)] bg-[rgba(139,92,246,.1)] px-3 py-2 text-[12.5px] font-semibold text-[#c4b5fd] hover:bg-[rgba(139,92,246,.18)] disabled:opacity-60"
        >
          <Plus size={14} strokeWidth={2.4} /> Add connection
        </button>
      </div>

      {group.connections.length > 0 && (
        <div className="border-t border-white/[0.06]">
          {group.connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              expanded={expandedId === conn.id}
              onToggle={() => setExpandedId((id) => (id === conn.id ? null : conn.id))}
              onRequestDelete={() => setDeleteTarget(conn)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete connection"
        message={`Delete "${deleteTarget?.name ?? ""}"? Projects and tickets bound to it fall back to another connection of the same kind.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
