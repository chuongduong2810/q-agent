import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { useProjectConfig, useSaveProjectConfig } from "@/hooks/queries";
import { ProjectSettingsForm } from "./ProjectSettingsForm";
import { ManualLoginStatus } from "./ManualLogin";

/**
 * Project Details → Settings tab. Thin wrapper: loads the current user's own
 * project config and renders {@link ProjectSettingsForm}, wiring the manual-login
 * widget to the owner-scoped auth endpoints.
 */
export function ProjectSettingsTab({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation("projects");
  const { data: config, isLoading } = useProjectConfig(projectKey);
  const save = useSaveProjectConfig(projectKey);
  if (isLoading || !config) {
    return (
      <div className="glass rounded-[18px] p-8 text-center text-[13px] text-ink-dim">
        {t("common:loading")}
      </div>
    );
  }
  return (
    <ProjectSettingsForm
      config={config}
      saving={save.isPending}
      onSave={(patch) =>
        save.mutate(patch, {
          onSuccess: () => toast.success(t("settingsTab.saved")),
          onError: (err) => toast.error(err instanceof Error ? err.message : t("settingsTab.saveError")),
        })
      }
      renderManualLogin={(hasBaseUrl) => (
        <ManualLoginStatus projectKey={projectKey} hasBaseUrl={hasBaseUrl} />
      )}
    />
  );
}
