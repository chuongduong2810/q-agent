import { GlassCard } from "@/components/ui/GlassCard";
import { Spinner } from "@/components/ui/misc";
import { ProviderCard } from "@/components/settings/ProviderCard";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { useProviders, useSettings, useUpdateSettings } from "@/hooks/queries";
import type { ProviderKind } from "@/types/api";

/** Card order matches the design's provider list — ADO, Jira, GitHub. */
const PROVIDER_ORDER: ProviderKind[] = ["ado", "jira", "github"];

export function Settings() {
  const { data: providers, isLoading: providersLoading } = useProviders();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const orderedProviders = PROVIDER_ORDER.map((kind) => providers?.find((p) => p.kind === kind)).filter(
    (p): p is NonNullable<typeof p> => !!p,
  );

  return (
    <div className="max-w-[900px] px-1 pb-10 pt-0.5">
      <div className="mb-[22px]">
        <div className="mb-[5px] text-[13px] font-medium text-muted">Workspace · Surency</div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Settings</h1>
      </div>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">PROVIDER CONNECTIONS</div>
      <div className="mb-[26px] flex flex-col gap-3.5">
        {providersLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          orderedProviders.map((p) => <ProviderCard key={p.kind} provider={p} />)
        )}
      </div>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">PROFILE</div>
      <GlassCard className="mb-[26px] p-[22px]">
        {settingsLoading || !settings ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="mb-4 text-[12px] text-muted">
              Used for your sidebar profile and &ldquo;assigned to me&rdquo; filters.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-[#9494a6]">Your name</span>
                <input
                  defaultValue={settings.userName}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== settings.userName) updateSettings.mutate({ userName: v });
                  }}
                  placeholder="Your name"
                  className="rounded-[11px] border border-white/[0.09] bg-white/[0.04] px-[13px] py-[10px] text-[13px] text-ink outline-none focus:border-[rgba(139,92,246,.5)]"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold text-[#9494a6]">Your role</span>
                <input
                  defaultValue={settings.userRole}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== settings.userRole) updateSettings.mutate({ userRole: v });
                  }}
                  placeholder="Your role (e.g. QA Lead)"
                  className="rounded-[11px] border border-white/[0.09] bg-white/[0.04] px-[13px] py-[10px] text-[13px] text-ink outline-none focus:border-[rgba(139,92,246,.5)]"
                />
              </label>
            </div>
          </>
        )}
      </GlassCard>

      <div className="mb-3 text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">DEFAULT EXECUTION</div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !settings ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-white/[0.06] py-[13px]">
              <div>
                <div className="text-[14px] font-semibold">Parallel workers</div>
                <div className="text-[12px] text-muted">
                  Default up to {settings.parallel} cases at once per Run
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={settings.parallel}
                  onChange={(e) => updateSettings.mutate({ parallel: Number(e.target.value) })}
                  className="w-[150px] accent-[#8b5cf6]"
                />
                <span className="w-5 text-center font-mono text-[14px] font-bold">{settings.parallel}</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.06] py-[13px]">
              <div>
                <div className="text-[14px] font-semibold">Max test cases per ticket</div>
                <div className="text-[12px] text-muted">
                  Cap AI generation to at most {settings.maxCasesPerTicket} cases per ticket
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={settings.maxCasesPerTicket}
                  onChange={(e) => updateSettings.mutate({ maxCasesPerTicket: Number(e.target.value) })}
                  className="w-[150px] accent-[#8b5cf6]"
                />
                <span className="w-5 text-center font-mono text-[14px] font-bold">
                  {settings.maxCasesPerTicket}
                </span>
              </div>
            </div>
            <ToggleRow
              title="Auto-retry flaky tests"
              description="Retry failed cases up to 2 times"
              checked={settings.retryFlaky}
              onChange={(v) => updateSettings.mutate({ retryFlaky: v })}
            />
            <ToggleRow
              title="Screenshot on failure"
              description="Capture full-page evidence for every failed step"
              checked={settings.screenshotOnFail}
              onChange={(v) => updateSettings.mutate({ screenshotOnFail: v })}
            />
            <ToggleRow
              title="Auto-annotate failure screenshots"
              description="Runs a Claude vision analysis on each failed screenshot to draw the problem area — one AI call per failure"
              checked={settings.autoAnnotate}
              onChange={(v) => updateSettings.mutate({ autoAnnotate: v })}
            />
            <ToggleRow
              title="Record video"
              description="Save an MP4 of each run (uses more storage)"
              checked={settings.video}
              onChange={(v) => updateSettings.mutate({ video: v })}
            />
            <ToggleRow
              title="Run browser headless"
              description="Execute Playwright without a visible browser window (turn off to watch runs)"
              checked={settings.headless}
              onChange={(v) => updateSettings.mutate({ headless: v })}
              bordered={false}
            />
          </>
        )}
      </GlassCard>

      <div className="mb-3 mt-[26px] text-[12px] font-bold tracking-[0.08em] text-[#6c6c7e]">INTERFACE</div>
      <GlassCard className="p-[22px]">
        {settingsLoading || !settings ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <ToggleRow
            title="3D background"
            description="Animated neural-constellation backdrop. Turn off for a flat background (lighter on the GPU)."
            checked={settings.neuralBackground}
            onChange={(v) => updateSettings.mutate({ neuralBackground: v })}
            bordered={false}
          />
        )}
      </GlassCard>
    </div>
  );
}
