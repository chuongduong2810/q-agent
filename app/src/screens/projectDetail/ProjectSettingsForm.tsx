import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Dropdown";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { PROVIDER_META } from "@/components/settings/providerMeta";
import { useProviders } from "@/hooks/queries";
import type {
  EnvironmentCfg,
  ProjectConfigOut,
  ProjectConfigUpdate,
  ProjectRepo,
  ProviderKind,
  TestAccountIn,
} from "@/types/api";
import { inputCls, labelCls } from "./formStyles";
import { ReposManager } from "./ReposManager";

/**
 * Reusable project settings form. Lets the user configure the project-specific
 * runtime values downstream automation needs (application URL, connections,
 * repos, test accounts, environments, extra config) so generated Playwright
 * specs run with little to no manual editing. Passwords are write-only: blank
 * preserves the securely stored secret. Scope-agnostic — the caller supplies the
 * loaded `config`, the `onSave` handler, and (optionally) the manual-login
 * widget via `renderManualLogin`, so it serves both a user's own project and the
 * admin shared-workspace settings page.
 */
export function ProjectSettingsForm({
  config,
  saving,
  onSave,
  renderManualLogin,
}: {
  config: ProjectConfigOut;
  saving: boolean;
  onSave: (patch: ProjectConfigUpdate) => void;
  renderManualLogin?: (hasBaseUrl: boolean) => ReactNode;
}) {
  const { data: providers } = useProviders();

  const [baseUrl, setBaseUrl] = useState("");
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [accounts, setAccounts] = useState<(TestAccountIn & { hasPassword: boolean })[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentCfg[]>([]);
  const [extra, setExtra] = useState<{ k: string; v: string }[]>([]);
  const [manualAuth, setManualAuth] = useState(false);
  const [workItemConnectionId, setWorkItemConnectionId] = useState<number | null>(null);
  const [repositoryConnectionId, setRepositoryConnectionId] = useState<number | null>(null);

  // Work-item vs repository connections, from the grouped provider catalog.
  const connOption = (c: { id: number; kind: ProviderKind; name: string }) => ({
    value: String(c.id),
    label: `${PROVIDER_META[c.kind].name} · ${c.name}`,
  });
  const allConnections = (providers ?? []).flatMap((g) => g.connections);
  const workItemOptions = allConnections
    .filter((c) => c.categories.includes("work_item"))
    .map(connOption);
  const repositoryConnections = allConnections.filter((c) => c.categories.includes("repository"));
  const repositoryOptions = repositoryConnections.map(connOption);
  const repoConn = repositoryConnections.find((c) => c.id === repositoryConnectionId) ?? null;

  useEffect(() => {
    if (!config) return;
    setBaseUrl(config.baseUrl ?? "");
    setManualAuth(config.manualAuth ?? false);
    setWorkItemConnectionId(config.workItemConnectionId ?? null);
    setRepositoryConnectionId(config.repositoryConnectionId ?? null);
    setRepos(config.repos ?? []);
    setAccounts(
      (config.testAccounts ?? []).map((a) => ({
        role: a.role,
        username: a.username,
        password: "",
        notes: a.notes,
        hasPassword: a.hasPassword,
      })),
    );
    setEnvironments(config.environments ?? []);
    setExtra(Object.entries(config.extra ?? {}).map(([k, v]) => ({ k, v: String(v) })));
  }, [config]);

  const handleSave = () =>
    onSave({
      baseUrl,
      repos,
      testAccounts: accounts.map(({ role, username, password, notes }) => ({
        role,
        username,
        password,
        notes,
      })),
      environments,
      extra: Object.fromEntries(extra.filter((e) => e.k).map((e) => [e.k, e.v])),
      manualAuth,
      workItemConnectionId,
      repositoryConnectionId,
    });

  return (
    <div className="flex flex-col gap-3.5">
      <GlassCard className="p-5">
        <div className="mb-1 text-[14px] font-bold">Provider connections</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Bind this project to a work-item source (where its tickets come from) and a repository
          source (where its code lives) — chosen independently. Manage connections in Settings.
        </p>
        <div className="grid max-w-[560px] grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Work Item Provider</label>
            <Select
              value={workItemConnectionId != null ? String(workItemConnectionId) : null}
              options={workItemOptions}
              placeholder="Select a connection"
              onChange={(v) => setWorkItemConnectionId(v ? Number(v) : null)}
              emptyLabel="No work-item connections"
            />
          </div>
          <div>
            <label className={labelCls}>Repository Provider</label>
            <Select
              value={repositoryConnectionId != null ? String(repositoryConnectionId) : null}
              options={repositoryOptions}
              placeholder="Select a connection"
              onChange={(v) => setRepositoryConnectionId(v ? Number(v) : null)}
              emptyLabel="No repository connections"
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 text-[14px] font-bold">Application</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          The default application URL the generated Playwright automation targets.
        </p>
        <div className="max-w-[420px]">
          <label className={labelCls}>Base URL</label>
          <input
            className={inputCls}
            placeholder="https://staging.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <ToggleRow
          title="Manual login before run"
          description="Open a real browser on the host so an operator can log in before the run starts."
          checked={manualAuth}
          onChange={setManualAuth}
          bordered={false}
        />
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
          Before a run, a real browser opens on the machine running Q&#8209;Agent so you can log in
          (e.g. Microsoft Entra); the session is reused until cleared.
        </p>
        {manualAuth && renderManualLogin?.(baseUrl.trim().length > 0)}
      </GlassCard>

      <ReposManager
        repoConnectionId={repoConn?.id ?? null}
        repoConnectionName={repoConn?.name ?? ""}
        repos={repos}
        setRepos={setRepos}
      />

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Test accounts</div>
          <Button
            variant="glass"
            onClick={() =>
              setAccounts((a) => [...a, { role: "", username: "", password: "", notes: "", hasPassword: false }])
            }
          >
            <Plus size={14} strokeWidth={2.4} /> Add account
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Credentials used by generated specs. Passwords are encrypted at rest and never shown —
          leave the password blank to keep the stored one.
        </p>
        {accounts.length === 0 && (
          <div className="text-[12.5px] text-[#6c6c7e]">No test accounts configured yet.</div>
        )}
        <div className="flex flex-col gap-3">
          {accounts.map((acct, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1.2fr_auto] items-end gap-2.5">
              <div>
                <label className={labelCls}>Role</label>
                <input
                  className={inputCls}
                  placeholder="Internal Admin"
                  value={acct.role}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Username</label>
                <input
                  className={inputCls}
                  placeholder="qa@example.com"
                  value={acct.username}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder={acct.hasPassword ? "•••••••• (unchanged)" : "password"}
                  value={acct.password}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  placeholder="optional"
                  value={acct.notes}
                  onChange={(e) =>
                    setAccounts((a) => a.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                  }
                />
              </div>
              <button
                onClick={() => setAccounts((a) => a.filter((_, j) => j !== i))}
                className="mb-0.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove account"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Environments</div>
          <Button
            variant="glass"
            onClick={() => setEnvironments((e) => [...e, { name: "", baseUrl: "", notes: "" }])}
          >
            <Plus size={14} strokeWidth={2.4} /> Add environment
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Per-environment URLs. A run picks the environment matching its name (e.g. Staging).
        </p>
        {environments.length === 0 && (
          <div className="text-[12.5px] text-[#6c6c7e]">No environments configured yet.</div>
        )}
        <div className="flex flex-col gap-3">
          {environments.map((env, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-end gap-2.5">
              <div>
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  placeholder="Staging"
                  value={env.name}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Base URL</label>
                <input
                  className={inputCls}
                  placeholder="https://staging.example.com"
                  value={env.baseUrl}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, baseUrl: e.target.value } : x)))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  placeholder="optional"
                  value={env.notes}
                  onChange={(e) =>
                    setEnvironments((v) => v.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                  }
                />
              </div>
              <button
                onClick={() => setEnvironments((v) => v.filter((_, j) => j !== i))}
                className="mb-0.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove environment"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex-1 text-[14px] font-bold">Additional settings</div>
          <Button variant="glass" onClick={() => setExtra((x) => [...x, { k: "", v: "" }])}>
            <Plus size={14} strokeWidth={2.4} /> Add value
          </Button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-dim">
          Arbitrary project-specific key/values the automation generator can reference.
        </p>
        <div className="flex flex-col gap-2.5">
          {extra.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2.5">
              <input
                className={inputCls}
                placeholder="key"
                value={row.k}
                onChange={(e) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
              />
              <input
                className={inputCls}
                placeholder="value"
                value={row.v}
                onChange={(e) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
              />
              <button
                onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}
                className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[#e06c75] hover:bg-white/[0.06]"
                title="Remove value"
              >
                <Trash2 size={15} strokeWidth={2.1} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
