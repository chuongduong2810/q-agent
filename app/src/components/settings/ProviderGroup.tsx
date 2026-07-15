import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
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
  const { t } = useTranslation("settings");
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
        onError: (err) => toast.error(err instanceof Error ? err.message : t("providerGroup.addFailed")),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    del.mutate(id, {
      onSuccess: () => {
        toast.success(t("providerGroup.deleted"));
        if (expandedId === id) setExpandedId(null);
        setDeleteTarget(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t("providerGroup.deleteFailed")),
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-[13px] px-[16px] py-[14px] md:flex-nowrap md:px-[22px] md:py-[16px]">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-black"
          style={{ background: meta.color, color: meta.glyphColor }}
        >
          {meta.glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">{meta.name}</div>
          <div className="text-[11.5px] text-muted">
            {t("providerGroup.connectionCount", { count: group.connectionCount })} ·{" "}
            {t("providerGroup.connected", { n: group.connectedCount })}
          </div>
        </div>
        <button
          onClick={handleAdd}
          disabled={create.isPending}
          className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-[11px] border border-[rgba(139,92,246,.3)] bg-[rgba(139,92,246,.16)] px-3 py-2 text-[12.5px] font-semibold text-[#c4b5fd] transition-colors hover:bg-[rgba(139,92,246,.26)] disabled:opacity-60 md:w-auto"
        >
          <Plus size={14} strokeWidth={2.4} /> {t("providerGroup.add")}
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
        title={t("connection.deleteTitle")}
        message={t("providerGroup.deleteMessage", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common:delete")}
        danger
        loading={del.isPending}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
