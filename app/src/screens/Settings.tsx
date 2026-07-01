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
    <div className="animate-[fadeInUp_.5s_ease_both] max-w-[900px] px-1 pb-10 pt-0.5">
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
              title="Record video"
              description="Save an MP4 of each run (uses more storage)"
              checked={settings.video}
              onChange={(v) => updateSettings.mutate({ video: v })}
              bordered={false}
            />
          </>
        )}
      </GlassCard>
    </div>
  );
}
