import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { LanguageSwitcher } from "@/components/shell/LanguageSwitcher";
import { GlassCard } from "@/components/ui/GlassCard";
import { Select } from "@/components/ui/Dropdown";
import { Spinner } from "@/components/ui/misc";
import { ClaudeCredentialsCard } from "@/components/settings/ClaudeCredentialsCard";
import { ProviderGroup } from "@/components/settings/ProviderGroup";
import { PROVIDER_META, PROVIDER_ORDER } from "@/components/settings/providerMeta";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { useProviders, useSettings, useUpdateSettings } from "@/hooks/queries";
import { AI_MODEL_OPTIONS } from "@/lib/models";
import type { ExecutionTarget, ProviderGroupOut, ProviderKind, SettingsOut } from "@/types/api";

/** A never-configured provider: the backend catalog omits it (fresh machine),
 * so synthesize an empty group the user can add a first connection under. */
const emptyGroup = (kind: ProviderKind): ProviderGroupOut => ({
  kind,
  categories: PROVIDER_META[kind].categories,
  name: PROVIDER_META[kind].name,
  connectionCount: 0,
  connectedCount: 0,
  connections: [],
});

/** AI actions that accept a per-skill model override — mirrors the backend
 * skills that are actually invoked with `skill=` (see api skills.SKILLS +
 * claude_cli._resolve_model). `haikuDefault` marks the mechanical actions that
 * fall back to Haiku when left on "inherit". */
const TUNABLE_SKILLS: { id: string; label: string; haikuDefault?: boolean }[] = [
  { id: "test-case-generator", label: "Analyze + generate test cases" },
  { id: "test-case-reviewer", label: "Review & expand coverage" },
  { id: "automation-generator", label: "Generate Playwright spec" },
  { id: "automation-reviewer", label: "Review Playwright spec" },
  { id: "project-bootstrap", label: "Build project knowledge base" },
  { id: "execution-analyzer", label: "Classify run failures", haikuDefault: true },
  { id: "screenshot-annotator", label: "Annotate screenshots", haikuDefault: true },
  { id: "ticket-comment-generator", label: "Summarize ticket comments", haikuDefault: true },
];

