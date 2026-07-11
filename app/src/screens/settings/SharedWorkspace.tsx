/**
 * Admin "Shared workspace" screen (#121, ADR 0009 §2). Manages the admin-only
 * shared namespace (`owner_id IS NULL`) that members clone ready-built projects
 * from instead of rebuilding knowledge. Lists shared projects with per-repo
 * knowledge builds, links each to its full settings page
 * (`/settings/shared-workspace/:key`), and creates new shared projects. Gated to
 * `role === "admin"`, mirroring `UserManagement` / `ClaudeCredentials`.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Boxes, Lock, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { AuthLabel, TextInput } from "@/components/auth/fields";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Pill, providerGlyph } from "@/components/ui/badges";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { knowledgeStatusStyle } from "@/data/projects";
import {
  useBuildSharedRepoKnowledge,
  useCreateSharedProject,
  useSharedProjects,
} from "@/hooks/queries";
import { useAuth } from "@/store/auth";
import type { ProviderKind, SharedProjectOut } from "@/types/api";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

const settingsPath = (key: string) => `/settings/shared-workspace/${encodeURIComponent(key)}`;

export function SharedWorkspace() {
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();
  const { data: shared, isLoading, isError, error } = useSharedProjects();
  const buildRepo = useBuildSharedRepoKnowledge();
  const [createOpen, setCreateOpen] = useState(false);

  // ── Admin gate ────────────────────────────────────────────────────────────
  if (me && me.role !== "admin") {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Lock size={26} className="text-[#8b8b9e]" />
        </div>
        <h1 className="m-0 mb-2 text-[22px] font-black tracking-[-0.02em]">Not authorized</h1>
        <p className="m-0 max-w-[380px] text-[13.5px] leading-relaxed text-muted">
          The shared workspace is managed by workspace administrators only. If you need access,
          ask an admin to change your role.
        </p>
      </div>
    );
  }

  const onBuildRepo = (key: string, repo: string) =>
    buildRepo.mutate(
      { key, repo, body: {} },
      {
        onSuccess: () => toast.success(`Knowledge build started for ${repo}`),
        onError: (e) => toast.error(errMsg(e, "Failed to start knowledge build")),
      },
    );

  return (
    <div className="mx-auto max-w-[940px] py-10">
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <div className="mb-[5px] flex items-center gap-2 text-[13px] font-medium text-muted">
            <span className="rounded-full bg-[rgba(139,92,246,.16)] px-[7px] py-[2px] text-[9px] font-bold tracking-[.06em] text-[#c4b5fd]">
              ADMIN
            </span>
            Surency workspace
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-[-0.03em]">Shared workspace</h1>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} strokeWidth={2.4} />
          New shared project
        </Button>
      </div>

      <div
        className="mb-6 flex gap-[14px] rounded-2xl border border-[rgba(139,92,246,.22)] p-[16px_18px]"
        style={{ background: "linear-gradient(135deg,rgba(139,92,246,.1),rgba(99,102,241,.05))" }}
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-[rgba(139,92,246,.3)] bg-[rgba(139,92,246,.16)]">
          <Boxes size={20} className="text-[#c4b5fd]" />
        </span>
        <p className="m-0 text-[13px] leading-[1.65] text-[#c3c3d0]">
          Projects here live in the <b className="font-bold text-[#ececf1]">shared namespace</b> —
          members can clone them into their own workspace instead of rebuilding knowledge from
          scratch. Open a project to add a repository and settings, then build its knowledge; a
          cloned project drops its provider-connection bindings, so members re-bind their own
          connections after cloning.
        </p>
      </div>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">
        SHARED PROJECTS
      </div>

      {isError ? (
        <div className="rounded-2xl border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.08)] p-6 text-[13.5px] text-[#fb7185]">
          {errMsg(error, "Failed to load the shared catalog")}
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-[14px] border border-white/[0.06] bg-white/[0.02]"
            />
          ))}
        </div>
      ) : !shared?.length ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center text-[13.5px] text-muted">
          No shared projects yet. Create one to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shared.map((p, i) => (
            <SharedProjectRow
              key={p.key}
              project={p}
              index={i}
              buildingRepo={
                buildRepo.isPending && buildRepo.variables?.key === p.key
                  ? buildRepo.variables?.repo ?? null
                  : null
              }
              onBuildRepo={(repo) => onBuildRepo(p.key, repo)}
              onOpen={() => navigate(settingsPath(p.key))}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateSharedProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => navigate(settingsPath(key))}
        />
      )}
    </div>
  );
}

function SharedProjectRow({
  project,
  index,
  buildingRepo,
  onBuildRepo,
  onOpen,
}: {
  project: SharedProjectOut;
  index: number;
  buildingRepo: string | null;
  onBuildRepo: (repo: string) => void;
  onOpen: () => void;
}) {
  const kind = (project.providerKind || "ado") as ProviderKind;
  const [glyph, glyphBg] = providerGlyph[kind] ?? ["?", "#6b7280"];
  const glyphColor = kind === "github" ? "#12121a" : "#fff";
  const statusFor = (repo: string) => project.knowledge.find((k) => k.repo === repo) ?? null;

  return (
    <GlassCard index={index} className="p-[16px_18px]">
      <div className="flex items-center gap-3.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] text-[14px] font-black"
          style={{ background: glyphBg, color: glyphColor }}
        >
          {glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-bold">{project.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-[#6c6c7e]">{project.key}</span>
          </div>
          {project.repos.length === 0 && (
            <div className="mt-1.5 text-[11px] text-[#6c6c7e]">
              No repository configured — open settings to add one before building knowledge.
            </div>
          )}
        </div>
        <Button variant="glass" size="sm" className="shrink-0" onClick={onOpen}>
          <Pencil size={13} strokeWidth={2.2} /> Settings
        </Button>
      </div>

      {project.repos.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          {project.repos.map((repo) => {
            const kn = statusFor(repo.name);
            const building = buildingRepo === repo.name;
            return (
              <div key={repo.name} className="flex items-center gap-2.5">
                <span className="truncate font-mono text-[12px] text-ink-soft">{repo.name}</span>
                {kn ? (
                  (() => {
                    const [label, color, bg] = knowledgeStatusStyle(kn.status);
                    return (
                      <Pill color={color} bg={bg}>
                        {label}
                        {kn.status === "indexed" ? ` · ${kn.confidence}%` : ""}
                      </Pill>
                    );
                  })()
                ) : (
                  <span className="text-[11px] text-[#6c6c7e]">Not built yet</span>
                )}
                <div className="flex-1" />
                <Button
                  variant="glass"
                  size="sm"
                  className="shrink-0"
                  disabled={building}
                  onClick={() => onBuildRepo(repo.name)}
                >
                  {building ? <Spinner size={13} /> : <RefreshCw size={13} strokeWidth={2.2} />}
                  {building ? "Building…" : "Build knowledge"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

/** Create the shared project shell (`POST /shared/projects/{key}`) — key + name +
 * provider. Repos, connections and the rest are configured on the settings page
 * the admin lands on right after creation. */
function CreateSharedProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [providerKind, setProviderKind] = useState<ProviderKind>("ado");
  const create = useCreateSharedProject();

  const canSubmit = key.trim().length > 0 && !create.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const trimmed = key.trim();
    create.mutate(
      { key: trimmed, body: { name: name.trim() || trimmed, providerKind } },
      {
        onSuccess: () => {
          toast.success(`Created shared project "${trimmed}"`);
          onClose();
          onCreated(trimmed);
        },
        onError: (err) => toast.error(errMsg(err, "Failed to create shared project")),
      },
    );
  };

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: "rgba(6,6,10,.62)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(430px,100%)] rounded-[20px] border border-white/[0.12] p-6"
        style={{ background: "#15151c", boxShadow: "0 40px 90px -30px #000", animation: "fadeInUp .25s ease both" }}
      >
        <div className="mb-[18px] flex items-center gap-3">
          <div className="accent-gradient flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]">
            <Boxes size={19} color="#fff" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <h2 className="m-0 text-[18px] font-black tracking-[-0.02em]">New shared project</h2>
            <p className="m-0 mt-0.5 text-[12.5px] text-muted">
              Creates the shell — you&apos;ll add the repo and settings next.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-dim transition-colors hover:bg-white/[0.08] hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="mb-4">
            <AuthLabel htmlFor="sp-key">Project key</AuthLabel>
            <TextInput
              id="sp-key"
              placeholder="surency-core"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <p className="mb-0 mt-1.5 text-[11.5px] text-faint">
              Stays unchanged when a member clones it — pick something stable.
            </p>
          </div>

          <div className="mb-4">
            <AuthLabel htmlFor="sp-name">Display name</AuthLabel>
            <TextInput
              id="sp-name"
              placeholder="Surency Core"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="mb-5">
            <AuthLabel>Provider</AuthLabel>
            <div className="flex gap-2 rounded-xl bg-black/25 p-1">
              {(["ado", "jira", "github"] as const).map((k) => {
                const on = providerKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setProviderKind(k)}
                    className={cn(
                      "flex-1 rounded-[10px] py-[10px] text-[13px] font-bold transition-colors",
                      on ? "accent-gradient text-white" : "bg-white/[0.05] text-[#9a9aae]",
                    )}
                  >
                    {k === "ado" ? "Azure DevOps" : k === "jira" ? "Jira" : "GitHub"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <Button type="button" variant="glass" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {create.isPending ? "Creating…" : "Create shared project"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