export function Settings() {
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const location = useLocation();
  const { t: tNav } = useTranslation("nav");

  // Settings edit as a local draft — controls mutate `draft`, never the server,
  // until the user hits "Save changes". `settings` only changes on save (cache
  // is updated via setQueryData), so re-syncing the draft to it is safe.
  const [draft, setDraft] = useState<SettingsOut | null>(null);
  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);
  const set = (patch: Partial<SettingsOut>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  // Per-action model override: set one, or clear it (null = inherit default/global).
  const setSkillModel = (skillId: string, model: string | null) => {
    if (!draft) return;
    const next = { ...draft.skillModels };
    if (model) next[skillId] = model;
    else delete next[skillId];
    set({ skillModels: next });
  };
  const dirty = Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings));
  const save = () => {
    if (draft && dirty) updateSettings.mutate(draft);
  };
  const discard = () => {
    if (settings) setDraft(settings);
  };

  // Deep-link support for in-page anchors — e.g. the AI status popover's
  // "Manage Claude account" button (`/settings#claude-account`) and the
  // Execution screen's target chip (`/settings#execution`).
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  // Always render one group per known kind — synthesize an empty group when the
  // backend catalog omits it, so a fresh machine can still add connections.
  const groupFor = (kind: ProviderKind): ProviderGroupOut =>
    providers?.find((g) => g.kind === kind) ?? emptyGroup(kind);

  return (
    <div className="max-w-[900px] px-1 pb-10 pt-0.5">
      <div className="mb-[22px]">
        <div className="mb-[5px] text-[13px] font-medium text-muted">Workspace · Surency</div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Settings</h1>
      </div>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">PROVIDER CONNECTIONS</div>
      {providersLoading ? (
        <div className="mb-[26px] flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="mb-[26px] flex flex-col gap-3.5">
          {PROVIDER_ORDER.map((kind) => (
            <ProviderGroup key={kind} group={groupFor(kind)} />
          ))}
        </div>
      )}

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">PROFILE</div>
      <GlassCard className="mb-[26px] p-[22px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-[12px] text-muted">
            Your name, email, password, and two-factor auth live on your account profile.
          </div>
          <Link
            to="/profile"
            className="w-full shrink-0 rounded-[11px] border border-white/[0.1] bg-white/[0.05] px-[15px] py-[10px] text-center text-[13px] font-semibold text-ink transition-colors hover:bg-white/[0.1] md:w-auto"
          >
            Manage profile
          </Link>
        </div>
      </GlassCard>

      <div id="execution" className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">DEFAULT EXECUTION</div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !draft ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 border-b border-white/[0.06] py-[13px] md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Execution target</div>
                <div className="text-[12px] text-muted">
                  Where runs execute — the server, or a paired Local Agent on your machine
                </div>
              </div>
              <div className="w-full md:w-[170px]">
                <Select
                  value={draft.executionTarget}
                  onChange={(v) => v && set({ executionTarget: v as ExecutionTarget })}
                  placeholder="Select target"
                  allowClear={false}
                  options={[
                    { value: "server", label: "Server" },
                    { value: "local-agent", label: "My machine" },
                  ]}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2.5 border-b border-white/[0.06] py-[13px] md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Parallel workers</div>
                <div className="text-[12px] text-muted">
                  Default up to {draft.parallel} cases at once per Run
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.parallel}
                  onChange={(e) => set({ parallel: Number(e.target.value) })}
                  className="w-full accent-[#8b5cf6] md:w-[150px]"
                />
                <span className="w-5 text-center font-mono text-[14px] font-bold">{draft.parallel}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 border-b border-white/[0.06] py-[13px] md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Max test cases per ticket</div>
                <div className="text-[12px] text-muted">
                  Cap AI generation to at most {draft.maxCasesPerTicket} cases per ticket
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={draft.maxCasesPerTicket}
                  onChange={(e) => set({ maxCasesPerTicket: Number(e.target.value) })}
                  className="w-full accent-[#8b5cf6] md:w-[150px]"
                />
                <span className="w-5 text-center font-mono text-[14px] font-bold">
                  {draft.maxCasesPerTicket}
                </span>
              </div>
            </div>
            <ToggleRow
              title="Auto-retry flaky tests"
              description="Retry failed cases up to 2 times"
              checked={draft.retryFlaky}
              onChange={(v) => set({ retryFlaky: v })}
            />
            <ToggleRow
              title="Screenshot on failure"
              description="Capture full-page evidence for every failed step"
              checked={draft.screenshotOnFail}
              onChange={(v) => set({ screenshotOnFail: v })}
            />
            <ToggleRow
              title="Auto-annotate failure screenshots"
              description="Runs a Claude vision analysis on each failed screenshot to draw the problem area — one AI call per failure"
              checked={draft.autoAnnotate}
              onChange={(v) => set({ autoAnnotate: v })}
            />
            <ToggleRow
              title="Record video"
              description="Save an MP4 of each run (uses more storage)"
              checked={draft.video}
              onChange={(v) => set({ video: v })}
            />
            <ToggleRow
              title="Run browser headless"
              description="Execute Playwright without a visible browser window (turn off to watch runs)"
              checked={draft.headless}
              onChange={(v) => set({ headless: v })}
              bordered={false}
            />
          </>
        )}
      </GlassCard>

      <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">SPEC QUALITY GATE</div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !draft ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <ToggleRow
            title="Gate generated specs"
            description="Block specs with placeholders, invented routes/selectors or flaky patterns, and run the AI spec review. Turn off to accept every generated spec as runnable without gating."
            checked={draft.gateEnabled}
            onChange={(v) => set({ gateEnabled: v })}
            bordered={false}
          />
        )}
      </GlassCard>

      <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">AI MODEL</div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !draft ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-[#9494a6]">Claude model</span>
            <Select
              value={draft.claudeModel}
              onChange={(v) => v && set({ claudeModel: v })}
              placeholder="Select a model"
              allowClear={false}
              options={[
                { value: "claude-opus-4-8", label: "Opus 4.8 — highest quality" },
                { value: "claude-sonnet-5", label: "Sonnet 5 — balanced (default)" },
                { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fastest" },
              ]}
            />
            <span className="text-[12px] text-muted">
              Model used for all AI actions (analysis, generation, self-heal).
            </span>

            <span className="mt-4 text-[12px] font-semibold text-[#9494a6]">
              Weekly token budget (tokens)
            </span>
            <input
              type="number"
              min={0}
              value={draft.weeklyTokenBudget}
              onChange={(e) => set({ weeklyTokenBudget: Number(e.target.value) })}
              className="rounded-[11px] border border-white/[0.09] bg-white/[0.04] px-[13px] py-[10px] text-[13px] text-ink outline-none focus:border-[rgba(139,92,246,.5)]"
            />
            <span className="text-[12px] text-muted">
              Shown as a usage bar in the Claude stats panel. 0 = no budget.
            </span>
          </div>
        )}
      </GlassCard>

      <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">
        PER-ACTION MODELS &amp; CONCURRENCY
      </div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !draft ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-[#9494a6]">Ticket concurrency</span>
            <Select
              value={String(draft.aiPipelineWorkers)}
              onChange={(v) => v != null && set({ aiPipelineWorkers: Number(v) })}
              placeholder="Auto"
              allowClear={false}
              options={[
                { value: "0", label: "Auto (3 on Postgres, 1 on SQLite)" },
                { value: "1", label: "1 - sequential" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ]}
            />
            <span className="text-[12px] text-muted">
              How many tickets in a run are analyzed &amp; generated in parallel. Higher is
              faster but uses more of your Claude rate window; values above 1 only take
              effect on Postgres.
            </span>

            <span className="mt-4 text-[12px] font-semibold text-[#9494a6]">
              Per-action model overrides
            </span>
            <span className="mb-1 text-[12px] text-muted">
              Override the Claude model for a specific AI action. Leave on "Inherit" to use
              each action's default (mechanical actions default to Haiku; the rest use the
              Claude model above).
            </span>
            <div className="flex flex-col divide-y divide-white/[0.06]">
              {TUNABLE_SKILLS.map((skill) => (
                <div key={skill.id} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:justify-between md:gap-4">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{skill.label}</div>
                    <div className="text-[11px] text-muted">
                      Default: {skill.haikuDefault ? "Haiku 4.5" : "Claude model above"}
                    </div>
                  </div>
                  <div className="w-full md:w-[220px] md:shrink-0">
                    <Select
                      value={draft.skillModels[skill.id] ?? ""}
                      onChange={(v) => setSkillModel(skill.id, v ?? null)}
                      placeholder="Inherit default"
                      allowClear
                      options={AI_MODEL_OPTIONS}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      <div id="claude-account">
        <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">
          CLAUDE ACCOUNT
        </div>
        <GlassCard className="p-[22px]">
          <ClaudeCredentialsCard />
        </GlassCard>
      </div>

      <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">INTERFACE</div>
      <GlassCard className="p-[22px]">
        <div className="flex items-center justify-between border-b border-white/[0.06] py-[13px]">
          <div>
            <div className="text-[14px] font-semibold">{tNav("language.label")}</div>
            <div className="text-[12px] text-muted">{tNav("language.description")}</div>
          </div>
          <LanguageSwitcher />
        </div>
        {settingsLoading || !draft ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <ToggleRow
            title="3D background"
            description="Animated neural-constellation backdrop. Turn off for a flat background (lighter on the GPU)."
            checked={draft.neuralBackground}
            onChange={(v) => set({ neuralBackground: v })}
            bordered={false}
          />
        )}
      </GlassCard>

      {/* Sticky action bar — only while there are unsaved edits. Opaque bg (no
          backdrop-filter) since it layers over the animated 3D background. */}
      {dirty && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6">
          <div className="pointer-events-auto flex items-center gap-3 rounded-[16px] border border-white/[0.12] bg-[#16161f] px-5 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
            <span className="text-[13px] font-medium text-muted">You have unsaved changes</span>
            <button
              onClick={discard}
              disabled={updateSettings.isPending}
              className="rounded-[11px] border border-white/[0.1] bg-white/[0.05] px-[15px] py-[9px] text-[13px] font-semibold text-ink transition-colors hover:bg-white/[0.1] disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={updateSettings.isPending}
              className="rounded-[11px] bg-gradient-to-br from-[#8b5cf6] to-[#6366f1] px-[17px] py-[9px] text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {updateSettings.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
